/** Supervisor report, student report, and star chart.
 * Prescribed boxes come from student_pace_slots. Scores fall back to score_reports.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import {
  average,
  currentSchoolYear,
  reportLetter,
  type ReportLetter,
} from "@/lib/loggedCourses";

export interface ReportCell {
  slotIndex: number;
  paceNumber: number | null;
  status: string;
  score: number | null;
  date: string | null;
  letter: ReportLetter;
}

export interface SubjectGrid {
  subjectId: string;
  subjectName: string;
  cells: ReportCell[];
  average: number | null;
  completed: number;
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
              letter: "" as ReportLetter,
            };
          }
          const reported = scores.find(
            (score) =>
              score.subject_id === subjectId &&
              score.pace_number === slot.pace_number,
          );
          const score = slot.score ?? parseScore(reported?.score);
          const date = slot.completed_at ?? reported?.reported_at?.slice(0, 10) ?? slot.issued_at;
          return {
            slotIndex: slot.slot_index,
            paceNumber: slot.pace_number,
            status: slot.status,
            score,
            date,
            letter: reportLetter(slot.status, score),
          };
        });
        const completed = cells.filter((cell) => cell.letter === "P").length;
        return {
          subjectId,
          subjectName: subjectNameOf(subjectSlots[0]),
          cells,
          average: average(cells.map((cell) => cell.score)),
          completed,
        };
      })
      .sort((a, b) => a.subjectName.localeCompare(b.subjectName));
  }, [slots, scores]);

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

  return {
    schoolYear,
    setSchoolYear,
    loading,
    grids,
    stars,
    overall,
    completed,
  };
}
