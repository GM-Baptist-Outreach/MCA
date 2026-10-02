import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentReportPeriod,
  graduationProgress,
  isInReportPeriod,
} from "@/lib/loggedCourses";

// Round 8 (MCA_R8_GRAD_TRACKER). Repo-only test.

describe("graduationProgress", () => {
  const reqs = [
    { subject_name: "English I", credit_required: 1 },
    { subject_name: "Algebra I", credit_required: 1 },
    { subject_name: "Speech", credit_required: 0.5 },
  ];

  it("uses the 25-credit setting when the list is smaller and counts electives", () => {
    const p = graduationProgress(
      reqs,
      [
        { subject_name: "English I", credit_earned: 1, final_average: 93, is_transfer: false },
        { subject_name: "Algebra I", credit_earned: 1, final_average: null, is_transfer: false },
        { subject_name: "Art", credit_earned: 0.5, final_average: 90, is_transfer: false },
        { subject_name: "Biology", credit_earned: 1, final_average: null, is_transfer: true },
      ],
      25,
    );
    expect(p.totalRequired).toBe(25);
    expect(p.earned).toBe(2.5);
    expect(p.inProgress).toBe(1);
    expect(p.stillNeeded).toBe(21.5);
    expect(p.remainingBySubject).toEqual([{ subject: "Speech", credits: 0.5 }]);
    expect(p.electivesRequired).toBe(22.5);
    expect(p.electivesRemaining).toBe(21);
    expect(p.earnedPercent).toBeCloseTo(10);
    expect(p.inProgressPercent).toBeCloseTo(4);
  });

  it("uses the requirement list when it adds up to more than the setting", () => {
    const p = graduationProgress([{ subject_name: "A", credit_required: 30 }], [], 25);
    expect(p.totalRequired).toBe(30);
    expect(p.stillNeeded).toBe(30);
  });

  it("matches fulfills_requirement before the subject name", () => {
    const p = graduationProgress(reqs, [
      { subject_name: "Public Speaking", credit_earned: 0.5, final_average: 88, is_transfer: false, fulfills_requirement: "Speech" },
    ]);
    expect(p.remainingBySubject.find((r) => r.subject === "Speech")).toBeUndefined();
  });
});

describe("report periods", () => {
  it("splits semesters by calendar quarters without a start date", () => {
    expect(isInReportPeriod("2026-09-30", "2026-27", null, "S1")).toBe(true);
    expect(isInReportPeriod("2026-09-30", "2026-27", null, "S2")).toBe(false);
    expect(isInReportPeriod("2027-02-01", "2026-27", null, "S2")).toBe(true);
    expect(isInReportPeriod("2027-02-01", "2026-27", null, "year")).toBe(true);
    expect(isInReportPeriod(null, "2026-27", null, "year")).toBe(false);
  });

  it("uses 9-week quarters from a start date", () => {
    // Start Aug 17: Q3 starts 126 days later (Dec 21).
    expect(isInReportPeriod("2026-12-20", "2026-27", "2026-08-17", "S1")).toBe(true);
    expect(isInReportPeriod("2026-12-21", "2026-27", "2026-08-17", "S2")).toBe(true);
  });

  it("defaults to semester 1 from July", () => {
    expect(currentReportPeriod(new Date(2026, 9, 2))).toBe("S1");
    expect(currentReportPeriod(new Date(2027, 1, 2))).toBe("S2");
  });
});

describe("edge function copy of the report math", () => {
  it("every line of supabase/functions/_shared/reportMath.ts still appears, in order, in loggedCourses.ts", () => {
    const shared = readFileSync(resolve(__dirname, "../../supabase/functions/_shared/reportMath.ts"), "utf8")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("// GENERATED") && !line.startsWith("// Each block") && !line.startsWith("// a block") && !line.startsWith("/* eslint"));
    const app = readFileSync(resolve(__dirname, "../lib/loggedCourses.ts"), "utf8").split("\n");
    let cursor = 0;
    const missing: string[] = [];
    for (const line of shared) {
      const at = app.indexOf(line, cursor);
      if (at === -1) missing.push(line);
      else cursor = at + 1;
    }
    expect(missing).toEqual([]);
  });
});
