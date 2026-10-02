import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
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
// MCA_R6_TOUR_ENGINE: interactive spotlight walkthrough, shared by the parent
// portal (below) and the admin side (AdminLayout imports SpotlightTour and the
// tour cache helpers from this file; AI Studio can't add new files).
//
// Each step can switch routes, then waits for its target element
// (data-tour="...") to appear. The rest of the page is dimmed with a cutout
// and ring around the target, the target is scrolled into view, and a card
// with the step sits next to it. A step can list fallback targets (used if
// the first one doesn't show up quickly, e.g. a button that only exists with
// data). If nothing appears in time, the card is centered. On small screens
// the card docks to the top or bottom edge, away from the target.
// ---------------------------------------------------------------------------

export interface SpotlightStep {
  id: string;
  title: string;
  body: string;
  /** Route to open before looking for the target. */
  route?: string;
  /** data-tour value(s). The first is preferred; later ones are fallbacks. */
  target?: string | string[];
}

const TOUR_WAIT_MS = 10000;
const TOUR_FALLBACK_GRACE_MS = 1500;
const TOUR_PAD = 6;
const TOUR_MARGIN = 12;
const TOUR_DIM = "rgba(15, 23, 42, 0.55)";

interface TourRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function tourTargets(step: SpotlightStep | undefined): string[] {
  if (!step?.target) return [];
  return Array.isArray(step.target) ? step.target : [step.target];
}

function visibleTourElement(key: string): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${key}"]`);
  for (const el of Array.from(nodes)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && window.getComputedStyle(el).visibility !== "hidden") {
      return el;
    }
  }
  return null;
}

function findTourTarget(targets: string[], elapsed: number): HTMLElement | null {
  for (let i = 0; i < targets.length; i++) {
    const el = visibleTourElement(targets[i]);
    if (el && (i === 0 || elapsed >= TOUR_FALLBACK_GRACE_MS)) return el;
  }
  return null;
}

// Per-user "tour dismissed" cache in this browser's localStorage.
export function readTourCache(prefix: string, userId: string): string | null {
  try {
    return window.localStorage.getItem(prefix + userId);
  } catch {
    return null;
  }
}

export function writeTourCache(prefix: string, userId: string, at: string = new Date().toISOString()) {
  try {
    window.localStorage.setItem(prefix + userId, at);
  } catch {
    // Private browsing can block storage. The account copy still applies.
  }
}

// Valid ISO timestamp from the local cache, or now (older/odd values).
export function tourTimestamp(value: string | null): string {
  if (value && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}

export function SpotlightTour({
  open,
  steps,
  onClose,
  name,
  startAt,
  onStepChange,
}: {
  open: boolean;
  steps: SpotlightStep[];
  onClose: () => void;
  name: string;
  /** Step id to start from (e.g. a Help Center "Show me" button). */
  startAt?: string | null;
  /** Called when a step opens, before its target is looked up (e.g. to open a phone menu). */
  onStepChange?: (step: SpotlightStep) => void;
}) {
  const navigate = useNavigate();
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [searching, setSearching] = useState(false);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [cardSize, setCardSize] = useState({ w: 360, h: 200 });
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setIndex(Math.max(0, startAt ? steps.findIndex((s) => s.id === startAt) : 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startAt]);

  const safeIndex = Math.min(index, Math.max(steps.length - 1, 0));
  const step = open && steps.length > 0 ? steps[safeIndex] : undefined;
  const stepKey = step ? `${safeIndex}:${step.id}` : "";
  const last = safeIndex >= steps.length - 1;

  // Switch routes for the step, then wait for its target to appear.
  useEffect(() => {
    if (!step) return;
    setTarget(null);
    setRect(null);
    onStepChange?.(step); // MCA_R7_TOUR_STEP_HOOK
    if (step.route && window.location.pathname !== step.route) navigate(step.route);
    const targets = tourTargets(step);
    if (targets.length === 0) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const started = Date.now();
    let lastNavigate = started;
    let timer: number | undefined;
    const tick = () => {
      const elapsed = Date.now() - started;
      const onRoute = !step.route || window.location.pathname === step.route;
      // A page redirect (e.g. /admin/backorders -> /admin/pick-lists) can land after our
      // navigation; ask again until the step's route sticks.
      if (!onRoute && step.route && Date.now() - lastNavigate > 700) {
        lastNavigate = Date.now();
        navigate(step.route);
      }
      const el = onRoute ? findTourTarget(targets, elapsed) : null;
      if (el) {
        // Tall targets (a whole card) are aligned to the top so their start shows.
        const tall = el.getBoundingClientRect().height > window.innerHeight * 0.6;
        el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: "smooth" });
        setTarget(el);
        setSearching(false);
        return;
      }
      if (elapsed >= TOUR_WAIT_MS) {
        setSearching(false); // Not found: the card is shown centered.
        return;
      }
      timer = window.setTimeout(tick, 100);
    };
    tick();
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey]);

  // Follow the target while the page scrolls, resizes, or re-renders.
  useEffect(() => {
    if (!open) return;
    let el = target;
    const key = target?.getAttribute("data-tour") ?? null;
    let raf = 0;
    const loop = () => {
      setViewport((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev
          : { w: window.innerWidth, h: window.innerHeight },
      );
      if (el && !el.isConnected && key) el = visibleTourElement(key);
      if (el) {
        const r = el.getBoundingClientRect();
        setRect((prev) =>
          prev && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height
            ? prev
            : { top: r.top, left: r.left, width: r.width, height: r.height },
        );
      }
      raf = window.requestAnimationFrame(loop);
    };
    loop();
    return () => window.cancelAnimationFrame(raf);
  }, [open, target]);

  useLayoutEffect(() => {
    const node = cardRef.current;
    if (!node) return;
    const r = node.getBoundingClientRect();
    if (Math.abs(r.width - cardSize.w) > 1 || Math.abs(r.height - cardSize.h) > 1) {
      setCardSize({ w: r.width, h: r.height });
    }
  });

  const next = () => (last ? onClose() : setIndex((i) => Math.min(i + 1, steps.length - 1)));
  const back = () => setIndex((i) => Math.max(i - 1, 0));

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!step) return null;

  const hole = target && rect && rect.width > 0 && rect.height > 0 ? rect : null;
  const small = viewport.w < 640;
  const width = Math.min(360, viewport.w - TOUR_MARGIN * 2);
  let cardStyle: CSSProperties;
  if (!hole) {
    cardStyle = {
      width,
      left: Math.max(TOUR_MARGIN, (viewport.w - width) / 2),
      top: Math.max(TOUR_MARGIN, (viewport.h - cardSize.h) / 2),
    };
  } else if (small) {
    // Tall targets (a whole card or the phone menu) are scrolled to their top,
    // so the card docks at the bottom to keep the start of the target visible.
    const targetMiddle = hole.top + hole.height / 2;
    const tall = hole.height > viewport.h * 0.6;
    cardStyle =
      tall || targetMiddle < viewport.h / 2
        ? { left: TOUR_MARGIN, right: TOUR_MARGIN, bottom: TOUR_MARGIN }
        : { left: TOUR_MARGIN, right: TOUR_MARGIN, top: TOUR_MARGIN };
  } else {
    const below = hole.top + hole.height + TOUR_PAD + TOUR_MARGIN;
    const above = hole.top - TOUR_PAD - TOUR_MARGIN - cardSize.h;
    let top: number;
    if (below + cardSize.h <= viewport.h - TOUR_MARGIN) top = below;
    else if (above >= TOUR_MARGIN) top = above;
    else top = Math.max(TOUR_MARGIN, viewport.h - cardSize.h - TOUR_MARGIN);
    const left = Math.min(
      Math.max(TOUR_MARGIN, hole.left),
      Math.max(TOUR_MARGIN, viewport.w - width - TOUR_MARGIN),
    );
    cardStyle = { width, top, left };
  }

  return createPortal(
    <div
      data-marker="MCA_R6_SPOTLIGHT_TOUR"
      data-tour-name={name}
      data-tour-step={step.id}
      data-tour-target={hole ? target?.getAttribute("data-tour") ?? "none" : "none"}
      className="print:hidden"
    >
      {/* Blocks clicks on the page while the tour is open. */}
      <div
        aria-hidden="true"
        className="fixed inset-0"
        style={{ zIndex: 1000, background: hole ? "transparent" : TOUR_DIM }}
      />
      {hole && (
        <div
          aria-hidden="true"
          data-tour-spotlight=""
          className="pointer-events-none fixed rounded-lg"
          style={{
            zIndex: 1001,
            top: hole.top - TOUR_PAD,
            left: hole.left - TOUR_PAD,
            width: hole.width + TOUR_PAD * 2,
            height: hole.height + TOUR_PAD * 2,
            boxShadow: `0 0 0 2px #fff, 0 0 0 5px hsl(var(--primary)), 0 0 0 9999px ${TOUR_DIM}`,
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mca-tour-title"
        className="fixed rounded-xl border border-border bg-background p-5 shadow-2xl"
        style={{ zIndex: 1002, ...cardStyle }}
      >
        <p className="text-xs uppercase tracking-wide text-foreground/50">
          Step {safeIndex + 1} of {steps.length}
        </p>
        <h2 id="mca-tour-title" className="mt-1 font-serif text-lg font-bold text-primary">
          {step.title}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-foreground/80">{step.body}</p>
        {searching && (
          <p className="mt-2 text-xs text-foreground/50">Finding this on the page...</p>
        )}
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            {last ? "Close" : "Skip tour"}
          </Button>
          <div className="flex gap-2">
            {safeIndex > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={back}>
                Back
              </Button>
            )}
            <Button type="button" size="sm" onClick={next}>
              {last ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// MCA_R4_WELCOME_TOUR / MCA_R6_PORTAL_TOUR: parent portal walkthrough.
// Dismissal is remembered per parent account in families.tour_dismissed_at
// (MCA_R5_TOUR_DISMISS_DB), so it follows the parent to any browser or device.
// This browser's localStorage (keyed by auth user id) is kept as a fast cache
// and as a fallback if the database write fails; a local-only dismissal is
// synced up to the account on the next portal load. "Tour" in the nav
// replays it any time.
// ---------------------------------------------------------------------------

const TOUR_STORAGE_PREFIX = "mca_portal_tour_dismissed_v1:";

function localTourDismissedAt(userId: string): string | null {
  return readTourCache(TOUR_STORAGE_PREFIX, userId);
}

export function tourDismissed(userId: string): boolean {
  return localTourDismissedAt(userId) != null;
}

function rememberTourDismissed(userId: string, at: string = new Date().toISOString()) {
  writeTourCache(TOUR_STORAGE_PREFIX, userId, at);
}

const toTimestamp = tourTimestamp;

// Saves the dismissal on the parent's own families row (RLS:
// parent_update_own_family). Only fills it in when still empty, so replaying
// the tour later keeps the first dismissal time. Returns true on success.
async function saveTourDismissedToAccount(familyId: string, at: string): Promise<boolean> {
  const { error } = await supabase
    .from("families")
    .update({ tour_dismissed_at: at })
    .eq("id", familyId)
    .is("tour_dismissed_at", null);
  if (error) {
    console.error("Couldn't save tour dismissal to account", error);
    return false;
  }
  return true;
}

export function portalTourSteps(showProjection: boolean): SpotlightStep[] {
  const steps: SpotlightStep[] = [
    {
      id: "welcome",
      title: "Welcome to your Parent Portal",
      body:
        "This quick tour points out the parts of the portal you'll use most. If you have more than one student, pick who you're working with here, and every page follows that choice.",
      route: PORTAL_ROUTE,
      target: ["portal-student-switcher", "portal-home"],
    },
    {
      id: "upload",
      title: "Upload Tests",
      body:
        "When your student finishes a PACE test, upload photos of the test pages and the score here. We review each one, and up-to-date scores keep the next shipment on schedule.",
      route: `${PORTAL_ROUTE}/progress`,
      target: ["portal-upload-button", "portal-nav-upload"],
    },
    {
      id: "pace-status",
      title: "PACE Status",
      body:
        "This page lists every PACE for the school year and where it is: not shipped yet, shipped, received, handed out, or scored. Mark a PACE Issued when you give it to your student.",
      route: `${PORTAL_ROUTE}/pace-status`,
      target: ["portal-pace-status"],
    },
    {
      id: "receive-all",
      title: "Receive All",
      body:
        "When a box from MCA arrives, click Receive All to mark everything in it as received in one step. The button appears whenever something has shipped.",
      route: `${PORTAL_ROUTE}/pace-status`,
      target: ["portal-receive-all"],
    },
  ];
  if (showProjection) {
    steps.push({
      id: "projection",
      title: "Academic Projection",
      body:
        "For high school students, this shows finished courses, current courses, and the credits still needed to graduate. You can print it for your records.",
      target: ["portal-nav-projection"],
    });
  }
  steps.push(
    {
      id: "store",
      title: "The MCA store",
      body:
        "Need an extra PACE, a score key, or a resource book? Order it from the store and have it shipped home or pick it up.",
      target: ["portal-nav-store"],
    },
    {
      id: "reports",
      title: "Supervisor Report and Report Card",
      body:
        "These show your student's courses and scores in a printable report. Open either one any time you need a copy.",
      target: ["portal-nav-reports"],
    },
    {
      id: "forms",
      title: "Forms",
      body:
        "The enrollment agreement, goal cards, P.E. logs, and other school forms are here. Click a form to fill it out and send it to us.",
      route: `${PORTAL_ROUTE}/forms`,
      target: ["portal-forms-list"],
    },
    {
      id: "submitted-forms",
      title: "Submitted forms",
      body: "Everything you've already sent us is listed here, so you can see what's done.",
      route: `${PORTAL_ROUTE}/forms`,
      target: ["portal-submitted-forms"],
    },
    {
      id: "replay",
      title: "Watch this again any time",
      body:
        "Click Tour to replay this walkthrough. Questions? Call us at (844) 663-4477.",
      target: ["portal-tour-button"],
    },
  );
  return steps;
}

export interface PortalFamily {
  id: string;
  parent_name: string;
  second_parent_name: string | null;
  email: string;
  phone: string;
  address: string | null;
  tour_dismissed_at?: string | null;
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
  // True once the account (families.tour_dismissed_at) has the dismissal.
  const [tourSavedToAccount, setTourSavedToAccount] = useState(false);

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
        .select("id, parent_name, second_parent_name, email, phone, address, tour_dismissed_at")
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

      // Welcome tour: show it only if this account hasn't dismissed it.
      const userId = currentSession.user.id;
      const accountDismissedAt = familyRes.data.tour_dismissed_at ?? null;
      const localDismissedAt = localTourDismissedAt(userId);
      if (accountDismissedAt) {
        // Dismissed on the account (maybe on another device): refresh the cache.
        setTourSavedToAccount(true);
        if (!localDismissedAt) rememberTourDismissed(userId, accountDismissedAt);
      } else if (localDismissedAt) {
        // Dismissed in this browser only: sync it up to the account.
        const familyId = familyRes.data.id;
        saveTourDismissedToAccount(familyId, toTimestamp(localDismissedAt)).then((ok) => {
          if (ok) setTourSavedToAccount(true);
        });
      } else {
        setTourOpen(true);
      }
      setChecking(false);
    };
    init();
  }, []);

  const closeTour = () => {
    setTourOpen(false);
    if (!session?.user?.id) return;
    const at = new Date().toISOString();
    if (!tourDismissed(session.user.id)) rememberTourDismissed(session.user.id, at);
    if (family && !tourSavedToAccount) {
      saveTourDismissedToAccount(family.id, at).then((ok) => {
        if (ok) setTourSavedToAccount(true);
      });
    }
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
            <h1 className="text-xl font-bold font-serif text-primary" data-tour="portal-home">
              MCA Parent Portal
            </h1>
            <nav className="flex items-center gap-2 flex-wrap">
              <NavLink to={PORTAL_ROUTE} end className={navLinkClass}>
                Home
              </NavLink>
              <NavLink
                to={`${PORTAL_ROUTE}/progress`}
                className={navLinkClass}
                data-tour="portal-nav-upload"
              >
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
                  data-tour="portal-nav-projection"
                >
                  Academic Projection
                </NavLink>
              )}
              <span className="inline-flex items-center gap-2 flex-wrap" data-tour="portal-nav-reports">
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
              </span>
              <NavLink
                to={`${PORTAL_ROUTE}/star-chart`}
                className={navLinkClass}
              >
                Star Chart
              </NavLink>
              <NavLink to={`${PORTAL_ROUTE}/forms`} className={navLinkClass}>
                Forms
              </NavLink>
              <NavLink to="/store" className={navLinkClass} data-tour="portal-nav-store">
                Store
              </NavLink>
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className="px-4 py-2 rounded-lg text-sm font-medium text-foreground/70 hover:bg-secondary transition-colors"
                data-marker="MCA_R4_TOUR_LINK"
                data-tour="portal-tour-button"
                title="Replay the portal tour"
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
            <div className="flex items-center gap-2 w-fit" data-tour="portal-student-switcher">
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
      <SpotlightTour
        name="portal"
        open={tourOpen}
        onClose={closeTour}
        steps={portalTourSteps(
          !!selectedStudent && highSchoolIds.includes(selectedStudent.id),
        )}
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
