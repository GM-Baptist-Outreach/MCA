import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer } from "lucide-react";
import type { PortalContext } from "../PortalLayout";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type Day = (typeof DAYS)[number];
const WEEK_COUNT = 9; // one quarter, matching the Music Practice form's structure
const WEEKLY_TARGET_MINUTES = 120; // 2 hours/week required for credit

type WeekData = Record<Day, boolean>;

function emptyWeek(): WeekData {
  return DAYS.reduce((acc, d) => ({ ...acc, [d]: false }), {} as WeekData);
}

export default function PortalPeLog() {
  const { family, selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();

  const [schoolYear, setSchoolYear] = useState("");
  const [quarter, setQuarter] = useState("1");
  const [weeks, setWeeks] = useState<WeekData[]>(
    Array.from({ length: WEEK_COUNT }, emptyWeek),
  );
  const [verification, setVerification] = useState("");
  const [existingSubmissionId, setExistingSubmissionId] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!selectedStudent) return;
    // Guards against a slower-resolving fetch for a previously-selected
    // student overwriting the currently-selected student's already-loaded
    // data if the parent switches students quickly.
    let ignore = false;
    const load = async () => {
      setLoading(true);
      const { data } = await supabase
        .from("form_submissions")
        .select("id, submitted_data")
        .eq("student_id", selectedStudent.id)
        .eq("form_type", "pe_activity_log")
        .filter("submitted_data->>quarter", "eq", quarter)
        .maybeSingle();

      if (ignore) return;

      if (data) {
        setExistingSubmissionId(data.id);
        setSchoolYear(data.submitted_data.school_year ?? "");
        setWeeks(
          data.submitted_data.weeks ??
            Array.from({ length: WEEK_COUNT }, emptyWeek),
        );
        setVerification(data.submitted_data.verification ?? "");
      } else {
        setExistingSubmissionId(null);
        setWeeks(Array.from({ length: WEEK_COUNT }, emptyWeek));
        setVerification("");
      }
      setLoading(false);
    };
    load();
    return () => {
      ignore = true;
    };
  }, [selectedStudent?.id, quarter]);

  const toggleDay = (weekIdx: number, day: Day) => {
    setWeeks((w) =>
      w.map((week, i) =>
        i === weekIdx ? { ...week, [day]: !week[day] } : week,
      ),
    );
  };

  // 30 min/day estimate for a met-goal week; exact minutes aren't tracked
  // per day (the physical form is just a checkmark calendar) — this is a
  // rough indicator, not a precise total.
  const weekMinutes = (week: WeekData) =>
    Object.values(week).filter(Boolean).length * 30;

  const handleSave = async () => {
    if (!selectedStudent) return;
    setSaving(true);

    const submittedData = {
      school_year: schoolYear,
      quarter,
      weeks,
      verification,
    };

    if (existingSubmissionId) {
      const { error } = await supabase
        .from("form_submissions")
        .update({
          submitted_data: submittedData,
          signer_name: verification || family.parent_name,
        })
        .eq("id", existingSubmissionId);
      if (error) {
        toast({
          title: "Couldn't save",
          description: error.message,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("form_submissions")
        .insert({
          family_id: family.id,
          student_id: selectedStudent.id,
          form_type: "pe_activity_log",
          submitted_data: submittedData,
          signer_name: verification || family.parent_name,
        })
        .select()
        .single();
      if (error) {
        toast({
          title: "Couldn't save",
          description: error.message,
          variant: "destructive",
        });
        setSaving(false);
        return;
      }
      setExistingSubmissionId(data.id);
    }

    toast({ title: "P.E. activity log saved" });
    setSaving(false);
  };

  const handlePrint = () => {
    const printWindow = window.open("", "_blank", "width=800,height=900");
    if (!printWindow) return;

    const rowsHtml = weeks
      .map(
        (week, i) => `
        <tr>
          <td class="week">Week ${i + 1}</td>
          ${DAYS.map((d) => `<td>${week[d] ? "✓" : ""}</td>`).join("")}
        </tr>`,
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>P.E. Activity Log — ${selectedStudent?.student_name ?? ""}</title>
          <style>
            body { font-family: Georgia, serif; padding: 40px; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; }
            th, td { border: 1px solid #999; padding: 10px; text-align: center; }
            th { background: #f2f2f2; }
            td.week { text-align: left; font-weight: bold; }
          </style>
        </head>
        <body>
          <h1>P.E. Activity Log — ${selectedStudent?.student_name ?? ""}</h1>
          <div class="subtitle">School Year ${schoolYear} — Quarter ${quarter}. Needs 2 hours (avg. ~4 days) per week for credit.</div>
          <table>
            <thead><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join("")}</tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (!selectedStudent) {
    return (
      <p className="text-foreground/60">
        Select a student above to use the P.E. log.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">
            P.E. Activity Log
          </h2>
          <p className="text-sm text-foreground/60">
            {selectedStudent.student_name} — needs 2 hours of activity per week
            for credit
          </p>
        </div>
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-1.5" />
          Print
        </Button>
      </div>

      <div className="flex gap-3">
        <Input
          className="bg-background w-32"
          placeholder="School Year"
          value={schoolYear}
          onChange={(e) => setSchoolYear(e.target.value)}
        />
        <Input
          className="bg-background w-24"
          placeholder="Quarter"
          value={quarter}
          onChange={(e) => setQuarter(e.target.value)}
        />
      </div>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <>
          <div className="rounded-xl border border-border/50 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-secondary">
                <tr>
                  <th className="p-3"></th>
                  {DAYS.map((d) => (
                    <th key={d} className="p-3">
                      {d}
                    </th>
                  ))}
                  <th className="p-3">~Minutes</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="p-3 font-medium">Week {i + 1}</td>
                    {DAYS.map((d) => (
                      <td key={d} className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => toggleDay(i, d)}
                          className={`h-8 w-8 rounded border ${
                            week[d]
                              ? "bg-primary text-primary-foreground border-primary"
                              : "border-border/50 hover:bg-secondary"
                          }`}
                        >
                          {week[d] ? "✓" : ""}
                        </button>
                      </td>
                    ))}
                    <td
                      className={`p-2 text-center font-medium ${weekMinutes(week) >= WEEKLY_TARGET_MINUTES ? "text-green-600" : "text-foreground/60"}`}
                    >
                      {weekMinutes(week)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-foreground/50">
            Estimated at 30 min per checked day — the target is roughly 4 active
            days a week to reach 2 hours.
          </p>

          <div className="space-y-1.5 max-w-sm">
            <label className="text-sm font-medium text-foreground">
              Teacher/Parent Verification (type full name)
            </label>
            <Input
              className="bg-background"
              value={verification}
              onChange={(e) => setVerification(e.target.value)}
              placeholder="Full name"
            />
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </>
      )}
    </div>
  );
}
