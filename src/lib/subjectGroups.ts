/** Subject groups for PACE Status, the star chart, and English-novel pick lines.
 * Store categories in ELECTIVE_EXCLUSIONS are not electives.
 * ENGLISH_SUBJECT_PATTERN is mirrored in the pick-list SQL with Postgres
 * word boundaries (\m \M) in place of \b.
 */

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
  /\b(social studies|history|government|economics|geography|civics)\b/i;
const SCIENCE_PATTERN = /\b(science|biology|chemistry|physics)\b/i;
const MATH_PATTERN = /\b(math|algebra|geometry)\b/i;

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
