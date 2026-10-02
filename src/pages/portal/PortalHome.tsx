import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { currentSchoolYear, nextSchoolYear } from "@/lib/loggedCourses";
import type { PortalContext } from "./PortalLayout";
import { GraduationCreditTracker, StudentRecordsDownloads } from "../admin/AdminAcademicProjection";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, PartyPopper, Truck } from "lucide-react";

const CANCEL_REASON_LABELS: Record<string, string> = {
  graduated: "Graduated",
  moved: "Moved / Relocated",
  financial: "Financial",
  switched_program: "Switched Programs",
  other: "Other",
};


// ---------------------------------------------------------------------------
// Round 10: At a glance, celebrations, payment methods
// ---------------------------------------------------------------------------
// Round 10 parent dashboard pieces (MCA_R10_PARENT_DASHBOARD):
//   StudentAtAGlance   one card per student: current PACEs, what ships next,
//                      recent test results, balance owed, plus the
//                      congratulations screen for new milestones.
//   PaymentMethodsCard saved cards and autopay (portal-billing function).
// Data comes from the mca_portal_student_summary RPC (parents only see their
// own students) and, for cards and Stripe balances, the portal-billing function.

const FUNCTIONS_URL = "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1";

export async function callPortalFunction<T = Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please sign in again.");
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error || `Request failed (${res.status})`);
  return json as T;
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const day = iso.length <= 10 ? new Date(`${iso}T12:00:00`) : new Date(iso);
  return day.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function money(n: number): string {
  return `$${n.toFixed(2)}`;
}

type Celebration = {
  id: string;
  kind: "level" | "school_year";
  title: string;
  level: string | null;
  school_year: string | null;
  created_at: string;
  seen_at: string | null;
};

type Summary = {
  school_year: string;
  current_paces: Array<{ subject: string; pace: number; issued_at: string | null }>;
  progress: { passed: number; total: number };
  next_shipment: {
    ship_date: string | null;
    mode: string | null;
    paused: boolean;
    pause_reason: string | null;
    paces: Array<{ subject: string; pace: number }>;
  };
  last_shipment: { shipped_at: string | null; tracking_number: string | null; tracking_url: string | null } | null;
  recent_tests: Array<{ subject: string; pace: number; score: string | null; status: string; note: string | null; reported_at: string }>;
  balance: {
    total: number;
    past_due: Array<{ student: string; amount: number; status: string }>;
    unpaid_orders: Array<{ id: string; amount: number; created_at: string }>;
  };
  celebrations: Celebration[];
};

function trackingHref(number: string | null, url: string | null): string | null {
  if (url && /^https?:\/\//i.test(url)) return url;
  const n = (number ?? "").replace(/\s+/g, "");
  if (!n) return null;
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return `https://www.ups.com/track?tracknum=${encodeURIComponent(n)}`;
  if (/^(\d{12}|\d{15})$/.test(n)) return `https://www.fedex.com/fedextrack/?trknbr=${encodeURIComponent(n)}`;
  return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(n)}`;
}

/** The congratulations screen. Shown once per milestone; closing marks it seen. */
export function CelebrationModal({
  studentName,
  celebrations,
  onDone,
}: {
  studentName: string;
  celebrations: Celebration[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(celebrations.length > 0);
  useEffect(() => setOpen(celebrations.length > 0), [celebrations.length]);
  if (celebrations.length === 0) return null;
  const close = async () => {
    setOpen(false);
    await Promise.all(celebrations.map((c) => supabase.rpc("mca_mark_celebration_seen", { p_id: c.id })));
    onDone();
  };
  const yearDone = celebrations.find((c) => c.kind === "school_year");
  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent className="max-w-md text-center" data-testid="celebration-modal" data-marker="MCA_R10_CELEBRATION">
        <div className="pointer-events-none select-none text-5xl leading-none" aria-hidden="true">
          🎉 🏆 🎉
        </div>
        <DialogHeader className="items-center text-center sm:text-center">
          <DialogTitle className="font-serif text-2xl text-primary">Congratulations, {studentName}!</DialogTitle>
          <DialogDescription className="text-base text-foreground/80">
            {yearDone ? `You finished the ${yearDone.school_year} school year!` : "You reached a big milestone."}
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {celebrations.map((c) => (
            <li key={c.id} className="rounded-lg bg-primary/10 px-3 py-2 font-medium text-foreground">
              {c.title}
              <span className="block text-xs font-normal text-foreground/60">{fmtDay(c.created_at)}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm italic text-foreground/70">"Whatever you do, work at it with all your heart." Colossians 3:23</p>
        <DialogFooter className="sm:justify-center">
          <Button onClick={close} data-testid="celebration-close">
            <PartyPopper className="h-4 w-4 mr-1.5" />
            Thank you!
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One card per student: current PACEs, next shipment, recent tests, balance owed. */
export function StudentAtAGlance({
  studentId,
  studentName,
  stripeBalance = 0,
  tourId,
}: {
  studentId: string;
  studentName: string;
  /** Open Stripe invoices for the family (from portal-billing). */
  stripeBalance?: number;
  tourId?: string;
}) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const { data, error: rpcError } = await supabase.rpc("mca_portal_student_summary", { p_student_id: studentId });
    if (rpcError) setError(rpcError.message);
    else {
      setError(null);
      setSummary(data as Summary);
    }
  };

  useEffect(() => {
    setSummary(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  if (error) return null;
  if (!summary) {
    return <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 text-sm text-foreground/60">Loading {studentName}'s summary...</div>;
  }

  const next = summary.next_shipment;
  const last = summary.last_shipment;
  const lastHref = last ? trackingHref(last.tracking_number, last.tracking_url) : null;
  const owed = Number(summary.balance?.total ?? 0) + Number(stripeBalance || 0);
  const unseen = (summary.celebrations ?? []).filter((c) => !c.seen_at);
  const pct = summary.progress.total > 0 ? Math.round((summary.progress.passed / summary.progress.total) * 100) : 0;

  return (
    <div
      className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4"
      data-tour={tourId}
      data-testid="student-at-a-glance"
      data-marker="MCA_R10_PARENT_DASHBOARD"
    >
      <CelebrationModal studentName={studentName.split(" ")[0]} celebrations={unseen} onDone={load} />
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold text-foreground">{studentName} at a glance</h3>
        <span className="text-xs text-foreground/60">{summary.school_year} school year</span>
      </div>

      <div>
        <div className="flex justify-between text-xs text-foreground/60 mb-1">
          <span>PACEs passed this year</span>
          <span>
            {summary.progress.passed} of {summary.progress.total}
          </span>
        </div>
        <div className="h-2 rounded-full bg-background border border-border/50 overflow-hidden">
          <div className="h-full bg-green-600" style={{ width: `${pct}%` }} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Working on now</p>
          {summary.current_paces.length === 0 ? (
            <p className="text-sm text-foreground/60">No PACEs handed out right now.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {summary.current_paces.map((p) => (
                <span key={`${p.subject}-${p.pace}`} className="rounded-full bg-background border px-2 py-0.5 text-xs">
                  {p.subject} {p.pace}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Shipping next</p>
          {next.paused ? (
            <p className="text-sm text-amber-700">
              On hold{next.pause_reason ? `: ${next.pause_reason}` : ""}. Upload finished tests so the next box can go out.
            </p>
          ) : next.ship_date ? (
            <p className="text-sm">
              <Truck className="inline h-4 w-4 mr-1 -mt-0.5" />
              Around <strong>{fmtDay(next.ship_date)}</strong>
              {next.mode === "annual" ? " (annual box)" : ""}
            </p>
          ) : (
            <p className="text-sm text-foreground/60">No box scheduled yet.</p>
          )}
          {next.paces.length > 0 && (
            <p className="text-xs text-foreground/70">
              {next.paces.map((p) => `${p.subject} ${p.pace}`).join(", ")}
            </p>
          )}
          {last?.shipped_at && (
            <p className="text-xs text-foreground/60">
              Last box shipped {fmtDay(last.shipped_at)}
              {lastHref && (
                <>
                  {" · "}
                  <a href={lastHref} target="_blank" rel="noreferrer" className="underline">
                    Track it
                  </a>
                </>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-foreground/50">Recent test results</p>
        {summary.recent_tests.length === 0 ? (
          <p className="text-sm text-foreground/60">
            No tests uploaded yet. <Link to="/portal/forms" className="underline">Upload a test</Link>
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {summary.recent_tests.map((t, i) => {
                  const n = parseFloat(t.score ?? "");
                  const result =
                    t.status === "rejected"
                      ? "Sent back"
                      : t.status === "pending"
                        ? "Waiting for MCA"
                        : Number.isNaN(n)
                          ? "Reviewed"
                          : n >= 80
                            ? "Passed"
                            : "Retake";
                  return (
                    <tr key={i} className="border-t border-border/40">
                      <td className="py-1.5 pr-2">{fmtDay(t.reported_at)}</td>
                      <td className="py-1.5 pr-2">
                        {t.subject} {t.pace}
                      </td>
                      <td className="py-1.5 pr-2">{t.score ? `${t.score.replace(/\.00$/, "")}%` : "—"}</td>
                      <td className="py-1.5 text-xs">
                        <span
                          className={
                            result === "Passed"
                              ? "text-green-700"
                              : result === "Retake" || result === "Sent back"
                                ? "text-amber-700"
                                : "text-foreground/60"
                          }
                        >
                          {result}
                        </span>
                        {t.note ? <span className="block text-foreground/60">{t.note}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-background border border-border/50 px-3 py-2">
        <span className="text-sm">
          Balance owed:{" "}
          <strong className={owed > 0 ? "text-amber-700" : "text-green-700"}>{owed > 0 ? money(owed) : "$0.00 — all paid up"}</strong>
        </span>
        {summary.balance?.past_due?.length > 0 && (
          <span className="text-xs text-amber-700">
            Tuition payment didn't go through. Update your card below or call (844) 663-4477.
          </span>
        )}
      </div>
    </div>
  );
}

type BillingState = {
  mode?: string;
  customer_id: string | null;
  cards: Array<{ id: string; brand: string; last4: string; exp_month: number | null; exp_year: number | null; is_default: boolean }>;
  default_payment_method: string | null;
  subscriptions: Array<{
    id: string;
    status: string;
    cancel_at_period_end: boolean;
    renews_on: string | null;
    amount: number;
    interval: string | null;
    card: string | null;
    autopay: boolean;
  }>;
  open_balance: number;
  open_invoices: Array<{ id: string; amount: number; due: string | null; url: string | null }>;
};

/** Saved cards and autopay. Adding a card uses Stripe's secure page and never charges. */
export function PaymentMethodsCard({
  onBalance,
  tourId,
}: {
  onBalance?: (amount: number) => void;
  tourId?: string;
}) {
  const { toast } = useToast();
  const [state, setState] = useState<BillingState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const data = await callPortalFunction<BillingState>("portal-billing", { action: "list" });
      setState(data);
      setError(null);
      onBalance?.(Number(data.open_balance ?? 0));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("billing");
    if (flag === "saved") toast({ title: "Card saved", description: "It's ready for autopay and store orders." });
    if (flag === "cancelled") toast({ title: "No card was added" });
    if (flag) {
      params.delete("billing");
      const q = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}`);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addCard = async () => {
    setBusy("add");
    try {
      const { url } = await callPortalFunction<{ url: string }>("portal-billing", { action: "setup", return_path: "/portal" });
      window.location.href = url;
    } catch (err) {
      toast({ title: "Couldn't open the card form", description: (err as Error).message, variant: "destructive" });
      setBusy(null);
    }
  };

  const act = async (action: "set_default" | "remove", id: string) => {
    if (action === "remove" && !window.confirm("Remove this card? Autopay will use your other default card.")) return;
    setBusy(id);
    try {
      const data = await callPortalFunction<BillingState>("portal-billing", { action, payment_method_id: id });
      setState(data);
      toast({ title: action === "set_default" ? "Autopay card updated" : "Card removed" });
    } catch (err) {
      toast({ title: "Couldn't update the card", description: (err as Error).message, variant: "destructive" });
    }
    setBusy(null);
  };

  return (
    <div
      className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3"
      data-tour={tourId}
      data-testid="payment-methods-card"
      data-marker="MCA_R10_SAVED_CARDS"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-foreground">Payment methods &amp; autopay</h3>
          <p className="text-xs text-foreground/60">
            Tuition renews automatically on the card marked Autopay. Saved cards also show up at store checkout when
            you're signed in. Adding a card doesn't charge anything.
          </p>
        </div>
        <Button size="sm" onClick={addCard} disabled={busy !== null} data-testid="add-card">
          <CreditCard className="h-4 w-4 mr-1.5" />
          {busy === "add" ? "Opening..." : "Add a card"}
        </Button>
      </div>

      {error && <p className="text-sm text-foreground/60">Card details aren't available right now. ({error})</p>}
      {!state && !error && <p className="text-sm text-foreground/60">Loading cards...</p>}

      {state && (
        <>
          {state.cards.length === 0 ? (
            <p className="text-sm text-foreground/60">No saved cards yet.</p>
          ) : (
            <ul className="space-y-2">
              {state.cards.map((card) => (
                <li
                  key={card.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 bg-background px-3 py-2 text-sm"
                >
                  <span>
                    <span className="capitalize">{card.brand}</span> ending {card.last4}
                    {card.exp_month && card.exp_year ? (
                      <span className="text-foreground/60">
                        {" "}
                        · exp {String(card.exp_month).padStart(2, "0")}/{String(card.exp_year).slice(-2)}
                      </span>
                    ) : null}
                    {card.is_default && (
                      <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">Autopay</span>
                    )}
                  </span>
                  <span className="flex gap-1">
                    {!card.is_default && (
                      <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => act("set_default", card.id)}>
                        Use for autopay
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busy !== null}
                      onClick={() => act("remove", card.id)}
                    >
                      Remove
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {state.subscriptions.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-foreground/50">Tuition autopay</p>
              {state.subscriptions.map((sub) => {
                const card = state.cards.find((c) => c.id === sub.card);
                return (
                  <p key={sub.id} className="text-sm">
                    {money(sub.amount)}/{sub.interval === "month" ? "month" : "year"} ·{" "}
                    {sub.autopay ? (
                      <>
                        renews {fmtDay(sub.renews_on)}
                        {card ? ` on ${card.brand} ending ${card.last4}` : ""}
                      </>
                    ) : sub.cancel_at_period_end ? (
                      <>ends {fmtDay(sub.renews_on)} (won't renew)</>
                    ) : (
                      <>status {sub.status}</>
                    )}
                  </p>
                );
              })}
            </div>
          )}

          {state.open_invoices.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-wide text-foreground/50">Open invoices</p>
              {state.open_invoices.map((inv) => (
                <p key={inv.id} className="text-sm">
                  {money(inv.amount)}
                  {inv.due ? ` due ${fmtDay(inv.due)}` : ""}
                  {inv.url && (
                    <>
                      {" · "}
                      <a className="underline" href={inv.url} target="_blank" rel="noreferrer">
                        Pay now
                      </a>
                    </>
                  )}
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Round 10: one-click re-enrollment card
// ---------------------------------------------------------------------------
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

interface Enrollment {
  id: string;
  student_id: string;
  tuition_tier: string;
  frequency: string | null;
  price: number | null;
  status: string;
  stripe_subscription_status: string | null;
  current_period_end: string | null;
}

interface OrderItemRow {
  quantity: number;
  item_id: string | null;
  items: { original_name: string } | null;
}

interface Order {
  id: string;
  status: string;
  payment_status: string;
  total: number;
  created_at: string;
  order_items: OrderItemRow[];
}

const STATUS_LABELS: Record<string, string> = {
  submitted: "Submitted",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

function BooksNeededCard({ studentId }: { studentId: string }) {
  const [books, setBooks] = useState<Array<{ id: string; name: string; price: number | null }>>([]);

  useEffect(() => {
    let ignore = false;
    supabase
      .from("resource_book_notices")
      .select("id, item_id, purchased_order_id, items(original_name, sales_price)")
      .eq("student_id", studentId)
      .is("purchased_order_id", null)
      .then(({ data }) => {
        if (ignore) return;
        setBooks(
          (data ?? []).map((row) => {
            const item = row.items as
              | { original_name: string; sales_price: number }
              | { original_name: string; sales_price: number }[]
              | null;
            const record = Array.isArray(item) ? item[0] : item;
            return {
              id: row.item_id,
              name: record?.original_name ?? "Book",
              price: record?.sales_price ?? null,
            };
          }),
        );
      });
    return () => {
      ignore = true;
    };
  }, [studentId]);

  if (books.length === 0) return null;
  const href = `/store?add=${books.map((book) => book.id).join(",")}`;
  return (
    <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-2">
      <h3 className="font-semibold text-foreground">Books needed</h3>
      <ul className="text-sm text-foreground/80 space-y-1">
        {books.map((book) => (
          <li key={book.id}>
            {book.name}
            {book.price != null ? ` – $${Number(book.price).toFixed(2)}` : ""}
          </li>
        ))}
      </ul>
      <Button asChild>
        <Link to={href}>Buy in the MCA store</Link>
      </Button>
    </div>
  );
}

/**
 * Round 3 P3 (marker MCA_R3_P3_START_DATE_SHIPS): parents pick the first day of
 * school once per year. MCA builds the shipping schedule from it.
 */
function StartSchoolYearCard({ studentId, studentName }: { studentId: string; studentName: string }) {
  const { toast } = useToast();
  const [missingYears, setMissingYears] = useState<string[]>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const now = new Date();
    const current = currentSchoolYear(now);
    const years = [current];
    // From June 1, also offer next school year.
    if (now.getMonth() === 5) years.push(nextSchoolYear(current));
    const { data } = await supabase
      .from("student_school_calendars")
      .select("school_year")
      .eq("student_id", studentId)
      .in("school_year", years);
    const have = new Set((data ?? []).map((row) => row.school_year as string));
    setMissingYears(years.filter((year) => !have.has(year)));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studentId]);

  const save = async (year: string) => {
    const date = dates[year];
    if (!date) return;
    const ok = window.confirm(
      `Start ${studentName}'s ${year} school year on ${date}? This can't be changed online. Contact MCA if you need to change it later.`,
    );
    if (!ok) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("student_school_calendars").insert({
      student_id: studentId,
      school_year: year,
      start_date: date,
      set_by: user?.id ?? null,
    });
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save the start date", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "School start date saved", description: "MCA will plan your PACE shipments from this date." });
    load();
  };

  if (missingYears.length === 0) return null;
  return (
    <>
      {missingYears.map((year) => {
        const first = year.slice(0, 4);
        return (
          <div
            key={year}
            className="rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-3"
            data-marker="MCA_R3_P3_START_DATE_SHIPS"
          >
            <h3 className="font-semibold text-foreground">Start your {year} school year</h3>
            <p className="text-sm text-foreground/70">
              Pick {studentName}'s first day of school. MCA ships PACEs about two weeks before each
              quarter, starting from this date. You can set it once.
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <div className="space-y-1">
                <Label className="text-xs">First day of school</Label>
                <Input
                  type="date"
                  className="bg-background h-9 w-44"
                  min={`${first}-07-01`}
                  max={`${first}-12-31`}
                  value={dates[year] ?? ""}
                  onChange={(e) => setDates((prev) => ({ ...prev, [year]: e.target.value }))}
                />
              </div>
              <Button disabled={saving || !dates[year]} onClick={() => save(year)}>
                Save start date
              </Button>
            </div>
          </div>
        );
      })}
    </>
  );
}

const PortalHome = () => {
  const { family, students, selectedStudent } =
    useOutletContext<PortalContext>();
  const { toast } = useToast();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [stripeBalance, setStripeBalance] = useState<number | null>(null);

  const [cancelingEnrollment, setCancelingEnrollment] =
    useState<Enrollment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submittingCancel, setSubmittingCancel] = useState(false);

  const loadEnrollments = async () => {
    setLoading(true);
    // Filtered explicitly, not left to RLS alone — an admin who is also a
    // linked parent (admin_full_access grants visibility into every
    // family's data) would otherwise see every family's orders and
    // enrollments here, not just their own.
    const studentIds = students.map((s) => s.id);

    const [enrollmentsRes, ordersRes] = await Promise.all([
      studentIds.length > 0
        ? supabase
            .from("enrollments")
            .select(
              "id, student_id, tuition_tier, frequency, price, status, stripe_subscription_status, current_period_end",
            )
            .in("student_id", studentIds)
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("orders")
        .select(
          `
            id, status, payment_status, total, created_at,
            order_items ( quantity, item_id, items ( original_name ) )
          `,
        )
        .eq("family_id", family.id)
        .order("created_at", { ascending: false }),
    ]);

    if (enrollmentsRes.data)
      setEnrollments(enrollmentsRes.data as Enrollment[]);
    if (ordersRes.data) setOrders(ordersRes.data as any);
    setLoading(false);
  };

  useEffect(() => {
    loadEnrollments();
  }, [family.id, students]);

  const openCancelDialog = (enrollment: Enrollment) => {
    setCancelReason("");
    setCancelingEnrollment(enrollment);
  };

  const confirmCancel = async () => {
    if (!cancelingEnrollment || !cancelReason) return;
    setSubmittingCancel(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(
      "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1/portal-cancel-enrollment",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          enrollment_id: cancelingEnrollment.id,
          reason: cancelReason,
        }),
      },
    );
    const result = await res.json();

    if (!res.ok || result.error) {
      toast({
        title: "Couldn't cancel enrollment",
        description: result.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Enrollment cancelled",
        description:
          "This won't renew again. Since the current period is already paid for, there's no refund for it — access continues through the date shown above.",
      });
    }

    setSubmittingCancel(false);
    setCancelingEnrollment(null);
    loadEnrollments();
  };

  if (loading) {
    return <p className="text-foreground/60">Loading...</p>;
  }

  const selectedEnrollment = enrollments.find(
    (e) => e.student_id === selectedStudent?.id,
  );

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary mb-1">
          Welcome, {family.parent_name.split(" ")[0]}
        </h2>
        <p className="text-sm text-foreground/60">{family.email}</p>
      </div>

      {/* Round 10 (MCA_R10_DASHBOARD): one-glance summary per student. */}
      {selectedStudent && (
        <StudentAtAGlance
          key={`glance-${selectedStudent.id}`}
          studentId={selectedStudent.id}
          studentName={selectedStudent.student_name}
          stripeBalance={stripeBalance}
          tourId="portal-at-a-glance"
        />
      )}
      <ReEnrollCard tourId="portal-reenroll" />

      {selectedStudent && selectedEnrollment?.status === "active" && (
        <StartSchoolYearCard
          key={selectedStudent.id}
          studentId={selectedStudent.id}
          studentName={selectedStudent.student_name}
        />
      )}
      {selectedStudent && <BooksNeededCard studentId={selectedStudent.id} />}

      {selectedStudent && (
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5">
          <h3 className="font-semibold text-foreground mb-3">
            {selectedStudent.student_name}'s Enrollment
          </h3>
          {selectedEnrollment ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-foreground/50 text-xs uppercase tracking-wide">
                  Tier
                </p>
                <p className="font-medium capitalize">
                  {selectedEnrollment.tuition_tier.replace("_", " ")}
                </p>
              </div>
              <div>
                <p className="text-foreground/50 text-xs uppercase tracking-wide">
                  Plan
                </p>
                <p className="font-medium capitalize">
                  {selectedEnrollment.frequency}
                  {selectedEnrollment.price != null &&
                    ` — $${selectedEnrollment.price}`}
                </p>
              </div>
              <div>
                <p className="text-foreground/50 text-xs uppercase tracking-wide">
                  Status
                </p>
                <p className="font-medium capitalize">
                  {selectedEnrollment.status}
                </p>
              </div>
              <div>
                <p className="text-foreground/50 text-xs uppercase tracking-wide">
                  Renews
                </p>
                <p className="font-medium">
                  {selectedEnrollment.current_period_end
                    ? new Date(
                        selectedEnrollment.current_period_end,
                      ).toLocaleDateString()
                    : "—"}
                </p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-foreground/60">
              No tuition enrollment on file for this student.
            </p>
          )}
          {selectedEnrollment?.status === "active" && (
            <div className="mt-4 pt-4 border-t border-border/50">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => openCancelDialog(selectedEnrollment)}
              >
                Cancel Enrollment
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Round 8: report card / transcript PDFs and the credit bar. */}
      {selectedStudent && (
        <StudentRecordsDownloads
          key={`records-${selectedStudent.id}`}
          studentId={selectedStudent.id}
          highSchool={selectedEnrollment?.tuition_tier === "high_school"}
          tourId="portal-report-downloads"
        />
      )}
      {selectedStudent && selectedEnrollment?.tuition_tier === "high_school" && (
        <GraduationCreditTracker
          key={`credits-${selectedStudent.id}`}
          studentId={selectedStudent.id}
          tourId="portal-home-grad-credits"
        />
      )}

      <PaymentMethodsCard onBalance={setStripeBalance} tourId="portal-payment-methods" />

      <div>
        <h3 className="font-semibold text-foreground mb-3">Order History</h3>
        {orders.length === 0 ? (
          <p className="text-sm text-foreground/60">No store orders yet.</p>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="rounded-lg border border-border/50 bg-background p-4"
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-foreground/60">
                    {new Date(order.created_at).toLocaleDateString()}
                  </p>
                  <span className="text-xs font-medium px-2 py-1 rounded-full bg-secondary">
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </div>
                <p className="text-sm text-foreground/80">
                  {order.order_items
                    .map((oi) => oi.items?.original_name)
                    .filter(Boolean)
                    .join(", ")}
                </p>
                <div className="flex items-center justify-between mt-1 gap-2">
                  <p className="font-semibold text-primary">
                    ${order.total.toFixed(2)}
                  </p>
                  {order.order_items.some((oi) => oi.item_id) && (
                    <Button size="sm" variant="outline" asChild data-testid="reorder-button">
                      <Link
                        to={`/store?add=${Array.from(
                          new Set(order.order_items.map((oi) => oi.item_id).filter(Boolean)),
                        ).join(",")}`}
                      >
                        Reorder
                      </Link>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {students.length === 0 && (
        <p className="text-sm text-foreground/60">
          No students on file yet. Contact the school if this doesn't look
          right.
        </p>
      )}

      <AlertDialog
        open={!!cancelingEnrollment}
        onOpenChange={(open) => !open && setCancelingEnrollment(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {selectedStudent?.student_name}'s enrollment?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This stops future billing — it doesn't end things early. The
              current period is already paid for, so there's no refund for it,
              and access continues through{" "}
              {cancelingEnrollment?.current_period_end
                ? new Date(
                    cancelingEnrollment.current_period_end,
                  ).toLocaleDateString()
                : "the end of the current period"}
              . This can't be undone from here — call the school if you change
              your mind afterward.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="portal-cancel-reason">Reason</Label>
            <Select value={cancelReason} onValueChange={setCancelReason}>
              <SelectTrigger
                id="portal-cancel-reason"
                className="bg-background"
              >
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(CANCEL_REASON_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Nevermind</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmCancel}
              disabled={!cancelReason || submittingCancel}
            >
              {submittingCancel ? "Cancelling..." : "Confirm Cancellation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default PortalHome;
