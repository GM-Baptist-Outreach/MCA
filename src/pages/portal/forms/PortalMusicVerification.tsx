import { useEffect, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Printer } from "lucide-react";
import type { PortalContext } from "../PortalLayout";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
type Day = (typeof DAYS)[number];
const WEEK_COUNT = 9;
const WEEKLY_TARGET_MINUTES = 150; // 2.5 hours/week per the guidelines page

type WeekData = Record<Day, string>;

function emptyWeek(): WeekData {
  return DAYS.reduce((acc, d) => ({ ...acc, [d]: "" }), {} as WeekData);
}

export default function PortalMusicVerification() {
  const { family, selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();

  const [schoolYear, setSchoolYear] = useState("");
  const [quarter, setQuarter] = useState("1");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [weeks, setWeeks] = useState<WeekData[]>(
    Array.from({ length: WEEK_COUNT }, emptyWeek),
  );
  const [practiceVerification, setPracticeVerification] = useState("");

  const [performanceTitle, setPerformanceTitle] = useState("");
  const [instrument, setInstrument] = useState("");
  const [performanceDate, setPerformanceDate] = useState("");
  const [parentSignature, setParentSignature] = useState("");
  const [pastorTeacherSignature, setPastorTeacherSignature] = useState("");

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
        .eq("form_type", "music_practice_verification")
        .filter("submitted_data->>quarter", "eq", quarter)
        .maybeSingle();

      if (ignore) return;

      if (data) {
        const d = data.submitted_data;
        setExistingSubmissionId(data.id);
        setSchoolYear(d.school_year ?? "");
        setFromDate(d.from_date ?? "");
        setToDate(d.to_date ?? "");
        setWeeks(d.weeks ?? Array.from({ length: WEEK_COUNT }, emptyWeek));
        setPracticeVerification(d.practice_verification ?? "");
        setPerformanceTitle(d.performance_title ?? "");
        setInstrument(d.instrument ?? "");
        setPerformanceDate(d.performance_date ?? "");
        setParentSignature(d.parent_signature ?? "");
        setPastorTeacherSignature(d.pastor_teacher_signature ?? "");
      } else {
        setExistingSubmissionId(null);
        setWeeks(Array.from({ length: WEEK_COUNT }, emptyWeek));
        setPracticeVerification("");
        setPerformanceTitle("");
        setInstrument("");
        setPerformanceDate("");
        setParentSignature("");
        setPastorTeacherSignature("");
      }
      setLoading(false);
    };
    load();
    return () => {
      ignore = true;
    };
  }, [selectedStudent?.id, quarter]);

  const updateMinutes = (weekIdx: number, day: Day, value: string) => {
    setWeeks((w) =>
      w.map((week, i) => (i === weekIdx ? { ...week, [day]: value } : week)),
    );
  };

  const weekTotal = (week: WeekData) =>
    DAYS.reduce((sum, d) => sum + (parseInt(week[d], 10) || 0), 0);

  const handleSave = async () => {
    if (!selectedStudent) return;
    setSaving(true);

    const submittedData = {
      school_year: schoolYear,
      quarter,
      from_date: fromDate,
      to_date: toDate,
      weeks,
      practice_verification: practiceVerification,
      performance_title: performanceTitle,
      instrument,
      performance_date: performanceDate,
      parent_signature: parentSignature,
      pastor_teacher_signature: pastorTeacherSignature,
    };

    const payload = {
      family_id: family.id,
      student_id: selectedStudent.id,
      form_type: "music_practice_verification" as const,
      submitted_data: submittedData,
      signer_name: practiceVerification || family.parent_name,
    };

    if (existingSubmissionId) {
      const { error } = await supabase
        .from("form_submissions")
        .update({
          submitted_data: submittedData,
          signer_name: payload.signer_name,
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
        .insert(payload)
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

    toast({ title: "Music practice verification saved" });
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
          ${DAYS.map((d) => `<td>${week[d] || ""}</td>`).join("")}
          <td class="total">${weekTotal(week)}</td>
        </tr>`,
      )
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Music Practice Verification — ${selectedStudent?.student_name ?? ""}</title>
          <style>
            body { font-family: Georgia, serif; padding: 40px; }
            h1 { font-size: 20px; margin-bottom: 4px; }
            .subtitle { color: #666; font-size: 13px; margin-bottom: 24px; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
            th, td { border: 1px solid #999; padding: 8px; text-align: center; }
            th { background: #f2f2f2; }
            td.week { text-align: left; font-weight: bold; }
            td.total { font-weight: bold; }
            .section { margin-top: 20px; }
            .field { margin-bottom: 8px; }
          </style>
        </head>
        <body>
          <h1>Music Practice Verification — ${selectedStudent?.student_name ?? ""}</h1>
          <div class="subtitle">School Year ${schoolYear} — Quarter ${quarter}. From ${fromDate} to ${toDate}. Target: 150 min/week.</div>
          <table>
            <thead><tr><th></th>${DAYS.map((d) => `<th>${d}</th>`).join("")}<th>Total</th></tr></thead>
            <tbody>${rowsHtml}</tbody>
          </table>
          <div class="field">Teacher/Parent Verification: ${practiceVerification}</div>
          <div class="section">
            <h2>Performance Verification</h2>
            <div class="field">Title of Performance: ${performanceTitle}</div>
            <div class="field">Instrument: ${instrument}</div>
            <div class="field">Date of Performance: ${performanceDate}</div>
            <div class="field">Signature of Parent: ${parentSignature}</div>
            <div class="field">Signature of Pastor or Music Teacher: ${pastorTeacherSignature}</div>
          </div>
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
        Select a student above to use this form.
      </p>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">
            Music Practice Verification
          </h2>
          <p className="text-sm text-foreground/60">
            {selectedStudent.student_name} — needs 2½ hours (150 min) of
            practice per week for credit
          </p>
        </div>
        <Button variant="outline" onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-1.5" />
          Print
        </Button>
      </div>

      <div className="flex flex-wrap gap-3">
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
        <Input
          className="bg-background w-40"
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
        />
        <Input
          className="bg-background w-40"
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
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
                  <th className="p-3">Total</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((week, i) => (
                  <tr key={i} className="border-t border-border/50">
                    <td className="p-3 font-medium">Week {i + 1}</td>
                    {DAYS.map((d) => (
                      <td key={d} className="p-2">
                        <Input
                          className="bg-background h-8 w-16 text-center mx-auto"
                          value={week[d]}
                          onChange={(e) => updateMinutes(i, d, e.target.value)}
                          placeholder="min"
                        />
                      </td>
                    ))}
                    <td
                      className={`p-2 text-center font-medium ${weekTotal(week) >= WEEKLY_TARGET_MINUTES ? "text-green-600" : "text-foreground/60"}`}
                    >
                      {weekTotal(week)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5 max-w-sm">
            <Label>Teacher/Parent Verification (type full name)</Label>
            <Input
              className="bg-background"
              value={practiceVerification}
              onChange={(e) => setPracticeVerification(e.target.value)}
            />
          </div>

          <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4">
            <h3 className="font-semibold text-foreground">
              Performance Verification
            </h3>
            <p className="text-sm text-foreground/60">
              A solo performance is required once per quarter (recital or
              church), verified by the music teacher or pastor.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Title of Performance</Label>
                <Input
                  className="bg-background"
                  value={performanceTitle}
                  onChange={(e) => setPerformanceTitle(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Instrument</Label>
                <Input
                  className="bg-background"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date of Performance</Label>
                <Input
                  className="bg-background"
                  type="date"
                  value={performanceDate}
                  onChange={(e) => setPerformanceDate(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Signature of Parent (typed)</Label>
                <Input
                  className="bg-background"
                  value={parentSignature}
                  onChange={(e) => setParentSignature(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Signature of Pastor or Music Teacher (typed)</Label>
                <Input
                  className="bg-background"
                  value={pastorTeacherSignature}
                  onChange={(e) => setPastorTeacherSignature(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </>
      )}
    </div>
  );
}
