import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Printer } from "lucide-react";
import { compareSubjectNames, isIllinoisHistoryPace, paceLabel } from "@/lib/loggedCourses";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

// ---------------------------------------------------------------------------
// Round 3 A4 (marker MCA_R3_A4_PACKING_LIST): shared packing slip. No prices.
// ---------------------------------------------------------------------------
export const MCA_R3_A4_MARKER = "MCA_R3_A4_PACKING_LIST";
const PACKING_LOGO_URL =
  "https://vibe.filesafe.space/1784303289974857996/attachments/5ce70202-91c1-463f-929b-e89f47f07a50.png";

export interface PackingSlipLine {
  name: string;
  quantity: number;
  note?: string;
}

export interface PackingSlip {
  reference: string;
  date: string;
  shipTo: {
    name: string;
    addressLines: string[];
    phone?: string | null;
    email?: string | null;
  };
  studentName?: string | null;
  lines: PackingSlipLine[];
  footerNote?: string | null;
}

function escapeSlip(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Full HTML document, one slip per printed page. */
export function renderPackingSlipHtml(slips: PackingSlip[]): string {
  const pages = slips
    .map((slip) => {
      const rows = slip.lines
        .map(
          (line) => `
          <tr>
            <td class="box"><span class="check"></span></td>
            <td>${escapeSlip(line.name)}</td>
            <td class="qty">${escapeSlip(line.quantity)}</td>
            <td>${escapeSlip(line.note ?? "")}</td>
          </tr>`,
        )
        .join("");
      const address = slip.shipTo.addressLines
        .filter(Boolean)
        .map((l) => `<div>${escapeSlip(l)}</div>`)
        .join("");
      return `
      <section class="slip">
        <header>
          <div class="brand">
            <img src="${PACKING_LOGO_URL}" alt="" />
            <div>
              <div class="school">Midwest Christian Academy</div>
              <div class="contact">(844) 663-4477 &middot; david@midwestchristianacademy.com</div>
            </div>
          </div>
          <div class="title">
            <div class="label">PACKING LIST</div>
            <div>${escapeSlip(slip.reference)}</div>
            <div>${escapeSlip(slip.date)}</div>
          </div>
        </header>
        <div class="shipto">
          <div class="heading">Ship to</div>
          <div class="name">${escapeSlip(slip.shipTo.name)}</div>
          ${address}
          ${slip.shipTo.phone ? `<div>${escapeSlip(slip.shipTo.phone)}</div>` : ""}
          ${slip.shipTo.email ? `<div>${escapeSlip(slip.shipTo.email)}</div>` : ""}
          ${slip.studentName ? `<div class="student">Student: ${escapeSlip(slip.studentName)}</div>` : ""}
        </div>
        <table>
          <thead><tr><th class="box"></th><th>Item</th><th class="qty">Qty</th><th>Note</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4">No items.</td></tr>'}</tbody>
        </table>
        ${slip.footerNote ? `<p class="footnote">${escapeSlip(slip.footerNote)}</p>` : ""}
        <div class="packed">Packed by: ______________________ &nbsp; Date: ____________</div>
        <p class="thanks">Thank you for learning with Midwest Christian Academy.</p>
      </section>`;
    })
    .join("");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Packing list</title>
<!-- ${MCA_R3_A4_MARKER} -->
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
  .slip { padding: 32px 40px; page-break-after: always; }
  .slip:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111; padding-bottom: 12px; }
  .brand { display: flex; gap: 12px; align-items: center; }
  .brand img { height: 56px; }
  .school { font-size: 20px; font-weight: bold; }
  .contact { font-size: 12px; color: #444; }
  .title { text-align: right; font-size: 12px; }
  .title .label { font-size: 22px; font-weight: bold; letter-spacing: 1px; }
  .shipto { margin: 18px 0; font-size: 14px; line-height: 1.4; }
  .shipto .heading { font-size: 11px; text-transform: uppercase; color: #666; }
  .shipto .name { font-weight: bold; }
  .shipto .student { margin-top: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; vertical-align: top; }
  th { background: #f2f2f2; }
  td.box, th.box { width: 28px; text-align: center; }
  td.qty, th.qty { width: 50px; text-align: center; }
  .check { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #111; }
  .footnote { font-size: 12px; color: #444; margin-top: 10px; }
  .packed { margin-top: 28px; font-size: 13px; }
  .thanks { margin-top: 18px; font-size: 12px; color: #666; text-align: center; }
</style>
</head>
<body>${pages}</body>
</html>`;
}

export function printPackingSlips(slips: PackingSlip[]): boolean {
  const w = window.open("", "_blank", "width=900,height=1000");
  if (!w) return false;
  w.document.write(renderPackingSlipHtml(slips));
  w.document.close();
  w.focus();
  window.setTimeout(() => w.print(), 400);
  return true;
}

interface PackingFamily {
  parent_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
}

function firstRel<T>(rel: T | T[] | null | undefined): T | null {
  if (!rel) return null;
  return Array.isArray(rel) ? rel[0] ?? null : rel;
}

function familyAddressLines(f: PackingFamily | null): string[] {
  if (!f) return [];
  if (f.address_street) {
    const cityLine = [f.address_city, [f.address_state, f.address_zip].filter(Boolean).join(" ")]
      .filter(Boolean)
      .join(", ");
    return [f.address_street, cityLine];
  }
  return f.address ? f.address.split(/\n|,\s*(?=[A-Za-z].*\d{5})/).map((l) => l.trim()) : [];
}

interface PickList {
  id: string;
  school_year: string;
  ship_date: string;
  status: string;
  paused_for_missing_scores: boolean;
  notes: string | null;
  reminder_email_sent_at: string | null;
  students:
    | { student_name: string; families?: PackingFamily | PackingFamily[] | null }
    | { student_name: string; families?: PackingFamily | PackingFamily[] | null }[]
    | null;
  pick_list_items: Array<{
    id: string;
    pace_number: number;
    quantity_on_hand: number | null;
    backordered: boolean | null;
    subjects: { name: string } | { name: string }[] | null;
    items: { original_name: string } | { original_name: string }[] | null;
  }>;
  resource_book_notices?: Array<{
    notified_at: string | null;
    items: { original_name: string } | { original_name: string }[] | null;
  }>;
}

function relText(
  rel: Record<string, string> | Record<string, string>[] | null,
  key: string,
): string {
  if (!rel) return "";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.[key] ?? "";
}

export default function AdminPickLists() {
  const { toast } = useToast();
  const [lists, setLists] = useState<PickList[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [printScope, setPrintScope] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pick_lists")
      .select(
        "id, school_year, ship_date, status, paused_for_missing_scores, notes, reminder_email_sent_at, students(student_name, families(parent_name, email, phone, address, address_street, address_city, address_state, address_zip)), pick_list_items(id, pace_number, quantity_on_hand, backordered, subjects(name), items(original_name)), resource_book_notices(notified_at, items(original_name))",
      )
      .order("ship_date", { ascending: false })
      .limit(100);
    if (error) {
      toast({ title: "Couldn't load pick lists", description: error.message, variant: "destructive" });
    } else {
      setLists((data ?? []) as PickList[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!printScope) return;
    const finish = () => setPrintScope(null);
    window.addEventListener("afterprint", finish);
    const timer = window.setTimeout(() => window.print(), 0);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("afterprint", finish);
    };
  }, [printScope]);

  const generateDue = async () => {
    setRunning(true);
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-pick-lists`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.access_token ?? ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    const result = await res.json();
    if (!res.ok || result.error) {
      toast({
        title: "Generation failed",
        description: result.error || "Deploy generate-pick-lists and apply the logged-course migration first.",
        variant: "destructive",
      });
    } else {
      const count = Array.isArray(result.results) ? result.results.length : 0;
      toast({ title: "Pick lists checked", description: `${count} schedule${count === 1 ? "" : "s"} reviewed.` });
      load();
    }
    setRunning(false);
  };

  const readyCount = lists.filter((list) => list.status === "ready").length;

  const slipForList = (list: PickList): PackingSlip => {
    const student = firstRel(list.students);
    const family = firstRel(student?.families ?? null);
    const lines = [...list.pick_list_items]
      .sort(
        (a, b) =>
          compareSubjectNames(relText(a.subjects, "name"), relText(b.subjects, "name")) ||
          a.pace_number - b.pace_number,
      )
      .map((item) => {
        const subject = relText(item.subjects, "name") || "Subject";
        const name = relText(item.items, "original_name") || `${subject} PACE`;
        return {
          name,
          quantity: 1,
          note: [
            isIllinoisHistoryPace(subject, item.pace_number) ? "" : `ACE #${paceLabel(subject, item.pace_number)}`,
            item.backordered ? "Backordered - ships later" : ""]
            .filter(Boolean)
            .join(" | "),
        };
      });
    return {
      reference: `Pick list ${list.id.slice(0, 8).toUpperCase()}`,
      date: list.ship_date,
      shipTo: {
        name: family?.parent_name || student?.student_name || "Family",
        addressLines: familyAddressLines(family),
        phone: family?.phone,
        email: family?.email,
      },
      studentName: student?.student_name ?? null,
      lines,
      footerNote: `School year ${list.school_year}.`,
    };
  };

  const printSlips = (target: PickList[]) => {
    if (target.length === 0) return;
    if (!printPackingSlips(target.map(slipForList))) {
      toast({ title: "Pop-up blocked", description: "Allow pop-ups to print packing lists.", variant: "destructive" });
    }
  };

  const markShipped = async (list: PickList) => {
    if (!window.confirm("Mark this pick list as shipped?")) return;
    const { error } = await supabase
      .from("pick_lists")
      .update({ status: "shipped", updated_at: new Date().toISOString() })
      .eq("id", list.id);
    if (error) {
      toast({ title: "Couldn't update", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  return (
    <div className="space-y-6 print:space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap print:hidden">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">Pick lists</h2>
          <p className="text-sm text-foreground/60">
            Due lists are the ones whose next ship date is within 7 days.
            Paused rows are the admin flag for missing scores. A backordered
            line still ships with the rest of the list.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setPrintScope("all-ready")}
            disabled={readyCount === 0}
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Print all ready
          </Button>
          <Button
            variant="outline"
            onClick={() => printSlips(lists.filter((list) => list.status === "ready"))}
            disabled={readyCount === 0}
            data-marker="MCA_R3_A4_PACKING_LIST"
          >
            <Printer className="h-4 w-4 mr-1.5" />
            Packing lists, all ready (one family per page)
          </Button>
          <Button onClick={generateDue} disabled={running}>
            {running ? "Running..." : "Generate due pick lists"}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-foreground/60 print:hidden">Loading...</p>
      ) : lists.length === 0 ? (
        <p className="text-foreground/60 print:hidden">No pick lists yet.</p>
      ) : (
        <div className="space-y-3 print:space-y-4 print:columns-1">
          {lists.map((list) => {
            const hideOnPrint =
              printScope === "all-ready"
                ? list.status !== "ready"
                : printScope != null && printScope !== list.id;
            return (
              <div
                key={list.id}
                className={`rounded-xl border border-border/60 p-4 space-y-2 break-inside-avoid ${
                  hideOnPrint ? "print:hidden" : ""
                }`}
              >
                <div className="flex justify-between gap-3 flex-wrap">
                  <p className="font-medium">
                    {(firstRel(list.students)?.student_name ?? "") || "Student"} · {list.ship_date} · {list.school_year}
                  </p>
                  <div className="flex items-center gap-2">
                    <p className="text-sm capitalize">
                      {list.status}
                      {list.paused_for_missing_scores ? " · paused for missing scores" : ""}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      onClick={() => setPrintScope(list.id)}
                    >
                      <Printer className="h-4 w-4 mr-1.5" />
                      Print
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="print:hidden"
                      onClick={() => printSlips([list])}
                    >
                      Packing list
                    </Button>
                    {list.status === "ready" && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="print:hidden"
                        onClick={() => markShipped(list)}
                      >
                        Mark shipped
                      </Button>
                    )}
                  </div>
                </div>
                {list.notes && <p className="text-sm text-foreground/70">{list.notes}</p>}
                {list.reminder_email_sent_at && (
                  <p className="text-xs text-foreground/50">
                    Reminder emailed {new Date(list.reminder_email_sent_at).toLocaleString()}
                  </p>
                )}
                {(list.resource_book_notices ?? []).length > 0 && (
                  <p className="text-sm text-foreground/70">
                    Notified parent:{" "}
                    {(list.resource_book_notices ?? [])
                      .map((notice) => relText(notice.items, "original_name"))
                      .filter(Boolean)
                      .join(", ")}
                  </p>
                )}
                <ul className="text-sm text-foreground/80 columns-2 print:columns-1">
                  {[...list.pick_list_items]
                    .sort((a, b) =>
                      compareSubjectNames(relText(a.subjects, "name"), relText(b.subjects, "name")) ||
                      a.pace_number - b.pace_number,
                    )
                    .map((item) => {
                    const itemName = relText(item.items, "original_name");
                    return (
                      <li key={item.id} className="break-inside-avoid">
                        {relText(item.subjects, "name") || "Subject"} {paceLabel(relText(item.subjects, "name"), item.pace_number)}
                        {itemName ? ` · ${itemName}` : ""}
                        {item.quantity_on_hand != null ? ` · on hand ${item.quantity_on_hand}` : ""}
                        {item.backordered ? (
                          <span className="ml-2 text-xs font-semibold text-destructive">
                            Backordered
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

interface BackorderRow {
  source: "pick_list" | "order";
  line_id: string;
  customer_name: string | null;
  item_name: string | null;
  quantity: number;
  ordered_at: string;
  backorder_fulfilled_at: string | null;
  backordered: boolean;
}

export function AdminBackorders() {
  const { toast } = useToast();
  const [rows, setRows] = useState<BackorderRow[]>([]);
  const [filter, setFilter] = useState<"open" | "fulfilled" | "all">("open");
  const [loading, setLoading] = useState(true);
  const [draftDate, setDraftDate] = useState<Record<string, string>>({});

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_backordered_items_v")
      .select("source, line_id, customer_name, item_name, quantity, ordered_at, backorder_fulfilled_at, backordered")
      .order("ordered_at", { ascending: false });
    if (error) {
      toast({ title: "Couldn't load backorders", description: error.message, variant: "destructive" });
      setRows([]);
    } else {
      setRows((data ?? []) as BackorderRow[]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const visible = rows.filter((row) => {
    if (filter === "open") return !row.backorder_fulfilled_at;
    if (filter === "fulfilled") return !!row.backorder_fulfilled_at;
    return true;
  });

  const saveFulfilled = async (row: BackorderRow, fulfilledAt: string | null) => {
    const table = row.source === "pick_list" ? "pick_list_items" : "order_items";
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase
      .from(table)
      .update({
        backorder_fulfilled_at: fulfilledAt,
        backorder_fulfilled_by: fulfilledAt ? userData.user?.id ?? null : null,
      })
      .eq("id", row.line_id);
    if (error) {
      toast({ title: "Couldn't update the line", description: error.message, variant: "destructive" });
      return;
    }
    load();
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">Backordered Items</h2>
        <p className="text-sm text-foreground/60">
          Pick-list lines and store lines that were short when they were ordered.
        </p>
      </div>
      <div className="flex gap-2">
        {(["open", "fulfilled", "all"] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={filter === value ? "default" : "outline"}
            onClick={() => setFilter(value)}
          >
            {value[0].toUpperCase() + value.slice(1)}
          </Button>
        ))}
      </div>
      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : visible.length === 0 ? (
        <p className="text-sm text-foreground/60">No backordered items in this view.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-3">Customer Name</th>
                <th className="p-3">Item</th>
                <th className="p-3">Quantity</th>
                <th className="p-3">Date Ordered</th>
                <th className="p-3">Date Fulfilled</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const key = `${row.source}:${row.line_id}`;
                const fulfilled = (draftDate[key] ?? row.backorder_fulfilled_at ?? "").slice(0, 10);
                return (
                  <tr key={key} className="border-t">
                    <td className="p-3">{row.customer_name}</td>
                    <td className="p-3">{row.item_name}</td>
                    <td className="p-3">{row.quantity}</td>
                    <td className="p-3">{new Date(row.ordered_at).toLocaleDateString()}</td>
                    <td className="p-3">
                      <Input
                        type="date"
                        className="h-8 w-40"
                        value={fulfilled}
                        onChange={(event) =>
                          setDraftDate((prev) => ({ ...prev, [key]: event.target.value }))
                        }
                      />
                    </td>
                    <td className="p-3 space-x-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          saveFulfilled(row, (draftDate[key] || new Date().toLocaleDateString("en-CA")) + "T00:00:00Z")
                        }
                      >
                        Mark fulfilled
                      </Button>
                      {row.backorder_fulfilled_at && (
                        <Button type="button" size="sm" variant="outline" onClick={() => saveFulfilled(row, null)}>
                          Undo
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
