import { useOutletContext } from "react-router-dom";
import type { PortalContext } from "./PortalLayout";
import { useLoggedCourseReport } from "@/hooks/useLoggedCourseReport";
import { REPORT_QUARTERS } from "@/lib/schoolQuarters";
import { ReportChrome } from "./ReportChrome";

function formatAvg(value: number | null): string {
  return value != null ? `${value.toFixed(1)}%` : "n/a";
}

export default function PortalStudentReport() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const report = useLoggedCourseReport(selectedStudent?.id);

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
        Quarters follow the school year. Q1 is Aug-Oct, Q2 is Nov-Dec, Q3 is
        Jan-Mar, and Q4 is Apr-Jul. {report.schoolYear} runs from August of the
        first year through July of the next. Each quarter average uses the
        completion date.
      </p>
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
                {REPORT_QUARTERS.map((quarter) => (
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
                  <td className="p-3 font-medium">{grid.subjectName}</td>
                  {REPORT_QUARTERS.map((quarter) => (
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
    </ReportChrome>
  );
}
