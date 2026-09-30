import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

interface EmailTemplate {
  key: string;
  name: string;
  description: string | null;
  subject: string;
  body_html: string;
  enabled: boolean;
  variables: string[];
  default_subject: string;
  default_body_html: string;
}

const SAMPLE_VARS: Record<string, string> = {
  parent_first_name: "Alex",
  student_name: "Jordan Sample",
  student_list: "<ul><li>Jordan Sample — Elementary ($150/monthly)</li></ul>",
  portal_url: "https://mcahomeschool.com/portal/login",
  frequency: "monthly",
  price: "150",
  price_suffix: " ($150)",
  checkout_url: "https://mcahomeschool.com/enroll?status=preview",
  order_items: "<ul><li>Sample PACE × 1</li></ul>",
  fulfillment_line: "Local pickup",
  order_total: "48.00",
  missing_scores: "<ul><li>Math PACE 1037</li></ul>",
  book_list: "<ul><li>Heidi – $12.00</li></ul>",
  store_url: "https://mcahomeschool.com/store?add=sample",
};

const RAW_KEYS = new Set(["student_list", "order_items", "missing_scores", "book_list"]);

function previewTemplate(source: string, vars: Record<string, string>): string {
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (full, key: string) => {
    if (!(key in vars)) return full;
    const value = vars[key] ?? "";
    return RAW_KEYS.has(key)
      ? value
      : value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  });
}

function unknownVars(source: string, allowed: string[]): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) {
    if (!allowed.includes(match[1])) found.add(match[1]);
  }
  return [...found];
}

export function AdminEmailTemplates() {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("email_templates")
      .select("key, name, description, subject, body_html, enabled, variables, default_subject, default_body_html")
      .order("name");
    if (error) {
      toast({ title: "Couldn't load email templates", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const rows = (data ?? []).map((row) => ({
      ...row,
      variables: Array.isArray(row.variables) ? row.variables : [],
    })) as EmailTemplate[];
    setTemplates(rows);
    const first = rows.find((row) => row.key === selectedKey) ?? rows[0];
    if (first) {
      setSelectedKey(first.key);
      setSubject(first.subject);
      setBody(first.body_html);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
    // The editor loads once. Selecting another template does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = templates.find((row) => row.key === selectedKey) ?? null;
  const unknowns = useMemo(
    () => unknownVars(`${subject}\n${body}`, selected?.variables ?? []),
    [subject, body, selected],
  );
  const previewSubject = previewTemplate(subject, SAMPLE_VARS);
  const previewHtml = previewTemplate(body, SAMPLE_VARS);

  const choose = (key: string) => {
    const row = templates.find((template) => template.key === key);
    if (!row) return;
    setSelectedKey(key);
    setSubject(row.subject);
    setBody(row.body_html);
  };

  const insertVariable = (name: string) => {
    setBody((current) => `${current}{{${name}}}`);
  };

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("email_templates")
      .update({
        subject,
        body_html: body,
        updated_by: userData.user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("key", selected.key);
    if (error) {
      toast({ title: "Couldn't save the template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Email template saved" });
      setTemplates((prev) =>
        prev.map((row) => (row.key === selected.key ? { ...row, subject, body_html: body } : row)),
      );
    }
    setSaving(false);
  };

  const reset = async () => {
    if (!selected) return;
    setSubject(selected.default_subject);
    setBody(selected.default_body_html);
    const { error } = await supabase
      .from("email_templates")
      .update({
        subject: selected.default_subject,
        body_html: selected.default_body_html,
        updated_at: new Date().toISOString(),
      })
      .eq("key", selected.key);
    if (error) {
      toast({ title: "Couldn't reset the template", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Reset to the default wording" });
    }
  };

  const sendTest = async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      toast({ title: "Sign in again to send a test", variant: "destructive" });
      return;
    }
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-pick-lists`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "send_test_email",
        subject,
        body_html: body,
      }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      toast({ title: "Test email failed", description: data.error || "Check the function logs.", variant: "destructive" });
      return;
    }
    toast({
      title: data.sent ? "Test sent" : "Test was not sent",
      description: data.to
        ? `Only ${data.to} can receive this test.`
        : "The function did not return an address.",
    });
  };

  if (loading) return <p className="text-foreground/60">Loading email templates...</p>;

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-xl font-bold font-serif text-primary">Parent emails</h3>
        <p className="text-sm text-foreground/60">
          These are the emails this site sends through Resend. The login magic
          link is edited in the Supabase dashboard under Authentication, Email
          Templates, not here.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {templates.map((template) => (
          <Button
            key={template.key}
            type="button"
            size="sm"
            variant={template.key === selectedKey ? "default" : "outline"}
            onClick={() => choose(template.key)}
          >
            {template.name}
          </Button>
        ))}
      </div>
      {selected && (
        <div className="space-y-3 rounded-xl border border-border/50 p-4">
          <p className="text-sm text-foreground/70">{selected.description}</p>
          <div className="space-y-1">
            <Label>Subject</Label>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="flex flex-wrap gap-1">
            {selected.variables.map((name) => (
              <Button key={name} type="button" size="sm" variant="secondary" onClick={() => insertVariable(name)}>
                {`{{${name}}}`}
              </Button>
            ))}
          </div>
          {unknowns.length > 0 && (
            <p className="text-sm text-destructive">
              Unknown variables: {unknowns.map((name) => `{{${name}}}`).join(", ")}
            </p>
          )}
          <div className="space-y-1">
            <Label>Body</Label>
            <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={12} className="font-mono text-xs" />
          </div>
          <div className="rounded-lg border bg-secondary/40 p-3 space-y-2">
            <p className="text-xs uppercase tracking-wide text-foreground/50">Preview</p>
            <p className="font-medium">{previewSubject}</p>
            <div className="text-sm" dangerouslySetInnerHTML={{ __html: previewHtml }} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={save} disabled={saving}>Save</Button>
            <Button type="button" variant="outline" onClick={sendTest}>Send test to me</Button>
            <Button type="button" variant="ghost" onClick={reset}>Reset to default</Button>
          </div>
        </div>
      )}
    </section>
  );
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
          Payment Mode (Test/Live)
        </h2>
        <p className="text-sm text-foreground/80">
          Leave this on Live. Only switch to Test when a developer is testing
          checkout. While in Test, families cannot actually pay.
        </p>
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
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button type="button" variant="ghost" className="h-auto px-0 text-sm font-medium">
              Details for developers
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="text-sm text-foreground/60 list-disc pl-5 space-y-1 pt-2">
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
          </CollapsibleContent>
        </Collapsible>
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

      <AdminEmailTemplates />
    </div>
  );
};

export default AdminSettings;
