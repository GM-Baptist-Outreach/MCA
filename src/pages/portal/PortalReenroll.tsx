import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { callPortalFunction } from "./PortalHomeCards";

// Round 10 (MCA_R10_REENROLL): one-click re-enrollment for next school year.
// Shown only while MCA has re-enrollment open (Admin > Re-enrollment). The
// family's info is prefilled; students on autopay simply keep renewing, and
// anyone without a live plan pays through Stripe Checkout (saved cards show).

type Plan = { tuition_tier: string; frequency: string; price: number };
type StudentInfo = {
  student_id: string;
  student_name: string;
  last_grade_completed: string | null;
  suggested_grade: string;
  suggested_tier: string;
  enrollment: { id: string; frequency: string | null; status: string; is_comp: boolean; stripe_subscription_id: string | null } | null;
  reenrollment: { id: string; status: string; grade_next: string; payment_path: string; frequency: string; notes: string | null } | null;
};
type Status = {
  window: { open: boolean; start: string | null; end: string | null; school_year: string; active: boolean };
  family: Record<string, string | null>;
  plans: Plan[];
  students: StudentInfo[];
};

const GRADES = ["k", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const gradeLabel = (g: string) => (g === "k" ? "Kindergarten" : `Grade ${g}`);
const tierFor = (g: string) => (parseInt(g, 10) >= 9 ? "high_school" : "elementary");

function statusText(s: StudentInfo): string {
  const r = s.reenrollment;
  if (!r) return "Not confirmed yet";
  if (r.status === "paid") return "Confirmed and paid";
  if (r.status === "declined") return "Not returning";
  if (r.status === "awaiting_payment") return "Confirmed: payment needed";
  if (r.payment_path === "autopay") return "Confirmed: renews automatically";
  if (r.payment_path === "comp") return "Confirmed: MCA will follow up";
  return "Confirmed";
}

export function ReEnrollCard({ tourId }: { tourId?: string }) {
  const { toast } = useToast();
  const [status, setStatus] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [paying, setPaying] = useState<string | null>(null);
  const [parent, setParent] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, { include: boolean; grade: string; frequency: string }>>({});

  const load = async () => {
    try {
      const data = await callPortalFunction<Status>("portal-reenroll", { action: "status" });
      setStatus(data);
    } catch {
      setStatus(null);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("reenroll");
    if (flag === "paid") toast({ title: "Thank you! Re-enrollment is paid", description: "We'll see you next school year." });
    if (flag === "cancelled") toast({ title: "Payment wasn't finished", description: "You can pay any time while re-enrollment is open." });
    if (flag) {
      params.delete("reenroll");
      const q = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status) return null;
  const { window: win } = status;
  const anySaved = status.students.some((s) => s.reenrollment);
  if (!win.active && !anySaved) return null;

  const begin = () => {
    const f = status.family;
    setParent({
      parent_name: f.parent_name ?? "",
      second_parent_name: f.second_parent_name ?? "",
      phone: f.phone ?? "",
      address_street: f.address_street ?? "",
      address_city: f.address_city ?? "",
      address_state: f.address_state ?? "",
      address_zip: f.address_zip ?? "",
    });
    const next: typeof rows = {};
    for (const s of status.students) {
      next[s.student_id] = {
        include: s.reenrollment?.status !== "declined",
        grade: s.reenrollment?.grade_next ?? s.suggested_grade,
        frequency: s.reenrollment?.frequency ?? (s.enrollment?.frequency === "monthly" ? "monthly" : "annual"),
      };
    }
    setRows(next);
    setOpen(true);
  };

  const price = (grade: string, frequency: string) =>
    status.plans.find((p) => p.tuition_tier === tierFor(grade) && p.frequency === frequency)?.price;

  const confirm = async () => {
    if (!parent.parent_name?.trim() || !parent.phone?.trim()) {
      toast({ title: "Parent name and phone are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await callPortalFunction("portal-reenroll", {
        action: "confirm",
        parent,
        students: status.students
          .filter((s) => s.reenrollment?.status !== "paid")
          .map((s) => ({
            student_id: s.student_id,
            grade_next: rows[s.student_id]?.grade,
            frequency: rows[s.student_id]?.frequency,
            decline: !rows[s.student_id]?.include,
          })),
      });
      toast({ title: "Re-enrollment saved", description: "Thank you! Anything still needing payment is shown below." });
      setOpen(false);
      await load();
    } catch (err) {
      toast({ title: "Couldn't save", description: (err as Error).message, variant: "destructive" });
    }
    setSaving(false);
  };

  const pay = async (studentId: string) => {
    setPaying(studentId);
    try {
      const { url } = await callPortalFunction<{ url: string }>("portal-reenroll", { action: "checkout", student_id: studentId });
      window.location.href = url;
    } catch (err) {
      toast({ title: "Couldn't open checkout", description: (err as Error).message, variant: "destructive" });
      setPaying(null);
    }
  };

  const fmt = (d: string | null) => (d ? new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : null);

  return (
    <div
      className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3"
      data-tour={tourId}
      data-testid="reenroll-card"
      data-marker="MCA_R10_REENROLL"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">Re-enroll for {win.school_year}</h3>
          <p className="text-sm text-foreground/70">
            {win.active
              ? `Confirm next year in one step. Your info is filled in already.${win.end ? ` Open through ${fmt(win.end)}.` : ""}`
              : "Re-enrollment is closed right now. Here's what you confirmed."}
          </p>
        </div>
        {win.active && (
          <Button onClick={begin} data-testid="reenroll-start">
            {anySaved ? "Review / change" : "Re-enroll now"}
          </Button>
        )}
      </div>
      <ul className="space-y-1.5">
        {status.students.map((s) => (
          <li key={s.student_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background border border-border/50 px-3 py-2 text-sm">
            <span>
              <strong>{s.student_name}</strong>
              {s.reenrollment && s.reenrollment.status !== "declined" ? ` · ${gradeLabel(s.reenrollment.grade_next)}` : ""}
              <span className="block text-xs text-foreground/60">{statusText(s)}</span>
            </span>
            {s.reenrollment?.status === "awaiting_payment" && win.active && (
              <Button size="sm" disabled={paying !== null} onClick={() => pay(s.student_id)}>
                {paying === s.student_id ? "Opening..." : "Pay now"}
              </Button>
            )}
          </li>
        ))}
      </ul>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Re-enroll for {win.school_year}</DialogTitle>
            <DialogDescription>Check your info, pick each student's grade and plan, then confirm.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {[
              ["parent_name", "Parent name"],
              ["second_parent_name", "Second parent (optional)"],
              ["phone", "Phone"],
              ["address_street", "Street"],
              ["address_city", "City"],
              ["address_state", "State"],
              ["address_zip", "ZIP"],
            ].map(([key, label]) => (
              <div key={key} className={key === "address_street" ? "col-span-2 space-y-1" : "space-y-1"}>
                <Label className="text-xs">{label}</Label>
                <Input value={parent[key] ?? ""} onChange={(e) => setParent((p) => ({ ...p, [key]: e.target.value }))} />
              </div>
            ))}
          </div>
          <div className="space-y-2">
            {status.students.map((s) => {
              const row = rows[s.student_id];
              if (!row) return null;
              const paid = s.reenrollment?.status === "paid";
              const p = price(row.grade, row.frequency);
              return (
                <div key={s.student_id} className="rounded-lg border p-3 space-y-2">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={row.include}
                      disabled={paid}
                      onChange={(e) => setRows((r) => ({ ...r, [s.student_id]: { ...row, include: e.target.checked } }))}
                    />
                    {s.student_name} returns next year
                  </label>
                  {paid ? (
                    <p className="text-xs text-green-700">Already paid. Thank you!</p>
                  ) : row.include ? (
                    <div className="flex flex-wrap gap-2 items-end">
                      <label className="text-xs space-y-1">
                        <span className="block text-foreground/60">Grade next year</span>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={row.grade}
                          onChange={(e) => setRows((r) => ({ ...r, [s.student_id]: { ...row, grade: e.target.value } }))}
                        >
                          {GRADES.map((g) => (
                            <option key={g} value={g}>
                              {gradeLabel(g)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs space-y-1">
                        <span className="block text-foreground/60">Plan</span>
                        <select
                          className="h-9 rounded-md border bg-background px-2 text-sm"
                          value={row.frequency}
                          onChange={(e) => setRows((r) => ({ ...r, [s.student_id]: { ...row, frequency: e.target.value } }))}
                        >
                          <option value="annual">Pay yearly</option>
                          <option value="monthly">Pay monthly</option>
                        </select>
                      </label>
                      {p != null && (
                        <span className="text-xs text-foreground/70 pb-2">
                          ${p}/{row.frequency === "monthly" ? "month" : "year"} ({tierFor(row.grade) === "high_school" ? "high school" : "elementary"})
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-xs text-foreground/60">We'll note that {s.student_name.split(" ")[0]} isn't returning.</p>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-foreground/60">
            Students already on autopay keep renewing on their card; nothing is charged today. Anyone else gets a secure
            Stripe payment page after you confirm.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={confirm} disabled={saving} data-testid="reenroll-confirm">
              {saving ? "Saving..." : "Confirm re-enrollment"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
