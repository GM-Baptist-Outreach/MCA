import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Admin-only. Refunds a paid store order directly through Stripe and marks
// it cancelled — so David/staff never have to leave this portal to handle
// a "wrong item" or "customer changed their mind" request. Full refund
// only, no partial-line-item refunds (matches the all-or-nothing pattern
// already used by cancel-enrollment).
//
// Orders placed before stripe_payment_intent_id started being recorded
// have no Stripe reference to refund against — those are refused here with
// a clear message rather than silently failing, since Stripe still needs
// to be handled manually for that handful of legacy orders.
//
// Any items on this order that are being inventory-tracked
// (inventory_levels row exists) get their quantity_on_hand added back,
// since a refunded/cancelled order is no longer actually going out.

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

    const { order_id, reason } = await req.json();
    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id, status, payment_status, total, stripe_payment_intent_id")
      .eq("id", order_id)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.status === "cancelled") {
      return new Response(JSON.stringify({ error: "This order is already cancelled." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (order.payment_status !== "paid") {
      return new Response(
        JSON.stringify({ error: `Can't refund an order with payment status "${order.payment_status}" — only paid orders can be refunded.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!order.stripe_payment_intent_id) {
      return new Response(
        JSON.stringify({
          error: "This order predates automatic Stripe tracking and has no payment reference on file. Refund it directly in the Stripe dashboard, then mark it cancelled manually.",
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const mode = await readPaymentMode(admin);
    const stripeSecretKey = resolveStripeSecretKey(mode, readEdgePaymentEnv());
    if (!stripeSecretKey) {
      console.error(`[cancel-store-order] No Stripe secret for payment mode ${mode}`);
      return new Response(JSON.stringify({ error: "Stripe is not configured yet." }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });
    const refund = await stripe.refunds.create({ payment_intent: order.stripe_payment_intent_id });

    const { error: updateError } = await admin
      .from("orders")
      .update({ status: "cancelled", payment_status: "refunded" })
      .eq("id", order.id);

    if (updateError) throw updateError;

    // Best-effort: restore inventory for any tracked items on this order.
    const { data: orderItems } = await admin
      .from("order_items")
      .select("item_id, quantity")
      .eq("order_id", order.id);

    if (orderItems && orderItems.length > 0) {
      const { data: locationRow } = await admin
        .from("locations")
        .select("id")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (locationRow) {
        for (const oi of orderItems) {
          const { data: levelRow } = await admin
            .from("inventory_levels")
            .select("id, quantity_on_hand")
            .eq("item_id", oi.item_id)
            .eq("location_id", locationRow.id)
            .maybeSingle();

          if (levelRow) {
            await admin
              .from("inventory_levels")
              .update({
                quantity_on_hand: levelRow.quantity_on_hand + oi.quantity,
                updated_at: new Date().toISOString(),
              })
              .eq("id", levelRow.id);
          }
        }
      }
    }

    console.log(`Order ${order.id} refunded and cancelled. Reason: ${reason ?? "not given"}`);

    return new Response(
      JSON.stringify({ success: true, refund_id: refund.id, amount_refunded: refund.amount / 100 }),
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
