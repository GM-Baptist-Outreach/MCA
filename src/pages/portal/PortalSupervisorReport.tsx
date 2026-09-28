import { useOutletContext } from "react-router-dom";
import type { PortalContext } from "./PortalLayout";
import { useLoggedCourseReport, type ReportCell } from "@/hooks/useLoggedCourseReport";
import { REPORT_LEGEND, ReportChrome, scoreTone } from "./ReportChrome";

function formatReportDate(iso: string | null): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${Number(month)}/${Number(day)}/${year}`;
}

function PaceColumn({ cells }: { cells: ReportCell[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-[10px] uppercase tracking-wide text-foreground/50 border-b border-border/70">
          <th className="px-3 py-1.5 font-semibold w-16">PACE</th>
          <th className="px-2 py-1.5 font-semibold w-16">Status</th>
          <th className="px-2 py-1.5 font-semibold w-16">Score</th>
          <th className="px-2 py-1.5 font-semibold">Date</th>
        </tr>
      </thead>
      <tbody>
        {cells.map((cell) => (
          <tr key={cell.slotIndex} className="border-t border-border/40">
            <td className="px-3 py-1.5 font-medium">{cell.paceNumber ?? ""}</td>
            <td className={`px-2 py-1.5 ${scoreTone(cell.score, cell.letter)}`}>
              {cell.letter}
            </td>
            <td className={`px-2 py-1.5 ${scoreTone(cell.score, cell.letter)}`}>
              {cell.score ?? ""}
            </td>
            <td className="px-2 py-1.5 text-foreground/70">
              {formatReportDate(cell.date)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PortalSupervisorReport() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const report = useLoggedCourseReport(selectedStudent?.id);

  if (!selectedStudent) {
    return <p className="text-foreground/60">Select a student above to view the supervisor report.</p>;
  }

  const overall =
    report.overall != null ? `${report.overall.toFixed(1)}%` : "—";

  return (
    <ReportChrome
      title="Supervisor Progress Report"
      studentName={selectedStudent.student_name}
      schoolYear={report.schoolYear}
      onSchoolYear={report.setSchoolYear}
      stats={[
        { label: "PACEs Completed", value: String(report.completed) },
        { label: "Overall Average", value: overall },
      ]}
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
        <div className="space-y-4">
          {report.grids.map((grid) => (
            <section
              key={grid.subjectId}
              className="border border-primary/30 rounded-md overflow-hidden"
            >
              <div className="bg-secondary/70 px-3 py-2 flex items-baseline justify-between gap-3">
                <h3 className="font-semibold">{grid.subjectName}</h3>
                <p className="text-xs text-foreground/60">
                  Subject avg{" "}
                  {grid.average != null ? `${grid.average.toFixed(1)}%` : "—"}
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 print:grid-cols-2">
                <PaceColumn cells={grid.cells.slice(0, 6)} />
                <div className="md:border-l print:border-l border-border/70">
                  <PaceColumn cells={grid.cells.slice(6, 12)} />
                </div>
              </div>
            </section>
          ))}
        </div>
      )}
    </ReportChrome>
  );
}
