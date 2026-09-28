import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";

// Public store checkout. Prices from items table server-side.
// Oklahoma 10% tax on STORE PRODUCTS only (not tuition, not shipping).
// Local pickup is always taxed. The MCA warehouse is in Oklahoma, so pickup
// does not require an address or an Oklahoma state value.
// Ship-to taxes when address_state is OK/Oklahoma.
// allow_promotion_codes for Stripe Dashboard warehouse coupons.
// Shipping still quantity-tiered; Shippo later when SHIPPO_API_KEY exists.
// Mirrors the deployed create-store-order-checkout function.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const OK_SALES_TAX_RATE = 0.10;

function normalizeState(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

function isOklahomaState(state: string): boolean {
  return state === "OK" || state === "OKLAHOMA";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: "The store isn't live yet — please contact us directly at (844) 663-4477." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();
    const { items, customer, origin } = body ?? {};

    if (!Array.isArray(items) || items.length === 0) {
      return new Response(JSON.stringify({ error: "Your cart is empty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (
      !customer?.firstName || !customer?.lastName || !customer?.email || !customer?.phone ||
      (customer.fulfillment !== "ship" && customer.fulfillment !== "pickup")
    ) {
      return new Response(JSON.stringify({ error: "Missing required customer information" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (
      customer.fulfillment === "ship" &&
      (!customer.addressStreet || !customer.addressCity || !customer.addressState || !customer.addressZip)
    ) {
      return new Response(JSON.stringify({ error: "Missing shipping address" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const itemIds = items.map((i: any) => i.itemId).filter(Boolean);
    if (itemIds.length === 0) {
      return new Response(JSON.stringify({ error: "Your cart is empty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: dbItems, error: itemsError } = await admin
      .from("items")
      .select("id, original_name, sales_price, active")
      .in("id", itemIds);

    if (itemsError) throw itemsError;

    const dbItemsById = new Map((dbItems ?? []).map((i) => [i.id, i]));

    const line_items: any[] = [];
    let totalQuantity = 0;
    let productSubtotalCents = 0;
    for (const cartLine of items) {
      const dbItem = dbItemsById.get(cartLine.itemId);
      const quantity = Number(cartLine.quantity) || 0;
      if (!dbItem || !dbItem.active || quantity <= 0) continue;

      const unitCents = Math.round(Number(dbItem.sales_price) * 100);
      totalQuantity += quantity;
      productSubtotalCents += unitCents * quantity;
      line_items.push({
        price_data: {
          currency: "usd",
          unit_amount: unitCents,
          product_data: {
            name: dbItem.original_name,
            metadata: { item_id: dbItem.id },
          },
        },
        quantity,
      });
    }

    if (line_items.length === 0) {
      return new Response(
        JSON.stringify({ error: "None of the items in your cart are currently available. Please refresh and try again." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let shippingFeeCents = 0;
    if (customer.fulfillment === "ship") {
      const { data: tiers } = await admin
        .from("shipping_rate_tiers")
        .select("min_quantity, max_quantity, price")
        .eq("active", true)
        .order("min_quantity", { ascending: true });

      const matchingTier = (tiers ?? []).find(
        (t) => totalQuantity >= t.min_quantity && (t.max_quantity == null || totalQuantity <= t.max_quantity),
      );
      const tierToUse = matchingTier ?? (tiers ?? [])[(tiers ?? []).length - 1];

      if (tierToUse) {
        shippingFeeCents = Math.round(Number(tierToUse.price) * 100);
        line_items.push({
          price_data: {
            currency: "usd",
            unit_amount: shippingFeeCents,
            product_data: { name: "Shipping" },
          },
          quantity: 1,
        });
      }

      // TODO(Shippo): when SHIPPO_API_KEY is set, replace the tier above with a
      // live rate from the Newcastle warehouse. Until then, quantity tiers stay
      // in place even if the key exists, so checkout is never blocked.
      if (Deno.env.get("SHIPPO_API_KEY")) {
        console.log(
          "[store-checkout] SHIPPO_API_KEY is set but live Shippo rating is not implemented yet. Using shipping_rate_tiers.",
        );
      }
    }

    const state = normalizeState(customer.addressState);
    // Pickup ignores address state. Ship taxes only OK / Oklahoma.
    const applyOkTax =
      productSubtotalCents > 0 &&
      (customer.fulfillment === "pickup" || isOklahomaState(state));

    let taxCents = 0;
    if (applyOkTax) {
      taxCents = Math.round(productSubtotalCents * OK_SALES_TAX_RATE);
      if (taxCents > 0) {
        line_items.push({
          price_data: {
            currency: "usd",
            unit_amount: taxCents,
            product_data: { name: "Oklahoma Sales Tax (10%)" },
          },
          quantity: 1,
        });
      }
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2024-12-18.acacia" });

    const existingCustomers = await stripe.customers.list({ email: customer.email, limit: 1 });
    const stripeCustomer = existingCustomers.data[0]
      ?? await stripe.customers.create({
        email: customer.email,
        name: `${customer.firstName} ${customer.lastName}`,
        phone: customer.phone,
        ...(customer.fulfillment === "ship"
          ? {
              address: {
                line1: customer.addressStreet,
                city: customer.addressCity,
                state: customer.addressState,
                postal_code: customer.addressZip,
                country: "US",
              },
            }
          : {}),
      });

    const siteUrl = origin || Deno.env.get("SITE_URL") || "https://mcahomeschool.com";

    const metadata: Record<string, string> = {
      order_type: "store",
      customer_first_name: customer.firstName,
      customer_last_name: customer.lastName,
      customer_email: customer.email,
      customer_phone: customer.phone,
      fulfillment: customer.fulfillment,
      address_street: customer.addressStreet || "",
      address_city: customer.addressCity || "",
      address_state: customer.addressState || "",
      address_zip: customer.addressZip || "",
      ok_sales_tax_cents: String(taxCents),
      product_subtotal_cents: String(productSubtotalCents),
    };

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomer.id,
      line_items,
      allow_promotion_codes: true,
      success_url: `${siteUrl}/store?status=success`,
      cancel_url: `${siteUrl}/store?status=cancelled`,
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
