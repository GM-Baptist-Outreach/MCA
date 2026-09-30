import { useOutletContext } from "react-router-dom";
import type { PortalContext } from "./PortalLayout";
import { useLoggedCourseReport, type ReportCell } from "@/hooks/useLoggedCourseReport";
import { ReportChrome, scoreTone } from "./ReportChrome";
import { subjectDisplayName, toAcePaceNumber } from "@/lib/loggedCourses";

function formatAvg(value: number | null): string {
  return value != null ? value.toFixed(1) : "n/a";
}

function SubjectGridTable({
  subjectName,
  cells,
  average,
  remaining,
}: {
  subjectName: string;
  cells: ReportCell[];
  average: number | null;
  remaining: number;
}) {
  return (
    <div className="overflow-x-auto print:overflow-visible break-inside-avoid">
      <table className="w-full border-collapse text-sm print:text-[10px]">
        <thead>
          <tr>
            <th className="border border-border px-2 py-1 text-left align-bottom min-w-28">
              {subjectDisplayName(subjectName)}
            </th>
            {cells.map((cell) => (
              <th
                key={cell.slotIndex}
                className="border border-border px-1 py-1 text-center font-semibold align-bottom"
              >
                <div>{cell.slotIndex}</div>
                <div className="text-[10px] font-normal text-foreground/60">
                  {cell.paceNumber != null ? toAcePaceNumber(cell.paceNumber) : ""}
                </div>
              </th>
            ))}
            <th className="border border-border px-2 py-1 text-center align-bottom">
              Avg
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="border border-border px-2 py-2 text-[10px] text-foreground/60">
              Remaining {remaining}
            </td>
            {cells.map((cell) => (
              <td
                key={cell.slotIndex}
                className={`border border-border px-1 py-2 text-center ${scoreTone(cell.score, cell.letter)}`}
              >
                {cell.score ?? ""}
              </td>
            ))}
            <td className="border border-border px-2 py-2 text-center font-semibold">
              {formatAvg(average)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

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
      stats={[
        { label: "PACEs Completed", value: String(report.completed) },
        { label: "Remaining", value: String(report.remaining) },
        {
          label: "Overall Average",
          value: report.overall != null ? `${report.overall.toFixed(1)}%` : "n/a",
        },
      ]}
    >
      {report.loading ? (
        <p className="text-foreground/60">Loading logged courses...</p>
      ) : report.grids.length === 0 ? (
        <p className="text-foreground/60">
          No logged courses for {report.schoolYear} yet. Staff prescribe the
          12 PACE boxes on the family record.
        </p>
      ) : (
        <div className="space-y-4 print:space-y-3">
          {report.grids.map((grid) => (
            <SubjectGridTable
              key={grid.subjectId}
              subjectName={grid.subjectName}
              cells={grid.cells}
              average={grid.average}
              remaining={grid.remaining}
            />
          ))}
        </div>
      )}
    </ReportChrome>
  );
}
