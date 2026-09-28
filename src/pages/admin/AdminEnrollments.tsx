import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

type Enrollment = {
  id: string;
  tuition_tier: string;
  status: string;
  cancellation_reason: string | null;
  stripe_subscription_status: string | null;
  cancel_at_period_end: boolean;
  current_period_end: string | null;
  frequency: string | null;
  price: number | null;
  is_comp: boolean;
  comp_reason: string | null;
  students: {
    student_name: string;
    families: { parent_name: string; email: string };
  } | null;
};

const COMP_REASON_LABELS: Record<string, string> = {
  financial_hardship: "Financial Hardship",
  staff_family: "Staff / Family",
  scholarship: "Scholarship",
  pilot: "Pilot / Trial",
  other: "Other",
};

const REASON_LABELS: Record<string, string> = {
  graduated: "Graduated",
  moved: "Moved / Relocated",
  financial: "Financial",
  switched_program: "Switched Programs",
  other: "Other",
};

const AdminEnrollments = () => {
  const { toast } = useToast();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Deep-link support: a GHL Workflow notification links back here as
  // /admin/enrollments?id=<enrollment uuid>. When present, filters are
  // reset so the target row can't be hidden, and it's scrolled into view
  // and highlighted once the data loads.
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const [cancelingEnrollment, setCancelingEnrollment] =
    useState<Enrollment | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submittingCancel, setSubmittingCancel] = useState(false);

  const loadEnrollments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("enrollments")
      .select(
        `
        id, tuition_tier, status, cancellation_reason, stripe_subscription_status, cancel_at_period_end, current_period_end, frequency, price, is_comp, comp_reason,
        students ( student_name, families ( parent_name, email ) )
      `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Couldn't load enrollments",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setEnrollments((data as any) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id");
    if (id) {
      setHighlightId(id);
      setStatusFilter("all");
      setSearch("");
    }
    loadEnrollments();
  }, []);

  useEffect(() => {
    if (!highlightId || loading) return;
    const row = document.getElementById(`enrollment-row-${highlightId}`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, loading, enrollments]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enrollments.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (!term) return true;
      const haystack = [
        e.students?.families?.parent_name,
        e.students?.families?.email,
        e.students?.student_name,
        e.tuition_tier,
        e.status,
        e.stripe_subscription_status,
        e.frequency,
        e.is_comp ? "comp" : null,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [enrollments, statusFilter, search]);

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
      "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1/cancel-enrollment",
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
        description: `Stripe action: ${result.stripe_action.replaceAll("_", " ")}`,
      });
    }

    setSubmittingCancel(false);
    setCancelingEnrollment(null);
    loadEnrollments();
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold font-serif text-primary">
        Current Enrollments
      </h2>

      {highlightId && (
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 text-sm text-foreground/80 flex items-center justify-between">
          <span>
            Showing you a specific enrollment from a notification link.
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setHighlightId(null);
              window.history.replaceState({}, "", window.location.pathname);
            }}
          >
            Clear
          </Button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-4">
        <Input
          placeholder="Search parent, email, student, tier, status..."
          className="bg-background max-w-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-background w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="withdrawn">Withdrawn</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-3">Parent</th>
                <th className="p-3">Email</th>
                <th className="p-3">Student</th>
                <th className="p-3">Tier</th>
                <th className="p-3">Frequency</th>
                <th className="p-3">Price</th>
                <th className="p-3">Status</th>
                <th className="p-3">Reason</th>
                <th className="p-3">Stripe Status</th>
                <th className="p-3">Period End</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr
                  key={e.id}
                  id={`enrollment-row-${e.id}`}
                  className={`border-t border-border/50 ${
                    e.id === highlightId ? "bg-primary/10" : ""
                  }`}
                >
                  <td className="p-3">
                    {e.students?.families?.parent_name ?? "—"}
                  </td>
                  <td className="p-3">{e.students?.families?.email ?? "—"}</td>
                  <td className="p-3">{e.students?.student_name ?? "—"}</td>
                  <td className="p-3">{e.tuition_tier}</td>
                  <td className="p-3 capitalize">{e.frequency ?? "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <span>{e.price != null ? `$${e.price}` : "—"}</span>
                      {e.is_comp && (
                        <span
                          className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700"
                          title={
                            e.comp_reason
                              ? `Comp — ${COMP_REASON_LABELS[e.comp_reason] ?? e.comp_reason}`
                              : "Comp"
                          }
                        >
                          Comp
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3">{e.status}</td>
                  <td className="p-3">
                    {e.cancellation_reason
                      ? REASON_LABELS[e.cancellation_reason]
                      : "—"}
                  </td>
                  <td className="p-3">{e.stripe_subscription_status ?? "—"}</td>
                  <td className="p-3">
                    {e.current_period_end
                      ? new Date(e.current_period_end).toLocaleDateString()
                      : "—"}
                  </td>
                  <td className="p-3">
                    {e.status === "active" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => openCancelDialog(e)}
                      >
                        Cancel
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={11}
                    className="p-3 text-center text-foreground/60"
                  >
                    {enrollments.length === 0
                      ? "No enrollments yet."
                      : "No enrollments match your search/filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog
        open={!!cancelingEnrollment}
        onOpenChange={(open) => !open && setCancelingEnrollment(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel {cancelingEnrollment?.students?.student_name}'s enrollment?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Stripe only receives a plain cancellation — no reason is sent
              there. This is purely for your own records. If this student shares
              billing with a sibling, only their seat is removed; if they're the
              family's last enrolled student, the whole subscription is
              cancelled at period end. No proration either way — the current
              period stays paid for.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="cancel-reason">Reason</Label>
            <Select value={cancelReason} onValueChange={setCancelReason}>
              <SelectTrigger id="cancel-reason" className="bg-background">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REASON_LABELS).map(([value, label]) => (
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

export default AdminEnrollments;
