import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Star, Camera, Upload, Check, ChevronsUpDown } from "lucide-react";
import type { PortalContext } from "./PortalLayout";

interface Subject {
  id: string;
  name: string;
}

interface ScoreReport {
  id: string;
  subject_id: string;
  pace_number: number;
  score: string | null;
  photo_urls: string[] | null;
  entered_into_ace: boolean;
  reported_at: string;
}

const emptyForm = {
  subject_id: "",
  pace_number: "",
  test_date: new Date().toISOString().slice(0, 10),
  score: "",
};

export default function PortalProgress() {
  const { family, selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();

  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [scores, setScores] = useState<ScoreReport[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [subjectPopoverOpen, setSubjectPopoverOpen] = useState(false);
  const [files, setFiles] = useState<FileList | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [expandedScoreId, setExpandedScoreId] = useState<string | null>(null);
  const [photoLinks, setPhotoLinks] = useState<Record<string, string[]>>({});
  const [loadingPhotos, setLoadingPhotos] = useState(false);

  const loadData = async () => {
    if (!selectedStudent) return;
    setLoading(true);
    const [subjectsRes, scoresRes] = await Promise.all([
      supabase.from("subjects").select("id, name").order("name"),
      supabase
        .from("score_reports")
        .select(
          "id, subject_id, pace_number, score, photo_urls, entered_into_ace, reported_at",
        )
        .eq("student_id", selectedStudent.id)
        .order("pace_number"),
    ]);
    if (subjectsRes.data) setSubjects(subjectsRes.data);
    if (scoresRes.data) setScores(scoresRes.data as ScoreReport[]);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    setExpandedScoreId(null);
  }, [selectedStudent?.id]);

  const scoresBySubject = useMemo(() => {
    const map = new Map<string, ScoreReport[]>();
    for (const s of scores) {
      const list = map.get(s.subject_id) ?? [];
      list.push(s);
      map.set(s.subject_id, list);
    }
    return map;
  }, [scores]);

  const subjectAverage = (subjectScores: ScoreReport[]) => {
    const numeric = subjectScores
      .map((s) => parseFloat(s.score ?? ""))
      .filter((n) => !isNaN(n));
    if (numeric.length === 0) return null;
    return numeric.reduce((a, b) => a + b, 0) / numeric.length;
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!selectedStudent) return;
    if (!form.subject_id || !form.pace_number || !form.score) {
      setFormError("Subject, PACE number, and score are required.");
      return;
    }
    if (!files || files.length === 0) {
      setFormError(
        "Please attach at least one photo of the test before submitting.",
      );
      return;
    }
    const paceNumber = parseInt(form.pace_number, 10);
    const scoreNum = parseFloat(form.score);
    if (
      isNaN(paceNumber) ||
      isNaN(scoreNum) ||
      scoreNum < 0 ||
      scoreNum > 100
    ) {
      setFormError("Enter a valid PACE number and a score between 0 and 100.");
      return;
    }

    setSubmitting(true);

    const uploadedPaths: string[] = [];
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = `${family.id}/${selectedStudent.id}/${Date.now()}-${i}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from("test-score-photos")
          .upload(path, file);
        if (uploadError) {
          setFormError(`Couldn't upload ${file.name}: ${uploadError.message}`);
          setSubmitting(false);
          return;
        }
        uploadedPaths.push(path);
      }
    }

    const { error: insertError } = await supabase.from("score_reports").insert({
      student_id: selectedStudent.id,
      subject_id: form.subject_id,
      pace_number: paceNumber,
      score: form.score,
      photo_urls: uploadedPaths,
      entered_into_ace: false,
      reported_at: form.test_date,
    });

    if (insertError) {
      setFormError(insertError.message);
      setSubmitting(false);
      return;
    }

    toast({
      title: "Score submitted",
      description: "You can throw away the paper test now — this is on file.",
    });
    setForm(emptyForm);
    setFiles(null);
    setShowForm(false);
    setSubmitting(false);
    loadData();
  };

  const toggleExpand = async (scoreReport: ScoreReport) => {
    if (expandedScoreId === scoreReport.id) {
      setExpandedScoreId(null);
      return;
    }
    setExpandedScoreId(scoreReport.id);

    if (
      scoreReport.photo_urls &&
      scoreReport.photo_urls.length > 0 &&
      !photoLinks[scoreReport.id]
    ) {
      setLoadingPhotos(true);
      const signed = await Promise.all(
        scoreReport.photo_urls.map(async (path) => {
          const { data } = await supabase.storage
            .from("test-score-photos")
            .createSignedUrl(path, 300);
          return data?.signedUrl ?? null;
        }),
      );
      setPhotoLinks((prev) => ({
        ...prev,
        [scoreReport.id]: signed.filter((u): u is string => !!u),
      }));
      setLoadingPhotos(false);
    }
  };

  if (!selectedStudent) {
    return (
      <p className="text-foreground/60">
        Select a student above to upload tests.
      </p>
    );
  }

  if (loading) {
    return <p className="text-foreground/60">Loading...</p>;
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold font-serif text-primary">
            {selectedStudent.student_name}'s Upload Tests
          </h2>
          <p className="text-sm text-foreground/60">
            Gold stars are verified by MCA staff. Gray stars are self-reported
            and awaiting review.
          </p>
        </div>
        <Button onClick={() => setShowForm((v) => !v)}>
          <Upload className="h-4 w-4 mr-1.5" />
          {showForm ? "Cancel" : "Upload a Test Score"}
        </Button>
      </div>

      {showForm && (
        <form
          onSubmit={handleFormSubmit}
          className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4"
        >
          {formError && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
              {formError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Subject</Label>
              <Popover
                open={subjectPopoverOpen}
                onOpenChange={setSubjectPopoverOpen}
              >
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={subjectPopoverOpen}
                    className="w-full justify-between bg-background font-normal"
                  >
                    {form.subject_id
                      ? subjects.find((s) => s.id === form.subject_id)?.name
                      : "Select a subject"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search subjects..." />
                    <CommandList>
                      <CommandEmpty>No subject found.</CommandEmpty>
                      <CommandGroup>
                        {subjects.map((s) => (
                          <CommandItem
                            key={s.id}
                            value={s.name}
                            onSelect={() => {
                              setForm((f) => ({ ...f, subject_id: s.id }));
                              setSubjectPopoverOpen(false);
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                form.subject_id === s.id
                                  ? "opacity-100"
                                  : "opacity-0",
                              )}
                            />
                            {s.name}
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-1.5">
              <Label>PACE Number</Label>
              <Input
                type="number"
                value={form.pace_number}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pace_number: e.target.value }))
                }
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Date of Test</Label>
              <Input
                type="date"
                value={form.test_date}
                onChange={(e) =>
                  setForm((f) => ({ ...f, test_date: e.target.value }))
                }
                className="bg-background"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Score (%)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                max="100"
                value={form.score}
                onChange={(e) =>
                  setForm((f) => ({ ...f, score: e.target.value }))
                }
                className="bg-background"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Photos of All Test Pages</Label>
            <Input
              type="file"
              accept="image/*"
              multiple
              required
              onChange={(e) => setFiles(e.target.files)}
              className="bg-background"
            />
            <p className="text-xs text-foreground/50">
              Take a photo of every page of the scored test. You can throw the
              paper test away once this is submitted.
            </p>
          </div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Submitting..." : "Submit Score"}
          </Button>
        </form>
      )}

      {scoresBySubject.size === 0 ? (
        <p className="text-foreground/60">
          No tests uploaded yet for {selectedStudent.student_name}.
        </p>
      ) : (
        <div className="space-y-6">
          {Array.from(scoresBySubject.entries()).map(
            ([subjectId, subjectScores]) => {
              const subject = subjects.find((s) => s.id === subjectId);
              const avg = subjectAverage(subjectScores);
              return (
                <div
                  key={subjectId}
                  className="rounded-xl border border-border/50 bg-background p-5"
                >
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-foreground">
                      {subject?.name ?? "Unknown Subject"}
                    </h3>
                    <div className="text-sm text-foreground/70">
                      <span className="mr-4">
                        Completed: {subjectScores.length}
                      </span>
                      <span>
                        Year-to-Date Avg:{" "}
                        {avg != null ? `${avg.toFixed(1)}%` : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    {subjectScores
                      .sort((a, b) => a.pace_number - b.pace_number)
                      .map((s) => (
                        <button
                          key={s.id}
                          onClick={() => toggleExpand(s)}
                          title={`PACE ${s.pace_number}: ${s.score}% — ${new Date(s.reported_at).toLocaleDateString()} — ${s.entered_into_ace ? "Verified by MCA" : "Self-reported, not yet verified"}`}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <Star
                            className={`h-7 w-7 transition-colors ${
                              s.entered_into_ace
                                ? "fill-amber-400 text-amber-500"
                                : "fill-transparent text-foreground/30 group-hover:text-foreground/50"
                            }`}
                          />
                          <span className="text-xs text-foreground/60">
                            {s.pace_number}
                          </span>
                        </button>
                      ))}
                  </div>

                  {subjectScores.map((s) =>
                    expandedScoreId === s.id ? (
                      <div
                        key={`${s.id}-detail`}
                        className="mt-4 rounded-lg border border-border/50 bg-secondary/30 p-4 text-sm space-y-2"
                      >
                        <p>
                          <strong>PACE {s.pace_number}</strong> — {s.score}% on{" "}
                          {new Date(s.reported_at).toLocaleDateString()}
                        </p>
                        <p
                          className={
                            s.entered_into_ace
                              ? "text-amber-600"
                              : "text-foreground/60"
                          }
                        >
                          {s.entered_into_ace
                            ? "Verified by MCA staff"
                            : "Self-reported — awaiting review by MCA staff"}
                        </p>
                        {s.photo_urls && s.photo_urls.length > 0 && (
                          <div>
                            <p className="text-foreground/60 mb-1 flex items-center gap-1">
                              <Camera className="h-3.5 w-3.5" /> Test Photos
                            </p>
                            {loadingPhotos && !photoLinks[s.id] ? (
                              <p className="text-xs text-foreground/50">
                                Loading photos...
                              </p>
                            ) : (
                              <div className="flex flex-wrap gap-2">
                                {(photoLinks[s.id] ?? []).map((url, i) => (
                                  <a
                                    key={i}
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-primary underline text-xs"
                                  >
                                    Page {i + 1}
                                  </a>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ) : null,
                  )}
                </div>
              );
            },
          )}
        </div>
      )}
    </div>
  );
}
