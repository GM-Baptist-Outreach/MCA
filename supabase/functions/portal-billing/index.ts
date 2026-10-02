import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Round 10: saved cards and autopay for the Parent Portal. Marker: MCA_R10_PORTAL_BILLING
//
// POST JSON, signed-in parent (their own family) or admin (pass family_id):
//   { action: "list" }                     saved cards, autopay status, open balance
//   { action: "setup", return_path? }      Stripe Checkout in SETUP mode to save a
//                                          card. Setup mode never charges anything.
//   { action: "set_default", payment_method_id }
//                                          make a saved card the autopay card: the
//                                          customer's default and every active
//                                          subscription's default payment method
//   { action: "remove", payment_method_id }
//
// Nothing here creates a charge. Annual and monthly tuition already renew on
// their Stripe subscription ("autopay"); this lets families choose and update
// the card it uses, and the same saved cards show at store checkout when the
// parent is signed in.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const SITE = "https://mcahomeschool.com";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

type Family = { id: string; parent_name: string | null; email: string | null; phone: string | null; stripe_customer_id: string | null };

async function resolveFamily(req: Request, body: Record<string, unknown>): Promise<Family | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Sign in first." }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: userData } = await userClient.auth.getUser();
  if (!userData?.user) return json({ error: "Sign in first." }, 401);
  const admin = service();
  const cols = "id, parent_name, email, phone, stripe_customer_id";
  if (typeof body.family_id === "string" && body.family_id) {
    const { data: isAdmin } = await userClient.rpc("is_admin");
    if (!isAdmin) return json({ error: "Admin only" }, 403);
    const { data } = await admin.from("families").select(cols).eq("id", body.family_id).maybeSingle();
    if (!data) return json({ error: "Family not found" }, 404);
    return data as Family;
  }
  const { data } = await admin.from("families").select(cols).eq("auth_user_id", userData.user.id).maybeSingle();
  if (!data) return json({ error: "No family is linked to this sign-in." }, 404);
  return data as Family;
}

async function findCustomer(stripe: Stripe, admin: SupabaseClient, family: Family, create: boolean): Promise<string | null> {
  if (family.stripe_customer_id) {
    try {
      const c = await stripe.customers.retrieve(family.stripe_customer_id);
      if (!(c as Stripe.DeletedCustomer).deleted) return c.id;
    } catch (_err) {
      // fall through: the stored id may belong to the other payment mode
    }
  }
  if (family.email) {
    const found = await stripe.customers.list({ email: family.email, limit: 1 });
    if (found.data[0]) {
      if (found.data[0].id !== family.stripe_customer_id) {
        await admin.from("families").update({ stripe_customer_id: found.data[0].id }).eq("id", family.id);
      }
      return found.data[0].id;
    }
  }
  if (!create) return null;
  const created = await stripe.customers.create({
    email: family.email ?? undefined,
    name: family.parent_name ?? undefined,
    phone: family.phone ?? undefined,
    metadata: { family_id: family.id },
  });
  await admin.from("families").update({ stripe_customer_id: created.id }).eq("id", family.id);
  return created.id;
}

function defaultPmId(customer: Stripe.Customer): string | null {
  const d = customer.invoice_settings?.default_payment_method;
  if (!d) return null;
  return typeof d === "string" ? d : d.id;
}

async function listState(stripe: Stripe, customerId: string) {
  const customer = (await stripe.customers.retrieve(customerId)) as Stripe.Customer;
  const pms = await stripe.paymentMethods.list({ customer: customerId, type: "card", limit: 20 });
  let defaultId = defaultPmId(customer);
  // Self-heal after a card is saved: with no default yet, use the newest card.
  if (!defaultId && pms.data.length > 0) {
    const newest = [...pms.data].sort((a, b) => b.created - a.created)[0];
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: newest.id } });
    defaultId = newest.id;
  }
  const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  const live = subs.data.filter((s) => ["active", "trialing", "past_due", "unpaid", "incomplete"].includes(s.status));
  const invoices = await stripe.invoices.list({ customer: customerId, status: "open", limit: 20 });
  const pmOf = (s: Stripe.Subscription) =>
    typeof s.default_payment_method === "string" ? s.default_payment_method : s.default_payment_method?.id ?? null;
  const periodEnd = (s: Stripe.Subscription) => {
    const top = (s as unknown as { current_period_end?: number }).current_period_end;
    const item = (s.items?.data?.[0] as unknown as { current_period_end?: number } | undefined)?.current_period_end;
    const raw = top || item;
    return raw ? new Date(raw * 1000).toISOString() : null;
  };
  return {
    customer_id: customerId,
    cards: pms.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "card",
      last4: pm.card?.last4 ?? "????",
      exp_month: pm.card?.exp_month ?? null,
      exp_year: pm.card?.exp_year ?? null,
      is_default: pm.id === defaultId,
    })),
    default_payment_method: defaultId,
    subscriptions: live.map((s) => ({
      id: s.id,
      status: s.status,
      cancel_at_period_end: s.cancel_at_period_end,
      renews_on: periodEnd(s),
      amount: (s.items?.data ?? []).reduce((sum, it) => sum + ((it.price?.unit_amount ?? 0) * (it.quantity ?? 1)) / 100, 0),
      interval: s.items?.data?.[0]?.price?.recurring?.interval ?? null,
      card: pmOf(s) ?? defaultId,
      autopay: s.collection_method === "charge_automatically" && !s.cancel_at_period_end,
    })),
    open_balance: invoices.data.reduce((sum, inv) => sum + (inv.amount_remaining ?? 0) / 100, 0),
    open_invoices: invoices.data.map((inv) => ({
      id: inv.id,
      amount: (inv.amount_remaining ?? 0) / 100,
      due: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
      url: inv.hosted_invoice_url ?? null,
    })),
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const family = await resolveFamily(req, body);
    if (family instanceof Response) return family;
    const admin = service();
    const mode = await readPaymentMode(admin);
    const key = resolveStripeSecretKey(mode, readEdgePaymentEnv());
    if (!key) return json({ error: "Card payments aren't set up yet. Please call (844) 663-4477." }, 503);
    const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });

    if (body.action === "list") {
      const customerId = await findCustomer(stripe, admin, family, false);
      if (!customerId) {
        return json({ mode, customer_id: null, cards: [], subscriptions: [], open_balance: 0, open_invoices: [], default_payment_method: null });
      }
      return json({ mode, ...(await listState(stripe, customerId)) });
    }

    if (body.action === "setup") {
      const customerId = await findCustomer(stripe, admin, family, true);
      const back = typeof body.return_path === "string" && body.return_path.startsWith("/portal") ? body.return_path : "/portal";
      const join = back.includes("?") ? "&" : "?";
      const session = await stripe.checkout.sessions.create({
        mode: "setup",
        customer: customerId!,
        currency: "usd",
        payment_method_types: ["card"],
        success_url: `${SITE}${back}${join}billing=saved`,
        cancel_url: `${SITE}${back}${join}billing=cancelled`,
        metadata: { purpose: "save_card", family_id: family.id, payment_mode: mode },
        setup_intent_data: { metadata: { purpose: "save_card", family_id: family.id } },
      });
      return json({ url: session.url, id: session.id, mode });
    }

    const pmId = typeof body.payment_method_id === "string" ? body.payment_method_id : "";
    if (body.action === "set_default" || body.action === "remove") {
      const customerId = await findCustomer(stripe, admin, family, false);
      if (!customerId || !pmId) return json({ error: "Card not found." }, 404);
      const pm = await stripe.paymentMethods.retrieve(pmId);
      const owner = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
      if (owner !== customerId) return json({ error: "Card not found." }, 404);

      if (body.action === "set_default") {
        await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pmId } });
        const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
        for (const s of subs.data) {
          if (["active", "trialing", "past_due", "unpaid"].includes(s.status)) {
            await stripe.subscriptions.update(s.id, { default_payment_method: pmId });
          }
        }
        return json({ ok: true, ...(await listState(stripe, customerId)) });
      }

      await stripe.paymentMethods.detach(pmId);
      return json({ ok: true, ...(await listState(stripe, customerId)) });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("[portal-billing]", err);
    const msg = (err as { message?: string })?.message ?? String(err);
    return json({ error: msg }, 500);
  }
});
