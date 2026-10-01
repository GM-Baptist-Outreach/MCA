import { describe, expect, it } from "vitest";
import {
  buildCourseOptions,
  courseOptionLabel,
  paceLabel,
  type CourseCatalogItem,
} from "@/lib/loggedCourses";

const pace = (subject: string, n: number, price = 3.5): CourseCatalogItem => ({
  id: `${subject}-${n}`,
  subject_id: subject,
  subject_name: subject,
  item_type: "pace",
  pace_number: n,
  sales_price: price,
});

describe("late catalog corrections (MCA_LATE_CATALOG)", () => {
  const items = [
    ...Array.from({ length: 12 }, (_, i) => pace("Social Studies", 61 + i)),
    ...Array.from({ length: 12 }, (_, i) => pace("Social Studies", 73 + i)), // 73-78 + Illinois 79-84
    ...Array.from({ length: 12 }, (_, i) => pace("Social Studies", 85 + i)),
    pace("Basic Literature", 73, 3.3),
    pace("Basic Literature", 85, 3.3),
  ];
  const { elementary, courses } = buildCourseOptions(items);

  it("Social Studies level 7 includes Illinois History", () => {
    const ss = elementary.find((c) => c.key === "Social Studies")!;
    const l7 = ss.levels.find((l) => l.level === 7)!;
    expect(l7.items.map((i) => i.paceNumber)).toEqual([73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84]);
    expect(courseOptionLabel(ss, l7)).toBe("Level 7 · PACEs 1073-1078 + Illinois History 1-6 · $42.00");
    expect(courseOptionLabel(ss, ss.levels.find((l) => l.level === 8)!)).toMatch(/^Level 8 · PACEs 1085-1096/);
  });

  it("Basic Literature sells levels 7 and 8 as single PACEs", () => {
    const basic = elementary.find((c) => c.key === "Basic Literature")!;
    expect(basic.levels.map((l) => l.level)).toEqual([7, 8]);
    expect(courseOptionLabel(basic, basic.levels[0])).toBe("Level 7 · PACE 1073 · $3.30");
    expect(courses.find((c) => c.key === "Basic Literature")).toBeUndefined();
  });

  it("labels Illinois History boxes", () => {
    expect(paceLabel("Social Studies", 79)).toBe("IL 1");
    expect(paceLabel("Social Studies", 84)).toBe("IL 6");
    expect(paceLabel("Social Studies", 78)).toBe("1078");
    expect(paceLabel("Basic Literature", 73)).toBe("1073");
  });
});
