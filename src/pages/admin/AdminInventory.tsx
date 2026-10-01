import { Fragment, useEffect, useMemo, useRef, useState } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Upload, Download } from "lucide-react";
import { compareSubjectNames, compareSubjects, subjectDisplayName } from "@/lib/loggedCourses";

type ItemType = "pace" | "key" | "dvd" | "other";

interface Subject {
  id: string;
  name: string;
  active?: boolean;
  store_visible?: boolean | null;
  sort_order?: number | null;
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
  is_featured?: boolean | null;
  short_description?: string | null;
  image_path?: string | null;
  subjects: { name: string } | null;
  quantity_on_hand: number | null;
}

// Round 3 A3: full item editor with photo + short description.
export const MCA_R3_A3_MARKER = "MCA_R3_A3_ITEM_EDIT";
export const STORE_IMAGE_BUCKET = "store-item-images";

export function storeImageUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from(STORE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Downscale to max 1200px on the long side; returns a JPEG/WebP blob. */
async function resizeImage(file: File, maxSide = 1200): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image."));
      el.src = url;
    });
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
    return blob ?? file;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface ItemDraft {
  original_name: string;
  short_description: string;
  subject_id: string;
  item_type: ItemType;
  pace_number: string;
  range_start: string;
  range_end: string;
  grade_level: string;
  publisher: string;
  sku: string;
  sales_price: string;
  purchase_price: string;
  is_featured: boolean;
  active: boolean;
}

function draftFromItem(item: Item): ItemDraft {
  return {
    original_name: item.original_name,
    short_description: item.short_description ?? "",
    subject_id: item.subject_id ?? "",
    item_type: item.item_type,
    pace_number: item.pace_number != null ? String(item.pace_number) : "",
    range_start: item.range_start != null ? String(item.range_start) : "",
    range_end: item.range_end != null ? String(item.range_end) : "",
    grade_level: item.grade_level != null ? String(item.grade_level) : "",
    publisher: item.publisher ?? "",
    sku: item.sku,
    sales_price: String(item.sales_price),
    purchase_price: item.purchase_price != null ? String(item.purchase_price) : "",
    is_featured: !!item.is_featured,
    active: item.active,
  };
}

function intOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function ItemEditDialog({
  item,
  subjects,
  adminUserId,
  onClose,
  onSaved,
}: {
  item: Item;
  subjects: Subject[];
  adminUserId: string | null;
  onClose: () => void;
  onSaved: (updated: Item) => void;
}) {
  const [draft, setDraft] = useState<ItemDraft>(() => draftFromItem(item));
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(storeImageUrl(item.image_path));
  const [removeImage, setRemoveImage] = useState(false);
  const [referenced, setReferenced] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;
    const check = async () => {
      const results = await Promise.all([
        supabase.from("order_items").select("id", { count: "exact", head: true }).eq("item_id", item.id),
        supabase.from("student_pace_slots").select("id", { count: "exact", head: true }).eq("item_id", item.id),
        supabase.from("pick_list_items").select("id", { count: "exact", head: true }).eq("item_id", item.id),
      ]);
      if (ignore) return;
      setReferenced(results.some((r) => (r.count ?? 0) > 0 || !!r.error));
    };
    check();
    return () => {
      ignore = true;
    };
  }, [item.id]);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const locked = referenced !== false;
  const set = <K extends keyof ItemDraft>(key: K, value: ItemDraft[K]) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const save = async () => {
    setErr(null);
    const price = parseFloat(draft.sales_price);
    if (!draft.original_name.trim()) return setErr("Name is required.");
    if (isNaN(price) || price < 0) return setErr("Enter a valid price.");
    if (draft.short_description.length > 300) return setErr("Short description is 300 characters max.");
    if (!draft.sku.trim()) return setErr("SKU is required.");
    setSaving(true);

    let imagePath: string | null | undefined = undefined;
    if (file) {
      try {
        const blob = await resizeImage(file);
        const ext = blob.type === "image/png" ? "png" : "jpg";
        const path = `items/${item.id}/${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from(STORE_IMAGE_BUCKET)
          .upload(path, blob, { contentType: blob.type, upsert: false });
        if (upErr) throw upErr;
        imagePath = path;
      } catch (e) {
        setErr(`Photo upload failed: ${e instanceof Error ? e.message : String(e)}`);
        setSaving(false);
        return;
      }
    } else if (removeImage) {
      imagePath = null;
    }

    const purchase = draft.purchase_price.trim() === "" ? null : parseFloat(draft.purchase_price);
    const patch: Record<string, unknown> = {
      original_name: draft.original_name.trim(),
      short_description: draft.short_description.trim() || null,
      grade_level: intOrNull(draft.grade_level),
      publisher: draft.publisher.trim() || null,
      sku: draft.sku.trim(),
      sales_price: price,
      purchase_price: purchase != null && !isNaN(purchase) ? purchase : null,
      is_featured: draft.is_featured,
      active: draft.active,
      updated_at: new Date().toISOString(),
    };
    if (!locked) {
      patch.subject_id = draft.subject_id || null;
      patch.item_type = draft.item_type;
      patch.pace_number = intOrNull(draft.pace_number);
      patch.range_start = intOrNull(draft.range_start);
      patch.range_end = intOrNull(draft.range_end);
    }
    if (imagePath !== undefined) patch.image_path = imagePath;

    const { error: updateError } = await supabase.from("items").update(patch).eq("id", item.id);
    if (updateError) {
      setErr(updateError.message);
      setSaving(false);
      return;
    }
    if (adminUserId && price !== item.sales_price) {
      await supabase.from("price_change_log").insert({
        item_id: item.id,
        changed_by: adminUserId,
        change_source: "manual",
        old_price: item.sales_price,
        new_price: price,
      });
    }
    const subjectName = subjects.find((sub) => sub.id === (patch.subject_id ?? item.subject_id))?.name;
    onSaved({
      ...item,
      ...(patch as Partial<Item>),
      subjects: subjectName ? { name: subjectName } : item.subjects,
    });
    setSaving(false);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" data-marker={MCA_R3_A3_MARKER}>
        <DialogHeader>
          <DialogTitle>Edit item</DialogTitle>
          <DialogDescription>
            Changes show in the store right away. Photos are resized to 1200px.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Name</Label>
            <Input value={draft.original_name} onChange={(e) => set("original_name", e.target.value)} />
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-xs">Short description ({draft.short_description.length}/300)</Label>
            <Textarea
              rows={3}
              maxLength={300}
              value={draft.short_description}
              onChange={(e) => set("short_description", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            {preview && !removeImage ? (
              <img src={preview} alt="" className="h-20 w-20 rounded object-cover border" />
            ) : (
              <div className="h-20 w-20 rounded border bg-secondary/50 text-xs flex items-center justify-center text-foreground/50">
                No photo
              </div>
            )}
            <div className="space-y-1">
              <Input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setRemoveImage(false);
                }}
              />
              {(item.image_path || file) && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setFile(null);
                    setRemoveImage(true);
                  }}
                >
                  Remove photo
                </Button>
              )}
            </div>
          </div>
          {locked && (
            <p className="sm:col-span-2 text-xs text-amber-700">
              {referenced == null
                ? "Checking whether this item is in use..."
                : "This item is on orders, PACE plans or pick lists, so subject, type and PACE numbers are locked."}
            </p>
          )}
          <div className="space-y-1">
            <Label className="text-xs">Subject</Label>
            <Select value={draft.subject_id || "none"} onValueChange={(v) => set("subject_id", v === "none" ? "" : v)} disabled={locked}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No subject</SelectItem>
                {subjects.map((sub) => (
                  <SelectItem key={sub.id} value={sub.id}>
                    {subjectDisplayName(sub.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <Select value={draft.item_type} onValueChange={(v) => set("item_type", v as ItemType)} disabled={locked}>
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
          <div className="space-y-1">
            <Label className="text-xs">PACE #</Label>
            <Input type="number" value={draft.pace_number} disabled={locked} onChange={(e) => set("pace_number", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Range start</Label>
              <Input type="number" value={draft.range_start} disabled={locked} onChange={(e) => set("range_start", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Range end</Label>
              <Input type="number" value={draft.range_end} disabled={locked} onChange={(e) => set("range_end", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Grade level</Label>
            <Input type="number" value={draft.grade_level} onChange={(e) => set("grade_level", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Publisher</Label>
            <Input value={draft.publisher} onChange={(e) => set("publisher", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">SKU</Label>
            <Input value={draft.sku} onChange={(e) => set("sku", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label className="text-xs">Sales price</Label>
              <Input type="number" step="0.01" value={draft.sales_price} onChange={(e) => set("sales_price", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Our cost</Label>
              <Input type="number" step="0.01" value={draft.purchase_price} onChange={(e) => set("purchase_price", e.target.value)} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.is_featured} onCheckedChange={(v) => set("is_featured", v)} />
            Featured
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={draft.active} onCheckedChange={(v) => set("active", v)} />
            Active (shown in store)
          </label>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving..." : "Save item"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "pace", label: "PACE" },
  { value: "key", label: "Key" },
  { value: "dvd", label: "DVD" },
  { value: "other", label: "Other" },
];

const TYPE_SORT: Record<ItemType, number> = {
  pace: 0,
  key: 1,
  dvd: 2,
  other: 3,
};

function compareInventoryItems(a: Item, b: Item): number {
  const bySubject = compareSubjectNames(a.subjects?.name ?? "", b.subjects?.name ?? "");
  if (bySubject !== 0) return bySubject;
  const byType = (TYPE_SORT[a.item_type] ?? 99) - (TYPE_SORT[b.item_type] ?? 99);
  if (byType !== 0) return byType;
  const byNumber = String(a.pace_number ?? a.range_start ?? "").localeCompare(
    String(b.pace_number ?? b.range_start ?? ""),
    undefined,
    { numeric: true },
  );
  if (byNumber !== 0) return byNumber;
  return a.original_name.localeCompare(b.original_name, undefined, { numeric: true });
}

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
  const [detailItem, setDetailItem] = useState<Item | null>(null);

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
          "id, subject_id, sku, item_type, pace_number, range_start, range_end, grade_level, publisher, original_name, sales_price, purchase_price, active, is_featured, short_description, image_path, subjects(name), inventory_levels(quantity_on_hand)",
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
        .select("id, name, active, store_visible, sort_order"),
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
    setSubjects(
      (subjectsRes.data || []).slice().sort((a, b) => compareSubjects(a, b)),
    );
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
    }).sort(compareInventoryItems);
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
        compareInventoryItems,
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

      <details className="rounded-lg border p-4">
        <summary className="cursor-pointer font-medium">
          Store course visibility
        </summary>
        <p className="text-sm text-foreground/60 mt-2 mb-3">
          Hide a course from the store without deleting it. Sort order overrides
          the default Math, English, Word Building, Science, Social Studies, Electives sequence.
        </p>
        <div className="max-h-72 overflow-auto divide-y">
          {subjects.map((subject) => (
            <div key={subject.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1">{subjectDisplayName(subject.name)}</span>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={subject.store_visible !== false}
                  onChange={async (event) => {
                    const store_visible = event.target.checked;
                    const { error: updateError } = await supabase
                      .from("subjects")
                      .update({ store_visible })
                      .eq("id", subject.id);
                    if (updateError) {
                      setError(updateError.message);
                      return;
                    }
                    setSubjects((prev) =>
                      prev.map((row) =>
                        row.id === subject.id ? { ...row, store_visible } : row,
                      ),
                    );
                  }}
                />
                In store
              </label>
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={subject.active !== false}
                  onChange={async (event) => {
                    const active = event.target.checked;
                    const { error: updateError } = await supabase
                      .from("subjects")
                      .update({ active })
                      .eq("id", subject.id);
                    if (updateError) {
                      setError(updateError.message);
                      return;
                    }
                    setSubjects((prev) =>
                      prev.map((row) => (row.id === subject.id ? { ...row, active } : row)),
                    );
                  }}
                />
                Active
              </label>
              <Input
                type="number"
                className="w-20 h-8"
                aria-label={`Sort order for ${subject.name}`}
                value={subject.sort_order ?? ""}
                onChange={(event) => {
                  const sort_order = event.target.value === "" ? null : Number(event.target.value);
                  setSubjects((prev) =>
                    prev.map((row) => (row.id === subject.id ? { ...row, sort_order } : row)),
                  );
                }}
                onBlur={async (event) => {
                  const sort_order = event.target.value === "" ? null : Number(event.target.value);
                  await supabase.from("subjects").update({ sort_order }).eq("id", subject.id);
                }}
              />
            </div>
          ))}
        </div>
      </details>

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
            {visibleItems.map((item, index) => {
              const subjectName = item.subjects?.name ?? "No subject";
              const previousName =
                index > 0
                  ? visibleItems[index - 1].subjects?.name ?? "No subject"
                  : null;
              return (
              <Fragment key={item.id}>
              {subjectName !== previousName && (
                <TableRow className="bg-secondary/70 hover:bg-secondary/70">
                  <TableCell colSpan={8} className="font-semibold">
                    {subjectName}
                  </TableCell>
                </TableRow>
              )}
              <TableRow
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
                        onClick={() => setDetailItem(item)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(item)}
                      >
                        Price
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
                        Deactivate
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
              </Fragment>
              );
            })}
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

      {detailItem && (
        <ItemEditDialog
          item={detailItem}
          subjects={subjects}
          adminUserId={adminUserId}
          onClose={() => setDetailItem(null)}
          onSaved={(updated) => {
            setItems((prev) => prev.map((i) => (i.id === updated.id ? { ...i, ...updated } : i)));
            setDetailItem(null);
          }}
        />
      )}

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Deactivate "{deleteTarget?.original_name}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This hides the item from the store and pick lists. The row stays
              in the database. Permanent delete is only for a row that was
              created by mistake and is not on any order.
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
            <Button
              type="button"
              variant="ghost"
              className="text-destructive"
              disabled={deleting}
              onClick={() => {
                const confirmed = window.confirm(
                  `Permanently delete "${deleteTarget?.original_name}"? This cannot be undone.`,
                );
                if (confirmed) void confirmDelete();
              }}
            >
              {deleting ? "Deleting…" : "Delete permanently"}
            </Button>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void deactivateInsteadOfDelete();
              }}
              disabled={deleting}
            >
              {deleting ? "Saving…" : "Deactivate"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
