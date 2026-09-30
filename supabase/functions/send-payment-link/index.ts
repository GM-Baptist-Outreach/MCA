import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Admin-only. Converts an existing COMP (no-payment) enrollment into a real
// paid Stripe subscription, without re-collecting any family/student info -
// the parent's only action is entering payment details on a Stripe Checkout
// page. Reuses the enrollment's already-recorded tuition_tier and (unless
// overridden here) frequency; the price is always looked up fresh from
// subscription_plans at send time, never the stale comp-time value, since
// prices can change between when a family was comped and when they start
// paying.
//
// The Checkout Session carries metadata.conversion_of_enrollment_id (and
// the actual frequency used, in case it was overridden here) so
// stripe-webhook's checkout.session.completed handler UPDATES this exact
// enrollment row in place - never creates a new family/student/enrollment,
// since those already exist. See that branch in stripe-webhook for the
// other half of this flow.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData } = await callerClient.auth.getUser();
    if (!userData?.user) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: isAdmin } = await callerClient.rpc("is_admin");
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: "Admin access required" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { enrollment_id, frequency: frequencyOverride } = await req.json();
    if (!enrollment_id) {
      return new Response(JSON.stringify({ error: "enrollment_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: enrollment, error: enrollmentError } = await admin
      .from("enrollments")
      .select("id, family_id, student_id, tuition_tier, frequency, status, is_comp")
      .eq("id", enrollment_id)
      .single();

    if (enrollmentError || !enrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!enrollment.is_comp) {
      return new Response(JSON.stringify({ error: "This enrollment is not a comp enrollment." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (enrollment.status !== "active") {
      return new Response(JSON.stringify({ error: "This enrollment is not active." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const frequency = frequencyOverride === "annual" || frequencyOverride === "monthly"
      ? frequencyOverride
      : enrollment.frequency;
    if (frequency !== "annual" && frequency !== "monthly") {
      return new Response(JSON.stringify({ error: "A valid frequency (annual/monthly) is required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const [{ data: family }, { data: student }, { data: plan }] = await Promise.all([
      admin.from("families").select("id, parent_name, email, phone, stripe_customer_id").eq("id", enrollment.family_id).single(),
      admin.from("students").select("id, student_name").eq("id", enrollment.student_id).single(),
      admin.from("subscription_plans").select("stripe_price_id, price").eq("tuition_tier", enrollment.tuition_tier).eq("frequency", frequency).eq("active", true).maybeSingle(),
    ]);

    if (!family) {
      return new Response(JSON.stringify({ error: "Family not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!student) {
      return new Response(JSON.stringify({ error: "Student not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!plan?.stripe_price_id) {
      return new Response(
        JSON.stringify({ error: `No active ${frequency} price configured for ${enrollment.tuition_tier}.` }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mode = await readPaymentMode(admin);
    const stripeSecretKey = resolveStripeSecretKey(mode, readEdgePaymentEnv());
    if (!stripeSecretKey) {
      console.error(`[send-payment-link] No Stripe secret for payment mode ${mode}`);
      return new Response(JSON.stringify({ error: "Stripe is not configured yet." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });

    let stripeCustomerId = family.stripe_customer_id as string | null;
    if (!stripeCustomerId) {
      const existingCustomers = await stripe.customers.list({ email: family.email, limit: 1 });
      const customer = existingCustomers.data[0]
        ?? await stripe.customers.create({ email: family.email, name: family.parent_name, phone: family.phone });
      stripeCustomerId = customer.id;
      await admin.from("families").update({ stripe_customer_id: stripeCustomerId }).eq("id", family.id);
    }

    const siteUrl = Deno.env.get("SITE_URL") || "https://mcahomeschool.com";

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeCustomerId,
      line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
      success_url: `${siteUrl}/enroll?status=success`,
      cancel_url: `${siteUrl}/enroll?status=cancelled`,
      metadata: {
        conversion_of_enrollment_id: enrollment.id,
        frequency,
        payment_mode: mode,
      },
    });

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (resendApiKey && session.url) {
      const firstName = family.parent_name?.split(" ")[0] ?? "there";
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Midwest Christian Academy <admin@mcahomeschool.com>",
          reply_to: "david@midwestchristianacademy.com",
          to: [family.email],
          subject: `Set up payment for ${student.student_name}'s enrollment`,
          html: `
            <div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
              <h2>Time to set up payment</h2>
              <p>Hi ${firstName},</p>
              <p>${student.student_name}'s enrollment is ready to move to a paid plan - ${frequency}, $${plan.price}. Everything else stays exactly the same: their student record, your Parent Portal access, all of it. You just need to add a payment method.</p>
              <p><a href="${session.url}" style="display:inline-block;background:#1a1a2e;color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;">Set Up Payment</a></p>
              <p>Questions? Call us at (844) 663-4477 or reach out at david@midwestchristianacademy.com.</p>
            </div>
          `,
        }),
      }).catch((err) => console.error("Resend send failed", err));
    }

    return new Response(
      JSON.stringify({ success: true, checkout_url: session.url, price: plan.price, frequency, emailed_to: family.email }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
