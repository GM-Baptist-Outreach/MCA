import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

// Cron-ready and admin-callable.
// One week before a student's next_ship_date, build a pick list of the next
// 3 unissued PACEs in each logged subject. If the latest 6 issued PACEs
// include any without a score, pause the shipment, flag the schedule, and
// email the parent when RESEND_API_KEY is set (otherwise log only).
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
const UNISSUED = new Set(["prescribed", "ordered", "in_stock"]);
const ISSUED = new Set(["issued", "passed", "failed"]);

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

function nextQuarter(slots: SlotRow[]): SlotRow[] {
  const bySubject = new Map<string, SlotRow[]>();
  for (const slot of slots) {
    const list = bySubject.get(slot.subject_id) ?? [];
    list.push(slot);
    bySubject.set(slot.subject_id, list);
  }
  const groups = [...bySubject.values()].sort((a, b) =>
    subjectName(a[0]).localeCompare(subjectName(b[0]))
  );
  const picked: SlotRow[] = [];
  for (const list of groups) {
    const unissued = list
      .filter((slot) => UNISSUED.has(slot.status))
      .sort((a, b) => a.slot_index - b.slot_index);
    picked.push(...unissued.slice(0, QUARTER_SHIP_COUNT));
  }
  return picked;
}

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

async function sendReminder(input: {
  to: string;
  studentName: string;
  missing: Array<{ subject: string; pace: number }>;
}): Promise<{ emailed: boolean }> {
  const key = Deno.env.get("RESEND_API_KEY");
  const lines = input.missing
    .map((row) => `- ${row.subject} PACE ${row.pace}`)
    .join("\n");
  const text = [
    `Hello,`,
    ``,
    `Before MCA can ship the next PACEs for ${input.studentName}, we need scores for these already-issued PACEs:`,
    lines,
    ``,
    `Please submit them in the parent portal (Progress) or call us at (844) 663-4477.`,
    ``,
    `ACE remains the official grade record. This reminder is only about the shipment.`,
    ``,
    `Midwest Christian Academy`,
  ].join("\n");

  if (!key) {
    console.log("[generate-pick-lists] RESEND_API_KEY missing; reminder logged only", {
      to: input.to,
      studentName: input.studentName,
      missing: input.missing,
    });
    return { emailed: false };
  }

  const from = Deno.env.get("RESEND_FROM_EMAIL") ??
    "Midwest Christian Academy <onboarding@resend.dev>";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to],
      subject: `Scores needed before the next PACE shipment for ${input.studentName}`,
      text,
    }),
  });
  if (!res.ok) {
    console.error("[generate-pick-lists] Resend error", res.status, await res.text());
    return { emailed: false };
  }
  return { emailed: true };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const auth = await assertAdminOrCron(req);
    if (!auth.ok) return auth.response;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
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
      if (!due && !force) {
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
  options: { reminderEmailSentAt: string | null },
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
  const missing = missingScores(slots);
  const quarter = nextQuarter(slots);

  const familyRel = student?.families as
    | { email: string; parent_name: string }
    | { email: string; parent_name: string }[]
    | null;
  const family = Array.isArray(familyRel) ? familyRel[0] : familyRel;
  const email = family?.email ?? null;

  if (missing.length > 0) {
    const note =
      `Paused: ${missing.length} of the last ${SCORE_LOOKBACK} issued PACEs have no score.`;
    let emailed = false;
    if (options.reminderEmailSentAt) {
      console.log("[generate-pick-lists] reminder already sent; still paused", {
        student_id: schedule.student_id,
      });
    } else if (email) {
      const sent = await sendReminder({
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
    return { student_id: schedule.student_id, skipped: "no unissued PACEs" };
  }

  const itemIds = quarter.map((slot) => slot.item_id).filter((id): id is string => !!id);
  const onHand = new Map<string, number>();
  if (itemIds.length > 0) {
    const { data: levels } = await admin
      .from("inventory_levels")
      .select("item_id, quantity_on_hand")
      .in("item_id", itemIds);
    for (const level of levels ?? []) {
      onHand.set(
        level.item_id,
        (onHand.get(level.item_id) ?? 0) + Number(level.quantity_on_hand ?? 0),
      );
    }
  }

  const { data: pick, error: pickError } = await admin
    .from("pick_lists")
    .upsert(
      {
        student_id: schedule.student_id,
        school_year: schedule.school_year,
        ship_date: shipDate,
        status: "ready",
        paused_for_missing_scores: false,
        notes: `Next ${QUARTER_SHIP_COUNT} unissued PACEs per logged subject.`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,school_year,ship_date" },
    )
    .select("id")
    .single();
  if (pickError) throw pickError;

  await admin.from("pick_list_items").delete().eq("pick_list_id", pick.id);
  const { error: itemError } = await admin.from("pick_list_items").insert(
    quarter.map((slot) => ({
      pick_list_id: pick.id,
      pace_slot_id: slot.id,
      subject_id: slot.subject_id,
      pace_number: slot.pace_number,
      item_id: slot.item_id,
      quantity_needed: 1,
      quantity_on_hand: slot.item_id ? onHand.get(slot.item_id) ?? null : null,
    })),
  );
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
  const next = schedule.mode === "every_8_weeks" ? addDays(shipDate, 56) : (fixed[0] ?? null);

  await admin
    .from("student_ship_schedules")
    .update({
      shipment_paused: false,
      pause_reason: null,
      next_ship_date: next,
      updated_at: new Date().toISOString(),
    })
    .eq("id", schedule.id);

  return {
    student_id: schedule.student_id,
    pick_list_id: pick.id,
    status: "ready",
    lines: quarter.length,
    next_ship_date: next,
    generated_on: today,
  };
}
