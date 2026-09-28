import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
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

type Plan = {
  id: string;
  name: string;
  tuition_tier: string;
  frequency: string;
  price: number;
  stripe_price_id: string | null;
  active: boolean;
};

type PriceChangeLogRow = {
  id: string;
  old_price: number | null;
  new_price: number | null;
  change_source: string;
  changed_at: string;
  subscription_plans: { name: string } | null;
  admin_users: { name: string | null } | null;
};

const CHANGE_SOURCE_LABELS: Record<string, string> = {
  manual: "Manual edit",
  csv_import: "CSV import",
  stripe_sync: "Stripe sync",
};

const AdminPlans = () => {
  const { toast } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planEdits, setPlanEdits] = useState<Record<string, string>>({});
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);
  const [confirmingPlan, setConfirmingPlan] = useState<Plan | null>(null);
  const [togglingPlanId, setTogglingPlanId] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState<Plan | null>(
    null,
  );

  const [priceHistory, setPriceHistory] = useState<PriceChangeLogRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    loadPlans();
    loadPriceHistory();
  }, []);

  const loadPlans = async () => {
    const { data, error } = await supabase
      .from("subscription_plans")
      .select(
        "id, name, tuition_tier, frequency, price, stripe_price_id, active",
      )
      .order("tuition_tier")
      .order("frequency");

    if (error) {
      toast({
        title: "Couldn't load subscription plans",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setPlans(data ?? []);
      const edits: Record<string, string> = {};
      (data ?? []).forEach((p) => {
        edits[p.id] = String(p.price);
      });
      setPlanEdits(edits);
    }
  };

  // Every plan price save already writes a row here (via this page's own
  // confirmSave, and via CSV/manual item price changes elsewhere) — this
  // just surfaces that existing log instead of it being invisible.
  const loadPriceHistory = async () => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from("price_change_log")
      .select(
        "id, old_price, new_price, change_source, changed_at, subscription_plans(name), admin_users(name)",
      )
      .not("subscription_plan_id", "is", null)
      .order("changed_at", { ascending: false })
      .limit(50);

    if (error) {
      toast({
        title: "Couldn't load price history",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setPriceHistory((data as unknown as PriceChangeLogRow[]) ?? []);
    }
    setLoadingHistory(false);
  };

  const handleSaveClick = (plan: Plan) => {
    const newPrice = Number(planEdits[plan.id]);
    if (!newPrice || newPrice <= 0) {
      toast({
        title: "Invalid price",
        description: "Enter a positive number.",
        variant: "destructive",
      });
      return;
    }
    setConfirmingPlan(plan);
  };

  const confirmSave = async () => {
    if (!confirmingPlan) return;
    const plan = confirmingPlan;
    setConfirmingPlan(null);
    setSavingPlanId(plan.id);

    const newPrice = Number(planEdits[plan.id]);

    // The price update itself now happens inside sync-subscription-plan-price,
    // not here — it needs to read the CURRENT (still-old) price from the
    // database to log an accurate old/new pair in price_change_log. Updating
    // it client-side first (the previous approach) meant the function always
    // saw the new price already in place when it went looking for the old
    // one, logging the same value as both old and new every time.
    const {
      data: { session: currentSession },
    } = await supabase.auth.getSession();
    const res = await fetch(
      "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1/sync-subscription-plan-price",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${currentSession?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ plan_id: plan.id, new_price: newPrice }),
      },
    );
    const result = await res.json();

    if (!res.ok || result.error) {
      toast({
        title: "Couldn't update price",
        description:
          result.error ||
          "Check the sync-subscription-plan-price function logs.",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Price updated",
        description: `New Stripe Price: ${result.stripe_price_id}`,
      });
    }

    setSavingPlanId(null);
    loadPlans();
    loadPriceHistory();
  };

  // Turning a plan OFF stops it being offered on /enroll going forward, so
  // that direction gets a confirmation; turning one back ON is harmless and
  // applies immediately.
  const handleToggleActive = (plan: Plan) => {
    if (plan.active) {
      setConfirmingDeactivate(plan);
    } else {
      setPlanActive(plan, true);
    }
  };

  const setPlanActive = async (plan: Plan, active: boolean) => {
    setTogglingPlanId(plan.id);
    const { error } = await supabase
      .from("subscription_plans")
      .update({ active })
      .eq("id", plan.id);

    if (error) {
      toast({
        title: "Couldn't update plan",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({
        title: active ? "Plan activated" : "Plan deactivated",
        description: active
          ? `${plan.name} is now offered on the enrollment page.`
          : `${plan.name} will no longer be offered on the enrollment page. Families already enrolled are unaffected.`,
      });
    }
    setTogglingPlanId(null);
    loadPlans();
  };

  const confirmDeactivate = () => {
    if (!confirmingDeactivate) return;
    const plan = confirmingDeactivate;
    setConfirmingDeactivate(null);
    setPlanActive(plan, false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary mb-2">
          Subscription Plans
        </h2>
        <p className="text-sm text-foreground/60">
          Changing a price here only affects new enrollments going forward.
          Families already enrolled keep the price they signed up at — no
          proration, ever, per standing policy.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50">
        <table className="w-full text-sm">
          <thead className="bg-secondary text-left">
            <tr>
              <th className="p-3">Plan</th>
              <th className="p-3">Tier</th>
              <th className="p-3">Frequency</th>
              <th className="p-3">Price</th>
              <th className="p-3">Stripe Price ID</th>
              <th className="p-3">Active</th>
              <th className="p-3"></th>
            </tr>
          </thead>
          <tbody>
            {plans.map((plan) => (
              <tr key={plan.id} className="border-t border-border/50">
                <td className="p-3">{plan.name}</td>
                <td className="p-3">{plan.tuition_tier}</td>
                <td className="p-3">{plan.frequency}</td>
                <td className="p-3">
                  <Input
                    type="number"
                    className="w-28 bg-background"
                    value={planEdits[plan.id] ?? ""}
                    onChange={(e) =>
                      setPlanEdits({ ...planEdits, [plan.id]: e.target.value })
                    }
                  />
                </td>
                <td className="p-3 font-mono text-xs">
                  {plan.stripe_price_id ?? "—"}
                </td>
                <td className="p-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={plan.active}
                      onCheckedChange={() => handleToggleActive(plan)}
                      disabled={togglingPlanId === plan.id}
                      aria-label={`${plan.active ? "Deactivate" : "Activate"} ${plan.name}`}
                    />
                    <span className="text-xs text-foreground/60">
                      {plan.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                </td>
                <td className="p-3">
                  <Button
                    size="sm"
                    disabled={
                      savingPlanId === plan.id ||
                      Number(planEdits[plan.id]) === plan.price
                    }
                    onClick={() => handleSaveClick(plan)}
                  >
                    {savingPlanId === plan.id ? "Saving..." : "Save"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-border/50">
        <button
          type="button"
          onClick={() => setShowHistory((v) => !v)}
          className="w-full flex items-center justify-between p-4 text-left"
        >
          <h3 className="font-semibold text-foreground">
            Price Change History{" "}
            {priceHistory.length > 0 && `(${priceHistory.length})`}
          </h3>
          <span className="text-sm text-foreground/60">
            {showHistory ? "Hide" : "Show"}
          </span>
        </button>

        {showHistory && (
          <div className="border-t border-border/50 overflow-x-auto">
            {loadingHistory ? (
              <p className="p-4 text-foreground/60 text-sm">Loading...</p>
            ) : priceHistory.length === 0 ? (
              <p className="p-4 text-foreground/60 text-sm">
                No plan price changes recorded yet.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-secondary text-left">
                  <tr>
                    <th className="p-3">Plan</th>
                    <th className="p-3">Old Price</th>
                    <th className="p-3">New Price</th>
                    <th className="p-3">Source</th>
                    <th className="p-3">Changed By</th>
                    <th className="p-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {priceHistory.map((row) => (
                    <tr key={row.id} className="border-t border-border/50">
                      <td className="p-3">
                        {row.subscription_plans?.name ?? "—"}
                      </td>
                      <td className="p-3">
                        {row.old_price != null ? `$${row.old_price}` : "—"}
                      </td>
                      <td className="p-3 font-medium">
                        {row.new_price != null ? `$${row.new_price}` : "—"}
                      </td>
                      <td className="p-3">
                        {CHANGE_SOURCE_LABELS[row.change_source] ??
                          row.change_source}
                      </td>
                      <td className="p-3">{row.admin_users?.name ?? "—"}</td>
                      <td className="p-3 text-foreground/60">
                        {new Date(row.changed_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <AlertDialog
        open={!!confirmingPlan}
        onOpenChange={(open) => !open && setConfirmingPlan(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Change {confirmingPlan?.name} price?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This changes the price from{" "}
              <strong>${confirmingPlan?.price}</strong> to{" "}
              <strong>
                ${confirmingPlan ? planEdits[confirmingPlan.id] : ""}
              </strong>
              . This applies to all new enrollments starting immediately —
              families already enrolled keep their current price unchanged. If
              this is a mistake, you'd need to change it back manually.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSave}>
              Confirm Change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={!!confirmingDeactivate}
        onOpenChange={(open) => !open && setConfirmingDeactivate(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate {confirmingDeactivate?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This plan will stop being offered on the enrollment page
              immediately. Families already enrolled on it keep their enrollment
              unchanged — this only affects new sign-ups. You can reactivate it
              here at any time.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDeactivate}>
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminPlans;
