import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import Stripe from "npm:stripe@17.4.0";
import { escapeHtml, sendResendEmail } from "../_shared/emailTemplates.ts";
import { readPaymentMode, resolveStripeSecretKey } from "../_shared/paymentMode.ts";
import { readEdgePaymentEnv } from "../_shared/readEdgeEnv.ts";

// Round 10 weekly summary for MCA staff. Marker: MCA_R10_WEEKLY_SUMMARY
//
// POST JSON:
//   { action: "send" }     pg_cron, Mondays 12:00 UTC (8 AM Eastern, 7 AM in
//                          winter). Sends to app_settings.weekly_summary_recipient
//                          when app_settings.weekly_summary_enabled is "true".
//   { action: "preview", dry_run? }
//                          admin only. Sends the same email ONLY to the signed-in
//                          admin (or returns the HTML with dry_run: true).
//
// Auth: x-cron-secret (CRON_SECRET env or Vault mca_cron_secret), or admin JWT.
// Covers the last 7 days. Test accounts are left out of every number.
// Money collected = succeeded Stripe charges minus refunds (read only; this
// never creates a charge), plus a count of paid store orders.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const DEFAULT_RECIPIENT = "david@midwestchristianacademy.com";
const ADMIN_URL = "https://mcahomeschool.com/admin";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

type Caller = { kind: "cron" } | { kind: "admin"; email: string | null };

async function authorize(req: Request): Promise<Caller | Response> {
  const headerSecret = req.headers.get("x-cron-secret");
  if (headerSecret) {
    const envSecret = Deno.env.get("CRON_SECRET");
    if (envSecret && headerSecret === envSecret) return { kind: "cron" };
    const { data } = await service().rpc("mca_get_cron_secret");
    if (typeof data === "string" && data && headerSecret === data) return { kind: "cron" };
    return json({ error: "Unauthorized" }, 401);
  }
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data, error } = await userClient.rpc("is_admin");
  if (error || !data) return json({ error: "Admin only" }, 403);
  const { data: userData } = await userClient.auth.getUser();
  return { kind: "admin", email: userData.user?.email ?? null };
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fmtDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

async function testFamilyIds(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin.from("families").select("id").eq("is_test_account", true);
  return new Set((data ?? []).map((r) => r.id as string));
}

export async function buildSummary(admin: SupabaseClient) {
  const now = new Date();
  const since = new Date(now.getTime() - 7 * 24 * 3600 * 1000);
  const sinceIso = since.toISOString();
  const tests = await testFamilyIds(admin);

  // New enrollments
  const { data: enr } = await admin
    .from("enrollments")
    .select("id, family_id, tuition_tier, frequency, is_comp, created_at, students(student_name)")
    .gte("created_at", sinceIso)
    .order("created_at");
  const newEnrollments = (enr ?? [])
    .filter((e) => !tests.has(e.family_id as string))
    .map((e) => ({
      student: one(e.students as unknown as { student_name: string } | null)?.student_name ?? "Student",
      tier: e.tuition_tier === "high_school" ? "High school" : "Elementary",
      plan: e.is_comp ? "no payment" : (e.frequency as string) ?? "",
    }));

  // Overdue tests (same 28-day rule as the reminder email, without the go-live date)
  const cutoff = new Date(now.getTime() - 28 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: issued } = await admin
    .from("student_pace_slots")
    .select("id, pace_number, issued_at, subjects(name), students(student_name, family_id)")
    .eq("status", "issued")
    .is("score", null)
    .is("score_report_id", null)
    .lte("issued_at", cutoff)
    .order("issued_at");
  const overdue = (issued ?? [])
    .map((s) => {
      const st = one(s.students as unknown as { student_name: string; family_id: string } | null);
      return {
        family_id: st?.family_id ?? "",
        student: st?.student_name ?? "Student",
        subject: one(s.subjects as unknown as { name: string } | null)?.name ?? "Subject",
        pace: Number(s.pace_number) > 1000 ? Number(s.pace_number) : Number(s.pace_number) + 1000,
        issued_at: s.issued_at as string,
      };
    })
    .filter((s) => !tests.has(s.family_id));

  // Reorder soon (the same forecast as the Today dashboard)
  const { data: forecast, error: forecastError } = await admin.rpc("mca_reorder_forecast", { p_days: null, p_include_test: false });
  if (forecastError) console.error("[weekly-summary] forecast failed", forecastError.message);
  const reorder = ((forecast ?? []) as Array<{ item_name: string; tracked: boolean; shortfall: number; on_hand: number | null; first_short_date: string | null }>)
    .filter((r) => r.tracked && r.shortfall > 0)
    .map((r) => ({ item: r.item_name, need: r.shortfall, on_hand: r.on_hand ?? 0, by: r.first_short_date }));
  const { data: outItems } = await admin.from("inventory_levels").select("item_id").lte("quantity_on_hand", 0);
  const outOfStock = new Set((outItems ?? []).map((r) => r.item_id as string)).size;

  // Boxes shipped
  const { data: picks } = await admin
    .from("pick_lists")
    .select("id, shipped_at, students(student_name, family_id)")
    .eq("status", "shipped")
    .gte("shipped_at", sinceIso);
  const pickBoxes = (picks ?? []).filter((p) => !tests.has(one(p.students as unknown as { family_id: string } | null)?.family_id ?? ""));
  const { data: shippedOrders } = await admin
    .from("orders")
    .select("id, family_id, customer_email, shipped_at, shipping_address")
    .gte("shipped_at", sinceIso);
  const { data: testEmails } = await admin.from("families").select("email").eq("is_test_account", true);
  const testEmailSet = new Set((testEmails ?? []).map((r) => String(r.email ?? "").toLowerCase()));
  const orderBoxes = (shippedOrders ?? []).filter(
    (o) => !tests.has(o.family_id as string) && !testEmailSet.has(String(o.customer_email ?? "").toLowerCase()) && String(o.shipping_address ?? "").trim(),
  );

  // Money collected
  const { data: paidOrders } = await admin
    .from("orders")
    .select("id, total, family_id, customer_email, payment_status, created_at")
    .eq("payment_status", "paid")
    .gte("created_at", sinceIso);
  const realPaidOrders = (paidOrders ?? []).filter(
    (o) => !tests.has(o.family_id as string) && !testEmailSet.has(String(o.customer_email ?? "").toLowerCase()),
  );
  let stripeCollected: number | null = null;
  let stripeCount = 0;
  let stripeNote = "";
  try {
    const mode = await readPaymentMode(admin);
    const key = resolveStripeSecretKey(mode, readEdgePaymentEnv());
    if (key) {
      const stripe = new Stripe(key, { apiVersion: "2024-12-18.acacia" });
      let total = 0;
      for await (const ch of stripe.charges.list({ created: { gte: Math.floor(since.getTime() / 1000) }, limit: 100 })) {
        if (ch.paid && ch.status === "succeeded") {
          total += (ch.amount - (ch.amount_refunded ?? 0)) / 100;
          stripeCount++;
        }
      }
      stripeCollected = total;
      if (mode === "test") stripeNote = " (Stripe is in Test mode)";
    } else stripeNote = " (no Stripe key for this mode)";
  } catch (err) {
    console.error("[weekly-summary] stripe read failed", err);
    stripeNote = " (couldn't reach Stripe)";
  }

  return {
    period: { from: since.toISOString(), to: now.toISOString(), label: `${fmtDay(since)} – ${fmtDay(now)}` },
    new_enrollments: newEnrollments,
    overdue_tests: overdue,
    reorder_soon: reorder,
    out_of_stock_items: outOfStock,
    boxes_shipped: { pick_lists: pickBoxes.length, store_orders: orderBoxes.length },
    money: {
      stripe_collected: stripeCollected,
      stripe_payments: stripeCount,
      stripe_note: stripeNote,
      paid_store_orders: realPaidOrders.length,
      paid_store_orders_total: realPaidOrders.reduce((s, o) => s + Number(o.total ?? 0), 0),
    },
  };
}

type Summary = Awaited<ReturnType<typeof buildSummary>>;

function renderSummary(s: Summary): { subject: string; html: string } {
  const box = (label: string, value: string, href: string) =>
    `<td style="padding:10px;border:1px solid #e1d8bd;border-radius:6px;vertical-align:top;width:20%"><div style="font-size:11px;text-transform:uppercase;color:#777">${escapeHtml(label)}</div><div style="font-size:22px;font-weight:bold;color:#14213d"><a href="${href}" style="color:#14213d;text-decoration:none">${escapeHtml(value)}</a></div></td>`;
  const list = (items: string[], empty: string, max = 12) =>
    items.length === 0
      ? `<p style="color:#777;margin:4px 0 12px">${escapeHtml(empty)}</p>`
      : `<ul style="margin:4px 0 12px">${items.slice(0, max).map((i) => `<li>${i}</li>`).join("")}${items.length > max ? `<li>…and ${items.length - max} more</li>` : ""}</ul>`;
  const boxes = s.boxes_shipped.pick_lists + s.boxes_shipped.store_orders;
  const collected = s.money.stripe_collected;
  const subject = `MCA weekly summary: ${s.period.label}`;
  const html = `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 640px;">
  <h2 style="margin-bottom:2px">Your week at MCA</h2>
  <p style="color:#777;margin-top:0">${escapeHtml(s.period.label)} · test accounts left out</p>
  <table style="border-collapse:separate;border-spacing:6px;width:100%"><tr>
    ${box("New enrollments", String(s.new_enrollments.length), `${ADMIN_URL}/enrollments`)}
    ${box("Overdue tests", String(s.overdue_tests.length), `${ADMIN_URL}/test-reviews`)}
    ${box("Reorder soon", String(s.reorder_soon.length), `${ADMIN_URL}/inventory`)}
    ${box("Boxes shipped", String(boxes), `${ADMIN_URL}/pick-lists`)}
    ${box("Collected", collected == null ? "—" : money(collected), `${ADMIN_URL}/orders`)}
  </tr></table>
  <h3 style="margin-bottom:0">New enrollments</h3>
  ${list(s.new_enrollments.map((e) => `${escapeHtml(e.student)} · ${escapeHtml(e.tier)}${e.plan ? ` · ${escapeHtml(e.plan)}` : ""}`), "No new enrollments this week.")}
  <h3 style="margin-bottom:0">Overdue tests</h3>
  <p style="color:#777;margin:2px 0">PACEs handed out 28+ days ago with no test uploaded yet.</p>
  ${list(s.overdue_tests.map((o) => `${escapeHtml(o.student)}: ${escapeHtml(o.subject)} PACE ${o.pace} (handed out ${escapeHtml(o.issued_at)})`), "Nothing overdue.")}
  <h3 style="margin-bottom:0">Low stock and reorder soon</h3>
  ${list(s.reorder_soon.map((r) => `${escapeHtml(r.item)}: reorder ${r.need}${r.by ? ` by ${escapeHtml(r.by)}` : ""} (on hand ${r.on_hand})`), "Nothing counted is running short in the reorder look-ahead.")}
  <p style="color:#777;margin:2px 0 12px">Items at zero on hand: ${s.out_of_stock_items}.</p>
  <h3 style="margin-bottom:0">Boxes shipped</h3>
  <p style="margin:4px 0 12px">${s.boxes_shipped.pick_lists} PACE box${s.boxes_shipped.pick_lists === 1 ? "" : "es"} and ${s.boxes_shipped.store_orders} store order${s.boxes_shipped.store_orders === 1 ? "" : "s"} marked shipped.</p>
  <h3 style="margin-bottom:0">Money collected</h3>
  <p style="margin:4px 0 12px">${collected == null ? "Card payments: not available" : `Card payments: <strong>${money(collected)}</strong> from ${s.money.stripe_payments} payment${s.money.stripe_payments === 1 ? "" : "s"}, after refunds`}${escapeHtml(s.money.stripe_note)}. Paid store orders: ${s.money.paid_store_orders} (${money(s.money.paid_store_orders_total)}).</p>
  <p style="color:#777;font-size:12px">Sent every Monday morning by mcahomeschool.com. Turn it off or change who gets it under Admin &gt; Settings &gt; Weekly summary email.</p>
</div>`;
  return { subject, html };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await authorize(req);
    if (caller instanceof Response) return caller;
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const admin = service();

    if (body.action === "send") {
      if (caller.kind !== "cron") return json({ error: "The weekly send only runs on its schedule. Use preview." }, 403);
      const { data: settings } = await admin
        .from("app_settings")
        .select("key, value")
        .in("key", ["weekly_summary_enabled", "weekly_summary_recipient"]);
      const get = (k: string) => settings?.find((r) => r.key === k)?.value as string | undefined;
      const recipient = (get("weekly_summary_recipient") || DEFAULT_RECIPIENT).trim();
      if ((get("weekly_summary_enabled") ?? "true") !== "true") {
        await admin.from("weekly_summary_runs").insert({ trigger: "cron", sent_to: recipient, status: "skipped", detail: "Turned off in Settings" });
        return json({ skipped: "disabled" });
      }
      const summary = await buildSummary(admin);
      const email = renderSummary(summary);
      const sent = await sendResendEmail({ to: recipient, subject: email.subject, html: email.html });
      await admin.from("weekly_summary_runs").insert({
        trigger: "cron", sent_to: recipient, status: sent ? "sent" : "failed",
        detail: sent ? null : "Resend did not accept the email", stats: summary,
      });
      return json({ sent, to: recipient });
    }

    if (body.action === "preview") {
      if (caller.kind !== "admin") return json({ error: "Admin only" }, 403);
      const summary = await buildSummary(admin);
      const email = renderSummary(summary);
      if (body.dry_run === true) return json({ summary, subject: email.subject, html: email.html });
      if (!caller.email) return json({ error: "This admin account has no email." }, 400);
      const sent = await sendResendEmail({ to: caller.email, subject: `[Preview] ${email.subject}`, html: email.html });
      await admin.from("weekly_summary_runs").insert({
        trigger: "preview", sent_to: caller.email, status: sent ? "sent" : "failed",
        detail: sent ? null : "Resend did not accept the email", stats: summary,
      });
      return json({ sent, to: caller.email, summary });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
