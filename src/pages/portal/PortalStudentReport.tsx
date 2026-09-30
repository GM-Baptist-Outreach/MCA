import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useLoggedCourseReport } from "@/hooks/useLoggedCourseReport";
import { subjectDisplayName } from "@/lib/loggedCourses";
import { ReportChrome } from "./ReportChrome";

function formatAvg(value: number | null): string {
  return value != null ? `${value.toFixed(1)}%` : "n/a";
}

export default function PortalStudentReport() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const report = useLoggedCourseReport(selectedStudent?.id);
  const { toast } = useToast();
  const [draftDate, setDraftDate] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const saveStartDate = async () => {
    if (!selectedStudent || !draftDate) return;
    setSaving(true);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const { error } = await supabase.from("student_school_calendars").insert({
      student_id: selectedStudent.id,
      school_year: report.schoolYear,
      start_date: draftDate,
      set_by: user?.id ?? null,
    });
    if (error) {
      toast({
        title: "Couldn't save the start date",
        description: error.message,
        variant: "destructive",
      });
    } else {
      toast({ title: "School start date saved" });
      report.refresh();
    }
    setSaving(false);
    setConfirmOpen(false);
  };

  if (!selectedStudent) {
    return <p className="text-foreground/60">Select a student above to view the report card.</p>;
  }

  return (
    <ReportChrome
      title="Student Progress Report"
      studentName={selectedStudent.student_name}
      schoolYear={report.schoolYear}
      onSchoolYear={report.setSchoolYear}
      stats={[
        {
          label: "Year average",
          value: report.overall != null ? `${report.overall.toFixed(1)}%` : "n/a",
        },
        { label: "PACEs completed", value: String(report.completed) },
        { label: "Remaining", value: String(report.remaining) },
      ]}
    >
      <p className="text-sm text-foreground/60">
        {report.schoolStartDate
          ? `Quarters are 9 weeks from the school start date ${report.schoolStartDate}. Work before that date counts in Q1, and work after week 36 counts in Q4.`
          : "Until you set a school start date, quarters follow the calendar: Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, and Q4 Apr-Jun. July starts the school year."}
      </p>
      {report.schoolStartDate ? (
        <p className="text-sm">
          School start date: <strong>{report.schoolStartDate}</strong>
          <span className="text-foreground/60"> — contact MCA to change it.</span>
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border/60 p-3">
          <div className="space-y-1">
            <Label htmlFor="school-start-date">Set your school start date</Label>
            <Input
              id="school-start-date"
              type="date"
              value={draftDate}
              onChange={(event) => setDraftDate(event.target.value)}
              className="bg-background w-44"
            />
          </div>
          <Button
            type="button"
            disabled={!draftDate}
            onClick={() => setConfirmOpen(true)}
          >
            Save start date
          </Button>
        </div>
      )}
      {report.loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : report.grids.length === 0 ? (
        <p className="text-foreground/60">
          No logged courses for {report.schoolYear}.
        </p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg print:overflow-visible">
          <table className="w-full text-sm print:text-xs">
            <thead className="bg-secondary/70 text-left">
              <tr>
                <th className="p-3 font-semibold">Subject</th>
                {report.quarterHeaders.map((quarter) => (
                  <th key={quarter.key} className="p-3 font-semibold">
                    {quarter.label}
                  </th>
                ))}
                <th className="p-3 font-semibold">Year</th>
                <th className="p-3 font-semibold">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {report.grids.map((grid) => (
                <tr key={grid.subjectId} className="border-t border-border/60 break-inside-avoid">
                  <td className="p-3 font-medium">{subjectDisplayName(grid.subjectName)}</td>
                  {report.quarterHeaders.map((quarter) => (
                    <td key={quarter.key} className="p-3">
                      {formatAvg(grid.quarterAverages[quarter.key])}
                    </td>
                  ))}
                  <td className="p-3">{formatAvg(grid.average)}</td>
                  <td className="p-3">{grid.remaining}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Set {draftDate} as the school start date?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be changed later. Contact MCA to change it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={saveStartDate} disabled={saving}>
              {saving ? "Saving..." : "Set start date"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ReportChrome>
  );
}
