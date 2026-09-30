import { useMemo } from "react";
import { useOutletContext } from "react-router-dom";
import { Star } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { PortalContext } from "./PortalLayout";
import { useLoggedCourseReport } from "@/hooks/useLoggedCourseReport";
import { ReportChrome } from "./ReportChrome";
import {
  SUBJECT_GROUPS,
  SUBJECT_GROUP_COLORS,
  subjectGroup,
} from "@/lib/loggedCourses";

export default function PortalStarChart() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const report = useLoggedCourseReport(selectedStudent?.id);

  const stars = report.stars;
  const grouped = useMemo(() => {
    const map = new Map<string, typeof stars>();
    for (const star of stars) {
      const list = map.get(star.subjectName) ?? [];
      list.push(star);
      map.set(star.subjectName, list);
    }
    return [...map.entries()];
  }, [stars]);

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
        One star for each completed PACE, colored by subject. Hover a star for
        the score and date. Stars from logged courses in {report.schoolYear}{" "}
        are included, plus any passing score submitted on the Upload Tests page.
      </p>
      <div className="flex flex-wrap gap-3 text-xs">
        {SUBJECT_GROUPS.map((group) => (
          <span key={group} className="inline-flex items-center gap-1.5">
            <Star className={`h-4 w-4 ${SUBJECT_GROUP_COLORS[group].star}`} />
            {group}
          </span>
        ))}
      </div>
      {report.loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : grouped.length === 0 ? (
        <p className="text-foreground/60">No completed PACEs to chart yet.</p>
      ) : (
        <div className="space-y-6">
          {grouped.map(([subject, stars]) => {
            const group = subjectGroup(subject) ?? "Electives";
            const starClass = SUBJECT_GROUP_COLORS[group].star;
            return (
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
                          <Star className={`h-8 w-8 ${starClass}`} />
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
            );
          })}
        </div>
      )}
    </ReportChrome>
  );
}
