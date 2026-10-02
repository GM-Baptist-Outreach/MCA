import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFImage, type PDFPage } from "npm:pdf-lib@1.17.1";
import {
  average,
  compareSubjectNames,
  currentReportPeriod,
  currentSchoolYear,
  graduationProgress,
  isInReportPeriod,
  isSlotCompleted,
  PASSING_SCORE,
  quarterRanges,
  REPORT_PERIODS,
  schoolYearDateBounds,
  subjectDisplayName,
  toAcePaceNumber,
  toInternalPaceNumber,
  type ReportPeriod,
} from "../_shared/reportMath.ts";

// Round 8: one-click PDF downloads. Marker: MCA_R8_STUDENT_PDF
//
// POST JSON (signed-in parent or admin):
//   { kind: "progress", student_id, school_year?, period?: "S1" | "S2" | "year" }
//   { kind: "transcript", student_id }
//   { kind: "diploma", student_id, preview?, graduation_date? }   (Round 10)
// Returns application/pdf.
//
// Diploma (MCA_R10_DIPLOMA): only once the student has met the graduation
// requirement (credits earned >= the school total, every required subject and
// the electives covered; same math as the credit bar). Admins may pass
// preview: true for a sample stamped "SAMPLE - NOT YET ELIGIBLE", and may set
// graduation_date (YYYY-MM-DD); otherwise it's dated today (Central).
//
// Access: the caller's own Supabase client must be able to read the student
// (RLS: a parent sees only their own students, admins see all). All data for
// the PDF is then read with the service role, so a parent can't feed in their
// own numbers.
//
// _shared/reportMath.ts is generated from src/lib/loggedCourses.ts (verbatim blocks;
// src/test/sharedReportMath.test.ts fails if they drift), so scores,
// quarters, semesters and graduation credits match the portal screens.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Expose-Headers": "content-disposition",
};

const SCHOOL_NAME = "Midwest Christian Academy";
const SCHOOL_ADDRESS = "2300 NW 32nd Street, Newcastle, OK 73065";
const SCHOOL_PHONE = "(844) 663-4477";
const SCHOOL_WEB = "mcahomeschool.com";
const LOGO_URL =
  "https://vibe.filesafe.space/1784303289974857996/attachments/5ce70202-91c1-463f-929b-e89f47f07a50.png";

const NAVY = rgb(0.1, 0.16, 0.33);
const GOLD = rgb(0.78, 0.6, 0.18);
const GREY = rgb(0.4, 0.4, 0.4);
const LIGHT = rgb(0.94, 0.95, 0.97);
const LINE = rgb(0.8, 0.82, 0.86);
const GREEN = rgb(0.13, 0.55, 0.33);
const AMBER = rgb(0.85, 0.62, 0.2);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

// Standard PDF fonts only cover Windows-1252. Keep accents where possible and
// replace anything else so a name with an emoji can't break the download.
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");
function safe(text: string | number | null | undefined): string {
  const s = String(text ?? "");
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0) ?? 63;
    if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255) || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else if (code === 9 || code === 10) out += " ";
    else {
      const plain = ch.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
      out += /^[\x20-\x7e]+$/.test(plain) ? plain : "?";
    }
  }
  return out;
}

function one<T>(rel: T | T[] | null | undefined): T | null {
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel ?? null;
}

function parseScore(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const num = typeof value === "number" ? value : parseFloat(value);
  return Number.isNaN(num) ? null : num;
}

function nextGrade(last: string | null): string {
  const t = (last ?? "").trim();
  if (!t) return "—";
  if (/^pre-?k$/i.test(t)) return "K";
  if (/^k(indergarten)?$/i.test(t)) return "1";
  const n = parseInt(t, 10);
  return Number.isFinite(n) ? String(n + 1) : t;
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function todayCentral(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function fileSlug(s: string): string {
  return s.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "student";
}

// ---------------------------------------------------------------------------
// Tiny layout helper on top of pdf-lib.
// ---------------------------------------------------------------------------
class Doc {
  pdf!: PDFDocument;
  page!: PDFPage;
  regular!: PDFFont;
  bold!: PDFFont;
  italic!: PDFFont;
  logo: PDFImage | null = null;
  y = 0;
  readonly W = 612;
  readonly H = 792;
  readonly M = 48;
  title = "";
  subtitle = "";

  static async create(title: string, subtitle: string): Promise<Doc> {
    const d = new Doc();
    d.pdf = await PDFDocument.create();
    d.pdf.setTitle(safe(`${title} - ${subtitle}`));
    d.pdf.setAuthor(SCHOOL_NAME);
    d.pdf.setCreator(SCHOOL_WEB);
    d.regular = await d.pdf.embedFont(StandardFonts.Helvetica);
    d.bold = await d.pdf.embedFont(StandardFonts.HelveticaBold);
    d.italic = await d.pdf.embedFont(StandardFonts.HelveticaOblique);
    d.title = title;
    d.subtitle = subtitle;
    try {
      const res = await fetch(LOGO_URL, { signal: AbortSignal.timeout(6000) });
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        d.logo = bytes[0] === 0x89 ? await d.pdf.embedPng(bytes) : await d.pdf.embedJpg(bytes);
      }
    } catch (_err) {
      d.logo = null;
    }
    d.addPage(true);
    return d;
  }

  addPage(first = false) {
    this.page = this.pdf.addPage([this.W, this.H]);
    const top = this.H - this.M;
    if (first) {
      let textX = this.M;
      if (this.logo) {
        const h = 58;
        const w = (this.logo.width / this.logo.height) * h;
        this.page.drawImage(this.logo, { x: this.M, y: top - h + 6, width: w, height: h });
        textX = this.M + w + 14;
      }
      this.text(SCHOOL_NAME, textX, top - 14, 17, this.bold, NAVY);
      this.text(SCHOOL_ADDRESS, textX, top - 30, 9.5, this.regular, GREY);
      this.text(`${SCHOOL_PHONE}  ·  ${SCHOOL_WEB}`, textX, top - 43, 9.5, this.regular, GREY);
      this.page.drawRectangle({ x: this.M, y: top - 64, width: this.W - 2 * this.M, height: 2.5, color: GOLD });
      this.text(this.title.toUpperCase(), this.M, top - 92, 18, this.bold, NAVY);
      this.y = top - 108;
    } else {
      this.text(`${this.title} - ${this.subtitle} (continued)`, this.M, top - 10, 10, this.bold, NAVY);
      this.page.drawRectangle({ x: this.M, y: top - 18, width: this.W - 2 * this.M, height: 1, color: LINE });
      this.y = top - 36;
    }
  }

  ensure(space: number) {
    if (this.y - space < this.M + 30) this.addPage();
  }

  text(s: string, x: number, y: number, size = 10, font = this.regular, color = rgb(0.1, 0.1, 0.18)) {
    this.page.drawText(safe(s), { x, y, size, font, color });
  }

  width(s: string, size = 10, font = this.regular): number {
    return font.widthOfTextAtSize(safe(s), size);
  }

  fit(s: string, max: number, size = 10, font = this.regular): string {
    let t = safe(s);
    if (font.widthOfTextAtSize(t, size) <= max) return t;
    while (t.length > 1 && font.widthOfTextAtSize(`${t}…`, size) > max) t = t.slice(0, -1);
    return `${t}…`;
  }

  wrap(s: string, max: number, size = 10, font = this.regular): string[] {
    const words = safe(s).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > max && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  paragraph(s: string, size = 9.5, font = this.regular, color = GREY) {
    for (const line of this.wrap(s, this.W - 2 * this.M, size, font)) {
      this.ensure(size + 4);
      this.text(line, this.M, this.y, size, font, color);
      this.y -= size + 4;
    }
  }

  heading(s: string) {
    this.ensure(40);
    this.y -= 8;
    this.text(s, this.M, this.y, 12.5, this.bold, NAVY);
    this.y -= 6;
    this.page.drawRectangle({ x: this.M, y: this.y, width: this.W - 2 * this.M, height: 0.8, color: LINE });
    this.y -= 14;
  }

  infoGrid(pairs: Array<[string, string]>, cols = 2) {
    const colW = (this.W - 2 * this.M) / cols;
    const rows = Math.ceil(pairs.length / cols);
    const h = rows * 17 + 12;
    this.ensure(h + 6);
    this.page.drawRectangle({ x: this.M, y: this.y - h + 10, width: this.W - 2 * this.M, height: h, color: LIGHT });
    pairs.forEach(([label, value], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = this.M + 10 + col * colW;
      const y = this.y - 6 - row * 17;
      this.text(`${label}:`, x, y, 9.5, this.bold, GREY);
      const lw = this.width(`${label}: `, 9.5, this.bold);
      this.text(this.fit(value, colW - lw - 16, 10), x + lw, y, 10, this.regular);
    });
    this.y -= h + 6;
  }

  stats(items: Array<[string, string]>) {
    const n = items.length;
    const gap = 10;
    const w = (this.W - 2 * this.M - gap * (n - 1)) / n;
    this.ensure(56);
    items.forEach(([label, value], i) => {
      const x = this.M + i * (w + gap);
      this.page.drawRectangle({ x, y: this.y - 40, width: w, height: 48, borderColor: LINE, borderWidth: 1 });
      this.text(label.toUpperCase(), x + 10, this.y - 4, 7.5, this.bold, GREY);
      this.text(this.fit(value, w - 20, 16, this.bold), x + 10, this.y - 28, 16, this.bold, NAVY);
    });
    this.y -= 58;
  }

  table(
    headers: string[],
    widths: number[],
    rows: string[][],
    opts: { align?: Array<"l" | "r" | "c">; size?: number; emptyText?: string } = {},
  ) {
    const size = opts.size ?? 9.5;
    const total = this.W - 2 * this.M;
    const sum = widths.reduce((a, b) => a + b, 0);
    const ws = widths.map((w) => (w / sum) * total);
    const rowH = size + 8;
    const drawHeader = () => {
      this.ensure(rowH * 2);
      this.page.drawRectangle({ x: this.M, y: this.y - rowH + size + 1, width: total, height: rowH, color: NAVY });
      let x = this.M;
      headers.forEach((h, i) => {
        this.cell(h, x, ws[i], size - 0.5, this.bold, rgb(1, 1, 1), opts.align?.[i]);
        x += ws[i];
      });
      this.y -= rowH;
    };
    drawHeader();
    if (rows.length === 0) {
      this.text(opts.emptyText ?? "Nothing to show yet.", this.M + 6, this.y, size, this.italic, GREY);
      this.y -= rowH;
      return;
    }
    rows.forEach((row, r) => {
      if (this.y - rowH < this.M + 30) {
        this.addPage();
        drawHeader();
      }
      if (r % 2 === 1) {
        this.page.drawRectangle({ x: this.M, y: this.y - rowH + size + 1, width: total, height: rowH, color: LIGHT });
      }
      let x = this.M;
      row.forEach((c, i) => {
        this.cell(c, x, ws[i], size, this.regular, rgb(0.1, 0.1, 0.18), opts.align?.[i]);
        x += ws[i];
      });
      this.y -= rowH;
    });
    this.page.drawRectangle({ x: this.M, y: this.y + size + 1, width: total, height: 0.8, color: LINE });
    this.y -= 6;
  }

  private cell(s: string, x: number, w: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>, align: "l" | "r" | "c" = "l") {
    const t = this.fit(s, w - 10, size, font);
    const tw = font.widthOfTextAtSize(t, size);
    const tx = align === "r" ? x + w - 5 - tw : align === "c" ? x + (w - tw) / 2 : x + 5;
    this.page.drawText(t, { x: tx, y: this.y, size, font, color });
  }

  creditBar(earned: number, inProgress: number, total: number) {
    this.ensure(46);
    const w = this.W - 2 * this.M;
    const h = 14;
    const y = this.y - h + 4;
    this.page.drawRectangle({ x: this.M, y, width: w, height: h, color: LIGHT, borderColor: LINE, borderWidth: 0.8 });
    const ew = total > 0 ? Math.min(1, earned / total) * w : 0;
    const iw = total > 0 ? Math.min(1 - ew / w, inProgress / total) * w : 0;
    if (ew > 0) this.page.drawRectangle({ x: this.M, y, width: ew, height: h, color: GREEN });
    if (iw > 0) this.page.drawRectangle({ x: this.M + ew, y, width: iw, height: h, color: AMBER });
    this.y -= h + 10;
    const legend = [
      [GREEN, `Earned ${earned.toFixed(2)}`],
      [AMBER, `In progress ${inProgress.toFixed(2)}`],
      [LIGHT, `Still needed ${Math.max(0, total - earned - inProgress).toFixed(2)}`],
    ] as const;
    let x = this.M;
    for (const [color, label] of legend) {
      this.page.drawRectangle({ x, y: this.y - 1, width: 9, height: 9, color, borderColor: LINE, borderWidth: 0.6 });
      this.text(label, x + 13, this.y, 9.5);
      x += this.width(label, 9.5) + 34;
    }
    this.text(`of ${total.toFixed(2)} required`, x, this.y, 9.5, this.regular, GREY);
    this.y -= 18;
  }

  async finish(): Promise<Uint8Array> {
    const pages = this.pdf.getPages();
    const stamp = `Generated ${fmtDate(todayCentral())}  ·  ${SCHOOL_NAME}  ·  ${SCHOOL_WEB}`;
    pages.forEach((p, i) => {
      p.drawText(safe(stamp), { x: this.M, y: 26, size: 8, font: this.regular, color: GREY });
      const label = `Page ${i + 1} of ${pages.length}`;
      p.drawText(label, {
        x: this.W - this.M - this.regular.widthOfTextAtSize(label, 8),
        y: 26,
        size: 8,
        font: this.regular,
        color: GREY,
      });
    });
    return await this.pdf.save();
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------
interface StudentRow {
  id: string;
  student_name: string;
  gender: string | null;
  birthdate: string | null;
  last_grade_completed: string | null;
  family_id: string;
}

async function loadGraduation(admin: SupabaseClient, studentId: string) {
  const [completionsRes, templateRes, customRes, totalRes] = await Promise.all([
    admin
      .from("course_completions")
      .select("subject_name, school_year, final_average, letter_grade, credit_earned, is_transfer, transfer_school, fulfills_requirement")
      .eq("student_id", studentId)
      .order("school_year"),
    admin.from("graduation_requirements").select("subject_name, credit_required, sort_order").order("sort_order"),
    admin
      .from("student_graduation_requirements")
      .select("subject_name, credit_required, sort_order")
      .eq("student_id", studentId)
      .order("sort_order"),
    admin.rpc("mca_graduation_total_credits"),
  ]);
  const completions = (completionsRes.data ?? []) as Array<{
    subject_name: string;
    school_year: string;
    final_average: number | null;
    letter_grade: string | null;
    credit_earned: number;
    is_transfer: boolean | null;
    transfer_school: string | null;
    fulfills_requirement: string | null;
  }>;
  const custom = customRes.data ?? [];
  const requirements = (custom.length > 0 ? custom : templateRes.data ?? []) as Array<{ subject_name: string; credit_required: number }>;
  const total = Number(totalRes.data ?? 25);
  return { completions, requirements, progress: graduationProgress(requirements, completions, total) };
}

async function isHighSchool(admin: SupabaseClient, studentId: string): Promise<boolean> {
  const { data } = await admin.from("enrollments").select("tuition_tier, status").eq("student_id", studentId);
  return (data ?? []).some((e) => e.tuition_tier === "high_school");
}

// ---------------------------------------------------------------------------
// Progress report
// ---------------------------------------------------------------------------
async function progressReport(admin: SupabaseClient, student: StudentRow, schoolYear: string, period: ReportPeriod) {
  const [slotRes, scoreRes, calendarRes, hs] = await Promise.all([
    admin
      .from("student_pace_slots")
      .select("subject_id, slot_index, pace_number, status, score, completed_at, issued_at, subjects(name)")
      .eq("student_id", student.id)
      .eq("school_year", schoolYear)
      .order("slot_index"),
    admin.from("score_reports").select("subject_id, pace_number, score, reported_at, review_status").eq("student_id", student.id),
    admin
      .from("student_school_calendars")
      .select("start_date")
      .eq("student_id", student.id)
      .eq("school_year", schoolYear)
      .maybeSingle(),
    isHighSchool(admin, student.id),
  ]);
  const startDate = (calendarRes.data?.start_date as string | undefined) ?? null;
  const scores = (scoreRes.data ?? []) as Array<{ subject_id: string; pace_number: number; score: string | null; reported_at: string; review_status: string | null }>;

  // Same score rules as useLoggedCourseReport.
  type Cell = { subject: string; pace: number; status: string; score: number | null; completedAt: string | null };
  const cells: Cell[] = ((slotRes.data ?? []) as Array<Record<string, unknown>>).map((slot) => {
    const reported = scores.find(
      (s) =>
        s.review_status !== "rejected" &&
        s.subject_id === slot.subject_id &&
        toInternalPaceNumber(s.pace_number) === slot.pace_number,
    );
    const reportedScore = parseScore(reported?.score);
    const reportedDay = reported?.reported_at?.slice(0, 10) ?? null;
    const status = String(slot.status ?? "");
    const passedOrFailed = status === "passed" || status === "failed";
    const issuedAt = (slot.issued_at as string | null) ?? null;
    const newer = !!reportedDay && !!issuedAt && reportedDay > issuedAt;
    const slotScore = parseScore(slot.score as string | number | null);
    const useReport = slotScore == null && reportedScore != null && (passedOrFailed || newer);
    return {
      subject: one(slot.subjects as { name: string } | { name: string }[] | null)?.name ?? "Subject",
      pace: Number(slot.pace_number),
      status,
      score: slotScore ?? (useReport ? reportedScore : null),
      completedAt: (slot.completed_at as string | null) ?? (useReport ? reportedDay : null),
    };
  });

  const inPeriod = cells.filter(
    (c) => isSlotCompleted(c.status, c.score) && isInReportPeriod(c.completedAt, schoolYear, startDate, period),
  );
  const subjects = [...new Set(cells.map((c) => c.subject))].sort(compareSubjectNames);

  const periodLabel = REPORT_PERIODS.find((p) => p.key === period)?.label ?? period;
  let periodDates = "";
  if (startDate) {
    const q = quarterRanges(startDate);
    const from = period === "S2" ? q[2].start : q[0].start;
    const toExclusive = period === "S1" ? q[1].end : q[3].end;
    const to = new Date(Date.parse(`${toExclusive}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    periodDates = `${fmtDate(from)} - ${fmtDate(to)}`;
  } else {
    const b = schoolYearDateBounds(schoolYear);
    if (b) {
      const start = Number(schoolYear.slice(0, 4));
      periodDates =
        period === "S1"
          ? `Jul 1, ${start} - Dec 31, ${start}`
          : period === "S2"
            ? `Jan 1, ${start + 1} - Jun 30, ${start + 1}`
            : `${fmtDate(b.start)} - ${fmtDate(b.end)}`;
    }
  }

  const doc = await Doc.create("Student Progress Report", student.student_name);
  doc.infoGrid([
    ["Student", student.student_name],
    ["Grade", nextGrade(student.last_grade_completed)],
    ["School year", schoolYear],
    ["Report period", periodLabel],
    ["Dates", periodDates || "—"],
    ["Issued", fmtDate(todayCentral())],
  ]);

  const avg = average(inPeriod.map((c) => c.score));
  const grad = hs ? await loadGraduation(admin, student.id) : null;
  const stats: Array<[string, string]> = [
    ["PACEs completed", String(inPeriod.length)],
    ["Average test score", avg != null ? `${avg.toFixed(1)}%` : "n/a"],
  ];
  if (grad) stats.push(["Credits earned", `${grad.progress.earned.toFixed(2)} of ${grad.progress.totalRequired.toFixed(0)}`]);
  else stats.push(["Subjects", String(subjects.length)]);
  doc.stats(stats);

  doc.heading("PACEs completed by subject");
  doc.table(
    ["Subject", "Done this period", "Period average", "Done this year", "Left this year"],
    [2.4, 1.6, 1, 1.5, 1.7],
    subjects.map((subject) => {
      const all = cells.filter((c) => c.subject === subject);
      const done = all.filter((c) => isSlotCompleted(c.status, c.score));
      const thisPeriod = inPeriod.filter((c) => c.subject === subject);
      const a = average(thisPeriod.map((c) => c.score));
      return [
        subjectDisplayName(subject),
        String(thisPeriod.length),
        a != null ? `${a.toFixed(1)}%` : "—",
        String(done.length),
        String(all.length - done.length),
      ];
    }),
    { align: ["l", "c", "c", "c", "c"], emptyText: "No PACEs are prescribed for this school year yet." },
  );

  doc.heading("Test scores");
  const sorted = [...inPeriod].sort(
    (a, b) => compareSubjectNames(a.subject, b.subject) || a.pace - b.pace,
  );
  doc.table(
    ["Date", "Subject", "PACE", "Score", "Result"],
    [1.2, 2.6, 0.9, 0.9, 1.2],
    sorted.map((c) => [
      fmtDate(c.completedAt),
      subjectDisplayName(c.subject),
      String(toAcePaceNumber(c.pace)),
      c.score != null ? `${c.score.toFixed(0)}%` : "—",
      c.score == null ? (c.status === "passed" ? "Passed" : c.status === "failed" ? "Retake" : "—") : c.score >= PASSING_SCORE ? "Passed" : "Retake",
    ]),
    { align: ["l", "l", "c", "c", "c"], emptyText: "No PACE tests were completed in this period." },
  );
  doc.paragraph(`A PACE test passes at ${PASSING_SCORE}% or higher. PACE numbers are shown the way ACE prints them.`, 8.5);

  if (grad) {
    doc.heading("Credits toward graduation");
    const g = grad.progress;
    doc.creditBar(g.earned, g.inProgress, g.totalRequired);
    if (g.stillNeeded > 0 || g.remainingBySubject.length > 0) {
      const parts = g.remainingBySubject.map((r) => `${r.subject} ${r.credits.toFixed(2)}`);
      if (g.electivesRemaining > 0) parts.push(`Electives ${g.electivesRemaining.toFixed(2)}`);
      doc.paragraph(`Still needed: ${parts.join(", ")}.`, 9);
    } else {
      doc.paragraph("All required credits are earned or in progress.", 9);
    }
  }

  doc.ensure(60);
  doc.y -= 30;
  doc.page.drawRectangle({ x: doc.M, y: doc.y, width: 220, height: 0.8, color: rgb(0.2, 0.2, 0.2) });
  doc.text("Administrator", doc.M, doc.y - 12, 9, doc.regular, GREY);
  return { bytes: await doc.finish(), filename: `${fileSlug(student.student_name)}-progress-report-${schoolYear}-${period}.pdf` };
}

// ---------------------------------------------------------------------------
// Transcript (same rules as the admin Transcript page)
// ---------------------------------------------------------------------------
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

async function transcript(admin: SupabaseClient, student: StudentRow) {
  const grad = await loadGraduation(admin, student.id);
  const done = grad.completions.filter((c) => c.is_transfer === true || c.final_average != null);
  const mca = done.filter((c) => c.is_transfer !== true && c.final_average != null);
  const credits = (list: typeof done) => list.reduce((s, c) => s + Number(c.credit_earned ?? 0), 0);
  const gpaCredits = credits(mca);
  const gpa = gpaCredits > 0
    ? mca.reduce((s, c) => s + gradeFromAverage(Number(c.final_average)).points * Number(c.credit_earned ?? 0), 0) / gpaCredits
    : null;
  const hsAvg = mca.length ? mca.reduce((s, c) => s + Number(c.final_average), 0) / mca.length : null;
  const years = [...new Set(done.map((c) => c.school_year))].sort();
  const label = (c: (typeof done)[number]) =>
    c.is_transfer ? `${subjectDisplayName(c.subject_name)} (T) ${c.transfer_school ?? ""}`.trim() : subjectDisplayName(c.subject_name);

  const doc = await Doc.create("High School Transcript", student.student_name);
  doc.infoGrid([
    ["Student", student.student_name],
    ["Gender", student.gender ? student.gender[0].toUpperCase() + student.gender.slice(1) : "—"],
    ["Birth date", fmtDate(student.birthdate)],
    ["Course of study", "College Preparatory"],
    ["GPA (4.0 scale)", gpa != null ? gpa.toFixed(2) : "—"],
    ["High school average", hsAvg != null ? hsAvg.toFixed(2) : "—"],
    ["Total credits", credits(done).toFixed(2)],
    ["Issued", fmtDate(todayCentral())],
  ]);
  doc.stats([
    ["Credits earned", `${grad.progress.earned.toFixed(2)} of ${grad.progress.totalRequired.toFixed(0)}`],
    ["In progress", grad.progress.inProgress.toFixed(2)],
    ["GPA", gpa != null ? gpa.toFixed(2) : "—"],
  ]);

  if (years.length === 0) {
    doc.heading("Courses");
    doc.paragraph("No completed high school courses are logged yet.", 10, doc.italic);
  }
  for (const year of years) {
    const list = done.filter((c) => c.school_year === year).sort((a, b) => compareSubjectNames(a.subject_name, b.subject_name));
    const graded = list.filter((c) => c.is_transfer !== true && c.final_average != null);
    const yAvg = graded.length ? graded.reduce((s, c) => s + Number(c.final_average), 0) / graded.length : null;
    doc.heading(year);
    doc.table(
      ["Course", "Average", "Grade", "Credit"],
      [4, 1, 1, 1],
      list.map((c) => [
        label(c),
        c.final_average != null ? String(c.final_average) : "—",
        c.letter_grade ?? (c.final_average != null ? gradeFromAverage(Number(c.final_average)).letter : "—"),
        Number(c.credit_earned ?? 0).toFixed(2),
      ]),
      { align: ["l", "c", "c", "r"] },
    );
    doc.paragraph(`Yearly average: ${yAvg != null ? yAvg.toFixed(2) : "—"}    Credits: ${credits(list).toFixed(2)}`, 9);
  }

  doc.heading("Credits toward graduation");
  doc.creditBar(grad.progress.earned, grad.progress.inProgress, grad.progress.totalRequired);
  if (done.some((c) => c.is_transfer)) {
    doc.paragraph("(T) = transfer credit from another school. Counted in credits, not in the MCA GPA or average.", 8.5);
  }
  doc.paragraph(
    "Grading scale: 98-100 A+, 96-97 A, 94-95 A-, 92-93 B+, 90-91 B, 88-89 B-, 86-87 C+, 83-85 C, 80-82 C-, 76-79 D+, 74-75 D, 0-73 F.",
    8.5,
  );
  doc.ensure(60);
  doc.y -= 34;
  doc.page.drawRectangle({ x: doc.M, y: doc.y, width: 240, height: 0.8, color: rgb(0.2, 0.2, 0.2) });
  doc.text("Administrator's signature", doc.M, doc.y - 12, 9, doc.regular, GREY);
  doc.page.drawRectangle({ x: doc.W - doc.M - 150, y: doc.y, width: 150, height: 0.8, color: rgb(0.2, 0.2, 0.2) });
  doc.text("Date", doc.W - doc.M - 150, doc.y - 12, 9, doc.regular, GREY);
  return { bytes: await doc.finish(), filename: `${fileSlug(student.student_name)}-transcript.pdf` };
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

export function diplomaEligible(p: { earned: number; totalRequired: number; remainingBySubject: unknown[]; electivesRemaining: number }): boolean {
  return p.earned + 0.001 >= p.totalRequired && p.remainingBySubject.length === 0 && p.electivesRemaining <= 0.001;
}

async function diploma(
  admin: SupabaseClient,
  student: StudentRow,
  opts: { preview: boolean; isAdmin: boolean; graduationDate: string | null },
): Promise<{ bytes: Uint8Array; filename: string } | { error: string; status: number }> {
  const grad = await loadGraduation(admin, student.id);
  const eligible = diplomaEligible(grad.progress);
  if (!eligible && !(opts.isAdmin && opts.preview)) {
    return {
      error: `The diploma unlocks once all graduation requirements are met (${grad.progress.earned.toFixed(2)} of ${grad.progress.totalRequired.toFixed(0)} credits earned so far).`,
      status: 409,
    };
  }
  const dateIso = opts.isAdmin && opts.graduationDate && /^\d{4}-\d{2}-\d{2}$/.test(opts.graduationDate) ? opts.graduationDate : todayCentral();
  const [y, m, d] = dateIso.split("-").map(Number);
  const monthName = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });

  const pdf = await PDFDocument.create();
  pdf.setTitle(safe(`Diploma - ${student.student_name}`));
  pdf.setAuthor(SCHOOL_NAME);
  pdf.setCreator(SCHOOL_WEB);
  const W = 792;
  const H = 612;
  const page = pdf.addPage([W, H]);
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const serifItalic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const script = await pdf.embedFont(StandardFonts.TimesRomanBoldItalic);
  let logo: PDFImage | null = null;
  try {
    const res = await fetch(LOGO_URL, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      logo = bytes[0] === 0x89 ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    }
  } catch (_err) {
    logo = null;
  }

  // Borders
  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: rgb(0.995, 0.99, 0.97) });
  page.drawRectangle({ x: 22, y: 22, width: W - 44, height: H - 44, borderColor: NAVY, borderWidth: 6 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: GOLD, borderWidth: 2 });
  page.drawRectangle({ x: 40, y: 40, width: W - 80, height: H - 80, borderColor: GOLD, borderWidth: 0.6 });

  const center = (text: string, y: number, size: number, font: PDFFont, color = rgb(0.1, 0.1, 0.18)) => {
    const t = safe(text);
    const w = font.widthOfTextAtSize(t, size);
    page.drawText(t, { x: (W - w) / 2, y, size, font, color });
  };
  const fitSize = (text: string, font: PDFFont, max: number, start: number) => {
    let size = start;
    while (size > 18 && font.widthOfTextAtSize(safe(text), size) > max) size -= 1;
    return size;
  };

  let top = H - 70;
  if (logo) {
    const h = 64;
    const w = (logo.width / logo.height) * h;
    page.drawImage(logo, { x: (W - w) / 2, y: top - h, width: w, height: h });
    top -= h + 14;
  }
  center(SCHOOL_NAME, top - 26, 32, serifBold, NAVY);
  center(SCHOOL_ADDRESS, top - 46, 11, serifItalic, GREY);
  center("This certifies that", top - 88, 16, serifItalic);
  const nameSize = fitSize(student.student_name, script, W - 200, 44);
  center(student.student_name, top - 140, nameSize, script, NAVY);
  page.drawRectangle({ x: 170, y: top - 150, width: W - 340, height: 0.8, color: GOLD });
  center("has satisfactorily completed the course of study prescribed for graduation", top - 180, 14, serif);
  center("from High School and is therefore awarded this", top - 199, 14, serif);
  center("DIPLOMA", top - 246, 40, serifBold, NAVY);
  center(
    `Given this ${ordinal(d)} day of ${monthName}, ${y}, with ${grad.progress.earned.toFixed(2)} credits earned.`,
    top - 274,
    13,
    serifItalic,
  );

  // Signature lines
  const lineY = 92;
  page.drawRectangle({ x: 110, y: lineY, width: 220, height: 0.8, color: rgb(0.2, 0.2, 0.2) });
  page.drawRectangle({ x: W - 330, y: lineY, width: 220, height: 0.8, color: rgb(0.2, 0.2, 0.2) });
  const under = (text: string, x: number) => {
    const t = safe(text);
    page.drawText(t, { x: x + (220 - serif.widthOfTextAtSize(t, 11)) / 2, y: lineY - 15, size: 11, font: serif, color: GREY });
  };
  under("Administrator", 110);
  under("Date", W - 330);
  center(`${SCHOOL_PHONE}  ·  ${SCHOOL_WEB}`, 52, 9, serif, GREY);

  if (!eligible) {
    const mark = "SAMPLE - NOT YET ELIGIBLE";
    const size = 46;
    const w = serifBold.widthOfTextAtSize(mark, size);
    page.drawText(mark, {
      x: W / 2 - (w / 2) * Math.cos(Math.PI / 9),
      y: H / 2 - (w / 2) * Math.sin(Math.PI / 9),
      size,
      font: serifBold,
      color: rgb(0.85, 0.2, 0.2),
      opacity: 0.28,
      rotate: degrees(20),
    });
  }

  return {
    bytes: await pdf.save(),
    filename: `${fileSlug(student.student_name)}-diploma${eligible ? "" : "-sample"}.pdf`,
  };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Sign in first." }, 401);

  let body: { kind?: string; student_id?: string; school_year?: string; period?: string; preview?: boolean; graduation_date?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const studentId = String(body.student_id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) return json({ error: "Pick a student first." }, 400);

  // Access check through the caller's own RLS.
  const userClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: auth } },
  });
  const { data: visible } = await userClient.from("students").select("id").eq("id", studentId).maybeSingle();
  if (!visible) return json({ error: "You don't have access to this student." }, 403);

  const admin = service();
  const { data: student } = await admin
    .from("students")
    .select("id, student_name, gender, birthdate, last_grade_completed, family_id")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) return json({ error: "Student not found." }, 404);

  try {
    let out: { bytes: Uint8Array; filename: string };
    if (body.kind === "transcript") {
      out = await transcript(admin, student as StudentRow);
    } else if (body.kind === "diploma") {
      const { data: isAdmin } = await userClient.rpc("is_admin");
      const result = await diploma(admin, student as StudentRow, {
        preview: body.preview === true,
        isAdmin: !!isAdmin,
        graduationDate: typeof body.graduation_date === "string" ? body.graduation_date : null,
      });
      if ("error" in result) return json({ error: result.error }, result.status);
      out = result;
    } else if (body.kind === "progress") {
      const schoolYear = /^\d{4}-\d{2}$/.test(body.school_year ?? "") ? body.school_year! : currentSchoolYear();
      const period = (["S1", "S2", "year"].includes(body.period ?? "") ? body.period : currentReportPeriod()) as ReportPeriod;
      out = await progressReport(admin, student as StudentRow, schoolYear, period);
    } else {
      return json({ error: "Unknown report type." }, 400);
    }
    return new Response(out.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    console.error("student-records-pdf failed", err);
    return json({ error: "Couldn't build the PDF. Please try again." }, 500);
  }
});
