import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// Round 10 (MCA_R10_REENROLL_ADMIN): open/close spring re-enrollment, set the
// window and school year, and see who has confirmed, paid, or declined.

type Settings = { open: boolean; start: string; end: string; year: string };

interface EnrollmentRow {
  id: string;
  student_id: string;
  tuition_tier: string;
  frequency: string | null;
  status: string;
  stripe_subscription_id: string | null;
  students: {
    student_name: string;
    family_id: string;
    families: { parent_name: string; email: string; is_test_account: boolean | null } | null;
  } | null;
}

interface ReenrollRow {
  id: string;
  student_id: string;
  family_id: string;
  status: string;
  grade_next: string | null;
  tuition_tier: string | null;
  frequency: string | null;
  payment_path: string | null;
  confirmed_at: string;
  paid_at: string | null;
  students: { student_name: string; families: { parent_name: string; email: string; is_test_account: boolean | null } | null } | null;
}

type Line = {
  studentId: string;
  familyId: string;
  student: string;
  parent: string;
  email: string;
  test: boolean;
  current: string;
  r: ReenrollRow | null;
};

const KEYS = ["reenroll_open", "reenroll_window_start", "reenroll_window_end", "reenroll_school_year"];

const STATUS_LABEL: Record<string, string> = {
  none: "Not confirmed",
  confirmed: "Confirmed",
  awaiting_payment: "Waiting on payment",
  paid: "Paid",
  declined: "Not returning",
};

const PATH_LABEL: Record<string, string> = {
  autopay: "renews on autopay",
  comp: "no payment needed (follow up)",
  checkout: "paid at checkout",
  none: "",
};

function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? v[0] ?? null : v ?? null;
}

const AdminReenrollment = () => {
  const { toast } = useToast();
  const [settings, setSettings] = useState<Settings>({ open: false, start: "", end: "", year: "2027-28" });
  const [saved, setSaved] = useState<Settings | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState<string>("all");

  const load = async (year?: string) => {
    setLoading(true);
    const settingsRes = await supabase.from("app_settings").select("key, value").in("key", KEYS);
    const get = (k: string) => (settingsRes.data ?? []).find((r) => r.key === k)?.value ?? "";
    const s: Settings = {
      open: get("reenroll_open") === "true",
      start: get("reenroll_window_start"),
      end: get("reenroll_window_end"),
      year: get("reenroll_school_year") || "2027-28",
    };
    if (!year) {
      setSettings(s);
      setSaved(s);
    }
    const schoolYear = year ?? s.year;
    const [enrRes, reRes] = await Promise.all([
      supabase
        .from("enrollments")
        .select(
          "id, student_id, tuition_tier, frequency, status, stripe_subscription_id, students(student_name, family_id, families(parent_name, email, is_test_account))",
        )
        .eq("status", "active"),
      supabase
        .from("reenrollments")
        .select(
          "id, student_id, family_id, status, grade_next, tuition_tier, frequency, payment_path, confirmed_at, paid_at, students(student_name, families(parent_name, email, is_test_account))",
        )
        .eq("school_year", schoolYear),
    ]);
    const reByStudent = new Map<string, ReenrollRow>();
    for (const r of (reRes.data ?? []) as unknown as ReenrollRow[]) reByStudent.set(r.student_id, r);
    const out = new Map<string, Line>();
    for (const e of (enrRes.data ?? []) as unknown as EnrollmentRow[]) {
      const st = one(e.students);
      const fam = one(st?.families);
      if (!st) continue;
      out.set(e.student_id, {
        studentId: e.student_id,
        familyId: st.family_id,
        student: st.student_name,
        parent: fam?.parent_name ?? "",
        email: fam?.email ?? "",
        test: !!fam?.is_test_account,
        current: `${e.tuition_tier === "high_school" ? "High school" : "Elementary"} · ${
          e.stripe_subscription_id ? `${e.frequency ?? ""} autopay` : "no card on file"
        }`,
        r: reByStudent.get(e.student_id) ?? null,
      });
    }
    for (const r of reByStudent.values()) {
      if (out.has(r.student_id)) continue;
      const st = one(r.students);
      const fam = one(st?.families);
      out.set(r.student_id, {
        studentId: r.student_id,
        familyId: r.family_id,
        student: st?.student_name ?? "",
        parent: fam?.parent_name ?? "",
        email: fam?.email ?? "",
        test: !!fam?.is_test_account,
        current: "No active enrollment",
        r,
      });
    }
    setLines(Array.from(out.values()).sort((a, b) => a.parent.localeCompare(b.parent) || a.student.localeCompare(b.student)));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dirty = saved && JSON.stringify(saved) !== JSON.stringify(settings);

  const save = async () => {
    if (settings.start && settings.end && settings.end < settings.start) {
      toast({ title: "The window ends before it starts", variant: "destructive" });
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(settings.year)) {
      toast({ title: "School year should look like 2027-28", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("app_settings").upsert(
      [
        { key: "reenroll_open", value: settings.open ? "true" : "false" },
        { key: "reenroll_window_start", value: settings.start },
        { key: "reenroll_window_end", value: settings.end },
        { key: "reenroll_school_year", value: settings.year },
      ],
      { onConflict: "key" },
    );
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't save", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: settings.open ? "Re-enrollment is open" : "Re-enrollment is closed",
      description: settings.open ? "Families see the Re-enroll card on their portal home during the window." : "Families no longer see the Re-enroll card.",
    });
    setSaved(settings);
    load(settings.year);
  };

  const statusOf = (l: Line) => l.r?.status ?? "none";
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, none: 0, confirmed: 0, awaiting_payment: 0, paid: 0, declined: 0 };
    for (const l of lines) {
      if (l.test) continue;
      c.all++;
      c[statusOf(l)]++;
    }
    return c;
  }, [lines]);

  const shown = lines.filter((l) => filter === "all" || statusOf(l) === filter);

  const today = new Date().toISOString().slice(0, 10);
  const liveNow =
    settings.open && (!settings.start || today >= settings.start) && (!settings.end || today <= settings.end);

  const downloadCsv = () => {
    const rows = [
      ["Parent", "Email", "Student", "Now", "Status", "Next grade", "Plan", "Payment", "Confirmed", "Paid", "Test account"],
      ...lines.map((l) => [
        l.parent,
        l.email,
        l.student,
        l.current,
        STATUS_LABEL[statusOf(l)],
        l.r?.grade_next ?? "",
        l.r?.frequency ?? "",
        l.r?.payment_path ?? "",
        l.r ? new Date(l.r.confirmed_at).toLocaleDateString() : "",
        l.r?.paid_at ? new Date(l.r.paid_at).toLocaleDateString() : "",
        l.test ? "yes" : "",
      ]),
    ];
    const csv = rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `reenrollment-${settings.year}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6" data-marker="MCA_R10_REENROLL_ADMIN">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary" data-tour="admin-reenrollment">
          Re-enrollment
        </h2>
        <p className="text-sm text-foreground/60">
          Each spring, open re-enrollment so families can confirm next year from their portal in one step. Their info is
          filled in; students on autopay just keep renewing, and everyone else pays through a secure Stripe page.
        </p>
      </div>

      <section className="rounded-xl border border-border/50 p-4 space-y-4" data-tour="admin-reenroll-settings">
        <div className="flex items-start justify-between gap-4 rounded-lg bg-secondary/30 p-3">
          <div>
            <Label htmlFor="reenroll_open" className="font-medium">Re-enrollment is open</Label>
            <p className="text-xs text-foreground/60">
              {liveNow
                ? "Families see the Re-enroll card on their portal home right now."
                : settings.open
                  ? "Open, but outside the dates below, so families don't see it yet."
                  : "Closed. Families don't see the Re-enroll card."}
            </p>
          </div>
          <Switch id="reenroll_open" checked={settings.open} onCheckedChange={(v) => setSettings((s) => ({ ...s, open: v }))} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="reenroll_year" className="text-sm">School year</Label>
            <Input id="reenroll_year" value={settings.year} placeholder="2027-28" onChange={(e) => setSettings((s) => ({ ...s, year: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reenroll_start" className="text-sm">Opens on (optional)</Label>
            <Input id="reenroll_start" type="date" value={settings.start} onChange={(e) => setSettings((s) => ({ ...s, start: e.target.value }))} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reenroll_end" className="text-sm">Closes after (optional)</Label>
            <Input id="reenroll_end" type="date" value={settings.end} onChange={(e) => setSettings((s) => ({ ...s, end: e.target.value }))} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={save} disabled={saving || !dirty}>
            {saving ? "Saving..." : "Save"}
          </Button>
          {dirty && <span className="text-xs text-foreground/60">Unsaved changes</span>}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-bold font-serif text-primary">Who has confirmed for {saved?.year ?? settings.year}</h3>
          <Button size="sm" variant="outline" onClick={downloadCsv} disabled={lines.length === 0}>
            Download CSV
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {(["all", "none", "confirmed", "awaiting_payment", "paid", "declined"] as const).map((k) => (
            <Button key={k} size="sm" variant={filter === k ? "default" : "outline"} onClick={() => setFilter(k)}>
              {k === "all" ? "All" : STATUS_LABEL[k]} ({counts[k]})
            </Button>
          ))}
        </div>
        <p className="text-xs text-foreground/60">Counts leave out test accounts.</p>
        {loading ? (
          <p className="text-sm text-foreground/60">Loading...</p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-foreground/60">No students here.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border/50">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-xs uppercase tracking-wide text-foreground/60">
                <tr>
                  <th className="p-2">Family</th>
                  <th className="p-2">Student</th>
                  <th className="p-2">This year</th>
                  <th className="p-2">Next year</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.studentId} className="border-t border-border/40 align-top">
                    <td className="p-2">
                      <Link className="text-primary underline" to={`/admin/families/${l.familyId}`}>
                        {l.parent || "Family"}
                      </Link>
                      {l.test && <span className="ml-1 rounded bg-amber-100 px-1 text-[10px] text-amber-900">TEST</span>}
                      <div className="text-xs text-foreground/60">{l.email}</div>
                    </td>
                    <td className="p-2">{l.student}</td>
                    <td className="p-2 text-xs">{l.current}</td>
                    <td className="p-2">
                      <span className="font-medium">{STATUS_LABEL[statusOf(l)]}</span>
                      {l.r && l.r.status !== "declined" && (
                        <div className="text-xs text-foreground/60">
                          {l.r.grade_next ? (l.r.grade_next === "k" ? "Kindergarten" : `Grade ${l.r.grade_next}`) : ""}
                          {l.r.frequency ? ` · ${l.r.frequency}` : ""}
                          {l.r.payment_path && PATH_LABEL[l.r.payment_path] ? ` · ${PATH_LABEL[l.r.payment_path]}` : ""}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};

export default AdminReenrollment;
