import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Printer, Download } from "lucide-react";
import { printPackingSlips, type PackingSlip } from "./AdminPickLists";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

type OrderStatus = "submitted" | "confirmed" | "fulfilled" | "cancelled";

interface OrderItemRow {
  quantity: number;
  unit_price_at_order: number;
  backordered?: boolean | null;
  items: { original_name: string; sku: string } | null;
}

interface Order {
  id: string;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  status: OrderStatus;
  payment_status: string;
  shipping_address: string | null;
  shipping_fee: number | null;
  total: number;
  created_at: string;
  order_items: OrderItemRow[];
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  submitted: "Submitted",
  confirmed: "Confirmed",
  fulfilled: "Fulfilled",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  submitted: "bg-accent/20 text-accent-foreground",
  confirmed: "bg-primary/10 text-primary",
  fulfilled: "bg-green-500/10 text-green-700",
  cancelled: "bg-destructive/10 text-destructive",
};

const AdminOrders = () => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [refundTarget, setRefundTarget] = useState<Order | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refunding, setRefunding] = useState(false);
  const [refundError, setRefundError] = useState<string | null>(null);

  const loadOrders = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("orders")
      .select(
        `
        id, customer_name, customer_email, customer_phone, status, payment_status,
        shipping_address, shipping_fee, total, created_at,
        order_items ( quantity, unit_price_at_order, backordered, items ( original_name, sku ) )
      `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      toast({
        title: "Couldn't load orders",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setOrders((data as any) ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const fromTime = dateFrom
      ? new Date(`${dateFrom}T00:00:00`).getTime()
      : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    return orders.filter((o) => {
      if (statusFilter !== "all" && o.status !== statusFilter) return false;

      const created = new Date(o.created_at).getTime();
      if (fromTime != null && created < fromTime) return false;
      if (toTime != null && created > toTime) return false;

      if (!term) return true;
      const haystack = [
        o.customer_name,
        o.customer_email,
        o.customer_phone,
        ...o.order_items.map((oi) => oi.items?.original_name ?? ""),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [orders, search, statusFilter, dateFrom, dateTo]);

  // Counts for the summary tiles — respect the date range like the rest of
  // the page, but deliberately ignore the status filter/search so the
  // breakdown always shows all categories, not just the one currently
  // selected below.
  const statusCounts = useMemo(() => {
    const fromTime = dateFrom
      ? new Date(`${dateFrom}T00:00:00`).getTime()
      : null;
    const toTime = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : null;

    const counts: Record<OrderStatus, number> = {
      submitted: 0,
      confirmed: 0,
      fulfilled: 0,
      cancelled: 0,
    };
    let total = 0;

    for (const o of orders) {
      const created = new Date(o.created_at).getTime();
      if (fromTime != null && created < fromTime) continue;
      if (toTime != null && created > toTime) continue;
      counts[o.status]++;
      total++;
    }

    return { counts, total };
  }, [orders, dateFrom, dateTo]);

  const clearDateRange = () => {
    setDateFrom("");
    setDateTo("");
  };

  const updateStatus = async (order: Order, newStatus: OrderStatus) => {
    setUpdatingId(order.id);
    const { error } = await supabase
      .from("orders")
      .update({ status: newStatus })
      .eq("id", order.id);

    if (error) {
      toast({
        title: "Couldn't update status",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: newStatus } : o)),
      );
    }
    setUpdatingId(null);
  };

  const openRefundDialog = (order: Order) => {
    setRefundReason("");
    setRefundError(null);
    setRefundTarget(order);
  };

  const confirmRefund = async () => {
    if (!refundTarget) return;
    setRefunding(true);
    setRefundError(null);

    const { data: sessionData } = await supabase.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/cancel-store-order`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionData.session?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: refundTarget.id,
        reason: refundReason || undefined,
      }),
    });
    const result = await res.json();

    if (!res.ok || result.error) {
      setRefundError(result.error ?? "Refund failed.");
      setRefunding(false);
      return;
    }

    toast({
      title: "Order refunded and cancelled",
      description: `$${Number(result.amount_refunded).toFixed(2)} refunded through Stripe.`,
    });
    setOrders((prev) =>
      prev.map((o) =>
        o.id === refundTarget.id
          ? { ...o, status: "cancelled", payment_status: "refunded" }
          : o,
      ),
    );
    setRefunding(false);
    setRefundTarget(null);
  };

  const escapeHtml = (str: string) => {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  };

  // Round 3 A4 (marker MCA_R3_A4_PACKING_LIST): customer-facing packing list, no prices.
  const printPackingList = (order: Order) => {
    const slip: PackingSlip = {
      reference: `Order ${order.id.slice(0, 8).toUpperCase()}`,
      date: new Date(order.created_at).toLocaleDateString(),
      shipTo: {
        name: order.customer_name || "Customer",
        addressLines: order.shipping_address
          ? order.shipping_address.split(/\n/).map((l) => l.trim())
          : ["Local Pickup"],
        phone: order.customer_phone,
        email: order.customer_email,
      },
      lines: order.order_items.map((oi) => ({
        name: oi.items?.original_name ?? "Item",
        quantity: oi.quantity,
        note: oi.backordered ? "Backordered - ships later" : "",
      })),
    };
    if (!printPackingSlips([slip])) {
      toast({
        title: "Couldn't open print window",
        description: "Allow pop-ups to print the packing list.",
        variant: "destructive",
      });
    }
  };

  const printOrder = (order: Order) => {
    const printWindow = window.open("", "_blank", "width=800,height=900");
    if (!printWindow) {
      toast({
        title: "Couldn't open print window",
        description:
          "Your browser may have blocked the popup — check your browser settings and try again.",
        variant: "destructive",
      });
      return;
    }

    const itemRows = order.order_items
      .map(
        (oi) => `
          <tr>
            <td>${escapeHtml(oi.items?.original_name ?? "Unknown item")}</td>
            <td class="sku">${escapeHtml(oi.items?.sku ?? "—")}</td>
            <td class="qty">${oi.quantity}</td>
          </tr>
        `,
      )
      .join("");

    const fulfillmentLine = order.shipping_address
      ? `Ship to: ${escapeHtml(order.shipping_address)}`
      : "Local Pickup";

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Order Pick List — ${escapeHtml(order.customer_name || "Order")}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              font-family: Georgia, 'Times New Roman', serif;
              color: #1a1a2e;
              padding: 48px;
              max-width: 700px;
              margin: 0 auto;
            }
            h1 { font-size: 22px; margin: 0 0 4px; }
            .subtitle { color: #666; font-size: 13px; margin-bottom: 28px; }
            .section { margin-bottom: 20px; }
            .label {
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.06em;
              color: #888;
              margin-bottom: 4px;
            }
            .value { font-size: 15px; }
            table { width: 100%; border-collapse: collapse; margin-top: 8px; }
            th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid #ddd; font-size: 14px; }
            th { background: #f2f2f2; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
            td.qty, th.qty { text-align: center; width: 60px; }
            td.sku { color: #777; font-size: 12px; }
            .total-row {
              display: flex;
              justify-content: flex-end;
              gap: 16px;
              margin-top: 16px;
              font-size: 18px;
              font-weight: bold;
            }
            @media print {
              body { padding: 24px; }
            }
          </style>
        </head>
        <body>
          <h1>Midwest Christian Academy — Order Pick List</h1>
          <div class="subtitle">Order placed ${escapeHtml(new Date(order.created_at).toLocaleString())}</div>

          <div class="section">
            <div class="label">Customer</div>
            <div class="value">${escapeHtml(order.customer_name || "—")}</div>
            <div class="value">${escapeHtml(order.customer_email || "")}</div>
            <div class="value">${escapeHtml(order.customer_phone || "")}</div>
          </div>

          <div class="section">
            <div class="label">Fulfillment</div>
            <div class="value">${fulfillmentLine}</div>
            ${order.shipping_fee != null ? `<div class="value">Shipping: $${order.shipping_fee.toFixed(2)}</div>` : ""}
          </div>

          <div class="section">
            <div class="label">Items to Pick</div>
            <table>
              <thead>
                <tr><th>Item</th><th>SKU</th><th class="qty">Qty</th></tr>
              </thead>
              <tbody>${itemRows}</tbody>
            </table>
          </div>

          <div class="total-row">
            <span>Total:</span>
            <span>$${order.total.toFixed(2)}</span>
          </div>
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  };

  const exportCsv = () => {
    const rows: (string | number)[][] = [
      [
        "order_date",
        "customer_name",
        "customer_email",
        "customer_phone",
        "status",
        "payment_status",
        "fulfillment",
        "shipping_fee",
        "total",
        "item_name",
        "item_sku",
        "quantity",
      ],
    ];

    for (const order of filtered) {
      const fulfillment = order.shipping_address
        ? `Ship: ${order.shipping_address}`
        : "Pickup";
      if (order.order_items.length === 0) {
        rows.push([
          new Date(order.created_at).toLocaleString(),
          order.customer_name ?? "",
          order.customer_email ?? "",
          order.customer_phone ?? "",
          order.status,
          order.payment_status,
          fulfillment,
          order.shipping_fee ?? "",
          order.total,
          "",
          "",
          "",
        ]);
        continue;
      }
      for (const oi of order.order_items) {
        rows.push([
          new Date(order.created_at).toLocaleString(),
          order.customer_name ?? "",
          order.customer_email ?? "",
          order.customer_phone ?? "",
          order.status,
          order.payment_status,
          fulfillment,
          order.shipping_fee ?? "",
          order.total,
          oi.items?.original_name ?? "",
          oi.items?.sku ?? "",
          oi.quantity,
        ]);
      }
    }

    const csv = rows
      .map((row) =>
        row
          .map((cell) => {
            const str = String(cell ?? "");
            return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
          })
          .join(","),
      )
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `mca-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h2 className="text-2xl font-bold font-serif text-primary">
          Store Orders
        </h2>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-1.5" />
          Export CSV ({filtered.length})
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="rounded-xl border border-border/50 bg-secondary/30 p-4">
          <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
            Total
          </p>
          <p className="text-2xl font-bold text-foreground">
            {statusCounts.total}
          </p>
        </div>
        {(Object.entries(STATUS_LABELS) as [OrderStatus, string][]).map(
          ([status, label]) => (
            <div
              key={status}
              className="rounded-xl border border-border/50 bg-secondary/30 p-4"
            >
              <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
                {label}
              </p>
              <p className="text-2xl font-bold text-foreground">
                {statusCounts.counts[status]}
              </p>
            </div>
          ),
        )}
      </div>
      {(dateFrom || dateTo) && (
        <p className="text-xs text-foreground/50 -mt-4">
          Counts reflect the selected date range
          {dateFrom && ` from ${dateFrom}`}
          {dateTo && ` to ${dateTo}`}.
        </p>
      )}

      <div className="flex flex-col sm:flex-row flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <Input
            placeholder="Search customer, email, item..."
            className="bg-background"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="bg-background w-48">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="space-y-1">
          <Label htmlFor="date-from" className="text-xs text-foreground/60">
            From
          </Label>
          <Input
            id="date-from"
            type="date"
            className="bg-background w-40"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="date-to" className="text-xs text-foreground/60">
            To
          </Label>
          <Input
            id="date-to"
            type="date"
            className="bg-background w-40"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        {(dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" onClick={clearDateRange}>
            Clear dates
          </Button>
        )}
      </div>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : filtered.length === 0 ? (
        <p className="text-foreground/60">
          {orders.length === 0
            ? "No orders yet."
            : "No orders match your search/filter."}
        </p>
      ) : (
        <div className="space-y-4">
          {filtered.map((order) => (
            <div
              key={order.id}
              className="rounded-xl border border-border/50 bg-secondary/30 p-5"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
                <div>
                  <p className="font-semibold text-foreground">
                    {order.customer_name || "—"}
                  </p>
                  <p className="text-sm text-foreground/70">
                    {order.customer_email}
                  </p>
                  <p className="text-sm text-foreground/70">
                    {order.customer_phone}
                  </p>
                  <p className="text-xs text-foreground/50 mt-1">
                    {new Date(order.created_at).toLocaleString()}
                  </p>
                  {order.payment_status === "refunded" && (
                    <span className="inline-block mt-1 text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/10 text-destructive">
                      Refunded
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-start sm:items-end gap-2">
                  <span
                    className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[order.status]}`}
                  >
                    {STATUS_LABELS[order.status]}
                  </span>
                  <Select
                    value={order.status}
                    onValueChange={(v) => updateStatus(order, v as OrderStatus)}
                    disabled={
                      updatingId === order.id || order.status === "cancelled"
                    }
                  >
                    <SelectTrigger className="bg-background w-40 h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => printOrder(order)}
                  >
                    <Printer className="h-3 w-3 mr-1.5" />
                    Order summary
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => printPackingList(order)}
                    data-marker="MCA_R3_A4_PACKING_LIST"
                  >
                    <Printer className="h-3 w-3 mr-1.5" />
                    Print packing list
                  </Button>
                  {order.payment_status === "paid" &&
                    order.status !== "cancelled" && (
                      <Button
                        size="sm"
                        variant="destructive"
                        className="h-8 text-xs"
                        onClick={() => openRefundDialog(order)}
                      >
                        Cancel & Refund
                      </Button>
                    )}
                </div>
              </div>

              <div className="bg-background rounded-lg border border-border/50 p-4 mb-3">
                <p className="text-xs uppercase tracking-wide text-foreground/50 mb-2">
                  Pick List
                </p>
                <ul className="space-y-1">
                  {order.order_items.map((oi, i) => (
                    <li key={i} className="flex justify-between text-sm">
                      <span>
                        {oi.items?.original_name ?? "Unknown item"}{" "}
                        <span className="text-foreground/50">
                          ({oi.items?.sku})
                        </span>
                      </span>
                      <span className="font-medium">× {oi.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm">
                <p className="text-foreground/70">
                  {order.shipping_address
                    ? `Ship to: ${order.shipping_address}`
                    : "Local Pickup"}
                  {order.shipping_fee != null &&
                    ` (+$${order.shipping_fee.toFixed(2)} shipping)`}
                </p>
                <p className="font-bold text-primary">
                  Total: ${order.total.toFixed(2)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      <AlertDialog
        open={!!refundTarget}
        onOpenChange={(open) => !open && setRefundTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Cancel & refund {refundTarget?.customer_name}'s order?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This refunds ${refundTarget?.total.toFixed(2)} back through Stripe
              in full and marks the order cancelled. If any of these items are
              being inventory-tracked, their stock counts are added back. This
              can't be undone from here — Stripe would need a new charge to
              reverse it.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-2 py-2">
            <Label htmlFor="refund-reason">
              Reason (optional, for your own records)
            </Label>
            <Input
              id="refund-reason"
              value={refundReason}
              onChange={(e) => setRefundReason(e.target.value)}
              placeholder="e.g. Customer ordered the wrong item"
            />
          </div>

          {refundError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {refundError}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={refunding}>
              Nevermind
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmRefund();
              }}
              disabled={refunding}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {refunding ? "Refunding..." : "Confirm Cancel & Refund"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminOrders;
