import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const PORTAL_ROUTE = "/portal";
const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

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

      setChecking(false);
    };
    init();
  }, []);

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
