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
