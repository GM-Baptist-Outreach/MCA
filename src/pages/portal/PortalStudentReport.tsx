import { useOutletContext } from "react-router-dom";
import type { PortalContext } from "./PortalLayout";
import { useLoggedCourseReport } from "@/hooks/useLoggedCourseReport";
import { ReportChrome, scoreTone } from "./ReportChrome";

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
    >
      {report.loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : report.grids.length === 0 ? (
        <p className="text-foreground/60">
          No logged courses for {report.schoolYear}.
        </p>
      ) : (
        <div className="overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-secondary/70 text-left">
              <tr>
                <th className="p-3 font-semibold">Subject</th>
                <th className="p-3 font-semibold">PACEs</th>
                <th className="p-3 font-semibold">Completed</th>
                <th className="p-3 font-semibold">Average</th>
              </tr>
            </thead>
            <tbody>
              {report.grids.map((grid) => (
                <tr key={grid.subjectId} className="border-t border-border/60 align-top">
                  <td className="p-3 font-medium">{grid.subjectName}</td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {grid.cells
                        .filter((cell) => cell.paceNumber != null)
                        .map((cell) => (
                          <span
                            key={cell.slotIndex}
                            className={`inline-flex min-w-10 justify-center rounded border border-border px-1.5 py-0.5 text-xs ${scoreTone(cell.score, cell.letter)}`}
                            title={cell.date ?? undefined}
                          >
                            {cell.paceNumber}
                            {cell.letter ? ` ${cell.letter}` : ""}
                            {cell.score != null ? ` ${cell.score}` : ""}
                          </span>
                        ))}
                    </div>
                  </td>
                  <td className="p-3">{grid.completed}</td>
                  <td className="p-3">
                    {grid.average != null ? `${grid.average.toFixed(1)}%` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">Overall average</p>
          <p className="text-3xl font-serif text-primary">
            {report.overall != null ? `${report.overall.toFixed(1)}%` : "—"}
          </p>
        </div>
        <div className="rounded-lg border border-border p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50">PACEs completed</p>
          <p className="text-3xl font-serif text-primary">{report.completed}</p>
        </div>
      </div>
    </ReportChrome>
  );
}
