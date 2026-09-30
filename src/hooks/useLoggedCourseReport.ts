/** Supervisor report, student report, and star chart.
 * Prescribed boxes come from student_pace_slots. Scores fall back to score_reports
 * only for passed/failed slots, or when the report is newer than issued_at.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  average,
  currentSchoolYear,
  isSlotCompleted,
  quarterForCompletedAt,
  reportLetter,
  type QuarterAverages,
  type ReportLetter,
  type ReportQuarterKey,
} from "@/lib/loggedCourses";

export interface ReportCell {
  slotIndex: number;
  paceNumber: number | null;
  status: string;
  score: number | null;
  date: string | null;
  completedAt: string | null;
  letter: ReportLetter;
}

export interface SubjectGrid {
  subjectId: string;
  subjectName: string;
  cells: ReportCell[];
  average: number | null;
  quarterAverages: QuarterAverages;
  completed: number;
  remaining: number;
}

export interface StarPace {
  key: string;
  subjectName: string;
  paceNumber: number;
  score: number;
  date: string | null;
}

interface SlotRow {
  subject_id: string;
  slot_index: number;
  pace_number: number;
  status: string;
  score: number | null;
  completed_at: string | null;
  issued_at: string | null;
  subjects: { name: string } | { name: string }[] | null;
}

interface ScoreRow {
  id: string;
  subject_id: string;
  pace_number: number;
  score: string | null;
  reported_at: string;
}

function subjectNameOf(row: SlotRow): string {
  const rel = row.subjects;
  if (Array.isArray(rel)) return rel[0]?.name ?? "Subject";
  return rel?.name ?? "Subject";
}

function parseScore(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(value);
  return Number.isNaN(num) ? null : num;
}

function emptyQuarterAverages(): QuarterAverages {
  return { Q1: null, Q2: null, Q3: null, Q4: null };
}

function quarterAveragesFor(cells: ReportCell[], schoolYear: string): QuarterAverages {
  const grouped: Record<ReportQuarterKey, number[]> = {
    Q1: [],
    Q2: [],
    Q3: [],
    Q4: [],
  };
  for (const cell of cells) {
    if (cell.score == null) continue;
    const quarter = quarterForCompletedAt(cell.completedAt, schoolYear);
    if (!quarter) continue;
    grouped[quarter].push(cell.score);
  }
  return {
    Q1: average(grouped.Q1),
    Q2: average(grouped.Q2),
    Q3: average(grouped.Q3),
    Q4: average(grouped.Q4),
  };
}

export function useLoggedCourseReport(studentId: string | undefined) {
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear());
  const [loading, setLoading] = useState(false);
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [scores, setScores] = useState<ScoreRow[]>([]);
  const [subjectNames, setSubjectNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!studentId) return;
    let ignore = false;
    const load = async () => {
      setLoading(true);
      const [slotRes, scoreRes, subjectRes] = await Promise.all([
        supabase
          .from("student_pace_slots")
          .select(
            "subject_id, slot_index, pace_number, status, score, completed_at, issued_at, subjects(name)",
          )
          .eq("student_id", studentId)
          .eq("school_year", schoolYear)
          .order("slot_index"),
        supabase
          .from("score_reports")
          .select("id, subject_id, pace_number, score, reported_at")
          .eq("student_id", studentId),
        supabase.from("subjects").select("id, name"),
      ]);
      if (ignore) return;
      setSlots((slotRes.data ?? []) as SlotRow[]);
      setScores((scoreRes.data ?? []) as ScoreRow[]);
      setSubjectNames(
        new Map((subjectRes.data ?? []).map((subject) => [subject.id, subject.name])),
      );
      setLoading(false);
    };
    load();
    return () => {
      ignore = true;
    };
  }, [studentId, schoolYear]);

  const grids = useMemo<SubjectGrid[]>(() => {
    const bySubject = new Map<string, SlotRow[]>();
    for (const slot of slots) {
      const list = bySubject.get(slot.subject_id) ?? [];
      list.push(slot);
      bySubject.set(slot.subject_id, list);
    }
    return [...bySubject.entries()]
      .map(([subjectId, subjectSlots]) => {
        const cells: ReportCell[] = Array.from({ length: 12 }, (_, index) => {
          const slot = subjectSlots.find((row) => row.slot_index === index + 1);
          if (!slot) {
            return {
              slotIndex: index + 1,
              paceNumber: null,
              status: "",
              score: null,
              date: null,
              completedAt: null,
              letter: "" as ReportLetter,
            };
          }
          const reported = scores.find(
            (score) =>
              score.subject_id === subjectId &&
              score.pace_number === slot.pace_number,
          );
          const reportedScore = parseScore(reported?.score);
          const reportedDay = reported?.reported_at?.slice(0, 10) ?? null;
          const passedOrFailed = slot.status === "passed" || slot.status === "failed";
          const newerThanIssue =
            !!reportedDay && !!slot.issued_at && reportedDay > slot.issued_at;
          const useReport =
            slot.score == null &&
            reportedScore != null &&
            (passedOrFailed || newerThanIssue);
          const score = slot.score ?? (useReport ? reportedScore : null);
          const completedAt =
            slot.completed_at ?? (useReport ? reportedDay : null);
          return {
            slotIndex: slot.slot_index,
            paceNumber: slot.pace_number,
            status: slot.status,
            score,
            date: completedAt,
            completedAt,
            letter: reportLetter(slot.status, score),
          };
        });
        const prescribed = cells.filter((cell) => cell.paceNumber != null);
        const completed = prescribed.filter((cell) =>
          isSlotCompleted(cell.status, cell.score),
        ).length;
        return {
          subjectId,
          subjectName: subjectNameOf(subjectSlots[0]),
          cells,
          average: average(cells.map((cell) => cell.score)),
          quarterAverages: quarterAveragesFor(cells, schoolYear),
          completed,
          remaining: prescribed.length - completed,
        };
      })
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [slots, scores, schoolYear]);

  const stars = useMemo<StarPace[]>(() => {
    const seen = new Set<string>();
    const list: StarPace[] = [];
    for (const grid of grids) {
      for (const cell of grid.cells) {
        if (cell.letter !== "P" || cell.score == null || cell.paceNumber == null) continue;
        const key = `${grid.subjectId}:${cell.paceNumber}`;
        seen.add(key);
        list.push({
          key,
          subjectName: grid.subjectName,
          paceNumber: cell.paceNumber,
          score: cell.score,
          date: cell.date,
        });
      }
    }
    for (const score of scores) {
      const numeric = parseScore(score.score);
      if (numeric == null || numeric < 80) continue;
      const key = `${score.subject_id}:${score.pace_number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({
        key: score.id,
        subjectName: subjectNames.get(score.subject_id) ?? "Subject",
        paceNumber: score.pace_number,
        score: numeric,
        date: score.reported_at.slice(0, 10),
      });
    }
    return list.sort(
      (a, b) =>
        a.subjectName.localeCompare(b.subjectName) || a.paceNumber - b.paceNumber,
    );
  }, [grids, scores, subjectNames]);

  const overall = average(grids.map((grid) => grid.average));
  const completed = grids.reduce((sum, grid) => sum + grid.completed, 0);
  const remaining = grids.reduce((sum, grid) => sum + grid.remaining, 0);

  return {
    schoolYear,
    setSchoolYear,
    loading,
    grids,
    stars,
    overall,
    completed,
    remaining,
  };
}
