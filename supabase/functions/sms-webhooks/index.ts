import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Round 8: SMS webhooks for GM Baptist software. Marker: MCA_R8_SMS_WEBHOOKS
//
// Each event has its own webhook URL and its own on/off switch (Settings page):
//   test_upload_overdue -> sms_webhook_url_overdue / sms_webhook_enabled_overdue
//   box_shipped         -> sms_webhook_url_shipped / sms_webhook_enabled_shipped
// Each URL is one automation in GM Baptist software, which sends the text.
//
// Actions (POST JSON):
//   { action: "send_test", event }   admin. Posts a sample payload (test: true)
//                                    built from a TEST account to that event's URL.
//   { action: "shipped_scan" }       cron every 5 min (only when the switch is on).
//                                    One webhook per shipment row that the shipping
//                                    email trigger logs (family_email_log kind
//                                    'shipment'), created after the switch was
//                                    turned on and within the last 2 days.
//   { action: "overdue_scan", dry_run? }
//                                    daily cron 13:45 UTC (only when on). Admin may
//                                    dry_run. Same overdue rule as the family email
//                                    (MCA_R4_OVERDUE_RULE in family-emails): slot
//                                    Issued 28+ days ago, issued after
//                                    family_emails_live_since, no score, no score
//                                    report (other than rejected), active enrollment.
//                                    One webhook per student, each PACE at most once,
//                                    and at most one per student per 7 days.
//
// Test accounts (families.is_test_account) never trigger a real event; they are
// logged as skipped. Every send is logged in sms_webhook_log (dedupe_key unique).
// This function never sends email and never changes family-emails.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const OVERDUE_DAYS = 28;
const STUDENT_COOLDOWN_DAYS = 7;
const SHIPPED_LOOKBACK_HOURS = 48;
const PORTAL_URL = "https://mcahomeschool.com/portal/login";

type EventKey = "test_upload_overdue" | "box_shipped";
const EVENT_SETTINGS: Record<EventKey, { url: string; enabled: string; envUrl: string }> = {
  test_upload_overdue: {
    url: "sms_webhook_url_overdue",
    enabled: "sms_webhook_enabled_overdue",
    envUrl: "SMS_WEBHOOK_URL_OVERDUE",
  },
  box_shipped: {
    url: "sms_webhook_url_shipped",
    enabled: "sms_webhook_enabled_shipped",
    envUrl: "SMS_WEBHOOK_URL_SHIPPED",
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

type Caller = { kind: "cron" } | { kind: "admin" };

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
  return { kind: "admin" };
}

async function settingRow(admin: SupabaseClient, key: string) {
  const { data } = await admin.from("app_settings").select("value, updated_at").eq("key", key).maybeSingle();
  return data as { value: string | null; updated_at: string | null } | null;
}

async function eventConfig(admin: SupabaseClient, event: EventKey) {
  const cfg = EVENT_SETTINGS[event];
  const [urlRow, enabledRow] = await Promise.all([settingRow(admin, cfg.url), settingRow(admin, cfg.enabled)]);
  const url = (urlRow?.value ?? "").trim() || (Deno.env.get(cfg.envUrl) ?? "").trim();
  return {
    url,
    enabled: enabledRow?.value === "true",
    enabledSince: enabledRow?.value === "true" ? enabledRow.updated_at : null,
  };
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function splitName(name: string | null | undefined): { first: string; last: string } {
  const clean = (name ?? "").replace(/\(.*?\)/g, "").trim().split(/\s+/).filter(Boolean);
  if (clean.length === 0) return { first: "", last: "" };
  return { first: clean[0], last: clean.slice(1).join(" ") };
}

/** US numbers become +1XXXXXXXXXX; anything else is passed through trimmed. */
function normalizePhone(phone: string | null | undefined): string {
  const raw = (phone ?? "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}

function acePace(pace: number): number {
  return pace > 1000 ? pace : pace + 1000;
}

function trackingLink(number: string | null, url: string | null): string | null {
  if (url && /^https?:\/\//i.test(url.trim())) return url.trim();
  const n = (number ?? "").replace(/\s+/g, "");
  if (!n) return null;
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`;
  if (/^(\d{12}|\d{15})$/.test(n)) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`;
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`;
}

interface Payload {
  event: EventKey;
  test: boolean;
  family_id: string | null;
  student_id: string | null;
  parent_first_name: string;
  parent_last_name: string;
  parent_name: string;
  phone: string;
  email: string;
  student_name: string;
  message: string;
  tracking_number: string | null;
  tracking_url: string | null;
  paces: string[];
  portal_url: string;
  sent_at: string;
}

function buildPayload(input: {
  event: EventKey;
  test: boolean;
  family_id: string | null;
  student_id: string | null;
  parent_name: string | null;
  phone: string | null;
  email: string | null;
  student_name: string | null;
  tracking_number?: string | null;
  tracking_url?: string | null;
  paces?: string[];
}): Payload {
  const { first, last } = splitName(input.parent_name);
  const student = (input.student_name ?? "").trim();
  const link = input.event === "box_shipped" ? trackingLink(input.tracking_number ?? null, input.tracking_url ?? null) : null;
  const paces = input.paces ?? [];
  let message: string;
  if (input.event === "box_shipped") {
    message = `Midwest Christian Academy: ${student ? `${student}'s` : "Your"} box has shipped!` +
      (link ? ` Track it here: ${link}` : " It's on the way.");
  } else {
    const what = paces.length === 1 ? `a PACE test (${paces[0]})` : `${paces.length} PACE tests (${paces.join(", ")})`;
    message = `Midwest Christian Academy: friendly reminder that ${student || "your student"} has ${what} waiting to be uploaded. Upload it in the Parent Portal: ${PORTAL_URL}`;
  }
  return {
    event: input.event,
    test: input.test,
    family_id: input.family_id,
    student_id: input.student_id,
    parent_first_name: first,
    parent_last_name: last,
    parent_name: (input.parent_name ?? "").trim(),
    phone: normalizePhone(input.phone),
    email: (input.email ?? "").trim(),
    student_name: student,
    message,
    tracking_number: input.event === "box_shipped" ? (input.tracking_number ?? null) : null,
    tracking_url: link,
    paces,
    portal_url: PORTAL_URL,
    sent_at: new Date().toISOString(),
  };
}

async function postWebhook(url: string, payload: Payload): Promise<{ ok: boolean; status: number | null; detail: string }> {
  if (!/^https:\/\//i.test(url)) return { ok: false, status: null, detail: "Webhook URL must start with https://" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const text = (await res.text().catch(() => "")).slice(0, 300);
    return { ok: res.ok, status: res.status, detail: res.ok ? "Delivered" : `HTTP ${res.status}: ${text}` };
  } catch (err) {
    return { ok: false, status: null, detail: String(err).slice(0, 300) };
  }
}

async function claim(
  admin: SupabaseClient,
  row: { event: EventKey; dedupe_key: string; family_id: string | null; student_id: string | null; payload: Payload | null; status?: string; detail?: string; is_test?: boolean },
): Promise<string | null> {
  const { data, error } = await admin
    .from("sms_webhook_log")
    .insert({
      event: row.event,
      dedupe_key: row.dedupe_key,
      family_id: row.family_id,
      student_id: row.student_id,
      payload: row.payload,
      status: row.status ?? "pending",
      detail: row.detail ?? null,
      is_test: row.is_test ?? false,
    })
    .select("id")
    .maybeSingle();
  if (error) return null; // already logged (unique dedupe_key) or insert failed
  return (data?.id as string | undefined) ?? null;
}

async function deliver(admin: SupabaseClient, logId: string, url: string, payload: Payload) {
  const result = await postWebhook(url, payload);
  await admin
    .from("sms_webhook_log")
    .update({
      status: result.ok ? "sent" : "failed",
      http_status: result.status,
      detail: result.detail,
      sent_at: result.ok ? new Date().toISOString() : null,
    })
    .eq("id", logId);
  return result;
}

// ---------------------------------------------------------------------------
// Send test (admin): sample from a test account only.
// ---------------------------------------------------------------------------
async function sendTest(admin: SupabaseClient, event: EventKey) {
  const cfg = await eventConfig(admin, event);
  if (!cfg.url) return { sent: false, error: "No webhook URL is saved for this event yet." };
  const { data: fam } = await admin
    .from("families")
    .select("id, parent_name, phone, email, students(id, student_name)")
    .eq("is_test_account", true)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const student = one((fam?.students ?? null) as { id: string; student_name: string }[] | null);
  const payload = buildPayload({
    event,
    test: true,
    family_id: (fam?.id as string | undefined) ?? null,
    student_id: student?.id ?? null,
    parent_name: (fam?.parent_name as string | undefined) ?? "Test Parent",
    phone: (fam?.phone as string | undefined) ?? "",
    email: (fam?.email as string | undefined) ?? "",
    student_name: student?.student_name ?? "Test Student",
    tracking_number: event === "box_shipped" ? "9400111899223197428490" : null,
    tracking_url: null,
    paces: event === "test_upload_overdue" ? ["Math PACE 1037"] : [],
  });
  const logId = await claim(admin, {
    event,
    dedupe_key: `test:${event}:${Date.now()}`,
    family_id: payload.family_id,
    student_id: payload.student_id,
    payload,
    is_test: true,
  });
  if (!logId) return { sent: false, error: "Couldn't log the test send." };
  const result = await deliver(admin, logId, cfg.url, payload);
  return { sent: result.ok, http_status: result.status, detail: result.detail, payload };
}

// ---------------------------------------------------------------------------
// Box shipped
// ---------------------------------------------------------------------------
async function shippedScan(admin: SupabaseClient) {
  const cfg = await eventConfig(admin, "box_shipped");
  if (!cfg.enabled) return { enabled: false, results: [] };
  if (!cfg.url) return { enabled: true, error: "No webhook URL saved", results: [] };
  const lookback = new Date(Date.now() - SHIPPED_LOOKBACK_HOURS * 3600 * 1000).toISOString();
  const since = cfg.enabledSince && cfg.enabledSince > lookback ? cfg.enabledSince : lookback;
  const { data: rows } = await admin
    .from("family_email_log")
    .select("id, family_id, student_id, order_id, pick_list_id, created_at")
    .eq("kind", "shipment")
    .gte("created_at", since)
    .order("created_at")
    .limit(50);
  const results: unknown[] = [];
  for (const row of rows ?? []) {
    const dedupe = `shipped:${row.id}`;
    const { data: already } = await admin.from("sms_webhook_log").select("id").eq("dedupe_key", dedupe).maybeSingle();
    if (already) continue;

    let parentName: string | null = null;
    let phone: string | null = null;
    let email: string | null = null;
    let studentName: string | null = null;
    let trackingNumber: string | null = null;
    let trackingUrl: string | null = null;
    let familyId: string | null = (row.family_id as string | null) ?? null;
    let isTest = false;

    if (familyId) {
      const { data: fam } = await admin
        .from("families")
        .select("parent_name, phone, email, is_test_account")
        .eq("id", familyId)
        .maybeSingle();
      parentName = (fam?.parent_name as string | null) ?? null;
      phone = (fam?.phone as string | null) ?? null;
      email = (fam?.email as string | null) ?? null;
      isTest = !!fam?.is_test_account;
    }
    if (row.student_id) {
      const { data: st } = await admin.from("students").select("student_name").eq("id", row.student_id).maybeSingle();
      studentName = (st?.student_name as string | null) ?? null;
    }
    if (row.pick_list_id) {
      const { data: pl } = await admin
        .from("pick_lists")
        .select("tracking_number, tracking_url")
        .eq("id", row.pick_list_id)
        .maybeSingle();
      trackingNumber = (pl?.tracking_number as string | null) ?? null;
      trackingUrl = (pl?.tracking_url as string | null) ?? null;
    } else if (row.order_id) {
      const { data: order } = await admin
        .from("orders")
        .select("customer_name, customer_email, customer_phone, tracking_number, tracking_url, family_id")
        .eq("id", row.order_id)
        .maybeSingle();
      trackingNumber = (order?.tracking_number as string | null) ?? null;
      trackingUrl = (order?.tracking_url as string | null) ?? null;
      parentName = parentName ?? ((order?.customer_name as string | null) ?? null);
      phone = phone || ((order?.customer_phone as string | null) ?? null);
      email = email || ((order?.customer_email as string | null) ?? null);
      familyId = familyId ?? ((order?.family_id as string | null) ?? null);
      if (!isTest && email) {
        const { data: testFam } = await admin
          .from("families")
          .select("id")
          .eq("is_test_account", true)
          .ilike("email", email)
          .limit(1);
        isTest = (testFam ?? []).length > 0;
      }
    }

    const payload = buildPayload({
      event: "box_shipped",
      test: false,
      family_id: familyId,
      student_id: (row.student_id as string | null) ?? null,
      parent_name: parentName,
      phone,
      email,
      student_name: studentName,
      tracking_number: trackingNumber,
      tracking_url: trackingUrl,
    });

    if (isTest) {
      await claim(admin, { event: "box_shipped", dedupe_key: dedupe, family_id: familyId, student_id: payload.student_id, payload, status: "skipped", detail: "Test account", is_test: true });
      results.push({ log: row.id, skipped: "test account" });
      continue;
    }
    if (!payload.phone) {
      await claim(admin, { event: "box_shipped", dedupe_key: dedupe, family_id: familyId, student_id: payload.student_id, payload, status: "skipped", detail: "No phone number" });
      results.push({ log: row.id, skipped: "no phone" });
      continue;
    }
    const logId = await claim(admin, { event: "box_shipped", dedupe_key: dedupe, family_id: familyId, student_id: payload.student_id, payload });
    if (!logId) continue;
    const r = await deliver(admin, logId, cfg.url, payload);
    results.push({ log: row.id, sent: r.ok, status: r.status });
  }
  return { enabled: true, since, results };
}

// ---------------------------------------------------------------------------
// Test upload overdue
// ---------------------------------------------------------------------------
async function overdueScan(admin: SupabaseClient, dryRun: boolean) {
  const cfg = await eventConfig(admin, "test_upload_overdue");
  if (!cfg.enabled && !dryRun) return { enabled: false, students: [] };
  if (!cfg.url && !dryRun) return { enabled: true, error: "No webhook URL saved", students: [] };

  const liveSince = ((await settingRow(admin, "family_emails_live_since"))?.value ?? "").slice(0, 10) ||
    new Date().toISOString().slice(0, 10);
  const cutoff = new Date(Date.now() - OVERDUE_DAYS * 86400000).toISOString().slice(0, 10);

  const { data: slots } = await admin
    .from("student_pace_slots")
    .select("id, student_id, subject_id, pace_number, issued_at, subjects(name), students(student_name, family_id, families(parent_name, phone, email, is_test_account))")
    .eq("status", "issued")
    .is("score", null)
    .not("issued_at", "is", null)
    .gt("issued_at", liveSince)
    .lte("issued_at", cutoff);
  const list = slots ?? [];
  const studentIds = [...new Set(list.map((s) => s.student_id as string))];
  if (studentIds.length === 0) {
    return { enabled: cfg.enabled, dry_run: dryRun, rule: { issued_after: liveSince, issued_on_or_before: cutoff, overdue_days: OVERDUE_DAYS }, students: [] };
  }
  const cooldownSince = new Date(Date.now() - STUDENT_COOLDOWN_DAYS * 86400000).toISOString();
  const [reportsRes, enrollRes, loggedRes, recentRes] = await Promise.all([
    admin.from("score_reports").select("student_id, subject_id, pace_number, review_status").in("student_id", studentIds),
    admin.from("enrollments").select("student_id").in("student_id", studentIds).eq("status", "active"),
    admin.from("sms_webhook_log").select("dedupe_key").in("dedupe_key", list.map((s) => `overdue:${s.id}`)),
    admin
      .from("sms_webhook_log")
      .select("student_id")
      .eq("event", "test_upload_overdue")
      .eq("status", "sent")
      .eq("is_test", false)
      .gte("created_at", cooldownSince)
      .in("student_id", studentIds),
  ]);
  const reports = reportsRes.data ?? [];
  const active = new Set((enrollRes.data ?? []).map((e) => e.student_id as string));
  const logged = new Set((loggedRes.data ?? []).map((r) => r.dedupe_key as string));
  const cooling = new Set((recentRes.data ?? []).map((r) => r.student_id as string));

  type Cand = { slotId: string; pace: string; studentName: string; familyId: string; parentName: string | null; phone: string | null; email: string | null; isTest: boolean };
  const byStudent = new Map<string, Cand[]>();
  for (const slot of list) {
    if (!active.has(slot.student_id as string)) continue;
    if (logged.has(`overdue:${slot.id}`)) continue;
    const hasReport = reports.some(
      (r) =>
        r.student_id === slot.student_id &&
        r.subject_id === slot.subject_id &&
        acePace(Number(r.pace_number)) === acePace(Number(slot.pace_number)) &&
        r.review_status !== "rejected",
    );
    if (hasReport) continue;
    const student = one(slot.students as unknown as { student_name: string; family_id: string; families: unknown } | null);
    const fam = one(student?.families as { parent_name: string | null; phone: string | null; email: string | null; is_test_account: boolean } | null);
    const subject = one(slot.subjects as unknown as { name: string } | null)?.name ?? "PACE";
    const entry: Cand = {
      slotId: slot.id as string,
      pace: `${subject} PACE ${acePace(Number(slot.pace_number))}`,
      studentName: student?.student_name ?? "",
      familyId: student?.family_id ?? "",
      parentName: fam?.parent_name ?? null,
      phone: fam?.phone ?? null,
      email: fam?.email ?? null,
      isTest: !!fam?.is_test_account,
    };
    const arr = byStudent.get(slot.student_id as string) ?? [];
    arr.push(entry);
    byStudent.set(slot.student_id as string, arr);
  }

  const out: unknown[] = [];
  for (const [studentId, cands] of byStudent) {
    const first = cands[0];
    const payload = buildPayload({
      event: "test_upload_overdue",
      test: false,
      family_id: first.familyId || null,
      student_id: studentId,
      parent_name: first.parentName,
      phone: first.phone,
      email: first.email,
      student_name: first.studentName,
      paces: cands.map((c) => c.pace),
    });
    if (dryRun) {
      out.push({ student: first.studentName, paces: payload.paces, skipped: first.isTest ? "test account" : cooling.has(studentId) ? "sent in the last 7 days" : !payload.phone ? "no phone" : undefined });
      continue;
    }
    if (cooling.has(studentId)) {
      out.push({ student: first.studentName, skipped: "sent in the last 7 days" });
      continue;
    }
    if (first.isTest || !payload.phone) {
      for (const c of cands) {
        await claim(admin, { event: "test_upload_overdue", dedupe_key: `overdue:${c.slotId}`, family_id: payload.family_id, student_id: studentId, payload, status: "skipped", detail: first.isTest ? "Test account" : "No phone number", is_test: first.isTest });
      }
      out.push({ student: first.studentName, skipped: first.isTest ? "test account" : "no phone" });
      continue;
    }
    // Claim every PACE first (dedupe), then send one webhook for the student.
    let mainLog: string | null = null;
    for (const c of cands) {
      const id = await claim(admin, { event: "test_upload_overdue", dedupe_key: `overdue:${c.slotId}`, family_id: payload.family_id, student_id: studentId, payload, status: mainLog ? "skipped" : "pending", detail: mainLog ? "Included in the same text" : undefined });
      if (id && !mainLog) mainLog = id;
    }
    if (!mainLog) continue;
    const r = await deliver(admin, mainLog, cfg.url, payload);
    out.push({ student: first.studentName, paces: payload.paces, sent: r.ok, status: r.status });
  }
  return { enabled: cfg.enabled, dry_run: dryRun, rule: { issued_after: liveSince, issued_on_or_before: cutoff, overdue_days: OVERDUE_DAYS }, students: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const caller = await authorize(req);
  if (caller instanceof Response) return caller;
  let body: { action?: string; event?: string; dry_run?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const admin = service();
  try {
    if (body.action === "send_test") {
      if (caller.kind !== "admin") return json({ error: "Admin only" }, 403);
      if (body.event !== "test_upload_overdue" && body.event !== "box_shipped") return json({ error: "Unknown event" }, 400);
      return json(await sendTest(admin, body.event));
    }
    if (body.action === "shipped_scan") return json(await shippedScan(admin));
    if (body.action === "overdue_scan") {
      const dryRun = caller.kind === "admin" && body.dry_run === true;
      return json(await overdueScan(admin, dryRun));
    }
    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error("sms-webhooks failed", err);
    return json({ error: String((err as Error).message ?? err) }, 500);
  }
});
