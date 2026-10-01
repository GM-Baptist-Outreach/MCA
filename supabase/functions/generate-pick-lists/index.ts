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

// Cron-ready and admin-callable.
// One week before a student's next_ship_date, build a pick list of the next
// 3 unissued PACEs in each logged subject. If the 6 most recently issued
// slots across subjects lack scores, set shipment_paused, pick list status
// paused, and the reminder flag. Email the parent when RESEND_API_KEY is set
// (otherwise log only).
//
// Auth: admin JWT, or header x-cron-secret matching CRON_SECRET.
// verify_jwt is disabled so the cron secret can call this without a user JWT.
//
// Schedule (Supabase cron or any daily runner), after migrations are applied:
//   POST /functions/v1/generate-pick-lists
//   x-cron-secret: $CRON_SECRET
//   {}
// Admin may pass { "student_id", "school_year", "force": true } to generate
// even when the ship date is outside the 7-day window.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const QUARTER_SHIP_COUNT = 3;
const SCORE_LOOKBACK = 6;
// MCA_R3_F1_NO_RESHIP: only never-shipped slots are picked. Slots already on
// THIS pick list (ordered / in_stock) are kept so a forced rebuild is stable.
const ALREADY_ON_LIST = new Set(["ordered", "in_stock"]);
const ISSUED = new Set(["issued", "passed", "failed"]);

interface CatalogItem {
  id: string;
  subject_id: string | null;
  item_type: string;
  range_start: number | null;
  range_end: number | null;
  subject_name: string;
  original_name: string;
  sales_price: number;
}

interface CompanionLine extends CatalogItem {
  pace_number: number;
}

function matchPickCompanions(slots: SlotRow[], catalog: CatalogItem[]): CompanionLine[] {
  const paceItemIds = new Set(
    slots.map((slot) => slot.item_id).filter((id): id is string => !!id),
  );
  const matches = new Map<string, CompanionLine>();
  for (const slot of slots) {
    for (const item of catalog) {
      if (paceItemIds.has(item.id)) continue;
      if (item.item_type !== "key") continue;
      if (item.subject_id == null || item.subject_id !== slot.subject_id) continue;
      if (item.range_start == null || item.range_end == null) continue;
      if (slot.pace_number < item.range_start || slot.pace_number > item.range_end) continue;
      const existing = matches.get(item.id);
      if (existing) {
        existing.pace_number = Math.min(existing.pace_number, slot.pace_number);
        continue;
      }
      matches.set(item.id, { ...item, pace_number: slot.pace_number });
    }
  }
  return [...matches.values()];
}

function matchResourceBooks(slots: SlotRow[], catalog: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>();
  const matches: CatalogItem[] = [];
  for (const slot of slots) {
    for (const item of catalog) {
      if (seen.has(item.id)) continue;
      if (item.item_type !== "other") continue;
      if (item.subject_id == null || item.subject_id !== slot.subject_id) continue;
      if (item.range_start == null || item.range_end == null) continue;
      if (slot.pace_number < item.range_start || slot.pace_number > item.range_end) continue;
      seen.add(item.id);
      matches.push(item);
    }
  }
  return matches;
}

const SUBJECT_RANK: Record<string, number> = {
  Math: 0,
  English: 10,
  "Word Building": 20,
  Science: 30,
  "Social Studies": 40,
};

function subjectRank(name: string): number {
  if (SUBJECT_RANK[name] != null) return SUBJECT_RANK[name];
  if (/\bword building\b/i.test(name)) return 21;
  if (/\b(english|literature)\b|\blit\b|creative writing/i.test(name)) return 11;
  if (/\b(social studies|history|government|economics|geography|civics)\b/i.test(name)) return 41;
  if (/\b(science|biology|chemistry|physics)\b/i.test(name)) return 31;
  if (/\b(math|algebra|geometry)\b/i.test(name)) return 1;
  return 50;
}

function catalogSubjectName(
  rel: { name: string } | { name: string }[] | null,
): string {
  if (Array.isArray(rel)) return rel[0]?.name ?? "";
  return rel?.name ?? "";
}

interface SlotRow {
  id: string;
  student_id: string;
  subject_id: string;
  slot_index: number;
  pace_number: number;
  item_id: string | null;
  status: string;
  score: number | null;
  issued_at: string | null;
  subjects: { name: string } | { name: string }[] | null;
}

function subjectName(slot: SlotRow): string {
  const rel = slot.subjects;
  if (Array.isArray(rel)) return rel[0]?.name ?? "Subject";
  return rel?.name ?? "Subject";
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextQuarter(
  slots: SlotRow[],
  onThisList: Set<string> = new Set(),
  annual = false,
): SlotRow[] {
  const bySubject = new Map<string, SlotRow[]>();
  for (const slot of slots) {
    const list = bySubject.get(slot.subject_id) ?? [];
    list.push(slot);
    bySubject.set(slot.subject_id, list);
  }
  const groups = [...bySubject.values()].sort((a, b) =>
    subjectRank(subjectName(a[0])) - subjectRank(subjectName(b[0])) ||
    subjectName(a[0]).localeCompare(subjectName(b[0]))
  );
  const picked: SlotRow[] = [];
  for (const list of groups) {
    const unissued = list
      .filter(
        (slot) =>
          slot.status === "prescribed" ||
          (ALREADY_ON_LIST.has(slot.status) && onThisList.has(slot.id)),
      )
      .sort((a, b) => a.slot_index - b.slot_index);
    // MCA_R3_A5_ANNUAL_SHIP: annual mode ships every unshipped PACE at once.
    picked.push(...(annual ? unissued : unissued.slice(0, QUARTER_SHIP_COUNT)));
  }
  return picked;
}

/** Six most recently issued slots across subjects that have no score. */
function missingScores(slots: SlotRow[]): SlotRow[] {
  const issued = slots
    .filter((slot) => ISSUED.has(slot.status) || slot.issued_at != null)
    .sort((a, b) => {
      const da = a.issued_at ?? "";
      const db = b.issued_at ?? "";
      if (da !== db) return db.localeCompare(da);
      return b.slot_index - a.slot_index;
    });
  if (issued.length < SCORE_LOOKBACK) return [];
  return issued.slice(0, SCORE_LOOKBACK).filter((slot) => slot.score == null);
}

async function assertAdminOrCron(
  req: Request,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret && headerSecret === cronSecret) return { ok: true };
  if (headerSecret) {
    // pg_cron jobs read the same secret from Vault (mca_cron_secret), so the
    // function accepts it even when the CRON_SECRET env var is not set.
    const service = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: vaultSecret } = await service.rpc("mca_get_cron_secret");
    if (typeof vaultSecret === "string" && vaultSecret && headerSecret === vaultSecret) {
      return { ok: true };
    }
    return { ok: false, response: json({ error: "Unauthorized" }, 401) };
  }

  const auth = req.headers.get("Authorization");
  if (!auth) {
    return {
      ok: false,
      response: json({ error: "Unauthorized" }, 401),
    };
  }
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await userClient.rpc("is_admin");
  if (error || !data) return { ok: false, response: json({ error: "Admin only" }, 403) };
  return { ok: true };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const SCORES_NEEDED_FALLBACK = {
  subject: "Scores needed before the next PACE shipment for {{student_name}}",
  html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Hello,</p>
  <p>Before MCA can ship the next PACEs for {{student_name}}, we need scores for these already-issued PACEs:</p>
  {{missing_scores}}
  <p>Please submit them in the parent portal (Upload Tests) or call us at (844) 663-4477.</p>
  <p>ACE remains the official grade record. This reminder is only about the shipment.</p>
  <p>Midwest Christian Academy</p>
</div>`,
};

const BOOK_NEEDED_FALLBACK = {
  subject: "Books needed for {{student_name}}",
  html: `<div style="font-family: Georgia, serif; color: #1a1a2e; max-width: 600px;">
  <p>Your student will need these books for upcoming PACEs:</p>
  {{book_list}}
  <p><a href="{{store_url}}">Buy in the MCA store</a></p>
</div>`,
};

function acePace(pace: number): number {
  return pace > 1000 ? pace : pace + 1000;
}

async function sendReminder(
  admin: SupabaseClient,
  input: {
    to: string;
    studentName: string;
    missing: Array<{ subject: string; pace: number }>;
  },
): Promise<{ emailed: boolean }> {
  const missingScores = `<ul>${input.missing
    .map((row) => `<li>${row.subject} PACE ${acePace(row.pace)}</li>`)
    .join("")}</ul>`;
  const rendered = await renderTemplate(admin, "scores_needed_reminder", {
    student_name: input.studentName,
    missing_scores: missingScores,
    portal_url: PORTAL_LOGIN_URL,
  }, SCORES_NEEDED_FALLBACK);
  const emailed = await sendResendEmail({
    to: input.to,
    subject: rendered.subject,
    html: rendered.html,
  });
  if (!emailed) {
    console.log("[generate-pick-lists] reminder logged only", {
      to: input.to,
      studentName: input.studentName,
    });
  }
  return { emailed };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await assertAdminOrCron(req);
    if (!auth.ok) return auth.response;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    if (body.action === "send_test_email") {
      const header = req.headers.get("Authorization");
      if (!header) return json({ error: "Unauthorized" }, 401);
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: header } } },
      );
      const { data: adminFlag, error: adminError } = await userClient.rpc("is_admin");
      if (adminError || !adminFlag) return json({ error: "Admin only" }, 403);
      const { data: userData } = await userClient.auth.getUser();
      const to = userData.user?.email;
      if (!to) return json({ error: "This admin account has no email." }, 400);
      const subject = applyTemplate(String(body.subject ?? ""), SAMPLE_TEMPLATE_VARS);
      const html = applyTemplate(String(body.body_html ?? ""), SAMPLE_TEMPLATE_VARS);
      if (!subject || !html) return json({ error: "Subject and body are required." }, 400);
      const sent = await sendResendEmail({ to, subject, html });
      return json({ sent, to });
    }
    if (body.action === "notify_resource_books") {
      const service = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const result = await notifyPendingResourceBooks(service, {
        studentId: typeof body.student_id === "string" ? body.student_id : undefined,
      });
      return json(result);
    }
    const onlyStudent: string | undefined = body.student_id;
    const schoolYear: string | undefined = body.school_year;
    const force = body.force === true;
    const today = isoToday();

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let scheduleQuery = admin
      .from("student_ship_schedules")
      .select(
        "id, student_id, school_year, mode, q1_ship_date, q2_ship_date, q3_ship_date, q4_ship_date, next_ship_date, shipment_paused",
      );
    if (onlyStudent) scheduleQuery = scheduleQuery.eq("student_id", onlyStudent);
    if (schoolYear) scheduleQuery = scheduleQuery.eq("school_year", schoolYear);

    const { data: schedules, error: scheduleError } = await scheduleQuery;
    if (scheduleError) throw scheduleError;

    const results: unknown[] = [];
    for (const schedule of schedules ?? []) {
      const shipDate = schedule.next_ship_date as string | null;
      if (!shipDate) {
        results.push({ student_id: schedule.student_id, skipped: "no next_ship_date" });
        continue;
      }
      const due = shipDate >= today && shipDate <= addDays(today, 7);
      // An overdue ship date (e.g. a start date set in the past) is still
      // picked up, but only while that cycle has no pick list yet.
      const overdue = shipDate < today;
      if (!due && !overdue && !force) {
        results.push({ student_id: schedule.student_id, skipped: "outside 7-day window", shipDate });
        continue;
      }

      const { data: existing } = await admin
        .from("pick_lists")
        .select("id, status, paused_for_missing_scores, reminder_email_sent_at")
        .eq("student_id", schedule.student_id)
        .eq("school_year", schedule.school_year)
        .eq("ship_date", shipDate)
        .maybeSingle();
      // A ready/shipped list is final unless staff forces a rebuild.
      // A paused list is rechecked so the shipment can proceed once scores exist.
      if (existing && overdue && !due && !force) {
        results.push({
          student_id: schedule.student_id,
          skipped: "overdue cycle already has a pick list",
          pick_list_id: existing.id,
          status: existing.status,
        });
        continue;
      }
      if (existing && existing.status !== "paused" && !force) {
        results.push({
          student_id: schedule.student_id,
          skipped: "pick list already exists",
          pick_list_id: existing.id,
          status: existing.status,
        });
        continue;
      }

      const outcome = await buildForSchedule(admin, schedule, shipDate, today, {
        reminderEmailSentAt: existing?.reminder_email_sent_at ?? null,
        existingPickListId: existing?.id ?? null,
      });
      results.push(outcome);
    }

    return json({ today, results });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});

async function buildForSchedule(
  admin: SupabaseClient,
  schedule: {
    id: string;
    student_id: string;
    school_year: string;
    mode: string;
    q1_ship_date: string | null;
    q2_ship_date: string | null;
    q3_ship_date: string | null;
    q4_ship_date: string | null;
    next_ship_date: string | null;
  },
  shipDate: string,
  today: string,
  options: { reminderEmailSentAt: string | null; existingPickListId?: string | null },
) {
  const { data: student } = await admin
    .from("students")
    .select("id, student_name, family_id, families(email, parent_name)")
    .eq("id", schedule.student_id)
    .single();

  const { data: slotRows, error: slotError } = await admin
    .from("student_pace_slots")
    .select(
      "id, student_id, subject_id, slot_index, pace_number, item_id, status, score, issued_at, subjects(name)",
    )
    .eq("student_id", schedule.student_id)
    .eq("school_year", schedule.school_year);
  if (slotError) throw slotError;

  const slots = (slotRows ?? []) as SlotRow[];
  // PACEs already recorded at home in PACE Status (handed out by hand, or
  // marked by the parent) are not shipped again, even if the slot still
  // says prescribed.
  const { data: atHomeRows, error: atHomeError } = await admin
    .from("pace_status")
    .select("item_id")
    .eq("student_id", schedule.student_id);
  if (atHomeError) throw atHomeError;
  const atHome = new Set((atHomeRows ?? []).map((row) => row.item_id as string));
  const shippable = slots.filter(
    (slot) => !(slot.status === "prescribed" && slot.item_id && atHome.has(slot.item_id)),
  );
  const annual = schedule.mode === "annual";
  const onThisList = new Set<string>();
  if (options.existingPickListId) {
    const { data: existingLines } = await admin
      .from("pick_list_items")
      .select("pace_slot_id")
      .eq("pick_list_id", options.existingPickListId);
    for (const line of existingLines ?? []) {
      if (line.pace_slot_id) onThisList.add(line.pace_slot_id as string);
    }
  }
  // Annual Ship has no later shipment to hold back, so the score gate is skipped.
  const missing = annual ? [] : missingScores(slots);
  const quarter = nextQuarter(shippable, onThisList, annual);

  const familyRel = student?.families as
    | { email: string; parent_name: string }
    | { email: string; parent_name: string }[]
    | null;
  const family = Array.isArray(familyRel) ? familyRel[0] : familyRel;
  const email = family?.email ?? null;

  if (missing.length > 0) {
    const note =
      `Paused: ${missing.length} of the ${SCORE_LOOKBACK} most recently issued PACEs across subjects have no score.`;
    let emailed = false;
    if (options.reminderEmailSentAt) {
      console.log("[generate-pick-lists] reminder already sent; still paused", {
        student_id: schedule.student_id,
      });
    } else if (email) {
      const sent = await sendReminder(admin, {
        to: email,
        studentName: student?.student_name ?? "your student",
        missing: missing.map((slot) => ({
          subject: subjectName(slot),
          pace: slot.pace_number,
        })),
      });
      emailed = sent.emailed;
    } else {
      console.log("[generate-pick-lists] no parent email; reminder logged only", {
        student_id: schedule.student_id,
        missing: missing.map((slot) => slot.pace_number),
      });
    }

    const { data: pick, error: pickError } = await admin
      .from("pick_lists")
      .upsert(
        {
          student_id: schedule.student_id,
          school_year: schedule.school_year,
          ship_date: shipDate,
          status: "paused",
          paused_for_missing_scores: true,
          reminder_email_sent_at: emailed
            ? new Date().toISOString()
            : options.reminderEmailSentAt,
          notes: note,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,school_year,ship_date" },
      )
      .select("id")
      .single();
    if (pickError) throw pickError;

    await admin
      .from("student_ship_schedules")
      .update({
        shipment_paused: true,
        pause_reason: note,
        updated_at: new Date().toISOString(),
      })
      .eq("id", schedule.id);

    return {
      student_id: schedule.student_id,
      pick_list_id: pick?.id,
      status: "paused",
      emailed,
      reminder_logged: !emailed,
      missing: missing.length,
    };
  }

  if (quarter.length === 0) {
    return { student_id: schedule.student_id, skipped: "no unshipped PACEs" };
  }

  const { data: catalogRows, error: catalogError } = await admin
    .from("items")
    .select("id, subject_id, item_type, range_start, range_end, original_name, sales_price, subjects(name)")
    .in("item_type", ["key", "other"])
    .eq("active", true);
  if (catalogError) throw catalogError;
  const catalog: CatalogItem[] = (catalogRows ?? []).map((row) => ({
    id: row.id,
    subject_id: row.subject_id,
    item_type: row.item_type,
    range_start: row.range_start,
    range_end: row.range_end,
    subject_name: catalogSubjectName(
      row.subjects as { name: string } | { name: string }[] | null,
    ),
    original_name: row.original_name ?? "Book",
    sales_price: Number(row.sales_price ?? 0),
  }));
  const companions = matchPickCompanions(quarter, catalog);
  const resourceBooks = matchResourceBooks(quarter, catalog);

  const itemIds = [
    ...quarter.map((slot) => slot.item_id),
    ...companions.map((item) => item.id),
  ].filter((id): id is string => !!id);
  const onHand = new Map<string, number>();
  const tracked = new Set<string>();
  if (itemIds.length > 0) {
    const { data: levels } = await admin
      .from("inventory_levels")
      .select("item_id, quantity_on_hand")
      .in("item_id", itemIds);
    for (const level of levels ?? []) {
      tracked.add(level.item_id);
      onHand.set(
        level.item_id,
        (onHand.get(level.item_id) ?? 0) + Number(level.quantity_on_hand ?? 0),
      );
    }
  }

  const stockColumns = (itemId: string | null) => {
    if (!itemId || !tracked.has(itemId)) {
      return { quantity_on_hand: null as number | null, backordered: false };
    }
    const quantity = onHand.get(itemId) ?? 0;
    return { quantity_on_hand: quantity, backordered: quantity <= 0 };
  };

  const { data: pick, error: pickError } = await admin
    .from("pick_lists")
    .upsert(
      {
        student_id: schedule.student_id,
        school_year: schedule.school_year,
        ship_date: shipDate,
        status: "ready",
        paused_for_missing_scores: false,
        notes: annual
          ? "Annual Ship: every unshipped prescribed PACE."
          : `Next ${QUARTER_SHIP_COUNT} unshipped PACEs per logged subject.`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,school_year,ship_date" },
    )
    .select("id")
    .single();
  if (pickError) throw pickError;

  await admin.from("pick_list_items").delete().eq("pick_list_id", pick.id);
  const { error: itemError } = await admin.from("pick_list_items").insert([
    ...quarter.map((slot) => ({
      pick_list_id: pick.id,
      pace_slot_id: slot.id,
      subject_id: slot.subject_id,
      pace_number: slot.pace_number,
      item_id: slot.item_id,
      quantity_needed: 1,
      ...stockColumns(slot.item_id),
    })),
    ...companions.map((item) => ({
      pick_list_id: pick.id,
      pace_slot_id: null,
      subject_id: item.subject_id,
      pace_number: item.pace_number,
      item_id: item.id,
      quantity_needed: 1,
      ...stockColumns(item.id),
    })),
  ]);
  if (itemError) throw itemError;

  const prescribedIds = quarter
    .filter((slot) => slot.status === "prescribed")
    .map((slot) => slot.id);
  if (prescribedIds.length > 0) {
    await admin
      .from("student_pace_slots")
      .update({ status: "ordered", updated_at: new Date().toISOString() })
      .in("id", prescribedIds);
  }

  const fixed = [
    schedule.q1_ship_date,
    schedule.q2_ship_date,
    schedule.q3_ship_date,
    schedule.q4_ship_date,
  ].filter((d): d is string => !!d && d > shipDate).sort();
  const next = annual
    ? null
    : schedule.mode === "every_8_weeks"
      ? addDays(shipDate, 56)
      : (fixed[0] ?? null);

  await admin
    .from("student_ship_schedules")
    .update({
      shipment_paused: false,
      pause_reason: null,
      next_ship_date: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", schedule.id);

  const bookNotice = await recordResourceBooks(admin, {
    studentId: schedule.student_id,
    schoolYear: schedule.school_year,
    pickListId: pick.id,
    familyEmail: email,
    studentName: student?.student_name ?? "your student",
    books: resourceBooks,
    parentEmail: email,
  });

  return {
    student_id: schedule.student_id,
    pick_list_id: pick.id,
    status: "ready",
    lines: quarter.length,
    books_notified: bookNotice.titles,
    next_ship_date: next,
    generated_on: today,
  };
}

async function recordResourceBooks(
  admin: SupabaseClient,
  input: {
    studentId: string;
    schoolYear: string;
    pickListId: string;
    familyEmail: string | null;
    studentName: string;
    parentEmail: string | null;
    books: CatalogItem[];
  },
): Promise<{ titles: string[] }> {
  if (input.books.length === 0) return { titles: [] };
  const bought = new Set<string>();
  if (input.familyEmail) {
    const { data: orders } = await admin
      .from("orders")
      .select("id, order_items(item_id)")
      .ilike("customer_email", input.familyEmail)
      .neq("status", "cancelled");
    for (const order of orders ?? []) {
      const lines = order.order_items as Array<{ item_id: string }> | null;
      for (const line of lines ?? []) bought.add(line.item_id);
    }
  }
  const needed = input.books.filter((book) => !bought.has(book.id));
  if (needed.length === 0) return { titles: [] };

  const { data: existing } = await admin
    .from("resource_book_notices")
    .select("item_id, notified_at")
    .eq("student_id", input.studentId)
    .eq("school_year", input.schoolYear)
    .in("item_id", needed.map((book) => book.id));
  const already = new Map((existing ?? []).map((row) => [row.item_id, row.notified_at]));
  const fresh = needed.filter((book) => !already.has(book.id));
  if (fresh.length > 0) {
    await admin.from("resource_book_notices").upsert(
      fresh.map((book) => ({
        student_id: input.studentId,
        item_id: book.id,
        school_year: input.schoolYear,
        pick_list_id: input.pickListId,
      })),
      { onConflict: "student_id,item_id,school_year", ignoreDuplicates: true },
    );
  }
  const unsent = needed.filter((book) => !already.get(book.id));
  if (unsent.length === 0 || !input.parentEmail) return { titles: [] };

  const site = Deno.env.get("SITE_URL") || "https://mcahomeschool.com";
  const storeUrl = `${site}/store?add=${unsent.map((book) => book.id).join(",")}`;
  const bookList = `<ul>${unsent
    .map((book) => {
      const price = Number(book.sales_price ?? 0);
      const title = book.original_name || "Book";
      return `<li>${escapeHtml(title)} – $${price.toFixed(2)}</li>`;
    })
    .join("")}</ul>`;
  const rendered = await renderTemplate(admin, "resource_book_needed", {
    student_name: input.studentName,
    book_list: bookList,
    store_url: storeUrl,
  }, BOOK_NEEDED_FALLBACK);
  const emailed = await sendResendEmail({
    to: input.parentEmail,
    subject: rendered.subject,
    html: rendered.html,
  });
  if (emailed) {
    await admin
      .from("resource_book_notices")
      .update({ notified_at: new Date().toISOString(), pick_list_id: input.pickListId })
      .eq("student_id", input.studentId)
      .eq("school_year", input.schoolYear)
      .in("item_id", unsent.map((book) => book.id));
  }
  return {
    titles: unsent.map((book) => book.original_name || "Book"),
  };
}

/**
 * Emails parents about resource books recorded in resource_book_notices that
 * have not been emailed yet. The daily pg_cron SQL generator records notices
 * but cannot send email, so a second cron job calls this action afterwards.
 * One email per student and school year. Books the family already bought in
 * the store are marked notified without an email.
 */
async function notifyPendingResourceBooks(
  admin: SupabaseClient,
  options: { studentId?: string },
): Promise<{ students: number; emailed: number; results: unknown[] }> {
  let query = admin
    .from("resource_book_notices")
    .select(
      "student_id, item_id, school_year, pick_list_id, items(original_name, sales_price, active)",
    )
    .is("notified_at", null);
  if (options.studentId) query = query.eq("student_id", options.studentId);
  const { data: pending, error } = await query;
  if (error) throw error;

  const groups = new Map<string, Array<NonNullable<typeof pending>[number]>>();
  for (const row of pending ?? []) {
    const key = `${row.student_id}|${row.school_year}`;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const site = Deno.env.get("SITE_URL") || "https://mcahomeschool.com";
  const results: unknown[] = [];
  let emailedCount = 0;
  for (const [key, rows] of groups) {
    const [studentId, schoolYear] = key.split("|");
    const { data: student } = await admin
      .from("students")
      .select("id, student_name, families(email)")
      .eq("id", studentId)
      .maybeSingle();
    const familyRel = student?.families as { email: string } | { email: string }[] | null;
    const family = Array.isArray(familyRel) ? familyRel[0] : familyRel;
    const email = family?.email ?? null;
    if (!email) {
      results.push({ student_id: studentId, skipped: "no parent email" });
      continue;
    }

    const bought = new Set<string>();
    const { data: orders } = await admin
      .from("orders")
      .select("id, order_items(item_id)")
      .ilike("customer_email", email)
      .neq("status", "cancelled");
    for (const order of orders ?? []) {
      const lines = order.order_items as Array<{ item_id: string }> | null;
      for (const line of lines ?? []) bought.add(line.item_id);
    }

    const books = rows
      .map((row) => {
        const rel = row.items as
          | { original_name: string | null; sales_price: number | null; active: boolean | null }
          | Array<{ original_name: string | null; sales_price: number | null; active: boolean | null }>
          | null;
        const item = Array.isArray(rel) ? rel[0] : rel;
        return { id: row.item_id as string, item };
      })
      .filter((book) => book.item && book.item.active !== false);
    const skipped = rows
      .map((row) => row.item_id as string)
      .filter((id) => bought.has(id) || !books.some((book) => book.id === id));
    const toSend = books.filter((book) => !bought.has(book.id));
    const now = new Date().toISOString();

    if (skipped.length > 0) {
      await admin
        .from("resource_book_notices")
        .update({ notified_at: now })
        .eq("student_id", studentId)
        .eq("school_year", schoolYear)
        .in("item_id", skipped);
    }
    if (toSend.length === 0) {
      results.push({ student_id: studentId, skipped: "already bought or inactive", items: skipped.length });
      continue;
    }

    const storeUrl = `${site}/store?add=${toSend.map((book) => book.id).join(",")}`;
    const bookList = `<ul>${toSend
      .map((book) => {
        const price = Number(book.item?.sales_price ?? 0);
        const title = book.item?.original_name || "Book";
        return `<li>${escapeHtml(title)} – $${price.toFixed(2)}</li>`;
      })
      .join("")}</ul>`;
    const rendered = await renderTemplate(admin, "resource_book_needed", {
      student_name: student?.student_name ?? "your student",
      book_list: bookList,
      store_url: storeUrl,
    }, BOOK_NEEDED_FALLBACK);
    const emailed = await sendResendEmail({
      to: email,
      subject: rendered.subject,
      html: rendered.html,
    });
    if (emailed) {
      emailedCount += 1;
      await admin
        .from("resource_book_notices")
        .update({ notified_at: now })
        .eq("student_id", studentId)
        .eq("school_year", schoolYear)
        .in("item_id", toSend.map((book) => book.id));
    }
    console.log("[generate-pick-lists] resource book notice", {
      student_id: studentId,
      emailed,
      books: toSend.length,
    });
    results.push({ student_id: studentId, emailed, books: toSend.length });
  }
  return { students: groups.size, emailed: emailedCount, results };
}
