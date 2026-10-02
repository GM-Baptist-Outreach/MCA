import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { FileText, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import type { PortalContext } from "./PortalLayout";
import { FormSubmissionCard, type FormSubmission } from "../admin/AdminFamilyDetail";

// MCA_R4_SUBMITTED_FORMS: read-only list of everything this family submitted.
// RLS (parent_select_own_form_submissions) limits rows to the signed-in
// parent's own family; the explicit family_id filter keeps admins who are
// also parents scoped to their own family.
interface SubmittedRow extends FormSubmission {
  student_id: string | null;
  created_at: string;
}

const UPDATABLE_FORMS = new Set(["pe_activity_log", "music_practice_verification", "goal_card"]);

function SubmittedForms() {
  const { family, students } = useOutletContext<PortalContext>();
  const [rows, setRows] = useState<SubmittedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [studentFilter, setStudentFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const { data, error: loadError } = await supabase
        .from("form_submissions")
        .select("id, student_id, form_type, submitted_data, signer_name, signed_at, created_at")
        .eq("family_id", family.id)
        .order("signed_at", { ascending: false });
      if (cancelled) return;
      if (loadError) setError(loadError.message);
      setRows((data ?? []) as SubmittedRow[]);
      setLoading(false);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [family.id]);

  const studentName = (id: string | null) =>
    students.find((s) => s.id === id)?.student_name ?? "Whole family";
  const visible = rows.filter((row) => studentFilter === "all" || row.student_id === studentFilter);

  return (
    <section className="space-y-3" data-marker="MCA_R4_SUBMITTED_FORMS" data-tour="portal-submitted-forms">
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xl font-bold font-serif text-primary">Submitted forms</h3>
          <p className="text-sm text-foreground/60">
            Everything your family has sent us. Click a form to see what was submitted.
          </p>
        </div>
        {students.length > 1 && (
          <select
            value={studentFilter}
            onChange={(event) => setStudentFilter(event.target.value)}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            aria-label="Filter by student"
          >
            <option value="all">All students</option>
            {students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.student_name}
              </option>
            ))}
          </select>
        )}
      </div>
      {loading ? (
        <p className="text-sm text-foreground/60">Loading...</p>
      ) : error ? (
        <p className="text-sm text-destructive">Couldn't load your submitted forms: {error}</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-foreground/60">No forms submitted yet.</p>
      ) : (
        <div className="space-y-2">
          {visible.map((row) => (
            <FormSubmissionCard
              key={row.id}
              submission={row}
              hideRaw
              subtitle={`${studentName(row.student_id)} · ${
                UPDATABLE_FORMS.has(row.form_type) ? "Submitted (you can keep updating it)" : "Submitted"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

const FORMS = [
  {
    slug: "enrollment-agreement",
    title: "Enrollment Agreement",
    description:
      "The signed agreement covering tuition responsibility and PACE supervision.",
  },
  {
    slug: "records-release",
    title: "Student Records Release",
    description: "Request academic records be released to a new school.",
  },
  {
    slug: "honesty-policy",
    title: "Honesty Policy",
    description: "Signed acknowledgment of MCA's academic honesty policy.",
  },
  {
    slug: "goal-card",
    title: "Weekly Goal Card",
    description:
      "Daily page-number goals per subject, mark complete as you go.",
  },
  {
    slug: "pe-log",
    title: "P.E. Activity Log",
    description:
      "Track physical activity days toward the 2-hour weekly credit requirement.",
  },
  {
    slug: "music-verification",
    title: "Music Practice Verification",
    description:
      "Weekly practice minutes and quarterly performance verification for high school music credit.",
  },
  {
    slug: "course-verification",
    title: "Elementary Course Verification",
    description:
      "Subject grades and attendance summary when a course is completed.",
  },
];

export default function PortalForms() {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold font-serif text-primary">Forms</h2>
      <div className="space-y-3" data-tour="portal-forms-list">
        {FORMS.map((form) => (
          <Link
            key={form.slug}
            to={`/portal/forms/${form.slug}`}
            className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/30 p-5 hover:bg-secondary/50 transition-colors"
          >
            <div className="flex items-start gap-3">
              <FileText className="h-5 w-5 text-primary mt-0.5" />
              <div>
                <p className="font-semibold text-foreground">{form.title}</p>
                <p className="text-sm text-foreground/60">{form.description}</p>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-foreground/40" />
          </Link>
        ))}
      </div>
      <SubmittedForms />
    </div>
  );
}
