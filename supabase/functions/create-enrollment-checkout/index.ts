import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";
import { corsHeadersFor, forbiddenOriginResponse, matchAllowedOrigin } from "../_shared/allowedOrigin.ts";

// Public — called from the Enroll page. Creates a Stripe Checkout Session,
// one line item per DISTINCT price (grouped by tier, quantity = headcount at
// that tier) — not one line item per student. No database row is written
// here: families/students/enrollments only get created by the webhook after
// payment actually succeeds, so there's never a DB row without a real
// Stripe object behind it.
//
// Tuition never adds a shipping line, never adds sales tax, and never
// requests a carrier rate. Oklahoma tax and Shippo live only in
// create-store-order-checkout, and only for store shipments.

function tierFor(lastGradeCompleted: string): "elementary" | "high_school" | null {
  if (!lastGradeCompleted || lastGradeCompleted === "none") return null;
  return ["8", "9", "10", "11"].includes(lastGradeCompleted) ? "high_school" : "elementary";
}

Deno.serve(async (req: Request) => {
  // Only allow-listed browser origins may start a checkout (see _shared/allowedOrigin.ts).
  const allowedOrigin = matchAllowedOrigin(req);
  if (!allowedOrigin) return forbiddenOriginResponse();
  const corsHeaders = corsHeadersFor(allowedOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { parent, paymentPlan, students } = body ?? {}; // body.origin is ignored; the validated Origin header is used

    if (
      !parent?.email || !parent?.firstName || !parent?.lastName || !parent?.phone ||
      !parent?.addressStreet || !parent?.addressCity || !parent?.addressState || !parent?.addressZip
    ) {
      return new Response(JSON.stringify({ error: "Missing required parent information" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (paymentPlan !== "annual" && paymentPlan !== "monthly") {
      return new Response(JSON.stringify({ error: "Invalid payment plan" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!Array.isArray(students) || students.length === 0) {
      return new Response(JSON.stringify({ error: "At least one student is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Every student needs a grade; a blank one would silently enroll as
    // Kindergarten without being charged. "none" is the explicit K choice.
    if (students.some((s: any) => !s || typeof s.lastGradeCompleted !== "string" || !s.lastGradeCompleted.trim())) {
      return new Response(JSON.stringify({ error: "Please choose the last grade completed for every student." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const tuitionStudents = students
      .map((s: any) => ({ ...s, tier: tierFor(s.lastGradeCompleted) }))
      .filter((s: any) => s.tier);

    if (tuitionStudents.length === 0) {
      return new Response(
        JSON.stringify({ error: "No tuition-eligible students — Kindergarten enrolls through the store, not this form." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const mode = await readPaymentMode(admin);
    const stripeSecretKey = resolveStripeSecretKey(mode, readEdgePaymentEnv());
    if (!stripeSecretKey) {
      console.error(`[enrollment-checkout] No Stripe secret for payment mode ${mode}`);
      return new Response(
        JSON.stringify({ error: "Enrollment checkout isn't live yet — please contact us directly at (844) 663-4477." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: plans, error: plansError } = await admin
      .from("subscription_plans")
      .select("tuition_tier, frequency, stripe_price_id")
      .eq("frequency", paymentPlan)
      .eq("active", true);

    if (plansError) throw plansError;

    const priceByTier: Record<string, string | null> = {};
    for (const p of plans ?? []) priceByTier[p.tuition_tier] = p.stripe_price_id;

    const missingTier = tuitionStudents.find((s: any) => !priceByTier[s.tier]);
    if (missingTier) {
      return new Response(
        JSON.stringify({ error: "Pricing isn't fully configured yet — please contact us directly at (844) 663-4477." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });

    const addressFull = `${parent.addressStreet}, ${parent.addressCity}, ${parent.addressState} ${parent.addressZip}`;

    const existingCustomers = await stripe.customers.list({ email: parent.email, limit: 1 });
    const customer = existingCustomers.data[0]
      ?? await stripe.customers.create({
        email: parent.email,
        name: `${parent.firstName} ${parent.lastName}`,
        phone: parent.phone,
        address: {
          line1: parent.addressStreet,
          city: parent.addressCity,
          state: parent.addressState,
          postal_code: parent.addressZip,
          country: "US",
        },
      });

    // Group by price ID and sum quantity — one line item per distinct price,
    // not one per student (Stripe rejects duplicate recurring-price line items
    // in subscription mode).
    const quantityByPriceId: Record<string, number> = {};
    for (const s of tuitionStudents) {
      const priceId = priceByTier[s.tier]!;
      quantityByPriceId[priceId] = (quantityByPriceId[priceId] ?? 0) + 1;
    }
    const line_items = Object.entries(quantityByPriceId).map(([price, quantity]) => ({ price, quantity }));

    // Redirect base is the allow-listed Origin header, never a client-supplied value.
    const siteUrl = allowedOrigin;

    // Stripe metadata values are capped at 500 chars each, so full JSON blobs
    // risk truncation/errors for larger families. Encode compactly instead:
    // one key per student, pipe-delimited, well under the limit either way.
    const metadata: Record<string, string> = {
      payment_mode: mode,
      parent_first_name: parent.firstName,
      parent_last_name: parent.lastName,
      parent_second_name: parent.secondParentName || "",
      parent_email: parent.email,
      parent_phone: parent.phone,
      parent_address_street: parent.addressStreet,
      parent_address_city: parent.addressCity,
      parent_address_state: parent.addressState,
      parent_address_zip: parent.addressZip,
      parent_address_full: addressFull,
      payment_plan: paymentPlan,
      student_count: String(students.length),
    };
    students.forEach((s: any, i: number) => {
      metadata[`student_${i}`] = [
        s.firstName ?? "",
        s.lastName ?? "",
        s.gender ?? "",
        s.birthdate ?? "",
        s.lastGradeCompleted ?? "",
      ].join("|");
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      line_items,
      success_url: `${siteUrl}/enroll?status=success`,
      cancel_url: `${siteUrl}/enroll?status=cancelled`,
      metadata,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
