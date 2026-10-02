import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import LoggedCoursesPanel from "./LoggedCoursesPanel";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  ChevronsUpDown,
  FileText,
  GraduationCap,
} from "lucide-react";

interface Family {
  id: string;
  parent_name: string;
  second_parent_name: string | null;
  email: string;
  phone: string;
  address: string | null;
}

interface Enrollment {
  id: string;
  tuition_tier: string;
  frequency: string | null;
  price: number | null;
  status: string;
  current_period_end: string | null;
  is_comp: boolean;
  comp_reason: string | null;
}

export interface FormSubmission {
  id: string;
  form_type: string;
  submitted_data: Record<string, any>;
  signer_name: string;
  signed_at: string;
}

interface CourseCompletion {
  id: string;
  subject_name: string;
  school_year: string;
  final_average: number | null;
  letter_grade: string | null;
  credit_earned: number;
}

interface Student {
  id: string;
  student_name: string;
  gender: string | null;
  birthdate: string | null;
  last_grade_completed: string | null;
  enrollments: Enrollment[];
  formSubmissions: FormSubmission[];
  completions: CourseCompletion[];
}

interface Order {
  id: string;
  status: string;
  payment_status: string;
  total: number;
  created_at: string;
}

export const FORM_TYPE_LABELS: Record<string, string> = {
  enrollment_agreement: "Enrollment Agreement",
  records_release: "Records Release",
  honesty_policy: "Honesty Policy",
  elementary_course_verification: "Course Verification",
  goal_card: "Goal Card",
  pe_activity_log: "P.E. Activity Log",
  music_practice_verification: "Music Practice Verification",
};

function formatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Standard unweighted 4.0 scale, matched to the exact letter-grade cutoffs
// shown on MCA's own transcript form.
function gradeFromAverage(avg: number): { letter: string; points: number } {
  if (avg >= 98) return { letter: "A+", points: 4.0 };
  if (avg >= 96) return { letter: "A", points: 4.0 };
  if (avg >= 94) return { letter: "A-", points: 3.7 };
  if (avg >= 92) return { letter: "B+", points: 3.3 };
  if (avg >= 90) return { letter: "B", points: 3.0 };
  if (avg >= 88) return { letter: "B-", points: 2.7 };
  if (avg >= 86) return { letter: "C+", points: 2.3 };
  if (avg >= 83) return { letter: "C", points: 2.0 };
  if (avg >= 80) return { letter: "C-", points: 1.7 };
  if (avg >= 76) return { letter: "D+", points: 1.3 };
  if (avg >= 74) return { letter: "D", points: 1.0 };
  return { letter: "F", points: 0.0 };
}

// ---------------------------------------------------------------------------
// Form submission rendering
//
// Every known form_type gets an explicit, human-readable renderer based on
// the exact `submitted_data` shape written by its portal form
// (src/pages/portal/forms/*.tsx). Anything unexpected falls through to a
// generic recursive renderer, so nothing is ever hidden and raw JSON is only
// shown behind the collapsed "View raw submitted data" toggle.
// ---------------------------------------------------------------------------

const WEEKDAYS_MON_SUN = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAYS_MON_FRI = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

type Json = unknown;

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlank(value: Json): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0 || value.every(isBlank);
  if (isPlainObject(value)) return Object.values(value).every(isBlank);
  return false;
}

function isScalar(value: Json): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatScalar(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function asString(value: Json): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-foreground/50">{label}</span>
      <span className="text-foreground text-right break-words">{value}</span>
    </div>
  );
}

function SectionHeading({ children }: { children: ReactNode }) {
  return (
    <p className="pt-2 text-xs font-semibold uppercase tracking-wide text-foreground/60">
      {children}
    </p>
  );
}

/** Label/value rows for the top-level scalar fields (skipping `exclude`). */
function ScalarFields({
  data,
  exclude = [],
}: {
  data: Record<string, Json>;
  exclude?: string[];
}) {
  const rows = Object.entries(data).filter(
    ([key, value]) => !exclude.includes(key) && isScalar(value) && !isBlank(value),
  );
  if (rows.length === 0) return null;
  return (
    <div className="space-y-1">
      {rows.map(([key, value]) => (
        <FieldRow
          key={key}
          label={formatKey(key)}
          value={formatScalar(value as string | number | boolean)}
        />
      ))}
    </div>
  );
}

/**
 * Generic recursive renderer for any nested value: objects become indented
 * label/value lists, arrays of objects become numbered sub-lists, arrays of
 * scalars become comma-separated values. Never raw JSON.
 */
function NestedValue({ value }: { value: Json }) {
  if (isScalar(value)) {
    return <span className="text-foreground">{formatScalar(value)}</span>;
  }
  if (Array.isArray(value)) {
    const items = value.filter((v) => !isBlank(v));
    if (items.length === 0) return null;
    if (items.every(isScalar)) {
      return (
        <span className="text-foreground">
          {items.map((v) => formatScalar(v as string | number | boolean)).join(", ")}
        </span>
      );
    }
    return (
      <div className="space-y-2">
        {items.map((item, i) => (
          <div
            key={i}
            className="rounded-md border border-border/50 bg-secondary/30 p-2 space-y-1"
          >
            <p className="text-xs font-medium text-foreground/60">#{i + 1}</p>
            <NestedValue value={item} />
          </div>
        ))}
      </div>
    );
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value).filter(([, v]) => !isBlank(v));
    if (entries.length === 0) return null;
    return (
      <div className="space-y-1">
        {entries.map(([k, v]) =>
          isScalar(v) ? (
            <FieldRow key={k} label={formatKey(k)} value={formatScalar(v)} />
          ) : (
            <div key={k} className="space-y-1">
              <p className="text-foreground/50">{formatKey(k)}</p>
              <div className="pl-3 border-l border-border/50">
                <NestedValue value={v} />
              </div>
            </div>
          ),
        )}
      </div>
    );
  }
  return null;
}

/** Renders every non-scalar top-level field (skipping `exclude`) generically. */
function NestedFields({
  data,
  exclude = [],
}: {
  data: Record<string, Json>;
  exclude?: string[];
}) {
  const entries = Object.entries(data).filter(
    ([key, value]) => !exclude.includes(key) && !isScalar(value) && !isBlank(value),
  );
  if (entries.length === 0) return null;
  return (
    <>
      {entries.map(([key, value]) => (
        <div key={key} className="space-y-1">
          <SectionHeading>{formatKey(key)}</SectionHeading>
          <NestedValue value={value} />
        </div>
      ))}
    </>
  );
}

/** students[] (Honesty Policy, Records Release): one small card per student. */
function StudentList({ students }: { students: Json }) {
  if (!Array.isArray(students) || students.length === 0) return null;
  return (
    <div className="space-y-1">
      <SectionHeading>
        {students.length === 1 ? "Student" : `Students (${students.length})`}
      </SectionHeading>
      <div className="space-y-2">
        {students.map((s, i) => (
          <div
            key={i}
            className="rounded-md border border-border/50 bg-secondary/30 p-2 space-y-1"
          >
            {isPlainObject(s) ? (
              <>
                {"student_name" in s && !isBlank(s.student_name) && (
                  <p className="font-medium text-foreground">
                    {asString(s.student_name)}
                  </p>
                )}
                <NestedValue
                  value={Object.fromEntries(
                    Object.entries(s).filter(([k]) => k !== "student_name"),
                  )}
                />
              </>
            ) : (
              <NestedValue value={s} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** core_grades / additional_subjects (Course Verification): [{subject, grade}] */
function SubjectGradeTable({ title, rows }: { title: string; rows: Json }) {
  if (!Array.isArray(rows)) return null;
  const items = rows
    .filter(isPlainObject)
    .filter((r) => !isBlank(r.subject) || !isBlank(r.grade));
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <SectionHeading>{title}</SectionHeading>
      <div className="overflow-x-auto rounded-md border border-border/50">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="p-2">Subject</th>
              <th className="p-2">Grade</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r, i) => (
              <tr key={i} className="border-t">
                <td className="p-2">{asString(r.subject) || "—"}</td>
                <td className="p-2">{asString(r.grade) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** pe_activity_log: weeks[] of { Sun..Sat: { checked, activity } } */
function PeLogTable({ weeks }: { weeks: Json[] }) {
  const normalized = weeks.map((w) => {
    const row = isPlainObject(w) ? w : {};
    return WEEKDAYS_MON_SUN.map((d) => {
      const cell = row[d];
      if (typeof cell === "boolean") return { checked: cell, activity: "" };
      if (isPlainObject(cell))
        return { checked: cell.checked === true, activity: asString(cell.activity).trim() };
      return { checked: false, activity: "" };
    });
  });
  const visible = normalized
    .map((days, i) => ({ days, weekNumber: i + 1 }))
    .filter(({ days }) => days.some((d) => d.checked || d.activity));
  const totalChecked = normalized.reduce(
    (sum, days) => sum + days.filter((d) => d.checked).length,
    0,
  );
  const hiddenCount = normalized.length - visible.length;

  return (
    <div className="space-y-1">
      <SectionHeading>Weekly Activity</SectionHeading>
      {visible.length === 0 ? (
        <p className="text-foreground/60">No activity entered for any week.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-2">Week</th>
                {WEEKDAYS_MON_SUN.map((d) => (
                  <th key={d} className="p-2 text-center">
                    {d}
                  </th>
                ))}
                <th className="p-2 text-center">Days</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ days, weekNumber }) => (
                <tr key={weekNumber} className="border-t align-top">
                  <td className="p-2 whitespace-nowrap">Week {weekNumber}</td>
                  {days.map((d, i) => (
                    <td key={i} className="p-2 text-center">
                      {d.checked && (
                        <Check
                          className="h-4 w-4 text-primary mx-auto"
                          aria-label="Checked"
                        />
                      )}
                      {d.activity && (
                        <span className="block text-xs text-foreground/70">
                          {d.activity}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="p-2 text-center">
                    {days.filter((d) => d.checked).length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2 text-xs text-foreground/60">
        <span>
          {hiddenCount > 0
            ? `Weeks with no entries are hidden (${hiddenCount} of ${normalized.length}).`
            : `${normalized.length} weeks shown.`}
        </span>
        <span className="font-medium text-foreground">
          Total checked days: {totalChecked} (≈{totalChecked * 30} min)
        </span>
      </div>
    </div>
  );
}

/** music_practice_verification: weeks[] of { Sun..Sat: "minutes" } */
function MusicPracticeTable({ weeks }: { weeks: Json[] }) {
  const TARGET = 150; // minutes/week, per PortalMusicVerification
  const normalized = weeks.map((w) => {
    const row = isPlainObject(w) ? w : {};
    return WEEKDAYS_MON_SUN.map((d) => asString(row[d]).trim());
  });
  const minutesOf = (v: string) => parseInt(v, 10) || 0;
  const visible = normalized
    .map((days, i) => ({
      days,
      weekNumber: i + 1,
      total: days.reduce((s, v) => s + minutesOf(v), 0),
    }))
    .filter(({ days }) => days.some((v) => v !== ""));
  const grandTotal = visible.reduce((s, w) => s + w.total, 0);
  const hiddenCount = normalized.length - visible.length;

  return (
    <div className="space-y-1">
      <SectionHeading>Practice Minutes</SectionHeading>
      {visible.length === 0 ? (
        <p className="text-foreground/60">No practice minutes entered.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-2">Week</th>
                {WEEKDAYS_MON_SUN.map((d) => (
                  <th key={d} className="p-2 text-center">
                    {d}
                  </th>
                ))}
                <th className="p-2 text-center">Total</th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ days, weekNumber, total }) => (
                <tr key={weekNumber} className="border-t">
                  <td className="p-2 whitespace-nowrap">Week {weekNumber}</td>
                  {days.map((v, i) => (
                    <td key={i} className="p-2 text-center">
                      {v || <span className="text-foreground/30">—</span>}
                    </td>
                  ))}
                  <td
                    className={cn(
                      "p-2 text-center font-medium",
                      total >= TARGET ? "text-primary" : "text-foreground/70",
                    )}
                  >
                    {total}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex flex-wrap justify-between gap-2 text-xs text-foreground/60">
        <span>
          Minutes per day. Goal: {TARGET} min/week.
          {hiddenCount > 0 &&
            ` Weeks with no entries are hidden (${hiddenCount} of ${normalized.length}).`}
        </span>
        <span className="font-medium text-foreground">
          Total: {grandTotal} min ({(grandTotal / 60).toFixed(1)} hrs)
        </span>
      </div>
    </div>
  );
}

/** goal_card: rows[] of { subjectId, subjectName, goals: { Mon..Fri: { value, done } } } */
function GoalCardTable({ rows }: { rows: Json[] }) {
  const items = rows.filter(isPlainObject);
  let doneCount = 0;
  let goalCount = 0;
  const normalized = items.map((r) => {
    const goals = isPlainObject(r.goals) ? r.goals : {};
    const days = WEEKDAYS_MON_FRI.map((d) => {
      const g = goals[d];
      const cell = isPlainObject(g)
        ? { value: asString(g.value).trim(), done: g.done === true }
        : { value: asString(g).trim(), done: false };
      if (cell.value || cell.done) goalCount += 1;
      if (cell.done) doneCount += 1;
      return cell;
    });
    return { subject: asString(r.subjectName) || "Subject", days };
  });

  return (
    <div className="space-y-1">
      <SectionHeading>Daily Goals</SectionHeading>
      {normalized.length === 0 ? (
        <p className="text-foreground/60">No subjects added for this week.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-2">Subject</th>
                {WEEKDAYS_MON_FRI.map((d) => (
                  <th key={d} className="p-2 text-center">
                    {d}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalized.map((row, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="p-2">{row.subject}</td>
                  {row.days.map((c, j) => (
                    <td key={j} className="p-2 text-center">
                      <span className="inline-flex items-center gap-1">
                        {c.value || (!c.done && <span className="text-foreground/30">—</span>)}
                        {c.done && (
                          <Check className="h-4 w-4 text-primary" aria-label="Done" />
                        )}
                      </span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-foreground/60 text-right">
        <span className="font-medium text-foreground">
          Goals completed: {doneCount} of {goalCount}
        </span>
      </p>
    </div>
  );
}

function SubmissionDetails({ submission }: { submission: FormSubmission }) {
  const data: Record<string, Json> = isPlainObject(submission.submitted_data)
    ? submission.submitted_data
    : {};

  switch (submission.form_type) {
    // { father_name, mother_name, mailing_address, shipping_address, phone,
    //   email, supervisor_name, supervisor_familiar_with_ace (bool),
    //   student_name, student_gender, student_birthdate, last_school_attended,
    //   last_grade_completed, last_grade_when } -- all scalars
    case "enrollment_agreement":
      return (
        <>
          <ScalarFields data={data} />
          <NestedFields data={data} />
        </>
      );

    // { release_date, requesting_school_name, requesting_school_address,
    //   students: [{ student_name, birthdate, grade_level_at_withdrawal }] }
    // honesty_policy: { students: [{ student_name, student_signature }] }
    case "records_release":
    case "honesty_policy":
      return (
        <>
          <ScalarFields data={data} />
          <StudentList students={data.students} />
          <NestedFields data={data} exclude={["students"]} />
        </>
      );

    // { student_name, age, last_grade_completed, address,
    //   parent_guardian_name, core_grades: [{subject, grade}],
    //   additional_subjects: [{subject, grade}], days_per_week, hours_per_day,
    //   started_next_grade, weeks_completed, comments }
    case "elementary_course_verification":
      return (
        <>
          <ScalarFields data={data} />
          <SubjectGradeTable title="Core Subjects" rows={data.core_grades} />
          <SubjectGradeTable
            title="Additional Subjects"
            rows={data.additional_subjects}
          />
          <NestedFields
            data={data}
            exclude={["core_grades", "additional_subjects"]}
          />
        </>
      );

    // { week_start, rows: [{ subjectId, subjectName, goals: {Mon..Fri: {value, done}} }] }
    case "goal_card": {
      const weekStart = asString(data.week_start);
      return (
        <>
          {weekStart && (
            <FieldRow
              label="Week Of"
              value={
                /^\d{4}-\d{2}-\d{2}$/.test(weekStart)
                  ? new Date(`${weekStart}T00:00:00`).toLocaleDateString()
                  : weekStart
              }
            />
          )}
          <ScalarFields data={data} exclude={["week_start"]} />
          {Array.isArray(data.rows) ? (
            <GoalCardTable rows={data.rows} />
          ) : null}
          <NestedFields
            data={data}
            exclude={Array.isArray(data.rows) ? ["rows"] : []}
          />
        </>
      );
    }

    // { school_year, quarter, weeks: [{Sun..Sat: {checked, activity}}], verification }
    case "pe_activity_log":
      return (
        <>
          <ScalarFields data={data} />
          {Array.isArray(data.weeks) ? <PeLogTable weeks={data.weeks} /> : null}
          <NestedFields
            data={data}
            exclude={Array.isArray(data.weeks) ? ["weeks"] : []}
          />
        </>
      );

    // { school_year, quarter, from_date, to_date, weeks: [{Sun..Sat: "minutes"}],
    //   practice_verification, performance_title, instrument, performance_date,
    //   parent_signature, pastor_teacher_signature }
    case "music_practice_verification":
      return (
        <>
          <ScalarFields data={data} />
          {Array.isArray(data.weeks) ? (
            <MusicPracticeTable weeks={data.weeks} />
          ) : null}
          <NestedFields
            data={data}
            exclude={Array.isArray(data.weeks) ? ["weeks"] : []}
          />
        </>
      );

    // Unknown form type: render everything generically.
    default:
      return (
        <>
          <ScalarFields data={data} />
          <NestedFields data={data} />
        </>
      );
  }
}

export function FormSubmissionCard({
  submission,
  hideRaw = false,
  subtitle,
}: {
  submission: FormSubmission;
  hideRaw?: boolean;
  subtitle?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasData =
    isPlainObject(submission.submitted_data) &&
    !isBlank(submission.submitted_data);

  return (
    <div className="rounded-lg border border-border/50 bg-background p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <p className="font-medium text-foreground">
            {FORM_TYPE_LABELS[submission.form_type] ?? formatKey(submission.form_type)}
          </p>
          <p className="text-xs text-foreground/50">
            {subtitle ? `${subtitle} · ` : ""}Signed by {submission.signer_name} on{" "}
            {new Date(submission.signed_at).toLocaleString()}
          </p>
        </div>
        {expanded ? (
          <ChevronDown className="h-4 w-4 text-foreground/50" />
        ) : (
          <ChevronRightIcon className="h-4 w-4 text-foreground/50" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-2 text-sm">
          {hasData ? (
            <SubmissionDetails submission={submission} />
          ) : (
            <p className="text-foreground/60">No data was entered on this form.</p>
          )}
          {!hideRaw && (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs text-primary">
                View raw submitted data
              </summary>
              <pre className="mt-2 text-xs bg-secondary/50 p-3 rounded-md overflow-x-auto">
                {JSON.stringify(submission.submitted_data, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function CourseCompletionForm({
  studentId,
  subjectNameOptions,
  onSaved,
}: {
  studentId: string;
  subjectNameOptions: string[];
  onSaved: () => void;
}) {
  const [subjectName, setSubjectName] = useState("");
  const [subjectQuery, setSubjectQuery] = useState("");
  const [subjectPopoverOpen, setSubjectPopoverOpen] = useState(false);
  const [schoolYear, setSchoolYear] = useState("");
  const [finalAverage, setFinalAverage] = useState("");
  const [creditEarned, setCreditEarned] = useState("1.00");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const avgNum = finalAverage ? parseFloat(finalAverage) : null;
  const gradePreview =
    avgNum != null && !isNaN(avgNum) ? gradeFromAverage(avgNum) : null;
  const isInProgress = !finalAverage.trim();

  const handleSave = async () => {
    setError(null);
    const creditNum = parseFloat(creditEarned);
    if (!subjectName.trim() || !schoolYear.trim() || isNaN(creditNum)) {
      setError("Subject, school year, and a valid credit value are required.");
      return;
    }
    if (finalAverage && (avgNum == null || isNaN(avgNum))) {
      setError(
        "Final average must be a number, or leave it blank to mark this course in progress.",
      );
      return;
    }
    setSaving(true);

    const { error: insertError } = await supabase
      .from("course_completions")
      .insert({
        student_id: studentId,
        subject_name: subjectName.trim(),
        school_year: schoolYear.trim(),
        final_average: avgNum,
        letter_grade: gradePreview?.letter ?? null,
        credit_earned: creditNum,
      });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setSubjectName("");
    setSubjectQuery("");
    setSchoolYear("");
    setFinalAverage("");
    setCreditEarned("1.00");
    setSaving(false);
    onSaved();
  };

  return (
    <div className="rounded-lg border border-border/50 bg-background p-4 space-y-3">
      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="space-y-1 sm:col-span-2">
          <Label className="text-xs">Subject</Label>
          <Popover
            open={subjectPopoverOpen}
            onOpenChange={setSubjectPopoverOpen}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={subjectPopoverOpen}
                className="w-full justify-between bg-secondary h-9 font-normal"
              >
                <span className="truncate">
                  {subjectName || "Type or pick a subject"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
              <Command>
                <CommandInput
                  placeholder="Search or type a new subject..."
                  value={subjectQuery}
                  onValueChange={setSubjectQuery}
                />
                <CommandList>
                  <CommandEmpty>
                    {subjectQuery.trim() && (
                      <button
                        type="button"
                        className="w-full px-2 py-1.5 text-left text-sm hover:bg-secondary rounded-sm"
                        onClick={() => {
                          setSubjectName(subjectQuery.trim());
                          setSubjectPopoverOpen(false);
                        }}
                      >
                        Use "{subjectQuery.trim()}"
                      </button>
                    )}
                  </CommandEmpty>
                  <CommandGroup>
                    {subjectNameOptions.map((name) => (
                      <CommandItem
                        key={name}
                        value={name}
                        onSelect={() => {
                          setSubjectName(name);
                          setSubjectQuery("");
                          setSubjectPopoverOpen(false);
                        }}
                      >
                        <Check
                          className={cn(
                            "mr-2 h-4 w-4",
                            subjectName === name ? "opacity-100" : "opacity-0",
                          )}
                        />
                        {name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">School Year</Label>
          <Input
            className="bg-secondary h-9"
            placeholder="2025-2026"
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Final Average</Label>
          <Input
            className="bg-secondary h-9"
            type="number"
            step="0.01"
            value={finalAverage}
            onChange={(e) => setFinalAverage(e.target.value)}
            placeholder="Leave blank if in progress"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Credit</Label>
          <Input
            className="bg-secondary h-9"
            type="number"
            step="0.25"
            value={creditEarned}
            onChange={(e) => setCreditEarned(e.target.value)}
          />
        </div>
      </div>
      <Button size="sm" onClick={handleSave} disabled={saving}>
        {saving
          ? "Saving..."
          : isInProgress
            ? "Log Course In Progress"
            : `Log Completed Course${gradePreview ? ` (${gradePreview.letter})` : ""}`}
      </Button>
    </div>
  );
}

const AdminFamilyDetail = () => {
  const { familyId } = useParams<{ familyId: string }>();
  const { toast } = useToast();
  const [family, setFamily] = useState<Family | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [subjectNameOptions, setSubjectNameOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompletionForm, setShowCompletionForm] = useState<string | null>(
    null,
  );
  const [sendingPaymentLinkId, setSendingPaymentLinkId] = useState<
    string | null
  >(null);

  const sendPaymentLink = async (enrollmentId: string) => {
    setSendingPaymentLinkId(enrollmentId);
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    const res = await fetch(
      "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1/send-payment-link",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentSession?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enrollment_id: enrollmentId }),
      },
    );
    const result = await res.json();

    if (!res.ok || result.error) {
      toast({
        title: "Couldn't send payment link",
        description:
          result.error || "Check the send-payment-link function logs.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Payment link sent",
        description: `Emailed to ${result.emailed_to} — ${result.frequency}, $${result.price}.`,
      });
    }
    setSendingPaymentLinkId(null);
  };

  const load = async () => {
    if (!familyId) return;
    setLoading(true);

    const [
      familyRes,
      studentsRes,
      ordersRes,
      catalogSubjectsRes,
      reqSubjectsRes,
    ] = await Promise.all([
      supabase
        .from("families")
        .select("id, parent_name, second_parent_name, email, phone, address")
        .eq("id", familyId)
        .single(),
      supabase
        .from("students")
        .select("id, student_name, gender, birthdate, last_grade_completed")
        .eq("family_id", familyId)
        .order("student_name"),
      supabase
        .from("orders")
        .select("id, status, payment_status, total, created_at")
        .eq("family_id", familyId)
        .order("created_at", { ascending: false }),
      supabase.from("subjects").select("name").order("name"),
      supabase
        .from("graduation_requirements")
        .select("subject_name")
        .order("sort_order"),
    ]);

    if (familyRes.data) setFamily(familyRes.data);
    if (ordersRes.data) setOrders(ordersRes.data);

    const names = new Set<string>();
    (catalogSubjectsRes.data ?? []).forEach((s: any) => names.add(s.name));
    (reqSubjectsRes.data ?? []).forEach((s: any) => names.add(s.subject_name));
    setSubjectNameOptions(Array.from(names).sort());

    if (studentsRes.data) {
      const studentIds = studentsRes.data.map((s) => s.id);
      const [enrollmentsRes, formsRes, completionsRes] = await Promise.all([
        studentIds.length > 0
          ? supabase
              .from("enrollments")
              .select(
                "id, student_id, tuition_tier, frequency, price, status, current_period_end, is_comp, comp_reason",
              )
              .in("student_id", studentIds)
          : Promise.resolve({ data: [] as any[] }),
        studentIds.length > 0
          ? supabase
              .from("form_submissions")
              .select(
                "id, student_id, form_type, submitted_data, signer_name, signed_at",
              )
              .in("student_id", studentIds)
              .order("signed_at", { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
        studentIds.length > 0
          ? supabase
              .from("course_completions")
              .select(
                "id, student_id, subject_name, school_year, final_average, letter_grade, credit_earned",
              )
              .in("student_id", studentIds)
              .order("school_year", { ascending: false })
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const enrollmentsByStudent = new Map<string, Enrollment[]>();
      (enrollmentsRes.data ?? []).forEach((e: any) => {
        const list = enrollmentsByStudent.get(e.student_id) ?? [];
        list.push(e);
        enrollmentsByStudent.set(e.student_id, list);
      });

      const formsByStudent = new Map<string, FormSubmission[]>();
      (formsRes.data ?? []).forEach((f: any) => {
        const list = formsByStudent.get(f.student_id) ?? [];
        list.push(f);
        formsByStudent.set(f.student_id, list);
      });

      const completionsByStudent = new Map<string, CourseCompletion[]>();
      (completionsRes.data ?? []).forEach((c: any) => {
        const list = completionsByStudent.get(c.student_id) ?? [];
        list.push(c);
        completionsByStudent.set(c.student_id, list);
      });

      setStudents(
        studentsRes.data.map((s) => ({
          ...s,
          enrollments: enrollmentsByStudent.get(s.id) ?? [],
          formSubmissions: formsByStudent.get(s.id) ?? [],
          completions: completionsByStudent.get(s.id) ?? [],
        })),
      );
    }

    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [familyId]);

  if (loading) return <p className="text-foreground/60">Loading...</p>;
  if (!family) return <p className="text-foreground/60">Family not found.</p>;

  return (
    <div className="space-y-6">
      <Link
        to="/admin/families"
        className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Families
      </Link>

      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">
          {family.parent_name}
          {family.second_parent_name && ` & ${family.second_parent_name}`}
        </h2>
        <p className="text-sm text-foreground/60">
          {family.email} · {family.phone}
        </p>
        {family.address && (
          <p className="text-sm text-foreground/60">{family.address}</p>
        )}
      </div>

      <div className="space-y-6">
        {students.map((student) => (
          <div
            key={student.id}
            className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4"
          >
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h3 className="font-semibold text-foreground text-lg">
                {student.student_name}
              </h3>
              <div className="flex items-center gap-3">
                <div className="text-xs text-foreground/50">
                  {student.gender && (
                    <span className="capitalize">{student.gender} · </span>
                  )}
                  {student.birthdate && (
                    <span>
                      {new Date(student.birthdate).toLocaleDateString()} ·{" "}
                    </span>
                  )}
                  {student.last_grade_completed && (
                    <span>Last grade: {student.last_grade_completed}</span>
                  )}
                </div>
                <Link
                  to={`/admin/families/${familyId}/students/${student.id}/transcript`}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <FileText className="h-3.5 w-3.5" /> Transcript
                </Link>
                <Link
                  to={`/admin/families/${familyId}/students/${student.id}/projection`}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <GraduationCap className="h-3.5 w-3.5" /> Graduation
                  Projection
                </Link>
              </div>
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-foreground/50 mb-2">
                Enrollment
              </p>
              {student.enrollments.length === 0 ? (
                <p className="text-sm text-foreground/60">
                  No enrollment on file.
                </p>
              ) : (
                <div className="space-y-2">
                  {student.enrollments.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-lg border border-border/50 bg-background p-3 text-sm flex flex-wrap gap-x-6 gap-y-1"
                    >
                      <span className="capitalize">
                        <strong>Tier:</strong>{" "}
                        {e.tuition_tier.replace("_", " ")}
                      </span>
                      <span className="capitalize">
                        <strong>Plan:</strong> {e.frequency}
                        {e.price != null && ` — $${e.price}`}
                      </span>
                      {e.is_comp && (
                        <span className="flex items-center gap-2">
                          <span
                            className="text-xs font-medium px-2 py-1 rounded-full bg-amber-500/10 text-amber-700 self-center"
                            title={e.comp_reason ?? undefined}
                          >
                            Comp — No Payment
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={sendingPaymentLinkId === e.id}
                            onClick={() => sendPaymentLink(e.id)}
                          >
                            {sendingPaymentLinkId === e.id
                              ? "Sending..."
                              : "Send Payment Link"}
                          </Button>
                        </span>
                      )}
                      <span className="capitalize">
                        <strong>Status:</strong> {e.status}
                      </span>
                      {e.current_period_end && (
                        <span>
                          <strong>Renews:</strong>{" "}
                          {new Date(e.current_period_end).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <LoggedCoursesPanel
              studentId={student.id}
              studentName={student.student_name}
            />

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wide text-foreground/50">
                  Courses Logged{" "}
                  {student.completions.length > 0 &&
                    `(${student.completions.length})`}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setShowCompletionForm(
                      showCompletionForm === student.id ? null : student.id,
                    )
                  }
                >
                  {showCompletionForm === student.id
                    ? "Cancel"
                    : "Log a Course"}
                </Button>
              </div>

              {showCompletionForm === student.id && (
                <div className="mb-3">
                  <CourseCompletionForm
                    studentId={student.id}
                    subjectNameOptions={subjectNameOptions}
                    onSaved={() => {
                      setShowCompletionForm(null);
                      load();
                    }}
                  />
                </div>
              )}

              {student.completions.length === 0 ? (
                <p className="text-sm text-foreground/60">
                  No courses logged yet.
                </p>
              ) : (
                <div className="space-y-1">
                  {student.completions.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-lg border border-border/50 bg-background p-3 text-sm flex justify-between"
                    >
                      <span>
                        {c.subject_name} — {c.school_year}
                      </span>
                      <span>
                        {c.final_average != null
                          ? `${c.final_average}% (${c.letter_grade}) — ${c.credit_earned} cr`
                          : `In progress — ${c.credit_earned} cr`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="text-xs uppercase tracking-wide text-foreground/50 mb-2">
                Form Submissions{" "}
                {student.formSubmissions.length > 0 &&
                  `(${student.formSubmissions.length})`}
              </p>
              {student.formSubmissions.length === 0 ? (
                <p className="text-sm text-foreground/60">
                  No forms submitted yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {student.formSubmissions.map((f) => (
                    <FormSubmissionCard key={f.id} submission={f} />
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
        {students.length === 0 && (
          <p className="text-foreground/60">
            No students on file for this family.
          </p>
        )}
      </div>

      {family && <AdminTestReviews familyId={family.id} embedded />}

      <div>
        <h3 className="font-semibold text-foreground mb-3">Store Orders</h3>
        {orders.length === 0 ? (
          <p className="text-sm text-foreground/60">No store orders yet.</p>
        ) : (
          <div className="space-y-2">
            {orders.map((o) => (
              <div
                key={o.id}
                className="rounded-lg border border-border/50 bg-background p-3 text-sm flex justify-between"
              >
                <span>
                  {new Date(o.created_at).toLocaleDateString()} — {o.status} /{" "}
                  {o.payment_status}
                </span>
                <span className="font-medium text-primary">
                  ${o.total.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminFamilyDetail;

interface ReviewRow {
  id: string;
  student_id: string;
  subject_id: string;
  pace_number: number;
  score: string | null;
  photo_urls: string[] | null;
  entered_into_ace: boolean;
  reported_at: string;
  review_status: string;
  admin_note: string | null;
  students: {
    student_name: string;
    family_id: string;
    families: { parent_name: string } | { parent_name: string }[] | null;
  } | null;
  subjects: { name: string } | { name: string }[] | null;
}

function reviewName(
  rel: { name?: string; student_name?: string; parent_name?: string } | Array<{ name?: string; student_name?: string; parent_name?: string }> | null,
  key: "name" | "student_name" | "parent_name",
): string {
  if (!rel) return "";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.[key] ?? "";
}

const isHeicUrl = (url: string) => /\.(heic|heif)(\?|$)/i.test(url);

/** Full-screen viewer for test-upload photos with prev/next arrows, arrow keys, and a counter. Wraps at the ends. */
export function TestPhotoViewer({
  urls,
  index,
  onIndexChange,
  onClose,
}: {
  urls: string[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const count = urls.length;
  const current = count ? ((index % count) + count) % count : 0;
  const url = urls[current];
  const multiple = count > 1;
  const go = (delta: number) => {
    if (!multiple) return;
    onIndexChange((current + delta + count) % count);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!url) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Test photo viewer"
      data-testid="test-photo-viewer"
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6"
      onClick={onClose}
    >
      <button
        type="button"
        aria-label="Close photo"
        className="absolute top-4 right-4 rounded-full bg-white/90 p-2 text-black hover:bg-white"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X className="h-5 w-5" />
      </button>
      {multiple && (
        <button
          type="button"
          aria-label="Previous photo"
          className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 text-black hover:bg-white"
          onClick={(event) => {
            event.stopPropagation();
            go(-1);
          }}
        >
          <ChevronLeft className="h-6 w-6" />
        </button>
      )}
      <div className="flex max-h-full max-w-full items-center justify-center" onClick={(event) => event.stopPropagation()}>
        {isHeicUrl(url) ? (
          // Chrome can't show iPhone HEIC photos inline; open or download instead.
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="rounded bg-white px-6 py-4 text-lg underline text-black"
          >
            HEIC photo (open)
          </a>
        ) : (
          <img src={url} alt={`Test page ${current + 1} of ${count}`} className="max-h-[85vh] max-w-[85vw]" />
        )}
      </div>
      {multiple && (
        <button
          type="button"
          aria-label="Next photo"
          className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-3 text-black hover:bg-white"
          onClick={(event) => {
            event.stopPropagation();
            go(1);
          }}
        >
          <ChevronRight className="h-6 w-6" />
        </button>
      )}
      <div
        data-testid="test-photo-counter"
        className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-sm text-black"
        onClick={(event) => event.stopPropagation()}
      >
        {current + 1} of {count}
      </div>
    </div>
  );
}

export function AdminTestReviews({
  familyId,
  embedded = false,
}: {
  familyId?: string;
  embedded?: boolean;
}) {
  const { toast } = useToast();
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [status, setStatus] = useState("pending");
  const [familyFilter, setFamilyFilter] = useState(familyId ?? "all");
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState<Record<string, string>>({});
  const [draftScore, setDraftScore] = useState<Record<string, string>>({});
  const [draftPace, setDraftPace] = useState<Record<string, string>>({});
  const [photos, setPhotos] = useState<Record<string, string[]>>({});
  const [lightbox, setLightbox] = useState<{ urls: string[]; index: number } | null>(null);

  const load = async () => {
    setLoading(true);
    let query = supabase
      .from("score_reports")
      .select(
        "id, student_id, subject_id, pace_number, score, photo_urls, entered_into_ace, reported_at, review_status, admin_note, students(student_name, family_id, families(parent_name)), subjects(name)",
      )
      .order("reported_at", { ascending: false })
      .limit(200);
    if (status !== "all") query = query.eq("review_status", status);
    const { data, error } = await query;
    if (error) {
      toast({ title: "Couldn't load test uploads", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data ?? []) as unknown as ReviewRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [status, familyId]);

  const visible = rows.filter((row) => {
    const rowFamily = row.students?.family_id;
    const filter = familyId ?? familyFilter;
    return filter === "all" || rowFamily === filter;
  });

  const families = new Map<string, string>();
  for (const row of rows) {
    if (!row.students?.family_id) continue;
    families.set(
      row.students.family_id,
      reviewName(row.students.families, "parent_name") || "Family",
    );
  }

  const openPhotos = async (row: ReviewRow) => {
    if (!row.photo_urls?.length || photos[row.id]) return;
    const signed = await Promise.all(
      row.photo_urls.map(async (path) => {
        const { data } = await supabase.storage.from("test-score-photos").createSignedUrl(path, 300);
        return data?.signedUrl ?? null;
      }),
    );
    setPhotos((prev) => ({ ...prev, [row.id]: signed.filter((url): url is string => !!url) }));
  };

  const review = async (
    row: ReviewRow,
    next: "approved" | "rejected",
    enteredIntoAce?: boolean,
  ) => {
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("score_reports")
      .update({
        review_status: next,
        reviewed_by: userData.user?.id ?? null,
        reviewed_at: new Date().toISOString(),
        admin_note: note[row.id] ?? row.admin_note,
        entered_into_ace: enteredIntoAce ?? row.entered_into_ace,
      })
      .eq("id", row.id);
    if (error) {
      toast({ title: "Couldn't update the review", description: error.message, variant: "destructive" });
      return;
    }
    if (next === "rejected") {
      await supabase
        .from("student_pace_slots")
        .update({
          status: "issued",
          score: null,
          completed_at: null,
          score_report_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("student_id", row.student_id)
        .eq("subject_id", row.subject_id)
        .eq("pace_number", row.pace_number);
    }
    toast({ title: next === "approved" ? "Score approved" : "Score rejected" });
    load();
  };

  const saveEdits = async (row: ReviewRow) => {
    const score = draftScore[row.id] ?? row.score ?? "";
    const pace = Number(draftPace[row.id] ?? row.pace_number);
    const internal = pace > 1000 ? pace - 1000 : pace;
    if (internal !== row.pace_number) {
      await supabase
        .from("student_pace_slots")
        .update({
          status: "issued",
          score: null,
          completed_at: null,
          score_report_id: null,
          updated_at: new Date().toISOString(),
        })
        .eq("score_report_id", row.id);
    }
    const { error } = await supabase
      .from("score_reports")
      .update({ score, pace_number: internal })
      .eq("id", row.id);
    if (error) {
      toast({ title: "Couldn't save the score", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Score updated" });
    load();
  };

  return (
    <div className="space-y-4">
      {!embedded && (
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">Test Reviews</h2>
          <p className="text-sm text-foreground/60">
            Uploaded tests waiting for MCA. PACE numbers are the ACE numbers parents see.
          </p>
        </div>
      )}
      {embedded && <h3 className="font-semibold text-foreground">Test uploads</h3>}
      <div className="flex flex-wrap gap-2">
        {["pending", "approved", "rejected", "all"].map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={status === value ? "default" : "outline"}
            onClick={() => setStatus(value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
        {!familyId && (
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={familyFilter}
            onChange={(event) => setFamilyFilter(event.target.value)}
            aria-label="Family"
          >
            <option value="all">All families</option>
            {[...families.entries()].map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-foreground/60">No test uploads in this view.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-3">Date</th>
                <th className="p-3">Family</th>
                <th className="p-3">Student</th>
                <th className="p-3">Subject</th>
                <th className="p-3">PACE</th>
                <th className="p-3">Score</th>
                <th className="p-3">Photos</th>
                <th className="p-3">Status</th>
                <th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const ace = row.pace_number > 1000 ? row.pace_number : row.pace_number + 1000;
                return (
                  <tr key={row.id} className="border-t align-top">
                    <td className="p-3">{new Date(row.reported_at).toLocaleDateString()}</td>
                    <td className="p-3">{reviewName(row.students?.families ?? null, "parent_name")}</td>
                    <td className="p-3">{row.students?.student_name}</td>
                    <td className="p-3">{reviewName(row.subjects, "name")}</td>
                    <td className="p-3">
                      <Input
                        className="w-24 h-8"
                        value={draftPace[row.id] ?? String(ace)}
                        onChange={(event) =>
                          setDraftPace((prev) => ({ ...prev, [row.id]: event.target.value }))
                        }
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        className="w-20 h-8"
                        value={draftScore[row.id] ?? row.score ?? ""}
                        onChange={(event) =>
                          setDraftScore((prev) => ({ ...prev, [row.id]: event.target.value }))
                        }
                      />
                    </td>
                    <td className="p-3">
                      <Button type="button" size="sm" variant="outline" onClick={() => openPhotos(row)}>
                        Photos
                      </Button>
                      <div className="flex gap-1 mt-1">
                        {(photos[row.id] ?? []).map((url, index) =>
                          /\.(heic|heif)(\?|$)/i.test(url) ? (
                            // Chrome can't show iPhone HEIC photos inline; open or download instead.
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noreferrer"
                              className="h-12 w-12 flex items-center justify-center text-[10px] text-center leading-tight rounded border underline"
                            >
                              HEIC photo (open)
                            </a>
                          ) : (
                            <button
                              key={url}
                              type="button"
                              aria-label={`Open photo ${index + 1}`}
                              onClick={() => setLightbox({ urls: photos[row.id] ?? [], index })}
                            >
                              <img src={url} alt="" className="h-12 w-12 object-cover rounded border" />
                            </button>
                          ),
                        )}
                      </div>
                    </td>
                    <td className="p-3 capitalize">{row.review_status}</td>
                    <td className="p-3 space-y-2">
                      <Input
                        placeholder="Note to the parent"
                        value={note[row.id] ?? row.admin_note ?? ""}
                        onChange={(event) =>
                          setNote((prev) => ({ ...prev, [row.id]: event.target.value }))
                        }
                      />
                      <label className="flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={row.entered_into_ace}
                          onChange={(event) =>
                            supabase
                              .from("score_reports")
                              .update({ entered_into_ace: event.target.checked })
                              .eq("id", row.id)
                              .then(() => load())
                          }
                        />
                        Entered into ACE
                      </label>
                      <div className="flex flex-wrap gap-1">
                        <Button type="button" size="sm" onClick={() => review(row, "approved", true)}>
                          Approve
                        </Button>
                        <Button type="button" size="sm" variant="destructive" onClick={() => review(row, "rejected")}>
                          Reject
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => saveEdits(row)}>
                          Save edits
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {lightbox && (
        <TestPhotoViewer
          urls={lightbox.urls}
          index={lightbox.index}
          onIndexChange={(index) => setLightbox((prev) => (prev ? { ...prev, index } : prev))}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
