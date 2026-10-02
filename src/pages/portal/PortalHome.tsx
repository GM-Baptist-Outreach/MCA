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
