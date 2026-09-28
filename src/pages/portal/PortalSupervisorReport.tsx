import { useOutletContext } from "react-router-dom";
import type { PortalContext } from "./PortalLayout";
import { useLoggedCourseReport } from "@/hooks/useLoggedCourseReport";
import { REPORT_LEGEND, ReportChrome, scoreTone } from "./ReportChrome";

export default function PortalSupervisorReport() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const report = useLoggedCourseReport(selectedStudent?.id);

  if (!selectedStudent) {
    return <p className="text-foreground/60">Select a student above to view the supervisor report.</p>;
  }

  return (
    <ReportChrome
      title="Supervisor Progress Report"
      studentName={selectedStudent.student_name}
      schoolYear={report.schoolYear}
      onSchoolYear={report.setSchoolYear}
    >
      <div className="flex flex-wrap gap-3 text-xs">
        {REPORT_LEGEND.map(([letter, label]) => (
          <span key={letter} className="border border-border px-2 py-1 rounded">
            <strong>{letter}</strong> {label}
          </span>
        ))}
      </div>

      {report.loading ? (
        <p className="text-foreground/60">Loading logged courses...</p>
      ) : report.grids.length === 0 ? (
        <p className="text-foreground/60">
          No logged courses for {report.schoolYear} yet. Staff prescribe the
          12 PACE boxes on the family record.
        </p>
      ) : (
        <div className="space-y-4 overflow-x-auto">
          {report.grids.map((grid) => (
            <div key={grid.subjectId} className="min-w-[880px]">
              <div className="flex items-end justify-between mb-1">
                <h3 className="font-semibold">{grid.subjectName}</h3>
                <p className="text-sm">
                  Subject avg:{" "}
                  {grid.average != null ? `${grid.average.toFixed(1)}%` : "—"} ·{" "}
                  {grid.completed} completed
                </p>
              </div>
              <div className="grid grid-cols-12 gap-1">
                {grid.cells.map((cell) => {
                  const issued =
                    cell.status === "issued" ||
                    cell.status === "passed" ||
                    cell.status === "failed" ||
                    cell.letter === "P" ||
                    cell.letter === "F" ||
                    cell.letter === "I";
                  return (
                    <div
                      key={cell.slotIndex}
                      className="border border-primary/30 rounded-sm h-[4.5rem] flex flex-col text-center overflow-hidden"
                    >
                      <div
                        className={`text-xs font-semibold leading-5 ${
                          issued ? "bg-amber-200 text-primary" : "bg-secondary/60"
                        }`}
                      >
                        {cell.paceNumber ?? "·"}
                        {cell.letter && (
                          <span className="ml-1 text-[10px]">{cell.letter}</span>
                        )}
                      </div>
                      <div className={`flex-1 flex items-center justify-center text-sm ${scoreTone(cell.score, cell.letter)}`}>
                        {cell.score != null ? cell.score : ""}
                      </div>
                      <div className="text-[9px] text-foreground/50 leading-4 truncate px-0.5">
                        {cell.date ?? ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-border pt-4 flex flex-wrap gap-6 text-sm">
        <p>
          <strong>Overall avg:</strong>{" "}
          {report.overall != null ? `${report.overall.toFixed(1)}%` : "—"}
        </p>
        <p>
          <strong>PACEs completed:</strong> {report.completed}
        </p>
        <p className="text-foreground/60">School year {report.schoolYear}</p>
      </div>
    </ReportChrome>
  );
}
