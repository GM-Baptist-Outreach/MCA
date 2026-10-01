import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  buildCourseOptions,
  companionKind,
  companionLabel,
  compareSubjectNames,
  courseOptionLabel,
  matchingCompanions,
  oklahomaProductTaxCents,
  shouldApplyOklahomaStoreTax,
  SUBJECT_GROUPS,
  subjectDisplayName,
  subjectGroup,
  type CompanionKind,
  type CourseOption,
} from "@/lib/loggedCourses";
import { ArrowLeft, Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb2l5aW9xZmJqY21wcnNucWhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDY1MjMsImV4cCI6MjEwMTY4MjUyM30.yufhfBU7Wm9dOHuJz85-zuFd-8plw8YEGeV1NcG6dhA";

const CART_STORAGE_KEY = "mca_store_cart_v1";
const MAX_LINE_QUANTITY = 999;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ItemType = "pace" | "key" | "dvd" | "other";

interface StoreItem {
  id: string;
  subject_id: string | null;
  sku: string;
  item_type: ItemType;
  pace_number: number | null;
  range_start: number | null;
  range_end: number | null;
  original_name: string;
  sales_price: number;
  active: boolean;
  grade_level: number | null;
  short_description?: string | null;
  image_path?: string | null;
  subjects: { name: string; image_path?: string | null } | null;
  quantity_on_hand: number | null;
}

// Round 3 A3 (marker MCA_R3_A3_ITEM_EDIT): store card photo + short description.
// Display only. Images are never sent to checkout.
const STORE_IMAGE_BUCKET = "store-item-images";
function storeCardImage(item: StoreItem): string | null {
  const path = item.image_path || item.subjects?.image_path || null;
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  return supabase.storage.from(STORE_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
}

interface Subject {
  id: string;
  name: string;
  store_visible?: boolean | null;
  sort_order?: number | null;
}

interface CartLine {
  itemId: string;
  quantity: number;
}

const ITEM_TYPES: { value: ItemType; label: string }[] = [
  { value: "pace", label: "PACE" },
  { value: "key", label: "Key" },
  { value: "dvd", label: "DVD" },
  { value: "other", label: "Other" },
];

function loadCartFromStorage(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Saved carts can be stale or hand-edited; keep whole, positive quantities only.
    return parsed.flatMap((line) => {
      const itemId = typeof line?.itemId === "string" ? line.itemId : "";
      const quantity = Math.min(MAX_LINE_QUANTITY, Math.floor(Number(line?.quantity)));
      return itemId && Number.isFinite(quantity) && quantity > 0 ? [{ itemId, quantity }] : [];
    });
  } catch {
    return [];
  }
}

function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len === 0) return "";
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

const emptyCustomer = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  fulfillment: "pickup" as "ship" | "pickup",
  addressStreet: "",
  addressCity: "",
  addressState: "",
  addressZip: "",
};

export default function Store() {
  const { toast } = useToast();
  const [items, setItems] = useState<StoreItem[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [subjectFilter, setSubjectFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(50);

  const [cart, setCart] = useState<CartLine[]>(loadCartFromStorage);
  const [cartOpen, setCartOpen] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<"cart" | "details">("cart");
  const [customer, setCustomer] = useState(emptyCustomer);
  const [formError, setFormError] = useState<string | null>(null);

  const [searchParams] = useSearchParams();
  const appliedCartLink = useRef(false);
  const [bundleSubjectId, setBundleSubjectId] = useState("");
  const [bundleLevel, setBundleLevel] = useState("");
  const [courseKey, setCourseKey] = useState("");
  const [companionPrompt, setCompanionPrompt] = useState<{
    title: string;
    options: Array<{ item: StoreItem; kind: CompanionKind; checked: boolean }>;
  } | null>(null);

  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      setError(null);

      // Supabase caps any single query at 1,000 rows by default. The
      // catalog has 1,700+ active items, so a plain .select() silently
      // truncates — fetch in pages until a page comes back short.
      const PAGE_SIZE = 1000;
      const allItems: StoreItem[] = [];
      let from = 0;
      while (true) {
        const { data, error: pageError } = await supabase
          .from("items")
          .select(
            "id, subject_id, sku, item_type, pace_number, range_start, range_end, grade_level, original_name, sales_price, active, short_description, image_path, subjects(name, image_path), inventory_levels(quantity_on_hand)",
          )
          .eq("active", true)
          .order("name", { foreignTable: "subjects", ascending: true })
          .order("pace_number", { ascending: true, nullsFirst: false })
          .order("range_start", { ascending: true, nullsFirst: false })
          .order("original_name", { ascending: true })
          .order("id", { ascending: true })
          .range(from, from + PAGE_SIZE - 1);

        if (pageError) {
          setError(pageError.message);
          setLoading(false);
          return;
        }

        const page = (
          (data as unknown as (StoreItem & {
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

      const { data: subjectsData, error: subjectsError } = await supabase
        .from("subjects")
        .select("id, name, store_visible, sort_order")
        .eq("active", true);

      if (subjectsError) {
        setError(subjectsError.message);
        setLoading(false);
        return;
      }

      const visibleSubjects = (subjectsData || []).filter(
        (subject) => subject.store_visible !== false,
      );
      const visibleIds = new Set(visibleSubjects.map((subject) => subject.id));
      // PostgREST's foreign-table order doesn't sort the parent rows, so sort
      // here: subject order (Math, English, Word Building, Science, Social
      // Studies, then electives A-Z), then PACE number / range, then name.
      const num = (n: number | null) => (n == null ? Number.MAX_SAFE_INTEGER : n);
      setItems(
        allItems
          .filter((item) => item.subject_id == null || visibleIds.has(item.subject_id))
          .sort(
            (a, b) =>
              compareSubjectNames(a.subjects?.name ?? "", b.subjects?.name ?? "") ||
              num(a.pace_number) - num(b.pace_number) ||
              num(a.range_start) - num(b.range_start) ||
              a.original_name.localeCompare(b.original_name, undefined, { numeric: true }),
          ),
      );
      setSubjects(
        visibleSubjects.slice().sort((a, b) => compareSubjectNames(a.name, b.name)),
      );
      setLoading(false);
    };
    loadData();
  }, []);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  const itemsById = useMemo(() => {
    const map = new Map<string, StoreItem>();
    for (const item of items) map.set(item.id, item);
    return map;
  }, [items]);

  const promptForCompanions = (paces: StoreItem[], title: string) => {
    const matches = matchingCompanions(paces, items).filter(
      (item): item is StoreItem =>
        companionKind(item.item_type) != null &&
        !cart.some((line) => line.itemId === item.id),
    );
    const options = matches.flatMap((item) => {
      const kind = companionKind(item.item_type);
      return kind ? [{ item, kind, checked: kind === "key" }] : [];
    });
    if (options.length > 0) setCompanionPrompt({ title, options });
  };

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
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, search, subjectFilter, typeFilter]);

  useEffect(() => {
    setVisibleCount(50);
  }, [search, subjectFilter, typeFilter]);

  const visibleItems = filteredItems.slice(0, visibleCount);

  const addToCart = (item: StoreItem, quantity = 1) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemId === item.id);
      if (existing) {
        return prev.map((l) =>
          l.itemId === item.id ? { ...l, quantity: l.quantity + quantity } : l,
        );
      }
      return [...prev, { itemId: item.id, quantity }];
    });
    toast({ title: "Added to cart", description: item.original_name });
    if (item.item_type === "pace") promptForCompanions([item], item.original_name);
  };

  const addSelectedCompanions = () => {
    if (!companionPrompt) return;
    const chosen = companionPrompt.options.filter((option) => option.checked);
    setCart((prev) => {
      let next = [...prev];
      for (const option of chosen) {
        const id = option.item.id;
        if (next.some((line) => line.itemId === id)) {
          next = next.map((line) =>
            line.itemId === id ? { ...line, quantity: line.quantity + 1 } : line,
          );
        } else next.push({ itemId: id, quantity: 1 });
      }
      return next;
    });
    if (chosen.length > 0) {
      toast({
        title: chosen.length === 1 ? "Added to cart" : `Added ${chosen.length} items`,
        description: chosen.map((option) => option.item.original_name).join(", "),
      });
    }
    setCompanionPrompt(null);
  };

  const courseCatalog = useMemo(
    () =>
      buildCourseOptions(
        items.flatMap((item) =>
          item.subject_id
            ? [
                {
                  id: item.id,
                  subject_id: item.subject_id,
                  subject_name: item.subjects?.name ?? "Subject",
                  item_type: item.item_type,
                  pace_number: item.pace_number,
                  sales_price: item.sales_price,
                },
              ]
            : [],
        ),
      ),
    [items],
  );

  const elementaryCourse =
    courseCatalog.elementary.find((course) => course.key === bundleSubjectId) ?? null;
  const elementaryLevel =
    elementaryCourse?.levels.find((level) => String(level.level) === bundleLevel) ??
    null;
  const namedCourse =
    courseCatalog.courses.find((course) => course.key === courseKey) ?? null;

  const addCourseItems = (option: CourseOption, itemIds: string[], title: string) => {
    const paceItems = itemIds
      .map((id) => itemsById.get(id))
      .filter((item): item is StoreItem => !!item);
    if (paceItems.length === 0) {
      toast({
        title: "Nothing to add",
        description: `${option.displayName} has no catalog rows.`,
        variant: "destructive",
      });
      return;
    }
    setCart((prev) => {
      let next = [...prev];
      for (const item of paceItems) {
        if (next.some((line) => line.itemId === item.id)) {
          next = next.map((line) =>
            line.itemId === item.id ? { ...line, quantity: line.quantity + 1 } : line,
          );
        } else next.push({ itemId: item.id, quantity: 1 });
      }
      return next;
    });
    toast({ title: "Added to cart", description: title });
    promptForCompanions(paceItems, title);
  };

  useEffect(() => {
    if (loading || appliedCartLink.current || items.length === 0) return;
    const raw = searchParams.get("add") || searchParams.get("item");
    if (!raw) return;
    const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
    const found = ids
      .map((id) => itemsById.get(id))
      .filter((item): item is StoreItem => !!item);
    if (found.length === 0) return;
    appliedCartLink.current = true;
    setCart((prev) => {
      const next = [...prev];
      for (const item of found) {
        if (!next.some((line) => line.itemId === item.id)) {
          next.push({ itemId: item.id, quantity: 1 });
        }
      }
      return next;
    });
    setCartOpen(true);
    toast({
      title: "Added to cart",
      description: found.map((item) => item.original_name).join(", "),
    });
  }, [loading, items.length, itemsById, searchParams, toast]);

  const updateQuantity = (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((l) => l.itemId !== itemId));
      return;
    }
    const capped = Math.min(MAX_LINE_QUANTITY, Math.floor(quantity));
    setCart((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, quantity: capped } : l)),
    );
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => prev.filter((l) => l.itemId !== itemId));
  };

  const cartLines = cart
    .map((line) => ({ line, item: itemsById.get(line.itemId) }))
    .filter(
      (entry): entry is { line: CartLine; item: StoreItem } => !!entry.item,
    );

  const cartCount = cartLines.reduce((sum, { line }) => sum + line.quantity, 0);
  const cartTotal = cartLines.reduce(
    (sum, { line, item }) => sum + line.quantity * item.sales_price,
    0,
  );
  const showStoreTax = shouldApplyOklahomaStoreTax({
    fulfillment: customer.fulfillment,
    addressState:
      customer.fulfillment === "ship" ? customer.addressState : null,
  });
  const estimatedTax = showStoreTax
    ? oklahomaProductTaxCents(Math.round(cartTotal * 100)) / 100
    : 0;

  const handlePlaceOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!customer.firstName.trim() || !customer.lastName.trim()) {
      setFormError("Please enter your first and last name.");
      return;
    }
    if (!EMAIL_PATTERN.test(customer.email)) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (customer.phone.replace(/\D/g, "").length !== 10) {
      setFormError("Please enter a 10-digit phone number.");
      return;
    }
    if (
      customer.fulfillment === "ship" &&
      (!customer.addressStreet.trim() ||
        !customer.addressCity.trim() ||
        !customer.addressState.trim() ||
        !customer.addressZip.trim())
    ) {
      setFormError("Please fill in your full shipping address.");
      return;
    }
    if (cartLines.length === 0) return;

    setCheckingOut(true);
    console.log("[MCA store] submitting order checkout...", {
      cartLines,
      customer,
    });

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/create-store-order-checkout`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            items: cartLines.map(({ line }) => ({
              itemId: line.itemId,
              quantity: line.quantity,
            })),
            customer:
              customer.fulfillment === "pickup"
                ? {
                    ...customer,
                    addressStreet: "",
                    addressCity: "",
                    addressState: "",
                    addressZip: "",
                  }
                : customer,
            origin: window.location.origin,
          }),
        },
      );

      const data = await res.json();
      console.log("[MCA store] response:", res.status, data);

      if (!res.ok || data.error) {
        toast({
          title: "Couldn't start checkout",
          description:
            data.error ||
            "Something went wrong. Please try again or call us at (844) 663-4477.",
          variant: "destructive",
        });
        setCheckingOut(false);
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      console.error("[MCA store] fetch threw an error:", err);
      toast({
        title: "Couldn't start checkout",
        description:
          "Something went wrong. Please try again or call us at (844) 663-4477.",
        variant: "destructive",
      });
      setCheckingOut(false);
    }
  };

  const urlStatus = new URLSearchParams(window.location.search).get("status");

  useEffect(() => {
    if (urlStatus === "success") {
      localStorage.removeItem(CART_STORAGE_KEY);
      setCart([]);
    }
    if (urlStatus === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description:
          "No payment was made. Your cart is still here whenever you're ready.",
        variant: "destructive",
      });
    }
  }, [urlStatus]);

  if (urlStatus === "success") {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <section className="bg-primary text-primary-foreground py-24 flex-1 flex items-center">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-2xl">
            <h1 className="text-4xl sm:text-5xl font-bold font-serif mb-6 text-white">
              Order Placed!
            </h1>
            <p className="text-xl text-primary-foreground/90 leading-relaxed mb-4">
              Thank you for your order. Your payment was successful.
            </p>
            <p className="text-lg text-primary-foreground/80 leading-relaxed">
              We'll get it prepared and reach out with any questions. Call us at
              (844) 663-4477 if you need anything.
            </p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <section className="bg-primary text-primary-foreground py-16 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl flex items-start justify-between gap-6">
            <div>
              <h1 className="text-4xl sm:text-5xl font-bold font-serif mb-4 text-white">
                Curriculum Store
              </h1>
              <p className="text-xl text-primary-foreground/90 leading-relaxed">
                Search for exactly what you need — PACEs, answer keys, DVDs, and
                more.
              </p>
            </div>
            <Button
              variant="secondary"
              className="flex items-center gap-2 shrink-0"
              onClick={() => {
                setCheckoutStep("cart");
                setCartOpen(true);
              }}
            >
              <ShoppingCart className="h-4 w-4" />
              Cart {cartCount > 0 && `(${cartCount})`}
            </Button>
          </div>
        </div>
      </section>

      <section className="py-12 lg:py-16">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive mb-6">
              {error}
            </div>
          )}

          <div className="rounded-xl border border-border/50 bg-secondary/40 p-4 mb-6 space-y-4">
            <div>
              <h2 className="font-semibold text-foreground">Buy a course</h2>
              <p className="text-sm text-foreground/60">
                Elementary courses list only the levels that are in the catalog.
                High school and electives are sold by course name. Price is the
                sum of those item prices.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="space-y-1.5 sm:w-64">
                <Label>Elementary course</Label>
                <Select
                  value={bundleSubjectId}
                  onValueChange={(value) => {
                    setBundleSubjectId(value);
                    const course = courseCatalog.elementary.find((row) => row.key === value);
                    setBundleLevel(course?.levels[0] ? String(course.levels[0].level) : "");
                  }}
                >
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Choose a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {courseCatalog.elementary.map((course) => (
                      <SelectItem key={course.key} value={course.key}>
                        {course.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:w-72">
                <Label>Level</Label>
                <Select value={bundleLevel} onValueChange={setBundleLevel}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Level" />
                  </SelectTrigger>
                  <SelectContent>
                    {(elementaryCourse?.levels ?? []).map((level) => (
                      <SelectItem key={level.level} value={String(level.level)}>
                        {elementaryCourse
                          ? courseOptionLabel(elementaryCourse, level)
                          : `Level ${level.level}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={() => {
                  if (!elementaryCourse || !elementaryLevel) return;
                  addCourseItems(
                    elementaryCourse,
                    elementaryLevel.items.map((item) => item.id),
                    courseOptionLabel(elementaryCourse, elementaryLevel),
                  );
                }}
                disabled={!elementaryLevel}
              >
                Add level
              </Button>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="space-y-1.5 sm:flex-1">
                <Label>High school and electives</Label>
                <Select value={courseKey} onValueChange={setCourseKey}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Choose a course" />
                  </SelectTrigger>
                  <SelectContent>
                    {SUBJECT_GROUPS.map((group) => {
                      const groupCourses = courseCatalog.courses.filter(
                        (course) => (subjectGroup(course.subjectNames[0] ?? "") ?? "Electives") === group,
                      );
                      if (groupCourses.length === 0) return null;
                      return (
                        <SelectGroup key={group}>
                          <SelectLabel>{group}</SelectLabel>
                          {groupCourses.map((course) => (
                            <SelectItem key={course.key} value={course.key}>
                              {courseOptionLabel(course)}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <Button
                type="button"
                onClick={() => {
                  if (!namedCourse) return;
                  addCourseItems(
                    namedCourse,
                    namedCourse.items.map((item) => item.id),
                    courseOptionLabel(namedCourse),
                  );
                }}
                disabled={!namedCourse}
              >
                Add course
              </Button>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            <Input
              placeholder="Search by name, SKU, subject..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="sm:max-w-sm bg-background"
            />
            <Select value={subjectFilter} onValueChange={setSubjectFilter}>
              <SelectTrigger className="sm:w-56 bg-background">
                <SelectValue placeholder="All subjects" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All subjects</SelectItem>
                {subjects.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {subjectDisplayName(s.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="sm:w-40 bg-background">
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

          {loading ? (
            <p className="text-foreground/60">Loading catalog...</p>
          ) : (
            <>
              <p className="text-sm text-foreground/60 mb-4">
                {filteredItems.length} of {items.length} items
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {visibleItems.map((item) => {
                  const inCart = cart.find((l) => l.itemId === item.id);
                  const cardImage = storeCardImage(item);
                  return (
                    <div
                      key={item.id}
                      className="bg-secondary border border-border/50 rounded-xl p-4 flex flex-col justify-between"
                    >
                      <div>
                        {cardImage && (
                          <img
                            src={cardImage}
                            alt=""
                            loading="lazy"
                            className="mb-3 h-36 w-full rounded-lg object-contain bg-background"
                            data-marker="MCA_R3_A3_ITEM_EDIT"
                          />
                        )}
                        <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
                          {subjectDisplayName(item.subjects?.name ?? "Uncategorized")} ·{" "}
                          {item.item_type}
                        </p>
                        <h3 className="font-semibold text-foreground mb-2">
                          {item.original_name}
                        </h3>
                        {item.short_description && (
                          <p className="text-sm text-foreground/70 mb-2">
                            {item.short_description}
                          </p>
                        )}
                        <p className="text-primary font-bold">
                          ${item.sales_price.toFixed(2)}
                        </p>
                        {item.quantity_on_hand != null &&
                          item.quantity_on_hand <= 0 && (
                            <p className="text-xs text-destructive font-medium mt-1">
                              Currently out of stock — order anyway and we'll
                              follow up on timing
                            </p>
                          )}
                      </div>
                      <div className="mt-4">
                        {inCart ? (
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                onClick={() =>
                                  updateQuantity(item.id, inCart.quantity - 1)
                                }
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center text-sm">
                                {inCart.quantity}
                              </span>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8"
                                onClick={() =>
                                  updateQuantity(item.id, inCart.quantity + 1)
                                }
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                            <span className="text-xs text-foreground/60">
                              In cart
                            </span>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            className="w-full"
                            onClick={() => addToCart(item)}
                          >
                            Add to Cart
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {visibleItems.length === 0 && (
                <p className="text-center text-foreground/60 py-12">
                  No items match your search.
                </p>
              )}

              {visibleCount < filteredItems.length && (
                <div className="flex justify-center mt-8">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((c) => c + 50)}
                  >
                    Load {Math.min(50, filteredItems.length - visibleCount)}{" "}
                    more
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {cartOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => {
              setCartOpen(false);
              setCheckoutStep("cart");
            }}
          />
          <div className="relative bg-background w-full max-w-md h-full shadow-xl flex flex-col">
            <div className="flex items-center justify-between p-6 border-b border-border/50">
              <div className="flex items-center gap-2">
                {checkoutStep === "details" && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setCheckoutStep("cart")}
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                )}
                <h2 className="text-xl font-bold font-serif text-primary">
                  {checkoutStep === "cart" ? "Your Cart" : "Your Info"}
                </h2>
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  setCartOpen(false);
                  setCheckoutStep("cart");
                }}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            {checkoutStep === "cart" ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  {cartLines.length === 0 ? (
                    <p className="text-foreground/60">Your cart is empty.</p>
                  ) : (
                    cartLines.map(({ line, item }) => (
                      <div
                        key={item.id}
                        className="flex items-start justify-between gap-3 border-b border-border/30 pb-4"
                      >
                        <div className="flex-1">
                          <p className="font-medium text-sm">
                            {item.original_name}
                          </p>
                          <p className="text-xs text-foreground/60">
                            ${item.sales_price.toFixed(2)} each
                          </p>
                          <div className="flex items-center gap-2 mt-2">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() =>
                                updateQuantity(item.id, line.quantity - 1)
                              }
                            >
                              <Minus className="h-3 w-3" />
                            </Button>
                            <span className="w-6 text-center text-sm">
                              {line.quantity}
                            </span>
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() =>
                                updateQuantity(item.id, line.quantity + 1)
                              }
                            >
                              <Plus className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-2">
                          <span className="text-sm font-semibold">
                            ${(item.sales_price * line.quantity).toFixed(2)}
                          </span>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => removeFromCart(item.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-6 border-t border-border/50 space-y-4">
                  <div className="flex justify-between items-center font-bold text-lg">
                    <span>Subtotal</span>
                    <span className="text-primary">
                      ${cartTotal.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/60">
                    Shipping or pickup is chosen next. Final total is shown at
                    checkout.
                  </p>
                  <Button
                    className="w-full"
                    disabled={cartLines.length === 0}
                    onClick={() => setCheckoutStep("details")}
                  >
                    Checkout
                  </Button>
                </div>
              </>
            ) : (
              <form
                onSubmit={handlePlaceOrder}
                className="flex-1 overflow-y-auto flex flex-col"
              >
                <div className="flex-1 p-6 space-y-4">
                  {formError && (
                    <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                      {formError}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="store-first-name">First Name</Label>
                      <Input
                        id="store-first-name"
                        value={customer.firstName}
                        onChange={(e) =>
                          setCustomer((c) => ({
                            ...c,
                            firstName: e.target.value,
                          }))
                        }
                        className="bg-background"
                        required
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="store-last-name">Last Name</Label>
                      <Input
                        id="store-last-name"
                        value={customer.lastName}
                        onChange={(e) =>
                          setCustomer((c) => ({
                            ...c,
                            lastName: e.target.value,
                          }))
                        }
                        className="bg-background"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="store-email">Email</Label>
                    <Input
                      id="store-email"
                      type="email"
                      value={customer.email}
                      onChange={(e) =>
                        setCustomer((c) => ({ ...c, email: e.target.value }))
                      }
                      className="bg-background"
                      required
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="store-phone">Phone</Label>
                    <Input
                      id="store-phone"
                      type="tel"
                      placeholder="(555) 555-5555"
                      value={customer.phone}
                      onChange={(e) =>
                        setCustomer((c) => ({
                          ...c,
                          phone: formatPhoneNumber(e.target.value),
                        }))
                      }
                      className="bg-background"
                      required
                    />
                  </div>

                  <div className="space-y-2 pt-2">
                    <Label>How should we get this to you?</Label>
                    <RadioGroup
                      value={customer.fulfillment}
                      onValueChange={(v) =>
                        setCustomer((c) => ({
                          ...c,
                          fulfillment: v as "ship" | "pickup",
                        }))
                      }
                      className="grid grid-cols-2 gap-3"
                    >
                      <div className="flex items-center space-x-2 border border-border/50 p-3 rounded-lg cursor-pointer">
                        <RadioGroupItem
                          value="pickup"
                          id="fulfillment-pickup"
                        />
                        <Label
                          htmlFor="fulfillment-pickup"
                          className="cursor-pointer"
                        >
                          Local Pickup
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2 border border-border/50 p-3 rounded-lg cursor-pointer">
                        <RadioGroupItem value="ship" id="fulfillment-ship" />
                        <Label
                          htmlFor="fulfillment-ship"
                          className="cursor-pointer"
                        >
                          Ship to Me
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  {customer.fulfillment === "ship" && (
                    <div className="space-y-3 pt-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="store-address-street">
                          Street Address
                        </Label>
                        <Input
                          id="store-address-street"
                          value={customer.addressStreet}
                          onChange={(e) =>
                            setCustomer((c) => ({
                              ...c,
                              addressStreet: e.target.value,
                            }))
                          }
                          className="bg-background"
                          required
                        />
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="space-y-1.5 col-span-1">
                          <Label htmlFor="store-address-city">City</Label>
                          <Input
                            id="store-address-city"
                            value={customer.addressCity}
                            onChange={(e) =>
                              setCustomer((c) => ({
                                ...c,
                                addressCity: e.target.value,
                              }))
                            }
                            className="bg-background"
                            required
                          />
                        </div>
                        <div className="space-y-1.5 col-span-1">
                          <Label htmlFor="store-address-state">State</Label>
                          <Input
                            id="store-address-state"
                            value={customer.addressState}
                            onChange={(e) =>
                              setCustomer((c) => ({
                                ...c,
                                addressState: e.target.value,
                              }))
                            }
                            className="bg-background"
                            required
                          />
                        </div>
                        <div className="space-y-1.5 col-span-1">
                          <Label htmlFor="store-address-zip">ZIP</Label>
                          <Input
                            id="store-address-zip"
                            value={customer.addressZip}
                            onChange={(e) =>
                              setCustomer((c) => ({
                                ...c,
                                addressZip: e.target.value,
                              }))
                            }
                            className="bg-background"
                            required
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="p-6 border-t border-border/50 space-y-3">
                  <div className="flex justify-between text-sm text-foreground/70">
                    <span>Items ({cartCount})</span>
                    <span>${cartTotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-foreground/70">
                    <span>
                      {customer.fulfillment === "ship" ? "Shipping" : "Pickup"}
                    </span>
                    <span>
                      {customer.fulfillment === "ship"
                        ? "Calculated at checkout"
                        : "Free"}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm text-foreground/70">
                    <span>Oklahoma sales tax (10%)</span>
                    <span>
                      {showStoreTax
                        ? `$${estimatedTax.toFixed(2)} on products`
                        : "Not applied"}
                    </span>
                  </div>
                  <p className="text-xs text-foreground/50">
                    Store products are taxed at 10% when we ship to Oklahoma.
                    Local pickup is always taxed at 10% because pickup is at
                    our Oklahoma warehouse, and no pickup address is required.
                    Shipping is not taxed. Tuition is never taxed here. Coupon
                    codes are entered on the Stripe checkout page.
                  </p>
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={checkingOut}
                  >
                    {checkingOut ? "Starting checkout..." : "Place Order"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      <AlertDialog
        open={!!companionPrompt}
        onOpenChange={(open) => !open && setCompanionPrompt(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Add matching keys and resource books?</AlertDialogTitle>
            <AlertDialogDescription>
              {companionPrompt
                ? `These cover ${companionPrompt.title}. Answer keys and required resource books are listed separately, at full price.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 max-h-64 overflow-y-auto">
            {companionPrompt?.options.map((option) => (
              <label
                key={option.item.id}
                className="flex items-start gap-3 text-sm"
              >
                <Checkbox
                  checked={option.checked}
                  onCheckedChange={(checked) =>
                    setCompanionPrompt((current) =>
                      current
                        ? {
                            ...current,
                            options: current.options.map((row) =>
                              row.item.id === option.item.id
                                ? { ...row, checked: checked === true }
                                : row,
                            ),
                          }
                        : current,
                    )
                  }
                />
                <span>
                  <span className="font-medium">{companionLabel(option.kind)}</span>
                  {" · "}
                  {option.item.original_name} ($
                  {option.item.sales_price.toFixed(2)})
                  {option.item.range_start != null && (
                    <span className="text-foreground/60">
                      {" "}
                      · PACEs {option.item.range_start}
                      {option.item.range_end != null &&
                      option.item.range_end !== option.item.range_start
                        ? `–${option.item.range_end}`
                        : ""}
                    </span>
                  )}
                </span>
              </label>
            ))}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCompanionPrompt(null)}>
              No thanks
            </AlertDialogCancel>
            <AlertDialogAction onClick={addSelectedCompanions}>
              Add selected
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
