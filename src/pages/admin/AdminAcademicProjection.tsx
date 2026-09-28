import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Plus, Printer, Trash2 } from "lucide-react";

interface Student {
  id: string;
  student_name: string;
}

interface Completion {
  subject_name: string;
  school_year: string;
  final_average: number | null;
  credit_earned: number;
}

interface Requirement {
  id: string;
  subject_name: string;
  credit_required: number;
  sort_order: number;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function AdminAcademicProjection() {
  const { familyId, studentId } = useParams<{
    familyId: string;
    studentId: string;
  }>();
  const { toast } = useToast();
  const [student, setStudent] = useState<Student | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [newReqName, setNewReqName] = useState("");
  const [newReqCredit, setNewReqCredit] = useState("1.00");

  const load = async () => {
    if (!studentId) return;
    setLoading(true);
    const [studentRes, completionsRes, requirementsRes] = await Promise.all([
      supabase
        .from("students")
        .select("id, student_name")
        .eq("id", studentId)
        .single(),
      supabase
        .from("course_completions")
        .select("subject_name, school_year, final_average, credit_earned")
        .eq("student_id", studentId),
      supabase
        .from("graduation_requirements")
        .select("id, subject_name, credit_required, sort_order")
        .order("sort_order"),
    ]);
    if (studentRes.data) setStudent(studentRes.data);
    if (completionsRes.data) setCompletions(completionsRes.data);
    if (requirementsRes.data) setRequirements(requirementsRes.data);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [studentId]);

  const completed = useMemo(
    () => completions.filter((c) => c.final_average != null),
    [completions],
  );
  const current = useMemo(
    () => completions.filter((c) => c.final_average == null),
    [completions],
  );
  const remaining = useMemo(() => {
    const takenNames = new Set(completions.map((c) => c.subject_name));
    return requirements.filter((r) => !takenNames.has(r.subject_name));
  }, [completions, requirements]);

  const completedCredits = completed.reduce(
    (sum, c) => sum + c.credit_earned,
    0,
  );
  const currentCredits = current.reduce((sum, c) => sum + c.credit_earned, 0);
  const remainingCredits = remaining.reduce(
    (sum, r) => sum + r.credit_required,
    0,
  );
  const requiredTotal = requirements.reduce(
    (sum, r) => sum + r.credit_required,
    0,
  );

  const addRequirement = async () => {
    if (!newReqName.trim()) return;
    const creditNum = parseFloat(newReqCredit);
    if (isNaN(creditNum)) return;

    const { error } = await supabase.from("graduation_requirements").insert({
      subject_name: newReqName.trim(),
      credit_required: creditNum,
      sort_order: requirements.length,
    });
    if (error) {
      toast({
        title: "Couldn't add requirement",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    setNewReqName("");
    setNewReqCredit("1.00");
    load();
  };

  const removeRequirement = async (id: string) => {
    await supabase.from("graduation_requirements").delete().eq("id", id);
    load();
  };

  const handlePrint = () => {
    if (!student) return;
    const printWindow = window.open("", "_blank", "width=1000,height=1000");
    if (!printWindow) return;

    const rowsHtml = (label: string, items: string[]) =>
      items
        .map((item) => `<div class="cell">${escapeHtml(item)}</div>`)
        .join("") || `<div class="cell empty">—</div>`;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Academic Projection — ${escapeHtml(student.student_name)}</title>
          <style>
            body { font-family: Georgia, serif; padding: 40px; color: #1a1a2e; }
            h1 { font-size: 20px; text-align: center; margin-bottom: 2px; }
            .subtitle { text-align: center; color: #666; font-size: 13px; margin-bottom: 24px; }
            .columns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
            .column h2 { font-size: 14px; border-bottom: 2px solid #333; padding-bottom: 6px; }
            .cell { border-bottom: 1px solid #ddd; padding: 6px 4px; font-size: 13px; display: flex; justify-content: space-between; }
            .cell.empty { color: #999; }
            .totals { margin-top: 40px; display: flex; justify-content: space-around; font-size: 13px; font-weight: bold; }
            .signature { margin-top: 50px; display: flex; justify-content: space-between; }
            .sig-line { border-top: 1px solid #333; width: 250px; padding-top: 4px; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>MIDWEST CHRISTIAN ACADEMY</h1>
          <div class="subtitle">Academic Projection Towards Graduation — ${escapeHtml(student.student_name)} — Required Credits: ${requiredTotal.toFixed(2)}</div>
          <div class="columns">
            <div class="column">
              <h2>Completed (${completedCredits.toFixed(2)} cr)</h2>
              ${rowsHtml(
                "Completed",
                completed.map(
                  (c) => `${c.subject_name} — ${c.credit_earned.toFixed(2)} cr`,
                ),
              )}
            </div>
            <div class="column">
              <h2>Current (${currentCredits.toFixed(2)} cr)</h2>
              ${rowsHtml(
                "Current",
                current.map(
                  (c) => `${c.subject_name} — ${c.credit_earned.toFixed(2)} cr`,
                ),
              )}
            </div>
            <div class="column">
              <h2>Remaining (${remainingCredits.toFixed(2)} cr)</h2>
              ${rowsHtml(
                "Remaining",
                remaining.map(
                  (r) =>
                    `${r.subject_name} — ${r.credit_required.toFixed(2)} cr`,
                ),
              )}
            </div>
          </div>
          <div class="totals">
            <span>Completed: ${completedCredits.toFixed(2)}</span>
            <span>Current: ${currentCredits.toFixed(2)}</span>
            <span>Remaining: ${remainingCredits.toFixed(2)}</span>
          </div>
          <div class="signature">
            <div class="sig-line">Parent Signature</div>
            <div class="sig-line">Administrator Signature</div>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (loading) return <p className="text-foreground/60">Loading...</p>;
  if (!student) return <p className="text-foreground/60">Student not found.</p>;

  return (
    <div className="space-y-6">
      <Link
        to={`/admin/families/${familyId}`}
        className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Family
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold font-serif text-primary">
          Graduation Projection — {student.student_name}
        </h2>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowTemplateEditor((v) => !v)}
          >
            {showTemplateEditor
              ? "Hide Template Editor"
              : "Edit Requirement Template"}
          </Button>
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
        </div>
      </div>

      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
        This requirement template is a starting default I built from your
        subject groupings — it currently totals{" "}
        <strong>{requiredTotal.toFixed(2)} of 25.00 required credits</strong>{" "}
        and needs your review to be exact. It's shared across all students (not
        per-student), and fully editable below.
      </div>

      {showTemplateEditor && (
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3">
          <h3 className="font-semibold text-foreground">
            Graduation Requirement Template (shared, all students)
          </h3>
          <div className="space-y-1">
            {requirements.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border/50 bg-background p-2 text-sm"
              >
                <span>
                  {r.subject_name} — {r.credit_required.toFixed(2)} cr
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => removeRequirement(r.id)}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Input
              className="bg-background"
              placeholder="Subject name"
              value={newReqName}
              onChange={(e) => setNewReqName(e.target.value)}
            />
            <Input
              className="bg-background w-24"
              type="number"
              step="0.25"
              value={newReqCredit}
              onChange={(e) => setNewReqCredit(e.target.value)}
            />
            <Button variant="outline" onClick={addRequirement}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/50 bg-background p-4">
          <h3 className="font-semibold text-foreground mb-3">
            Completed ({completedCredits.toFixed(2)} cr)
          </h3>
          {completed.length === 0 ? (
            <p className="text-sm text-foreground/60">None logged yet.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {completed.map((c, i) => (
                <div
                  key={i}
                  className="flex justify-between border-b border-border/30 pb-1"
                >
                  <span>{c.subject_name}</span>
                  <span className="text-foreground/60">
                    {c.credit_earned.toFixed(2)} cr
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border/50 bg-background p-4">
          <h3 className="font-semibold text-foreground mb-3">
            Current ({currentCredits.toFixed(2)} cr)
          </h3>
          {current.length === 0 ? (
            <p className="text-sm text-foreground/60">None in progress.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {current.map((c, i) => (
                <div
                  key={i}
                  className="flex justify-between border-b border-border/30 pb-1"
                >
                  <span>{c.subject_name}</span>
                  <span className="text-foreground/60">
                    {c.credit_earned.toFixed(2)} cr
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border/50 bg-background p-4">
          <h3 className="font-semibold text-foreground mb-3">
            Remaining ({remainingCredits.toFixed(2)} cr)
          </h3>
          {remaining.length === 0 ? (
            <p className="text-sm text-foreground/60">
              All requirements accounted for.
            </p>
          ) : (
            <div className="space-y-1 text-sm">
              {remaining.map((r) => (
                <div
                  key={r.id}
                  className="flex justify-between border-b border-border/30 pb-1"
                >
                  <span>{r.subject_name}</span>
                  <span className="text-foreground/60">
                    {r.credit_required.toFixed(2)} cr
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
