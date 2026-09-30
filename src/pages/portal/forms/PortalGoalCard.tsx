import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, Printer } from "lucide-react";
import {
  compareSubjectNames,
  currentSchoolYear,
  subjectDisplayName,
} from "@/lib/loggedCourses";
import type { PortalContext } from "../PortalLayout";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;
type Day = (typeof DAYS)[number];

interface Subject {
  id: string;
  name: string;
}

interface GoalRow {
  subjectId: string;
  subjectName: string;
  goals: Record<Day, { value: string; done: boolean }>;
}

const emptyGoals = (): Record<Day, { value: string; done: boolean }> =>
  DAYS.reduce(
    (acc, d) => ({ ...acc, [d]: { value: "", done: false } }),
    {} as Record<Day, { value: string; done: boolean }>,
  );

function subjectNameOf(
  rel: { name: string } | { name: string }[] | null,
): string {
  if (Array.isArray(rel)) return rel[0]?.name ?? "Subject";
  return rel?.name ?? "Subject";
}

function mondayOf(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  return d.toISOString().slice(0, 10);
}

export default function PortalGoalCard() {
  const { family, selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [rows, setRows] = useState<GoalRow[]>([]);
  const [addSubjectId, setAddSubjectId] = useState("");
  const [existingSubmissionId, setExistingSubmissionId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedStudent) {
      setSubjects([]);
      return;
    }
    let ignore = false;
    supabase
      .from("student_pace_slots")
      .select("subject_id, subjects(name)")
      .eq("student_id", selectedStudent.id)
      .eq("school_year", currentSchoolYear())
      .then(({ data }) => {
        if (ignore) return;
        const map = new Map<string, string>();
        for (const slot of data ?? []) {
          map.set(
            slot.subject_id,
            subjectNameOf(
              slot.subjects as { name: string } | { name: string }[] | null,
            ),
          );
        }
        setSubjects(
          [...map.entries()]
            .map(([id, name]) => ({ id, name }))
            .sort((a, b) => compareSubjectNames(a.name, b.name)),
        );
      });
    return () => {
      ignore = true;
    };
  }, [selectedStudent?.id]);

  useEffect(() => {
    if (!selectedStudent) return;
    // Guards against a slower-resolving fetch for a previously-selected
    // student overwriting the currently-selected student's already-loaded
    // data if the parent switches students quickly.
    let ignore = false;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("form_submissions")
        .select("id, submitted_data")
        .eq("student_id", selectedStudent.id)
        .eq("form_type", "goal_card")
        .filter("submitted_data->>week_start", "eq", weekStart)
        .maybeSingle();

      if (ignore) return;

      if (data) {
        setExistingSubmissionId(data.id);
        setRows(data.submitted_data.rows ?? []);
      } else {
        setExistingSubmissionId(null);
        const { data: prescribed } = await supabase
          .from("student_pace_slots")
          .select("subject_id, subjects(name)")
          .eq("student_id", selectedStudent.id)
          .eq("school_year", currentSchoolYear());
        if (ignore) return;
        const seen = new Set<string>();
        const seeded: GoalRow[] = [];
        for (const slot of prescribed ?? []) {
          if (seen.has(slot.subject_id)) continue;
          seen.add(slot.subject_id);
          seeded.push({
            subjectId: slot.subject_id,
            subjectName: subjectNameOf(
              slot.subjects as { name: string } | { name: string }[] | null,
            ),
            goals: emptyGoals(),
          });
        }
        seeded.sort((a, b) => compareSubjectNames(a.subjectName, b.subjectName));
        setRows(seeded);
      }
      setLoading(false);
    };
    load();
    return () => {
      ignore = true;
    };
  }, [selectedStudent?.id, weekStart]);

  const addSubjectRow = () => {
    if (!addSubjectId) return;
    const subject = subjects.find((s) => s.id === addSubjectId);
    if (!subject || rows.some((r) => r.subjectId === subject.id)) return;
    setRows((r) => [
      ...r,
      { subjectId: subject.id, subjectName: subject.name, goals: emptyGoals() },
    ]);
    setAddSubjectId("");
  };

  const removeRow = (subjectId: string) => {
    setRows((r) => r.filter((row) => row.subjectId !== subjectId));
  };

  const updateGoal = (subjectId: string, day: Day, value: string) => {
    setRows((r) =>
      r.map((row) =>
        row.subjectId === subjectId
          ? {
              ...row,
              goals: { ...row.goals, [day]: { ...row.goals[day], value } },
            }
          : row,
      ),
    );
  };

  const toggleDone = (subjectId: string, day: Day) => {
    setRows((r) =>
      r.map((row) =>
        row.subjectId === subjectId
          ? {
              ...row,
              goals: {
                ...row.goals,
                [day]: { ...row.goals[day], done: !row.goals[day].done },
              },
            }
          : row,
      ),
    );
  };

  const handleSave = async () => {
    if (!selectedStudent) return;
    setSaving(true);

    const submittedData = { week_start: weekStart, rows };
    const signedAt = new Date().toISOString();

    if (existingSubmissionId) {
      const { error } = await supabase
        .from("form_submissions")
        .update({
          submitted_data: submittedData,
          signer_name: family.parent_name,
          signed_at: signedAt,
        })
        .eq("id", existingSubmissionId);
      if (error) {
        toast({
          title: "Couldn't save",
          description: error.message,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("form_submissions")
        .insert({
          family_id: family.id,
          student_id: selectedStudent.id,
          form_type: "goal_card",
          submitted_data: submittedData,
          signer_name: family.parent_name,
          signed_at: signedAt,
        })
        .select()
        .single();
      if (error) {
        toast({
          title: "Couldn't save",
          description: error.message,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      setExistingSubmissionId(data.id);
    }

    toast({ title: "Goal card saved" });
    setSaving(false);
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=800,height=900");
    if (!printWindow) return;

    const rowsHtml = rows
      .map(
        (row) => `
        <tr>
          <td class="subject">${subjectDisplayName(row.subjectName)}</td>
          ${DAYS.map(
            (d) =>
              `<td class="${row.goals[d].done ? "done" : ""}">${row.goals[d].value || ""}${
                row.goals[d].done ? '<span class="x-mark">X</span>' : ""
              }</td>`,
          ).join("")}
        </tr>`,
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Goal Card — ${selectedStudent?.student_name ?? ""}</title>
          <style>
            body { font-family: Georgia, serif; padding: 40px; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #999; padding: 12px; text-align: center; position: relative; min-width: 70px; }
            th { background: #f2f2f2; }
            td.subject { text-align: left; font-weight: bold; }
            .x-mark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 24px; color: #c0392b; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>Weekly Goal Card — ${selectedStudent?.student_name ?? ""}</h1>
          <div class="subtitle">Week of ${weekStart}</div>
          <table>
            <thead><tr><th>Subject</th>${DAYS.map((d) => `<th>${d}</th>`).join("")}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (!selectedStudent) {
    return (
      <p className="text-foreground/60">
        Select a student above to use the goal card.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">
            Weekly Goal Card
          </h2>
          <p className="text-sm text-foreground/60">
            {selectedStudent.student_name}. Logged subjects start the week.
            Fill in daily goals and save — this week is stored with the
            student's forms.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            type="date"
            className="bg-background w-40"
            value={weekStart}
            onChange={(e) => setWeekStart(mondayOf(new Date(e.target.value)))}
          />
          <Button variant="outline" onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <>
          <div className="rounded-xl border border-border/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="p-3 text-left">Subject</th>
                  {DAYS.map((d) => (
                    <th key={d} className="p-3">
                      {d}
                    </th>
                  ))}
                  <th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.subjectId} className="border-t border-border/50">
                    <td className="p-3 font-medium">{subjectDisplayName(row.subjectName)}</td>
                    {DAYS.map((d) => (
                      <td key={d} className="p-2">
                        <div className="flex items-center justify-center gap-1">
                          <Input
                            className="bg-background h-9 w-24 text-center"
                            value={row.goals[d].value}
                            onChange={(e) =>
                              updateGoal(row.subjectId, d, e.target.value)
                            }
                            placeholder="pg #"
                            aria-label={`${row.subjectName} ${d} page`}
                          />
                          <button
                            type="button"
                            onClick={() => toggleDone(row.subjectId, d)}
                            className={`h-9 w-9 shrink-0 rounded border text-sm font-bold ${
                              row.goals[d].done
                                ? "border-destructive text-destructive"
                                : "border-border text-foreground/30"
                            }`}
                            title={
                              row.goals[d].done ? "Mark not done" : "Mark done"
                            }
                            aria-label={
                              row.goals[d].done
                                ? `${row.subjectName} ${d} mark not done`
                                : `${row.subjectName} ${d} mark done`
                            }
                          >
                            {row.goals[d].done ? "X" : ""}
                          </button>
                        </div>
                      </td>
                    ))}
                    <td className="p-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => removeRow(row.subjectId)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td
                      colSpan={DAYS.length + 2}
                      className="p-6 text-center text-foreground/60"
                    >
                      Add a subject to start this week's goals.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center gap-2">
            <Select value={addSubjectId} onValueChange={setAddSubjectId}>
              <SelectTrigger className="bg-background w-56">
                <SelectValue placeholder="Add a subject" />
              </SelectTrigger>
              <SelectContent>
                {subjects
                  .filter((s) => !rows.some((r) => r.subjectId === s.id))
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {subjectDisplayName(s.name)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              onClick={addSubjectRow}
              disabled={!addSubjectId}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Subject
            </Button>
          </div>

          <p className="text-xs text-foreground/50">
            Type a page number in each day. Use the X button to mark that goal
            done. The page number stays in the box and is saved with the week.
          </p>

          <Button onClick={handleSave} disabled={saving || rows.length === 0}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </>
      )}
    </div>
  );
}
