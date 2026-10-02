import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router-dom";
import { ChevronDown, ChevronRight, Download, PlayCircle, Search } from "lucide-react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  SpotlightTour,
  readTourCache,
  tourTimestamp,
  writeTourCache,
  type SpotlightStep,
} from "../portal/PortalLayout";

const ADMIN_ROUTE = "/admin";
const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

// ---------------------------------------------------------------------------
// MCA_R6_ADMIN_TOUR: interactive spotlight walkthrough of the admin side.
// Uses the shared SpotlightTour engine from PortalLayout.tsx. Dismissal is
// stored per admin in admin_users.tour_dismissed_at, with this browser's
// localStorage as a fast cache and fallback. "Tour" in the nav replays it,
// and Help Center articles can start it at a matching step ("Show me").
// ---------------------------------------------------------------------------

const ADMIN_TOUR_STORAGE_PREFIX = "mca_admin_tour_dismissed_v1:";

export function adminTourSteps(familyId: string | null): SpotlightStep[] {
  const familyRoute = familyId ? `${ADMIN_ROUTE}/families/${familyId}` : null;
  const steps: SpotlightStep[] = [
    {
      id: "families",
      title: "Families",
      body:
        "Every family is listed here. Search by name, email, or phone, then click View to open a family.",
      route: `${ADMIN_ROUTE}/families`,
      target: ["admin-family-view", "admin-families-list"],
    },
  ];
  if (familyRoute) {
    steps.push(
      {
        id: "student-card",
        title: "A student's card",
        body:
          "Each student has a card with their enrollment, PACEs, ship schedule, and scores. Most day-to-day changes happen right here.",
        route: familyRoute,
        target: ["admin-student-card"],
      },
      {
        id: "prescribe-all",
        title: "Prescribe All",
        body:
          "Prescribe all core subjects sets up a whole school year in one step. Nothing ships yet: the daily pick-list job picks up the next PACEs a week before each ship date.",
        route: familyRoute,
        target: ["admin-prescribe-all", "admin-student-card"],
      },
      {
        id: "ship-schedule",
        title: "Ship schedule and Annual Ship",
        body:
          "Choose how this student's PACEs ship: fixed quarter dates, every 8 weeks, or Annual Ship to send the whole year in one box. Save the schedule after a change.",
        route: familyRoute,
        target: ["admin-ship-schedule", "admin-student-card"],
      },
    );
  }
  steps.push(
    {
      id: "pick-lists",
      title: "Pick Lists",
      body:
        "Each upcoming shipment gets a pick list showing what to pull from the shelf. Click Mark shipped when the box goes out, and the family gets the shipping email.",
      route: `${ADMIN_ROUTE}/pick-lists`,
      target: ["admin-pick-lists"],
    },
    {
      id: "packing-lists",
      title: "Print packing lists",
      body:
        "Print one packing list per family, with the ship-to address and every item, for all the lists that are ready.",
      route: `${ADMIN_ROUTE}/pick-lists`,
      target: ["admin-packing-lists"],
    },
    {
      id: "inventory",
      title: "Inventory",
      body:
        "Click Edit on any item to change its details, photo, or whether it shows in the store. Use Price for a quick price change.",
      route: `${ADMIN_ROUTE}/inventory`,
      target: ["admin-inventory-edit", "admin-inventory"],
    },
    {
      id: "test-reviews",
      title: "Test Reviews",
      body:
        "Tests that parents upload land here. Check the photos and score, then approve or reject with a note. Approved scores fill in the student's PACEs.",
      route: `${ADMIN_ROUTE}/test-reviews`,
      target: ["admin-test-reviews"],
    },
    {
      id: "orders",
      title: "Store Orders",
      body:
        "Every store order is listed here with its status. Print a packing list, and mark a shipped order Fulfilled to send the family their tracking email.",
      route: `${ADMIN_ROUTE}/orders`,
      target: ["admin-orders"],
    },
    {
      id: "emails",
      title: "Automatic emails",
      body:
        "Turn each automatic family email on or off with these switches. Below them you can edit the wording of every email the site sends.",
      route: `${ADMIN_ROUTE}/emails`,
      target: ["admin-email-switches"],
    },
    {
      id: "settings",
      title: "Settings",
      body:
        "This page holds the payment mode. Leave it on Live: test mode is only for a developer trying out checkout.",
      route: `${ADMIN_ROUTE}/settings`,
      target: ["admin-settings"],
    },
    {
      id: "help",
      title: "Help Center",
      body:
        "Search short how-to articles, download the printable guide, or send us feedback. Many articles have a Show me button that points to the right spot.",
      route: `${ADMIN_ROUTE}/help`,
      target: ["admin-help"],
    },
    {
      id: "tour-button",
      title: "Watch this again any time",
      body: "Click Tour in the menu to replay this walkthrough.",
      target: ["admin-tour-button"],
    },
  );
  return steps;
}

export interface AdminOutletContext {
  startTour: (stepId?: string) => void;
  lastPage: string | null;
  tourStepIds: string[];
}

// ---------------------------------------------------------------------------
// MCA_R6_HELP_CENTER: searchable admin Help Center at /admin/help.
// All article content lives in HELP_ARTICLES below (one entry per article),
// so updating help is a matter of editing this list. Screenshots and the
// printable guide live in the public "help-center" storage bucket; admins can
// replace them from "Update the guide files" at the bottom of the page.
// (MCA_R4_ADMIN_HELP content is folded into these articles.)
// ---------------------------------------------------------------------------

const HELP_FILES_URL = `${SUPABASE_URL}/storage/v1/object/public/help-center`;
const HELP_FILES_VERSION = "2026-10-01";
export const GUIDE_PDF_URL = `${HELP_FILES_URL}/How-MCA-Works.pdf?v=${HELP_FILES_VERSION}`;

const helpShot = (name: string) => `${HELP_FILES_URL}/shots/${name}.jpg?v=${HELP_FILES_VERSION}`;

export const HELP_CATEGORIES = [
  "Parents",
  "Families",
  "Shipping",
  "Store",
  "Emails",
  "Automatic jobs",
  "Help and tours",
] as const;

export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export interface HelpArticle {
  id: string;
  title: string;
  category: HelpCategory;
  keywords: string[];
  body: string[];
  image?: { src: string; alt: string };
  /** Admin tour step that "Show me" starts at. */
  tourStep?: string;
}

export const HELP_ARTICLES: HelpArticle[] = [
  // ----- Parents
  {
    id: "family-enrolls",
    title: "How does a new family enroll?",
    category: "Parents",
    keywords: ["enroll", "sign up", "checkout", "welcome email", "new family", "payment"],
    body: [
      "Families start on the Enroll page of mcahomeschool.com. They fill in parent and student details, pick elementary or high school, choose monthly or annual payment, and check out with a card.",
      "As soon as payment goes through, the family is created, the student's enrollment is active, and the parent gets a welcome email with a link to the Parent Portal.",
    ],
    image: { src: helpShot("p01-enroll"), alt: "The public Enroll page" },
  },
  {
    id: "parent-portal",
    title: "How do parents sign in to the Parent Portal?",
    category: "Parents",
    keywords: ["portal", "login", "sign in", "magic link", "password", "student menu"],
    body: [
      "Parents sign in at mcahomeschool.com/portal with their email. There's no password to remember: we email them a sign-in link.",
      "The portal home shows each student's enrollment and the family's store orders. With more than one student, the Student menu at the top switches every page to that child.",
    ],
    image: { src: helpShot("p02-portal-home"), alt: "Parent Portal home" },
  },
  {
    id: "parent-tour",
    title: "What does the parent portal tour show?",
    category: "Parents",
    keywords: ["tour", "walkthrough", "welcome", "new parent", "spotlight", "replay"],
    body: [
      "The first time a parent signs in, an interactive tour highlights the real buttons on each page: the Student menu, Upload Tests, PACE Status and Receive All, Academic Projection (for high school), the store, reports, and Forms.",
      "It shows once per parent account, on any device. The Tour button at the top of the portal replays it any time, which is handy to mention on the phone.",
    ],
    image: { src: helpShot("r6-portal-tour"), alt: "The parent tour highlighting PACE Status" },
  },
  {
    id: "upload-tests",
    title: "How do parents upload a test?",
    category: "Parents",
    keywords: ["upload", "test", "score", "photos", "PACE test"],
    body: [
      "When a student finishes a PACE test, the parent opens Upload Tests, picks the subject and PACE number, enters the test date and score, and attaches photos of every test page.",
      "Each upload lands in Test Reviews for MCA to check. If the six most recently issued PACEs have no scores, the next shipment pauses until they come in.",
    ],
    image: { src: helpShot("p04-upload-tests"), alt: "Upload Tests in the portal" },
  },
  {
    id: "receive-all",
    title: "What does Receive All do?",
    category: "Parents",
    keywords: ["receive all", "box arrived", "received", "issued", "PACE status"],
    body: [
      "Receive All is the parent's button on PACE Status. When a box arrives, it marks every shipped PACE as received in one click, for the subject they're viewing or for all subjects.",
      "It only touches PACEs MCA actually shipped, and it doesn't mark anything as handed out. Parents still mark a PACE Issued when they give it to the student.",
    ],
    image: { src: helpShot("p05-pace-status"), alt: "PACE Status with Receive All" },
  },
  {
    id: "projection",
    title: "Where do parents see the Academic Projection?",
    category: "Parents",
    keywords: ["academic projection", "high school", "credits", "graduation", "print"],
    body: [
      "For high school students, Academic Projection shows completed courses, current courses, and what's still needed to graduate, with credits. The tab only appears in the portal when a high school student is selected.",
      "Staff open the same page from the student's card, with tools to customize requirements and add transfer credits.",
    ],
    image: { src: helpShot("p07-projection"), alt: "Academic Projection" },
  },
  {
    id: "submitted-forms",
    title: "Where do parents see the forms they sent?",
    category: "Parents",
    keywords: ["forms", "submitted forms", "enrollment agreement", "goal card", "PE log"],
    body: [
      "The Forms page has the enrollment agreement, honesty policy, goal cards, P.E. logs, music practice and course verification forms.",
      "Under Submitted forms, parents see everything their family has sent: the form, the student, the date, and the status. Each family only ever sees its own forms.",
    ],
    image: { src: helpShot("p08-submitted-forms"), alt: "Submitted forms" },
  },
  // ----- Families
  {
    id: "find-family",
    title: "How do I find a family and open a student's card?",
    category: "Families",
    keywords: ["families", "search", "view", "student card", "family page"],
    body: [
      "Open Families, search by parent name, email, or phone, and click View.",
      "The family page has a card for each student with their enrollment, PACEs (Logged courses), ship schedule, form submissions, test reviews, and store orders.",
    ],
    image: { src: helpShot("a01-families"), alt: "Families list" },
    tourStep: "families",
  },
  {
    id: "prescribe",
    title: "How do I prescribe PACEs?",
    category: "Families",
    keywords: ["prescribe", "prescribe all", "core subjects", "level", "next 12", "school year"],
    body: [
      "On the student's card, click Prescribe all core subjects. For an elementary student, pick one level for Math, English, Word Building, Science and Social Studies, then change or skip any subject. For a high school student, check the courses to add.",
      "This creates the student's PACEs for the year, but nothing ships yet: the daily pick-list job picks up the next PACEs a week before each ship date. To set up next year early for one student, use Prescribe next 12.",
    ],
    image: { src: helpShot("a03-prescribe-all"), alt: "The Prescribe All panel" },
    tourStep: "prescribe-all",
  },
  {
    id: "transfer-credits",
    title: "How do I add a transfer credit?",
    category: "Families",
    keywords: ["transfer credit", "high school", "transcript", "another school", "credits"],
    body: [
      "Open the student's Academic Projection and click Add transfer credit. Enter the course, school, school year, and credits, plus the grade and requirement if you know them.",
      "Transfer credits show with a (T), count toward graduation credits, and appear on the transcript, but never count in the MCA GPA or average.",
    ],
  },
  {
    id: "test-reviews",
    title: "How do I review an uploaded test?",
    category: "Families",
    keywords: ["test reviews", "approve", "reject", "score", "photos", "pending"],
    body: [
      "Every test a parent uploads shows up in Test Reviews, and the menu shows a count when some are waiting. Open one to see the photos and score, then approve or reject it with a note.",
      "Approved scores fill in the student's PACEs automatically. ACE remains the official grade record.",
    ],
    image: { src: helpShot("a07-test-reviews"), alt: "Test Reviews" },
    tourStep: "test-reviews",
  },
  {
    id: "enroll-without-payment",
    title: "How do I enroll a family without payment?",
    category: "Families",
    keywords: ["enroll without payment", "comp", "scholarship", "free", "manual enrollment"],
    body: [
      "Use Enroll Without Payment in the admin menu to add a family and student when no card payment is needed. The family gets the same Parent Portal access as a paying family.",
    ],
  },
  // ----- Shipping
  {
    id: "ship-schedule",
    title: "How do I change a ship schedule or use Annual Ship?",
    category: "Shipping",
    keywords: ["ship schedule", "annual ship", "every 8 weeks", "quarter dates", "ship mode"],
    body: [
      "On the student's card, pick a Ship mode: fixed quarter dates, every 8 weeks, or Annual Ship. Dates can be rebuilt from the school start date. Click Save schedule after a change.",
      "Annual Ship sends every PACE for the year in one box and is the default for annual payers. It skips the missing-scores pause, since there's no later shipment to hold back.",
    ],
    image: { src: helpShot("a04-ship-schedule"), alt: "Ship mode and dates" },
    tourStep: "ship-schedule",
  },
  {
    id: "ship-early",
    title: "How do I ship a box early?",
    category: "Shipping",
    keywords: ["ship early", "rush", "send now", "next ship date", "generate pick lists"],
    body: [
      "On the student's card, set the Next ship date to today (or any day within the next week) and click Save schedule.",
      "Then open Pick Lists and click Generate due pick lists. A list is built right away for every student whose ship date is within 7 days, so you can pack and ship it the same day.",
    ],
    tourStep: "ship-schedule",
  },
  {
    id: "pick-lists",
    title: "How do I print packing lists and mark a box shipped?",
    category: "Shipping",
    keywords: ["pick list", "packing list", "print", "mark shipped", "tracking number"],
    body: [
      "Pick Lists shows each upcoming shipment and exactly what to pull. Packing list prints one page per family with the ship-to address; Packing lists, all ready prints them all at once.",
      "When the box goes out, click Mark shipped and paste the tracking number if you have one. The family gets the shipping email if it's turned on under Email Templates.",
    ],
    image: { src: helpShot("a05-pick-lists"), alt: "A shipped pick list" },
    tourStep: "packing-lists",
  },
  {
    id: "backorders",
    title: "What happens when an item is backordered?",
    category: "Shipping",
    keywords: ["backordered", "out of stock", "short", "stock"],
    body: [
      "When something runs out, it shows as backordered on pick lists and store orders. A backordered line still prints and ships with the rest of the list.",
      "The Backordered page lists every short line so you can reorder and follow up.",
    ],
  },
  // ----- Store
  {
    id: "inventory",
    title: "How do I change a price or edit a store item?",
    category: "Store",
    keywords: ["inventory", "price", "edit item", "photo", "stock", "take inventory", "csv"],
    body: [
      "Inventory Pricing is the full catalog. Search or filter, then use Edit for details and photos, Price for a quick price change, or Take Inventory to set stock on hand. Import and Export CSV handle big updates.",
      "Changes show in the store right away.",
    ],
    image: { src: helpShot("a06-inventory"), alt: "Inventory Pricing" },
    tourStep: "inventory",
  },
  {
    id: "store-orders",
    title: "How do I handle a store order?",
    category: "Store",
    keywords: ["store orders", "fulfilled", "pickup", "print packing list", "export"],
    body: [
      "Store Orders lists every order with its status. Use Print packing list to pack it.",
      "For a ship-to-home order, mark it Fulfilled when it ships and add the tracking number; the customer gets a shipping email if shipping emails are on.",
    ],
    image: { src: helpShot("a11-orders"), alt: "Store Orders" },
    tourStep: "orders",
  },
  {
    id: "payment-mode",
    title: "What is Payment Mode, and should I change it?",
    category: "Store",
    keywords: ["payment mode", "live", "test mode", "settings", "stripe", "cards"],
    body: [
      "Payment Mode (Test/Live) is a single switch for card payments and shipping rates. It's set to Live, which means real charges.",
      "Leave it on Live. Test mode is only for a developer trying out checkout with fake cards, and should never be on while families are using the site.",
    ],
    image: { src: helpShot("a10-settings"), alt: "Payment Mode settings" },
    tourStep: "settings",
  },
  // ----- Emails
  {
    id: "edit-email",
    title: "How do I change the wording of an email?",
    category: "Emails",
    keywords: ["email templates", "wording", "edit email", "preview", "send test"],
    body: [
      "Open Email Templates, pick a template, and edit the subject and body. Check the preview, and use Send test to me before saving.",
    ],
    image: { src: helpShot("a08-email-templates"), alt: "Email Templates" },
    tourStep: "emails",
  },
  {
    id: "test-reminders",
    title: "How do I turn on test reminders?",
    category: "Emails",
    keywords: ["test reminders", "overdue", "upload reminder", "switch", "nudge"],
    body: [
      "Open Email Templates. Under Automatic emails, flip Test upload reminders to On (flip it back to Off to stop). Click Check overdue tests now first to see who would get one; it sends nothing.",
      "Once on, a gentle note goes out each morning when a PACE was handed out 28 or more days ago with no test uploaded, at most once per PACE and once per family per week. Test accounts never get it.",
    ],
    tourStep: "emails",
  },
  {
    id: "shipping-emails",
    title: "How do I turn shipping emails on or off?",
    category: "Emails",
    keywords: ["shipping email", "shipment on the way", "tracking", "switch"],
    body: [
      "Under Email Templates, Automatic emails, use the Shipping emails switch. When it's on, families get a \"shipment on the way\" email with the tracking link when a pick list is marked shipped or a ship-to-home store order is marked Fulfilled.",
    ],
    tourStep: "emails",
  },
  // ----- Automatic jobs
  {
    id: "daily-pick-lists",
    title: "What happens at 8:00 AM every day?",
    category: "Automatic jobs",
    keywords: ["8:00", "daily", "pick list job", "missing scores", "paused", "automatic"],
    body: [
      "Every morning at 8:00 AM Eastern, pick lists are built for every student whose next ship date is within a week: the next 3 unshipped PACEs per subject, or everything for Annual Ship.",
      "If the 6 most recently issued PACEs are missing scores, the list is paused instead and the parent gets one \"scores needed\" email. You can also click Generate due pick lists any time.",
    ],
    tourStep: "pick-lists",
  },
  {
    id: "book-reminders",
    title: "What is the 8:20 AM book reminder?",
    category: "Automatic jobs",
    keywords: ["8:20", "book reminder", "resource books", "store cart", "email"],
    body: [
      "Twenty minutes after pick lists are built, parents get an email about resource books needed for upcoming PACEs that aren't in the shipment and weren't already bought.",
      "Each book is mentioned once per school year, and the email's button opens the store with those books already in the cart.",
    ],
  },
  {
    id: "july-represcribe",
    title: "What happens on July 1?",
    category: "Automatic jobs",
    keywords: ["july 1", "new school year", "re-prescribe", "represcribe", "next 12"],
    body: [
      "Every July 1 at about 8:10 AM Eastern, the new school year is set up. Elementary students get the next 12 PACEs in each subject; high school students get PACEs for current courses and unmet requirements.",
      "The first real run is July 1, 2027. To set up one student early, use Prescribe next 12 on the student's card.",
    ],
  },
  {
    id: "winter-times",
    title: "Why do the jobs run an hour earlier in winter?",
    category: "Automatic jobs",
    keywords: ["utc", "daylight saving", "winter", "time", "schedule"],
    body: [
      "The jobs run on a clock kept in UTC. After daylight saving ends, they run one hour earlier by the Eastern clock: 7:00 AM pick lists and 7:20 AM book reminders.",
    ],
  },
  // ----- Help and tours
  {
    id: "admin-tour",
    title: "How do I replay the admin tour?",
    category: "Help and tours",
    keywords: ["tour", "walkthrough", "replay", "spotlight", "show me"],
    body: [
      "Click Tour in the admin menu. It highlights each main tool in order, switching pages for you. It shows once automatically for each admin, and you can skip it any time.",
      "Articles in this Help Center with a Show me button start the tour at the matching spot.",
    ],
    image: { src: helpShot("r6-admin-tour"), alt: "The admin tour highlighting Pick Lists" },
    tourStep: "tour-button",
  },
  {
    id: "send-feedback",
    title: "How do I send feedback or report a problem?",
    category: "Help and tours",
    keywords: ["feedback", "bug", "problem", "support", "question", "idea", "screenshot"],
    body: [
      "Use Send feedback at the bottom of this page. Pick a topic, describe what happened, and attach a screenshot if it helps. Your name, email, and the page you were on are included automatically.",
      "It goes to our support team, and replies come back to your email.",
    ],
  },
  {
    id: "guide-pdf",
    title: "Where's the printable guide?",
    category: "Help and tours",
    keywords: ["pdf", "guide", "print", "how mca works", "download"],
    body: [
      "Click Download the guide (PDF) at the top of this page for the latest How MCA Works guide, with screenshots of both the parent and admin sides.",
    ],
  },
];

function helpMatches(article: HelpArticle, term: string): boolean {
  if (!term) return true;
  const haystack = [article.title, article.category, ...article.keywords, ...article.body]
    .join(" ")
    .toLowerCase();
  return term
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
}

const FEEDBACK_TOPICS = ["Problem or bug", "Question", "Idea or request", "Help Center content", "Other"];

function AdminFeedbackForm({ lastPage }: { lastPage: string | null }) {
  const [topic, setTopic] = useState(FEEDBACK_TOPICS[0]);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!message.trim()) {
      setResult({ ok: false, text: "Please write a short message first." });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      let screenshotPath: string | null = null;
      if (file && userId) {
        if (file.size > 10 * 1024 * 1024) throw new Error("The screenshot is over 10 MB. Try a smaller image.");
        const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "screenshot.png";
        screenshotPath = `${userId}/${Date.now()}-${safe}`;
        const { error: uploadError } = await supabase.storage
          .from("admin-feedback")
          .upload(screenshotPath, file, { contentType: file.type || "image/png", upsert: false });
        if (uploadError) throw new Error(`Couldn't upload the screenshot: ${uploadError.message}`);
      }
      const page = lastPage ? `${window.location.origin}${lastPage}` : window.location.href;
      const { data, error } = await supabase.functions.invoke("admin-feedback", {
        body: { action: "send", topic, message: message.trim(), page_url: page, screenshot_path: screenshotPath },
      });
      if (error || !data?.ok) {
        throw new Error(data?.error ?? "Your feedback couldn't be sent. Please try again.");
      }
      setResult({ ok: true, text: "Thanks! Your feedback was sent to our support team." });
      setSentCount((n) => n + 1);
      setMessage("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setResult({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setSending(false);
    }
  };

  return (
    <section
      className="space-y-3 rounded-xl border border-border/50 bg-secondary/30 p-5"
      data-marker="MCA_R6_FEEDBACK_FORM"
      data-tour="admin-feedback"
    >
      <div>
        <h3 className="text-xl font-bold font-serif text-primary">Send feedback</h3>
        <p className="text-sm text-foreground/60">
          Found a problem, have a question, or want something changed? Tell us here. Your name, email,
          and the page you were on are included.
        </p>
      </div>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Topic</span>
          <select
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            className="block h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm"
            aria-label="Feedback topic"
          >
            {FEEDBACK_TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Message</span>
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            rows={5}
            maxLength={5000}
            placeholder="What happened, or what would help?"
            className="bg-background"
            aria-label="Feedback message"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span className="font-medium">Screenshot (optional)</span>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="block text-sm"
            aria-label="Feedback screenshot"
          />
        </label>
        <div className="flex items-center gap-3 flex-wrap">
          <Button type="submit" disabled={sending}>
            {sending ? "Sending..." : "Send feedback"}
          </Button>
          {result && (
            <p
              className={`text-sm ${result.ok ? "text-green-700" : "text-destructive"}`}
              data-marker="MCA_R6_FEEDBACK_RESULT"
              role="status"
            >
              {result.text}
            </p>
          )}
        </div>
      </form>
      <RecentFeedback refreshKey={sentCount} />
    </section>
  );
}

interface FeedbackRow {
  id: string;
  created_at: string;
  admin_name: string | null;
  topic: string;
  email_status: string;
  delivery_status: string | null;
}

const DELIVERY_WORDS: Record<string, string> = {
  delivered: "Delivered",
  sent: "Sent",
  queued: "Queued",
  bounced: "Bounced",
  complained: "Marked as spam",
  delivery_delayed: "Delayed",
  opened: "Delivered and opened",
  clicked: "Delivered and opened",
};

// Recent feedback log (admin_feedback).
function RecentFeedback({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<FeedbackRow[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("admin_feedback")
      .select("id, created_at, admin_name, topic, email_status, delivery_status")
      .order("created_at", { ascending: false })
      .limit(5);
    setRows((data as FeedbackRow[] | null) ?? []);
  };

  useEffect(() => {
    load();
  }, [refreshKey]);

  if (rows.length === 0) return null;
  return (
    <details className="text-sm" data-marker="MCA_R6_FEEDBACK_LOG">
      <summary className="cursor-pointer text-foreground/70">Recent feedback ({rows.length})</summary>
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-2 text-foreground/70" data-feedback-id={row.id}>
            <span>
              {new Date(row.created_at).toLocaleString()} · {row.admin_name ?? "Admin"} · {row.topic} ·{" "}
              {row.email_status === "sent"
                ? DELIVERY_WORDS[row.delivery_status ?? "sent"] ?? row.delivery_status
                : row.email_status === "failed"
                  ? "Email failed (saved here)"
                  : "Sending"}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function HelpFilesUploader() {
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upload = async (files: FileList | null, kind: "pdf" | "shots") => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setStatus(null);
    const done: string[] = [];
    try {
      for (const f of Array.from(files)) {
        const path = kind === "pdf" ? "How-MCA-Works.pdf" : `shots/${f.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
        const { error } = await supabase.storage.from("help-center").upload(path, f, {
          upsert: true,
          contentType: f.type || (kind === "pdf" ? "application/pdf" : "image/jpeg"),
          cacheControl: "300",
        });
        if (error) throw new Error(`${f.name}: ${error.message}`);
        done.push(path);
      }
      setStatus(`Uploaded ${done.length} file${done.length === 1 ? "" : "s"}: ${done.join(", ")}`);
    } catch (err) {
      setStatus(`Upload failed. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <details className="rounded-xl border border-border/50 p-4 text-sm" data-marker="MCA_R6_HELP_FILES">
      <summary className="cursor-pointer font-medium">Update the guide files</summary>
      <div className="mt-3 space-y-3">
        <p className="text-foreground/60">
          Replace the printable guide or the screenshots used in these articles. Screenshots keep their
          file names (for example a05-pick-lists.jpg).
        </p>
        <label className="block space-y-1">
          <span>Guide PDF (replaces How-MCA-Works.pdf)</span>
          <input
            type="file"
            accept="application/pdf"
            disabled={busy}
            onChange={(event) => upload(event.target.files, "pdf")}
            aria-label="Guide PDF"
          />
        </label>
        <label className="block space-y-1">
          <span>Help screenshots (JPEG, PNG or WebP)</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            disabled={busy}
            onChange={(event) => upload(event.target.files, "shots")}
            aria-label="Help screenshots"
          />
        </label>
        {status && (
          <p className="text-foreground/70" data-marker="MCA_R6_HELP_FILES_STATUS">
            {status}
          </p>
        )}
      </div>
    </details>
  );
}

export function AdminHelp() {
  const context = useOutletContext<AdminOutletContext | undefined>();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<HelpCategory | "All">("All");
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [hiddenImages, setHiddenImages] = useState<string[]>([]);

  const term = search.trim();
  const matching = useMemo(
    () => HELP_ARTICLES.filter((a) => helpMatches(a, term)),
    [term],
  );
  const shown = matching.filter((a) => category === "All" || a.category === category);
  const tourSteps = context?.tourStepIds ?? [];

  const toggle = (id: string) =>
    setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  return (
    <div className="max-w-3xl space-y-6" data-marker="MCA_R4_ADMIN_HELP">
      <div className="flex items-start justify-between gap-3 flex-wrap" data-marker="MCA_R6_HELP_CENTER">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary" data-tour="admin-help">
            Help Center
          </h2>
          <p className="text-sm text-foreground/60">
            Short answers about the admin tools, the Parent Portal, and the jobs that run on their own.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {context && (
            <Button type="button" variant="outline" size="sm" onClick={() => context.startTour()}>
              <PlayCircle className="h-4 w-4 mr-1.5" />
              Take the admin tour
            </Button>
          )}
          <Button asChild size="sm" variant="outline">
            <a href={GUIDE_PDF_URL} target="_blank" rel="noreferrer" data-marker="MCA_R6_GUIDE_PDF">
              <Download className="h-4 w-4 mr-1.5" />
              Download the guide (PDF)
            </a>
          </Button>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/40" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search help, e.g. ship early, prescribe, reminders"
          className="bg-background pl-9"
          aria-label="Search help"
        />
      </div>

      <div className="flex gap-2 flex-wrap" role="tablist" aria-label="Help categories">
        {(["All", ...HELP_CATEGORIES] as const).map((cat) => {
          const count =
            cat === "All" ? matching.length : matching.filter((a) => a.category === cat).length;
          const active = category === cat;
          return (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setCategory(cat)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-foreground/70 hover:bg-secondary"
              }`}
            >
              {cat} ({count})
            </button>
          );
        })}
      </div>

      <div className="space-y-2" data-marker="MCA_R6_HELP_ARTICLES">
        {shown.length === 0 && (
          <p className="text-sm text-foreground/60">
            No articles match that search. Try fewer words, or send us feedback below.
          </p>
        )}
        {shown.map((article) => {
          const open = openIds.includes(article.id) || (term !== "" && shown.length <= 3);
          const canShow = !!context && !!article.tourStep && tourSteps.includes(article.tourStep);
          return (
            <article
              key={article.id}
              className="rounded-xl border border-border/50 bg-background"
              data-help-article={article.id}
            >
              <button
                type="button"
                onClick={() => toggle(article.id)}
                className="flex w-full items-center justify-between gap-3 p-4 text-left"
                aria-expanded={open}
              >
                <span className="font-semibold text-foreground">{article.title}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-foreground/60">
                    {article.category}
                  </span>
                  {open ? (
                    <ChevronDown className="h-4 w-4 text-foreground/40" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-foreground/40" />
                  )}
                </span>
              </button>
              {open && (
                <div className="space-y-3 px-4 pb-4">
                  {article.body.map((p) => (
                    <p key={p} className="text-sm leading-relaxed text-foreground/80">
                      {p}
                    </p>
                  ))}
                  {article.image && !hiddenImages.includes(article.id) && (
                    <a href={article.image.src} target="_blank" rel="noreferrer" className="block w-fit">
                      <img
                        src={article.image.src}
                        alt={article.image.alt}
                        loading="lazy"
                        className="max-h-56 w-auto max-w-full rounded-md border border-border/50"
                        onError={() => setHiddenImages((ids) => [...ids, article.id])}
                      />
                    </a>
                  )}
                  {canShow && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => context!.startTour(article.tourStep)}
                      data-marker="MCA_R6_SHOW_ME"
                    >
                      <PlayCircle className="h-4 w-4 mr-1.5" />
                      Show me
                    </Button>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </div>

      <AdminFeedbackForm lastPage={context?.lastPage ?? null} />
      <HelpFilesUploader />
    </div>
  );
}

const AdminLayout = () => {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStart, setTourStart] = useState<string | null>(null);
  const [tourFamilyId, setTourFamilyId] = useState<string | null>(null);
  // Admin tour dismissal (admin_users.tour_dismissed_at for this admin).
  const [adminRowId, setAdminRowId] = useState<string | null>(null);
  const [tourSavedToAccount, setTourSavedToAccount] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const lastPageRef = useRef<string | null>(null);

  // Remember the last admin page that isn't Help, for feedback.
  useEffect(() => {
    if (!location.pathname.startsWith(`${ADMIN_ROUTE}/help`)) {
      lastPageRef.current = location.pathname + location.search;
    }
  }, [location.pathname, location.search]);

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

          // A family for the tour's student-card steps: a test family if there
          // is one, otherwise the first family.
          const testFamily = await supabase
            .from("families")
            .select("id")
            .eq("is_test_account", true)
            .order("created_at")
            .limit(1);
          let familyId = (testFamily.data?.[0]?.id as string | undefined) ?? null;
          if (!familyId) {
            const anyFamily = await supabase.from("families").select("id").order("created_at").limit(1);
            familyId = (anyFamily.data?.[0]?.id as string | undefined) ?? null;
          }
          setTourFamilyId(familyId);

          // Show the admin tour once per admin.
          const userId = session.user.id;
          const localDismissedAt = readTourCache(ADMIN_TOUR_STORAGE_PREFIX, userId);
          const adminRow = await supabase
            .from("admin_users")
            .select("id, tour_dismissed_at")
            .eq("auth_user_id", userId)
            .maybeSingle();
          const rowId = (adminRow.data?.id as string | undefined) ?? null;
          const accountDismissedAt = (adminRow.data?.tour_dismissed_at as string | null | undefined) ?? null;
          setAdminRowId(rowId);
          if (accountDismissedAt) {
            setTourSavedToAccount(true);
            if (!localDismissedAt) writeTourCache(ADMIN_TOUR_STORAGE_PREFIX, userId, accountDismissedAt);
          } else if (localDismissedAt) {
            if (rowId) {
              saveAdminTourDismissed(rowId, tourTimestamp(localDismissedAt)).then((ok) => {
                if (ok) setTourSavedToAccount(true);
              });
            }
          } else {
            setTourStart(null);
            setTourOpen(true);
          }
        }
      }
      setChecking(false);
    };
    check();
  }, []);

  const startTour = (stepId?: string) => {
    setTourStart(stepId ?? null);
    setTourOpen(true);
  };

  const closeTour = () => {
    setTourOpen(false);
    const userId = session?.user?.id;
    if (!userId) return;
    const at = new Date().toISOString();
    if (!readTourCache(ADMIN_TOUR_STORAGE_PREFIX, userId)) writeTourCache(ADMIN_TOUR_STORAGE_PREFIX, userId, at);
    if (adminRowId && !tourSavedToAccount) {
      saveAdminTourDismissed(adminRowId, at).then((ok) => {
        if (ok) setTourSavedToAccount(true);
      });
    }
  };

  const tourSteps = useMemo(() => adminTourSteps(tourFamilyId), [tourFamilyId]);

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

  const outletContext: AdminOutletContext = {
    startTour,
    lastPage: lastPageRef.current,
    tourStepIds: tourSteps.map((s) => s.id),
  };

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
            <NavLink to={`${ADMIN_ROUTE}/help`} className={navLinkClass} data-tour="admin-nav-help">
              Help
            </NavLink>
            <button
              type="button"
              onClick={() => startTour()}
              className="px-4 py-2 rounded-lg text-sm font-medium text-foreground/70 hover:bg-secondary transition-colors"
              data-marker="MCA_R6_ADMIN_TOUR_LINK"
              data-tour="admin-tour-button"
              title="Replay the admin tour"
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
      </header>
      <SpotlightTour
        name="admin"
        open={tourOpen}
        onClose={closeTour}
        steps={tourSteps}
        startAt={tourStart}
      />
      <main className="max-w-6xl mx-auto px-4 py-10">
        <Outlet context={outletContext} />
      </main>
    </div>
  );
};

// Saves the admin's own tour dismissal (admin_users is admin-only by RLS).
// Only fills it in when empty, so replaying keeps the first dismissal time.
async function saveAdminTourDismissed(adminRowId: string, at: string): Promise<boolean> {
  const { error } = await supabase
    .from("admin_users")
    .update({ tour_dismissed_at: at })
    .eq("id", adminRowId)
    .is("tour_dismissed_at", null);
  if (error) {
    console.error("Couldn't save admin tour dismissal", error);
    return false;
  }
  return true;
}

export default AdminLayout;
