import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";

export const REPORT_LEGEND = [
  ["P", "Passed"],
  ["F", "Failed"],
  ["I", "Issued"],
  ["S", "In stock"],
  ["O", "Ordered"],
] as const;

export function ReportChrome({
  title,
  studentName,
  schoolYear,
  onSchoolYear,
  stats,
  children,
}: {
  title: string;
  studentName: string;
  schoolYear: string;
  onSchoolYear: (value: string) => void;
  stats?: Array<{ label: string; value: string }>;
  children: ReactNode;
}) {
  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap print:block">
        <div>
          <p className="text-xs uppercase tracking-widest text-foreground/50">
            Midwest Christian Academy
          </p>
          <h2 className="text-2xl font-bold font-serif text-primary">{title}</h2>
          <p className="text-sm text-foreground/70">
            {studentName} · {new Date().toLocaleDateString()}
          </p>
          {stats && stats.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-6">
              {stats.map((stat) => (
                <div key={stat.label}>
                  <p className="text-[10px] uppercase tracking-wide text-foreground/50">
                    {stat.label}
                  </p>
                  <p className="text-xl font-serif text-primary">{stat.value}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 print:hidden">
          <Input
            value={schoolYear}
            onChange={(event) => onSchoolYear(event.target.value)}
            className="bg-background w-28"
            aria-label="School year"
          />
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" />
            Print
          </Button>
        </div>
      </div>
      <p className="text-xs text-foreground/60 border border-border/60 rounded-md p-3 bg-secondary/40">
        ACE and the external A2P system are the official grade record. This
        page is MCA's transfer and operations view of scores parents submit or
        staff enter. It does not replace the ACE gradebook.
      </p>
      {children}
    </div>
  );
}

export function scoreTone(score: number | null, letter: string): string {
  if (letter === "P" || (score != null && score >= 80)) return "text-green-700 font-semibold";
  if (letter === "F" || (score != null && score < 80)) return "text-red-700 font-semibold";
  return "text-foreground/70";
}
