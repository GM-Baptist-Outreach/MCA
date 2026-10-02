import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import {
  readPaymentMode,
  resolveShippoApiKey,
  resolveStripeSecretKey,
} from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";
import { corsHeadersFor, forbiddenOriginResponse, matchAllowedOrigin } from "../_shared/allowedOrigin.ts";
import {
  quoteStoreShippoRate,
  shippingTierFeeCents,
  shouldQuoteShippo,
  validateShipAddress,
} from "../_shared/storeShipping.ts";

// Public store checkout. Prices from items table server-side.
// Oklahoma 10% tax on STORE PRODUCTS only (not tuition, not shipping).
// Local pickup is always taxed. The MCA warehouse is in Oklahoma, so pickup
// does not require an address or an Oklahoma state value.
// Ship-to taxes when address_state is OK/Oklahoma.
// allow_promotion_codes for Stripe Dashboard warehouse coupons.
// Shippo rates are used only when fulfillment is ship and the active mode's
// Shippo key is set. Any Shippo miss falls back to shipping_rate_tiers.
// Pickup never calls Shippo. Enrollment never calls this function.
//
// Round 10 (MCA_R10_SAVED_CARDS_STORE): when a signed-in parent checks out
// (body.portal_access_token = their portal session) and the checkout email is
// their family's email, Checkout shows the family's saved cards and offers to
// save the new one. Anonymous checkouts never see saved cards.

const OK_SALES_TAX_RATE = 0.10;

function normalizeState(raw: unknown): string {
  return String(raw ?? "").trim().toUpperCase();
}

function isOklahomaState(state: string): boolean {
  return state === "OK" || state === "OKLAHOMA";
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
    const { items, customer } = body ?? {}; // body.origin is ignored; the validated Origin header is used

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
    // Round 11 (MCA_R11_STORE_ADDRESS): a full, shippable US address is
    // required for Ship to Me: street with a house/box number, optional line
    // 2, city, state, ZIP. Normalized values replace what the browser sent.
    if (customer.fulfillment === "ship") {
      const checked = validateShipAddress(customer);
      if (!checked.ok) {
        return new Response(JSON.stringify({ error: checked.error, field: checked.field }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const addr = checked.address!;
      customer.addressStreet = addr.street;
      customer.addressStreet2 = addr.street2;
      customer.addressCity = addr.city;
      customer.addressState = addr.state;
      customer.addressZip = addr.zip;
    } else {
      customer.addressStreet = "";
      customer.addressStreet2 = "";
      customer.addressCity = "";
      customer.addressState = "";
      customer.addressZip = "";
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);
    const paymentEnv = readEdgePaymentEnv();
    const mode = await readPaymentMode(admin);
    const stripeSecretKey = resolveStripeSecretKey(mode, paymentEnv);
    if (!stripeSecretKey) {
      console.error(`[store-checkout] No Stripe secret for payment mode ${mode}`);
      return new Response(
        JSON.stringify({ error: "The store isn't live yet — please contact us directly at (844) 663-4477." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const itemIds = items.map((i: any) => i.itemId).filter(Boolean);
    if (itemIds.length === 0) {
      return new Response(JSON.stringify({ error: "Your cart is empty" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Every cart line needs a whole-number quantity from 1 to 999. Checked
    // before the item lookup so a bad line is never silently dropped.
    const badQuantity = items.some((i: any) => {
      const quantity = Number(i?.quantity);
      return !Number.isInteger(quantity) || quantity < 1 || quantity > 999;
    });
    if (badQuantity) {
      return new Response(
        JSON.stringify({ error: "Please enter a whole-number quantity from 1 to 999." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
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
      const quantity = Number(cartLine.quantity);
      if (!dbItem || !dbItem.active) continue;

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
    let shippoRateId = "";
    let shippingQuote = customer.fulfillment === "ship" ? "tier" : "pickup";

    if (shouldQuoteShippo("store", customer.fulfillment)) {
      const shippoKey = resolveShippoApiKey(mode, paymentEnv);
      if (shippoKey) {
        try {
          const quote = await quoteStoreShippoRate({
            apiKey: shippoKey,
            totalQuantity,
            to: {
              name: `${customer.firstName} ${customer.lastName}`.trim(),
              street1: customer.addressStreet,
              ...(customer.addressStreet2 ? { street2: customer.addressStreet2 } : {}),
              city: customer.addressCity,
              state: customer.addressState,
              zip: customer.addressZip,
              country: "US",
              phone: customer.phone,
              email: customer.email,
            },
          });
          if (quote && quote.amountCents > 0) {
            shippingFeeCents = quote.amountCents;
            shippoRateId = quote.rateObjectId;
            shippingQuote = "shippo";
            console.log(
              `[store-checkout] Shippo ${quote.provider} ${quote.service} ${quote.amountCents} cents (${mode}, ground=${quote.ground})`,
            );
          } else {
            console.error("[store-checkout] Shippo returned no usable rate; using shipping_rate_tiers");
          }
        } catch (err) {
          console.error("[store-checkout] Shippo rating failed; using shipping_rate_tiers", err);
        }
      } else {
        console.log(`[store-checkout] No Shippo key for payment mode ${mode}; using shipping_rate_tiers`);
      }

      if (shippingQuote !== "shippo") {
        const { data: tiers, error: tiersError } = await admin
          .from("shipping_rate_tiers")
          .select("min_quantity, max_quantity, price")
          .eq("active", true)
          .order("min_quantity", { ascending: true });
        if (tiersError) {
          console.error("[store-checkout] shipping_rate_tiers read failed", tiersError);
        }
        shippingFeeCents = shippingTierFeeCents(tiers ?? [], totalQuantity);
        shippingQuote = shippingFeeCents > 0 ? "tier" : "none";
      }

      if (shippingFeeCents > 0) {
        line_items.push({
          price_data: {
            currency: "usd",
            unit_amount: shippingFeeCents,
            product_data: { name: "Shipping" },
          },
          quantity: 1,
        });
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
                line2: customer.addressStreet2 || undefined,
                city: customer.addressCity,
                state: customer.addressState,
                postal_code: customer.addressZip,
                country: "US",
              },
            }
          : {}),
      });

    // Redirect base is the allow-listed Origin header, never a client-supplied value.
    const siteUrl = allowedOrigin;

    const metadata: Record<string, string> = {
      order_type: "store",
      payment_mode: mode,
      customer_first_name: customer.firstName,
      customer_last_name: customer.lastName,
      customer_email: customer.email,
      customer_phone: customer.phone,
      fulfillment: customer.fulfillment,
      // stripe-webhook saves "address_street, city, ST zip" on the order, so
      // line 2 (apt, suite, church or business name) rides along in it.
      address_street: [customer.addressStreet, customer.addressStreet2].filter(Boolean).join(", "),
      address_line1: customer.addressStreet || "",
      address_line2: customer.addressStreet2 || "",
      address_city: customer.addressCity || "",
      address_state: customer.addressState || "",
      address_zip: customer.addressZip || "",
      ok_sales_tax_cents: String(taxCents),
      product_subtotal_cents: String(productSubtotalCents),
      shipping_quote: shippingQuote,
      shippo_rate_id: shippoRateId,
    };

    let savedCardOptions: Record<string, unknown> = {};
    const portalToken = typeof body?.portal_access_token === "string" ? body.portal_access_token : "";
    if (portalToken) {
      try {
        const { data: userData } = await admin.auth.getUser(portalToken);
        if (userData?.user) {
          const { data: fam } = await admin
            .from("families")
            .select("id, email")
            .eq("auth_user_id", userData.user.id)
            .maybeSingle();
          const famEmail = String(fam?.email ?? "").trim().toLowerCase();
          if (fam && famEmail && famEmail === String(customer.email).trim().toLowerCase()) {
            savedCardOptions = {
              saved_payment_method_options: {
                allow_redisplay_filters: ["always", "limited", "unspecified"],
                payment_method_save: "enabled",
              },
            };
            metadata.family_id = fam.id as string;
          }
        }
      } catch (err) {
        console.error("[store-checkout] portal token check failed", err);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: stripeCustomer.id,
      line_items,
      allow_promotion_codes: true,
      ...savedCardOptions,
      // The ship-to also rides on the PaymentIntent, so the full address shows
      // on the payment in the Stripe dashboard.
      ...(customer.fulfillment === "ship"
        ? {
            payment_intent_data: {
              shipping: {
                name: `${customer.firstName} ${customer.lastName}`.trim(),
                phone: customer.phone,
                address: {
                  line1: customer.addressStreet,
                  line2: customer.addressStreet2 || undefined,
                  city: customer.addressCity,
                  state: customer.addressState,
                  postal_code: customer.addressZip,
                  country: "US",
                },
              },
            },
          }
        : {}),
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
