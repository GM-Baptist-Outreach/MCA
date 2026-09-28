import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// July 1, 2027 elementary re-prescribe, plus a high-school path that uses
// course_completions and graduation_requirements (there is no separate
// academic_projection table).
//
// Cron (date-gated; no-ops before 2027-07-01):
//   POST /functions/v1/represcribe-school-year
//   x-cron-secret: $CRON_SECRET
//   {}
//
// Admin can run early with { "force": true, "student_id"?: "...",
// "source_school_year"?: "2026-27", "target_school_year"?: "2027-28" }.
//
// Elementary: for each subject already logged, prescribe the next 12
// catalog PACEs after the highest pace_number (items.pace_number, internal
// numbering). High school: in-progress course_completions and unmet
// graduation_requirements, mapped by subject name, up to 12 PACEs that exist
// in the catalog and are not already slotted for the target year.
//
// ACE remains the official grade source. This only fills MCA ops slots.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const RUN_ON = "2027-07-01";
const PACES_PER_LEVEL = 12;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function nextSchoolYear(schoolYear: string): string {
  const match = schoolYear.match(/^(\d{4})-/);
  if (!match) return "2027-28";
  const start = Number(match[1]) + 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

function currentSchoolYear(date = new Date()): string {
  const year = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

async function assertAdminOrCron(req: Request) {
  const cronSecret = Deno.env.get("CRON_SECRET");
  const headerSecret = req.headers.get("x-cron-secret");
  if (cronSecret && headerSecret && headerSecret === cronSecret) return null;
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Unauthorized" }, 401);
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: auth } } },
  );
  const { data, error } = await userClient.rpc("is_admin");
  if (error || !data) return json({ error: "Admin only" }, 403);
  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const denied = await assertAdminOrCron(req);
    if (denied) return denied;

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const force = body.force === true;
    const today = new Date().toISOString().slice(0, 10);
    if (!force && today < RUN_ON) {
      return json({
        skipped: true,
        reason: `Scheduled run starts ${RUN_ON}. Pass force:true for an admin dry run.`,
        today,
      });
    }

    const sourceYear: string = body.source_school_year ?? currentSchoolYear();
    const targetYear: string = body.target_school_year ?? nextSchoolYear(sourceYear);
    const onlyStudent: string | undefined = body.student_id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: subjects } = await admin.from("subjects").select("id, name").eq("active", true);
    const subjectByName = new Map(
      (subjects ?? []).map((subject) => [subject.name.trim().toLowerCase(), subject]),
    );

    let enrollmentQuery = admin
      .from("enrollments")
      .select("student_id, tuition_tier, status")
      .eq("status", "active");
    if (onlyStudent) enrollmentQuery = enrollmentQuery.eq("student_id", onlyStudent);
    const { data: enrollments, error: enrollmentError } = await enrollmentQuery;
    if (enrollmentError) throw enrollmentError;

    const results: unknown[] = [];
    const seen = new Set<string>();
    for (const enrollment of enrollments ?? []) {
      if (seen.has(enrollment.student_id)) continue;
      seen.add(enrollment.student_id);

      if (enrollment.tuition_tier === "high_school") {
        results.push(
          await prescribeHighSchool(admin, enrollment.student_id, targetYear, subjectByName),
        );
      } else {
        results.push(
          await prescribeElementary(
            admin,
            enrollment.student_id,
            sourceYear,
            targetYear,
          ),
        );
      }
    }

    return json({
      today,
      source_school_year: sourceYear,
      target_school_year: targetYear,
      forced: force,
      results,
    });
  } catch (err) {
    console.error(err);
    return json({ error: String(err) }, 500);
  }
});

async function catalogForSubject(
  admin: ReturnType<typeof createClient>,
  subjectId: string,
) {
  const { data, error } = await admin
    .from("items")
    .select("id, pace_number")
    .eq("subject_id", subjectId)
    .eq("item_type", "pace")
    .eq("active", true)
    .not("pace_number", "is", null)
    .order("pace_number");
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; pace_number: number }>;
}

async function existingPaceNumbers(
  admin: ReturnType<typeof createClient>,
  studentId: string,
  subjectId: string,
  schoolYear: string,
) {
  const { data, error } = await admin
    .from("student_pace_slots")
    .select("pace_number, slot_index")
    .eq("student_id", studentId)
    .eq("subject_id", subjectId)
    .eq("school_year", schoolYear);
  if (error) throw error;
  return data ?? [];
}

async function insertSlots(
  admin: ReturnType<typeof createClient>,
  studentId: string,
  subjectId: string,
  schoolYear: string,
  paces: Array<{ id: string; pace_number: number }>,
) {
  if (paces.length === 0) return 0;
  const existing = await existingPaceNumbers(admin, studentId, subjectId, schoolYear);
  const usedNumbers = new Set(existing.map((row) => row.pace_number));
  const usedSlots = new Set(existing.map((row) => row.slot_index));
  const fresh = paces.filter((pace) => !usedNumbers.has(pace.pace_number)).slice(0, PACES_PER_LEVEL);
  const rows = [];
  let slot = 1;
  for (const pace of fresh) {
    while (usedSlots.has(slot) && slot <= PACES_PER_LEVEL) slot += 1;
    if (slot > PACES_PER_LEVEL) break;
    rows.push({
      student_id: studentId,
      subject_id: subjectId,
      school_year: schoolYear,
      slot_index: slot,
      pace_number: pace.pace_number,
      item_id: pace.id,
      status: "prescribed",
    });
    usedSlots.add(slot);
    slot += 1;
  }
  if (rows.length === 0) return 0;
  const { error } = await admin.from("student_pace_slots").insert(rows);
  if (error) throw error;
  const { error: planError } = await admin.from("required_pace_plans").upsert(
    {
      student_id: studentId,
      subject_id: subjectId,
      school_year: schoolYear,
      required_count: PACES_PER_LEVEL,
    },
    { onConflict: "student_id,subject_id,school_year" },
  );
  if (planError) throw planError;
  return rows.length;
}

async function prescribeElementary(
  admin: ReturnType<typeof createClient>,
  studentId: string,
  sourceYear: string,
  targetYear: string,
) {
  const { data: slots, error } = await admin
    .from("student_pace_slots")
    .select("subject_id, pace_number")
    .eq("student_id", studentId)
    .eq("school_year", sourceYear);
  if (error) throw error;

  const maxBySubject = new Map<string, number>();
  for (const slot of slots ?? []) {
    const current = maxBySubject.get(slot.subject_id) ?? 0;
    if (slot.pace_number > current) maxBySubject.set(slot.subject_id, slot.pace_number);
  }

  const prescribed: Array<{ subject_id: string; count: number }> = [];
  for (const [subjectId, maxPace] of maxBySubject) {
    const catalog = await catalogForSubject(admin, subjectId);
    const next = catalog
      .filter((item) => item.pace_number > maxPace)
      .slice(0, PACES_PER_LEVEL);
    const count = await insertSlots(admin, studentId, subjectId, targetYear, next);
    prescribed.push({ subject_id: subjectId, count });
  }

  return { student_id: studentId, tier: "elementary", target_school_year: targetYear, prescribed };
}

async function prescribeHighSchool(
  admin: ReturnType<typeof createClient>,
  studentId: string,
  targetYear: string,
  subjectByName: Map<string, { id: string; name: string }>,
) {
  const [{ data: completions }, { data: requirements }] = await Promise.all([
    admin
      .from("course_completions")
      .select("subject_name, final_average")
      .eq("student_id", studentId),
    admin.from("graduation_requirements").select("subject_name").order("sort_order"),
  ]);

  const names = new Set<string>();
  for (const row of completions ?? []) {
    if (row.final_average == null && row.subject_name) names.add(row.subject_name);
  }
  const finished = new Set(
    (completions ?? [])
      .filter((row) => row.final_average != null && row.subject_name)
      .map((row) => row.subject_name.trim().toLowerCase()),
  );
  for (const requirement of requirements ?? []) {
    const key = requirement.subject_name.trim().toLowerCase();
    if (!finished.has(key)) names.add(requirement.subject_name);
  }

  if (names.size === 0) {
    return {
      student_id: studentId,
      tier: "high_school",
      target_school_year: targetYear,
      prescribed: [],
      note: "No in-progress courses or unmet graduation requirements on file.",
    };
  }

  const prescribed: Array<{ subject: string; count: number }> = [];
  for (const name of names) {
    const subject = subjectByName.get(name.trim().toLowerCase());
    if (!subject) {
      prescribed.push({ subject: name, count: 0 });
      continue;
    }
    const catalog = await catalogForSubject(admin, subject.id);
    const count = await insertSlots(
      admin,
      studentId,
      subject.id,
      targetYear,
      catalog.slice(0, PACES_PER_LEVEL),
    );
    prescribed.push({ subject: subject.name, count });
  }

  return { student_id: studentId, tier: "high_school", target_school_year: targetYear, prescribed };
}
