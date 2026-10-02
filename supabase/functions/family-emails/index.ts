import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import {
  applyTemplate,
  escapeHtml,
  PORTAL_LOGIN_URL,
  renderTemplate,
  SAMPLE_TEMPLATE_VARS,
  sendResendEmail,
} from "../_shared/emailTemplates.ts";

// Round 4 family emails (Resend).
//
// Actions (POST JSON):
//   { action: "send_pending" }      cron / DB trigger. Sends queued shipment
//                                   and celebration emails from family_email_log.
//   { action: "overdue_nudges", dry_run? }
//                                   daily cron (only scheduled to run when the
//                                   switch is on). Admin may pass dry_run.
//   { action: "preview", log_id }   admin only. Re-renders a logged email and
//                                   sends it to the signed-in admin only.
//   { action: "send_test_email", subject, body_html }
//                                   admin only. Template editor test send with
//                                   sample values, to the signed-in admin only.
//
// Auth: admin JWT, or x-cron-secret (CRON_SECRET env or Vault mca_cron_secret).
// Test accounts (families.is_test_account) never get these emails.
//
// Round 10 (MCA_R10_CELEBRATION_EMAIL): kind "celebration" rows are queued by
// the student_pace_slots trigger mca_detect_celebrations when a student
// finishes a level or a school year through an uploaded test. Switch:
// app_settings.email_celebration_enabled (default on).
//
// OVERDUE RULE (conservative, MCA_R4_OVERDUE_RULE): a PACE is overdue when
//   - its slot status is "issued" (handed to the student) with no score and no
//     linked score report,
//   - issued_at is 28 or more days ago,
//   - issued_at is AFTER the go-live date (app_settings.family_emails_live_since),
//     so nothing from before this feature shipped is ever nudged,
//   - no score report (other than a rejected one) exists for that student,
//     subject and PACE number,
//   - the student has an active enrollment and the family is not a test account.
// Each PACE is nudged at most once (family_email_log dedupe key per slot) and a
// family gets at most one nudge email per 7 days (all overdue PACEs together).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const OVERDUE_DAYS = 28;
const FAMILY_COOLDOWN_DAYS = 7;
const MAX_ATTEMPTS = 3;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

async function setting(admin: SupabaseClient, key: string, fallback: string): Promise<string> {
  const { data } = await admin.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data?.value as string | undefined) ?? fallback;
}

function firstName(name: string | null | undefined): string {
  const first = (name ?? "").replace(/\(.*?\)/g, "").trim().split(/\s+/)[0];
  return first || "there";
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
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

const SHIPMENT_FALLBACK = {
  subject: "Your Midwest Christian Academy shipment is on the way",
  html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <h2>Your shipment is on the way</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>Good news! We just shipped {{shipment_label}}. Here's what's in the box:</p>
  {{shipment_items}}
  {{tracking_line}}
  <p>When PACEs arrive, sign in to the Parent Portal, open <strong>PACE Status</strong>, and click <strong>Receive All</strong> so we know they made it: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If anything is missing or damaged, just reply to this email or call (844) 663-4477.</p>
  <p>Midwest Christian Academy</p>
</div>`,
};

const OVERDUE_FALLBACK = {
  subject: "A quick reminder: PACE tests to upload",
  html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Hi {{parent_first_name}},</p>
  <p>Our records show these PACEs were handed out a few weeks ago, but we haven't received the test scores yet:</p>
  {{overdue_list}}
  <p>When the tests are done, please upload a photo of each one in the Parent Portal under <strong>Upload Tests</strong>: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>If you've already sent them, or your student is still working, thank you! You can ignore this note.</p>
  <p>Midwest Christian Academy · (844) 663-4477</p>
</div>`,
};

const CELEBRATION_FALLBACK = {
  subject: "Congratulations, {{student_name}}! {{celebration_title}}",
  html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p style="font-size: 40px; margin: 0;">&#127881;</p>
  <h2 style="margin-top: 8px;">Congratulations, {{student_name}}!</h2>
  <p>Hi {{parent_first_name}},</p>
  <p>We just recorded a big milestone: <strong>{{student_name}} {{celebration_line}}</strong>. That takes steady, faithful work, and we're proud of you both.</p>
  <p>Sign in to the Parent Portal to see the celebration and what's next: <a href="{{portal_url}}">{{portal_url}}</a></p>
  <p>"Whatever you do, work at it with all your heart." Colossians 3:23</p>
  <p>Midwest Christian Academy · (844) 663-4477</p>
</div>`,
};

type LogRow = {
  id: string;
  kind: string;
  celebration_id?: string | null;
  family_id: string | null;
  student_id: string | null;
  order_id: string | null;
  pick_list_id: string | null;
  to_email: string | null;
  status: string;
  attempts: number;
};

async function renderShipment(admin: SupabaseClient, row: LogRow) {
  let parentName: string | null = null;
  let studentName: string | null = null;
  let items: string[] = [];
  let trackingNumber: string | null = null;
  let trackingUrl: string | null = null;
  let label = "your order";

  if (row.pick_list_id) {
    const { data: pick } = await admin
      .from("pick_lists")
      .select(
        "id, tracking_number, tracking_url, students(student_name, families(parent_name)), pick_list_items(pace_number, pace_slot_id, items(original_name), subjects(name))",
      )
      .eq("id", row.pick_list_id)
      .maybeSingle();
    const student = one(pick?.students as unknown as { student_name: string; families: unknown } | null);
    studentName = student?.student_name ?? null;
    parentName = one(student?.families as unknown as { parent_name: string } | null)?.parent_name ?? null;
    trackingNumber = (pick?.tracking_number as string | null) ?? null;
    trackingUrl = (pick?.tracking_url as string | null) ?? null;
    const lines = (pick?.pick_list_items ?? []) as unknown as Array<{
      pace_number: number | null;
      pace_slot_id: string | null;
      items: { original_name: string | null } | null;
      subjects: { name: string } | null;
    }>;
    items = lines
      .sort((a, b) => (one(a.subjects)?.name ?? "").localeCompare(one(b.subjects)?.name ?? "") || (a.pace_number ?? 0) - (b.pace_number ?? 0))
      .map((line) => {
        const subject = one(line.subjects)?.name ?? "";
        if (line.pace_slot_id && line.pace_number != null) return `${subject} PACE ${acePace(line.pace_number)}`;
        return one(line.items)?.original_name ?? `${subject} item`;
      });
    label = studentName ? `${studentName}'s PACEs` : "your student's PACEs";
  } else if (row.order_id) {
    const { data: order } = await admin
      .from("orders")
      .select("id, customer_name, tracking_number, tracking_url, families(parent_name), order_items(quantity, items(original_name))")
      .eq("id", row.order_id)
      .maybeSingle();
    parentName = one(order?.families as unknown as { parent_name: string } | null)?.parent_name ?? (order?.customer_name as string | null) ?? null;
    trackingNumber = (order?.tracking_number as string | null) ?? null;
    trackingUrl = (order?.tracking_url as string | null) ?? null;
    items = ((order?.order_items ?? []) as unknown as Array<{ quantity: number; items: { original_name: string | null } | null }>).map(
      (line) => `${one(line.items)?.original_name ?? "Item"} × ${line.quantity}`,
    );
    label = "your store order";
  }

  const link = trackingLink(trackingNumber, trackingUrl);
  const trackingLine = trackingNumber || link
    ? `<p><strong>Tracking:</strong> ${
      link ? `<a href="${escapeHtml(link)}">${escapeHtml(trackingNumber || "Track your package")}</a>` : escapeHtml(trackingNumber ?? "")
    }</p>`
    : "";
  const vars = {
    parent_first_name: firstName(parentName),
    student_name: studentName ?? "your student",
    shipment_label: label,
    shipment_items: items.length
      ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
      : "",
    tracking_line: trackingLine,
    tracking_number: trackingNumber ?? "",
    tracking_url: link ?? "",
    portal_url: PORTAL_LOGIN_URL,
  };
  return await renderTemplate(admin as never, "shipment_notice", vars, SHIPMENT_FALLBACK);
}

async function renderCelebration(admin: SupabaseClient, row: LogRow) {
  const { data: cel } = await admin
    .from("student_celebrations")
    .select("id, kind, title, level, school_year, subjects(name), students(student_name, families(parent_name))")
    .eq("id", row.celebration_id ?? "")
    .maybeSingle();
  const student = one(cel?.students as unknown as { student_name: string; families: unknown } | null);
  const parentName = one(student?.families as unknown as { parent_name: string } | null)?.parent_name ?? null;
  const studentName = student?.student_name ?? "your student";
  const subject = one(cel?.subjects as unknown as { name: string } | null)?.name ?? null;
  const title = (cel?.title as string | undefined) ?? "Finished a milestone";
  let line = "reached a new milestone";
  if (cel?.kind === "school_year") line = `finished the ${cel.school_year} school year`;
  else if (cel?.kind === "level") {
    line = title.replace(/^Finished\s+/i, "finished ");
    if (!subject) line = "finished a PACE level";
  }
  return await renderTemplate(admin as never, "celebration", {
    parent_first_name: firstName(parentName),
    student_name: studentName,
    celebration_title: title,
    celebration_line: line,
    portal_url: PORTAL_LOGIN_URL,
  }, CELEBRATION_FALLBACK);
}

async function sendPending(admin: SupabaseClient) {
  const shippingOn = (await setting(admin, "email_shipping_enabled", "true")) === "true";
  const celebrationOn = (await setting(admin, "email_celebration_enabled", "true")) === "true";
  const { data: rows, error } = await admin
    .from("family_email_log")
    .select("id, kind, family_id, student_id, order_id, pick_list_id, to_email, status, attempts, celebration_id")
    .in("kind", ["shipment", "celebration"])
    .or(`status.eq.pending,and(status.eq.failed,attempts.lt.${MAX_ATTEMPTS})`)
    .order("created_at")
    .limit(50);
  if (error) throw error;
  const results: unknown[] = [];
  for (const row of (rows ?? []) as LogRow[]) {
    // claim the row atomically so the trigger kick and the backstop cron never double-send
    const { data: claimed } = await admin
      .from("family_email_log")
      .update({ status: "sending", attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("status", row.status)
      .select("id")
      .maybeSingle();
    if (!claimed) continue;
    const enabled = row.kind === "celebration" ? celebrationOn : shippingOn;
    if (!enabled) {
      await admin.from("family_email_log").update({
        status: "skipped",
        detail: row.kind === "celebration" ? "Celebration emails are turned off" : "Shipping emails are turned off",
      }).eq("id", row.id);
      results.push({ id: row.id, skipped: "disabled" });
      continue;
    }
    if (row.family_id) {
      const { data: fam } = await admin.from("families").select("is_test_account").eq("id", row.family_id).maybeSingle();
      if (fam?.is_test_account) {
        await admin.from("family_email_log").update({ status: "skipped", detail: "Test account" }).eq("id", row.id);
        results.push({ id: row.id, skipped: "test account" });
        continue;
      }
    }
    if (!row.to_email) {
      await admin.from("family_email_log").update({ status: "skipped", detail: "No parent email" }).eq("id", row.id);
      continue;
    }
    try {
      const rendered = row.kind === "celebration" ? await renderCelebration(admin, row) : await renderShipment(admin, row);
      const sent = await sendResendEmail({ to: row.to_email, subject: rendered.subject, html: rendered.html });
      await admin
        .from("family_email_log")
        .update(sent
          ? { status: "sent", sent_at: new Date().toISOString(), detail: null }
          : { status: "failed", detail: "Resend did not accept the email" })
        .eq("id", row.id);
      results.push({ id: row.id, sent });
    } catch (err) {
      await admin.from("family_email_log").update({ status: "failed", detail: String(err).slice(0, 500) }).eq("id", row.id);
      results.push({ id: row.id, error: String(err) });
    }
  }
  return { processed: results.length, results };
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

type OverdueCandidate = {
  slot_id: string;
  student_id: string;
  student_name: string;
  family_id: string;
  email: string | null;
  parent_name: string | null;
  is_test: boolean;
  subject: string;
  pace: number;
  issued_at: string;
};

async function findOverdue(admin: SupabaseClient) {
  const sinceRaw = await setting(admin, "family_emails_live_since", new Date().toISOString());
  const sinceDate = sinceRaw.slice(0, 10);
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - OVERDUE_DAYS);
  const cutoffDate = isoDate(cutoff);

  const { data: slots, error } = await admin
    .from("student_pace_slots")
    .select(
      "id, student_id, subject_id, pace_number, issued_at, subjects(name), students(student_name, family_id, families(email, parent_name, is_test_account))",
    )
    .eq("status", "issued")
    .is("score", null)
    .is("score_report_id", null)
    .gt("issued_at", sinceDate)
    .lte("issued_at", cutoffDate);
  if (error) throw error;
  if (!slots || slots.length === 0) return { sinceDate, cutoffDate, candidates: [] as OverdueCandidate[] };

  const studentIds = [...new Set(slots.map((s) => s.student_id as string))];
  const [{ data: reports }, { data: enrolls }, { data: logged }] = await Promise.all([
    admin.from("score_reports").select("student_id, subject_id, pace_number, review_status").in("student_id", studentIds),
    admin.from("enrollments").select("student_id").in("student_id", studentIds).eq("status", "active"),
    admin.from("family_email_log").select("pace_slot_id").in("pace_slot_id", slots.map((s) => s.id as string)),
  ]);
  const reported = new Set(
    (reports ?? [])
      .filter((r) => r.review_status !== "rejected")
      .flatMap((r) => [
        `${r.student_id}|${r.subject_id}|${r.pace_number}`,
        `${r.student_id}|${r.subject_id}|${acePace(Number(r.pace_number))}`,
      ]),
  );
  const active = new Set((enrolls ?? []).map((e) => e.student_id as string));
  const already = new Set((logged ?? []).map((l) => l.pace_slot_id as string));

  const candidates: OverdueCandidate[] = [];
  for (const slot of slots) {
    if (already.has(slot.id as string)) continue;
    if (!active.has(slot.student_id as string)) continue;
    const pace = Number(slot.pace_number);
    if (
      reported.has(`${slot.student_id}|${slot.subject_id}|${pace}`) ||
      reported.has(`${slot.student_id}|${slot.subject_id}|${acePace(pace)}`)
    ) continue;
    const student = one(slot.students as unknown as { student_name: string; family_id: string; families: unknown } | null);
    if (!student) continue;
    const fam = one(student.families as unknown as { email: string | null; parent_name: string | null; is_test_account: boolean } | null);
    candidates.push({
      slot_id: slot.id as string,
      student_id: slot.student_id as string,
      student_name: student.student_name,
      family_id: student.family_id,
      email: fam?.email ?? null,
      parent_name: fam?.parent_name ?? null,
      is_test: !!fam?.is_test_account,
      subject: one(slot.subjects as unknown as { name: string } | null)?.name ?? "Subject",
      pace,
      issued_at: slot.issued_at as string,
    });
  }
  return { sinceDate, cutoffDate, candidates };
}

async function overdueNudges(admin: SupabaseClient, dryRun: boolean) {
  const enabled = (await setting(admin, "email_overdue_nudge_enabled", "false")) === "true";
  const { sinceDate, cutoffDate, candidates } = await findOverdue(admin);
  const byFamily = new Map<string, OverdueCandidate[]>();
  for (const c of candidates) {
    const list = byFamily.get(c.family_id) ?? [];
    list.push(c);
    byFamily.set(c.family_id, list);
  }
  const cooldown = new Date(Date.now() - FAMILY_COOLDOWN_DAYS * 86400000).toISOString();
  const results: unknown[] = [];
  for (const [familyId, list] of byFamily) {
    const first = list[0];
    const summary = {
      family_id: familyId,
      paces: list.map((c) => `${c.student_name}: ${c.subject} ${acePace(c.pace)} (issued ${c.issued_at})`),
    };
    if (first.is_test) {
      if (!dryRun) {
        await admin.from("family_email_log").upsert(
          list.map((c) => ({
            kind: "overdue_test",
            dedupe_key: `overdue:${c.slot_id}`,
            family_id: familyId,
            student_id: c.student_id,
            pace_slot_id: c.slot_id,
            to_email: c.email,
            status: "skipped",
            detail: "Test account",
          })),
          { onConflict: "dedupe_key", ignoreDuplicates: true },
        );
      }
      results.push({ ...summary, skipped: "test account" });
      continue;
    }
    if (!first.email) {
      results.push({ ...summary, skipped: "no parent email" });
      continue;
    }
    const { count } = await admin
      .from("family_email_log")
      .select("id", { count: "exact", head: true })
      .eq("family_id", familyId)
      .eq("kind", "overdue_test")
      .eq("status", "sent")
      .gte("sent_at", cooldown);
    if ((count ?? 0) > 0) {
      results.push({ ...summary, skipped: "family already nudged in the last 7 days" });
      continue;
    }
    if (dryRun || !enabled) {
      results.push({ ...summary, would_send_to: first.email, sent: false, reason: dryRun ? "dry run" : "switch is off" });
      continue;
    }
    const studentNames = [...new Set(list.map((c) => c.student_name))].join(" and ");
    const overdueList = `<ul>${list
      .sort((a, b) => a.student_name.localeCompare(b.student_name) || a.subject.localeCompare(b.subject) || a.pace - b.pace)
      .map((c) => {
        const handed = new Date(`${c.issued_at}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
        return `<li>${escapeHtml(c.student_name)}: ${escapeHtml(c.subject)} PACE ${acePace(c.pace)} (handed out ${handed})</li>`;
      })
      .join("")}</ul>`;
    // record first (dedupe), then send, so a crash can never send twice
    const batchId = crypto.randomUUID();
    const { data: inserted, error: insErr } = await admin
      .from("family_email_log")
      .upsert(
        list.map((c) => ({
          kind: "overdue_test",
          dedupe_key: `overdue:${c.slot_id}`,
          family_id: familyId,
          student_id: c.student_id,
          pace_slot_id: c.slot_id,
          to_email: first.email,
          status: "sending",
          batch_id: batchId,
          attempts: 1,
        })),
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id");
    if (insErr) throw insErr;
    if (!inserted || inserted.length === 0) continue;
    const rendered = await renderTemplate(admin as never, "overdue_test_nudge", {
      parent_first_name: firstName(first.parent_name),
      student_names: studentNames,
      overdue_list: overdueList,
      portal_url: PORTAL_LOGIN_URL,
    }, OVERDUE_FALLBACK);
    const sent = await sendResendEmail({ to: first.email, subject: rendered.subject, html: rendered.html });
    await admin
      .from("family_email_log")
      .update(sent
        ? { status: "sent", sent_at: new Date().toISOString() }
        : { status: "failed", detail: "Resend did not accept the email" })
      .eq("batch_id", batchId);
    results.push({ ...summary, sent });
  }
  return { enabled, dry_run: dryRun, rule: { issued_after: sinceDate, issued_on_or_before: cutoffDate, overdue_days: OVERDUE_DAYS }, families: results };
}

async function renderOverduePreview(admin: SupabaseClient, row: LogRow) {
  const { data: rows } = await admin
    .from("family_email_log")
    .select("pace_slot_id, student_pace_slots(pace_number, issued_at, subjects(name), students(student_name, families(parent_name)))")
    .eq("kind", "overdue_test")
    .eq("family_id", row.family_id);
  const list = (rows ?? []).map((r) => {
    const slot = one(r.student_pace_slots as unknown as { pace_number: number; issued_at: string; subjects: unknown; students: unknown } | null);
    const student = one(slot?.students as unknown as { student_name: string; families: unknown } | null);
    return {
      student: student?.student_name ?? "Student",
      parent: one(student?.families as unknown as { parent_name: string } | null)?.parent_name ?? null,
      subject: one(slot?.subjects as unknown as { name: string } | null)?.name ?? "Subject",
      pace: Number(slot?.pace_number ?? 0),
    };
  });
  return await renderTemplate(admin as never, "overdue_test_nudge", {
    parent_first_name: firstName(list[0]?.parent ?? null),
    student_names: [...new Set(list.map((l) => l.student))].join(" and "),
    overdue_list: `<ul>${list.map((l) => `<li>${escapeHtml(l.student)}: ${escapeHtml(l.subject)} PACE ${acePace(l.pace)}</li>`).join("")}</ul>`,
    portal_url: PORTAL_LOGIN_URL,
  }, OVERDUE_FALLBACK);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const caller = await authorize(req);
    if (caller instanceof Response) return caller;
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const admin = service();

    if (body.action === "send_pending") return json(await sendPending(admin));

    if (body.action === "overdue_nudges") {
      const dryRun = caller.kind === "admin" ? body.dry_run !== false : body.dry_run === true;
      return json(await overdueNudges(admin, dryRun));
    }

    if (caller.kind !== "admin") return json({ error: "Admin only" }, 403);
    if (!caller.email) return json({ error: "This admin account has no email." }, 400);

    if (body.action === "send_test_email") {
      const subject = applyTemplate(String(body.subject ?? ""), SAMPLE_TEMPLATE_VARS);
      const html = applyTemplate(String(body.body_html ?? ""), SAMPLE_TEMPLATE_VARS);
      if (!subject || !html) return json({ error: "Subject and body are required." }, 400);
      const sent = await sendResendEmail({ to: caller.email, subject, html });
      return json({ sent, to: caller.email });
    }

    if (body.action === "preview") {
      const { data: row } = await admin
        .from("family_email_log")
        .select("id, kind, family_id, student_id, order_id, pick_list_id, to_email, status, attempts, celebration_id")
        .eq("id", String(body.log_id ?? ""))
        .maybeSingle();
      if (!row) return json({ error: "Log row not found" }, 404);
      const rendered = row.kind === "shipment"
        ? await renderShipment(admin, row as LogRow)
        : row.kind === "celebration"
        ? await renderCelebration(admin, row as LogRow)
        : await renderOverduePreview(admin, row as LogRow);
      const sent = await sendResendEmail({
        to: caller.email,
        subject: `[Copy] ${rendered.subject}`,
        html: rendered.html,
      });
      return json({ sent, to: caller.email, subject: rendered.subject });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});
