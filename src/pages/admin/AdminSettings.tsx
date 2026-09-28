import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
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

type PaymentMode = "test" | "live";

function asMode(value: string | null | undefined): PaymentMode {
  return value === "test" ? "test" : "live";
}

const AdminSettings = () => {
  const { toast } = useToast();
  const [mode, setMode] = useState<PaymentMode>("live");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pendingMode, setPendingMode] = useState<PaymentMode | null>(null);

  useEffect(() => {
    let cancelled = false;
    const loadMode = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("app_settings")
        .select("value, updated_at")
        .eq("key", "payment_mode")
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        toast({
          title: "Couldn't load payment mode",
          description: error.message,
          variant: "destructive",
        });
      } else {
        setMode(asMode(data?.value));
        setUpdatedAt(data?.updated_at ?? null);
      }
      setLoading(false);
    };
    loadMode();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  const confirmSwitch = async () => {
    if (!pendingMode || pendingMode === mode) {
      setPendingMode(null);
      return;
    }
    setSaving(true);
    const next = pendingMode;
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "payment_mode", value: next }, { onConflict: "key" });

    if (error) {
      toast({
        title: "Couldn't update payment mode",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setMode(next);
      setUpdatedAt(new Date().toISOString());
      toast({
        title: next === "live" ? "Payments are live" : "Payments are in test",
        description:
          next === "live"
            ? "Checkout will create real charges."
            : "Checkout will use Stripe Sandbox. No real charges.",
      });
    }
    setSaving(false);
    setPendingMode(null);
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary mb-2">
          Payments
        </h2>
        <p className="text-sm text-foreground/60">
          One switch for Stripe and Shippo. It is saved in the database and
          read on the next checkout, so flipping it does not require a redeploy.
        </p>
      </div>

      <section className="bg-secondary p-6 rounded-xl border border-border/50 space-y-5">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground/70">Current mode</p>
          {loading ? (
            <p className="text-foreground/60">Loading...</p>
          ) : (
            <p
              className={`text-3xl font-bold font-serif ${
                mode === "live" ? "text-primary" : "text-amber-800"
              }`}
              data-testid="payment-mode-current"
            >
              {mode === "live" ? "Live" : "Test"}
            </p>
          )}
          {updatedAt && !loading && (
            <p className="text-xs text-foreground/50">
              Updated {new Date(updatedAt).toLocaleString()}
            </p>
          )}
        </div>

        <div
          className="flex flex-col sm:flex-row gap-3"
          role="group"
          aria-label="Payments: Test / Live"
        >
          <Button
            type="button"
            variant={mode === "test" ? "default" : "outline"}
            aria-pressed={mode === "test"}
            disabled={loading || saving}
            onClick={() => mode !== "test" && setPendingMode("test")}
          >
            Test
          </Button>
          <Button
            type="button"
            variant={mode === "live" ? "default" : "outline"}
            aria-pressed={mode === "live"}
            disabled={loading || saving}
            onClick={() => mode !== "live" && setPendingMode("live")}
          >
            Live
          </Button>
        </div>

        <p className="text-sm text-foreground/80">
          Test = Stripe Sandbox + Shippo test rates; Live = real charges +
          real Shippo rates (or tier fallback).
        </p>
        <ul className="text-sm text-foreground/60 list-disc pl-5 space-y-1">
          <li>
            Store orders that ship use Shippo when that mode&apos;s key is set.
            If the key is missing or Shippo fails, shipping falls back to the
            quantity tiers and checkout still opens.
          </li>
          <li>Local pickup and tuition never call Shippo.</li>
          <li>
            Enrollment checkout, store checkout, plan price sync, refunds, and
            cancellations use the Stripe secret for this mode.
          </li>
          <li>
            After switching, re-save subscription plan prices so the Stripe
            price IDs belong to the same mode.
          </li>
        </ul>
      </section>

      <AlertDialog
        open={pendingMode !== null}
        onOpenChange={(open) => !open && !saving && setPendingMode(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingMode === "live"
                ? "Switch payments to Live?"
                : "Switch payments to Test?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingMode === "live"
                ? "Live charges real cards and requests real Shippo rates. Store shipping falls back to quantity tiers if Shippo is unavailable."
                : "Test uses Stripe Sandbox and Shippo test rates. Checkout sessions will be test-mode (cs_test_), and no real charges are made."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch} disabled={saving}>
              {saving ? "Saving..." : pendingMode === "live" ? "Use Live" : "Use Test"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminSettings;
