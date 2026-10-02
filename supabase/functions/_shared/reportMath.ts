// GENERATED from src/lib/loggedCourses.ts by /workspace/mca-round8/make_report_math.py.
// Each block below is copied verbatim; src/test/sharedReportMath.test.ts fails if
// a block no longer matches the app's copy. Edit loggedCourses.ts, then regenerate.
/* eslint-disable */

export const PASSING_SCORE = 80;

export function currentSchoolYear(date = new Date()): string {
  const year = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

export function isSlotCompleted(
  status: string | null | undefined,
  score: number | null | undefined,
): boolean {
  return (score != null && !Number.isNaN(score)) || status === "passed" || status === "failed";
}

export function average(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((n): n is number => n != null && !Number.isNaN(n));
  if (nums.length === 0) return null;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export const QUARTER_LENGTH_DAYS = 63;

export const REPORT_QUARTERS = [
  { key: "Q1", label: "Q1", months: [7, 8, 9], yearOffset: 0 },
  { key: "Q2", label: "Q2", months: [10, 11, 12], yearOffset: 0 },
  { key: "Q3", label: "Q3", months: [1, 2, 3], yearOffset: 1 },
  { key: "Q4", label: "Q4", months: [4, 5, 6], yearOffset: 1 },
] as const;

export type ReportQuarterKey = (typeof REPORT_QUARTERS)[number]["key"];

export interface QuarterRange {
  key: ReportQuarterKey;
  label: string;
  start: string;
  end: string;
}

export function schoolYearStart(schoolYear: string): number | null {
  const match = schoolYear.match(/^(\d{4})-/);
  if (!match) return null;
  return Number(match[1]);
}

export function schoolYearDateBounds(
  schoolYear: string,
): { start: string; end: string } | null {
  const start = schoolYearStart(schoolYear);
  if (start == null) return null;
  return { start: `${start}-07-01`, end: `${start + 1}-06-30` };
}

function utcDay(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function quarterRanges(startDate: string): QuarterRange[] {
  const start = startDate.slice(0, 10);
  return REPORT_QUARTERS.map((quarter, index) => ({
    key: quarter.key,
    label: quarter.label,
    start: addDays(start, index * QUARTER_LENGTH_DAYS),
    end: addDays(start, (index + 1) * QUARTER_LENGTH_DAYS),
  }));
}

export function quarterForDate(
  date: string,
  startDate: string,
): ReportQuarterKey {
  const day = Math.round(
    (utcDay(date) - utcDay(startDate)) / 86400000,
  );
  if (day < QUARTER_LENGTH_DAYS) return "Q1";
  if (day < QUARTER_LENGTH_DAYS * 2) return "Q2";
  if (day < QUARTER_LENGTH_DAYS * 3) return "Q3";
  return "Q4";
}

export function quarterForCompletedAt(
  completedAt: string | null | undefined,
  schoolYear: string,
  startDate?: string | null,
): ReportQuarterKey | null {
  if (!completedAt) return null;
  if (startDate) return quarterForDate(completedAt, startDate);
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

export function toInternalPaceNumber(paceNumber: number): number {
  if (!Number.isFinite(paceNumber)) return paceNumber;
  return paceNumber > 1000 ? paceNumber - 1000 : paceNumber;
}

export function toAcePaceNumber(paceNumber: number): number {
  return toInternalPaceNumber(paceNumber) + 1000;
}

export const SUBJECT_GROUPS = [
  "Math",
  "English",
  "Word Building",
  "Science",
  "Social Studies",
  "Electives",
] as const;

export type SubjectGroup = (typeof SUBJECT_GROUPS)[number];

export const ELECTIVE_EXCLUSIONS = [
  "Uncategorized",
  "School Supplies & Incentives",
  "Kindergarten",
  "Math Diagnostic",
  "Honor Roll Cert.",
  "Videophonics",
] as const;

export const ENGLISH_SUBJECT_PATTERN =
  /\b(english|literature)\b|\blit\b|creative writing/i;

const WORD_BUILDING_PATTERN = /\bword building\b/i;

const SOCIAL_STUDIES_PATTERN =
  /\b(social studies|history|government|economics|geography|civics|constitution)\b/i;

const SCIENCE_PATTERN =
  /\b(science|sci|biology|chemistry|physics|anatomy)\b|\blabs?(set)?\b/i;

const MATH_PATTERN =
  /\b(math|mathematics|algebra|pre-algebra|geometry|trigonometry|trig|calculus|pre-calculus|statistics)\b/i;

export function isExcludedStoreCategory(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (normalized.includes("lab set")) return true;
  return ELECTIVE_EXCLUSIONS.some((label) => {
    const expected = label.toLowerCase().replace(/\.$/, "");
    return normalized === label.toLowerCase() || normalized.startsWith(expected);
  });
}

const SUBJECT_GROUP_OVERRIDES: Record<string, SubjectGroup> = {
  accounting: "Math",
  "general business": "Math",
  health: "Science",
  collectivism: "Social Studies",
  "nt survey": "Electives",
  "ot survey": "Electives",
  "nt church history": "Electives",
  "life of christ": "Electives",
  "intro to missions": "Electives",
  "successful living": "Electives",
};

export function subjectGroup(name: string): SubjectGroup | null {
  const trimmed = name.trim();
  if (!trimmed || isExcludedStoreCategory(trimmed)) return null;
  const override = SUBJECT_GROUP_OVERRIDES[trimmed.toLowerCase().replace(/\s+/g, " ")];
  if (override) return override;
  if (WORD_BUILDING_PATTERN.test(trimmed)) return "Word Building";
  if (ENGLISH_SUBJECT_PATTERN.test(trimmed)) return "English";
  if (SOCIAL_STUDIES_PATTERN.test(trimmed)) return "Social Studies";
  if (SCIENCE_PATTERN.test(trimmed)) return "Science";
  if (MATH_PATTERN.test(trimmed)) return "Math";
  return "Electives";
}

export const SUBJECT_DISPLAY_NAMES: Record<string, string> = {
  "Lit & Creative Writing": "Literature and Creative Writing",
  Constitution: "U.S. Constitution",
  "NT Survey": "New Testament Survey",
  "OT Survey": "Old Testament Survey",
  "NT Church History": "New Testament Church History",
  "Successful Living": "Proverbs: Successful Living",
  "Creative Communication Skills": "Creative Communication",
  Accounting: "Accounting (Alpha and Omega)",
};

const CORE_COURSE_RANK: Record<string, number> = {
  Math: 0,
  "Algebra I": 90,
  Geometry: 100,
  "Algebra II": 110,
  Trigonometry: 120,
  "Business Math": 200,
  "General Business": 210,
  Accounting: 220,
  English: 0,
  "Lit & Creative Writing": 10,
  "Basic Literature": 11,
  "English I": 90,
  "English II": 100,
  "English III": 110,
  "English IV": 120,
  "Word Building": 0,
  Science: 0,
  "Animal Science": 10,
  Biology: 90,
  "Physical Science": 100,
  Chemistry: 110,
  Physics: 120,
  Health: 200,
  "Nutrition Science": 210,
  "Social Studies": 0,
  "World Geography": 90,
  "World History": 100,
  "American History": 110,
  Civics: 120,
  Economics: 121,
  Collectivism: 130,
  Constitution: 140,
};

export function subjectDisplayName(name: string): string {
  return SUBJECT_DISPLAY_NAMES[name] ?? name;
}

export function subjectSortKey(name: string): [number, number, string] {
  const group = subjectGroup(name);
  const groupIndex = group == null ? SUBJECT_GROUPS.length : SUBJECT_GROUPS.indexOf(group);
  const display = subjectDisplayName(name).toLowerCase();
  if (group === "Electives" || group == null) return [groupIndex, 0, display];
  return [groupIndex, CORE_COURSE_RANK[name] ?? 500, display];
}

export function compareSubjectNames(a: string, b: string): number {
  const left = subjectSortKey(a);
  const right = subjectSortKey(b);
  if (left[0] !== right[0]) return left[0] - right[0];
  if (left[1] !== right[1]) return left[1] - right[1];
  return left[2].localeCompare(right[2], undefined, { numeric: true });
}

export const DEFAULT_GRADUATION_TOTAL_CREDITS = 25;

export interface GradCompletionLike {
  subject_name: string;
  credit_earned: number | string | null;
  final_average: number | string | null;
  is_transfer: boolean | null;
  fulfills_requirement?: string | null;
}

export interface GradRequirementLike {
  subject_name: string;
  credit_required: number | string;
}

export interface GraduationProgress {
  totalRequired: number;
  earned: number;
  inProgress: number;
  stillNeeded: number;
  earnedPercent: number;
  inProgressPercent: number;
  requirementsTotal: number;
  electivesRequired: number;
  electivesRemaining: number;
  remainingBySubject: Array<{ subject: string; credits: number }>;
}

function gradNorm(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

export function isCompletionDone(c: GradCompletionLike): boolean {
  return c.is_transfer === true || (c.final_average != null && c.final_average !== "");
}

export function graduationProgress(
  requirements: GradRequirementLike[],
  completions: GradCompletionLike[],
  totalSetting: number | null | undefined = DEFAULT_GRADUATION_TOTAL_CREDITS,
): GraduationProgress {
  const round = (n: number) => Math.round(n * 100) / 100;
  const credit = (v: number | string | null) => {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  const requirementsTotal = requirements.reduce((sum, r) => sum + credit(r.credit_required), 0);
  const setting = Number(totalSetting);
  const totalRequired = Math.max(
    Number.isFinite(setting) && setting > 0 ? setting : DEFAULT_GRADUATION_TOTAL_CREDITS,
    requirementsTotal,
  );
  const earned = completions.filter(isCompletionDone).reduce((s, c) => s + credit(c.credit_earned), 0);
  const inProgress = completions
    .filter((c) => !isCompletionDone(c))
    .reduce((s, c) => s + credit(c.credit_earned), 0);

  const keys = new Set(requirements.map((r) => gradNorm(r.subject_name)));
  let electiveCredits = completions
    .filter((c) => !keys.has(gradNorm(c.fulfills_requirement || c.subject_name)))
    .reduce((s, c) => s + credit(c.credit_earned), 0);
  const remainingBySubject: Array<{ subject: string; credits: number }> = [];
  for (const r of requirements) {
    const key = gradNorm(r.subject_name);
    const covered = completions
      .filter((c) => gradNorm(c.fulfills_requirement || c.subject_name) === key)
      .reduce((s, c) => s + credit(c.credit_earned), 0);
    const need = credit(r.credit_required);
    if (covered > need) electiveCredits += covered - need;
    const left = need - covered;
    if (left > 0.001) remainingBySubject.push({ subject: r.subject_name, credits: round(left) });
  }
  const electivesRequired = Math.max(0, totalRequired - requirementsTotal);
  const electivesRemaining = Math.max(0, electivesRequired - electiveCredits);
  const stillNeeded = Math.max(0, totalRequired - earned - inProgress);
  const pct = (n: number) => (totalRequired > 0 ? Math.min(100, (n / totalRequired) * 100) : 0);
  const earnedPercent = pct(earned);
  return {
    totalRequired: round(totalRequired),
    earned: round(earned),
    inProgress: round(inProgress),
    stillNeeded: round(stillNeeded),
    earnedPercent,
    inProgressPercent: Math.min(100 - earnedPercent, pct(inProgress)),
    requirementsTotal: round(requirementsTotal),
    electivesRequired: round(electivesRequired),
    electivesRemaining: round(electivesRemaining),
    remainingBySubject,
  };
}

export type ReportPeriod = "S1" | "S2" | "year";

export const REPORT_PERIODS: Array<{ key: ReportPeriod; label: string }> = [
  { key: "S1", label: "1st semester (Q1-Q2)" },
  { key: "S2", label: "2nd semester (Q3-Q4)" },
  { key: "year", label: "Full school year" },
];

export function isInReportPeriod(
  completedAt: string | null | undefined,
  schoolYear: string,
  startDate: string | null | undefined,
  period: ReportPeriod,
): boolean {
  const quarter = quarterForCompletedAt(completedAt, schoolYear, startDate);
  if (!quarter) return false;
  if (period === "year") return true;
  return period === "S1" ? quarter === "Q1" || quarter === "Q2" : quarter === "Q3" || quarter === "Q4";
}

export function currentReportPeriod(date = new Date()): ReportPeriod {
  const month = date.getMonth() + 1;
  return month >= 7 ? "S1" : "S2";
}
