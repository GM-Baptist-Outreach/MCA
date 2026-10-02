import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  shipment_label: "Jordan Sample's PACEs",
  shipment_items: "<ul><li>Math PACE 1037</li><li>English PACE 1037</li></ul>",
  tracking_number: "9400111899223197428490",
  tracking_url: "https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490",
  tracking_line:
    '<p><strong>Tracking:</strong> <a href="https://tools.usps.com/go/TrackConfirmAction?tLabels=9400111899223197428490">9400111899223197428490</a></p>',
  student_names: "Jordan Sample",
  overdue_list: "<ul><li>Jordan Sample: Math PACE 1037 (handed out Sep 1)</li></ul>",
  celebration_title: "Finished Math Level 3",
  celebration_line: "finished every Math PACE in Level 3",
};

const RAW_KEYS = new Set([
  "student_list",
  "order_items",
  "missing_scores",
  "book_list",
  "shipment_items",
  "tracking_line",
  "overdue_list",
]);

// Round 4 templates are sent by the family-emails function, which knows
// their sample values for "Send test to me".
const FAMILY_EMAIL_KEYS = new Set(["shipment_notice", "overdue_test_nudge", "celebration"]);

// ---------------------------------------------------------------------------
// MCA_R4_EMAIL_SWITCHES: on/off switches for the automatic family emails,
// plus a log of what was sent or skipped.
// ---------------------------------------------------------------------------

interface FamilyEmailLogRow {
  id: string;
  kind: string;
  status: string;
  detail: string | null;
  to_email: string | null;
  created_at: string;
  sent_at: string | null;
  students: { student_name: string } | { student_name: string }[] | null;
}

const SWITCHES: Array<{ key: string; label: string; help: string; fallback: boolean }> = [
  {
    key: "email_shipping_enabled",
    label: "Shipping emails",
    help: "Email the family when a pick list is marked shipped, or a ship-to-home store order is marked Fulfilled. Includes the tracking link when one is entered.",
    fallback: true,
  },
  {
    key: "email_overdue_nudge_enabled",
    label: "Test upload reminders (overdue)",
    help: "Gentle reminder when a PACE was marked Issued 28+ days ago and no test has been uploaded. Only PACEs issued after this feature went live count. At most once per PACE and once per family per week. Sent daily at 9:40 AM Eastern (8:40 AM in winter).",
    fallback: false,
  },
  {
    // Round 10 (MCA_R10_CELEBRATION_EMAIL)
    key: "email_celebration_enabled",
    label: "Celebration emails",
    help: "Congratulations email when a student passes the last PACE of a level in a subject, or finishes every PACE for the school year. The parent also sees a congratulations screen in the portal either way.",
    fallback: true,
  },
];

const LOG_KIND_LABELS: Record<string, string> = {
  shipment: "Shipping",
  overdue_test: "Test reminder",
  celebration: "Celebration",
};

async function callFamilyEmails(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in again first.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/family-emails`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function AutomaticEmails() {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [log, setLog] = useState<FamilyEmailLogRow[]>([]);
  const [testFamilies, setTestFamilies] = useState<string[]>([]);
  const [overdueCheck, setOverdueCheck] = useState<string | null>(null);

  const load = async () => {
    const [settingsRes, logRes, testRes] = await Promise.all([
      supabase.from("app_settings").select("key, value").in("key", SWITCHES.map((sw) => sw.key)),
      supabase
        .from("family_email_log")
        .select("id, kind, status, detail, to_email, created_at, sent_at, students(student_name)")
        .order("created_at", { ascending: false })
        .limit(15),
      supabase.from("families").select("parent_name").eq("is_test_account", true).order("parent_name"),
    ]);
    const next: Record<string, boolean> = {};
    for (const sw of SWITCHES) {
      const row = (settingsRes.data ?? []).find((r) => r.key === sw.key);
      next[sw.key] = row ? row.value === "true" : sw.fallback;
    }
    setValues(next);
    setLog((logRes.data ?? []) as FamilyEmailLogRow[]);
    setTestFamilies((testRes.data ?? []).map((r) => r.parent_name as string));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggle = async (key: string, on: boolean) => {
    setSaving(key);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value: on ? "true" : "false" }, { onConflict: "key" });
    setSaving(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    setValues((prev) => ({ ...prev, [key]: on }));
    toast({ title: on ? "Turned on" : "Turned off" });
  };

  const sendCopy = async (row: FamilyEmailLogRow) => {
    try {
      const data = await callFamilyEmails({ action: "preview", log_id: row.id });
      toast({ title: data.sent ? "Copy sent" : "Copy was not sent", description: `Only ${data.to} gets this copy.` });
    } catch (err) {
      toast({ title: "Couldn't send a copy", description: String((err as Error).message), variant: "destructive" });
    }
  };

  const checkOverdue = async () => {
    setOverdueCheck("Checking...");
    try {
      const data = await callFamilyEmails({ action: "overdue_nudges", dry_run: true });
      const families = (data.families ?? []) as Array<{ paces: string[]; skipped?: string }>;
      const due = families.filter((f) => !f.skipped);
      setOverdueCheck(
        due.length === 0
          ? `No families have overdue tests right now. Only PACEs marked Issued after ${data.rule?.issued_after} count, once they are ${data.rule?.overdue_days ?? 28} days old. No email was sent.`
          : `${due.length} famil${due.length === 1 ? "y" : "ies"} would get a reminder: ${due
              .map((f) => f.paces.join(", "))
              .join("; ")}. No email was sent.`,
      );
    } catch (err) {
      setOverdueCheck(`Check failed: ${(err as Error).message}`);
    }
  };

  const studentOf = (row: FamilyEmailLogRow) =>
    (Array.isArray(row.students) ? row.students[0] : row.students)?.student_name ?? "";

  return (
    <section className="space-y-3 rounded-xl border border-border/50 p-4" data-marker="MCA_R4_EMAIL_SWITCHES" data-tour="admin-email-switches">
      <div>
        <h3 className="text-lg font-bold font-serif text-primary">Automatic emails</h3>
        <p className="text-sm text-foreground/60">
          Turn these family emails on or off. Edit the wording with the template buttons below.
          Only shipments and PACEs from after these emails went live count, so nothing old is sent.
        </p>
      </div>
      {SWITCHES.map((sw) => (
        <div key={sw.key} className="flex items-start justify-between gap-4 rounded-lg bg-secondary/30 p-3">
          <div>
            <Label htmlFor={sw.key} className="font-medium">{sw.label}</Label>
            <p className="text-xs text-foreground/60">{sw.help}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-foreground/60 w-6">{values[sw.key] ? "On" : "Off"}</span>
            <Switch
              id={sw.key}
              checked={!!values[sw.key]}
              disabled={saving === sw.key}
              onCheckedChange={(checked) => toggle(sw.key, checked)}
            />
          </div>
        </div>
      ))}
      <p className="text-xs text-foreground/60">
        Test accounts never get these emails{testFamilies.length ? `: ${testFamilies.join(", ")}` : ""}.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={checkOverdue}>
          Check overdue tests now (sends nothing)
        </Button>
      </div>
      {overdueCheck && <p className="text-xs text-foreground/70">{overdueCheck}</p>}
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-foreground/50">Recent automatic emails</p>
        {log.length === 0 ? (
          <p className="text-xs text-foreground/60">None yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {log.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 py-1">
                <span>
                  {new Date(row.created_at).toLocaleString()} · {LOG_KIND_LABELS[row.kind] ?? row.kind}
                  {studentOf(row) ? ` · ${studentOf(row)}` : ""} ·{" "}
                  <span className="font-medium">{row.status}</span>
                  {row.detail ? ` (${row.detail})` : ""}
                </span>
                <Button type="button" size="sm" variant="ghost" className="h-6 text-xs" onClick={() => sendCopy(row)}>
                  Send me a copy
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

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
    const fn = selected && FAMILY_EMAIL_KEYS.has(selected.key) ? "family-emails" : "generate-pick-lists";
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
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
      <AutomaticEmails />
      <WeeklySummarySettings />
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

// ---------------------------------------------------------------------------
// MCA_R8_SMS_WEBHOOKS: one webhook per text-message event. Each URL is an
// automation in GM Baptist software, which sends the actual text. The
// sms-webhooks edge function posts to the URL; switches start Off.
// ---------------------------------------------------------------------------

type SmsEvent = "test_upload_overdue" | "box_shipped";

const SMS_EVENTS: Array<{
  event: SmsEvent;
  label: string;
  help: string;
  urlKey: string;
  enabledKey: string;
}> = [
  {
    event: "test_upload_overdue",
    label: "Test upload overdue",
    help: "Same rule as the overdue email: a PACE marked Issued 28+ days ago with no test uploaded (only PACEs issued after the emails went live). One text per student, each PACE once, at most once a week. Checked daily at 9:45 AM Eastern (8:45 AM in winter).",
    urlKey: "sms_webhook_url_overdue",
    enabledKey: "sms_webhook_enabled_overdue",
  },
  {
    event: "box_shipped",
    label: "Box shipped",
    help: "When a pick list is marked Shipped, or a ship-to-home store order is marked Fulfilled. Includes the tracking link. Checked every 5 minutes. Only shipments after you turn this on count.",
    urlKey: "sms_webhook_url_shipped",
    enabledKey: "sms_webhook_enabled_shipped",
  },
];

interface SmsLogRow {
  id: string;
  event: string;
  status: string;
  detail: string | null;
  http_status: number | null;
  is_test: boolean;
  created_at: string;
  students: { student_name: string } | { student_name: string }[] | null;
}

async function callSmsWebhooks(body: Record<string, unknown>) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign in again first.");
  const res = await fetch(`${SUPABASE_URL}/functions/v1/sms-webhooks`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export function SmsWebhooks() {
  const { toast } = useToast();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [log, setLog] = useState<SmsLogRow[]>([]);
  const [overdueCheck, setOverdueCheck] = useState<string | null>(null);

  const load = async () => {
    try {
      await loadInner();
    } catch (err) {
      console.error("Couldn't load text message settings", err);
    }
  };

  const loadInner = async () => {
    const keys = SMS_EVENTS.flatMap((e) => [e.urlKey, e.enabledKey]);
    const [settingsRes, logRes] = await Promise.all([
      supabase.from("app_settings").select("key, value").in("key", keys),
      supabase
        .from("sms_webhook_log")
        .select("id, event, status, detail, http_status, is_test, created_at, students(student_name)")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    const rows = settingsRes.data ?? [];
    const nextUrls: Record<string, string> = {};
    const nextEnabled: Record<string, boolean> = {};
    for (const e of SMS_EVENTS) {
      nextUrls[e.event] = rows.find((r) => r.key === e.urlKey)?.value ?? "";
      nextEnabled[e.event] = rows.find((r) => r.key === e.enabledKey)?.value === "true";
    }
    setUrls(nextUrls);
    setSaved(nextUrls);
    setEnabled(nextEnabled);
    setLog((logRes.data ?? []) as SmsLogRow[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveUrl = async (e: (typeof SMS_EVENTS)[number]) => {
    const value = (urls[e.event] ?? "").trim();
    if (value && !/^https:\/\/\S+$/i.test(value)) {
      toast({ title: "Check the URL", description: "It should start with https://", variant: "destructive" });
      return;
    }
    setBusy(`url:${e.event}`);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: e.urlKey, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    setSaved((prev) => ({ ...prev, [e.event]: value }));
    toast({ title: "Webhook URL saved" });
  };

  const toggle = async (e: (typeof SMS_EVENTS)[number], on: boolean) => {
    if (on && !(saved[e.event] ?? "").trim()) {
      toast({ title: "Save a webhook URL first", variant: "destructive" });
      return;
    }
    setBusy(`on:${e.event}`);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: e.enabledKey, value: on ? "true" : "false", updated_at: new Date().toISOString() }, { onConflict: "key" });
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    setEnabled((prev) => ({ ...prev, [e.event]: on }));
    toast({ title: on ? `${e.label} texts turned on` : `${e.label} texts turned off` });
  };

  const sendTest = async (e: (typeof SMS_EVENTS)[number]) => {
    if ((urls[e.event] ?? "").trim() !== (saved[e.event] ?? "").trim()) {
      toast({ title: "Save the URL first", description: "Send test uses the saved URL.", variant: "destructive" });
      return;
    }
    setBusy(`test:${e.event}`);
    try {
      const data = await callSmsWebhooks({ action: "send_test", event: e.event });
      setResults((prev) => ({
        ...prev,
        [e.event]: data.sent
          ? `Test sent (HTTP ${data.http_status}). It used test-account data and is marked "test": true.`
          : `Test failed: ${data.detail ?? data.error ?? "unknown error"}`,
      }));
    } catch (err) {
      setResults((prev) => ({ ...prev, [e.event]: `Test failed: ${(err as Error).message}` }));
    }
    setBusy(null);
    load();
  };

  const checkOverdue = async () => {
    setOverdueCheck("Checking...");
    try {
      const data = await callSmsWebhooks({ action: "overdue_scan", dry_run: true });
      const students = (data.students ?? []) as Array<{ student: string; paces: string[]; skipped?: string }>;
      const due = students.filter((s) => !s.skipped);
      setOverdueCheck(
        due.length === 0
          ? `No students would get an overdue text right now (${students.length} skipped). Nothing was sent.`
          : `${due.length} student${due.length === 1 ? "" : "s"} would get a text: ${due
              .map((s) => `${s.student} (${s.paces.join(", ")})`)
              .join("; ")}. Nothing was sent.`,
      );
    } catch (err) {
      setOverdueCheck(`Check failed: ${(err as Error).message}`);
    }
  };

  const studentOf = (row: SmsLogRow) =>
    (Array.isArray(row.students) ? row.students[0] : row.students)?.student_name ?? "";

  return (
    <section
      id="sms-texts"
      className="space-y-4 rounded-xl border border-border/50 p-4"
      data-marker="MCA_R8_SMS_WEBHOOKS"
      data-tour="admin-sms-webhooks"
    >
      <div>
        <h3 className="text-xl font-bold font-serif text-primary">Text messages (GM Baptist software)</h3>
        <p className="text-sm text-foreground/70">
          Each event sends its details to its own webhook URL. Set up one automation per URL in GM Baptist
          software to send the text. The site sends: event, parent first and last name, phone, email, student
          name, a short message, the tracking link (box shipped), and the family ID. Test accounts never trigger
          a real text.
        </p>
      </div>
      {SMS_EVENTS.map((e) => (
        <div key={e.event} className="space-y-2 rounded-lg bg-secondary/30 p-3" data-testid={`sms-${e.event}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor={`sms-on-${e.event}`} className="font-medium">
                {e.label}
              </Label>
              <p className="text-xs text-foreground/60">{e.help}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-foreground/60 w-6">{enabled[e.event] ? "On" : "Off"}</span>
              <Switch
                id={`sms-on-${e.event}`}
                checked={!!enabled[e.event]}
                disabled={busy !== null}
                onCheckedChange={(checked) => toggle(e, checked)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              className="bg-background h-9 text-xs"
              placeholder="https://..."
              aria-label={`${e.label} webhook URL`}
              value={urls[e.event] ?? ""}
              onChange={(ev) => setUrls((prev) => ({ ...prev, [e.event]: ev.target.value }))}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null || (urls[e.event] ?? "") === (saved[e.event] ?? "")}
                onClick={() => saveUrl(e)}
              >
                Save URL
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy !== null || !(saved[e.event] ?? "").trim()}
                onClick={() => sendTest(e)}
              >
                {busy === `test:${e.event}` ? "Sending..." : "Send test"}
              </Button>
            </div>
          </div>
          {results[e.event] && <p className="text-xs text-foreground/70">{results[e.event]}</p>}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={checkOverdue}>
          Check overdue texts now (sends nothing)
        </Button>
      </div>
      {overdueCheck && <p className="text-xs text-foreground/70">{overdueCheck}</p>}
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-foreground/50">Recent texts sent to GM Baptist software</p>
        {log.length === 0 ? (
          <p className="text-xs text-foreground/60">None yet.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {log.map((row) => (
              <li key={row.id} className="border-b border-border/40 py-1">
                {new Date(row.created_at).toLocaleString()} · {row.event === "box_shipped" ? "Box shipped" : "Test overdue"}
                {row.is_test ? " (test)" : ""}
                {studentOf(row) ? ` · ${studentOf(row)}` : ""} · <span className="font-medium">{row.status}</span>
                {row.detail ? ` (${row.detail})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// MCA_R8_SCHOOL_NUMBERS: graduation credits required and the reorder look-ahead.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round 10 (MCA_R10_WEEKLY_SUMMARY): Monday-morning summary email to David.
// ---------------------------------------------------------------------------

interface WeeklyRun {
  id: string;
  ran_at: string;
  trigger: string;
  sent_to: string | null;
  status: string;
  detail: string | null;
}

export function WeeklySummarySettings() {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(true);
  const [recipient, setRecipient] = useState("");
  const [savedRecipient, setSavedRecipient] = useState("");
  const [runs, setRuns] = useState<WeeklyRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const [settingsRes, runsRes] = await Promise.all([
      supabase
        .from("app_settings")
        .select("key, value")
        .in("key", ["weekly_summary_enabled", "weekly_summary_recipient"]),
      supabase
        .from("weekly_summary_runs")
        .select("id, ran_at, trigger, sent_to, status, detail")
        .order("ran_at", { ascending: false })
        .limit(5),
    ]);
    const rows = settingsRes.data ?? [];
    const en = rows.find((r) => r.key === "weekly_summary_enabled");
    const rc = rows.find((r) => r.key === "weekly_summary_recipient");
    setEnabled(en ? en.value !== "false" : true);
    setRecipient(rc?.value ?? "");
    setSavedRecipient(rc?.value ?? "");
    setRuns((runsRes.data ?? []) as WeeklyRun[]);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (key: string, value: string) => {
    setBusy(key);
    const { error } = await supabase.from("app_settings").upsert({ key, value }, { onConflict: "key" });
    setBusy(null);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return false;
    }
    return true;
  };

  const toggle = async (on: boolean) => {
    if (await save("weekly_summary_enabled", on ? "true" : "false")) {
      setEnabled(on);
      toast({ title: on ? "Weekly summary turned on" : "Weekly summary turned off" });
    }
  };

  const saveRecipient = async () => {
    const email = recipient.trim();
    if (!/^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/.test(email)) {
      toast({ title: "Enter one valid email address", variant: "destructive" });
      return;
    }
    if (await save("weekly_summary_recipient", email)) {
      setSavedRecipient(email);
      setRecipient(email);
      toast({ title: "Recipient saved" });
    }
  };

  const preview = async () => {
    setBusy("preview");
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again first.");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/weekly-summary`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`);
      toast({ title: data.sent ? "Preview sent" : "Preview was not sent", description: `Only ${data.to} gets this preview.` });
      load();
    } catch (err) {
      toast({ title: "Couldn't send the preview", description: (err as Error).message, variant: "destructive" });
    }
    setBusy(null);
  };

  return (
    <section
      className="space-y-3 rounded-xl border border-border/50 p-4"
      data-marker="MCA_R10_WEEKLY_SUMMARY"
      data-tour="admin-weekly-summary"
    >
      <div>
        <h3 className="text-lg font-bold font-serif text-primary">Weekly summary email</h3>
        <p className="text-sm text-foreground/60">
          Every Monday at 8 AM Eastern: new enrollments, overdue tests, low stock and reorder-soon items, boxes shipped,
          and money collected over the past 7 days.
        </p>
      </div>
      <div className="flex items-start justify-between gap-4 rounded-lg bg-secondary/30 p-3">
        <div>
          <Label htmlFor="weekly_summary_enabled" className="font-medium">Send the weekly summary</Label>
          <p className="text-xs text-foreground/60">Goes to the address below only. Families never get it.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-foreground/60 w-6">{enabled ? "On" : "Off"}</span>
          <Switch id="weekly_summary_enabled" checked={enabled} disabled={busy !== null} onCheckedChange={toggle} />
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="weekly_summary_recipient" className="text-sm">Send it to</Label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="weekly_summary_recipient"
            className="max-w-sm"
            value={recipient}
            placeholder="david@midwestchristianacademy.com"
            onChange={(e) => setRecipient(e.target.value)}
          />
          <Button type="button" size="sm" variant="outline" disabled={busy !== null || recipient === savedRecipient} onClick={saveRecipient}>
            Save
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={preview}>
            {busy === "preview" ? "Sending..." : "Send me a preview"}
          </Button>
        </div>
        <p className="text-xs text-foreground/60">The preview goes only to you, the signed-in admin.</p>
      </div>
      <div className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-foreground/50">Recent summaries</p>
        {runs.length === 0 ? (
          <p className="text-xs text-foreground/60">None yet. The first one goes out next Monday.</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {runs.map((r) => (
              <li key={r.id} className="border-b border-border/40 py-1">
                {new Date(r.ran_at).toLocaleString()} · {r.trigger === "preview" ? "Preview" : "Weekly"} ·{" "}
                <span className="font-medium">{r.status}</span>
                {r.sent_to ? ` to ${r.sent_to}` : ""}
                {r.detail ? ` (${r.detail})` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

const SCHOOL_NUMBERS: Array<{ key: string; label: string; help: string; fallback: string; min: number; max: number }> = [
  {
    key: "graduation_total_credits",
    label: "Credits required to graduate",
    help: "Used by the credit bar on the portal, the student card, and the PDFs. If a student's course list adds up to more, the larger number is used.",
    fallback: "25",
    min: 1,
    max: 60,
  },
  {
    key: "reorder_horizon_days",
    label: "Reorder look-ahead (days)",
    help: "How far ahead the Reorder card on Today looks at upcoming shipments.",
    fallback: "60",
    min: 7,
    max: 365,
  },
];

export function SchoolNumbers() {
  const { toast } = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await supabase
          .from("app_settings")
          .select("key, value")
          .in("key", SCHOOL_NUMBERS.map((n) => n.key));
        const next: Record<string, string> = {};
        for (const n of SCHOOL_NUMBERS) next[n.key] = data?.find((r) => r.key === n.key)?.value ?? n.fallback;
        setValues(next);
      } catch (err) {
        console.error("Couldn't load school numbers", err);
      }
    };
    load();
  }, []);

  const save = async (n: (typeof SCHOOL_NUMBERS)[number]) => {
    const num = Number(values[n.key]);
    if (!Number.isFinite(num) || num < n.min || num > n.max) {
      toast({ title: `Enter a number from ${n.min} to ${n.max}`, variant: "destructive" });
      return;
    }
    setSaving(n.key);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: n.key, value: String(num), updated_at: new Date().toISOString() }, { onConflict: "key" });
    setSaving(null);
    if (error) toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
    else toast({ title: "Saved" });
  };

  return (
    <section className="space-y-3 rounded-xl border border-border/50 p-4" data-marker="MCA_R8_SCHOOL_NUMBERS" data-tour="admin-school-numbers">
      <h3 className="text-xl font-bold font-serif text-primary">Graduation and reorder numbers</h3>
      {SCHOOL_NUMBERS.map((n) => (
        <div key={n.key} className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between rounded-lg bg-secondary/30 p-3">
          <div className="space-y-1">
            <Label htmlFor={`num-${n.key}`} className="font-medium">
              {n.label}
            </Label>
            <p className="text-xs text-foreground/60">{n.help}</p>
          </div>
          <div className="flex gap-2">
            <Input
              id={`num-${n.key}`}
              type="number"
              className="bg-background h-9 w-24"
              value={values[n.key] ?? ""}
              onChange={(e) => setValues((prev) => ({ ...prev, [n.key]: e.target.value }))}
            />
            <Button type="button" size="sm" variant="outline" disabled={saving === n.key} onClick={() => save(n)}>
              Save
            </Button>
          </div>
        </div>
      ))}
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
    <div className="space-y-8 max-w-2xl" data-marker="MCA_R7_SETTINGS_PAGE">
      <div className="space-y-3">
        <h2 className="text-2xl font-bold font-serif text-primary" data-tour="admin-settings">
          Settings
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            { to: "/admin/emails", title: "Email Templates", note: "Automatic email switches and wording" },
            { to: "/admin/users", title: "Admin Users", note: "Who can sign in to the admin side" },
          ].map((card) => (
            <Link
              key={card.to}
              to={card.to}
              className="group flex items-center justify-between gap-3 rounded-xl border border-border/60 p-4 hover:bg-secondary/60"
            >
              <span>
                <span className="block font-medium text-primary">{card.title}</span>
                <span className="block text-xs text-foreground/60">{card.note}</span>
              </span>
              <ChevronRight className="h-4 w-4 text-foreground/40 group-hover:text-primary" />
            </Link>
          ))}
        </div>
      </div>

      <div id="payment-mode" className="space-y-6" data-tour="admin-payment-mode">
      <div>
        <h3 className="text-xl font-bold font-serif text-primary mb-2">
          Payment Mode (Test/Live)
        </h3>
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
      </div>

      <SmsWebhooks />

      <SchoolNumbers />

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
