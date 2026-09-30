import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

const ADMIN_ROUTE = "/admin";

const AdminLayout = () => {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(0);
  const navigate = useNavigate();

  useEffect(() => {
    const check = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setSession(session);
      if (session) {
        const { data } = await supabase.rpc("is_admin");
        setIsAdmin(!!data);
        if (data) {
          const pending = await supabase
            .from("score_reports")
            .select("id", { count: "exact", head: true })
            .eq("review_status", "pending");
          setPendingReviews(pending.count ?? 0);
        }
      }
      setChecking(false);
    };
    check();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate(`${ADMIN_ROUTE}/login`, { replace: true });
  };

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-foreground/60">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return <Navigate to={`${ADMIN_ROUTE}/login`} replace />;
  }

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center max-w-sm space-y-4">
          <p className="text-foreground/80">
            You're logged in, but this account isn't authorized for admin
            access. Contact the school if you believe this is a mistake.
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

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? "bg-primary text-primary-foreground"
        : "text-foreground/70 hover:bg-secondary"
    }`;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-secondary/50 print:hidden">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold font-serif text-primary">
            MCA Admin
          </h1>
          <nav className="flex items-center gap-2 flex-wrap">
            <NavLink to={`${ADMIN_ROUTE}/enrollments`} className={navLinkClass}>
              Current Enrollments
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/orders`} className={navLinkClass}>
              Store Orders
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/plans`} className={navLinkClass}>
              Subscription Plans
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/inventory`} className={navLinkClass}>
              Inventory Pricing
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/users`} className={navLinkClass}>
              Admin Users
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/settings`} className={navLinkClass}>
              Payment Mode (Test/Live)
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/families`} className={navLinkClass}>
              Families
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/pick-lists`} className={navLinkClass}>
              Pick Lists
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/backorders`} className={navLinkClass}>
              Backordered
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/test-reviews`} className={navLinkClass}>
              Test Reviews{pendingReviews > 0 ? ` (${pendingReviews})` : ""}
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/emails`} className={navLinkClass}>
              Email Templates
            </NavLink>
            <NavLink to={`${ADMIN_ROUTE}/enroll-comp`} className={navLinkClass}>
              Enroll Without Payment
            </NavLink>
            <button
              onClick={handleLogout}
              className="ml-2 px-4 py-2 rounded-lg text-sm font-medium text-foreground/70 hover:bg-secondary transition-colors"
            >
              Log Out
            </button>
          </nav>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-10">
        <Outlet />
      </main>
    </div>
  );
};

export default AdminLayout;
