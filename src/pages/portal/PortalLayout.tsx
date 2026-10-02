import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PORTAL_ROUTE = "/portal";
const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

// ---------------------------------------------------------------------------
// MCA_R4_WELCOME_TOUR: first-login walkthrough. Dismissal is remembered per
// login (auth user id) in this browser's localStorage. "Tour" in the nav
// reopens it any time.
// ---------------------------------------------------------------------------

const TOUR_STORAGE_PREFIX = "mca_portal_tour_dismissed_v1:";

export function tourDismissed(userId: string): boolean {
  try {
    return window.localStorage.getItem(TOUR_STORAGE_PREFIX + userId) != null;
  } catch {
    return false;
  }
}

function rememberTourDismissed(userId: string) {
  try {
    window.localStorage.setItem(TOUR_STORAGE_PREFIX + userId, new Date().toISOString());
  } catch {
    // Private browsing can block storage. The tour just shows again next time.
  }
}

interface TourStep {
  title: string;
  body: string[];
  link?: { to: string; label: string };
}

function tourSteps(showProjection: boolean): TourStep[] {
  const steps: TourStep[] = [
    {
      title: "Welcome to the MCA Parent Portal",
      body: [
        "This quick tour shows the parts of the portal families use most. It takes about a minute.",
        "If you have more than one student, pick who you're working with from the Student menu at the top. Every page follows that choice.",
      ],
    },
    {
      title: "Upload Tests",
      body: [
        "When your student finishes a PACE test, take clear photos of all the test pages and upload them under Upload Tests. Pick the subject and PACE number, enter the test date and score, and attach the photos.",
        "We review each test and record the score. Keeping scores up to date keeps the next PACE shipment on schedule.",
      ],
      link: { to: `${PORTAL_ROUTE}/progress`, label: "Open Upload Tests" },
    },
    {
      title: "PACE Status and Receive All",
      body: [
        "PACE Status shows every PACE for the school year and where it is: prescribed, shipped, received, handed out, or scored.",
        "When a box from MCA arrives, click Receive All to mark everything in it as received in one step. When you hand a PACE to your student, mark it Issued.",
      ],
      link: { to: `${PORTAL_ROUTE}/pace-status`, label: "Open PACE Status" },
    },
    {
      title: "The MCA store",
      body: [
        "Need an extra PACE, a score key, or a resource book? The MCA store has them. You can ship to your home or pick up locally.",
        "When upcoming PACEs need a book that isn't in your shipment, we email you a link that opens the store with the right books already in your cart.",
      ],
      link: { to: "/store", label: "Visit the store" },
    },
  ];
  steps.push({
    title: "Academic Projection (high school)",
    body: [
      "For high school students, Academic Projection shows completed courses, current courses, and what's still needed to graduate, with credits. You can print it for your records.",
      showProjection
        ? "Find it in the menu at the top while a high school student is selected."
        : "It appears in the menu at the top when a high school student is selected.",
    ],
    link: showProjection ? { to: `${PORTAL_ROUTE}/projection`, label: "Open Academic Projection" } : undefined,
  });
  steps.push({
    title: "Forms, and you're all set",
    body: [
      "Forms has the enrollment agreement, goal cards, P.E. logs, and other forms. Everything you've already sent us is listed under Submitted forms on that page.",
      "You can reopen this tour any time with the Tour button at the top. Questions? Call (844) 663-4477.",
    ],
    link: { to: `${PORTAL_ROUTE}/forms`, label: "Open Forms" },
  });
  return steps;
}

export function WelcomeTour({
  open,
  onClose,
  showProjection,
}: {
  open: boolean;
  onClose: () => void;
  showProjection: boolean;
}) {
  const navigate = useNavigate();
  const steps = tourSteps(showProjection);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-lg" data-marker="MCA_R4_WELCOME_TOUR">
        <DialogHeader>
          <p className="text-xs uppercase tracking-wide text-foreground/50">
            Step {index + 1} of {steps.length}
          </p>
          <DialogTitle className="font-serif text-primary">{step.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-foreground/80">
              {step.body.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          </DialogDescription>
        </DialogHeader>
        {step.link && (
          <button
            type="button"
            className="text-sm text-primary underline underline-offset-2 text-left w-fit"
            onClick={() => {
              onClose();
              navigate(step.link!.to);
            }}
          >
            {step.link.label}
          </button>
        )}
        <div className="flex justify-center gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-6 rounded-full ${i === index ? "bg-primary" : "bg-secondary"}`}
            />
          ))}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="ghost" onClick={onClose}>
            {last ? "Close" : "Skip tour"}
          </Button>
          <div className="flex gap-2 justify-end">
            {index > 0 && (
              <Button type="button" variant="outline" onClick={() => setIndex((i) => i - 1)}>
                Back
              </Button>
            )}
            {last ? (
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            ) : (
              <Button type="button" onClick={() => setIndex((i) => i + 1)}>
                Next
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export interface PortalFamily {
  id: string;
  parent_name: string;
  second_parent_name: string | null;
  email: string;
  phone: string;
  address: string | null;
}

export interface PortalStudent {
  id: string;
  student_name: string;
  gender: string | null;
  birthdate: string | null;
  last_grade_completed: string | null;
}

export interface PortalContext {
  family: PortalFamily;
  students: PortalStudent[];
  selectedStudent: PortalStudent | null;
  setSelectedStudentId: (id: string) => void;
}

const PortalLayout = () => {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [family, setFamily] = useState<PortalFamily | null>(null);
  const [students, setStudents] = useState<PortalStudent[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string>("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [highSchoolIds, setHighSchoolIds] = useState<string[]>([]);
  const [tourOpen, setTourOpen] = useState(false);

  useEffect(() => {
    const init = async () => {
      const {
        data: { session: currentSession },
      } = await supabase.auth.getSession();
      setSession(currentSession);

      if (!currentSession) {
        setChecking(false);
        return;
      }

      // Idempotent — claims this family record on first login, no-ops after.
      const linkRes = await fetch(
        `${SUPABASE_URL}/functions/v1/link-parent-account`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${currentSession.access_token}` },
        },
      );
      const linkResult = await linkRes.json();

      if (!linkRes.ok || linkResult.error) {
        setLinkError(
          linkResult.error ?? "Couldn't access your portal account.",
        );
        setChecking(false);
        return;
      }

      // Filter explicitly by auth_user_id/family_id here rather than relying
      // on RLS alone to narrow the result. RLS also grants admins visibility
      // into every families/students row (admin_full_access), so a user who
      // is BOTH an admin and a linked parent — like an owner testing their
      // own account — would otherwise get every family back instead of just
      // theirs, and .single() would fail exactly like this.
      const familyRes = await supabase
        .from("families")
        .select("id, parent_name, second_parent_name, email, phone, address")
        .eq("auth_user_id", currentSession.user.id)
        .maybeSingle();

      if (familyRes.data) {
        setFamily(familyRes.data as PortalFamily);
      } else if (familyRes.error) {
        console.error("Portal family lookup failed", familyRes.error);
        setLinkError(
          `Couldn't load your family record: ${familyRes.error.message}`,
        );
        setChecking(false);
        return;
      } else {
        setLinkError("We couldn't find a family record linked to this login.");
        setChecking(false);
        return;
      }

      const studentsRes = await supabase
        .from("students")
        .select("id, student_name, gender, birthdate, last_grade_completed")
        .eq("family_id", familyRes.data.id)
        .order("student_name");

      if (studentsRes.data) {
        setStudents(studentsRes.data as PortalStudent[]);
        if (studentsRes.data.length > 0)
          setSelectedStudentId(studentsRes.data[0].id);
        // Round 3 P1: Academic Projection link only for high school students.
        const ids = studentsRes.data.map((s) => s.id);
        if (ids.length > 0) {
          const hsRes = await supabase
            .from("enrollments")
            .select("student_id")
            .in("student_id", ids)
            .eq("tuition_tier", "high_school");
          setHighSchoolIds(
            Array.from(new Set((hsRes.data ?? []).map((r) => r.student_id as string))),
          );
        }
      } else if (studentsRes.error) {
        console.error("Portal students lookup failed", studentsRes.error);
      }

      // First login in this browser for this parent: show the welcome tour.
      if (!tourDismissed(currentSession.user.id)) setTourOpen(true);
      setChecking(false);
    };
    init();
  }, []);

  const closeTour = () => {
    if (session?.user?.id) rememberTourDismissed(session.user.id);
    setTourOpen(false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate(`${PORTAL_ROUTE}/login`, { replace: true });
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-foreground/60">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to={`${PORTAL_ROUTE}/login`} replace />;
  }

  if (linkError || !family) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm space-y-4">
          <p className="text-foreground/80">
            {linkError ?? "We couldn't find your account."}
          </p>
          <button
            onClick={handleLogout}
            className="px-4 py-2 rounded-lg text-sm font-medium text-foreground/70 hover:bg-secondary transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>
    );
  }

  const selectedStudent =
    students.find((s) => s.id === selectedStudentId) ?? null;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-foreground/70 hover:bg-secondary"
    }`;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-secondary/50 print:hidden">
        <div className="max-w-5xl mx-auto px-4 py-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <h1 className="text-xl font-bold font-serif text-primary">
              MCA Parent Portal
            </h1>
            <nav className="flex items-center gap-2 flex-wrap">
              <NavLink to={PORTAL_ROUTE} end className={navLinkClass}>
                Home
              </NavLink>
              <NavLink to={`${PORTAL_ROUTE}/progress`} className={navLinkClass}>
                Upload Tests
              </NavLink>
              <NavLink
                to={`${PORTAL_ROUTE}/pace-status`}
                className={navLinkClass}
              >
                PACE Status
              </NavLink>
              {selectedStudent && highSchoolIds.includes(selectedStudent.id) && (
                <NavLink
                  to={`${PORTAL_ROUTE}/projection`}
                  className={navLinkClass}
                  data-marker="MCA_R3_P1_PORTAL_PROJECTION"
                >
                  Academic Projection
                </NavLink>
              )}
              <NavLink
                to={`${PORTAL_ROUTE}/supervisor-report`}
                className={navLinkClass}
              >
                Supervisor Report
              </NavLink>
              <NavLink
                to={`${PORTAL_ROUTE}/student-report`}
                className={navLinkClass}
              >
                Report Card
              </NavLink>
              <NavLink
                to={`${PORTAL_ROUTE}/star-chart`}
                className={navLinkClass}
              >
                Star Chart
              </NavLink>
              <NavLink to={`${PORTAL_ROUTE}/forms`} className={navLinkClass}>
                Forms
              </NavLink>
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-foreground/70 hover:bg-secondary transition-colors"
                data-marker="MCA_R4_TOUR_LINK"
                title="Reopen the welcome tour"
              >
                Tour
              </button>
              <button
                onClick={handleLogout}
                className="ml-2 px-4 py-2 rounded-lg text-sm font-medium text-foreground/70 hover:bg-secondary transition-colors"
              >
                Log Out
              </button>
            </nav>
          </div>

          {students.length > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-foreground/60 whitespace-nowrap">
                Student:
              </span>
              <Select
                value={selectedStudentId}
                onValueChange={setSelectedStudentId}
              >
                <SelectTrigger className="bg-background w-56 h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {students.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.student_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      </header>
      <WelcomeTour
        open={tourOpen}
        onClose={closeTour}
        showProjection={highSchoolIds.length > 0}
      />
      <main className="max-w-5xl mx-auto px-4 py-10">
        <Outlet
          context={
            {
              family,
              students,
              selectedStudent,
              setSelectedStudentId,
            } satisfies PortalContext
          }
        />
      </main>
    </div>
  );
};

export default PortalLayout;
