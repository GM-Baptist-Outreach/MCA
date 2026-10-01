import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  addDays,
  average,
  buildCourseOptions,
  compareSubjectNames,
  courseOptionLabel,
  currentSchoolYear,
  isSlotCompleted,
  isoToday,
  nextSchoolYear,
  reportLetter,
  SUBJECT_GROUPS,
  subjectDisplayName,
  subjectGroup,
  suggestedFixedShipDates,
  toAcePaceNumber,
  type CourseCatalogItem,
  type CourseOption,
  type CoursePaceItem,
} from "@/lib/loggedCourses";

// Round 3 markers (grep the live bundle for these):
//   MCA_R3_A1_PRESCRIBE_ALL, MCA_R3_A5_ANNUAL_SHIP, MCA_R3_A6_REMOVE_PACE,
//   MCA_R3_P3_START_DATE_SHIPS
export const MCA_R3_PANEL_MARKERS = [
  "MCA_R3_A1_PRESCRIBE_ALL",
  "MCA_R3_A5_ANNUAL_SHIP",
  "MCA_R3_A6_REMOVE_PACE",
  "MCA_R3_P3_START_DATE_SHIPS",
] as const;

/** Elementary core subjects for "Prescribe all core subjects". */
const CORE_ELEMENTARY = ["Math", "English", "Word Building", "Science", "Social Studies"] as const;

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";
const PASSING = 80;

interface Subject {
  id: string;
  name: string;
}

interface Slot {
  id: string;
  subject_id: string;
  slot_index: number;
  pace_number: number;
  item_id: string | null;
  status: string;
  score: number | null;
  issued_at: string | null;
  completed_at: string | null;
}

interface Schedule {
  id?: string;
  mode: "fixed_dates" | "every_8_weeks" | "annual";
  q1_ship_date: string;
  q2_ship_date: string;
  q3_ship_date: string;
  q4_ship_date: string;
  anchor_ship_date: string;
  next_ship_date: string;
  shipment_paused: boolean;
  pause_reason: string | null;
  auto_from_calendar?: boolean;
}

const EMPTY_SCHEDULE = (year: string): Schedule => {
  const dates = suggestedFixedShipDates(year);
  return {
    mode: "fixed_dates",
    q1_ship_date: dates.q1,
    q2_ship_date: dates.q2,
    q3_ship_date: dates.q3,
    q4_ship_date: dates.q4,
    anchor_ship_date: dates.q2,
    next_ship_date: dates.q2,
    shipment_paused: false,
    pause_reason: null,
  };
};

const STATUSES = [
  "prescribed",
  "ordered",
  "in_stock",
  "issued",
  "passed",
  "failed",
  "paused",
] as const;

async function callAdminFunction(name: string, body: unknown) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok || result.error) {
    throw new Error(result.error || `Couldn't run ${name}`);
  }
  return result;
}

export default function LoggedCoursesPanel({
  studentId,
  studentName,
}: {
  studentId: string;
  studentName: string;
}) {
  const { toast } = useToast();
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear());
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [schedule, setSchedule] = useState<Schedule>(EMPTY_SCHEDULE(schoolYear));
  const [courseItems, setCourseItems] = useState<CourseCatalogItem[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [level, setLevel] = useState("");
  const [schoolStartDate, setSchoolStartDate] = useState("");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [draftScore, setDraftScore] = useState("");
  const [busy, setBusy] = useState(false);
  const [enrollmentInfo, setEnrollmentInfo] = useState<{ tier: string | null; frequency: string | null }>({
    tier: null,
    frequency: null,
  });
  const [showPrescribeAll, setShowPrescribeAll] = useState(false);
  const [bulkLevel, setBulkLevel] = useState("");
  const [bulkOverrides, setBulkOverrides] = useState<Record<string, string>>({});
  const [bulkHs, setBulkHs] = useState<Record<string, boolean>>({});

  const load = async () => {
    const catalog: CourseCatalogItem[] = [];
    let from = 0;
    while (from < 5000) {
      const { data, error } = await supabase
        .from("items")
        .select("id, subject_id, item_type, pace_number, sales_price, subjects(name)")
        .eq("active", true)
        .in("item_type", ["pace", "other"])
        .not("pace_number", "is", null)
        .range(from, from + 999);
      if (error || !data || data.length === 0) break;
      for (const row of data) {
        if (!row.subject_id || row.pace_number == null) continue;
        const rel = row.subjects as { name: string } | { name: string }[] | null;
        const subjectName = Array.isArray(rel) ? rel[0]?.name ?? "Subject" : rel?.name ?? "Subject";
        catalog.push({
          id: row.id,
          subject_id: row.subject_id,
          subject_name: subjectName,
          item_type: row.item_type,
          pace_number: row.pace_number,
          sales_price: Number(row.sales_price ?? 0),
        });
      }
      if (data.length < 1000) break;
      from += 1000;
    }
    setCourseItems(catalog);

    const [subjectRes, slotRes, scheduleRes, calendarRes, enrollmentRes] = await Promise.all([
      supabase.from("subjects").select("id, name").eq("active", true),
      supabase
        .from("student_pace_slots")
        .select(
          "id, subject_id, slot_index, pace_number, item_id, status, score, issued_at, completed_at",
        )
        .eq("student_id", studentId)
        .eq("school_year", schoolYear)
        .order("slot_index"),
      supabase
        .from("student_ship_schedules")
        .select(
          "id, mode, q1_ship_date, q2_ship_date, q3_ship_date, q4_ship_date, anchor_ship_date, next_ship_date, shipment_paused, pause_reason, auto_from_calendar",
        )
        .eq("student_id", studentId)
        .eq("school_year", schoolYear)
        .maybeSingle(),
      supabase
        .from("student_school_calendars")
        .select("start_date")
        .eq("student_id", studentId)
        .eq("school_year", schoolYear)
        .maybeSingle(),
      supabase
        .from("enrollments")
        .select("tuition_tier, frequency, status")
        .eq("student_id", studentId)
        .order("created_at", { ascending: false }),
    ]);
    const enrollments = (enrollmentRes.data ?? []) as Array<{
      tuition_tier: string | null;
      frequency: string | null;
      status: string | null;
    }>;
    const activeEnrollment = enrollments.find((e) => e.status === "active") ?? enrollments[0] ?? null;
    const info = {
      tier: activeEnrollment?.tuition_tier ?? null,
      frequency: activeEnrollment?.frequency ?? null,
    };
    setEnrollmentInfo(info);
    if (subjectRes.data) {
      setSubjects(
        [...subjectRes.data].sort((a, b) => compareSubjectNames(a.name, b.name)),
      );
    }
    setSlots((slotRes.data ?? []) as Slot[]);
    if (scheduleRes.data) {
      const row = scheduleRes.data;
      setSchedule({
        id: row.id,
        mode: row.mode,
        q1_ship_date: row.q1_ship_date ?? "",
        q2_ship_date: row.q2_ship_date ?? "",
        q3_ship_date: row.q3_ship_date ?? "",
        q4_ship_date: row.q4_ship_date ?? "",
        anchor_ship_date: row.anchor_ship_date ?? "",
        next_ship_date:
          row.mode === "every_8_weeks" && !row.next_ship_date
            ? addDays(isoToday(), 56)
            : row.next_ship_date ?? "",
        shipment_paused: row.shipment_paused,
        pause_reason: row.pause_reason,
        auto_from_calendar: row.auto_from_calendar ?? false,
      });
    } else if (info.frequency === "annual") {
      // A5: annual payers default to one Annual Ship.
      setSchedule({ ...EMPTY_SCHEDULE(schoolYear), mode: "annual", next_ship_date: isoToday() });
    } else {
      setSchedule(EMPTY_SCHEDULE(schoolYear));
    }
    setSchoolStartDate(calendarRes.data?.start_date ?? "");
  };

  useEffect(() => {
    load();
  }, [studentId, schoolYear]);

  const bySubject = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of slots) {
      const list = map.get(slot.subject_id) ?? [];
      list.push(slot);
      map.set(slot.subject_id, list);
    }
    return [...map.entries()].sort((a, b) => {
      const an = subjects.find((s) => s.id === a[0])?.name ?? "";
      const bn = subjects.find((s) => s.id === b[0])?.name ?? "";
      return compareSubjectNames(an, bn);
    });
  }, [slots, subjects]);

  const selected = slots.find((slot) => slot.id === selectedSlotId) ?? null;

  const totals = useMemo(() => {
    const completed = slots.filter((slot) => isSlotCompleted(slot.status, slot.score)).length;
    return {
      completed,
      remaining: slots.length - completed,
      average: average(slots.map((slot) => slot.score)),
    };
  }, [slots]);

  const courseOptions = useMemo(
    () => buildCourseOptions(courseItems),
    [courseItems],
  );
  const selectedCourse: CourseOption | null =
    courseOptions.elementary.find((course) => course.key === courseKey) ??
    courseOptions.courses.find((course) => course.key === courseKey) ??
    null;

  /** Writes PACE boxes for the given catalog PACEs. Returns saved count, or null on error. */
  const writePaces = async (paces: CoursePaceItem[]): Promise<number | null> => {
    const grouped = new Map<string, typeof paces>();
    for (const pace of paces) {
      const list = grouped.get(pace.subjectId) ?? [];
      list.push(pace);
      grouped.set(pace.subjectId, list);
    }
    let saved = 0;
    for (const [subjectId, list] of grouped) {
      const rows = [...list]
        .sort((a, b) => a.paceNumber - b.paceNumber)
        .map((pace, index) => ({
          student_id: studentId,
          subject_id: subjectId,
          school_year: schoolYear,
          slot_index: index + 1,
          pace_number: pace.paceNumber,
          item_id: pace.id,
          status: "prescribed",
        }));
      const locked = slots.filter(
        (slot) =>
          slot.subject_id === subjectId &&
          !["prescribed", "paused"].includes(slot.status),
      );
      const lockedIndexes = new Set(locked.map((slot) => slot.slot_index));
      const writable = rows.filter((row) => !lockedIndexes.has(row.slot_index));
      if (writable.length > 0) {
        const { error: upsertError } = await supabase
          .from("student_pace_slots")
          .upsert(writable, {
            onConflict: "student_id,subject_id,school_year,slot_index",
          });
        if (upsertError) {
          toast({ title: "Couldn't prescribe", description: upsertError.message, variant: "destructive" });
          return null;
        }
        saved += writable.length;
      }
      await supabase.from("required_pace_plans").upsert(
        {
          student_id: studentId,
          subject_id: subjectId,
          school_year: schoolYear,
          required_count: rows.length,
        },
        { onConflict: "student_id,subject_id,school_year" },
      );
    }
    return saved;
  };

  const prescribe = async () => {
    if (!selectedCourse) return;
    const levelOption =
      selectedCourse.kind === "level"
        ? selectedCourse.levels.find((row) => String(row.level) === level)
        : null;
    const paces = levelOption ? levelOption.items : selectedCourse.items;
    if (selectedCourse.kind === "level" && !levelOption) return;
    setBusy(true);
    const saved = await writePaces(paces);
    if (saved == null) {
      setBusy(false);
      return;
    }
    toast({
      title: "Course prescribed",
      description: `${saved} PACE boxes saved for ${studentName}.`,
    });
    setBusy(false);
    load();
  };

  // ---- A1: prescribe all core subjects ----
  const coreElementary = useMemo(
    () =>
      CORE_ELEMENTARY.map((name) =>
        courseOptions.elementary.find((course) => course.subjectNames[0] === name),
      ).filter((course): course is CourseOption => !!course),
    [courseOptions],
  );
  const sharedLevels = useMemo(() => {
    const set = new Set<number>();
    for (const course of coreElementary) for (const row of course.levels) set.add(row.level);
    return [...set].sort((a, b) => a - b);
  }, [coreElementary]);
  const isHighSchool = enrollmentInfo.tier === "high_school";

  const prescribeAll = async () => {
    const paces: CoursePaceItem[] = [];
    const summary: string[] = [];
    if (isHighSchool) {
      for (const course of courseOptions.courses) {
        if (!bulkHs[course.key]) continue;
        paces.push(...course.items);
        summary.push(course.displayName);
      }
    } else {
      for (const course of coreElementary) {
        const chosen = bulkOverrides[course.key] || bulkLevel;
        if (!chosen || chosen === "skip") continue;
        const row = course.levels.find((l) => String(l.level) === chosen);
        if (!row) continue;
        paces.push(...row.items);
        summary.push(`${course.displayName} L${row.level}`);
      }
    }
    if (paces.length === 0) {
      toast({ title: "Nothing selected", description: "Pick a level or at least one course." });
      return;
    }
    if (!window.confirm(`Prescribe ${summary.join(", ")} for ${studentName} (${schoolYear})?`)) return;
    setBusy(true);
    const saved = await writePaces(paces);
    setBusy(false);
    if (saved == null) return;
    toast({ title: "Core subjects prescribed", description: `${saved} PACE boxes saved. ${summary.join(", ")}.` });
    setShowPrescribeAll(false);
    load();
  };

  // ---- A6: remove PACE boxes ----
  const removeSlots = async (ids: string[], label: string) => {
    if (ids.length === 0) return;
    const targets = slots.filter((slot) => ids.includes(slot.id));
    const sentOrHome = targets.filter((slot) => ["ordered", "in_stock"].includes(slot.status)).length;
    const warning =
      sentOrHome > 0
        ? ` ${sentOrHome} of them already shipped or are at home. Removing them does not recall the books.`
        : "";
    if (!window.confirm(`Remove ${label}?${warning}`)) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("mca_remove_pace_slots", { p_slot_ids: ids });
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't remove", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Removed", description: `${(data as { removed?: number } | null)?.removed ?? ids.length} PACE box(es) removed.` });
    setSelectedSlotId(null);
    load();
  };

  const removableInSubject = (subjectId: string) =>
    slots.filter(
      (slot) =>
        slot.subject_id === subjectId &&
        slot.score == null &&
        ["prescribed", "paused"].includes(slot.status),
    );

  // ---- P3: rebuild ship schedule from the school start date ----
  const rebuildFromStartDate = async () => {
    if (!schoolStartDate) {
      toast({ title: "Set a school start date first" });
      return;
    }
    if (!window.confirm("Replace the ship dates with dates built from the school start date?")) return;
    setBusy(true);
    const { error } = await supabase.rpc("mca_rebuild_ship_schedule_from_calendar", {
      p_student_id: studentId,
      p_school_year: schoolYear,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't rebuild", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Ship schedule rebuilt from start date" });
    load();
  };

  const saveSchoolStartDate = async () => {
    if (!schoolStartDate) return;
    setBusy(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("student_school_calendars").upsert(
      {
        student_id: studentId,
        school_year: schoolYear,
        start_date: schoolStartDate,
        updated_by: user?.id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,school_year" },
    );
    if (error) {
      toast({ title: "Couldn't save the start date", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "School start date saved",
        description: schedule.id && !schedule.auto_from_calendar
          ? "The ship schedule was edited by an admin, so it was left alone. Use Rebuild from start date to replace it."
          : "Ship dates were built from the start date.",
      });
      load();
    }
    setBusy(false);
  };

  const saveSchedule = async () => {
    setBusy(true);
    const payload = {
      student_id: studentId,
      school_year: schoolYear,
      mode: schedule.mode,
      q1_ship_date: schedule.mode === "annual" ? null : schedule.q1_ship_date || null,
      q2_ship_date: schedule.mode === "annual" ? null : schedule.q2_ship_date || null,
      q3_ship_date: schedule.mode === "annual" ? null : schedule.q3_ship_date || null,
      q4_ship_date: schedule.mode === "annual" ? null : schedule.q4_ship_date || null,
      anchor_ship_date: schedule.anchor_ship_date || null,
      next_ship_date:
        schedule.mode === "every_8_weeks"
          ? schedule.next_ship_date || addDays(isoToday(), 56)
          : schedule.next_ship_date || null,
      // P3: a manual save means an admin owns these dates now.
      auto_from_calendar: false,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase
      .from("student_ship_schedules")
      .upsert(payload, { onConflict: "student_id,school_year" });
    if (error) {
      toast({ title: "Couldn't save schedule", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Ship schedule saved" });
      load();
    }
    setBusy(false);
  };

  const saveSlot = async (patch: Partial<Slot>) => {
    if (!selected) return;
    setBusy(true);
    const nextStatus = patch.status ?? selected.status;
    const score = patch.score !== undefined ? patch.score : selected.score;
    const issuedAt =
      nextStatus === "issued" || nextStatus === "passed" || nextStatus === "failed"
        ? selected.issued_at ?? new Date().toISOString().slice(0, 10)
        : selected.issued_at;
    const completedAt =
      nextStatus === "passed" || nextStatus === "failed"
        ? new Date().toISOString().slice(0, 10)
        : selected.completed_at;
    const { error } = await supabase
      .from("student_pace_slots")
      .update({
        status: nextStatus,
        score,
        issued_at: issuedAt,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selected.id);
    if (error) {
      toast({ title: "Couldn't update box", description: error.message, variant: "destructive" });
      setBusy(false);
      return;
    }
    if (selected.item_id && ["ordered", "in_stock", "issued"].includes(nextStatus)) {
      await supabase.from("pace_status").upsert(
        {
          student_id: studentId,
          item_id: selected.item_id,
          status: nextStatus === "passed" || nextStatus === "failed" ? "issued" : nextStatus,
          status_date: new Date().toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "student_id,item_id" },
      );
    }
    setBusy(false);
    load();
  };

  const reissueSlot = async () => {
    if (!selected || selected.status !== "failed") return;
    setBusy(true);
    const { error } = await supabase.rpc("mca_reissue_pace", { slot_id: selected.id });
    if (error) {
      toast({
        title: "Couldn't re-issue PACE",
        description: error.message,
        variant: "destructive",
      });
      setBusy(false);
      return;
    }
    toast({
      title: "PACE re-issued",
      description: `PACE ${selected.pace_number} is issued again. The failed score was kept in the notes.`,
    });
    setSelectedSlotId(null);
    setBusy(false);
    load();
  };

  const runPickList = async () => {
    setBusy(true);
    try {
      const result = await callAdminFunction("generate-pick-lists", {
        student_id: studentId,
        school_year: schoolYear,
        force: true,
      });
      toast({ title: "Pick list run finished", description: JSON.stringify(result.results?.[0] ?? result.results) });
      load();
    } catch (err) {
      toast({ title: "Pick list failed", description: String(err), variant: "destructive" });
    }
    setBusy(false);
  };

  const runReprescribe = async () => {
    setBusy(true);
    try {
      const result = await callAdminFunction("represcribe-school-year", {
        force: true,
        student_id: studentId,
        source_school_year: schoolYear,
        target_school_year: nextSchoolYear(schoolYear),
      });
      toast({
        title: `Next year prescribed (${nextSchoolYear(schoolYear)})`,
        description: "Check that school year to review the new boxes. The July 1, 2027 cron does this for every active student.",
      });
      console.log(result);
    } catch (err) {
      toast({ title: "Re-prescribe failed", description: String(err), variant: "destructive" });
    }
    setBusy(false);
  };

  return (
    <div className="space-y-4 border-t border-border/50 pt-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-wide text-foreground/50">Logged courses</p>
          <p className="text-xs text-foreground/50">
            Ops grid only. ACE remains the official grade record.
          </p>
        </div>
        <Input
          value={schoolYear}
          onChange={(event) => setSchoolYear(event.target.value)}
          className="bg-background w-28 h-8"
          aria-label="School year"
        />
      </div>

      {schedule.shipment_paused && (
        <p className="text-sm rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-amber-800">
          Shipment paused. {schedule.pause_reason}
        </p>
      )}

      <div className="flex flex-wrap gap-2 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Course</Label>
          <Select
            value={courseKey}
            onValueChange={(value) => {
              setCourseKey(value);
              const course =
                courseOptions.elementary.find((row) => row.key === value) ??
                courseOptions.courses.find((row) => row.key === value);
              setLevel(course?.levels[0] ? String(course.levels[0].level) : "");
            }}
          >
            <SelectTrigger className="bg-background w-72 h-9">
              <SelectValue placeholder="Course" />
            </SelectTrigger>
            <SelectContent>
              {courseOptions.elementary.length > 0 && (
                <SelectGroup>
                  <SelectLabel>Elementary</SelectLabel>
                  {courseOptions.elementary.map((course) => (
                    <SelectItem key={course.key} value={course.key}>
                      {course.displayName}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {SUBJECT_GROUPS.map((group) => {
                const groupCourses = courseOptions.courses.filter(
                  (course) =>
                    (subjectGroup(course.subjectNames[0] ?? "") ?? "Electives") === group,
                );
                if (groupCourses.length === 0) return null;
                return (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {groupCourses.map((course) => (
                      <SelectItem key={course.key} value={course.key}>
                        {courseOptionLabel(course)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        </div>
        {selectedCourse?.kind === "level" && (
          <div className="space-y-1">
            <Label className="text-xs">Level</Label>
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="bg-background w-64 h-9">
                <SelectValue placeholder="Level" />
              </SelectTrigger>
              <SelectContent>
                {selectedCourse.levels.map((row) => (
                  <SelectItem key={row.level} value={String(row.level)}>
                    {courseOptionLabel(selectedCourse, row)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        <Button
          size="sm"
          onClick={prescribe}
          disabled={busy || !selectedCourse || (selectedCourse.kind === "level" && !level)}
        >
          Prescribe
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowPrescribeAll((v) => !v)}
          disabled={busy}
        >
          {showPrescribeAll ? "Close" : "Prescribe all core subjects"}
        </Button>
      </div>

      {showPrescribeAll && (
        <div className="rounded-lg border border-border/60 p-3 space-y-3" data-marker="MCA_R3_A1_PRESCRIBE_ALL">
          <div className="flex items-center gap-3 flex-wrap text-xs">
            <span className="text-foreground/60">
              {isHighSchool ? "High school: check the courses to prescribe." : "Elementary: pick one level for all core subjects, then override any subject."}
            </span>
          </div>
          {isHighSchool ? (
            <div className="grid sm:grid-cols-2 gap-1 max-h-72 overflow-y-auto">
              {courseOptions.courses.map((course) => (
                <label key={course.key} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={!!bulkHs[course.key]}
                    onCheckedChange={(checked) =>
                      setBulkHs((prev) => ({ ...prev, [course.key]: checked === true }))
                    }
                  />
                  {courseOptionLabel(course)}
                </label>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label className="text-xs w-32">Level for all</Label>
                <Select value={bulkLevel} onValueChange={setBulkLevel}>
                  <SelectTrigger className="bg-background w-40 h-8">
                    <SelectValue placeholder="Level" />
                  </SelectTrigger>
                  <SelectContent>
                    {sharedLevels.map((lvl) => (
                      <SelectItem key={lvl} value={String(lvl)}>
                        Level {lvl}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {coreElementary.map((course) => (
                <div key={course.key} className="flex items-center gap-2">
                  <span className="text-sm w-32">{course.displayName}</span>
                  <Select
                    value={bulkOverrides[course.key] ?? "same"}
                    onValueChange={(value) =>
                      setBulkOverrides((prev) => ({ ...prev, [course.key]: value === "same" ? "" : value }))
                    }
                  >
                    <SelectTrigger className="bg-background w-64 h-8">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="same">Same as above</SelectItem>
                      <SelectItem value="skip">Skip this subject</SelectItem>
                      {course.levels.map((row) => (
                        <SelectItem key={row.level} value={String(row.level)}>
                          {courseOptionLabel(course, row)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-foreground/50">
            Boxes already ordered, in stock, issued or scored are never overwritten.
          </p>
          <Button size="sm" onClick={prescribeAll} disabled={busy}>
            Prescribe selected
          </Button>
        </div>
      )}

      {bySubject.length === 0 ? (
        <p className="text-sm text-foreground/60">No PACEs prescribed for {schoolYear}.</p>
      ) : (
        <div className="space-y-3 overflow-x-auto">
          <p className="text-sm text-foreground/80">
            Overall: Avg {totals.average != null ? `${totals.average.toFixed(1)}%` : "n/a"} | Completed{" "}
            {totals.completed} | Remaining {totals.remaining}
          </p>
          {bySubject.map(([id, subjectSlots]) => {
            const completed = subjectSlots.filter((slot) =>
              isSlotCompleted(slot.status, slot.score),
            ).length;
            const subjectAverage = average(subjectSlots.map((slot) => slot.score));
            return (
            <div key={id} className="min-w-[760px]">
              <p className="text-sm font-medium mb-1">
                {subjectDisplayName(subjects.find((subject) => subject.id === id)?.name ?? "Subject")}
                <span className="ml-2 font-normal text-foreground/70">
                  Avg {subjectAverage != null ? `${subjectAverage.toFixed(1)}%` : "n/a"} | Completed{" "}
                  {completed} | Remaining {subjectSlots.length - completed}
                </span>
              </p>
              <div className="grid grid-cols-12 gap-1">
                {Array.from({ length: 12 }, (_, index) => {
                  const slot = subjectSlots.find((row) => row.slot_index === index + 1);
                  const letter = slot ? reportLetter(slot.status, slot.score) : "";
                  const highlighted =
                    slot &&
                    ["issued", "passed", "failed"].includes(slot.status);
                  return (
                    <button
                      key={index}
                      type="button"
                      onClick={() => {
                        if (!slot) return;
                        setSelectedSlotId(slot.id);
                        setDraftScore(slot.score != null ? String(slot.score) : "");
                      }}
                      className={`h-14 border rounded-sm text-xs ${
                        selectedSlotId === slot?.id ? "ring-2 ring-primary" : ""
                      }`}
                    >
                      <div className={highlighted ? "bg-amber-200 font-semibold" : "bg-secondary/50"}>
                        {slot ? toAcePaceNumber(slot.pace_number) : "·"}
                      </div>
                      <div
                        className={
                          letter === "P"
                            ? "text-green-700 font-semibold"
                            : letter === "F"
                              ? "text-red-700 font-semibold"
                              : "text-foreground/60"
                        }
                      >
                        {slot?.score ?? letter}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })}
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap gap-2 items-end rounded-lg border border-border/60 p-3">
          <p className="text-sm w-full">
            PACE {toAcePaceNumber(selected.pace_number)} · {selected.status}
          </p>
          <Select
            value={selected.status}
            onValueChange={(status) => saveSlot({ status })}
          >
            <SelectTrigger className="bg-background w-36 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            max={100}
            value={draftScore}
            onChange={(event) => setDraftScore(event.target.value)}
            placeholder="Score"
            className="bg-background w-24 h-9"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              const score = draftScore === "" ? null : Number(draftScore);
              if (score != null && Number.isNaN(score)) return;
              const status =
                score == null ? selected.status : score >= PASSING ? "passed" : "failed";
              saveSlot({ score, status });
            }}
          >
            Save score
          </Button>
          {selected.status === "failed" && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={reissueSlot}>
              Re-issue
            </Button>
          )}
          <div className="flex gap-2 w-full flex-wrap" data-marker="MCA_R3_A6_REMOVE_PACE">
            {selected.score == null && !["issued", "passed", "failed"].includes(selected.status) && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  removeSlots([selected.id], `PACE ${toAcePaceNumber(selected.pace_number)}`)
                }
              >
                Remove PACE
              </Button>
            )}
            {removableInSubject(selected.subject_id).length > 0 && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  const ids = removableInSubject(selected.subject_id).map((slot) => slot.id);
                  removeSlots(ids, `${ids.length} unstarted PACE box(es) in this subject`);
                }}
              >
                Remove unstarted in this subject ({removableInSubject(selected.subject_id).length})
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 rounded-lg border border-border/60 p-3">
        <div className="space-y-2">
          <Label className="text-xs">School start date</Label>
          <div className="flex gap-2">
            <Input
              type="date"
              value={schoolStartDate}
              onChange={(event) => setSchoolStartDate(event.target.value)}
              className="bg-background h-9"
              aria-label="School start date"
            />
            <Button size="sm" variant="outline" disabled={busy || !schoolStartDate} onClick={saveSchoolStartDate}>
              Save
            </Button>
          </div>
          <div className="flex items-center gap-2 flex-wrap" data-marker="MCA_R3_P3_START_DATE_SHIPS">
            {schedule.id ? (
              <span
                className={`text-xs px-2 py-0.5 rounded-full ${
                  schedule.auto_from_calendar
                    ? "bg-green-500/10 text-green-700"
                    : "bg-secondary text-foreground/70"
                }`}
              >
                {schedule.auto_from_calendar ? "Auto from start date" : "Edited by admin"}
              </span>
            ) : (
              <span className="text-xs text-foreground/50">No ship schedule saved yet</span>
            )}
            <Button size="sm" variant="ghost" disabled={busy || !schoolStartDate} onClick={rebuildFromStartDate}>
              Rebuild from start date
            </Button>
          </div>
          <Label className="text-xs">Ship mode</Label>
          <Select
            value={schedule.mode}
            onValueChange={(mode) =>
              setSchedule((current) => ({
                ...current,
                mode: mode as Schedule["mode"],
                next_ship_date:
                  mode === "every_8_weeks" && !current.next_ship_date
                    ? addDays(isoToday(), 56)
                    : current.next_ship_date,
              }))
            }
          >
            <SelectTrigger className="bg-background h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed_dates">Fixed quarter dates</SelectItem>
              <SelectItem value="every_8_weeks">Every 8 weeks</SelectItem>
              <SelectItem value="annual">Annual Ship (everything at once)</SelectItem>
            </SelectContent>
          </Select>
          {enrollmentInfo.frequency === "annual" && schedule.mode !== "annual" && (
            <p className="text-xs text-amber-700" data-marker="MCA_R3_A5_ANNUAL_SHIP">
              This family pays annually. Annual Ship sends every PACE for the year in one box.
            </p>
          )}
          <Label className="text-xs">Next ship date</Label>
          <Input
            type="date"
            value={schedule.next_ship_date}
            onChange={(event) =>
              setSchedule((current) => ({ ...current, next_ship_date: event.target.value }))
            }
            className="bg-background h-9"
          />
        </div>
        {schedule.mode === "annual" ? (
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium text-foreground/70">Annual Ship</p>
            <p className="text-foreground/70">
              One shipment on the next ship date with every unshipped PACE prescribed for {schoolYear}.
              No score check. After it ships, no further dates are scheduled.
            </p>
          </div>
        ) : schedule.mode === "every_8_weeks" ? (
          <div className="space-y-1 text-sm">
            <p className="text-xs font-medium text-foreground/70">Upcoming ship dates</p>
            {[56, 112, 168].map((days) => {
              const base = schedule.next_ship_date || addDays(isoToday(), 56);
              return (
                <p key={days} className="text-foreground/70">
                  +{days} days: {addDays(base, days)}
                </p>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {(
              [
                ["q1_ship_date", "Q1 at enroll"],
                ["q2_ship_date", "Q2"],
                ["q3_ship_date", "Q3"],
                ["q4_ship_date", "Q4"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs">{label}</Label>
                <Input
                  type="date"
                  value={schedule[key]}
                  onChange={(event) =>
                    setSchedule((current) => ({ ...current, [key]: event.target.value }))
                  }
                  className="bg-background h-9"
                />
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-foreground/50 sm:col-span-2">
          {schedule.mode === "annual"
            ? "Annual Ship: one pick list with every unshipped PACE for the year, generated one week before the ship date."
            : schedule.mode === "every_8_weeks"
            ? "Every 8 weeks hides the quarter dates. The next ship date stays manual. If it is blank, it defaults to 56 days after today. The preview lists the dates 56, 112, and 168 days after that. One week before the next ship date, pick-list generation takes the next 3 unshipped PACEs in each logged subject. If the 6 most recently issued PACEs across subjects lack scores, the shipment pauses and the pick list is marked paused."
            : "2025-26: Q1 is the first 3 PACEs at enrollment, so that date stays blank. Q2 is 2025-10-26, Q3 is 2026-01-11, and Q4 is 2026-03-08. One week before the next ship date, pick-list generation takes the next 3 unshipped PACEs in each logged subject. If the 6 most recently issued PACEs across subjects lack scores, the shipment pauses and the pick list is marked paused."}
        </p>
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button size="sm" variant="outline" onClick={saveSchedule} disabled={busy}>
            Save schedule
          </Button>
          <Button size="sm" variant="outline" onClick={runPickList} disabled={busy}>
            Generate pick list
          </Button>
          <Button size="sm" variant="outline" onClick={runReprescribe} disabled={busy}>
            Prescribe next 12 for {nextSchoolYear(schoolYear)}
          </Button>
        </div>
      </div>
    </div>
  );
}
