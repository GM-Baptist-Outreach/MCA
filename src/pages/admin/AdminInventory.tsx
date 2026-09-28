import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Upload, Download } from "lucide-react";

type ItemType = "pace" | "key" | "dvd" | "other";

interface Subject {
  id: string;
  name: string;
}

interface Item {
  id: string;
  subject_id: string | null;
  sku: string;
  item_type: ItemType;
  pace_number: number | null;
  range_start: number | null;
  range_end: number | null;
  grade_level: number | null;
  publisher: string | null;
  original_name: string;
  sales_price: number;
  purchase_price: number | null;
  active: boolean;
  subjects: { name: string } | null;
  quantity_on_hand: number | null;
}

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "pace", label: "PACE" },
  { value: "key", label: "Key" },
  { value: "dvd", label: "DVD" },
  { value: "other", label: "Other" },
];

const PAGE_SIZE = 50;
const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

function slugifySku(name: string) {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

// Small, tolerant CSV parser for the "sku,price" import format — no quoted
// fields with embedded commas expected in this data, so a straight split
// is enough and keeps this dependency-free.
function parseCsv(text: string): { sku: string; price: number }[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const startIndex = /sku/i.test(lines[0]) && /price/i.test(lines[0]) ? 1 : 0;
  const rows: { sku: string; price: number }[] = [];

  for (let i = startIndex; i < lines.length; i++) {
    const parts = lines[i]
      .split(",")
      .map((p) => p.trim().replace(/^"|"$/g, ""));
    if (parts.length < 2) continue;
    const sku = parts[0];
    const price = parseFloat(parts[1]);
    if (!sku || isNaN(price)) continue;
    rows.push({ sku, price });
  }
  return rows;
}

function downloadCsv(filename: string, rows: (string | number)[][]) {
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
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const emptyNewItem = {
  subject_id: "",
  original_name: "",
  item_type: "other" as ItemType,
  pace_number: "",
  range_start: "",
  range_end: "",
  sales_price: "",
  sku: "",
};

export default function AdminInventory() {
  const [items, setItems] = useState<Item[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adminUserId, setAdminUserId] = useState<string | null>(null);
  const [locationId, setLocationId] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  const [stockEditingId, setStockEditingId] = useState<string | null>(null);
  const [stockEditValue, setStockEditValue] = useState("");
  const [savingStockId, setSavingStockId] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newItem, setNewItem] = useState(emptyNewItem);
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    rows_updated: number;
    rows_skipped_locked: number;
    skus_not_found: string[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    // Supabase caps any single query at 1,000 rows by default. The
    // catalog has 1,700+ items, so a plain .select() silently truncates —
    // fetch in pages until a page comes back short.
    const PAGE_SIZE = 1000;
    const allItems: Item[] = [];
    let from = 0;
    while (true) {
      const { data, error: pageError } = await supabase
        .from("items")
        .select(
          "id, subject_id, sku, item_type, pace_number, range_start, range_end, grade_level, publisher, original_name, sales_price, purchase_price, active, subjects(name), inventory_levels(quantity_on_hand)",
        )
        .order("name", { foreignTable: "subjects", ascending: true })
        .order("pace_number", { ascending: true, nullsFirst: false })
        .order("range_start", { ascending: true, nullsFirst: false })
        .order("original_name", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (pageError) {
        setError(pageError.message);
        setLoading(false);
        return;
      }

      const page = (
        (data as unknown as (Item & {
          inventory_levels: { quantity_on_hand: number }[];
        })[]) || []
      ).map((row) => ({
        ...row,
        quantity_on_hand: row.inventory_levels?.[0]?.quantity_on_hand ?? null,
      }));
      allItems.push(...page);
      if (page.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }

    const [subjectsRes, sessionRes, locationRes] = await Promise.all([
      supabase
        .from("subjects")
        .select("id, name")
        .order("name", { ascending: true }),
      supabase.auth.getSession(),
      supabase
        .from("locations")
        .select("id")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);

    if (subjectsRes.error) {
      setError(subjectsRes.error.message);
      setLoading(false);
      return;
    }

    setItems(allItems);
    setSubjects(subjectsRes.data || []);
    setLocationId(locationRes.data?.id ?? null);

    const userId = sessionRes.data.session?.user.id;
    if (userId) {
      const { data: adminRow } = await supabase
        .from("admin_users")
        .select("id")
        .eq("auth_user_id", userId)
        .single();
      setAdminUserId(adminRow?.id ?? null);
    }

    setLoading(false);
  }

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (subjectFilter !== "all" && item.subject_id !== subjectFilter)
        return false;
      if (typeFilter !== "all" && item.item_type !== typeFilter) return false;
      if (!q) return true;
      const haystack = [
        item.original_name,
        item.sku,
        item.subjects?.name ?? "",
        item.item_type,
        item.publisher ?? "",
        String(item.sales_price),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, search, subjectFilter, typeFilter]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [search, subjectFilter, typeFilter]);

  const visibleItems = filteredItems.slice(0, visibleCount);

  function startEdit(item: Item) {
    setEditingId(item.id);
    setEditPrice(String(item.sales_price));
  }

  function cancelEdit() {
    setEditingId(null);
    setEditPrice("");
  }

  async function saveEdit(item: Item) {
    const newPrice = parseFloat(editPrice);
    if (isNaN(newPrice) || newPrice < 0) return;
    setSavingId(item.id);

    const { error: updateError } = await supabase
      .from("items")
      .update({ sales_price: newPrice })
      .eq("id", item.id);

    if (updateError) {
      setError(updateError.message);
      setSavingId(null);
      return;
    }

    if (adminUserId && newPrice !== item.sales_price) {
      await supabase.from("price_change_log").insert({
        item_id: item.id,
        changed_by: adminUserId,
        change_source: "manual",
        old_price: item.sales_price,
        new_price: newPrice,
      });
    }

    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, sales_price: newPrice } : i)),
    );
    setSavingId(null);
    setEditingId(null);
    setEditPrice("");
  }

  function startStockEdit(item: Item) {
    setStockEditingId(item.id);
    setStockEditValue(
      item.quantity_on_hand != null ? String(item.quantity_on_hand) : "",
    );
  }

  function cancelStockEdit() {
    setStockEditingId(null);
    setStockEditValue("");
  }

  // "Taking inventory" — sets the counted quantity for today. If this item
  // has never been tracked before, this is what starts tracking it (no row
  // in inventory_levels until the first count is entered).
  async function saveStock(item: Item) {
    if (!locationId) {
      setError("No location is set up yet — can't record inventory.");
      return;
    }
    const qty = parseInt(stockEditValue, 10);
    if (isNaN(qty)) return;
    setSavingStockId(item.id);

    const today = new Date().toISOString().slice(0, 10);
    const { error: upsertError } = await supabase
      .from("inventory_levels")
      .upsert(
        {
          item_id: item.id,
          location_id: locationId,
          quantity_on_hand: qty,
          quantity_as_of: today,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "item_id,location_id" },
      );

    if (upsertError) {
      setError(upsertError.message);
      setSavingStockId(null);
      return;
    }

    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, quantity_on_hand: qty } : i)),
    );
    setSavingStockId(null);
    setStockEditingId(null);
    setStockEditValue("");
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);

    const { error: deleteErr } = await supabase
      .from("items")
      .delete()
      .eq("id", deleteTarget.id);

    if (deleteErr) {
      if (deleteErr.code === "23503") {
        setDeleteError(
          "This item has already been ordered, so it can't be permanently deleted. Deactivate it instead so it stops showing up for new orders.",
        );
      } else {
        setDeleteError(deleteErr.message);
      }
      setDeleting(false);
      return;
    }

    setItems((prev) => prev.filter((i) => i.id !== deleteTarget.id));
    setDeleting(false);
    setDeleteTarget(null);
  }

  async function deactivateInsteadOfDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    const { error: updateError } = await supabase
      .from("items")
      .update({ active: false })
      .eq("id", deleteTarget.id);

    if (updateError) {
      setDeleteError(updateError.message);
      setDeleting(false);
      return;
    }

    setItems((prev) =>
      prev.map((i) => (i.id === deleteTarget.id ? { ...i, active: false } : i)),
    );
    setDeleting(false);
    setDeleteTarget(null);
    setDeleteError(null);
  }

  async function submitNewItem() {
    setAddError(null);

    if (
      !newItem.subject_id ||
      !newItem.original_name.trim() ||
      !newItem.sales_price
    ) {
      setAddError("Subject, item name, and price are required.");
      return;
    }
    const price = parseFloat(newItem.sales_price);
    if (isNaN(price) || price < 0) {
      setAddError("Enter a valid price.");
      return;
    }

    setAdding(true);
    const sku = newItem.sku.trim() || slugifySku(newItem.original_name);

    const payload: Record<string, unknown> = {
      subject_id: newItem.subject_id,
      sku,
      item_type: newItem.item_type,
      original_name: newItem.original_name.trim(),
      sales_price: price,
      price_source: "manual",
      active: true,
    };
    if (newItem.item_type === "pace" && newItem.pace_number) {
      payload.pace_number = parseInt(newItem.pace_number, 10);
    }
    if (
      newItem.item_type === "key" &&
      newItem.range_start &&
      newItem.range_end
    ) {
      payload.range_start = parseInt(newItem.range_start, 10);
      payload.range_end = parseInt(newItem.range_end, 10);
    }

    const { data, error: insertError } = await supabase
      .from("items")
      .insert(payload)
      .select(
        "id, subject_id, sku, item_type, pace_number, range_start, range_end, grade_level, publisher, original_name, sales_price, purchase_price, active, subjects(name)",
      )
      .single();

    if (insertError) {
      setAddError(
        insertError.code === "23505"
          ? "That SKU is already in use — try a different one."
          : insertError.message,
      );
      setAdding(false);
      return;
    }

    setItems((prev) =>
      [...prev, { ...(data as unknown as Item), quantity_on_hand: null }].sort(
        (a, b) => a.original_name.localeCompare(b.original_name),
      ),
    );
    setAdding(false);
    setShowAddForm(false);
    setNewItem(emptyNewItem);
  }

  function exportCsv() {
    const rows: (string | number)[][] = [
      ["sku", "price", "name", "subject", "type", "stock"],
    ];
    for (const item of filteredItems) {
      rows.push([
        item.sku,
        item.sales_price,
        item.original_name,
        item.subjects?.name ?? "",
        item.item_type,
        item.quantity_on_hand ?? "",
      ]);
    }
    downloadCsv(
      `mca-catalog-${new Date().toISOString().slice(0, 10)}.csv`,
      rows,
    );
  }

  function triggerImport() {
    fileInputRef.current?.click();
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    setImportResult(null);

    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      setImportError(
        'No valid rows found. Expect a "sku,price" CSV, one item per line.',
      );
      return;
    }

    setImporting(true);
    const { data: sessionData } = await supabase.auth.getSession();

    const res = await fetch(
      `${SUPABASE_URL}/functions/v1/import-catalog-prices`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${sessionData.session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ rows, file_name: file.name }),
      },
    );
    const result = await res.json();

    if (!res.ok || result.error) {
      setImportError(result.error ?? "Import failed.");
      setImporting(false);
      return;
    }

    setImportResult(result);
    setImporting(false);
    void loadData();
  }

  if (loading) {
    return <div className="p-6 text-muted-foreground">Loading inventory…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Inventory Pricing</h1>
          <p className="text-sm text-muted-foreground">
            {filteredItems.length} of {items.length} items
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleImportFile}
          />
          <Button
            variant="outline"
            onClick={triggerImport}
            disabled={importing}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            {importing ? "Importing…" : "Import CSV"}
          </Button>
          <Button variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
          <Button onClick={() => setShowAddForm((v) => !v)}>
            {showAddForm ? "Cancel" : "Add Item"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {importError && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
          {importError}
        </div>
      )}

      {importResult && (
        <div className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm space-y-1">
          <p>
            Import complete: <strong>{importResult.rows_updated}</strong> price
            {importResult.rows_updated === 1 ? "" : "s"} updated,{" "}
            <strong>{importResult.rows_skipped_locked}</strong> skipped (price
            locked).
          </p>
          {importResult.skus_not_found.length > 0 && (
            <p className="text-muted-foreground">
              SKUs not found ({importResult.skus_not_found.length}):{" "}
              {importResult.skus_not_found.slice(0, 10).join(", ")}
              {importResult.skus_not_found.length > 10 ? "…" : ""}
            </p>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setImportResult(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {showAddForm && (
        <div className="rounded-lg border p-4 space-y-4">
          <h2 className="font-medium">New Item</h2>
          {addError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {addError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Select
                value={newItem.subject_id}
                onValueChange={(v) =>
                  setNewItem((f) => ({ ...f, subject_id: v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a subject" />
                </SelectTrigger>
                <SelectContent>
                  {subjects.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Item Type</Label>
              <Select
                value={newItem.item_type}
                onValueChange={(v) =>
                  setNewItem((f) => ({ ...f, item_type: v as ItemType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label>Item Name</Label>
              <Input
                value={newItem.original_name}
                onChange={(e) =>
                  setNewItem((f) => ({ ...f, original_name: e.target.value }))
                }
                placeholder="e.g. English 130"
              />
            </div>

            {newItem.item_type === "pace" && (
              <div className="space-y-1.5">
                <Label>PACE Number</Label>
                <Input
                  type="number"
                  value={newItem.pace_number}
                  onChange={(e) =>
                    setNewItem((f) => ({ ...f, pace_number: e.target.value }))
                  }
                />
              </div>
            )}

            {newItem.item_type === "key" && (
              <div className="space-y-1.5 flex gap-2">
                <div className="flex-1">
                  <Label>Range Start</Label>
                  <Input
                    type="number"
                    value={newItem.range_start}
                    onChange={(e) =>
                      setNewItem((f) => ({ ...f, range_start: e.target.value }))
                    }
                  />
                </div>
                <div className="flex-1">
                  <Label>Range End</Label>
                  <Input
                    type="number"
                    value={newItem.range_end}
                    onChange={(e) =>
                      setNewItem((f) => ({ ...f, range_end: e.target.value }))
                    }
                  />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label>Sales Price</Label>
              <Input
                type="number"
                step="0.01"
                value={newItem.sales_price}
                onChange={(e) =>
                  setNewItem((f) => ({ ...f, sales_price: e.target.value }))
                }
                placeholder="0.00"
              />
            </div>

            <div className="space-y-1.5">
              <Label>SKU (optional — auto-generated if blank)</Label>
              <Input
                value={newItem.sku}
                onChange={(e) =>
                  setNewItem((f) => ({ ...f, sku: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowAddForm(false)}>
              Cancel
            </Button>
            <Button onClick={submitNewItem} disabled={adding}>
              {adding ? "Saving…" : "Save Item"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search by name, SKU, subject, publisher…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-sm"
        />
        <Select value={subjectFilter} onValueChange={setSubjectFilter}>
          <SelectTrigger className="sm:w-56">
            <SelectValue placeholder="All subjects" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All subjects</SelectItem>
            {subjects.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {ITEM_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Item</TableHead>
              <TableHead>Subject</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>SKU</TableHead>
              <TableHead>Price</TableHead>
              <TableHead>Stock</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.map((item) => (
              <TableRow
                key={item.id}
                className={item.active ? "" : "opacity-50"}
              >
                <TableCell className="font-medium">
                  {item.original_name}
                </TableCell>
                <TableCell>{item.subjects?.name ?? "—"}</TableCell>
                <TableCell className="capitalize">{item.item_type}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {item.sku}
                </TableCell>
                <TableCell>
                  {editingId === item.id ? (
                    <Input
                      type="number"
                      step="0.01"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      className="w-24 h-8"
                      autoFocus
                    />
                  ) : (
                    `$${item.sales_price.toFixed(2)}`
                  )}
                </TableCell>
                <TableCell>
                  {stockEditingId === item.id ? (
                    <Input
                      type="number"
                      value={stockEditValue}
                      onChange={(e) => setStockEditValue(e.target.value)}
                      className="w-20 h-8"
                      autoFocus
                    />
                  ) : item.quantity_on_hand == null ? (
                    <span className="text-xs text-muted-foreground">
                      Not tracked
                    </span>
                  ) : item.quantity_on_hand <= 0 ? (
                    <span className="text-xs font-medium text-destructive">
                      Out of Stock
                      {item.quantity_on_hand < 0
                        ? ` (short ${Math.abs(item.quantity_on_hand)})`
                        : ""}
                    </span>
                  ) : (
                    <span>{item.quantity_on_hand}</span>
                  )}
                </TableCell>
                <TableCell>{item.active ? "Active" : "Inactive"}</TableCell>
                <TableCell className="text-right space-x-2 whitespace-nowrap">
                  {editingId === item.id ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => saveEdit(item)}
                        disabled={savingId === item.id}
                      >
                        {savingId === item.id ? "Saving…" : "Save"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={cancelEdit}>
                        Cancel
                      </Button>
                    </>
                  ) : stockEditingId === item.id ? (
                    <>
                      <Button
                        size="sm"
                        onClick={() => saveStock(item)}
                        disabled={savingStockId === item.id}
                      >
                        {savingStockId === item.id ? "Saving…" : "Save Count"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={cancelStockEdit}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(item)}
                      >
                        Edit Price
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startStockEdit(item)}
                      >
                        Take Inventory
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setDeleteTarget(item);
                          setDeleteError(null);
                        }}
                      >
                        Delete
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {visibleItems.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="text-center text-muted-foreground py-8"
                >
                  No items match your search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {visibleCount < filteredItems.length && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
          >
            Load {Math.min(PAGE_SIZE, filteredItems.length - visibleCount)} more
          </Button>
        </div>
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete "{deleteTarget?.original_name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the item from inventory. This can't be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive space-y-2">
              <p>{deleteError}</p>
              {deleteError.includes("Deactivate") && (
                <Button
                  size="sm"
                  onClick={deactivateInsteadOfDelete}
                  disabled={deleting}
                >
                  Deactivate Instead
                </Button>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void confirmDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
