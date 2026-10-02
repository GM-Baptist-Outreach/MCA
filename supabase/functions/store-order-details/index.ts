import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Round 11 (MCA_R11_STORE_ADDRESS): admin-only, READ-ONLY lookup of every
// address Stripe holds for a store order (Checkout shipping/customer details,
// the card's billing address, and the Stripe customer's address). Used by the
// admin order view when an order's saved ship-to looks incomplete. Never
// changes anything in Stripe.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: auth } },
    });
    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_admin");
    if (adminErr || !isAdmin) return json({ error: "Admin only" }, 403);

    const { order_id } = await req.json().catch(() => ({}));
    if (!order_id) return json({ error: "order_id is required" }, 400);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: order } = await admin
      .from("orders")
      .select("id, shipping_address, stripe_checkout_session_id, stripe_payment_intent_id")
      .eq("id", order_id)
      .maybeSingle();
    if (!order) return json({ error: "Order not found" }, 404);
    if (!order.stripe_checkout_session_id) return json({ order_id, saved: order.shipping_address, stripe: null });

    const key = resolveStripeSecretKey(
      String(order.stripe_checkout_session_id).startsWith("cs_test_") ? "test" : "live",
      readEdgePaymentEnv(),
    );
    if (!key) return json({ error: "No Stripe key" }, 503);
    const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
    const s = await stripe.checkout.sessions.retrieve(order.stripe_checkout_session_id, {
      expand: ["payment_intent.payment_method", "customer"],
    });
    const pi = s.payment_intent as Stripe.PaymentIntent | null;
    const pm = (pi?.payment_method ?? null) as Stripe.PaymentMethod | null;
    const cust = (s.customer && typeof s.customer === "object" && !("deleted" in s.customer && s.customer.deleted))
      ? s.customer as Stripe.Customer
      : null;
    // deno-lint-ignore no-explicit-any
    const anyS = s as any;
    return json({
      order_id,
      saved: order.shipping_address,
      stripe: {
        metadata_address: {
          street: s.metadata?.address_street ?? null,
          line1: s.metadata?.address_line1 ?? null,
          line2: s.metadata?.address_line2 ?? null,
          city: s.metadata?.address_city ?? null,
          state: s.metadata?.address_state ?? null,
          zip: s.metadata?.address_zip ?? null,
        },
        shipping_details: anyS.shipping_details ?? anyS.collected_information?.shipping_details ?? null,
        customer_details: s.customer_details
          ? { name: s.customer_details.name, email: s.customer_details.email, phone: s.customer_details.phone, address: s.customer_details.address }
          : null,
        payment_intent_shipping: pi?.shipping ?? null,
        card_billing: pm?.billing_details
          ? { name: pm.billing_details.name, address: pm.billing_details.address, type: pm.type, wallet: pm.card?.wallet?.type ?? null }
          : null,
        customer_address: cust ? { name: cust.name, address: cust.address, shipping: cust.shipping } : null,
      },
    });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
