/** Report-card quarters inside a school year.
 * 2026-27 is Aug 2026 through Jul 2027.
 * Q1 Aug-Oct, Q2 Nov-Dec, Q3 Jan-Mar, Q4 Apr-Jul.
 */
export const REPORT_QUARTERS = [
  { key: "Q1", label: "Q1", months: [8, 9, 10], yearOffset: 0 },
  { key: "Q2", label: "Q2", months: [11, 12], yearOffset: 0 },
  { key: "Q3", label: "Q3", months: [1, 2, 3], yearOffset: 1 },
  { key: "Q4", label: "Q4", months: [4, 5, 6, 7], yearOffset: 1 },
] as const;

export type ReportQuarterKey = (typeof REPORT_QUARTERS)[number]["key"];

export type QuarterAverages = Record<ReportQuarterKey, number | null>;

export function schoolYearStart(schoolYear: string): number | null {
  const match = schoolYear.match(/^(\d{4})-/);
  if (!match) return null;
  return Number(match[1]);
}

export function quarterForCompletedAt(
  completedAt: string | null | undefined,
  schoolYear: string,
): ReportQuarterKey | null {
  if (!completedAt) return null;
  const start = schoolYearStart(schoolYear);
  if (start == null) return null;
  const [yearText, monthText] = completedAt.slice(0, 10).split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  if (!year || !month) return null;
  for (const quarter of REPORT_QUARTERS) {
    if (
      year === start + quarter.yearOffset &&
      (quarter.months as readonly number[]).includes(month)
    ) {
      return quarter.key;
    }
  }
  return null;
}
