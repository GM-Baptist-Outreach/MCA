import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Link,
  NavLink,
  Navigate,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from "react-router-dom";
import {
  ChevronDown,
  ChevronRight,
  Download,
  HelpCircle,
  LogOut,
  Menu,
  PlayCircle,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
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
import { formatShortDate, loadReorderForecast, type ReorderRow } from "./AdminInventory";

const ADMIN_ROUTE = "/admin";
const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

// ---------------------------------------------------------------------------
// MCA_R6_ADMIN_TOUR: interactive spotlight walkthrough of the admin side.
// Uses the shared SpotlightTour engine from PortalLayout.tsx. Dismissal is
// stored per admin in admin_users.tour_dismissed_at, with this browser's
// localStorage as a fast cache and fallback. "Replay tour" in the sidebar replays it,
// and Help Center articles can start it at a matching step ("Show me").
// ---------------------------------------------------------------------------

const ADMIN_TOUR_STORAGE_PREFIX = "mca_admin_tour_dismissed_v1:";

// Steps that point at the sidebar. On a phone the menu is a drawer, so
// AdminLayout opens it while one of these steps is showing.
export const ADMIN_MENU_TOUR_STEPS = new Set(["sidebar", "tour-button"]);

export function adminTourSteps(familyId: string | null): SpotlightStep[] {
  const familyRoute = familyId ? `${ADMIN_ROUTE}/families/${familyId}` : null;
  const steps: SpotlightStep[] = [
    {
      id: "dashboard",
      title: "Today: your dashboard",
      body:
        "The admin side opens here. Each box is a live count with a link: tests to review, pick lists ready and coming up, backorders, new enrollments this week, store orders to fulfill, and items to reorder soon.",
      route: ADMIN_ROUTE,
      target: ["admin-dashboard"],
    },
    {
      id: "sidebar",
      title: "The menu",
      body:
        "Everything is grouped here: Today, Students, Shipping, Store, and Settings. Help and Replay tour are at the bottom. On a phone, tap the menu button at the top to open it.",
      target: ["admin-sidebar", "admin-menu-button"],
    },
    {
      id: "families",
      title: "Families",
      body:
        "Every family is listed here. Search by name, email, or phone, then click View to open a family.",
      route: `${ADMIN_ROUTE}/families`,
      target: ["admin-family-view", "admin-families-list"],
    },
    {
      id: "enroll-comp",
      title: "Enroll Without Payment",
      body:
        "To add a family and student when no card payment is needed (a scholarship or staff family), use this button on the Families page.",
      route: `${ADMIN_ROUTE}/families`,
      target: ["admin-enroll-comp"],
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
        id: "student-records",
        title: "Report card, transcript, and credits",
        body:
          "Download a progress report PDF for a semester or the full year, and for high school students the transcript. The bar shows credits earned, in progress, and still needed to graduate.",
        route: familyRoute,
        target: ["admin-student-records", "admin-student-card"],
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
      id: "test-reviews",
      title: "Test Reviews",
      body:
        "Tests that parents upload land here, and the menu shows how many are waiting. Click Score to open the photos with a score box beside them: saving fills in the student's PACE, re-checks the next shipment, and approves the upload in one step.",
      route: `${ADMIN_ROUTE}/test-reviews`,
      target: ["admin-test-reviews"],
    },
    {
      id: "reenrollment",
      title: "Re-enrollment",
      body:
        "Each spring, open re-enrollment here and set the dates. Families confirm next year from their portal with their info filled in and pay if needed. This page shows who has confirmed, paid, or isn't returning.",
      route: `${ADMIN_ROUTE}/reenrollment`,
      target: ["admin-reenrollment"],
    },
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
      id: "backorders",
      title: "Backordered",
      body:
        "Backordered items are a tab inside Pick Lists. It lists every pick-list or store line that was short, so you can reorder and mark each one fulfilled when it goes out.",
      route: `${ADMIN_ROUTE}/pick-lists`,
      target: ["admin-backorders-tab"],
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
      id: "inventory",
      title: "Inventory Pricing",
      body:
        "Click Edit on any item to change its details, photo, or whether it shows in the store. Use Price for a quick price change. Subscription Plans sits right below it in the menu.",
      route: `${ADMIN_ROUTE}/inventory`,
      target: ["admin-inventory-edit", "admin-inventory"],
    },
    {
      id: "reorder-plan",
      title: "Reorder plan",
      body:
        "This looks ahead at open pick lists, store orders, and upcoming ship dates, and flags items that will run short. Show only items to reorder, or download the list as a CSV.",
      route: `${ADMIN_ROUTE}/inventory`,
      target: ["admin-reorder-plan", "admin-inventory"],
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
      id: "weekly-summary",
      title: "Weekly summary email",
      body:
        "Every Monday at 8 AM Eastern, a summary of the past week goes to the address here: new enrollments, overdue tests, low stock, boxes shipped, and money collected. Turn it off or send yourself a preview.",
      route: `${ADMIN_ROUTE}/emails`,
      target: ["admin-weekly-summary", "admin-email-switches"],
    },
    {
      id: "settings",
      title: "Settings and Payment Mode",
      body:
        "Settings links to Email Templates and Admin Users, and holds the Payment Mode section. Leave payments on Live: test mode is only for a developer trying out checkout.",
      route: `${ADMIN_ROUTE}/settings`,
      target: ["admin-payment-mode", "admin-settings"],
    },
    {
      id: "sms-webhooks",
      title: "Text messages",
      body:
        "Each text event (test upload overdue, box shipped) has its own webhook URL, switch, and Send test button. The texts themselves are sent by an automation in GM Baptist software.",
      route: `${ADMIN_ROUTE}/settings`,
      target: ["admin-sms-webhooks", "admin-settings"],
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
      body: "Click Replay tour at the bottom of the menu to see this walkthrough again.",
      target: ["admin-tour-button", "admin-menu-button"],
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
const HELP_FILES_VERSION = "2026-10-02-r10";
export const GUIDE_PDF_URL = `${HELP_FILES_URL}/How-MCA-Works.pdf?v=${HELP_FILES_VERSION}`;

const helpShot = (name: string) => `${HELP_FILES_URL}/shots/${name}.jpg?v=${HELP_FILES_VERSION}`;

export const HELP_CATEGORIES = [
  "Getting around",
  "Parents",
  "Families",
  "Shipping",
  "Store",
  "Emails",
  "Settings",
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
  // ----- Getting around (MCA_R7_ADMIN_NAV)
  {
    id: "dashboard",
    title: "What's on the Today dashboard?",
    category: "Getting around",
    keywords: ["dashboard", "today", "home", "counts", "start page", "landing"],
    body: [
      "The admin side opens on Today, a dashboard of live counts: tests waiting for review, pick lists ready to pack and boxes due in the next 14 days, open backorders, new enrollments in the last 7 days, store orders to fulfill, and items to reorder soon.",
      "Click any box to jump to that list. The counts refresh each time you open the dashboard, and Refresh updates them on the spot.",
    ],
    image: { src: helpShot("r7-dashboard"), alt: "The Today dashboard" },
    tourStep: "dashboard",
  },
  {
    id: "menu",
    title: "Where is everything in the menu?",
    category: "Getting around",
    keywords: ["menu", "sidebar", "navigation", "where", "moved", "phone", "hamburger", "backordered", "payment mode"],
    body: [
      "The menu on the left is grouped. Today: the dashboard. Students: Families, Current Enrollments, Test Reviews (with a count of tests waiting), and Re-enrollment. Shipping: Pick Lists and Store Orders. Store: Inventory Pricing and Subscription Plans. Settings: Email Templates, Admin Users, and Settings.",
      "A few things moved: Backordered is now a tab inside Pick Lists, Payment Mode is a section of the Settings page, and Enroll Without Payment is a button on the Families page. Help, Replay tour, and Log Out are at the bottom of the menu.",
      "On a phone, the menu is hidden behind the menu button (three lines) at the top left. Tap it to open the menu, and tap a page or outside the menu to close it.",
    ],
    image: { src: helpShot("r7-sidebar"), alt: "The grouped admin menu" },
    tourStep: "sidebar",
  },
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
    image: { src: helpShot("r7-projection"), alt: "Academic Projection" },
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
    image: { src: helpShot("r7-families-list"), alt: "Families list" },
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
    image: { src: helpShot("r7-prescribe-all"), alt: "The Prescribe All panel" },
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
      "Faster: click Score on a row. The photos open with a score box beside them, already set to the PACE the parent picked. Check the score, tick Entered into ACE if you've done that, and click Save score & approve. See \"Scoring a test right in the photo viewer\" for the details.",
    ],
    image: { src: helpShot("r7-test-reviews"), alt: "Test Reviews" },
    tourStep: "test-reviews",
  },
  {
    id: "enroll-without-payment",
    title: "How do I enroll a family without payment?",
    category: "Families",
    keywords: ["enroll without payment", "comp", "scholarship", "free", "manual enrollment"],
    body: [
      "Open Families and click the Enroll Without Payment button at the top of the page. Fill in the family and student the same way as a normal enrollment; no card payment is taken.",
      "The family gets the same Parent Portal access as a paying family.",
    ],
    image: { src: helpShot("r7-families"), alt: "Families with the Enroll Without Payment button" },
    tourStep: "enroll-comp",
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
    image: { src: helpShot("r7-ship-schedule"), alt: "Ship mode and dates" },
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
    image: { src: helpShot("r7-pick-lists"), alt: "A shipped pick list" },
    tourStep: "packing-lists",
  },
  {
    id: "backorders",
    title: "What happens when an item is backordered?",
    category: "Shipping",
    keywords: ["backordered", "out of stock", "short", "stock"],
    body: [
      "When something runs out, it shows as backordered on pick lists and store orders. A backordered line still prints and ships with the rest of the list.",
      "Open Pick Lists and click the Backordered tab. It lists every short pick-list and store line; filter Open, Fulfilled, or All, and click Mark fulfilled when the item finally goes out.",
    ],
    image: { src: helpShot("r7-backordered"), alt: "The Backordered tab in Pick Lists" },
    tourStep: "backorders",
  },
  // ----- Store
  {
    id: "inventory",
    title: "How do I change a price or edit a store item?",
    category: "Store",
    keywords: ["inventory", "price", "edit item", "photo", "stock", "take inventory", "csv"],
    body: [
      "Inventory Pricing (in the Store group of the menu) is the full catalog. Search or filter, then use Edit for details and photos, Price for a quick price change, or Take Inventory to set stock on hand. Import and Export CSV handle big updates.",
      "Changes show in the store right away.",
    ],
    image: { src: helpShot("r7-inventory"), alt: "Inventory Pricing" },
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
    image: { src: helpShot("r7-orders"), alt: "Store Orders" },
    tourStep: "orders",
  },
  // ----- Round 8: reports, credits, reorder, texts (MCA_R8_HELP)
  {
    id: "report-pdf",
    title: "How do I download a progress report or transcript?",
    category: "Families",
    keywords: ["report card", "progress report", "pdf", "transcript", "semester", "download", "print"],
    body: [
      "Open the family and find the student's card. Under Reports, pick the school year and a period (1st semester, 2nd semester, or the full year), then click Progress report. The PDF downloads right away.",
      "It has the MCA logo and address, the student's grade, PACEs completed by subject, every test score in that period, and for high school students the credits earned toward graduation. Transcript (high school only) gives the full transcript with GPA as a PDF.",
      "Semesters follow the report-card quarters: 1st semester is Q1 and Q2, 2nd semester is Q3 and Q4. If the parent set a school start date, the quarters are 9 weeks each from that date; otherwise July-December and January-June.",
    ],
    image: { src: helpShot("r8-student-records"), alt: "Reports on a student's card" },
    tourStep: "student-records",
  },
  {
    id: "credit-tracker",
    title: "How does the graduation credit bar work?",
    category: "Families",
    keywords: ["credits", "graduation", "25 credits", "credit bar", "still needed", "high school"],
    body: [
      "High school students show a bar toward the credits required to graduate (25 by default). Green is credits earned (a final average or a transfer credit), yellow is courses in progress, and the rest is still needed.",
      "Show what's still needed lists the remaining required courses by subject, plus electives. The same bar is on the parent portal and in the PDFs. Change the 25 in Settings, under Graduation and reorder numbers.",
    ],
    image: { src: helpShot("r8-credit-bar"), alt: "The graduation credit bar" },
    tourStep: "student-records",
  },
  {
    id: "parent-report-pdf",
    title: "Where do parents download a report card?",
    category: "Parents",
    keywords: ["parent", "portal", "report card", "transcript", "download", "pdf"],
    body: [
      "On the Parent Portal home page, the Report card and transcript (PDF) box lets parents pick a semester or the full year and download a progress report. High school families also get a Transcript button and the credit bar.",
      "Parents can only download reports for their own students.",
    ],
    image: { src: helpShot("r8-portal-reports"), alt: "Report downloads in the Parent Portal" },
  },
  {
    id: "reorder-plan",
    title: "How does the reorder plan work?",
    category: "Shipping",
    keywords: ["reorder", "low stock", "running out", "inventory", "forecast", "order more", "csv"],
    body: [
      "The Reorder soon box on Today and the Reorder plan on Inventory Pricing look ahead (60 days by default) and add up what will be needed: open pick lists, open store orders, and the PACEs and answer keys that each upcoming ship date will pull (3 per subject per box, or everything for Annual Ship).",
      "Items with a stock count are flagged when that need is more than what's on hand, with the date they run out. Items with no stock count yet are listed too, marked not counted. Test accounts are left out.",
      "Click Show only items to reorder to filter the list, or Reorder CSV to download it. Nothing is ordered automatically.",
    ],
    image: { src: helpShot("r8-reorder"), alt: "The reorder plan on Inventory Pricing" },
    tourStep: "reorder-plan",
  },
  {
    id: "sms-texts",
    title: "How do the text messages work?",
    category: "Settings",
    keywords: ["text", "sms", "webhook", "gm baptist", "automation", "box shipped", "overdue", "send test"],
    body: [
      "Settings has a Text messages section with two events: Test upload overdue and Box shipped. Each has its own webhook URL, its own On/Off switch, and a Send test button. The site sends the details to that URL, and an automation in GM Baptist software sends the text.",
      "What's sent: the event, parent first and last name, phone, email, student name, a short message, the tracking link (box shipped), and the family ID. Send test uses test-account data and is marked as a test.",
      "Both switches start Off. Turn one on only after its automation is ready. Test accounts never trigger a real text, and Recent texts shows what was sent.",
    ],
    image: { src: helpShot("r8-sms"), alt: "Text messages in Settings" },
    tourStep: "sms-webhooks",
  },
  {
    id: "school-numbers",
    title: "How do I change the credits required or the reorder look-ahead?",
    category: "Settings",
    keywords: ["25 credits", "credits required", "look-ahead", "reorder days", "settings"],
    body: [
      "In Settings, under Graduation and reorder numbers, change Credits required to graduate (25) or Reorder look-ahead (60 days) and click Save.",
    ],
  },
  {
    id: "payment-mode",
    title: "What is Payment Mode, and should I change it?",
    category: "Settings",
    keywords: ["payment mode", "live", "test mode", "settings", "stripe", "cards"],
    body: [
      "Open Settings (in the Settings group of the menu). Payment Mode (Test/Live) is a section on that page: a single switch for card payments and shipping rates. It's set to Live, which means real charges.",
      "Leave it on Live. Test mode is only for a developer trying out checkout with fake cards, and should never be on while families are using the site.",
    ],
    image: { src: helpShot("r7-settings"), alt: "Settings with the Payment Mode section" },
    tourStep: "settings",
  },
  {
    id: "admin-users",
    title: "How do I add or remove an admin?",
    category: "Settings",
    keywords: ["admin users", "add admin", "staff", "remove admin", "access"],
    body: [
      "Open Admin Users in the Settings group of the menu. Enter the person's email (and name if you like) and click Add Admin. Anyone added gets full access to everything on the admin side.",
      "Removing someone only takes away their admin access; it doesn't delete their account. You can't remove your own access; another admin has to do it.",
    ],
  },
  // ----- Emails
  {
    id: "edit-email",
    title: "How do I change the wording of an email?",
    category: "Emails",
    keywords: ["email templates", "wording", "edit email", "preview", "send test"],
    body: [
      "Open Email Templates (in the Settings group of the menu), pick a template, and edit the subject and body. Check the preview, and use Send test to me before saving.",
    ],
    image: { src: helpShot("r7-email-templates"), alt: "Email Templates" },
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
      "Click Replay tour at the bottom of the admin menu. It starts on the Today dashboard and the menu, then highlights each main tool in order, switching pages for you. It shows once automatically for each admin, and you can skip it any time.",
      "Articles in this Help Center with a Show me button start the tour at the matching spot.",
    ],
    image: { src: helpShot("r7-admin-tour"), alt: "The admin tour highlighting the menu" },
    tourStep: "tour-button",
  },
  {
    id: "send-feedback",
    title: "How do I send feedback or report a problem?",
    category: "Help and tours",
    keywords: ["feedback", "bug", "problem", "support", "question", "idea", "screenshot", "ticket", "ticket number", "confirmation"],
    body: [
      "Use Send feedback at the bottom of this page. Pick a topic, describe what happened, and attach a screenshot if it helps. Your name, email, and the page you were on are included automatically.",
      "Each message gets a ticket number, like #000123. You'll see it on the screen, and a confirmation email with the ticket number and a copy of your message goes to the email you sign in with.",
      "Support replies by email, straight to you. To add something later, reply to the confirmation email and keep the ticket number in the subject. Recent feedback under the form lists the latest tickets.",
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
  // ----- Round 10 (MCA_R10_HELP)
  {
    id: "parent-dashboard",
    title: "What do parents see on their portal home?",
    category: "Parents",
    keywords: ["dashboard", "portal home", "at a glance", "current paces", "next shipment", "balance", "owed", "recent tests"],
    body: [
      "The top of the portal home is an At a glance card for the selected student: the PACEs they're working on now, what ships in the next box and when (or why it's paused), the last box's tracking link, the most recent test scores, and any balance owed.",
      "High school students also get the 25-credit graduation bar further down. With more than one student, the Student menu at the top switches the card to that child.",
      "Balance owed counts past-due tuition and unpaid store orders. If a payment failed, the parent can fix their card from the Saved card section on the same page.",
    ],
  },
  {
    id: "viewer-scoring",
    title: "Scoring a test right in the photo viewer",
    category: "Families",
    keywords: ["score", "test reviews", "viewer", "photos", "approve", "enter score", "prescribe", "next pace"],
    body: [
      "In Test Reviews, click Score on any upload with photos. The photos open full size with a score box on the side. The PACE is filled in from the upload; change it if the parent picked the wrong one.",
      "Type the score (for example 94) and click Save score & approve. In one step it records the score on the student's PACE, approves the upload, adds the next PACE to the upcoming box if one is now needed, and checks whether the student just finished a level.",
      "A score under 80 is saved as not passed, and a Re-issue button appears so you can send the same PACE again. Tick Entered into ACE once you've put the score in ACE, which is still the official grade record.",
    ],
    tourStep: "test-reviews",
  },
  {
    id: "weekly-summary",
    title: "The Monday weekly summary email",
    category: "Automatic jobs",
    keywords: ["weekly", "summary", "monday", "report", "enrollments", "overdue", "low stock", "shipped", "money", "collected"],
    body: [
      "Every Monday at 8 AM Eastern (7 AM in winter), one email covers the past 7 days: new enrollments, tests that are overdue, items that are low or need reordering soon, boxes shipped, and money collected through Stripe.",
      "It goes only to the address on Email Templates (David by default). Families never get it. The switch there turns it off, and Send me a preview emails the current numbers to you, the signed-in admin.",
      "Each send (or skip) is listed under Recent summaries.",
    ],
    tourStep: "weekly-summary",
  },
  {
    id: "diploma",
    title: "How do I print a diploma?",
    category: "Families",
    keywords: ["diploma", "graduation", "graduate", "transcript", "credits", "senior", "high school", "pdf"],
    body: [
      "When a high school student has earned the credits needed to graduate (25 by default, set on Settings), a Diploma button appears next to the Transcript button on their student card and in the parent's portal. One click downloads a printable diploma PDF.",
      "Before then, admins see a Diploma sample button that downloads a watermarked preview, and parents see a note that the diploma unlocks when the credits are complete.",
      "Pair it with the official Transcript button for college or job applications.",
    ],
    tourStep: "student-records",
  },
  {
    id: "saved-cards",
    title: "Saved cards and autopay",
    category: "Parents",
    keywords: ["card", "saved card", "autopay", "payment method", "update card", "stripe", "declined", "reorder"],
    body: [
      "Parents can save a card from the Saved card and autopay section of their portal home. Stripe stores the card securely; MCA never sees the full number.",
      "The default card is used for tuition autopay (monthly or annual) and is offered at the store checkout when the parent is signed in. Parents can add another card, make it the default, or remove one.",
      "Order history in the portal has a Reorder button that puts the same items back in the store cart.",
    ],
  },
  {
    id: "celebrations",
    title: "Celebration screens and emails",
    category: "Emails",
    keywords: ["celebration", "congratulations", "level", "finished", "school year", "milestone", "confetti"],
    body: [
      "When a scored test shows a student passed the last PACE of a level in a subject, or every PACE prescribed for the school year, the parent sees a congratulations screen the next time they open the portal.",
      "A congratulations email goes out too, unless Celebration emails is turned off on Email Templates. You can edit its wording there like any other template. Test accounts never get it.",
    ],
    tourStep: "emails",
  },
  {
    id: "reenrollment",
    title: "How does spring re-enrollment work?",
    category: "Families",
    keywords: ["re-enroll", "reenroll", "renew", "next year", "spring", "confirm", "returning", "window"],
    body: [
      "Open Re-enrollment in the menu, set the school year (like 2027-28) and the dates, turn on Re-enrollment is open, and Save. During the window, families see a Re-enroll card on their portal home.",
      "Their name, phone, and address are filled in. They pick each student's grade and plan (or say a student isn't returning) and confirm. Students on autopay simply keep renewing. Anyone without a card on file gets a secure Stripe payment page.",
      "The Re-enrollment page lists every student with their status: not confirmed, confirmed, waiting on payment, paid, or not returning. Download CSV gives you the list for follow-up calls. Turn the switch off to close it.",
    ],
    tourStep: "reenrollment",
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
      // MCA_R9_TICKETS: show the ticket number and where the confirmation went.
      const ticket = typeof data.ticket_number === "string" ? data.ticket_number : null;
      setResult({
        ok: true,
        text: `${ticket ? `Thanks! Ticket #${ticket} was sent to our support team.` : "Thanks! Your feedback was sent to our support team."}${
          data.confirmation_sent && data.confirmation_to
            ? ` A confirmation is on its way to ${data.confirmation_to}, and support will reply by email.`
            : " Support will reply by email."
        }`,
      });
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
          and the page you were on are included. You'll get a ticket number and a confirmation email, and
          support replies go straight to your email.
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
  ticket_number: number | null;
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
      .select("id, ticket_number, created_at, admin_name, topic, email_status, delivery_status")
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
              {row.ticket_number ? `#${String(row.ticket_number).padStart(6, "0")} · ` : ""}
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

// ---------------------------------------------------------------------------
// MCA_R7_DASHBOARD: the "Today" home page at /admin (the default admin
// landing page). Live counts, each linking to the page where the work is.
// It lives in this file because AI Studio can only edit existing files.
// ---------------------------------------------------------------------------

interface DashboardCounts {
  testsToReview: number;
  pickListsReady: number;
  pickListsPaused: number;
  upcomingShipments: number;
  backorders: number;
  newEnrollments: number;
  ordersToFulfill: number;
}

interface RecentEnrollment {
  id: string;
  created_at: string;
  student: string;
  parent: string;
  test: boolean;
}

const DASHBOARD_UPCOMING_DAYS = 14;

function isoDay(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString("en-CA");
}

async function countRows(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> {
  const { count, error } = await query;
  if (error) {
    console.error("Dashboard count failed", error);
    return null;
  }
  return count ?? 0;
}

export function AdminDashboard() {
  const context = useOutletContext<AdminOutletContext | undefined>();
  const [counts, setCounts] = useState<Partial<Record<keyof DashboardCounts, number | null>>>({});
  const [recent, setRecent] = useState<RecentEnrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [reorderRows, setReorderRows] = useState<ReorderRow[] | null>(null);

  const load = async () => {
    setLoading(true);
    loadReorderForecast().then(({ rows }) => setReorderRows(rows.filter((row) => row.shortfall > 0)));
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const head = { count: "exact" as const, head: true };
    const [testsToReview, pickListsReady, pickListsPaused, upcomingShipments, backorders, newEnrollments, ordersToFulfill, recentRows] =
      await Promise.all([
        countRows(supabase.from("score_reports").select("id", head).eq("review_status", "pending")),
        countRows(supabase.from("pick_lists").select("id", head).eq("status", "ready")),
        countRows(supabase.from("pick_lists").select("id", head).eq("status", "paused")),
        countRows(
          supabase
            .from("student_ship_schedules")
            .select("id", head)
            .not("next_ship_date", "is", null)
            .lte("next_ship_date", isoDay(DASHBOARD_UPCOMING_DAYS))
            .or("shipment_paused.is.null,shipment_paused.eq.false"),
        ),
        countRows(supabase.from("admin_backordered_items_v").select("line_id", head).is("backorder_fulfilled_at", null)),
        countRows(supabase.from("enrollments").select("id", head).gte("created_at", weekAgo)),
        countRows(
          supabase
            .from("orders")
            .select("id", head)
            .in("status", ["submitted", "confirmed"])
            .neq("payment_status", "refunded"),
        ),
        supabase
          .from("enrollments")
          .select("id, created_at, students ( student_name, families ( parent_name, is_test_account ) )")
          .gte("created_at", weekAgo)
          .order("created_at", { ascending: false })
          .limit(5),
      ]);
    setCounts({ testsToReview, pickListsReady, pickListsPaused, upcomingShipments, backorders, newEnrollments, ordersToFulfill });
    type One<T> = T | T[] | null | undefined;
    const first = <T,>(rel: One<T>): T | undefined => (Array.isArray(rel) ? rel[0] : rel ?? undefined);
    type RecentRow = {
      id: string;
      created_at: string;
      students: One<{ student_name: string | null; families: One<{ parent_name: string | null; is_test_account: boolean | null }> }>;
    };
    const rows = ((recentRows.data as unknown as RecentRow[] | null) ?? []).map((row) => {
      const student = first(row.students);
      const family = first(student?.families);
      return {
        id: row.id,
        created_at: row.created_at,
        student: student?.student_name ?? "Student",
        parent: family?.parent_name ?? "",
        test: !!family?.is_test_account,
      };
    });
    setRecent(rows);
    setLoadedAt(new Date());
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const show = (value: number | null | undefined) => (loading && value === undefined ? "…" : value == null ? "–" : String(value));

  const cards: Array<{
    key: string;
    label: string;
    value: number | null | undefined;
    note: string;
    to: string;
    tour: string;
  }> = [
    {
      key: "tests",
      label: "Tests to review",
      value: counts.testsToReview,
      note: "Uploaded by parents, waiting for approval",
      to: `${ADMIN_ROUTE}/test-reviews`,
      tour: "admin-dash-tests",
    },
    {
      key: "ready",
      label: "Pick lists ready",
      value: counts.pickListsReady,
      note:
        counts.pickListsPaused
          ? `Ready to pack and ship · ${counts.pickListsPaused} paused for missing scores`
          : "Ready to pack and ship",
      to: `${ADMIN_ROUTE}/pick-lists`,
      tour: "admin-dash-pick-lists",
    },
    {
      key: "upcoming",
      label: "Boxes coming up",
      value: counts.upcomingShipments,
      note: `Students with a ship date in the next ${DASHBOARD_UPCOMING_DAYS} days (lists build 7 days ahead)`,
      to: `${ADMIN_ROUTE}/pick-lists`,
      tour: "admin-dash-upcoming",
    },
    {
      key: "backorders",
      label: "Backorders",
      value: counts.backorders,
      note: "Open backordered lines on pick lists and store orders",
      to: `${ADMIN_ROUTE}/pick-lists?tab=backordered`,
      tour: "admin-dash-backorders",
    },
    {
      key: "enrollments",
      label: "New enrollments",
      value: counts.newEnrollments,
      note: "In the last 7 days",
      to: `${ADMIN_ROUTE}/enrollments`,
      tour: "admin-dash-enrollments",
    },
    {
      key: "orders",
      label: "Store orders to fulfill",
      value: counts.ordersToFulfill,
      note: "Submitted or confirmed, not yet fulfilled",
      to: `${ADMIN_ROUTE}/orders`,
      tour: "admin-dash-orders",
    },
    {
      key: "reorder",
      label: "Reorder soon",
      value: reorderRows == null ? undefined : reorderRows.filter((row) => row.tracked).length,
      note:
        reorderRows == null
          ? "Checking upcoming shipments..."
          : `Counted items that run short in the next ${reorderRows[0]?.horizon_days ?? 60} days · ${
              reorderRows.filter((row) => !row.tracked).length
            } needed with no stock count`,
      to: `${ADMIN_ROUTE}/inventory?reorder=1`,
      tour: "admin-dash-reorder",
    },
  ];

  return (
    <div className="space-y-6" data-marker="MCA_R7_DASHBOARD">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">Today</h2>
          <p className="text-sm text-foreground/60">
            {new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
            {loadedAt ? ` · updated ${loadedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button type="button" variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {context && (
            <Button type="button" variant="outline" size="sm" onClick={() => context.startTour()}>
              <PlayCircle className="h-4 w-4 mr-1.5" />
              Take the tour
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-tour="admin-dashboard">
        {cards.map((card) => {
          const busy = (card.value ?? 0) > 0;
          return (
            <Link
              key={card.key}
              to={card.to}
              data-tour={card.tour}
              data-dashboard-count={card.key}
              className={`group rounded-xl border p-4 transition-colors hover:bg-secondary/60 ${
                busy ? "border-primary/40 bg-primary/5" : "border-border/60 bg-background"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-foreground/70">{card.label}</p>
                <ChevronRight className="h-4 w-4 text-foreground/40 group-hover:text-primary" />
              </div>
              <p className={`mt-1 text-3xl font-bold font-serif ${busy ? "text-primary" : "text-foreground/50"}`}>
                {show(card.value)}
              </p>
              <p className="mt-1 text-xs text-foreground/60">{card.note}</p>
            </Link>
          );
        })}
      </div>

      {reorderRows && reorderRows.length > 0 && (
        <section className="rounded-xl border border-border/60 p-4 space-y-2" data-marker="MCA_R8_REORDER_CARD">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-serif text-lg font-bold text-primary">Reorder plan</h3>
            <Link to={`${ADMIN_ROUTE}/inventory?reorder=1`} className="text-sm text-primary hover:underline">
              See all in Inventory
            </Link>
          </div>
          <ul className="divide-y divide-border/50 text-sm">
            {reorderRows.slice(0, 6).map((row) => (
              <li key={row.item_id} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {row.item_name}
                  {!row.tracked && (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-foreground/60">no stock count</span>
                  )}
                </span>
                <span className="text-foreground/70">
                  {row.tracked ? `${row.on_hand ?? 0} on hand · ` : ""}need {row.total_demand} · short {row.shortfall}
                  {row.first_short_date ? ` by ${formatShortDate(row.first_short_date)}` : ""}
                </span>
              </li>
            ))}
          </ul>
          {reorderRows.length > 6 && (
            <p className="text-xs text-foreground/60">{reorderRows.length - 6} more in Inventory.</p>
          )}
        </section>
      )}

      <section className="rounded-xl border border-border/60 p-4 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-serif text-lg font-bold text-primary">New this week</h3>
          <Link to={`${ADMIN_ROUTE}/enrollments`} className="text-sm text-primary hover:underline">
            All enrollments
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="text-sm text-foreground/60">{loading ? "Loading..." : "No new enrollments in the last 7 days."}</p>
        ) : (
          <ul className="divide-y divide-border/50 text-sm">
            {recent.map((row) => (
              <li key={row.id} className="flex justify-between gap-3 py-2">
                <span>
                  {row.student}
                  {row.parent ? <span className="text-foreground/60"> · {row.parent}</span> : null}
                  {row.test ? (
                    <span className="ml-2 rounded bg-secondary px-1.5 py-0.5 text-[11px] text-foreground/60">test account</span>
                  ) : null}
                </span>
                <span className="text-foreground/60">{new Date(row.created_at).toLocaleDateString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MCA_R7_ADMIN_NAV: grouped left sidebar. On phones it's a drawer opened from
// the menu button in the top bar.
// ---------------------------------------------------------------------------

interface AdminNavItem {
  to: string;
  label: string;
  end?: boolean;
  badge?: number;
}

function adminNavGroups(pendingReviews: number): Array<{ title: string; tour: string; items: AdminNavItem[] }> {
  return [
    { title: "Today", tour: "admin-nav-today", items: [{ to: ADMIN_ROUTE, label: "Dashboard", end: true }] },
    {
      title: "Students",
      tour: "admin-nav-students",
      items: [
        { to: `${ADMIN_ROUTE}/families`, label: "Families" },
        { to: `${ADMIN_ROUTE}/enrollments`, label: "Current Enrollments" },
        { to: `${ADMIN_ROUTE}/test-reviews`, label: "Test Reviews", badge: pendingReviews },
        { to: `${ADMIN_ROUTE}/reenrollment`, label: "Re-enrollment" },
      ],
    },
    {
      title: "Shipping",
      tour: "admin-nav-shipping",
      items: [
        { to: `${ADMIN_ROUTE}/pick-lists`, label: "Pick Lists" },
        { to: `${ADMIN_ROUTE}/orders`, label: "Store Orders" },
      ],
    },
    {
      title: "Store",
      tour: "admin-nav-store",
      items: [
        { to: `${ADMIN_ROUTE}/inventory`, label: "Inventory Pricing" },
        { to: `${ADMIN_ROUTE}/plans`, label: "Subscription Plans" },
      ],
    },
    {
      title: "Settings",
      tour: "admin-nav-settings",
      items: [
        { to: `${ADMIN_ROUTE}/emails`, label: "Email Templates" },
        { to: `${ADMIN_ROUTE}/users`, label: "Admin Users" },
        { to: `${ADMIN_ROUTE}/settings`, label: "Settings" },
      ],
    },
  ];
}

function AdminSidebarNav({
  pendingReviews,
  onNavigate,
  onReplayTour,
  onLogout,
}: {
  pendingReviews: number;
  onNavigate: () => void;
  onReplayTour: () => void;
  onLogout: () => void;
}) {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
      isActive ? "bg-primary text-primary-foreground" : "text-foreground/75 hover:bg-secondary"
    }`;
  return (
    <div className="flex h-full flex-col">
      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Admin">
        {adminNavGroups(pendingReviews).map((group) => (
          <div key={group.title} data-tour={group.tour}>
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-foreground/45">
              {group.title}
            </p>
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={linkClass} onClick={onNavigate}>
                  {({ isActive }) => (
                    <>
                      <span>{item.label}</span>
                      {item.badge ? (
                        <span
                          className={`min-w-[1.5rem] rounded-full px-1.5 text-center text-xs font-semibold ${
                            isActive ? "bg-primary-foreground text-primary" : "bg-primary text-primary-foreground"
                          }`}
                          aria-label={`${item.badge} waiting`}
                          data-marker="MCA_R7_REVIEW_BADGE"
                        >
                          {item.badge}
                        </span>
                      ) : null}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t border-border/50 px-3 py-3">
        <NavLink to={`${ADMIN_ROUTE}/help`} className={linkClass} onClick={onNavigate} data-tour="admin-nav-help">
          <span className="flex items-center gap-2">
            <HelpCircle className="h-4 w-4" />
            Help
          </span>
        </NavLink>
        <button
          type="button"
          onClick={onReplayTour}
          className="block px-3 py-1 text-xs text-foreground/60 underline-offset-2 hover:text-primary hover:underline"
          data-marker="MCA_R6_ADMIN_TOUR_LINK"
          data-tour="admin-tour-button"
          title="Replay the admin tour"
        >
          Replay tour
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-foreground/75 hover:bg-secondary"
        >
          <LogOut className="h-4 w-4" />
          Log Out
        </button>
      </div>
    </div>
  );
}

// Phone layout (matches Tailwind's md breakpoint).
function isPhoneWidth(): boolean {
  return window.innerWidth < 768;
}

const AdminLayout = () => {
  const [checking, setChecking] = useState(true);
  const [session, setSession] = useState<any>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingReviews, setPendingReviews] = useState(0);
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStart, setTourStart] = useState<string | null>(null);
  const [tourFamilyId, setTourFamilyId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
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
    setMenuOpen(false);
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

  const outletContext: AdminOutletContext = {
    startTour,
    lastPage: lastPageRef.current,
    tourStepIds: tourSteps.map((s) => s.id),
  };

  const closeMenu = () => setMenuOpen(false);
  const sidebarProps = {
    pendingReviews,
    onNavigate: closeMenu,
    onReplayTour: () => {
      closeMenu();
      startTour();
    },
    onLogout: handleLogout,
  };

  return (
    <div className="min-h-screen bg-background" data-marker="MCA_R7_ADMIN_NAV">
      {/* Desktop: fixed left sidebar. */}
      <aside
        className="hidden md:flex fixed inset-y-0 left-0 z-30 w-60 flex-col border-r border-border/50 bg-secondary/50 print:hidden"
        data-tour="admin-sidebar"
      >
        <div className="px-6 pt-5 pb-1">
          <NavLink to={ADMIN_ROUTE} className="text-xl font-bold font-serif text-primary">
            MCA Admin
          </NavLink>
        </div>
        <AdminSidebarNav {...sidebarProps} />
      </aside>

      {/* Phone: top bar with a menu button that opens the sidebar as a drawer. */}
      <header className="md:hidden sticky top-0 z-30 flex items-center gap-3 border-b border-border/50 bg-secondary px-4 py-3 print:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          className="rounded-lg p-2 text-foreground/80 hover:bg-background"
          aria-label="Open menu"
          aria-expanded={menuOpen}
          data-tour="admin-menu-button"
        >
          <Menu className="h-5 w-5" />
        </button>
        <NavLink to={ADMIN_ROUTE} className="text-lg font-bold font-serif text-primary">
          MCA Admin
        </NavLink>
        {pendingReviews > 0 && (
          <NavLink
            to={`${ADMIN_ROUTE}/test-reviews`}
            className="ml-auto rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground"
          >
            {pendingReviews} to review
          </NavLink>
        )}
      </header>
      {menuOpen && (
        <div className="md:hidden fixed inset-0 z-50 print:hidden" role="dialog" aria-modal="true" aria-label="Admin menu">
          <div className="absolute inset-0 bg-black/40" onClick={closeMenu} aria-hidden="true" />
          <aside
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-xl"
            data-tour="admin-sidebar"
          >
            <div className="flex items-center justify-between px-6 pt-4">
              <span className="text-xl font-bold font-serif text-primary">MCA Admin</span>
              <button
                type="button"
                onClick={closeMenu}
                className="rounded-lg p-2 text-foreground/70 hover:bg-secondary"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <AdminSidebarNav {...sidebarProps} />
          </aside>
        </div>
      )}

      <SpotlightTour
        name="admin"
        open={tourOpen}
        onClose={closeTour}
        steps={tourSteps}
        startAt={tourStart}
        onStepChange={(step) => setMenuOpen(isPhoneWidth() && ADMIN_MENU_TOUR_STEPS.has(step.id))}
      />
      <div className="md:pl-60">
        <main className="max-w-6xl mx-auto px-4 py-6 md:px-8 md:py-10">
          <Outlet context={outletContext} />
        </main>
      </div>
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
