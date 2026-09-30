import { describe, expect, it } from "vitest";
import {
  average,
  companionLabel,
  currentSchoolYear,
  isWithinShipWindow,
  matchingCompanions,
  nextQuarterPaces,
  oklahomaProductTaxCents,
  paceRangeForLevel,
  priorIssuedMissingScores,
  reportLetter,
  selectPacesForLevel,
  shouldApplyOklahomaStoreTax,
  suggestedFixedShipDates,
  type PaceSlotLike,
} from "@/lib/loggedCourses";

function slot(partial: Partial<PaceSlotLike> & Pick<PaceSlotLike, "id" | "subject_id">): PaceSlotLike {
  return {
    subject_name: partial.subject_name ?? partial.subject_id,
    slot_index: partial.slot_index ?? 1,
    pace_number: partial.pace_number ?? 1,
    status: partial.status ?? "prescribed",
    score: partial.score ?? null,
    issued_at: partial.issued_at ?? null,
    ...partial,
  };
}

describe("full level pace ranges", () => {
  it("maps level 7 to PACEs 73-84", () => {
    expect(paceRangeForLevel(7)).toEqual({ start: 73, end: 84 });
  });

  it("maps level 1 and high-school level 9 onto internal pace numbers", () => {
    expect(paceRangeForLevel(1)).toEqual({ start: 1, end: 12 });
    expect(paceRangeForLevel(9)).toEqual({ start: 97, end: 108 });
  });

  it("prefers the catalog row whose grade_level matches the level", () => {
    const selected = selectPacesForLevel(
      [
        { id: "a", subject_id: "sci", pace_number: 73, grade_level: null },
        { id: "b", subject_id: "sci", pace_number: 73, grade_level: 7 },
        { id: "c", subject_id: "sci", pace_number: 74, grade_level: 7 },
        { id: "other", subject_id: "math", pace_number: 73, grade_level: 7 },
      ],
      "sci",
      7,
    );
    expect(selected.map((item) => item.id)).toEqual(["b", "c"]);
  });
});

describe("resource companions", () => {
  const catalog = [
    {
      id: "key",
      subject_id: "eng1",
      item_type: "key",
      range_start: 97,
      range_end: 108,
    },
    {
      id: "book",
      subject_id: "eng1",
      item_type: "other",
      range_start: 100,
      range_end: 102,
    },
    {
      id: "dvd",
      subject_id: "eng1",
      item_type: "dvd",
      range_start: 100,
      range_end: 102,
    },
  ];

  it("returns the answer key and the required resource book, not the first match only", () => {
    const matches = matchingCompanions(
      [{ subject_id: "eng1", pace_number: 101 }],
      catalog,
    );
    expect(matches.map((item) => item.id)).toEqual(["key", "book"]);
    expect(companionLabel("key")).toBe("Answer key");
    expect(companionLabel("book")).toBe("Required resource book");
  });
});

describe("Oklahoma store tax", () => {
  it("taxes Oklahoma shipments and Newcastle pickup, not out-of-state shipping", () => {
    expect(
      shouldApplyOklahomaStoreTax({ fulfillment: "ship", addressState: "OK" }),
    ).toBe(true);
    expect(
      shouldApplyOklahomaStoreTax({
        fulfillment: "ship",
        addressState: "Oklahoma",
      }),
    ).toBe(true);
    expect(
      shouldApplyOklahomaStoreTax({ fulfillment: "ship", addressState: "TX" }),
    ).toBe(false);
    expect(shouldApplyOklahomaStoreTax({ fulfillment: "pickup" })).toBe(true);
    expect(
      shouldApplyOklahomaStoreTax({ fulfillment: "pickup", addressState: "" }),
    ).toBe(true);
    expect(
      shouldApplyOklahomaStoreTax({ fulfillment: "pickup", addressState: "TX" }),
    ).toBe(true);
  });

  it("taxes 10% of the product subtotal and ignores a shipping amount", () => {
    const productCents = 3500;
    const shippingCents = 800;
    expect(oklahomaProductTaxCents(productCents)).toBe(350);
    expect(oklahomaProductTaxCents(productCents + shippingCents)).not.toBe(
      oklahomaProductTaxCents(productCents),
    );
  });
});

describe("quarter pick lists", () => {
  const slots = [
    slot({ id: "m1", subject_id: "math", subject_name: "Math", slot_index: 1, status: "issued", score: 90, issued_at: "2026-08-01" }),
    slot({ id: "m2", subject_id: "math", subject_name: "Math", slot_index: 2, status: "prescribed", pace_number: 2 }),
    slot({ id: "m3", subject_id: "math", subject_name: "Math", slot_index: 3, status: "prescribed", pace_number: 3 }),
    slot({ id: "m4", subject_id: "math", subject_name: "Math", slot_index: 4, status: "prescribed", pace_number: 4 }),
    slot({ id: "m5", subject_id: "math", subject_name: "Math", slot_index: 5, status: "prescribed", pace_number: 5 }),
    slot({ id: "s1", subject_id: "sci", subject_name: "Science", slot_index: 1, status: "in_stock", pace_number: 73 }),
    slot({ id: "s2", subject_id: "sci", subject_name: "Science", slot_index: 2, status: "ordered", pace_number: 74 }),
    slot({ id: "s3", subject_id: "sci", subject_name: "Science", slot_index: 3, status: "prescribed", pace_number: 75 }),
    slot({ id: "s4", subject_id: "sci", subject_name: "Science", slot_index: 4, status: "prescribed", pace_number: 76 }),
  ];

  it("takes the next 3 unissued PACEs per subject, Math before Science", () => {
    expect(nextQuarterPaces(slots).map((s) => s.id)).toEqual([
      "m2",
      "m3",
      "m4",
      "s1",
      "s2",
      "s3",
    ]);
  });

  it("does not pause before 6 PACEs have been issued", () => {
    expect(priorIssuedMissingScores(slots)).toEqual([]);
  });

  it("uses Q2–Q4 for 2025-26 and leaves Q1 blank", () => {
    expect(suggestedFixedShipDates("2025-26")).toEqual({
      q1: "",
      q2: "2025-10-26",
      q3: "2026-01-11",
      q4: "2026-03-08",
    });
  });

  it("pauses when any of the 6 most recently issued PACEs across subjects has no score", () => {
    const issued = Array.from({ length: 6 }, (_, i) =>
      slot({
        id: `i${i}`,
        subject_id: "math",
        slot_index: i + 1,
        status: i === 5 ? "issued" : "passed",
        score: i === 5 ? null : 88,
        issued_at: `2026-0${i + 1}-01`,
      }),
    );
    expect(priorIssuedMissingScores(issued).map((s) => s.id)).toEqual(["i5"]);
  });

  it("ignores an unscored PACE older than the latest 6, even in another subject", () => {
    const issued = [
      slot({
        id: "old",
        subject_id: "math",
        subject_name: "Math",
        slot_index: 1,
        status: "issued",
        score: null,
        issued_at: "2026-01-01",
      }),
      ...Array.from({ length: 5 }, (_, i) =>
        slot({
          id: `scored-${i}`,
          subject_id: i % 2 === 0 ? "math" : "sci",
          subject_name: i % 2 === 0 ? "Math" : "Science",
          slot_index: i + 2,
          status: "passed",
          score: 90,
          issued_at: `2026-03-0${i + 1}`,
        }),
      ),
      slot({
        id: "newest",
        subject_id: "sci",
        subject_name: "Science",
        slot_index: 8,
        status: "issued",
        score: null,
        issued_at: "2026-06-01",
      }),
    ];
    expect(priorIssuedMissingScores(issued).map((slot) => slot.id)).toEqual([
      "newest",
    ]);
  });

  it("treats a ship date one week out as due", () => {
    expect(isWithinShipWindow("2026-10-19", "2026-10-26")).toBe(true);
    expect(isWithinShipWindow("2026-10-18", "2026-10-26")).toBe(false);
  });
});

describe("supervisor report letters", () => {
  it("uses P/F from the score and I/S/O from ops status", () => {
    expect(reportLetter("issued", 92)).toBe("P");
    expect(reportLetter("issued", 70)).toBe("F");
    expect(reportLetter("issued", null)).toBe("I");
    expect(reportLetter("in_stock", null)).toBe("S");
    expect(reportLetter("ordered", null)).toBe("O");
    expect(reportLetter("prescribed", null)).toBe("");
  });

  it("averages only numeric scores", () => {
    expect(average([80, 100, null])).toBe(90);
    expect(average([null])).toBeNull();
  });

  it("names the 2026-27 school year in September 2026", () => {
    expect(currentSchoolYear(new Date("2026-09-28T12:00:00Z"))).toBe("2026-27");
  });
});
