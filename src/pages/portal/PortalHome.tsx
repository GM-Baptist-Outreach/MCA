import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
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
import type { PortalContext } from "./PortalLayout";

const CANCEL_REASON_LABELS: Record<string, string> = {
  graduated: "Graduated",
  moved: "Moved / Relocated",
  financial: "Financial",
  switched_program: "Switched Programs",
  other: "Other",
};

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

const PortalHome = () => {
  const { family, students, selectedStudent } =
    useOutletContext<PortalContext>();
  const { toast } = useToast();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

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
            order_items ( quantity, items ( original_name ) )
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
                <p className="font-semibold text-primary mt-1">
                  ${order.total.toFixed(2)}
                </p>
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
