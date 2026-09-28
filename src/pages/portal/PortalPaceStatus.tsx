import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PortalContext } from "./PortalLayout";

// Passing threshold for a PACE score.
const PASSING_THRESHOLD = 80;

interface Subject {
  id: string;
  name: string;
}

interface Item {
  id: string;
  pace_number: number;
  original_name: string;
}

interface ScoreReport {
  pace_number: number;
  score: string | null;
}

interface PaceStatusRow {
  item_id: string;
  status: "ordered" | "in_stock" | "issued";
}

type ComputedStatus =
  "not_started" | "ordered" | "in_stock" | "issued" | "passed" | "failed";

const STATUS_LABELS: Record<ComputedStatus, string> = {
  not_started: "Not Started",
  ordered: "Ordered",
  in_stock: "In Stock",
  issued: "Issued",
  passed: "Passed",
  failed: "Failed",
};

const STATUS_COLORS: Record<ComputedStatus, string> = {
  not_started: "bg-secondary text-foreground/50",
  ordered: "bg-blue-500/10 text-blue-700",
  in_stock: "bg-yellow-500/10 text-yellow-700",
  issued: "bg-purple-500/10 text-purple-700",
  passed: "bg-green-500/10 text-green-700",
  failed: "bg-destructive/10 text-destructive",
};

export default function PortalPaceStatus() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [scores, setScores] = useState<ScoreReport[]>([]);
  const [statuses, setStatuses] = useState<PaceStatusRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingItemId, setSavingItemId] = useState<string | null>(null);

  useEffect(() => {
    supabase
      .from("subjects")
      .select("id, name")
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        if (data) setSubjects(data);
      });
  }, []);

  useEffect(() => {
    if (!subjectId || !selectedStudent) {
      setItems([]);
      setScores([]);
      setStatuses([]);
      return;
    }
    const load = async () => {
      setLoading(true);
      const [itemsRes, scoresRes, statusRes] = await Promise.all([
        supabase
          .from("items")
          .select("id, pace_number, original_name")
          .eq("subject_id", subjectId)
          .eq("item_type", "pace")
          .order("pace_number"),
        supabase
          .from("score_reports")
          .select("pace_number, score")
          .eq("student_id", selectedStudent.id)
          .eq("subject_id", subjectId),
        supabase
          .from("pace_status")
          .select("item_id, status")
          .eq("student_id", selectedStudent.id),
      ]);
      if (itemsRes.data) setItems(itemsRes.data);
      if (scoresRes.data) setScores(scoresRes.data);
      if (statusRes.data) setStatuses(statusRes.data);
      setLoading(false);
    };
    load();
  }, [subjectId, selectedStudent?.id]);

  const computeStatus = (
    item: Item,
  ): { status: ComputedStatus; detail?: string } => {
    const score = scores.find((s) => s.pace_number === item.pace_number);
    if (score && score.score != null) {
      const num = parseFloat(score.score);
      return {
        status: num >= PASSING_THRESHOLD ? "passed" : "failed",
        detail: `${score.score}%`,
      };
    }
    const statusRow = statuses.find((s) => s.item_id === item.id);
    if (statusRow) return { status: statusRow.status };
    return { status: "not_started" };
  };

  const setItemStatus = async (
    item: Item,
    newStatus: "ordered" | "in_stock" | "issued",
  ) => {
    if (!selectedStudent) return;
    setSavingItemId(item.id);

    const { error } = await supabase.from("pace_status").upsert(
      {
        student_id: selectedStudent.id,
        item_id: item.id,
        status: newStatus,
        status_date: new Date().toISOString().slice(0, 10),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "student_id,item_id" },
    );

    if (error) {
      toast({
        title: "Couldn't update status",
        description: error.message,
        variant: "destructive",
      });
    } else {
      setStatuses((prev) => {
        const without = prev.filter((s) => s.item_id !== item.id);
        return [...without, { item_id: item.id, status: newStatus }];
      });
    }
    setSavingItemId(null);
  };

  const rows = useMemo(
    () => items.map((item) => ({ item, ...computeStatus(item) })),
    [items, scores, statuses],
  );

  if (!selectedStudent) {
    return (
      <p className="text-foreground/60">
        Select a student above to see PACE status.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">
          PACE Status
        </h2>
        <p className="text-sm text-foreground/60">
          {selectedStudent.student_name}
        </p>
      </div>

      <Select value={subjectId} onValueChange={setSubjectId}>
        <SelectTrigger className="bg-background w-64">
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

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : !subjectId ? (
        <p className="text-foreground/60">Pick a subject to see PACE status.</p>
      ) : rows.length === 0 ? (
        <p className="text-foreground/60">No PACEs found for this subject.</p>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-3">PACE #</th>
                <th className="p-3">Item</th>
                <th className="p-3">Status</th>
                <th className="p-3">Update</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ item, status, detail }) => (
                <tr key={item.id} className="border-t border-border/50">
                  <td className="p-3">{item.pace_number}</td>
                  <td className="p-3">{item.original_name}</td>
                  <td className="p-3">
                    <span
                      className={`text-xs font-medium px-2 py-1 rounded-full ${STATUS_COLORS[status]}`}
                    >
                      {STATUS_LABELS[status]}
                      {detail ? ` — ${detail}` : ""}
                    </span>
                  </td>
                  <td className="p-3">
                    {(status === "not_started" ||
                      status === "ordered" ||
                      status === "in_stock" ||
                      status === "issued") && (
                      <Select
                        value={status === "not_started" ? "" : status}
                        onValueChange={(v) =>
                          setItemStatus(
                            item,
                            v as "ordered" | "in_stock" | "issued",
                          )
                        }
                        disabled={savingItemId === item.id}
                      >
                        <SelectTrigger className="bg-background h-8 w-32 text-xs">
                          <SelectValue placeholder="Set status" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ordered">Ordered</SelectItem>
                          <SelectItem value="in_stock">In Stock</SelectItem>
                          <SelectItem value="issued">Issued</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
