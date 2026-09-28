import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import type { PortalContext } from "../PortalLayout";

const CORE_SUBJECTS = [
  "Math",
  "English",
  "Social Studies",
  "Science",
  "Spelling",
];

interface SubjectGrade {
  subject: string;
  grade: string;
}

export default function PortalCourseVerification() {
  const { family, selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [age, setAge] = useState("");
  const [address, setAddress] = useState(family.address ?? "");
  const [parentName, setParentName] = useState(family.parent_name);
  const [coreGrades, setCoreGrades] = useState<SubjectGrade[]>(
    CORE_SUBJECTS.map((subject) => ({ subject, grade: "" })),
  );
  const [additionalSubjects, setAdditionalSubjects] = useState<SubjectGrade[]>(
    [],
  );
  const [daysPerWeek, setDaysPerWeek] = useState("");
  const [hoursPerDay, setHoursPerDay] = useState("");
  const [startedNextGrade, setStartedNextGrade] = useState("");
  const [weeksCompleted, setWeeksCompleted] = useState("");
  const [comments, setComments] = useState("");
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateCoreGrade = (subject: string, grade: string) => {
    setCoreGrades((rows) =>
      rows.map((r) => (r.subject === subject ? { ...r, grade } : r)),
    );
  };

  const addAdditionalSubject = () => {
    setAdditionalSubjects((rows) => [...rows, { subject: "", grade: "" }]);
  };

  const updateAdditional = (index: number, patch: Partial<SubjectGrade>) => {
    setAdditionalSubjects((rows) =>
      rows.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };

  const removeAdditional = (index: number) => {
    setAdditionalSubjects((rows) => rows.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!signature.trim()) {
      setError("Type your full name as your signature to submit.");
      return;
    }

    setSubmitting(true);

    const { error: insertError } = await supabase
      .from("form_submissions")
      .insert({
        family_id: family.id,
        student_id: selectedStudent?.id ?? null,
        form_type: "elementary_course_verification",
        submitted_data: {
          student_name: selectedStudent?.student_name ?? "",
          age,
          last_grade_completed: selectedStudent?.last_grade_completed ?? "",
          address,
          parent_guardian_name: parentName,
          core_grades: coreGrades,
          additional_subjects: additionalSubjects,
          days_per_week: daysPerWeek,
          hours_per_day: hoursPerDay,
          started_next_grade: startedNextGrade,
          weeks_completed: weeksCompleted,
          comments,
        },
        signer_name: signature.trim(),
      });

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    toast({
      title: "Course verification submitted",
      description: "Thank you — this is on file.",
    });
    setSubmitting(false);
    navigate("/portal/forms");
  };

  if (!selectedStudent) {
    return (
      <p className="text-foreground/60">
        Select a student above to use this form.
      </p>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">
          Elementary Course Verification
        </h2>
        <p className="text-sm text-foreground/60">
          {selectedStudent.student_name}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Age</Label>
              <Input
                className="bg-background"
                value={age}
                onChange={(e) => setAge(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Last Grade Completed</Label>
              <Input
                className="bg-background"
                value={selectedStudent.last_grade_completed ?? ""}
                disabled
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Address</Label>
            <Input
              className="bg-background"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Parent/Guardian's Name</Label>
            <Input
              className="bg-background"
              value={parentName}
              onChange={(e) => setParentName(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3">
          <h3 className="font-semibold text-foreground">Subjects Completed</h3>
          {coreGrades.map((row) => (
            <div
              key={row.subject}
              className="grid grid-cols-2 gap-3 items-center"
            >
              <Label className="font-normal">{row.subject}</Label>
              <Input
                className="bg-background"
                value={row.grade}
                onChange={(e) => updateCoreGrade(row.subject, e.target.value)}
                placeholder="Grade received"
              />
            </div>
          ))}

          {additionalSubjects.map((row, i) => (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_auto] gap-3 items-center"
            >
              <Input
                className="bg-background"
                value={row.subject}
                onChange={(e) =>
                  updateAdditional(i, { subject: e.target.value })
                }
                placeholder="Additional subject"
              />
              <Input
                className="bg-background"
                value={row.grade}
                onChange={(e) => updateAdditional(i, { grade: e.target.value })}
                placeholder="Grade received"
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => removeAdditional(i)}
                type="button"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={addAdditionalSubject}
            type="button"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add Subject
          </Button>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Days per Week in School</Label>
              <Input
                className="bg-background"
                value={daysPerWeek}
                onChange={(e) => setDaysPerWeek(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Hours per Day in School</Label>
              <Input
                className="bg-background"
                value={hoursPerDay}
                onChange={(e) => setHoursPerDay(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Has Student Started Next Grade?</Label>
              <Input
                className="bg-background"
                value={startedNextGrade}
                onChange={(e) => setStartedNextGrade(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Weeks Completed in Present Grade</Label>
              <Input
                className="bg-background"
                value={weeksCompleted}
                onChange={(e) => setWeeksCompleted(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Other Comments</Label>
            <Textarea
              className="bg-background"
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-1.5">
          <Label>Supervisor's Signature (type your full legal name)</Label>
          <Input
            className="bg-background"
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
            placeholder="Full name"
          />
          <p className="text-xs text-foreground/50">
            Submitting this form on {new Date().toLocaleDateString()}{" "}
            constitutes your signature.
          </p>
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Sign & Submit"}
        </Button>
      </form>
    </div>
  );
}
