import { useEffect, useState } from "react";
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

interface FormSubmission {
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

const FORM_TYPE_LABELS: Record<string, string> = {
  enrollment_agreement: "Enrollment Agreement",
  records_release: "Records Release",
  honesty_policy: "Honesty Policy",
  elementary_course_verification: "Course Verification",
  goal_card: "Goal Card",
  pe_activity_log: "P.E. Activity Log",
  music_practice_verification: "Music Practice Verification",
};

const SUMMARY_ONLY_TYPES = new Set([
  "goal_card",
  "pe_activity_log",
  "music_practice_verification",
]);

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

function FormSubmissionCard({ submission }: { submission: FormSubmission }) {
  const [expanded, setExpanded] = useState(false);
  const isSummaryOnly = SUMMARY_ONLY_TYPES.has(submission.form_type);

  return (
    <div className="rounded-lg border border-border/50 bg-background p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between text-left"
      >
        <div>
          <p className="font-medium text-foreground">
            {FORM_TYPE_LABELS[submission.form_type] ?? submission.form_type}
          </p>
          <p className="text-xs text-foreground/50">
            Signed by {submission.signer_name} on{" "}
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
          {isSummaryOnly && (
            <p className="text-foreground/60">
              This form tracks recurring/weekly data. Raw submitted data below.
            </p>
          )}
          {Object.entries(submission.submitted_data).map(([key, value]) => {
            if (
              Array.isArray(value) ||
              (typeof value === "object" && value !== null)
            )
              return null;
            if (value === null || value === "" || value === false) return null;
            return (
              <div key={key} className="flex justify-between gap-4">
                <span className="text-foreground/50">{formatKey(key)}</span>
                <span className="text-foreground text-right">
                  {String(value)}
                </span>
              </div>
            );
          })}
          <details className="mt-2">
            <summary className="cursor-pointer text-xs text-primary">
              View raw submitted data
            </summary>
            <pre className="mt-2 text-xs bg-secondary/50 p-3 rounded-md overflow-x-auto">
              {JSON.stringify(submission.submitted_data, null, 2)}
            </pre>
          </details>
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
  const [daysPresent, setDaysPresent] = useState("");
  const [absences, setAbsences] = useState("");
  const [classRank, setClassRank] = useState("");
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
        days_present: daysPresent ? parseInt(daysPresent, 10) : null,
        absences: absences ? parseInt(absences, 10) : null,
        class_rank: classRank || null,
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
    setDaysPresent("");
    setAbsences("");
    setClassRank("");
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
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Days Present</Label>
          <Input
            className="bg-secondary h-9"
            value={daysPresent}
            onChange={(e) => setDaysPresent(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Absences</Label>
          <Input
            className="bg-secondary h-9"
            value={absences}
            onChange={(e) => setAbsences(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Class Rank (manual)</Label>
          <Input
            className="bg-secondary h-9"
            placeholder="4 of 14"
            value={classRank}
            onChange={(e) => setClassRank(e.target.value)}
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
