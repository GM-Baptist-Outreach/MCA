import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { Star } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PortalContext } from "./PortalLayout";
import { useLoggedCourseReport, type StarPace } from "@/hooks/useLoggedCourseReport";
import { ReportChrome } from "./ReportChrome";

function starClass(score: number): string {
  if (score >= 98) return "fill-amber-400 text-amber-600";
  if (score >= 90) return "fill-yellow-300 text-yellow-600";
  if (score >= 80) return "fill-lime-500 text-lime-700";
  return "fill-transparent text-foreground/30";
}

export default function PortalStarChart() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const report = useLoggedCourseReport(selectedStudent?.id);

  const grouped = useMemo(() => {
    const map = new Map<string, StarPace[]>();
    for (const star of report.stars) {
      const list = map.get(star.subjectName) ?? [];
      list.push(star);
      map.set(star.subjectName, list);
    }
    return [...map.entries()];
  }, [report.stars]);

  if (!selectedStudent) {
    return <p className="text-foreground/60">Select a student above to view the star chart.</p>;
  }

  return (
    <ReportChrome
      title="Star Chart"
      studentName={selectedStudent.student_name}
      schoolYear={report.schoolYear}
      onSchoolYear={report.setSchoolYear}
    >
      <p className="text-sm text-foreground/60">
        One star for each completed PACE. Gold is 98+, yellow is 90–97, green
        is 80–89. Hover a star for the score and date. Stars from logged
        courses in {report.schoolYear} are included, plus any passing score
        submitted on the Progress page.
      </p>
      {report.loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : grouped.length === 0 ? (
        <p className="text-foreground/60">No completed PACEs to chart yet.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([subject, stars]) => (
            <div key={subject}>
              <h3 className="font-semibold mb-2">{subject}</h3>
              <div className="flex flex-wrap gap-3">
                {stars.map((star) => (
                  <Tooltip key={star.key}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="flex flex-col items-center gap-1"
                        aria-label={`${subject} PACE ${star.paceNumber}, score ${star.score}`}
                      >
                        <Star className={`h-8 w-8 ${starClass(star.score)}`} />
                        <span className="text-xs text-foreground/60">{star.paceNumber}</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        PACE {star.paceNumber}: {star.score}%
                        {star.date ? ` on ${star.date}` : ""}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </ReportChrome>
  );
}
