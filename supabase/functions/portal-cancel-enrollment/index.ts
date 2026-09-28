import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Parent-facing self-service cancellation, called from the Parent Portal.
// Same Stripe branching logic as the admin cancel-enrollment function
// (last student on the subscription -> cancel at period end; sibling
// sharing a line item -> reduce quantity; only student on their specific
// item but siblings on a different tier -> remove just that item), kept as
// a separate function rather than modifying the already-tested admin one.
// Authorization is family-ownership (this enrollment's family_id belongs
// to the caller) instead of is_admin().
//
// A family can have more than one Stripe subscription over time (e.g. a
// second student enrolled later under a new checkout), so every lookup
// here is scoped to THIS enrollment's own stripe_subscription_id — never
// the family's stripe_subscription_id column, which only ever reflects one
// (the first) subscription.
//
// Tags the family's GHL contact "self-cancelled" (distinct from the admin
// version's "staff-cancelled") so staff can build different GHL workflows
// depending on who initiated the cancellation, without ever needing this
// function edited again.

const GHL_ENROLLMENT_PIPELINE_ID = "NuTKV11562lhb6EYckXp";
const GHL_STAGE_WITHDRAWN = "f710c229-366b-4ec7-8155-6e69b899d96c";

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

    const { enrollment_id, reason } = await req.json();
    const validReasons = ["graduated", "moved", "financial", "switched_program", "other"];
    if (!enrollment_id || !validReasons.includes(reason)) {
      return new Response(JSON.stringify({ error: "enrollment_id and a valid reason are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: enrollment, error: enrollmentError } = await admin
      .from("enrollments")
      .select("id, family_id, student_id, stripe_price_id, stripe_subscription_id, status, ghl_opportunity_id")
      .eq("id", enrollment_id)
      .single();

    if (enrollmentError || !enrollment) {
      return new Response(JSON.stringify({ error: "Enrollment not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Ownership check — the caller must be the family this enrollment
    // belongs to. This is the only difference from the admin version's
    // authorization.
    const { data: family } = await admin
      .from("families")
      .select("id, ghl_contact_id, auth_user_id")
      .eq("id", enrollment.family_id)
      .single();

    if (!family || family.auth_user_id !== userData.user.id) {
      return new Response(JSON.stringify({ error: "This enrollment doesn't belong to your account." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (enrollment.status !== "active") {
      return new Response(JSON.stringify({ error: "This enrollment is not active" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!enrollment.stripe_subscription_id) {
      return new Response(JSON.stringify({ error: "No Stripe subscription found for this enrollment" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: siblingEnrollments } = await admin
      .from("enrollments")
      .select("id")
      .eq("stripe_subscription_id", enrollment.stripe_subscription_id)
      .eq("stripe_price_id", enrollment.stripe_price_id)
      .eq("status", "active")
      .neq("id", enrollment.id);

    const mode = await readPaymentMode(admin);
    const stripeSecretKey = resolveStripeSecretKey(mode, readEdgePaymentEnv());
    if (!stripeSecretKey) {
      console.error(`[portal-cancel-enrollment] No Stripe secret for payment mode ${mode}`);
      return new Response(JSON.stringify({ error: "Stripe is not configured yet." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });
    const subscription = await stripe.subscriptions.retrieve(enrollment.stripe_subscription_id);

    const matchingItem = subscription.items.data.find((item) => item.price.id === enrollment.stripe_price_id);

    let stripeAction: string;

    if (!matchingItem) {
      return new Response(
        JSON.stringify({ error: "Something doesn't match up with your subscription. Please contact the school directly to cancel." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (subscription.items.data.length === 1 && (siblingEnrollments?.length ?? 0) === 0) {
      await stripe.subscriptions.update(enrollment.stripe_subscription_id, { cancel_at_period_end: true });
      stripeAction = "subscription_cancelled_at_period_end";
    } else if ((siblingEnrollments?.length ?? 0) > 0 && matchingItem.quantity && matchingItem.quantity > 1) {
      await stripe.subscriptionItems.update(matchingItem.id, {
        quantity: matchingItem.quantity - 1,
        proration_behavior: "none",
      });
      stripeAction = "item_quantity_reduced";
    } else {
      await stripe.subscriptionItems.del(matchingItem.id, { proration_behavior: "none" });
      stripeAction = "item_removed";
    }

    const { error: updateError } = await admin
      .from("enrollments")
      .update({
        status: "withdrawn",
        cancellation_reason: reason,
        updated_at: new Date().toISOString(),
      })
      .eq("id", enrollment.id);

    if (updateError) throw updateError;

    let ghlSynced = false;
    const ghlApiKey = Deno.env.get("GHL_API_KEY_MCA");
    if (enrollment.ghl_opportunity_id && ghlApiKey) {
      const ghlRes = await fetch(
        `https://services.leadconnectorhq.com/opportunities/${enrollment.ghl_opportunity_id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${ghlApiKey}`,
            Version: "2021-07-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pipelineId: GHL_ENROLLMENT_PIPELINE_ID,
            pipelineStageId: GHL_STAGE_WITHDRAWN,
            status: "lost",
          }),
        },
      );
      if (ghlRes.ok) {
        ghlSynced = true;
      } else {
        console.error("GHL opportunity update failed", ghlRes.status, await ghlRes.text());
      }
    }

    if (ghlApiKey && family.ghl_contact_id) {
      const tagRes = await fetch(`https://services.leadconnectorhq.com/contacts/${family.ghl_contact_id}/tags`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${ghlApiKey}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: ["self-cancelled"] }),
      });
      if (!tagRes.ok) {
        console.error("GHL tag add failed", tagRes.status, await tagRes.text());
      }
    }

    return new Response(JSON.stringify({ success: true, stripe_action: stripeAction, ghl_synced: ghlSynced }), {
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
