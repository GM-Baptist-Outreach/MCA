/** Logged-course helpers shared by the store, admin grid, and portal reports.
 * ACE / the external A2P system stays the official gradebook. These helpers
 * only describe MCA's transfer and operations view.
 */

export const PACES_PER_LEVEL = 12;
export const QUARTER_SHIP_COUNT = 3;
export const SCORE_LOOKBACK = 6;
export const PASSING_SCORE = 80;

/** Q1 is the first 3 PACEs sent at enrollment, so it has no later ship date.
 * 2025-26 fixed dates: Q2 2025-10-26, Q3 2026-01-11, Q4 2026-03-08.
 */
export const SCHOOL_YEAR_2025_26_SHIP_DATES = {
  q1: "",
  q2: "2025-10-26",
  q3: "2026-01-11",
  q4: "2026-03-08",
} as const;

/** Elementary numbering on `items.pace_number` (MCA internal, not ACE+1000).
 * Level 7 → 73–84. Confirmed against Science 73–84 (grade_level 7).
 */
export function paceRangeForLevel(level: number): { start: number; end: number } {
  if (!Number.isInteger(level) || level < 1) {
    throw new Error("Level must be a positive integer");
  }
  const start = (level - 1) * PACES_PER_LEVEL + 1;
  return { start, end: start + PACES_PER_LEVEL - 1 };
}

/** School year starts July 1. Sep 2026 → "2026-27". */
export function currentSchoolYear(date = new Date()): string {
  const year = date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${year}-${String(year + 1).slice(-2)}`;
}

export function nextSchoolYear(schoolYear: string): string {
  const match = schoolYear.match(/^(\d{4})-/);
  if (!match) return schoolYear;
  const start = Number(match[1]) + 1;
  return `${start}-${String(start + 1).slice(-2)}`;
}

/** Q1 stays blank: those 3 PACEs go out at enrollment.
 * Later quarters use the 2025-26 month/day, shifted to the school year.
 */
export function suggestedFixedShipDates(schoolYear: string): {
  q1: string;
  q2: string;
  q3: string;
  q4: string;
} {
  const match = schoolYear.match(/^(\d{4})-/);
  if (!match) return { q1: "", q2: "", q3: "", q4: "" };
  const start = Number(match[1]);
  const end = start + 1;
  return {
    q1: "",
    q2: `${start}-10-26`,
    q3: `${end}-01-11`,
    q4: `${end}-03-08`,
  };
}

export type ReportLetter = "P" | "F" | "I" | "S" | "O" | "";

/** Supervisor report letters: P passed, F failed, I issued, S in stock, O ordered. */
export function reportLetter(
  status: string | null | undefined,
  score: number | null | undefined,
): ReportLetter {
  if (score != null && !Number.isNaN(score)) {
    return score >= PASSING_SCORE ? "P" : "F";
  }
  if (status === "passed") return "P";
  if (status === "failed") return "F";
  if (status === "issued") return "I";
  if (status === "in_stock") return "S";
  if (status === "ordered") return "O";
  return "";
}

/** A prescribed slot is completed when it has a score or is passed/failed. */
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

export interface PaceSlotLike {
  id: string;
  subject_id: string;
  subject_name: string;
  slot_index: number;
  pace_number: number;
  status: string;
  score: number | null;
  issued_at: string | null;
}

const UNISSUED = new Set(["prescribed", "ordered", "in_stock"]);
const ISSUED = new Set(["issued", "passed", "failed"]);

/** Next 3 not-yet-issued PACEs in slot order, for every logged subject. */
export function nextQuarterPaces<T extends PaceSlotLike>(slots: T[]): T[] {
  const bySubject = new Map<string, T[]>();
  for (const slot of slots) {
    const list = bySubject.get(slot.subject_id) ?? [];
    list.push(slot);
    bySubject.set(slot.subject_id, list);
  }
  const subjects = [...bySubject.values()].sort((a, b) =>
    a[0].subject_name.localeCompare(b[0].subject_name),
  );
  const picked: T[] = [];
  for (const list of subjects) {
    const unissued = list
      .filter((slot) => UNISSUED.has(slot.status))
      .sort((a, b) => a.slot_index - b.slot_index);
    picked.push(...unissued.slice(0, QUARTER_SHIP_COUNT));
  }
  return picked;
}

/** Six most recently issued slots across every subject.
 * Returns the ones among those six that have no score.
 * Fewer than six issued slots does not pause a shipment.
 */
export function priorIssuedMissingScores<T extends PaceSlotLike>(slots: T[]): T[] {
  const issued = slots
    .filter((slot) => ISSUED.has(slot.status) || slot.issued_at != null)
    .sort((a, b) => {
      const da = a.issued_at ?? "";
      const db = b.issued_at ?? "";
      if (da !== db) return db.localeCompare(da);
      return b.slot_index - a.slot_index;
    });
  if (issued.length < SCORE_LOOKBACK) return [];
  return issued.slice(0, SCORE_LOOKBACK).filter((slot) => slot.score == null);
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isoToday(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

/** True when `shipDate` is today or within the next 7 days. */
export function isWithinShipWindow(today: string, shipDate: string): boolean {
  return shipDate >= today && shipDate <= addDays(today, 7);
}

export function advanceShipDate(
  mode: "fixed_dates" | "every_8_weeks",
  current: string,
  fixedDates: Array<string | null | undefined>,
): string | null {
  if (mode === "every_8_weeks") return addDays(current, 56);
  const upcoming = fixedDates
    .filter((d): d is string => !!d && d > current)
    .sort();
  return upcoming[0] ?? null;
}

export interface CatalogPace {
  id: string;
  subject_id: string;
  pace_number: number;
  grade_level: number | null;
}

/** Prefer the row whose grade_level matches the requested level when duplicates exist. */
export function selectPacesForLevel(
  catalog: CatalogPace[],
  subjectId: string,
  level: number,
): CatalogPace[] {
  const { start, end } = paceRangeForLevel(level);
  const byNumber = new Map<number, CatalogPace>();
  for (const item of catalog) {
    if (item.subject_id !== subjectId) continue;
    if (item.pace_number < start || item.pace_number > end) continue;
    const existing = byNumber.get(item.pace_number);
    if (!existing) {
      byNumber.set(item.pace_number, item);
      continue;
    }
    if (item.grade_level === level && existing.grade_level !== level) {
      byNumber.set(item.pace_number, item);
    }
  }
  return [...byNumber.values()].sort((a, b) => a.pace_number - b.pace_number);
}

export interface CompanionCandidate {
  id: string;
  subject_id: string | null;
  item_type: string;
  range_start: number | null;
  range_end: number | null;
}

export type CompanionKind = "key" | "book";

export function companionKind(itemType: string): CompanionKind | null {
  if (itemType === "key") return "key";
  if (itemType === "other") return "book";
  return null;
}

export function companionLabel(kind: CompanionKind): string {
  return kind === "key" ? "Answer key" : "Required resource book";
}

/** Every key and resource book whose range covers at least one of the PACEs. */
export function matchingCompanions<T extends CompanionCandidate>(
  paces: Array<{ subject_id: string | null; pace_number: number | null }>,
  catalog: T[],
): T[] {
  const seen = new Set<string>();
  const matches: T[] = [];
  for (const pace of paces) {
    if (pace.pace_number == null || !pace.subject_id) continue;
    for (const candidate of catalog) {
      if (seen.has(candidate.id)) continue;
      if (companionKind(candidate.item_type) == null) continue;
      if (candidate.subject_id !== pace.subject_id) continue;
      if (candidate.range_start == null || candidate.range_end == null) continue;
      if (
        pace.pace_number >= candidate.range_start &&
        pace.pace_number <= candidate.range_end
      ) {
        seen.add(candidate.id);
        matches.push(candidate);
      }
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Oklahoma store sales tax. Formerly src/lib/okSalesTax.ts.
// Tuition enrollment never uses this. Shipping is excluded from the tax base.
// ---------------------------------------------------------------------------

export const OK_SALES_TAX_RATE = 0.1;

export function isOklahomaState(state: string | null | undefined): boolean {
  const normalized = (state ?? "").trim().toUpperCase();
  return normalized === "OK" || normalized === "OKLAHOMA";
}

/**
 * Ship-to is taxed when the destination state is Oklahoma.
 * Local pickup is always an Oklahoma sale: the only pickup location is
 * MCA's office at 2300 NW 32nd Street, Newcastle, OK 73065.
 */
export function shouldApplyOklahomaStoreTax(input: {
  fulfillment: "ship" | "pickup";
  addressState?: string | null;
}): boolean {
  if (input.fulfillment === "pickup") return true;
  return isOklahomaState(input.addressState);
}

export function oklahomaProductTaxCents(productSubtotalCents: number): number {
  if (productSubtotalCents <= 0) return 0;
  return Math.round(productSubtotalCents * OK_SALES_TAX_RATE);
}

// ---------------------------------------------------------------------------
// Pick-list stock. Formerly src/lib/pickListStock.ts.
// A missing inventory row stays null and is not backordered.
// A tracked quantity of 0 stays 0 and is backordered. Do not turn 0 into null.
// ---------------------------------------------------------------------------

export function trackedStock(sum: number | null | undefined): {
  quantityOnHand: number | null;
  backordered: boolean;
} {
  if (sum == null || Number.isNaN(sum)) {
    return { quantityOnHand: null, backordered: false };
  }
  return { quantityOnHand: sum, backordered: sum <= 0 };
}

// ---------------------------------------------------------------------------
// Report-card quarters. Formerly src/lib/schoolQuarters.ts.
// 2026-27 is Aug 2026 through Jul 2027.
// Q1 Aug-Oct, Q2 Nov-Dec, Q3 Jan-Mar, Q4 Apr-Jul.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Subject groups. Formerly src/lib/subjectGroups.ts.
// Used by PACE Status, the star chart, and English-novel pick lines.
// Store categories in ELECTIVE_EXCLUSIONS are not electives.
// ENGLISH_SUBJECT_PATTERN is mirrored in the pick-list SQL with Postgres
// word boundaries (\m \M) in place of \b.
// ---------------------------------------------------------------------------

export const SUBJECT_GROUPS = [
  "Math",
  "English",
  "Social Studies",
  "Science",
  "Word Building",
  "Electives",
] as const;

export type SubjectGroup = (typeof SUBJECT_GROUPS)[number];

export const SUBJECT_GROUP_COLORS: Record<
  SubjectGroup,
  { star: string; swatch: string }
> = {
  Math: { star: "fill-amber-400 text-amber-600", swatch: "bg-amber-400" },
  English: { star: "fill-red-600 text-red-700", swatch: "bg-red-600" },
  "Social Studies": {
    star: "fill-green-600 text-green-700",
    swatch: "bg-green-600",
  },
  Science: { star: "fill-blue-600 text-blue-700", swatch: "bg-blue-600" },
  "Word Building": {
    star: "fill-purple-600 text-purple-700",
    swatch: "bg-purple-600",
  },
  Electives: { star: "fill-slate-300 text-slate-500", swatch: "bg-slate-300" },
};

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
// "Sci" covers abbreviations like "Physical Sci LabsSet". Lab and lab-set
// subjects (Biology Labs, Physics Lab) are science unless excluded above.
const SCIENCE_PATTERN =
  /\b(science|sci|biology|chemistry|physics|anatomy)\b|\blabs?(set)?\b/i;
// Business Math, Trigonometry, Pre-Algebra, Calculus, Statistics are math.
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

/** Null for excluded store categories. Everything else maps to one group. */
export function subjectGroup(name: string): SubjectGroup | null {
  const trimmed = name.trim();
  if (!trimmed || isExcludedStoreCategory(trimmed)) return null;
  if (WORD_BUILDING_PATTERN.test(trimmed)) return "Word Building";
  if (ENGLISH_SUBJECT_PATTERN.test(trimmed)) return "English";
  if (SOCIAL_STUDIES_PATTERN.test(trimmed)) return "Social Studies";
  if (SCIENCE_PATTERN.test(trimmed)) return "Science";
  if (MATH_PATTERN.test(trimmed)) return "Math";
  return "Electives";
}

export function isEnglishSubjectName(name: string): boolean {
  return subjectGroup(name) === "English";
}

export interface PickListPace {
  subject_id: string;
  subject_name: string;
  pace_number: number;
  item_id?: string | null;
}

export interface PickListCompanionItem {
  id: string;
  subject_id: string | null;
  subject_name: string;
  item_type: string;
  range_start: number | null;
  range_end: number | null;
}

/** Keys match the same subject. English novels (item_type other) also match
 * other English-group subjects, so an English novel covers English I-IV.
 * One row per item. pace_slot_id is left null by the caller.
 */
export function matchingPickListCompanions<T extends PickListCompanionItem>(
  paces: PickListPace[],
  catalog: T[],
): Array<T & { pace_number: number }> {
  const paceItemIds = new Set(
    paces.map((pace) => pace.item_id).filter((id): id is string => !!id),
  );
  const matches = new Map<string, T & { pace_number: number }>();
  for (const pace of paces) {
    for (const item of catalog) {
      if (paceItemIds.has(item.id)) continue;
      if (item.range_start == null || item.range_end == null) continue;
      if (pace.pace_number < item.range_start || pace.pace_number > item.range_end) {
        continue;
      }
      const sameSubject = item.subject_id != null && item.subject_id === pace.subject_id;
      const key = item.item_type === "key" && sameSubject;
      const novel =
        item.item_type === "other" &&
        isEnglishSubjectName(item.subject_name) &&
        (sameSubject || isEnglishSubjectName(pace.subject_name));
      if (!key && !novel) continue;
      const existing = matches.get(item.id);
      if (existing) {
        existing.pace_number = Math.min(existing.pace_number, pace.pace_number);
        continue;
      }
      matches.set(item.id, { ...item, pace_number: pace.pace_number });
    }
  }
  return [...matches.values()];
}
