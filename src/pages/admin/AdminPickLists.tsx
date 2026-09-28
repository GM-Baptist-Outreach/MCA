import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

interface PickList {
  id: string;
  school_year: string;
  ship_date: string;
  status: string;
  paused_for_missing_scores: boolean;
  notes: string | null;
  reminder_email_sent_at: string | null;
  students: { student_name: string } | { student_name: string }[] | null;
  pick_list_items: Array<{
    id: string;
    pace_number: number;
    quantity_on_hand: number | null;
    subjects: { name: string } | { name: string }[] | null;
  }>;
}

function nameOf(
  rel: { student_name?: string; name?: string } | { student_name?: string; name?: string }[] | null,
  key: "student_name" | "name",
): string {
  if (!rel) return "—";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return (row?.[key] as string) ?? "—";
}

export default function AdminPickLists() {
  const { toast } = useToast();
  const [lists, setLists] = useState<PickList[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("pick_lists")
      .select(
        "id, school_year, ship_date, status, paused_for_missing_scores, notes, reminder_email_sent_at, students(student_name), pick_list_items(id, pace_number, quantity_on_hand, subjects(name))",
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">Pick lists</h2>
          <p className="text-sm text-foreground/60">
            Due lists are the ones whose next ship date is within 7 days.
            Paused rows are the admin flag for missing scores.
          </p>
        </div>
        <Button onClick={generateDue} disabled={running}>
          {running ? "Running..." : "Generate due pick lists"}
        </Button>
      </div>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : lists.length === 0 ? (
        <p className="text-foreground/60">No pick lists yet.</p>
      ) : (
        <div className="space-y-3">
          {lists.map((list) => (
            <div key={list.id} className="rounded-xl border border-border/60 p-4 space-y-2">
              <div className="flex justify-between gap-3 flex-wrap">
                <p className="font-medium">
                  {nameOf(list.students, "student_name")} · {list.ship_date} · {list.school_year}
                </p>
                <p className="text-sm capitalize">
                  {list.status}
                  {list.paused_for_missing_scores ? " · paused for missing scores" : ""}
                </p>
              </div>
              {list.notes && <p className="text-sm text-foreground/70">{list.notes}</p>}
              {list.reminder_email_sent_at && (
                <p className="text-xs text-foreground/50">
                  Reminder emailed {new Date(list.reminder_email_sent_at).toLocaleString()}
                </p>
              )}
              <ul className="text-sm text-foreground/80 columns-2">
                {list.pick_list_items.map((item) => (
                  <li key={item.id}>
                    {nameOf(item.subjects, "name")} {item.pace_number}
                    {item.quantity_on_hand != null ? ` · on hand ${item.quantity_on_hand}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
