import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Printer } from "lucide-react";
import { compareSubjectNames, subjectDisplayName } from "@/lib/loggedCourses";

interface Student {
  id: string;
  student_name: string;
  gender: string | null;
  birthdate: string | null;
}

interface Completion {
  id: string;
  subject_name: string;
  school_year: string;
  final_average: number | null;
  letter_grade: string | null;
  credit_earned: number;
}

// Standard unweighted 4.0 scale, matched to MCA's own transcript form.
function gradeFromAverage(avg: number): { letter: string; points: number } {
  if (avg >= 98) return { letter: "A+", points: 4.0 };
  if (avg >= 96) return { letter: "A", points: 4.0 };
  if (avg >= 94) return { letter: "A-", points: 3.7 };
  if (avg >= 92) return { letter: "B+", points: 3.3 };
  if (avg >= 90) return { letter: "B", points: 3.0 };
  if (avg >= 88) return { letter: "B-", points: 2.7 };
  if (avg >= 86) return { letter: "C+", points: 2.3 };
  if (avg >= 83) return { letter: "C", points: 2.0 };
  if (avg >= 80) return { letter: "C-", points: 1.7 };
  if (avg >= 76) return { letter: "D+", points: 1.3 };
  if (avg >= 74) return { letter: "D", points: 1.0 };
  return { letter: "F", points: 0.0 };
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export default function AdminTranscript() {
  const { familyId, studentId } = useParams<{
    familyId: string;
    studentId: string;
  }>();
  const [student, setStudent] = useState<Student | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [loading, setLoading] = useState(true);

  const [enrollmentDate, setEnrollmentDate] = useState("");
  const [graduationDate, setGraduationDate] = useState("");
  const [courseOfStudy, setCourseOfStudy] = useState("College Preparatory");

  useEffect(() => {
    if (!studentId) return;
    const load = async () => {
      setLoading(true);
      const [studentRes, completionsRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, student_name, gender, birthdate")
          .eq("id", studentId)
          .single(),
        supabase
          .from("course_completions")
          .select(
            "id, subject_name, school_year, final_average, letter_grade, credit_earned",
          )
          .eq("student_id", studentId)
          .not("final_average", "is", null)
          .order("school_year"),
      ]);

      if (studentRes.data) setStudent(studentRes.data);
      if (completionsRes.data) setCompletions(completionsRes.data);
      setLoading(false);
    };
    load();
  }, [studentId]);

  const byYear = useMemo(() => {
    const map = new Map<string, Completion[]>();
    for (const c of completions) {
      const list = map.get(c.school_year) ?? [];
      list.push(c);
      list.sort((a, b) => compareSubjectNames(a.subject_name, b.subject_name));
      map.set(c.school_year, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [completions]);

  const overallGpa = useMemo(() => {
    if (completions.length === 0) return null;
    const totalPoints = completions.reduce(
      (sum, c) =>
        sum + gradeFromAverage(c.final_average!).points * c.credit_earned,
      0,
    );
    const totalCredits = completions.reduce(
      (sum, c) => sum + c.credit_earned,
      0,
    );
    return totalCredits > 0 ? totalPoints / totalCredits : null;
  }, [completions]);

  const totalCredits = useMemo(
    () => completions.reduce((sum, c) => sum + c.credit_earned, 0),
    [completions],
  );

  const overallAverage = useMemo(() => {
    if (completions.length === 0) return null;
    return (
      completions.reduce((sum, c) => sum + c.final_average!, 0) /
      completions.length
    );
  }, [completions]);

  const yearStats = (yearCompletions: Completion[]) => {
    const avg =
      yearCompletions.length > 0
        ? yearCompletions.reduce((sum, c) => sum + c.final_average!, 0) /
          yearCompletions.length
        : null;
    const credits = yearCompletions.reduce(
      (sum, c) => sum + c.credit_earned,
      0,
    );
    return { avg, credits };
  };

  const handlePrint = () => {
    if (!student) return;
    const printWindow = window.open("", "_blank", "width=900,height=1000");
    if (!printWindow) return;

    const yearsHtml = byYear
      .map(([year, yearCompletions]) => {
        const stats = yearStats(yearCompletions);
        const rows = yearCompletions
          .map(
            (c) => `
            <tr>
              <td>${escapeHtml(subjectDisplayName(c.subject_name))}</td>
              <td>${c.final_average ?? "—"}</td>
              <td>${c.letter_grade ?? "—"}</td>
              <td>${c.credit_earned.toFixed(2)}</td>
            </tr>`,
          )
          .join("");
        return `
          <div class="year-block">
            <h3>${escapeHtml(year)}</h3>
            <table>
              <thead><tr><th>Subject</th><th>Avg</th><th>Grade</th><th>Credit</th></tr></thead>
              <tbody>${rows}</tbody>
            </table>
            <div class="year-summary">
              <span>Yearly Average: ${stats.avg != null ? stats.avg.toFixed(2) : "—"}</span>
              <span>Total Credits: ${stats.credits.toFixed(2)}</span>
            </div>
          </div>`;
      })
      .join("");

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>High School Transcript — ${escapeHtml(student.student_name)}</title>
          <style>
            body { font-family: Georgia, serif; padding: 40px; color: #1a1a2e; }
            h1 { font-size: 22px; text-align: center; margin-bottom: 4px; }
            .school-header { text-align: center; color: #666; font-size: 13px; margin-bottom: 24px; }
            .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 24px; font-size: 14px; }
            .year-block { margin-bottom: 24px; }
            .year-block h3 { font-size: 15px; border-bottom: 1px solid #999; padding-bottom: 4px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { border: 1px solid #999; padding: 6px 10px; text-align: left; font-size: 13px; }
            th { background: #f2f2f2; }
            .year-summary { display: flex; gap: 20px; font-size: 12px; color: #555; margin-top: 6px; }
            .legend { font-size: 11px; color: #666; margin-top: 30px; border-top: 1px solid #ccc; padding-top: 10px; }
            .signature { margin-top: 40px; border-top: 1px solid #333; width: 300px; padding-top: 4px; font-size: 12px; }
          </style>
        </head>
        <body>
          <h1>HIGH SCHOOL TRANSCRIPT</h1>
          <div class="school-header">MIDWEST CHRISTIAN ACADEMY — 2300 NW 32nd Street, Newcastle, OK 73065 — (844)663-4477</div>
          <div class="info-grid">
            <div><strong>Student Name:</strong> ${escapeHtml(student.student_name)}</div>
            <div><strong>Gender:</strong> ${student.gender ?? "—"}</div>
            <div><strong>Birth Date:</strong> ${student.birthdate ? new Date(student.birthdate).toLocaleDateString() : "—"}</div>
            <div><strong>Enrollment Date:</strong> ${enrollmentDate || "—"}</div>
            <div><strong>Graduation Date:</strong> ${graduationDate || "—"}</div>
            <div><strong>Course of Study:</strong> ${escapeHtml(courseOfStudy)}</div>
            <div><strong>GPA:</strong> ${overallGpa != null ? overallGpa.toFixed(2) : "—"}</div>
            <div><strong>High School Average:</strong> ${overallAverage != null ? overallAverage.toFixed(2) : "—"}</div>
            <div><strong>Total Credits:</strong> ${totalCredits.toFixed(2)}</div>
          </div>
          ${yearsHtml}
          <div class="signature">Administrator's Signature</div>
          <div class="legend">
            Grading Scale: 98-100=A+ 96-97=A 94-95=A- 92-93=B+ 90-91=B 88-89=B- 86-87=C+ 83-85=C 80-82=C- 76-79=D+ 74-75=D 0-73=F
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  if (loading) return <p className="text-foreground/60">Loading...</p>;
  if (!student) return <p className="text-foreground/60">Student not found.</p>;

  return (
    <div className="space-y-6">
      <Link
        to={`/admin/families/${familyId}`}
        className="inline-flex items-center gap-1 text-sm text-foreground/60 hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Family
      </Link>

      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold font-serif text-primary">
          Transcript — {student.student_name}
        </h2>
        <Button onClick={handlePrint}>
          <Printer className="h-4 w-4 mr-1.5" />
          Print / Save PDF
        </Button>
      </div>

      <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="space-y-1.5">
          <Label className="text-xs">Enrollment Date</Label>
          <Input
            className="bg-background h-9"
            type="date"
            value={enrollmentDate}
            onChange={(e) => setEnrollmentDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Graduation Date</Label>
          <Input
            className="bg-background h-9"
            type="date"
            value={graduationDate}
            onChange={(e) => setGraduationDate(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Course of Study</Label>
          <Input
            className="bg-background h-9"
            value={courseOfStudy}
            onChange={(e) => setCourseOfStudy(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-foreground/50">
        These three fields aren't stored yet — fill them in before printing each
        time. Only completed courses (a final average logged) count toward this
        transcript; courses marked "in progress" show on the Graduation
        Projection page instead.
      </p>

      <div className="rounded-xl border border-border/50 bg-background p-5 grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-foreground/50 text-xs uppercase">GPA</p>
          <p className="font-semibold">
            {overallGpa != null ? overallGpa.toFixed(2) : "—"}
          </p>
        </div>
        <div>
          <p className="text-foreground/50 text-xs uppercase">HS Average</p>
          <p className="font-semibold">
            {overallAverage != null ? overallAverage.toFixed(2) : "—"}
          </p>
        </div>
        <div>
          <p className="text-foreground/50 text-xs uppercase">Total Credits</p>
          <p className="font-semibold">{totalCredits.toFixed(2)}</p>
        </div>
      </div>

      {byYear.length === 0 ? (
        <p className="text-foreground/60">
          No completed courses logged yet — log some on the Family page first.
        </p>
      ) : (
        <div className="space-y-6">
          {byYear.map(([year, yearCompletions]) => {
            const stats = yearStats(yearCompletions);
            return (
              <div
                key={year}
                className="rounded-xl border border-border/50 overflow-x-auto"
              >
                <div className="bg-secondary p-3 font-semibold">{year}</div>
                <table className="w-full text-sm">
                  <thead className="bg-secondary/50 text-left">
                    <tr>
                      <th className="p-2">Subject</th>
                      <th className="p-2">Avg</th>
                      <th className="p-2">Grade</th>
                      <th className="p-2">Credit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearCompletions.map((c) => (
                      <tr key={c.id} className="border-t border-border/50">
                        <td className="p-2">{subjectDisplayName(c.subject_name)}</td>
                        <td className="p-2">{c.final_average ?? "—"}</td>
                        <td className="p-2">{c.letter_grade ?? "—"}</td>
                        <td className="p-2">{c.credit_earned.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="p-3 text-xs text-foreground/60 flex gap-4 flex-wrap">
                  <span>
                    Yearly Average:{" "}
                    {stats.avg != null ? stats.avg.toFixed(2) : "—"}
                  </span>
                  <span>Total Credits: {stats.credits.toFixed(2)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
