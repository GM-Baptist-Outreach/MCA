import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { currentSchoolYear } from "@/lib/loggedCourses";
import {
  SUBJECT_GROUPS,
  subjectGroup,
  type SubjectGroup,
} from "@/lib/subjectGroups";
import type { PortalContext } from "./PortalLayout";

interface Subject {
  id: string;
  name: string;
}

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
}

type StoredStatus = "ordered" | "in_stock" | "issued";
type DisplayStatus = "prescribed" | "received" | "issued" | "completed" | "paused";

const DISPLAY_LABELS: Record<DisplayStatus, string> = {
  prescribed: "Prescribed",
  received: "Received",
  issued: "Issued",
  completed: "Completed",
  paused: "Paused",
};

const DISPLAY_COLORS: Record<DisplayStatus, string> = {
  prescribed: "bg-secondary text-foreground/70",
  received: "bg-yellow-500/10 text-yellow-700",
  issued: "bg-purple-500/10 text-purple-700",
  completed: "bg-green-500/10 text-green-700",
  paused: "bg-amber-500/10 text-amber-800",
};

function relName(
  rel: { name?: string; original_name?: string } | { name?: string; original_name?: string }[] | null,
  key: "name" | "original_name",
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
  return "prescribed";
}

function storedSelectValue(slot: PaceSlotRow): string {
  if (slot.status === "in_stock") return "in_stock";
  if (slot.status === "issued") return "issued";
  if (slot.status === "ordered" || slot.status === "prescribed") return "ordered";
  return "";
}

export default function PortalPaceStatus() {
  const { selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [group, setGroup] = useState<SubjectGroup | "">("");
  const [electiveSubjectId, setElectiveSubjectId] = useState("");
  const [slots, setSlots] = useState<PaceSlotRow[]>([]);
  const [schoolYear, setSchoolYear] = useState(currentSchoolYear());
  const [loading, setLoading] = useState(false);
  const [savingSlotId, setSavingSlotId] = useState<string | null>(null);

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
          "id, slot_index, pace_number, item_id, status, score, subject_id, subjects(name), items(original_name)",
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

  const electiveOptions = useMemo(() => {
    const fromSlots = new Map<string, string>();
    for (const slot of slots) {
      if (subjectGroup(slot.subjectName) === "Electives") {
        fromSlots.set(slot.subject_id, slot.subjectName);
      }
    }
    const source =
      fromSlots.size > 0
        ? [...fromSlots.entries()].map(([id, name]) => ({ id, name }))
        : subjects.filter((subject) => subjectGroup(subject.name) === "Electives");
    return [...source].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true }),
    );
  }, [slots, subjects]);

  const rows = useMemo(() => {
    if (!group) return [];
    return slots
      .filter((slot) => {
        if (group === "Electives") return slot.subject_id === electiveSubjectId;
        return subjectGroup(slot.subjectName) === group;
      })
      .sort(
        (a, b) =>
          a.subjectName.localeCompare(b.subjectName, undefined, { numeric: true }) ||
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
          for {schoolYear}. Prescribed covers a prescribed or ordered PACE.
          Received means it is in stock. Issued means it was issued. Completed
          means it passed, failed, or already has a score.
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
            {SUBJECT_GROUPS.map((name) => (
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
              {electiveOptions.map((subject) => (
                <SelectItem key={subject.id} value={subject.id}>
                  {subject.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            ? "Pick an elective to see this year's PACEs."
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
                  label !== "completed" && slot.item_id != null;
                return (
                  <tr key={slot.id} className="border-t border-border/50">
                    <td className="p-3">{slot.subjectName}</td>
                    <td className="p-3">{slot.slot_index}</td>
                    <td className="p-3">{slot.pace_number}</td>
                    <td className="p-3">{slot.itemName}</td>
                    <td className="p-3">
                      <span
                        className={`text-xs font-medium px-2 py-1 rounded-full ${DISPLAY_COLORS[label]}`}
                      >
                        {DISPLAY_LABELS[label]}
                        {slot.score != null ? ` ${slot.score}` : ""}
                      </span>
                    </td>
                    <td className="p-3">
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
                            <SelectItem value="ordered">Prescribed</SelectItem>
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
