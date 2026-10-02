import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { CreditCard, PartyPopper, Truck } from "lucide-react";

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
