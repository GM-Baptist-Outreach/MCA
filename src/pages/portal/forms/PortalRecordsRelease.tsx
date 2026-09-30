import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Printer } from "lucide-react";
import type { PortalContext } from "../PortalLayout";

const SIGNATURE_SRC = "/david-signature.png";

function PrincipalSignature() {
  const [useImage, setUseImage] = useState(false);

  useEffect(() => {
    const image = new Image();
    image.onload = () => setUseImage(true);
    image.onerror = () => setUseImage(false);
    image.src = SIGNATURE_SRC;
  }, []);

  if (useImage) {
    return (
      <img
        src={SIGNATURE_SRC}
        alt="David Moore"
        className="h-16 w-auto"
      />
    );
  }

  return (
    <p className="font-signature text-4xl leading-none text-foreground">
      David Moore
    </p>
  );
}

interface StudentRow {
  studentId: string;
  studentName: string;
  birthdate: string;
  gradeLevel: string;
  include: boolean;
}

export default function PortalRecordsRelease() {
  const { family, students } = useOutletContext<PortalContext>();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [releaseDate, setReleaseDate] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [schoolName, setSchoolName] = useState("");
  const [schoolAddress, setSchoolAddress] = useState("");
  const [studentRows, setStudentRows] = useState<StudentRow[]>(
    students.map((s) => ({
      studentId: s.id,
      studentName: s.student_name,
      birthdate: s.birthdate ?? "",
      gradeLevel: s.last_grade_completed ?? "",
      include: false,
    })),
  );
  const [signature, setSignature] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateRow = (studentId: string, patch: Partial<StudentRow>) => {
    setStudentRows((rows) =>
      rows.map((r) => (r.studentId === studentId ? { ...r, ...patch } : r)),
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const includedRows = studentRows.filter((r) => r.include);
    if (!schoolName.trim()) {
      setError("The requesting school's name is required.");
      return;
    }
    if (includedRows.length === 0) {
      setError("Select at least one student to release records for.");
      return;
    }
    if (!signature.trim()) {
      setError("Type your full name as your signature to submit.");
      return;
    }

    setSubmitting(true);

    const { error: insertError } = await supabase
      .from("form_submissions")
      .insert({
        family_id: family.id,
        student_id:
          includedRows.length === 1 ? includedRows[0].studentId : null,
        form_type: "records_release",
        submitted_data: {
          release_date: releaseDate,
          requesting_school_name: schoolName,
          requesting_school_address: schoolAddress,
          students: includedRows.map((r) => ({
            student_name: r.studentName,
            birthdate: r.birthdate,
            grade_level_at_withdrawal: r.gradeLevel,
          })),
        },
        signer_name: signature.trim(),
      });

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    toast({
      title: "Records release submitted",
      description: "MCA will process this request.",
    });
    setSubmitting(false);
    navigate("/portal/forms");
  };

  return (
    <div className="space-y-6 max-w-2xl print:max-w-none">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">
            Student Records Release
          </h2>
          <p className="text-sm text-foreground/60">Midwest Christian Academy</p>
        </div>
        <Button
          type="button"
          variant="outline"
          className="print:hidden"
          onClick={() => window.print()}
        >
          <Printer className="h-4 w-4 mr-1.5" />
          Print
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4">
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input
              className="bg-background"
              type="date"
              value={releaseDate}
              onChange={(e) => setReleaseDate(e.target.value)}
            />
          </div>
          <p className="text-sm text-foreground/70">
            Request for student records from:
          </p>
          <div className="space-y-1.5">
            <Label>School Name</Label>
            <Input
              className="bg-background"
              value={schoolName}
              onChange={(e) => setSchoolName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>School Address</Label>
            <Input
              className="bg-background"
              value={schoolAddress}
              onChange={(e) => setSchoolAddress(e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3">
          <h3 className="font-semibold text-foreground">
            Student(s) Withdrawn
          </h3>
          <p className="text-sm text-foreground/60">
            Check each student this release applies to, and confirm their info.
          </p>
          {studentRows.map((row) => (
            <div
              key={row.studentId}
              className="rounded-lg border border-border/50 bg-background p-4 space-y-3"
            >
              <div className="flex items-center gap-2">
                <Checkbox
                  id={`include-${row.studentId}`}
                  checked={row.include}
                  onCheckedChange={(v) =>
                    updateRow(row.studentId, { include: !!v })
                  }
                />
                <Label
                  htmlFor={`include-${row.studentId}`}
                  className="cursor-pointer font-medium"
                >
                  {row.studentName}
                </Label>
              </div>
              {row.include && (
                <div className="grid grid-cols-2 gap-3 pl-6">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Birthdate</Label>
                    <Input
                      className="bg-background h-8"
                      type="date"
                      value={row.birthdate}
                      onChange={(e) =>
                        updateRow(row.studentId, { birthdate: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Grade Level at Withdrawal</Label>
                    <Input
                      className="bg-background h-8"
                      value={row.gradeLevel}
                      onChange={(e) =>
                        updateRow(row.studentId, { gradeLevel: e.target.value })
                      }
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
          {studentRows.length === 0 && (
            <p className="text-sm text-foreground/60">
              No students on file for this family.
            </p>
          )}
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3">
          <p className="text-sm text-foreground/80">
            Please release the above student(s)' academic and health records to
            Midwest Christian Academy. The receiving school's principal signs a
            copy of this form separately when records are transferred — this
            submission only records your request as the parent/guardian.
          </p>
          <div className="space-y-1.5">
            <Label>
              Signature of Requesting Parent/Guardian (type your full legal
              name)
            </Label>
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
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 break-inside-avoid print:bg-transparent">
          <p className="text-sm text-foreground/80 mb-6">
            Receiving principal
          </p>
          <div className="grid sm:grid-cols-2 gap-8">
            <div>
              <div className="min-h-16 flex items-end">
                <PrincipalSignature />
              </div>
              <div className="border-t border-foreground/40 mt-2 pt-1 text-xs text-foreground/70">
                Receiving Principal
              </div>
            </div>
            <div>
              <div className="min-h-16 border-b border-foreground/40" />
              <div className="mt-2 text-xs text-foreground/70">Date</div>
            </div>
          </div>
        </div>

        <Button type="submit" disabled={submitting} className="print:hidden">
          {submitting ? "Submitting..." : "Sign & Submit"}
        </Button>
      </form>
    </div>
  );
}
