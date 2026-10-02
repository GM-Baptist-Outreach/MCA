import { useEffect, useState } from "react";
import { NavLink, Navigate, Outlet, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";

const ADMIN_ROUTE = "/admin";

// ---------------------------------------------------------------------------
// MCA_R4_ADMIN_HELP: plain-language help page at /admin/help.
// ---------------------------------------------------------------------------

const HELP_TOPICS: Array<{ title: string; body: string }> = [
  {
    title: "Prescribe All",
    body:
      "On a student's card (Families, then the family, then Logged courses), click \"Prescribe all core subjects\" to set up a whole school year at once. For an elementary student, pick one level for Math, English, Word Building, Science and Social Studies, then change or skip any single subject. For a high school student, check the courses to add. This creates the student's PACE boxes for the year. Nothing ships yet: the daily pick-list job picks up the next PACEs one week before each ship date.",
  },
  {
    title: "Annual Ship",
    body:
      "Annual Ship is a ship schedule choice on the student's card for families who want everything at once (annual payers get it by default). Instead of three PACEs per subject each quarter, one pick list is built with every unshipped PACE prescribed for the year, one week before the ship date. Because there is no later shipment to hold back, Annual Ship skips the missing-scores pause.",
  },
  {
    title: "Pick lists and packing lists",
    body:
      "Pick Lists shows each upcoming shipment and what to pull from the shelf. Use \"Packing list\" on one list, or \"Packing lists, all ready\" to print one page per family with the ship-to address and every item. Store Orders has its own \"Print packing list\" button. A backordered line still prints and ships with the rest. When the box goes out, click \"Mark shipped\" and paste the tracking number if you have one; the family gets the shipping email (if it's turned on under Email Templates).",
  },
  {
    title: "Receive All",
    body:
      "Receive All is the parent's button on PACE Status in the Parent Portal. When a box arrives, it marks every shipped PACE as received in one click, either for the subject they're viewing or for all subjects. It only touches PACEs MCA actually shipped, and it doesn't mark anything as handed out. Parents still mark a PACE Issued when they give it to the student.",
  },
  {
    title: "Transfer credits",
    body:
      "For a high school student who earned credit somewhere else, open the student's Academic Projection page and click \"Add transfer credit\". Enter the course, the school, the school year, and the credits, plus the grade and which requirement it counts toward if you know them. Transfer credits show with a (T), count toward the graduation credit total, and appear on the transcript, but they never count in the MCA GPA or average.",
  },
  {
    title: "July 1 automatic re-prescribe",
    body:
      "Every July 1 at about 8:10 AM Eastern, a job sets up the new school year. For elementary students it prescribes the next 12 PACEs after the highest one in each subject they already had. For high school students it uses in-progress courses and unmet graduation requirements, up to 12 PACEs. The first real run is July 1, 2027 (it does nothing before then). To set up one student early, use \"Prescribe next 12\" on the student's card.",
  },
  {
    title: "Daily 8:00 AM pick-list job",
    body:
      "Every morning at 8:00 AM Eastern (7:00 AM in winter, because the schedule is kept in UTC), the site checks each student whose next ship date is within 7 days and builds their pick list: the next 3 unshipped PACEs in each subject, or everything for Annual Ship. If the 6 most recently issued PACEs are missing scores, the list is paused instead and the parent gets one \"scores needed\" email. You can also click \"Generate due pick lists\" on the Pick Lists page any time.",
  },
  {
    title: "Daily 8:20 AM book-reminder email",
    body:
      "Twenty minutes after the pick lists are built (8:20 AM Eastern, 7:20 AM in winter), parents get an email about resource books their student will need for the upcoming PACEs that aren't in the shipment. Books the family already bought in the store are left out, and each book is only mentioned once per school year. The email's button opens the store with those books already in the cart.",
  },
  {
    title: "Shipping email and test-upload reminder",
    body:
      "When you mark a pick list shipped, or mark a ship-to-home store order Fulfilled, the family gets a \"shipment on the way\" email with the tracking link if you entered one. A separate, gentle reminder can go out when a PACE was handed out 28 or more days ago and no test has been uploaded (at most once per PACE and once per family per week). Turn either one on or off, and edit the wording, under Email Templates. Test accounts never get these emails.",
  },
];

export function AdminHelp() {
  return (
    <div className="max-w-3xl space-y-6" data-marker="MCA_R4_ADMIN_HELP">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">Help</h2>
        <p className="text-sm text-foreground/60">
          Quick explanations of the main tools and the jobs that run on their own.
        </p>
      </div>
      {HELP_TOPICS.map((topic) => (
        <section key={topic.title} className="space-y-1">
          <h3 className="font-semibold text-foreground">{topic.title}</h3>
          <p className="text-sm leading-relaxed text-foreground/80">{topic.body}</p>
        </section>
      ))}
    </div>
  );
}

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
            <NavLink to={`${ADMIN_ROUTE}/help`} className={navLinkClass}>
              Help
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
