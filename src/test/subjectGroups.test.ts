import { describe, expect, it } from "vitest";
import {
  buildCourseOptions,
  compareSubjectNames,
  ELECTIVE_EXCLUSIONS,
  isExcludedStoreCategory,
  matchingPickListCompanions,
  matchingResourceBooks,
  quarterForCompletedAt,
  quarterForDate,
  quarterRanges,
  REPORT_QUARTERS,
  subjectDisplayName,
  subjectGroup,
  SUBJECT_GROUPS,
  toAcePaceNumber,
  toInternalPaceNumber,
  trackedStock,
} from "@/lib/loggedCourses";

describe("subject groups", () => {
  it("offers the six portal groups in order", () => {
    expect([...SUBJECT_GROUPS]).toEqual([
      "Math",
      "English",
      "Word Building",
      "Science",
      "Social Studies",
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
  it("uses calendar quarters only until a start date is set", () => {
    expect(REPORT_QUARTERS.map((quarter) => [quarter.key, ...quarter.months])).toEqual([
      ["Q1", 7, 8, 9],
      ["Q2", 10, 11, 12],
      ["Q3", 1, 2, 3],
      ["Q4", 4, 5, 6],
    ]);
  });

  it("places 2026-27 dates from July 2026 through June 2027", () => {
    expect(quarterForCompletedAt("2026-07-01", "2026-27")).toBe("Q1");
    expect(quarterForCompletedAt("2026-09-30", "2026-27")).toBe("Q1");
    expect(quarterForCompletedAt("2026-10-01", "2026-27")).toBe("Q2");
    expect(quarterForCompletedAt("2026-12-15", "2026-27")).toBe("Q2");
    expect(quarterForCompletedAt("2027-01-05", "2026-27")).toBe("Q3");
    expect(quarterForCompletedAt("2027-03-31", "2026-27")).toBe("Q3");
    expect(quarterForCompletedAt("2027-04-01", "2026-27")).toBe("Q4");
    expect(quarterForCompletedAt("2027-06-30", "2026-27")).toBe("Q4");
    expect(quarterForCompletedAt("2026-06-30", "2026-27")).toBeNull();
    expect(quarterForCompletedAt("2027-07-01", "2026-27")).toBeNull();
    expect(quarterForCompletedAt(null, "2026-27")).toBeNull();
  });

  it("counts 9 weeks from the start date and folds the edges into Q1 and Q4", () => {
    const ranges = quarterRanges("2026-08-18");
    expect(ranges.map((range) => [range.key, range.start, range.end])).toEqual([
      ["Q1", "2026-08-18", "2026-10-20"],
      ["Q2", "2026-10-20", "2026-12-22"],
      ["Q3", "2026-12-22", "2027-02-23"],
      ["Q4", "2027-02-23", "2027-04-27"],
    ]);
    expect(quarterForDate("2026-08-01", "2026-08-18")).toBe("Q1");
    expect(quarterForDate("2026-08-18", "2026-08-18")).toBe("Q1");
    expect(quarterForDate("2026-10-19", "2026-08-18")).toBe("Q1");
    expect(quarterForDate("2026-10-20", "2026-08-18")).toBe("Q2");
    expect(quarterForDate("2027-04-27", "2026-08-18")).toBe("Q4");
    expect(quarterForCompletedAt("2026-07-01", "2026-27", "2026-08-18")).toBe("Q1");
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

  it("adds same-subject keys and does not add resource books", () => {
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

    expect(matches.map((item) => item.id)).toEqual(["key-eng-i"]);
  });

  it("notifies resource books only when the book subject matches the PACE", () => {
    const books = matchingResourceBooks(
      [
        {
          subject_id: "eng",
          subject_name: "English",
          pace_number: 52,
        },
        {
          subject_id: "lit",
          subject_name: "Lit & Creative Writing",
          pace_number: 25,
        },
      ],
      [
        {
          id: "heidi",
          subject_id: "lit",
          subject_name: "Lit & Creative Writing",
          item_type: "other",
          range_start: 25,
          range_end: 36,
        },
        {
          id: "english-novel",
          subject_id: "eng",
          subject_name: "English",
          item_type: "other",
          range_start: 49,
          range_end: 60,
        },
      ],
    );
    expect(books.map((item) => item.id)).toEqual(["english-novel", "heidi"]);
  });

  it("shows ACE numbers and sorts subjects in David's order", () => {
    expect(toInternalPaceNumber(1037)).toBe(37);
    expect(toInternalPaceNumber(37)).toBe(37);
    expect(toAcePaceNumber(37)).toBe(1037);
    expect(subjectDisplayName("Lit & Creative Writing")).toBe(
      "Literature and Creative Writing",
    );
    expect(
      ["Science", "Word Building", "Spanish", "Math", "English", "Social Studies"].sort(
        compareSubjectNames,
      ),
    ).toEqual([
      "Math",
      "English",
      "Word Building",
      "Science",
      "Social Studies",
      "Spanish",
    ]);
    expect(
      ["OT Survey", "NT Survey", "Bible Reading"].sort(compareSubjectNames).map(subjectDisplayName),
    ).toEqual([
      "Bible Reading",
      "New Testament Survey",
      "Old Testament Survey",
    ]);
  });

  it("sells elementary levels that exist and high school courses by name", () => {
    const catalog = [
      ...[1, 12, 13, 24].map((pace, index) => ({
        id: `math-${pace}`,
        subject_id: "math",
        subject_name: "Math",
        item_type: "pace",
        pace_number: pace,
        sales_price: 4,
      })),
      {
        id: "rr",
        subject_id: "math",
        subject_name: "Math",
        item_type: "other",
        pace_number: 1,
        sales_price: 2.7,
      },
      ...[109, 120].map((pace) => ({
        id: `eng2-${pace}`,
        subject_id: "eng2",
        subject_name: "English II",
        item_type: "pace",
        pace_number: pace,
        sales_price: 5,
      })),
      ...[133, 138].map((pace) => ({
        id: `civ-${pace}`,
        subject_id: "civ",
        subject_name: "Civics",
        item_type: "pace",
        pace_number: pace,
        sales_price: 5,
      })),
      ...[139, 144].map((pace) => ({
        id: `eco-${pace}`,
        subject_id: "eco",
        subject_name: "Economics",
        item_type: "pace",
        pace_number: pace,
        sales_price: 5,
      })),
      {
        id: "book-1",
        subject_id: "nut",
        subject_name: "Nutrition Science",
        item_type: "other",
        pace_number: 1,
        sales_price: 8,
      },
    ];
    const { elementary, courses } = buildCourseOptions(catalog);
    expect(elementary.map((course) => course.displayName)).toEqual(["Math"]);
    expect(elementary[0].levels.map((level) => level.level)).toEqual([1, 2]);
    expect(elementary[0].levels[0].aceStart).toBe(1001);
    expect(elementary[0].levels[0].aceEnd).toBe(1012);
    expect(elementary[0].levels[0].items.map((item) => item.id)).toEqual([
      "math-1",
      "math-12",
    ]);
    const english = courses.find((course) => course.displayName === "English II");
    expect(english?.kind).toBe("course");
    expect(english?.paceStart).toBe(109);
    expect(english?.paceEnd).toBe(120);
    const civics = courses.find((course) => course.displayName === "Civics and Economics");
    expect(civics?.subjectIds).toEqual(["civ", "eco"]);
    expect(civics?.paceStart).toBe(133);
    expect(civics?.paceEnd).toBe(144);
    expect(courses.find((course) => course.displayName === "Nutrition Science")?.items).toHaveLength(1);
  });

  it("keeps a tracked stock of 0 and does not mark untracked items backordered", () => {
    expect(trackedStock(null)).toEqual({ quantityOnHand: null, backordered: false });
    expect(trackedStock(0)).toEqual({ quantityOnHand: 0, backordered: true });
    expect(trackedStock(-2)).toEqual({ quantityOnHand: -2, backordered: true });
    expect(trackedStock(4)).toEqual({ quantityOnHand: 4, backordered: false });
  });
});

describe("course-list headings (round 2)", () => {
  it("puts list courses under the heading David's course list uses", () => {
    expect(subjectGroup("NT Church History")).toBe("Electives");
    expect(subjectGroup("Life of Christ")).toBe("Electives");
    expect(subjectGroup("Accounting")).toBe("Math");
    expect(subjectGroup("General Business")).toBe("Math");
    expect(subjectGroup("Health")).toBe("Science");
    expect(subjectGroup("Collectivism")).toBe("Social Studies");
    expect(subjectGroup("World History")).toBe("Social Studies");
  });
  it("orders core subjects first, then electives A-Z", () => {
    const names = ["Speech", "NT Church History", "Health", "Math", "Collectivism", "Accounting", "English", "Bible Reading", "Word Building", "Science", "Social Studies"];
    expect(names.slice().sort(compareSubjectNames)).toEqual([
      "Math", "Accounting", "English", "Word Building", "Science", "Health", "Social Studies", "Collectivism",
      "Bible Reading", "NT Church History", "Speech",
    ]);
  });
});
