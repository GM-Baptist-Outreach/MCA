import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

// Admin-only. Called whenever David edits a subscription_plans.price in the
// admin portal, so Stripe stays in sync without him ever touching Stripe's
// dashboard directly. Stripe Prices are immutable, so this creates a new
// Price and archives the old one rather than updating in place.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "Stripe is not configured yet. Set STRIPE_SECRET_KEY and retry." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

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

    const { plan_id } = await req.json();
    if (!plan_id) {
      return new Response(JSON.stringify({ error: "plan_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Service-role client for the actual read/write (bypasses RLS).
    const admin = createClient(supabaseUrl, serviceRoleKey);

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

    const oldPriceId: string | null = plan.stripe_price_id;
    const oldPrice = plan.price;

    const newPrice = await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(Number(plan.price) * 100),
      currency: "usd",
      recurring: { interval: plan.frequency === "annual" ? "year" : "month" },
      metadata: { subscription_plan_id: plan.id },
    });

    if (oldPriceId) {
      await stripe.prices.update(oldPriceId, { active: false }).catch(() => {});
    }

    await admin
      .from("subscription_plans")
      .update({ stripe_price_id: newPrice.id, updated_at: new Date().toISOString() })
      .eq("id", plan.id);

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
      new_price: plan.price,
    });

    return new Response(
      JSON.stringify({ success: true, stripe_price_id: newPrice.id, stripe_product_id: product.id }),
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
