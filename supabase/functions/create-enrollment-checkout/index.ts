import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

// Public — called from the Enroll page. Creates a Stripe Checkout Session,
// one line item per DISTINCT price (grouped by tier, quantity = headcount at
// that tier) — not one line item per student. Stripe's subscription-mode
// Checkout rejects multiple line items pointing at the same recurring price,
// which is exactly what happens when two students land in the same tier.
// No database row is written here: families/students/enrollments only get
// created by the webhook after payment actually succeeds, so there's never a
// DB row without a real Stripe object behind it.
//
// Tuition must never add a shipping line and must never add sales tax.
// Oklahoma 10% tax is store products only (create-store-order-checkout).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Last grade completed -> tuition tier. "none"/empty = entering Kindergarten,
// which doesn't use tuition at all (routes to the store instead).
function tierFor(lastGradeCompleted: string): "elementary" | "high_school" | null {
  if (!lastGradeCompleted || lastGradeCompleted === "none") return null;
  return ["8", "9", "10", "11"].includes(lastGradeCompleted) ? "high_school" : "elementary";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Enrollment checkout isn't live yet — please contact us directly at (844) 663-4477." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { parent, paymentPlan, students, origin } = body ?? {};

    if (!parent?.email || !parent?.firstName || !parent?.lastName || !parent?.phone || !parent?.address) {
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

    const existingCustomers = await stripe.customers.list({ email: parent.email, limit: 1 });
    const customer = existingCustomers.data[0]
      ?? await stripe.customers.create({
        email: parent.email,
        name: `${parent.firstName} ${parent.lastName}`,
        phone: parent.phone,
        address: { line1: parent.address },
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

    const siteUrl = origin || Deno.env.get("SITE_URL") || "https://midwestchristianacademy.com";

    // Stripe metadata values are capped at 500 chars each, so full JSON blobs
    // risk truncation/errors for larger families. Encode compactly instead:
    // one key per student, pipe-delimited, well under the limit either way.
    const metadata: Record<string, string> = {
      parent_first_name: parent.firstName,
      parent_last_name: parent.lastName,
      parent_second_name: parent.secondParentName || "",
      parent_email: parent.email,
      parent_phone: parent.phone,
      parent_address: parent.address,
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
