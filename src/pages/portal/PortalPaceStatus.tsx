import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  compareSubjectNames,
  currentSchoolYear,
  SUBJECT_GROUPS,
  subjectDisplayName,
  subjectGroup,
  paceLabel,
  type SubjectGroup,
} from "@/lib/loggedCourses";
import type { PortalContext } from "./PortalLayout";

interface PaceSlotRow {
  id: string;
  slot_index: number;
  pace_number: number;
  item_id: string | null;
  status: string;
  score: number | null;
  subject_id: string;
  subjectName: string;
  itemName: string;
  itemDescription: string;
}

type StoredStatus = "ordered" | "in_stock" | "issued";
type DisplayStatus =
  | "prescribed"
  | "shipped"
  | "received"
  | "issued"
  | "completed"
  | "paused";

// Round 3 P2: parents can only mark PACEs MCA has shipped.
export const MCA_R3_P2_MARKER = "MCA_R3_P2_RECEIVE_ALL";

const DISPLAY_LABELS: Record<DisplayStatus, string> = {
  prescribed: "Not shipped yet",
  shipped: "Shipped",
  received: "Received",
  issued: "Issued",
  completed: "Completed",
  paused: "Paused",
};

const DISPLAY_COLORS: Record<DisplayStatus, string> = {
  prescribed: "bg-secondary text-foreground/70",
  shipped: "bg-blue-500/10 text-blue-700",
  received: "bg-yellow-500/10 text-yellow-700",
  issued: "bg-purple-500/10 text-purple-700",
  completed: "bg-green-500/10 text-green-700",
  paused: "bg-amber-500/10 text-amber-800",
};

type RelRow = { name?: string; original_name?: string; short_description?: string | null };
function relName(
  rel: RelRow | RelRow[] | null,
  key: "name" | "original_name" | "short_description",
): string {
  if (!rel) return "";
  const row = Array.isArray(rel) ? rel[0] : rel;
  return row?.[key] ?? "";
}

function displayStatus(slot: PaceSlotRow): DisplayStatus {
  if (slot.score != null || slot.status === "passed" || slot.status === "failed") {
    return "completed";
  }
  if (slot.status === "in_stock") return "received";
  if (slot.status === "issued") return "issued";
  if (slot.status === "paused") return "paused";
  if (slot.status === "ordered") return "shipped";
  return "prescribed";
}

function storedSelectValue(slot: PaceSlotRow): string {
  if (slot.status === "in_stock") return "in_stock";
  if (slot.status === "issued") return "issued";
  if (slot.status === "ordered") return "ordered";
  return "";
}

function showTableFlag(group: string, electiveSubjectId: string): boolean {
  return group !== "" && (group !== "Electives" || electiveSubjectId !== "");
}

export default function PortalPaceStatus() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();

  const [group, setGroup] = useState<SubjectGroup | "">("");
  const [electiveSubjectId, setElectiveSubjectId] = useState("");
  const [slots, setSlots] = useState<PaceSlotRow[]>([]);
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear());
  const [loading, setLoading] = useState(false);
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);
  const [receivingAll, setReceivingAll] = useState(false);

  useEffect(() => {
    if (!selectedStudent) {
      setSlots([]);
      return;
    }
    let ignore = false;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("student_pace_slots")
        .select(
          "id, slot_index, pace_number, item_id, status, score, subject_id, subjects(name), items(original_name, short_description)",
        )
        .eq("student_id", selectedStudent.id)
        .eq("school_year", schoolYear)
        .order("slot_index");
      if (ignore) return;
      if (error) {
        toast({
          title: "Couldn't load PACE status",
          description: error.message,
          variant: "destructive",
        });
        setSlots([]);
      } else {
        setSlots(
          (data ?? []).map((row) => ({
            id: row.id,
            slot_index: row.slot_index,
            pace_number: row.pace_number,
            item_id: row.item_id,
            status: row.status,
            score: row.score,
            subject_id: row.subject_id,
            subjectName: relName(
              row.subjects as { name: string } | { name: string }[] | null,
              "name",
            ) || "Subject",
            itemName: relName(
              row.items as { original_name: string } | { original_name: string }[] | null,
              "original_name",
            ),
            itemDescription: relName(
              row.items as
                | { short_description: string | null }
                | { short_description: string | null }[]
                | null,
              "short_description",
            ),
          })),
        );
      }
      setLoading(false);
    };
    load();
    return () => {
      ignore = true;
    };
  }, [selectedStudent?.id, schoolYear, toast]);

  const prescribedGroups = useMemo(
    () =>
      SUBJECT_GROUPS.filter((name) =>
        slots.some((slot) => subjectGroup(slot.subjectName) === name),
      ),
    [slots],
  );

  const electiveOptions = useMemo(() => {
    const fromSlots = new Map<string, string>();
    for (const slot of slots) {
      if (subjectGroup(slot.subjectName) === "Electives") {
        fromSlots.set(slot.subject_id, slot.subjectName);
      }
    }
    return [...fromSlots.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => compareSubjectNames(a.name, b.name));
  }, [slots]);

  const rows = useMemo(() => {
    if (!group) return [];
    return slots
      .filter((slot) => {
        if (group === "Electives") return slot.subject_id === electiveSubjectId;
        return subjectGroup(slot.subjectName) === group;
      })
      .sort(
        (a, b) =>
          compareSubjectNames(a.subjectName, b.subjectName) ||
          a.slot_index - b.slot_index,
      );
  }, [slots, group, electiveSubjectId]);

  const setSlotStatus = async (slot: PaceSlotRow, newStatus: StoredStatus) => {
    if (!selectedStudent || !slot.item_id) return;
    setSavingSlotId(slot.id);
    const { error } = await supabase.from("pace_status").upsert(
      {
        student_id: selectedStudent.id,
        item_id: slot.item_id,
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
      setSlots((prev) =>
        prev.map((row) =>
          row.id === slot.id && row.status !== "passed" && row.status !== "failed"
            ? {
                ...row,
                status: newStatus,
              }
            : row,
        ),
      );
    }
    setSavingSlotId(null);
  };

  const receiveAll = async (targets: PaceSlotRow[], scopeLabel: string) => {
    if (!selectedStudent) return;
    const shipped = targets.filter(
      (slot) => slot.status === "ordered" && slot.item_id != null && slot.score == null,
    );
    if (shipped.length === 0) {
      toast({ title: "Nothing to receive", description: "No shipped PACEs are waiting." });
      return;
    }
    const ok = window.confirm(
      `Mark ${shipped.length} shipped PACE${shipped.length === 1 ? "" : "s"} (${scopeLabel}) as Received?`,
    );
    if (!ok) return;
    setReceivingAll(true);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();
    const itemIds = [...new Set(shipped.map((slot) => slot.item_id as string))];
    const { error } = await supabase.from("pace_status").upsert(
      itemIds.map((itemId) => ({
        student_id: selectedStudent.id,
        item_id: itemId,
        status: "in_stock",
        status_date: today,
        updated_at: now,
      })),
      { onConflict: "student_id,item_id" },
    );
    setReceivingAll(false);
    if (error) {
      toast({
        title: "Couldn't mark received",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    const received = new Set(itemIds);
    setSlots((prev) =>
      prev.map((row) =>
        row.status === "ordered" && row.item_id && received.has(row.item_id)
          ? { ...row, status: "in_stock" }
          : row,
      ),
    );
    toast({ title: `Marked ${itemIds.length} received` });
  };

  const shippedInView = rows.filter((slot) => slot.status === "ordered").length;
  const shippedAll = slots.filter((slot) => slot.status === "ordered").length;

  if (!selectedStudent) {
    return (
      <p className="text-foreground/60">
        Select a student above to see PACE status.
      </p>
    );
  }

  const showTable = group !== "" && (group !== "Electives" || electiveSubjectId !== "");

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">
          PACE Status
        </h2>
        <p className="text-sm text-foreground/60">
          {selectedStudent.student_name}. This table is the PACEs prescribed
          for {schoolYear}. Not shipped yet means MCA has not sent it. Shipped
          means MCA sent it. Mark it Received when it arrives, and Issued when
          your student starts it. Completed means it has a score.
        </p>
      </div>

      <div className="flex items-end gap-3 flex-wrap">
        <Select
          value={group}
          onValueChange={(value) => {
            setGroup(value as SubjectGroup);
            setElectiveSubjectId("");
          }}
        >
          <SelectTrigger className="bg-background w-64" aria-label="Subject group">
            <SelectValue placeholder="Select a subject" />
          </SelectTrigger>
          <SelectContent>
            {prescribedGroups.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {group === "Electives" && (
          <Select value={electiveSubjectId} onValueChange={setElectiveSubjectId}>
            <SelectTrigger className="bg-background w-64" aria-label="Elective">
              <SelectValue placeholder="Select an elective" />
            </SelectTrigger>
            <SelectContent>
              {electiveOptions.length === 0 ? (
                <SelectItem value="none" disabled>
                  No electives prescribed
                </SelectItem>
              ) : (
                electiveOptions.map((subject) => (
                  <SelectItem key={subject.id} value={subject.id}>
                    {subjectDisplayName(subject.name)}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
        {shippedAll > 0 && (
          <div className="flex gap-2 flex-wrap" data-marker="MCA_R3_P2_RECEIVE_ALL">
            {showTableFlag(group, electiveSubjectId) && shippedInView > 0 && (
              <Button
                size="sm"
                disabled={receivingAll}
                onClick={() => receiveAll(rows, "this subject")}
              >
                Receive All ({shippedInView})
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={receivingAll}
              onClick={() => receiveAll(slots, "all subjects")}
            >
              Receive All Shipped, all subjects ({shippedAll})
            </Button>
          </div>
        )}
        <div className="space-y-1">
          <p className="text-xs text-foreground/50">School year</p>
          <Input
            value={schoolYear}
            onChange={(event) => setSchoolYear(event.target.value)}
            className="bg-background w-28 h-9"
            aria-label="School year"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : !showTable ? (
        <p className="text-foreground/60">
          {group === "Electives"
            ? electiveOptions.length === 0
              ? "No electives prescribed."
              : "Pick an elective to see this year's PACEs."
            : prescribedGroups.length === 0
              ? "Contact MCA. No courses are prescribed for this school year."
              : "Pick a subject to see PACE status."}
        </p>
      ) : rows.length === 0 ? (
        <p className="text-foreground/60">
          No prescribed PACEs for this subject in {schoolYear}.
        </p>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-3">Subject</th>
                <th className="p-3">Slot</th>
                <th className="p-3">PACE #</th>
                <th className="p-3">Item</th>
                <th className="p-3">Status</th>
                <th className="p-3">Update</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((slot) => {
                const label = displayStatus(slot);
                const canWrite =
                  slot.item_id != null &&
                  (label === "shipped" || label === "received" || label === "issued");
                return (
                  <tr key={slot.id} className="border-t border-border/50">
                    <td className="p-3">{subjectDisplayName(slot.subjectName)}</td>
                    <td className="p-3">{slot.slot_index}</td>
                    <td className="p-3">{paceLabel(slot.subjectName, slot.pace_number)}</td>
                    <td className="p-3">
                      {slot.itemName}
                      {slot.itemDescription && (
                        <p className="text-xs text-foreground/60 mt-0.5 max-w-sm" data-marker="MCA_LATE_CATALOG">
                          {slot.itemDescription}
                        </p>
                      )}
                    </td>
                    <td className="p-3">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full ${DISPLAY_COLORS[label]}`}
                      >
                        {DISPLAY_LABELS[label]}
                        {slot.score != null ? ` ${slot.score}` : ""}
                      </span>
                    </td>
                    <td className="p-3">
                      {!canWrite && label === "prescribed" && (
                        <span className="text-xs text-foreground/50">Waiting on MCA</span>
                      )}
                      {canWrite && (
                        <Select
                          value={storedSelectValue(slot) || undefined}
                          onValueChange={(value) =>
                            setSlotStatus(slot, value as StoredStatus)
                          }
                          disabled={savingSlotId === slot.id}
                        >
                          <SelectTrigger className="bg-background h-8 w-36 text-xs">
                            <SelectValue placeholder="Set status" />
                          </SelectTrigger>
                          <SelectContent>
                            {label !== "issued" && (
                              <SelectItem value="ordered">Shipped</SelectItem>
                            )}
                            <SelectItem value="in_stock">Received</SelectItem>
                            <SelectItem value="issued">Issued</SelectItem>
                          </SelectContent>
                        </Select>
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
