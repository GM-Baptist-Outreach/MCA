import { Link } from "react-router-dom";
import { FileText, ChevronRight } from "lucide-react";

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
      <div className="space-y-3">
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
    </div>
  );
}
