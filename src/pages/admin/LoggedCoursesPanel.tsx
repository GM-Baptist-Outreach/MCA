import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  currentSchoolYear,
  nextSchoolYear,
  paceRangeForLevel,
  reportLetter,
  suggestedFixedShipDates,
} from "@/lib/loggedCourses";

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
  mode: "fixed_dates" | "every_8_weeks";
  q1_ship_date: string;
  q2_ship_date: string;
  q3_ship_date: string;
  q4_ship_date: string;
  anchor_ship_date: string;
  next_ship_date: string;
  shipment_paused: boolean;
  pause_reason: string | null;
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
  const [subjectId, setSubjectId] = useState("");
  const [level, setLevel] = useState("7");
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [draftScore, setDraftScore] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [subjectRes, slotRes, scheduleRes] = await Promise.all([
      supabase.from("subjects").select("id, name").eq("active", true).order("name"),
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
          "id, mode, q1_ship_date, q2_ship_date, q3_ship_date, q4_ship_date, anchor_ship_date, next_ship_date, shipment_paused, pause_reason",
        )
        .eq("student_id", studentId)
        .eq("school_year", schoolYear)
        .maybeSingle(),
    ]);
    if (subjectRes.data) setSubjects(subjectRes.data);
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
        next_ship_date: row.next_ship_date ?? "",
        shipment_paused: row.shipment_paused,
        pause_reason: row.pause_reason,
      });
    } else {
      setSchedule(EMPTY_SCHEDULE(schoolYear));
    }
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
      return an.localeCompare(bn);
    });
  }, [slots, subjects]);

  const selected = slots.find((slot) => slot.id === selectedSlotId) ?? null;

  const prescribe = async () => {
    if (!subjectId) return;
    setBusy(true);
    const levelNum = Number(level);
    const { start } = paceRangeForLevel(levelNum);
    const { data: catalog, error } = await supabase
      .from("items")
      .select("id, pace_number, grade_level")
      .eq("subject_id", subjectId)
      .eq("item_type", "pace")
      .eq("active", true)
      .gte("pace_number", start)
      .lte("pace_number", start + 11)
      .order("pace_number");
    if (error) {
      toast({ title: "Couldn't load PACEs", description: error.message, variant: "destructive" });
      setBusy(false);
      return;
    }
    const byNumber = new Map<number, { id: string; grade_level: number | null }>();
    for (const item of catalog ?? []) {
      if (item.pace_number == null) continue;
      const existing = byNumber.get(item.pace_number);
      if (!existing || (item.grade_level === levelNum && existing.grade_level !== levelNum)) {
        byNumber.set(item.pace_number, item);
      }
    }
    const rows = [...byNumber.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 12)
      .map(([paceNumber, item], index) => ({
        student_id: studentId,
        subject_id: subjectId,
        school_year: schoolYear,
        slot_index: index + 1,
        pace_number: paceNumber,
        item_id: item.id,
        status: "prescribed",
      }));
    if (rows.length === 0) {
      toast({
        title: "Nothing to prescribe",
        description: "No active PACEs in that level for this subject.",
        variant: "destructive",
      });
      setBusy(false);
      return;
    }
    const locked = slots.filter(
      (slot) =>
        slot.subject_id === subjectId &&
        !["prescribed", "paused"].includes(slot.status),
    );
    if (locked.length > 0) {
      toast({
        title: "Some boxes are already issued",
        description: "Issued, scored, ordered, or in-stock boxes were left in place. Only open slots were rewritten.",
      });
    }
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
        setBusy(false);
        return;
      }
    }
    await supabase.from("required_pace_plans").upsert(
      {
        student_id: studentId,
        subject_id: subjectId,
        school_year: schoolYear,
        required_count: 12,
      },
      { onConflict: "student_id,subject_id,school_year" },
    );
    toast({ title: "Course prescribed", description: `${writable.length} PACE boxes saved for ${studentName}.` });
    setBusy(false);
    load();
  };

  const saveSchedule = async () => {
    setBusy(true);
    const payload = {
      student_id: studentId,
      school_year: schoolYear,
      mode: schedule.mode,
      q1_ship_date: schedule.q1_ship_date || null,
      q2_ship_date: schedule.q2_ship_date || null,
      q3_ship_date: schedule.q3_ship_date || null,
      q4_ship_date: schedule.q4_ship_date || null,
      anchor_ship_date: schedule.anchor_ship_date || null,
      next_ship_date: schedule.next_ship_date || null,
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
          <Label className="text-xs">Subject</Label>
          <Select value={subjectId} onValueChange={setSubjectId}>
            <SelectTrigger className="bg-background w-52 h-9">
              <SelectValue placeholder="Subject" />
            </SelectTrigger>
            <SelectContent>
              {subjects.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Level</Label>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="bg-background w-28 h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Array.from({ length: 12 }, (_, i) => String(i + 1)).map((value) => (
                <SelectItem key={value} value={value}>
                  Level {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={prescribe} disabled={busy || !subjectId}>
          Prescribe 12
        </Button>
      </div>

      {bySubject.length === 0 ? (
        <p className="text-sm text-foreground/60">No PACEs prescribed for {schoolYear}.</p>
      ) : (
        <div className="space-y-3 overflow-x-auto">
          {bySubject.map(([id, subjectSlots]) => (
            <div key={id} className="min-w-[760px]">
              <p className="text-sm font-medium mb-1">
                {subjects.find((subject) => subject.id === id)?.name ?? "Subject"}
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
                        {slot?.pace_number ?? "·"}
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
          ))}
        </div>
      )}

      {selected && (
        <div className="flex flex-wrap gap-2 items-end rounded-lg border border-border/60 p-3">
          <p className="text-sm w-full">
            PACE {selected.pace_number} · {selected.status}
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
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-3 rounded-lg border border-border/60 p-3">
        <div className="space-y-2">
          <Label className="text-xs">Ship mode</Label>
          <Select
            value={schedule.mode}
            onValueChange={(mode) =>
              setSchedule((current) => ({
                ...current,
                mode: mode as Schedule["mode"],
              }))
            }
          >
            <SelectTrigger className="bg-background h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fixed_dates">Fixed quarter dates</SelectItem>
              <SelectItem value="every_8_weeks">Every 8 weeks</SelectItem>
            </SelectContent>
          </Select>
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
        <p className="text-xs text-foreground/50 sm:col-span-2">
          2025-26: Q1 is the first 3 PACEs at enrollment, so that date stays
          blank. Q2 is 2025-10-26, Q3 is 2026-01-11, and Q4 is 2026-03-08.
          One week before the next ship date, pick-list generation takes the
          next 3 unissued PACEs in each logged subject. If the 6 most recently
          issued PACEs across subjects lack scores, the shipment pauses and
          the pick list is marked paused.
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
