import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
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
  companionKind,
  companionLabel,
  matchingCompanions,
  paceRangeForLevel,
  selectPacesForLevel,
  type CompanionKind,
} from "@/lib/loggedCourses";
import {
  oklahomaProductTaxCents,
  shouldApplyOklahomaStoreTax,
} from "@/lib/okSalesTax";
import { ArrowLeft, Minus, Plus, ShoppingCart, Trash2, X } from "lucide-react";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb2l5aW9xZmJqY21wcnNucWhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDY1MjMsImV4cCI6MjEwMTY4MjUyM30.yufhfBU7Wm9dOHuJz85-zuFd-8plw8YEGeV1NcG6dhA";

const CART_STORAGE_KEY = "mca_store_cart_v1";
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
  subjects: { name: string } | null;
  quantity_on_hand: number | null;
}

interface Subject {
  id: string;
  name: string;
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
    return parsed;
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

  const [bundleSubjectId, setBundleSubjectId] = useState("");
  const [bundleLevel, setBundleLevel] = useState("7");
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
            "id, subject_id, sku, item_type, pace_number, range_start, range_end, grade_level, original_name, sales_price, active, subjects(name), inventory_levels(quantity_on_hand)",
          )
          .eq("active", true)
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
        .select("id, name")
        .eq("active", true)
        .order("name", { ascending: true });

      if (subjectsError) {
        setError(subjectsError.message);
        setLoading(false);
        return;
      }

      setItems(allItems);
      setSubjects(subjectsData || []);
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
      return kind ? [{ item, kind, checked: true }] : [];
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
      const next = [...prev];
      for (const option of chosen) {
        const existing = next.find((line) => line.itemId === option.item.id);
        if (existing) existing.quantity += 1;
        else next.push({ itemId: option.item.id, quantity: 1 });
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

  const bundlePreview = useMemo(() => {
    const level = Number(bundleLevel);
    if (!bundleSubjectId || !Number.isInteger(level) || level < 1) return null;
    const selected = selectPacesForLevel(
      items.flatMap((item) =>
        item.subject_id && item.pace_number != null
          ? [
              {
                id: item.id,
                subject_id: item.subject_id,
                pace_number: item.pace_number,
                grade_level: item.grade_level,
              },
            ]
          : [],
      ),
      bundleSubjectId,
      level,
    );
    const paceItems = selected
      .map((row) => itemsById.get(row.id))
      .filter((item): item is StoreItem => !!item);
    const { start, end } = paceRangeForLevel(level);
    const total = paceItems.reduce((sum, item) => sum + item.sales_price, 0);
    return { start, end, paceItems, total };
  }, [bundleSubjectId, bundleLevel, items, itemsById]);

  const paceSubjects = useMemo(
    () =>
      subjects.filter((subject) =>
        items.some(
          (item) => item.subject_id === subject.id && item.item_type === "pace",
        ),
      ),
    [subjects, items],
  );

  const addFullLevel = () => {
    if (!bundlePreview || bundlePreview.paceItems.length === 0) {
      toast({
        title: "No PACEs in that level",
        description: "This subject doesn't have catalog rows for that level.",
        variant: "destructive",
      });
      return;
    }
    const { paceItems, start, end } = bundlePreview;
    setCart((prev) => {
      const next = [...prev];
      for (const item of paceItems) {
        const existing = next.find((line) => line.itemId === item.id);
        if (existing) existing.quantity += 1;
        else next.push({ itemId: item.id, quantity: 1 });
      }
      return next;
    });
    const subjectName =
      subjects.find((subject) => subject.id === bundleSubjectId)?.name ??
      "Subject";
    toast({
      title: "Full level added",
      description: `${subjectName} PACEs ${start}–${end} (${paceItems.length} items, full catalog price)`,
    });
    promptForCompanions(paceItems, `${subjectName} PACEs ${start}–${end}`);
  };

  const updateQuantity = (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart((prev) => prev.filter((l) => l.itemId !== itemId));
      return;
    }
    setCart((prev) =>
      prev.map((l) => (l.itemId === itemId ? { ...l, quantity } : l)),
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

          <div className="rounded-xl border border-border/50 bg-secondary/40 p-4 mb-6 space-y-3">
            <div>
              <h2 className="font-semibold text-foreground">Buy a full level</h2>
              <p className="text-sm text-foreground/60">
                Level N is PACEs (N−1)×12+1 through N×12 on the catalog
                pace number (MCA internal numbering). Price is the sum of
                those item prices. Stock still decrements per PACE.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
              <div className="space-y-1.5 sm:w-64">
                <Label>Subject</Label>
                <Select value={bundleSubjectId} onValueChange={setBundleSubjectId}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Choose a subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {paceSubjects.map((subject) => (
                      <SelectItem key={subject.id} value={subject.id}>
                        {subject.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:w-36">
                <Label>Level</Label>
                <Select value={bundleLevel} onValueChange={setBundleLevel}>
                  <SelectTrigger className="bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => String(i + 1)).map(
                      (level) => (
                        <SelectItem key={level} value={level}>
                          Level {level}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Button type="button" onClick={addFullLevel} disabled={!bundleSubjectId}>
                Add full level
              </Button>
            </div>
            {bundlePreview && (
              <p className="text-sm text-foreground/70">
                PACEs {bundlePreview.start}–{bundlePreview.end}:{" "}
                {bundlePreview.paceItems.length} in stock catalog
                {bundlePreview.paceItems.length > 0 &&
                  ` · $${bundlePreview.total.toFixed(2)}`}
              </p>
            )}
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
                    {s.name}
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
                  return (
                    <div
                      key={item.id}
                      className="bg-secondary border border-border/50 rounded-xl p-4 flex flex-col justify-between"
                    >
                      <div>
                        <p className="text-xs uppercase tracking-wide text-foreground/50 mb-1">
                          {item.subjects?.name ?? "Uncategorized"} ·{" "}
                          {item.item_type}
                        </p>
                        <h3 className="font-semibold text-foreground mb-2">
                          {item.original_name}
                        </h3>
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
