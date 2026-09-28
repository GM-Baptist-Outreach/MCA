import { useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { PortalContext } from "../PortalLayout";

interface StudentSignatureRow {
  studentId: string;
  studentName: string;
  include: boolean;
  signature: string;
}

export default function PortalHonestyPolicy() {
  const { family, students } = useOutletContext<PortalContext>();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [parentSignature, setParentSignature] = useState("");
  const [studentRows, setStudentRows] = useState<StudentSignatureRow[]>(
    students.map((s) => ({
      studentId: s.id,
      studentName: s.student_name,
      include: true,
      signature: "",
    })),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (
    studentId: string,
    patch: Partial<StudentSignatureRow>,
  ) => {
    setStudentRows((rows) =>
      rows.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const includedRows = studentRows.filter((r) => r.include);
    if (!parentSignature.trim()) {
      setError("Type your full name as the parent signature.");
      return;
    }
    if (includedRows.some((r) => !r.signature.trim())) {
      setError("Every checked student needs their own typed signature.");
      return;
    }

    setSubmitting(true);

    const { error: insertError } = await supabase
      .from("form_submissions")
      .insert({
        family_id: family.id,
        student_id:
          includedRows.length === 1 ? includedRows[0].studentId : null,
        form_type: "honesty_policy",
        submitted_data: {
          students: includedRows.map((r) => ({
            student_name: r.studentName,
            student_signature: r.signature.trim(),
          })),
        },
        signer_name: parentSignature.trim(),
      });

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    toast({
      title: "Honesty policy submitted",
      description: "Thank you — this is on file.",
    });
    setSubmitting(false);
    navigate("/portal/forms");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">
          Honesty Policy
        </h2>
        <p className="text-sm text-foreground/60">Midwest Christian Academy</p>
      </div>

      <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4 text-sm text-foreground/80 leading-relaxed">
        <p>
          Midwest Christian is honored to have a part in helping students
          receive an excellent academic education. However, we also have the
          goal of helping our students receive an education in life itself. A
          big part of that education is in training them to be honest.
        </p>
        <p>
          It is expected that all students of MCA will be honest in all of their
          experiences, especially with their dealings with MCA. It is expected
          that all students avoid all dishonesty in at least, but not limited
          to, the following areas:
        </p>
        <div>
          <p className="font-medium text-foreground">
            Dishonesty in Plagiarism, such as:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>
              Direct quotations without using quotation marks, footnotes, or
              other references to quoted material.
            </li>
            <li>
              Quoting someone, whether verbally or written, without giving
              credit to that person or article.
            </li>
            <li>
              Paraphrasing someone so closely that it is obviously the same
              article or speech.
            </li>
            <li>
              Any type of Auto-Plagiarism generated through the use of
              Artificial Intelligence (AI).
            </li>
          </ul>
        </div>
        <div>
          <p className="font-medium text-foreground">
            Dishonesty in Daily School Work, such as:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>Copying from answer keys</li>
            <li>
              Receiving answers from outside sources such as siblings or parents
            </li>
            <li>
              Using computer search engines such as Google to look up answers
            </li>
            <li>
              Any other methods deemed to be dishonest by Midwest Christian
              Academy
            </li>
          </ul>
        </div>
        <div>
          <p className="font-medium text-foreground">
            Consequences of Dishonesty
          </p>
          <p className="mt-1">
            If a student is found to be dishonest, the following consequences
            will be applied:
          </p>
          <ul className="list-disc pl-5 space-y-1 mt-1">
            <li>
              <strong>First Offense:</strong> Letter of warning and complete
              repeating of affected school work.
            </li>
            <li>
              <strong>Second Offense:</strong> Letter of warning, complete
              repeating of affected school work, and a letter of apology with a
              promise not to repeat the offense.
            </li>
            <li>
              <strong>Third Offense:</strong> Dismissal from enrollment in MCA.
            </li>
          </ul>
        </div>
        <p className="text-xs text-foreground/50">
          Required by the National Association of Private Schools.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4">
          <h3 className="font-semibold text-foreground">
            Certificate of Authenticity
          </h3>
          <p className="text-sm text-foreground/70">
            These signatures affirm that the work turned in to MCA is the
            student's own, with no outside help that would violate this policy.
          </p>
          <div className="space-y-1.5">
            <Label>Signature of Parent (type your full legal name)</Label>
            <Input
              className="bg-background"
              value={parentSignature}
              onChange={(e) => setParentSignature(e.target.value)}
              placeholder="Full name"
            />
          </div>

          {studentRows.map((row) => (
            <div
              key={row.studentId}
              className="rounded-lg border border-border/50 bg-background p-4 space-y-2"
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`hp-include-${row.studentId}`}
                  checked={row.include}
                  onCheckedChange={(v) =>
                    updateRow(row.studentId, { include: !!v })
                  }
                />
                <Label
                  htmlFor={`hp-include-${row.studentId}`}
                  className="cursor-pointer font-medium"
                >
                  {row.studentName}
                </Label>
              </div>
              {row.include && (
                <div className="pl-6 space-y-1.5">
                  <Label className="text-xs">Student Signature (typed)</Label>
                  <Input
                    className="bg-background h-8"
                    value={row.signature}
                    onChange={(e) =>
                      updateRow(row.studentId, { signature: e.target.value })
                    }
                    placeholder="Student's full name"
                  />
                </div>
              )}
            </div>
          ))}
          {studentRows.length === 0 && (
            <p className="text-sm text-foreground/60">
              No students on file for this family.
            </p>
          )}
          <p className="text-xs text-foreground/50">
            Submitting this form on {new Date().toLocaleDateString()}{" "}
            constitutes each signature above.
          </p>
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Sign & Submit"}
        </Button>
      </form>
    </div>
  );
}
