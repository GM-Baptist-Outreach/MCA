import { describe, expect, it } from "vitest";
import {
  ELECTIVE_EXCLUSIONS,
  isExcludedStoreCategory,
  matchingPickListCompanions,
  quarterForCompletedAt,
  REPORT_QUARTERS,
  subjectGroup,
  SUBJECT_GROUPS,
  trackedStock,
} from "@/lib/loggedCourses";

describe("subject groups", () => {
  it("offers the six portal groups in order", () => {
    expect([...SUBJECT_GROUPS]).toEqual([
      "Math",
      "English",
      "Social Studies",
      "Science",
      "Word Building",
      "Electives",
    ]);
  });

  it("maps core families, including English I-IV and the etc. subjects", () => {
    expect(subjectGroup("Math")).toBe("Math");
    expect(subjectGroup("Algebra I")).toBe("Math");
    expect(subjectGroup("Geometry")).toBe("Math");
    expect(subjectGroup("Business Math")).toBe("Math");
    expect(subjectGroup("English")).toBe("English");
    expect(subjectGroup("English I")).toBe("English");
    expect(subjectGroup("English II")).toBe("English");
    expect(subjectGroup("English III")).toBe("English");
    expect(subjectGroup("English IV")).toBe("English");
    expect(subjectGroup("Lit & Creative Writing")).toBe("English");
    expect(subjectGroup("Science")).toBe("Science");
    expect(subjectGroup("Biology")).toBe("Science");
    expect(subjectGroup("Chemistry")).toBe("Science");
    expect(subjectGroup("Physics")).toBe("Science");
    expect(subjectGroup("Physical Science")).toBe("Science");
    expect(subjectGroup("Social Studies")).toBe("Social Studies");
    expect(subjectGroup("World History")).toBe("Social Studies");
    expect(subjectGroup("Government")).toBe("Social Studies");
    expect(subjectGroup("Economics")).toBe("Social Studies");
    expect(subjectGroup("Geography")).toBe("Social Studies");
    expect(subjectGroup("Civics")).toBe("Social Studies");
    expect(subjectGroup("Word Building")).toBe("Word Building");
    expect(subjectGroup("Spanish")).toBe("Electives");
    expect(subjectGroup("Art")).toBe("Electives");
  });

  it("maps the MCA catalog edge cases to the right core group", () => {
    expect(subjectGroup("Trigonometry")).toBe("Math");
    expect(subjectGroup("Business Math")).toBe("Math");
    expect(subjectGroup("Constitution")).toBe("Social Studies");
    expect(subjectGroup("Physical Sci LabsSet")).toBe("Science");
    expect(subjectGroup("Biology Labs")).toBe("Science");
    expect(subjectGroup("Chemistry Labs")).toBe("Science");
    expect(subjectGroup("Physics Lab")).toBe("Science");
    expect(subjectGroup("Math Diagnostic Test")).toBeNull();
    expect(subjectGroup("Business & Career Electives")).toBe("Electives");
    expect(subjectGroup("Spanish Act Pac")).toBe("Electives");
  });

  it("excludes store categories from electives", () => {
    for (const name of ELECTIVE_EXCLUSIONS) {
      expect(isExcludedStoreCategory(name)).toBe(true);
      expect(subjectGroup(name)).toBeNull();
    }
    expect(subjectGroup("Science Lab Set")).toBeNull();
    expect(subjectGroup("Biology Lab Sets")).toBeNull();
    expect(subjectGroup("Honor Roll Cert")).toBeNull();
    expect(subjectGroup("Math")).not.toBeNull();
  });
});

describe("report card quarters", () => {
  it("keeps Q1 Aug-Oct, Q2 Nov-Dec, Q3 Jan-Mar, Q4 Apr-Jul", () => {
    expect(REPORT_QUARTERS.map((quarter) => [quarter.key, ...quarter.months])).toEqual([
      ["Q1", 8, 9, 10],
      ["Q2", 11, 12],
      ["Q3", 1, 2, 3],
      ["Q4", 4, 5, 6, 7],
    ]);
  });

  it("places 2026-27 dates from August 2026 through July 2027", () => {
    expect(quarterForCompletedAt("2026-08-01", "2026-27")).toBe("Q1");
    expect(quarterForCompletedAt("2026-10-31", "2026-27")).toBe("Q1");
    expect(quarterForCompletedAt("2026-11-01", "2026-27")).toBe("Q2");
    expect(quarterForCompletedAt("2026-12-15", "2026-27")).toBe("Q2");
    expect(quarterForCompletedAt("2027-01-05", "2026-27")).toBe("Q3");
    expect(quarterForCompletedAt("2027-03-31", "2026-27")).toBe("Q3");
    expect(quarterForCompletedAt("2027-04-01", "2026-27")).toBe("Q4");
    expect(quarterForCompletedAt("2027-07-31", "2026-27")).toBe("Q4");
    expect(quarterForCompletedAt("2026-07-31", "2026-27")).toBeNull();
    expect(quarterForCompletedAt("2027-08-01", "2026-27")).toBeNull();
    expect(quarterForCompletedAt(null, "2026-27")).toBeNull();
  });
});

describe("pick list companions and stock", () => {
  const paces = [
    {
      subject_id: "eng-i",
      subject_name: "English I",
      pace_number: 101,
      item_id: "pace-101",
    },
    {
      subject_id: "eng-i",
      subject_name: "English I",
      pace_number: 102,
      item_id: "pace-102",
    },
  ];

  it("adds same-subject keys and English-group novels once", () => {
    const matches = matchingPickListCompanions(paces, [
      {
        id: "key-eng-i",
        subject_id: "eng-i",
        subject_name: "English I",
        item_type: "key",
        range_start: 97,
        range_end: 108,
      },
      {
        id: "novel-english",
        subject_id: "eng",
        subject_name: "English",
        item_type: "other",
        range_start: 100,
        range_end: 108,
      },
      {
        id: "key-english",
        subject_id: "eng",
        subject_name: "English",
        item_type: "key",
        range_start: 97,
        range_end: 108,
      },
      {
        id: "math-other",
        subject_id: "math",
        subject_name: "Math",
        item_type: "other",
        range_start: 100,
        range_end: 108,
      },
      {
        id: "dvd",
        subject_id: "eng-i",
        subject_name: "English I",
        item_type: "dvd",
        range_start: 97,
        range_end: 108,
      },
      {
        id: "pace-101",
        subject_id: "eng-i",
        subject_name: "English I",
        item_type: "key",
        range_start: 101,
        range_end: 101,
      },
    ]);

    expect(matches.map((item) => item.id)).toEqual(["key-eng-i", "novel-english"]);
    expect(matches.find((item) => item.id === "novel-english")?.pace_number).toBe(101);
  });

  it("keeps a tracked stock of 0 and does not mark untracked items backordered", () => {
    expect(trackedStock(null)).toEqual({ quantityOnHand: null, backordered: false });
    expect(trackedStock(0)).toEqual({ quantityOnHand: 0, backordered: true });
    expect(trackedStock(-2)).toEqual({ quantityOnHand: -2, backordered: true });
    expect(trackedStock(4)).toEqual({ quantityOnHand: 4, backordered: false });
  });
});
