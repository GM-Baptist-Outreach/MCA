import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowDown, ArrowLeft, ArrowUp, Download, Plus, Printer, Trash2 } from "lucide-react";
import type { PortalContext } from "../portal/PortalLayout";
import {
  currentReportPeriod,
  currentSchoolYear,
  graduationProgress,
  REPORT_PERIODS,
  type GraduationProgress,
  type ReportPeriod,
} from "@/lib/loggedCourses";

// Round 3 markers (grep the live bundle for these):
export const MCA_R3_P1_MARKER = "MCA_R3_P1_PORTAL_PROJECTION";
export const MCA_R3_A2_MARKER = "MCA_R3_A2_TRANSFER_CREDITS";

const MCA_LOGO_URL =
  "https://vibe.filesafe.space/1784303289974857996/attachments/5ce70202-91c1-463f-929b-e89f47f07a50.png";

interface Student {
  id: string;
  student_name: string;
}

interface Completion {
  id: string;
  subject_name: string;
  school_year: string;
  final_average: number | null;
  letter_grade: string | null;
  credit_earned: number;
  is_transfer: boolean | null;
  transfer_school: string | null;
  transfer_school_location: string | null;
  grade_level: number | null;
  fulfills_requirement: string | null;
  notes: string | null;
}

interface Requirement {
  id: string;
  subject_name: string;
  credit_required: number;
  sort_order: number;
}

interface RequirementProgress extends Requirement {
  completedCredits: number;
  currentCredits: number;
  remainingCredits: number;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function norm(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

function isCompleted(c: Completion): boolean {
  return c.is_transfer === true || c.final_average != null;
}

function requirementKey(c: Completion): string {
  return norm(c.fulfills_requirement || c.subject_name);
}

function completionLabel(c: Completion): string {
  if (c.is_transfer) {
    return `${c.subject_name} (T) ${c.transfer_school ?? "Transfer"}`;
  }
  return c.subject_name;
}

const COMPLETION_COLUMNS =
  "id, subject_name, school_year, final_average, letter_grade, credit_earned, is_transfer, transfer_school, transfer_school_location, grade_level, fulfills_requirement, notes";

/**
 * Shared projection view. Admin gets editors; the parent portal gets the same
 * three columns read-only (no internal banner, no template editor).
 */
export function AcademicProjectionView({
  studentId,
  readOnly,
  backLink,
}: {
  studentId: string;
  readOnly: boolean;
  backLink?: string;
}) {
  const { toast } = useToast();
  const [student, setStudent] = useState<Student | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [template, setTemplate] = useState<Requirement[]>([]);
  const [custom, setCustom] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [newReqName, setNewReqName] = useState("");
  const [newReqCredit, setNewReqCredit] = useState("1.00");
  const [newCustomName, setNewCustomName] = useState("");
  const [newCustomCredit, setNewCustomCredit] = useState("1.00");
  const [busy, setBusy] = useState(false);
  const [showTransferForm, setShowTransferForm] = useState(false);
  const [transfer, setTransfer] = useState({
    course: "",
    school: "",
    location: "",
    year: "",
    credits: "1.00",
    grade: "",
    gradeLevel: "",
    fulfills: "",
    notes: "",
  });

  const load = async () => {
    if (!studentId) return;
    setLoading(true);
    const [studentRes, completionsRes, templateRes, customRes] = await Promise.all([
      supabase.from("students").select("id, student_name").eq("id", studentId).single(),
      supabase
        .from("course_completions")
        .select(COMPLETION_COLUMNS)
        .eq("student_id", studentId)
        .order("school_year"),
      supabase
        .from("graduation_requirements")
        .select("id, subject_name, credit_required, sort_order")
        .order("sort_order"),
      supabase
        .from("student_graduation_requirements")
        .select("id, subject_name, credit_required, sort_order")
        .eq("student_id", studentId)
        .order("sort_order"),
    ]);
    if (studentRes.data) setStudent(studentRes.data);
    if (completionsRes.error) {
      toast({
        title: "Couldn't load courses",
        description: completionsRes.error.message,
        variant: "destructive",
      });
    }
    setCompletions((completionsRes.data ?? []) as Completion[]);
    setTemplate((templateRes.data ?? []) as Requirement[]);
    setCustom((customRes.data ?? []) as Requirement[]);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const isCustom = custom.length > 0;
  const requirements = isCustom ? custom : template;

  const completed = useMemo(() => completions.filter(isCompleted), [completions]);
  const current = useMemo(
    () => completions.filter((c) => !isCompleted(c)),
    [completions],
  );

  const progress: RequirementProgress[] = useMemo(() => {
    return requirements.map((r) => {
      const key = norm(r.subject_name);
      const matches = completions.filter((c) => requirementKey(c) === key);
      const completedCredits = matches
        .filter(isCompleted)
        .reduce((sum, c) => sum + Number(c.credit_earned), 0);
      const currentCredits = matches
        .filter((c) => !isCompleted(c))
        .reduce((sum, c) => sum + Number(c.credit_earned), 0);
      const remainingCredits = Math.max(
        0,
        Number(r.credit_required) - completedCredits - currentCredits,
      );
      return { ...r, completedCredits, currentCredits, remainingCredits };
    });
  }, [requirements, completions]);

  const remaining = progress.filter((r) => r.remainingCredits > 0.001);

  const completedCredits = completed.reduce((sum, c) => sum + Number(c.credit_earned), 0);
  const currentCredits = current.reduce((sum, c) => sum + Number(c.credit_earned), 0);
  const remainingCredits = remaining.reduce((sum, r) => sum + r.remainingCredits, 0);
  const requiredTotal = requirements.reduce((sum, r) => sum + Number(r.credit_required), 0);

  // ---- shared template (admin only) ----
  const addRequirement = async () => {
    if (!newReqName.trim()) return;
    const creditNum = parseFloat(newReqCredit);
    if (isNaN(creditNum)) return;
    const { error } = await supabase.from("graduation_requirements").insert({
      subject_name: newReqName.trim(),
      credit_required: creditNum,
      sort_order: template.length,
    });
    if (error) {
      toast({ title: "Couldn't add requirement", description: error.message, variant: "destructive" });
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

  // ---- per-student requirements (A2) ----
  const customizeForStudent = async () => {
    if (template.length === 0) return;
    setBusy(true);
    const { error } = await supabase.from("student_graduation_requirements").insert(
      template.map((r, i) => ({
        student_id: studentId,
        subject_name: r.subject_name,
        credit_required: r.credit_required,
        sort_order: i,
      })),
    );
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't copy the template", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "This student now has their own requirement list" });
    load();
  };

  const resetToTemplate = async () => {
    if (!window.confirm("Delete this student's custom list and go back to the MCA template?")) return;
    setBusy(true);
    const { error } = await supabase
      .from("student_graduation_requirements")
      .delete()
      .eq("student_id", studentId);
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't reset", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  const updateCustom = async (id: string, patch: Partial<Requirement>) => {
    const { error } = await supabase
      .from("student_graduation_requirements")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    setCustom((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const deleteCustom = async (id: string) => {
    const { error } = await supabase.from("student_graduation_requirements").delete().eq("id", id);
    if (error) {
      toast({ title: "Couldn't delete", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  const moveCustom = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= custom.length) return;
    const reordered = [...custom];
    const [row] = reordered.splice(index, 1);
    reordered.splice(target, 0, row);
    setCustom(reordered.map((r, i) => ({ ...r, sort_order: i })));
    await Promise.all(
      reordered.map((r, i) =>
        supabase.from("student_graduation_requirements").update({ sort_order: i }).eq("id", r.id),
      ),
    );
  };

  const addCustom = async () => {
    const creditNum = parseFloat(newCustomCredit);
    if (!newCustomName.trim() || isNaN(creditNum)) return;
    const { error } = await supabase.from("student_graduation_requirements").insert({
      student_id: studentId,
      subject_name: newCustomName.trim(),
      credit_required: creditNum,
      sort_order: custom.length,
    });
    if (error) {
      toast({ title: "Couldn't add", description: error.message, variant: "destructive" });
      return;
    }
    setNewCustomName("");
    setNewCustomCredit("1.00");
    load();
  };

  // ---- transfer credits (A2) ----
  const saveTransfer = async () => {
    const credits = parseFloat(transfer.credits);
    if (!transfer.course.trim() || !transfer.school.trim() || !transfer.year.trim() || isNaN(credits)) {
      toast({
        title: "Missing info",
        description: "Course, school, school year and credits are required.",
        variant: "destructive",
      });
      return;
    }
    const gradeRaw = transfer.grade.trim();
    const gradeNum = gradeRaw && /^\d+(\.\d+)?$/.test(gradeRaw) ? parseFloat(gradeRaw) : null;
    const letter = gradeRaw && gradeNum == null ? gradeRaw.toUpperCase() : null;
    const gradeLevel = transfer.gradeLevel ? parseInt(transfer.gradeLevel, 10) : null;
    setBusy(true);
    const { error } = await supabase.from("course_completions").insert({
      student_id: studentId,
      subject_name: transfer.course.trim(),
      school_year: transfer.year.trim(),
      credit_earned: credits,
      final_average: gradeNum,
      letter_grade: letter,
      is_transfer: true,
      transfer_school: transfer.school.trim(),
      transfer_school_location: transfer.location.trim() || null,
      grade_level: gradeLevel && gradeLevel >= 9 && gradeLevel <= 12 ? gradeLevel : null,
      fulfills_requirement: transfer.fulfills || null,
      notes: transfer.notes.trim() || null,
    });
    setBusy(false);
    if (error) {
      toast({ title: "Couldn't save transfer credit", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Transfer credit added" });
    setTransfer({
      course: "",
      school: transfer.school,
      location: transfer.location,
      year: transfer.year,
      credits: "1.00",
      grade: "",
      gradeLevel: transfer.gradeLevel,
      fulfills: "",
      notes: "",
    });
    load();
  };

  const deleteTransfer = async (id: string) => {
    if (!window.confirm("Delete this transfer credit?")) return;
    const { error } = await supabase.from("course_completions").delete().eq("id", id).eq("is_transfer", true);
    if (error) {
      toast({ title: "Couldn't delete", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  const handlePrint = () => {
    if (!student) return;
    const printWindow = window.open("", "_blank", "width=1000,height=1000");
    if (!printWindow) return;

    const rowsHtml = (items: string[]) =>
      items.map((item) => `<div class="cell">${escapeHtml(item)}</div>`).join("") ||
      `<div class="cell empty">-</div>`;

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Academic Projection - ${escapeHtml(student.student_name)}</title>
          <style>
            body { font-family: Georgia, serif; padding: 40px; color: #1a1a2e; }
            .logo { display: block; margin: 0 auto 8px; max-height: 70px; }
            h1 { font-size: 20px; text-align: center; margin-bottom: 2px; }
            .subtitle { text-align: center; color: #666; font-size: 13px; margin-bottom: 24px; }
            .columns { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }
            .column h2 { font-size: 14px; border-bottom: 2px solid #333; padding-bottom: 6px; }
            .cell { border-bottom: 1px solid #ddd; padding: 6px 4px; font-size: 13px; }
            .cell.empty { color: #999; }
            .totals { margin-top: 40px; display: flex; justify-content: space-around; font-size: 13px; font-weight: bold; }
            .note { margin-top: 16px; font-size: 11px; color: #666; text-align: center; }
            .signature { margin-top: 50px; display: flex; justify-content: space-between; }
            .sig-line { border-top: 1px solid #333; width: 250px; padding-top: 4px; font-size: 12px; }
          </style>
        </head>
        <body>
          <img class="logo" src="${MCA_LOGO_URL}" alt="Midwest Christian Academy" />
          <h1>MIDWEST CHRISTIAN ACADEMY</h1>
          <div class="subtitle">Academic Projection - ${escapeHtml(student.student_name)} - Required Credits: ${requiredTotal.toFixed(2)}</div>
          <div class="columns">
            <div class="column">
              <h2>Completed (${completedCredits.toFixed(2)} cr)</h2>
              ${rowsHtml(completed.map((c) => `${completionLabel(c)} - ${Number(c.credit_earned).toFixed(2)} cr`))}
            </div>
            <div class="column">
              <h2>Current (${currentCredits.toFixed(2)} cr)</h2>
              ${rowsHtml(current.map((c) => `${c.subject_name} - ${Number(c.credit_earned).toFixed(2)} cr`))}
            </div>
            <div class="column">
              <h2>Remaining (${remainingCredits.toFixed(2)} cr)</h2>
              ${rowsHtml(remaining.map((r) => `${r.subject_name} - ${r.remainingCredits.toFixed(2)} cr`))}
            </div>
          </div>
          <div class="totals">
            <span>Completed: ${completedCredits.toFixed(2)}</span>
            <span>Current: ${currentCredits.toFixed(2)}</span>
            <span>Remaining: ${remainingCredits.toFixed(2)}</span>
          </div>
          <div class="note">(T) = transfer credit. Transfer credits count toward graduation credits but not the MCA GPA.</div>
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

  const transfers = completions.filter((c) => c.is_transfer);

  return (
    <div className="space-y-6" data-marker={readOnly ? MCA_R3_P1_MARKER : MCA_R3_A2_MARKER}>
      {backLink && (
        <Link
          to={backLink}
          className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Family
        </Link>
      )}

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold font-serif text-primary">
          Academic Projection - {student.student_name}
        </h2>
        <div className="flex gap-2 flex-wrap">
          {!readOnly && (
            <Button variant="outline" onClick={() => setShowTemplateEditor((v) => !v)}>
              {showTemplateEditor ? "Hide Template Editor" : "Edit MCA Template"}
            </Button>
          )}
          <Button onClick={handlePrint}>
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
        </div>
      </div>

      {!readOnly && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
          {isCustom ? (
            <>
              This student uses a <strong>custom requirement list</strong> totaling{" "}
              <strong>{requiredTotal.toFixed(2)} credits</strong>. Changes here affect only this student.
            </>
          ) : (
            <>
              This student uses the shared MCA template. It currently totals{" "}
              <strong>{requiredTotal.toFixed(2)} of 25.00 required credits</strong> and is waiting on the
              final 25-credit list. Use "Customize for this student" to give one student their own list.
            </>
          )}
        </div>
      )}

      {readOnly && (
        <p className="text-sm text-foreground/60">
          Required credits: {requiredTotal.toFixed(2)}. (T) marks a transfer credit from another school.
          Transfer credits count toward graduation but not the MCA GPA.
        </p>
      )}

      <GraduationCreditTracker
        key={[
          ...completions.map((c) => `${c.id}:${c.credit_earned}:${c.final_average ?? ""}:${c.is_transfer ? 1 : 0}:${c.fulfills_requirement ?? ""}`),
          ...requirements.map((r) => `${r.subject_name}:${r.credit_required}`),
        ].join("|")}
        studentId={studentId}
        tourId={readOnly ? "portal-grad-credits" : "admin-grad-credits"}
      />
      <StudentRecordsDownloads studentId={studentId} highSchool />

      {!readOnly && showTemplateEditor && (
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3">
          <h3 className="font-semibold text-foreground">MCA Requirement Template (shared, all students)</h3>
          <div className="space-y-1">
            {template.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-border/50 bg-background p-2 text-sm"
              >
                <span>
                  {r.subject_name} - {Number(r.credit_required).toFixed(2)} cr
                </span>
                <Button size="icon" variant="ghost" onClick={() => removeRequirement(r.id)}>
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

      {!readOnly && (
        <div className="rounded-xl border border-border/50 bg-background p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-foreground">
              Requirements for {student.student_name} {isCustom ? "(custom)" : "(MCA template)"}
            </h3>
            {isCustom ? (
              <Button variant="outline" size="sm" disabled={busy} onClick={resetToTemplate}>
                Reset to MCA template
              </Button>
            ) : (
              <Button size="sm" disabled={busy || template.length === 0} onClick={customizeForStudent}>
                Customize for this student
              </Button>
            )}
          </div>
          {isCustom && (
            <>
              <div className="space-y-1">
                {custom.map((r, index) => (
                  <div
                    key={r.id}
                    className="flex items-center gap-2 rounded-lg border border-border/50 p-2 text-sm"
                  >
                    <Input
                      className="h-8 bg-background"
                      defaultValue={r.subject_name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== r.subject_name) updateCustom(r.id, { subject_name: v });
                      }}
                    />
                    <Input
                      className="h-8 w-24 bg-background"
                      type="number"
                      step="0.25"
                      defaultValue={Number(r.credit_required).toFixed(2)}
                      onBlur={(e) => {
                        const v = parseFloat(e.target.value);
                        if (!isNaN(v) && v !== Number(r.credit_required)) {
                          updateCustom(r.id, { credit_required: v });
                        }
                      }}
                    />
                    <Button size="icon" variant="ghost" aria-label="Move up" onClick={() => moveCustom(index, -1)}>
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Move down" onClick={() => moveCustom(index, 1)}>
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" aria-label="Delete" onClick={() => deleteCustom(r.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  className="bg-background"
                  placeholder="Add a requirement"
                  value={newCustomName}
                  onChange={(e) => setNewCustomName(e.target.value)}
                />
                <Input
                  className="bg-background w-24"
                  type="number"
                  step="0.25"
                  value={newCustomCredit}
                  onChange={(e) => setNewCustomCredit(e.target.value)}
                />
                <Button variant="outline" onClick={addCustom}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add
                </Button>
              </div>
            </>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="rounded-xl border border-border/50 bg-background p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-foreground">Transfer credits</h3>
            <Button size="sm" variant="outline" onClick={() => setShowTransferForm((v) => !v)}>
              {showTransferForm ? "Close" : "Add transfer credit"}
            </Button>
          </div>
          <p className="text-xs text-foreground/60">
            Credits from another school. They count toward graduation credits and show as (T) on the
            transcript, but they never count toward the MCA GPA.
          </p>
          {showTransferForm && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Course *</Label>
                <Input className="h-9" value={transfer.course} onChange={(e) => setTransfer({ ...transfer, course: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">School *</Label>
                <Input className="h-9" value={transfer.school} onChange={(e) => setTransfer({ ...transfer, school: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">School city / state</Label>
                <Input className="h-9" value={transfer.location} onChange={(e) => setTransfer({ ...transfer, location: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">School year * (e.g. 2024-25)</Label>
                <Input className="h-9" value={transfer.year} onChange={(e) => setTransfer({ ...transfer, year: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Credits *</Label>
                <Input className="h-9" type="number" step="0.25" value={transfer.credits} onChange={(e) => setTransfer({ ...transfer, credits: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Grade (% or letter)</Label>
                <Input className="h-9" value={transfer.grade} onChange={(e) => setTransfer({ ...transfer, grade: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Grade level</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={transfer.gradeLevel}
                  onChange={(e) => setTransfer({ ...transfer, gradeLevel: e.target.value })}
                >
                  <option value="">-</option>
                  <option value="9">9</option>
                  <option value="10">10</option>
                  <option value="11">11</option>
                  <option value="12">12</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Counts toward</Label>
                <select
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={transfer.fulfills}
                  onChange={(e) => setTransfer({ ...transfer, fulfills: e.target.value })}
                >
                  <option value="">Same name as course</option>
                  {requirements.map((r) => (
                    <option key={r.id} value={r.subject_name}>
                      {r.subject_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Input className="h-9" value={transfer.notes} onChange={(e) => setTransfer({ ...transfer, notes: e.target.value })} />
              </div>
              <div className="sm:col-span-3">
                <Button disabled={busy} onClick={saveTransfer}>
                  Save transfer credit
                </Button>
              </div>
            </div>
          )}
          {transfers.length > 0 && (
            <div className="space-y-1 text-sm">
              {transfers.map((c) => (
                <div key={c.id} className="flex items-center justify-between border-b border-border/30 pb-1">
                  <span>
                    {c.subject_name} (T) {c.transfer_school}
                    {c.transfer_school_location ? `, ${c.transfer_school_location}` : ""} - {c.school_year}
                    {c.grade_level ? `, grade ${c.grade_level}` : ""}
                    {c.fulfills_requirement ? `, counts toward ${c.fulfills_requirement}` : ""}
                    {" - "}
                    {Number(c.credit_earned).toFixed(2)} cr
                    {c.final_average != null ? `, ${c.final_average}%` : c.letter_grade ? `, ${c.letter_grade}` : ""}
                  </span>
                  <Button size="icon" variant="ghost" aria-label="Delete transfer" onClick={() => deleteTransfer(c.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/50 bg-background p-4">
          <h3 className="font-semibold text-foreground mb-3">Completed ({completedCredits.toFixed(2)} cr)</h3>
          {completed.length === 0 ? (
            <p className="text-sm text-foreground/60">None logged yet.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {completed.map((c) => (
                <div key={c.id} className="flex justify-between gap-2 border-b border-border/30 pb-1">
                  <span>{completionLabel(c)}</span>
                  <span className="text-foreground/60 whitespace-nowrap">
                    {Number(c.credit_earned).toFixed(2)} cr
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border/50 bg-background p-4">
          <h3 className="font-semibold text-foreground mb-3">Current ({currentCredits.toFixed(2)} cr)</h3>
          {current.length === 0 ? (
            <p className="text-sm text-foreground/60">None in progress.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {current.map((c) => (
                <div key={c.id} className="flex justify-between gap-2 border-b border-border/30 pb-1">
                  <span>{c.subject_name}</span>
                  <span className="text-foreground/60 whitespace-nowrap">
                    {Number(c.credit_earned).toFixed(2)} cr
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-xl border border-border/50 bg-background p-4">
          <h3 className="font-semibold text-foreground mb-3">Remaining ({remainingCredits.toFixed(2)} cr)</h3>
          {remaining.length === 0 ? (
            <p className="text-sm text-foreground/60">All requirements accounted for.</p>
          ) : (
            <div className="space-y-1 text-sm">
              {remaining.map((r) => (
                <div key={r.id} className="flex justify-between gap-2 border-b border-border/30 pb-1">
                  <span>{r.subject_name}</span>
                  <span className="text-foreground/60 whitespace-nowrap">
                    {r.remainingCredits.toFixed(2)} cr
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

export default function AdminAcademicProjection() {
  const { familyId, studentId } = useParams<{ familyId: string; studentId: string }>();
  if (!studentId) return <p className="text-foreground/60">Student not found.</p>;
  return (
    <AcademicProjectionView
      studentId={studentId}
      readOnly={false}
      backLink={`/admin/families/${familyId}`}
    />
  );
}

/** Parent portal page: /portal/projection (high school students). */
export function PortalAcademicProjection() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  if (!selectedStudent) {
    return <p className="text-foreground/60">Select a student above to see the academic projection.</p>;
  }
  return <AcademicProjectionView key={selectedStudent.id} studentId={selectedStudent.id} readOnly />;
}

// ---------------------------------------------------------------------------
// Round 8 (MCA_R8_STUDENT_RECORDS): one-click PDF downloads and the graduation
// credit tracker. Shared by the parent portal and the admin student card.
// PDFs are built by the student-records-pdf edge function from the database,
// so the numbers match these screens.
// ---------------------------------------------------------------------------

export const MCA_R8_STUDENT_RECORDS = "MCA_R8_STUDENT_RECORDS";
const RECORDS_FUNCTION_URL = "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1/student-records-pdf";

export async function downloadStudentPdf(body: {
  kind: "progress" | "transcript";
  student_id: string;
  school_year?: string;
  period?: ReportPeriod;
}): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch(RECORDS_FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Download failed (${res.status})`);
  }
  const disposition = res.headers.get("content-disposition") ?? "";
  const match = disposition.match(/filename="([^"]+)"/);
  const filename = match?.[1] ?? (body.kind === "transcript" ? "transcript.pdf" : "progress-report.pdf");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return filename;
}

function previousSchoolYear(year: string): string {
  const start = Number(year.slice(0, 4)) - 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** Semester / year picker plus the progress report and transcript buttons. */
export function StudentRecordsDownloads({
  studentId,
  highSchool,
  tourId,
  compact = false,
}: {
  studentId: string;
  highSchool: boolean;
  tourId?: string;
  compact?: boolean;
}) {
  const { toast } = useToast();
  const thisYear = currentSchoolYear();
  const [schoolYear, setSchoolYear] = useState(thisYear);
  const [period, setPeriod] = useState<ReportPeriod>(currentReportPeriod());
  const [busy, setBusy] = useState<"progress" | "transcript" | null>(null);

  const run = async (kind: "progress" | "transcript") => {
    setBusy(kind);
    try {
      const filename = await downloadStudentPdf(
        kind === "progress"
          ? { kind, student_id: studentId, school_year: schoolYear, period }
          : { kind, student_id: studentId },
      );
      toast({ title: "Downloaded", description: filename });
    } catch (err) {
      toast({ title: "Couldn't download", description: (err as Error).message, variant: "destructive" });
    }
    setBusy(null);
  };

  const selectClass = "h-9 rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div
      className={compact ? "space-y-2" : "rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3"}
      data-tour={tourId}
      data-marker={MCA_R8_STUDENT_RECORDS}
    >
      {!compact && (
        <div>
          <h3 className="font-semibold text-foreground">Report card and transcript (PDF)</h3>
          <p className="text-xs text-foreground/60">
            Pick a semester or the full year, then download. The PDF has the MCA logo, PACEs completed, test
            scores{highSchool ? ", and credits toward graduation" : ""}.
          </p>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-foreground/60 space-y-1">
          <span className="block">School year</span>
          <select
            className={selectClass}
            value={schoolYear}
            onChange={(e) => setSchoolYear(e.target.value)}
            aria-label="School year"
          >
            {[thisYear, previousSchoolYear(thisYear)].map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-foreground/60 space-y-1">
          <span className="block">Period</span>
          <select
            className={selectClass}
            value={period}
            onChange={(e) => setPeriod(e.target.value as ReportPeriod)}
            aria-label="Report period"
          >
            {REPORT_PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" disabled={busy !== null} onClick={() => run("progress")} data-testid="download-progress-report">
          <Download className="h-4 w-4 mr-1.5" />
          {busy === "progress" ? "Building..." : "Progress report"}
        </Button>
        {highSchool && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() => run("transcript")}
            data-testid="download-transcript"
          >
            <Download className="h-4 w-4 mr-1.5" />
            {busy === "transcript" ? "Building..." : "Transcript"}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Loads one student's requirement list, completions and the school total. */
export function useGraduationProgress(studentId: string | undefined): {
  loading: boolean;
  progress: GraduationProgress | null;
} {
  const [state, setState] = useState<{ loading: boolean; progress: GraduationProgress | null }>({
    loading: true,
    progress: null,
  });
  useEffect(() => {
    if (!studentId) return;
    let ignore = false;
    const load = async () => {
      const [completionsRes, templateRes, customRes, totalRes] = await Promise.all([
        supabase
          .from("course_completions")
          .select("subject_name, credit_earned, final_average, is_transfer, fulfills_requirement")
          .eq("student_id", studentId),
        supabase.from("graduation_requirements").select("subject_name, credit_required, sort_order").order("sort_order"),
        supabase
          .from("student_graduation_requirements")
          .select("subject_name, credit_required, sort_order")
          .eq("student_id", studentId)
          .order("sort_order"),
        supabase.rpc("mca_graduation_total_credits"),
      ]);
      if (ignore) return;
      const custom = customRes.data ?? [];
      const requirements = custom.length > 0 ? custom : templateRes.data ?? [];
      const total = totalRes.error ? 25 : Number(totalRes.data ?? 25);
      setState({
        loading: false,
        progress: graduationProgress(requirements, completionsRes.data ?? [], total),
      });
    };
    load();
    return () => {
      ignore = true;
    };
  }, [studentId]);
  return state;
}

/** Earned / in progress / still needed bar toward the required credits. */
export function GraduationCreditTracker({
  studentId,
  tourId,
  compact = false,
}: {
  studentId: string;
  tourId?: string;
  compact?: boolean;
}) {
  const { loading, progress } = useGraduationProgress(studentId);
  const [showNeeded, setShowNeeded] = useState(false);
  if (loading || !progress) {
    return <p className="text-xs text-foreground/50">Loading credits...</p>;
  }
  const p = progress;
  const neededParts = [
    ...p.remainingBySubject.map((r) => ({ label: r.subject, credits: r.credits })),
    ...(p.electivesRemaining > 0 ? [{ label: "Electives", credits: p.electivesRemaining }] : []),
  ];
  return (
    <div
      className={compact ? "space-y-2" : "rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3"}
      data-tour={tourId}
      data-testid="grad-credit-tracker"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={compact ? "text-sm font-semibold text-foreground" : "font-semibold text-foreground"}>
          Credits toward graduation
        </h3>
        <span className="text-sm text-foreground/70">
          <strong className="text-primary">{p.earned.toFixed(2)}</strong> of {p.totalRequired.toFixed(0)} earned
        </span>
      </div>
      <div
        className="relative h-4 w-full overflow-hidden rounded-full bg-secondary border border-border/60"
        role="progressbar"
        aria-label="Credits toward graduation"
        aria-valuemin={0}
        aria-valuemax={p.totalRequired}
        aria-valuenow={p.earned}
      >
        <div className="absolute inset-y-0 left-0 bg-emerald-600" style={{ width: `${p.earnedPercent}%` }} />
        <div
          className="absolute inset-y-0 bg-amber-400"
          style={{ left: `${p.earnedPercent}%`, width: `${p.inProgressPercent}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-foreground/70">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-emerald-600" /> Earned {p.earned.toFixed(2)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-amber-400" /> In progress {p.inProgress.toFixed(2)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-secondary border border-border" /> Still needed{" "}
          {p.stillNeeded.toFixed(2)}
        </span>
      </div>
      {neededParts.length > 0 && (
        <div>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => setShowNeeded((v) => !v)}
            aria-expanded={showNeeded}
          >
            {showNeeded ? "Hide" : "Show"} what's still needed by subject
          </button>
          {showNeeded && (
            <ul className="mt-2 grid gap-x-4 gap-y-0.5 text-xs text-foreground/70 sm:grid-cols-2">
              {neededParts.map((part) => (
                <li key={part.label} className="flex justify-between gap-2 border-b border-border/30 py-0.5">
                  <span>{part.label}</span>
                  <span>{part.credits.toFixed(2)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
