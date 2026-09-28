import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Admin-only. Called whenever David edits a subscription_plans.price in the
// admin portal, so Stripe stays in sync without him ever touching Stripe's
// dashboard directly. Stripe Prices are immutable, so this creates a new
// Price and archives the old one rather than updating in place.
//
// The Stripe secret is the one for the active payment mode, so a Test toggle
// creates sandbox prices and Live creates live prices. After flipping mode,
// re-save each plan so stripe_price_id matches that mode.
//
// This function owns the ENTIRE price change now — reading the current
// (still-old) price, creating the new Stripe Price, writing the new price
// to subscription_plans, and logging both old and new to price_change_log
// — all in one place. It used to only sync Stripe after the caller had
// already written the new price to subscription_plans itself, which meant
// by the time this function read "the old price" to log it, the row
// already held the new value — old_price and new_price ended up identical
// in every logged row. Owning the read-then-write here fixes that.

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

    // Verify the caller is an admin using their own JWT (RLS-respecting client).
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

    const { plan_id, new_price } = await req.json();
    if (!plan_id) {
      return new Response(JSON.stringify({ error: "plan_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const newPriceNum = Number(new_price);
    if (!new_price || isNaN(newPriceNum) || newPriceNum <= 0) {
      return new Response(JSON.stringify({ error: "A valid new_price is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for the actual read/write (bypasses RLS).
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const mode = await readPaymentMode(admin);
    const stripeSecretKey = resolveStripeSecretKey(mode, readEdgePaymentEnv());
    if (!stripeSecretKey) {
      console.error(`[sync-plan-price] No Stripe secret for payment mode ${mode}`);
      return new Response(
        JSON.stringify({
          error: `Stripe is not configured for payment mode "${mode}". Set STRIPE_SECRET_KEY_${mode.toUpperCase()} (legacy STRIPE_SECRET_KEY counts as live).`,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Read BEFORE any write — this is the only correct source for "the old
    // price", since subscription_plans.price hasn't been touched yet at
    // this point in the request.
    const { data: plan, error: planError } = await admin
      .from("subscription_plans")
      .select("*")
      .eq("id", plan_id)
      .single();

    if (planError || !plan) {
      return new Response(JSON.stringify({ error: "Plan not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const oldPriceId: string | null = plan.stripe_price_id;
    const oldPrice = plan.price;

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });

    // Find or create the Stripe Product for this plan (matched by metadata,
    // since the schema has no stripe_product_id column).
    const existingProducts = await stripe.products.search({
      query: `metadata['subscription_plan_id']:'${plan.id}'`,
    });
    const product = existingProducts.data[0]
      ?? await stripe.products.create({
        name: plan.name,
        metadata: { subscription_plan_id: plan.id },
      });

    const newStripePrice = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(newPriceNum * 100),
      currency: "usd",
      recurring: { interval: plan.frequency === "annual" ? "year" : "month" },
      metadata: { subscription_plan_id: plan.id },
    });

    if (oldPriceId) {
      await stripe.prices.update(oldPriceId, { active: false }).catch(() => {});
    }

    const { error: updateError } = await admin
      .from("subscription_plans")
      .update({
        price: newPriceNum,
        stripe_price_id: newStripePrice.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", plan.id);

    if (updateError) throw updateError;

    const { data: adminRow } = await admin
      .from("admin_users")
      .select("id")
      .eq("auth_user_id", userData.user.id)
      .maybeSingle();

    await admin.from("price_change_log").insert({
      subscription_plan_id: plan.id,
      changed_by: adminRow?.id ?? null,
      change_source: "manual",
      old_price: oldPrice,
      new_price: newPriceNum,
    });

    return new Response(
      JSON.stringify({ success: true, stripe_price_id: newStripePrice.id, stripe_product_id: product.id, payment_mode: mode }),
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
