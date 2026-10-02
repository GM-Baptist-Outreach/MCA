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
    compareSubjectNames(a[0].subject_name, b[0].subject_name),
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
// Report-card quarters.
// Until a parent sets a school start date, quarters are calendar months:
// Q1 Jul-Sep, Q2 Oct-Dec, Q3 Jan-Mar, Q4 Apr-Jun.
// July belongs to the school year that currentSchoolYear() already starts.
// Once a start date is set, each quarter is 9 weeks (63 days) from that date.
// Completions before the start date count as Q1. Completions after week 36
// count as Q4.
// ---------------------------------------------------------------------------

export const QUARTER_LENGTH_DAYS = 63;

export const REPORT_QUARTERS = [
  { key: "Q1", label: "Q1", months: [7, 8, 9], yearOffset: 0 },
  { key: "Q2", label: "Q2", months: [10, 11, 12], yearOffset: 0 },
  { key: "Q3", label: "Q3", months: [1, 2, 3], yearOffset: 1 },
  { key: "Q4", label: "Q4", months: [4, 5, 6], yearOffset: 1 },
] as const;

export type ReportQuarterKey = (typeof REPORT_QUARTERS)[number]["key"];

export type QuarterAverages = Record<ReportQuarterKey, number | null>;

const CALENDAR_QUARTER_SPAN: Record<ReportQuarterKey, string> = {
  Q1: "Jul-Sep",
  Q2: "Oct-Dec",
  Q3: "Jan-Mar",
  Q4: "Apr-Jun",
};

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

export function isDateInSchoolYear(
  iso: string | null | undefined,
  schoolYear: string,
): boolean {
  if (!iso) return false;
  const bounds = schoolYearDateBounds(schoolYear);
  if (!bounds) return false;
  const day = iso.slice(0, 10);
  return day >= bounds.start && day <= bounds.end;
}

function utcDay(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
}

/** Q1 starts on startDate. Each quarter is 63 days, end exclusive. */
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

export function formatMonthDay(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function formatQuarterRangeLabel(range: QuarterRange): string {
  const lastDay = addDays(range.end, -1);
  return `${range.key} · ${formatMonthDay(range.start)}-${formatMonthDay(lastDay)}`;
}

export function calendarQuarterHeader(key: ReportQuarterKey): string {
  return `${key} · ${CALENDAR_QUARTER_SPAN[key]}`;
}

export function quarterColumnHeaders(
  startDate: string | null | undefined,
): Array<{ key: ReportQuarterKey; label: string }> {
  if (startDate) {
    return quarterRanges(startDate).map((range) => ({
      key: range.key,
      label: formatQuarterRangeLabel(range),
    }));
  }
  return REPORT_QUARTERS.map((quarter) => ({
    key: quarter.key,
    label: calendarQuarterHeader(quarter.key),
  }));
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

/** ACE prints 1000 above MCA's internal pace number. 37 is shown as 1037. */
export function toInternalPaceNumber(paceNumber: number): number {
  if (!Number.isFinite(paceNumber)) return paceNumber;
  return paceNumber > 1000 ? paceNumber - 1000 : paceNumber;
}

export function toAcePaceNumber(paceNumber: number): number {
  return toInternalPaceNumber(paceNumber) + 1000;
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
  "Word Building",
  "Science",
  "Social Studies",
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

/** Courses whose heading on David's course list doesn't follow from the name
 * patterns below (e.g. "NT Church History" is a Bible course, not Social
 * Studies). Checked before the patterns.
 */
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

/** Null for excluded store categories. Everything else maps to one group. */
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

/** Answer keys for the same subject only. Resource books are not pick-list
 * lines; matchingResourceBooks records those for the parent notice instead.
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
      if (item.item_type !== "key") continue;
      if (item.subject_id == null || item.subject_id !== pace.subject_id) continue;
      if (item.range_start == null || item.range_end == null) continue;
      if (pace.pace_number < item.range_start || pace.pace_number > item.range_end) {
        continue;
      }
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

/** Resource books whose range covers a PACE of the same subject.
 * English I-IV novels stay on English I-IV. They do not attach to elementary English.
 */
export function matchingResourceBooks<T extends PickListCompanionItem>(
  paces: PickListPace[],
  catalog: T[],
): T[] {
  const seen = new Set<string>();
  const matches: T[] = [];
  for (const pace of paces) {
    for (const item of catalog) {
      if (seen.has(item.id)) continue;
      if (item.item_type !== "other") continue;
      if (item.subject_id == null || item.subject_id !== pace.subject_id) continue;
      if (item.range_start == null || item.range_end == null) continue;
      if (pace.pace_number < item.range_start || pace.pace_number > item.range_end) {
        continue;
      }
      seen.add(item.id);
      matches.push(item);
    }
  }
  return matches;
}

// ---------------------------------------------------------------------------
// Display names and David's subject order.
// Group order is Math, English, Word Building, Science, Social Studies,
// Electives. Inside a core group the elementary subject comes first, then
// high-school courses by level. Electives sort alphabetically by display name.
// ---------------------------------------------------------------------------

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

export function compareSubjects(
  a: { name: string; sort_order?: number | null },
  b: { name: string; sort_order?: number | null },
): number {
  const aOrder = a.sort_order;
  const bOrder = b.sort_order;
  if (aOrder != null && bOrder != null && aOrder !== bOrder) return aOrder - bOrder;
  if (aOrder != null && bOrder == null) return -1;
  if (aOrder == null && bOrder != null) return 1;
  return compareSubjectNames(a.name, b.name);
}

/** Elementary courses sold by the levels that actually have PACEs. */
export const ELEMENTARY_LEVEL_COURSES = [
  "Math",
  "English",
  "Word Building",
  "Science",
  "Social Studies",
  "Animal Science",
  "Bible Reading",
  "Lit & Creative Writing",
  "Basic Literature",
] as const;

/** Late catalog corrections (marker MCA_LATE_CATALOG): Social Studies level 7
 * is SS 1073-1078 plus Illinois History 1-6, stored as Social Studies PACEs
 * 79-84 so every level-based path includes them. Basic Lit 7 / 8 are single
 * PACEs (73 / 85) under "Basic Literature".
 */
export const MCA_LATE_CATALOG_MARKER = "MCA_LATE_CATALOG";
export const ILLINOIS_HISTORY_PACES = { start: 79, end: 84 } as const;

export function isIllinoisHistoryPace(subjectName: string, paceNumber: number): boolean {
  const pace = toInternalPaceNumber(paceNumber);
  return (
    subjectName === "Social Studies" &&
    pace >= ILLINOIS_HISTORY_PACES.start &&
    pace <= ILLINOIS_HISTORY_PACES.end
  );
}

/** PACE label for grids and pick lists: "1073", or "IL 1" for Illinois History. */
export function paceLabel(subjectName: string, paceNumber: number): string {
  if (isIllinoisHistoryPace(subjectName, paceNumber)) {
    return `IL ${toInternalPaceNumber(paceNumber) - ILLINOIS_HISTORY_PACES.start + 1}`;
  }
  return String(toAcePaceNumber(paceNumber));
}

export interface CourseCatalogItem {
  id: string;
  subject_id: string;
  subject_name: string;
  item_type: string;
  pace_number: number | null;
  sales_price: number;
  short_description?: string | null;
}

export interface CoursePaceItem {
  id: string;
  subjectId: string;
  paceNumber: number;
  price: number;
}

export interface CourseLevelOption {
  level: number;
  start: number;
  end: number;
  aceStart: number;
  aceEnd: number;
  items: CoursePaceItem[];
  total: number;
}

export interface CourseOption {
  key: string;
  subjectIds: string[];
  subjectNames: string[];
  displayName: string;
  group: SubjectGroup | "Other";
  kind: "level" | "course";
  levels: CourseLevelOption[];
  items: CoursePaceItem[];
  paceStart: number | null;
  paceEnd: number | null;
  total: number;
}

function sellablePaces(items: CourseCatalogItem[]): CourseCatalogItem[] {
  return items.filter(
    (item) =>
      item.pace_number != null &&
      (item.item_type === "pace" || item.item_type === "other"),
  );
}

function toPaceItems(items: CourseCatalogItem[]): CoursePaceItem[] {
  return sellablePaces(items)
    .map((item) => ({
      id: item.id,
      subjectId: item.subject_id,
      paceNumber: item.pace_number as number,
      price: item.sales_price,
    }))
    .sort((a, b) => a.paceNumber - b.paceNumber);
}

function levelOption(level: number, items: CoursePaceItem[]): CourseLevelOption {
  const start = Math.min(...items.map((item) => item.paceNumber));
  const end = Math.max(...items.map((item) => item.paceNumber));
  return {
    level,
    start,
    end,
    aceStart: toAcePaceNumber(start),
    aceEnd: toAcePaceNumber(end),
    items,
    total: items.reduce((sum, item) => sum + item.price, 0),
  };
}

function courseFromItems(
  key: string,
  subjectIds: string[],
  subjectNames: string[],
  displayName: string,
  items: CourseCatalogItem[],
  kind: "level" | "course",
): CourseOption {
  const paces = toPaceItems(items);
  const group = subjectGroup(subjectNames[0] ?? displayName) ?? "Other";
  const levels =
    kind === "level"
      ? [...new Map(
          paces.map((item) => [Math.ceil(item.paceNumber / PACES_PER_LEVEL), item]),
        ).keys()]
          .sort((a, b) => a - b)
          .map((level) =>
            levelOption(
              level,
              paces.filter(
                (item) => Math.ceil(item.paceNumber / PACES_PER_LEVEL) === level,
              ),
            ),
          )
      : [];
  return {
    key,
    subjectIds,
    subjectNames,
    displayName,
    group,
    kind,
    levels,
    items: paces,
    paceStart: paces.length ? paces[0].paceNumber : null,
    paceEnd: paces.length ? paces[paces.length - 1].paceNumber : null,
    total: paces.reduce((sum, item) => sum + item.price, 0),
  };
}

export function isElementaryLevelCourse(
  name: string,
  paceNumbers: number[],
): boolean {
  return (
    (ELEMENTARY_LEVEL_COURSES as readonly string[]).includes(name) &&
    paceNumbers.length > 0 &&
    paceNumbers.every((pace) => pace <= 96)
  );
}

export function courseOptionLabel(option: CourseOption, level?: CourseLevelOption): string {
  if (option.kind === "level" && level) {
    const subjectName = option.subjectNames[0] ?? "";
    const regular = level.items.filter((item) => !isIllinoisHistoryPace(subjectName, item.paceNumber));
    const illinois = level.items.length - regular.length;
    const first = regular.length ? toAcePaceNumber(regular[0].paceNumber) : level.aceStart;
    const last = regular.length ? toAcePaceNumber(regular[regular.length - 1].paceNumber) : level.aceEnd;
    const range = first === last ? `PACE ${first}` : `PACEs ${first}-${last}`;
    const extra = illinois > 0 ? ` + Illinois History 1-${illinois}` : "";
    return `Level ${level.level} · ${range}${extra} · $${level.total.toFixed(2)}`;
  }
  if (option.paceStart == null || option.paceEnd == null) {
    return `${option.displayName} · $${option.total.toFixed(2)}`;
  }
  const aceStart = toAcePaceNumber(option.paceStart);
  const aceEnd = toAcePaceNumber(option.paceEnd);
  const range = aceStart === aceEnd ? `${aceStart}` : `${aceStart}-${aceEnd}`;
  return `${option.displayName} · PACEs ${range} · $${option.total.toFixed(2)}`;
}

/** Elementary courses keep only levels that have PACEs. Everything else,
 * including books numbered 1-12, is one course. Civics and Economics ship
 * together. World History is whatever PACEs the caller still has active.
 */
export function buildCourseOptions(items: CourseCatalogItem[]): {
  elementary: CourseOption[];
  courses: CourseOption[];
} {
  const bySubject = new Map<string, { id: string; name: string; items: CourseCatalogItem[] }>();
  for (const item of items) {
    if (!item.subject_id || item.pace_number == null) continue;
    if (item.item_type !== "pace" && item.item_type !== "other") continue;
    const entry = bySubject.get(item.subject_id) ?? {
      id: item.subject_id,
      name: item.subject_name,
      items: [],
    };
    entry.items.push(item);
    bySubject.set(item.subject_id, entry);
  }

  const elementary: CourseOption[] = [];
  const courses: CourseOption[] = [];
  const consumed = new Set<string>();

  const civics = [...bySubject.values()].find((subject) => subject.name === "Civics");
  const economics = [...bySubject.values()].find((subject) => subject.name === "Economics");
  if (civics || economics) {
    const bundled = [...(civics?.items ?? []), ...(economics?.items ?? [])];
    const ids = [civics?.id, economics?.id].filter((id): id is string => !!id);
    const names = [civics?.name, economics?.name].filter((name): name is string => !!name);
    courses.push(
      courseFromItems("civics-economics", ids, names, "Civics and Economics", bundled, "course"),
    );
    for (const id of ids) consumed.add(id);
  }

  for (const subject of bySubject.values()) {
    if (consumed.has(subject.id)) continue;
    const paceItems = subject.items.filter((item) => item.item_type === "pace");
    const bookItems = subject.items.filter(
      (item) => item.item_type === "other" && item.pace_number != null,
    );
    const paceNumbers = paceItems.map((item) => item.pace_number as number);
    if (isElementaryLevelCourse(subject.name, paceNumbers)) {
      elementary.push(
        courseFromItems(
          subject.id,
          [subject.id],
          [subject.name],
          subjectDisplayName(subject.name),
          paceItems,
          "level",
        ),
      );
    } else if (paceItems.length > 0 || bookItems.length > 0) {
      courses.push(
        courseFromItems(
          subject.id,
          [subject.id],
          [subject.name],
          subjectDisplayName(subject.name),
          paceItems.length > 0 ? paceItems : bookItems,
          "course",
        ),
      );
    }
  }

  elementary.sort(
    (a, b) =>
      ELEMENTARY_LEVEL_COURSES.indexOf(
        a.subjectNames[0] as (typeof ELEMENTARY_LEVEL_COURSES)[number],
      ) -
      ELEMENTARY_LEVEL_COURSES.indexOf(
        b.subjectNames[0] as (typeof ELEMENTARY_LEVEL_COURSES)[number],
      ),
  );
  courses.sort((a, b) =>
    compareSubjectNames(a.subjectNames[0] ?? a.displayName, b.subjectNames[0] ?? b.displayName),
  );
  return { elementary, courses };
}

// ---------------------------------------------------------------------------
// Round 8: graduation credit tracker and report-card semesters.
// Marker: MCA_R8_GRAD_TRACKER. Also used by the student-records-pdf edge
// function through a copy in supabase/functions/_shared/loggedCourses.ts
// (a test keeps the two files identical).
// ---------------------------------------------------------------------------

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

/** Completed = transfer credit or a final average logged (same as the projection page). */
export function isCompletionDone(c: GradCompletionLike): boolean {
  return c.is_transfer === true || (c.final_average != null && c.final_average !== "");
}

/**
 * Credits earned / in progress / still needed toward graduation.
 * Required total = the larger of the school setting (25) and the requirement list.
 * Credits that don't match a required course (or go past it) count as electives.
 */
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

/** Semester 1 = Q1+Q2, semester 2 = Q3+Q4, using the report-card quarters above. */
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

/** Default period for "today": semester 1 from July through December. */
export function currentReportPeriod(date = new Date()): ReportPeriod {
  const month = date.getMonth() + 1;
  return month >= 7 ? "S1" : "S2";
}
