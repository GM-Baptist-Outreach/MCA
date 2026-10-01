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
import { TEST_PHOTO_ACCEPT, testPhotoContentType } from "@/lib/testPhotoType";
import { usePrescribedSubjects } from "@/hooks/useLoggedCourseReport";
import {
  compareSubjectNames,
  currentSchoolYear,
  subjectDisplayName,
  toAcePaceNumber,
  toInternalPaceNumber,
} from "@/lib/loggedCourses";

const MAX_TEST_PHOTO_BYTES = 25 * 1024 * 1024;

// Storage keys allow only plain ASCII. Phone and Mac file names often carry
// accents, "#", or the narrow space macOS puts in screenshot names.
function safeStorageName(name: string): string {
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[_.]+|_+$/g, "");
  return (cleaned || "photo").slice(-120);
}

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
  review_status?: string | null;
  admin_note?: string | null;
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
  const schoolYear = currentSchoolYear();
  const prescribed = usePrescribedSubjects(selectedStudent?.id, schoolYear);
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
          "id, subject_id, pace_number, score, photo_urls, entered_into_ace, reported_at, review_status, admin_note",
        )
        .eq("student_id", selectedStudent.id)
        .order("pace_number"),
    ]);
    if (subjectsRes.data) setSubjects(subjectsRes.data);
    if (scoresRes.error) {
      const fallback = await supabase
        .from("score_reports")
        .select(
          "id, subject_id, pace_number, score, photo_urls, entered_into_ace, reported_at",
        )
        .eq("student_id", selectedStudent.id)
        .order("pace_number");
      if (fallback.data) setScores(fallback.data as ScoreReport[]);
    } else if (scoresRes.data) {
      setScores(scoresRes.data as ScoreReport[]);
    }
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
    const paceNumber = toInternalPaceNumber(parseInt(form.pace_number, 10));
    const allowed = prescribed.rows.some(
      (row) =>
        row.subjectId === form.subject_id &&
        row.paceNumber === paceNumber &&
        row.status !== "passed" &&
        row.status !== "failed" &&
        row.score == null,
    );
    if (!allowed) {
      setFormError("That PACE is not prescribed. Contact MCA.");
      return;
    }
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

    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!testPhotoContentType(file)) {
          setFormError(
            `${file.name} is not a supported photo. Upload JPEG, PNG, HEIC, WebP, or GIF pictures of the test pages.`,
          );
          return;
        }
        if (file.size > MAX_TEST_PHOTO_BYTES) {
          setFormError(`${file.name} is larger than 25 MB. Take a smaller photo and try again.`);
          return;
        }
      }
    }

    setSubmitting(true);

    const uploadedPaths: string[] = [];
    if (files && files.length > 0) {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const path = `${family.id}/${selectedStudent.id}/${Date.now()}-${i}-${safeStorageName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("test-score-photos")
          .upload(path, file, {
            // An empty browser type (common for iPhone HEIC) would be stored as
            // octet-stream and refused by the bucket's image-only rule.
            contentType: testPhotoContentType(file) ?? undefined,
          });
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
        {prescribed.subjects.length > 0 && (
          <Button onClick={() => setShowForm((v) => !v)}>
            <Upload className="h-4 w-4 mr-1.5" />
            {showForm ? "Cancel" : "Upload a Test Score"}
          </Button>
        )}
      </div>

      {prescribed.subjects.length === 0 && !prescribed.loading && (
        <p className="rounded-xl border border-border/50 bg-secondary/30 p-5 text-sm text-foreground/70">
          Contact MCA. Scores can be uploaded only for PACEs prescribed for this student.
        </p>
      )}

      {showForm && prescribed.subjects.length > 0 && (
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
                      ? subjectDisplayName(
                          prescribed.subjects.find((s) => s.id === form.subject_id)?.name ??
                            "Select a subject",
                        )
                      : "Select a subject"}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                  <Command>
                    <CommandInput placeholder="Search subjects..." />
                    <CommandList>
                      <CommandEmpty>No prescribed subject found.</CommandEmpty>
                      <CommandGroup>
                        {prescribed.subjects.map((s) => (
                          <CommandItem
                            key={s.id}
                            value={subjectDisplayName(s.name)}
                            onSelect={() => {
                              setForm((f) => ({ ...f, subject_id: s.id, pace_number: "" }));
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
                            {subjectDisplayName(s.name)}
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
              <select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={form.pace_number}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pace_number: e.target.value }))
                }
              >
                <option value="">Select a prescribed PACE</option>
                {prescribed.rows
                  .filter(
                    (row) =>
                      row.subjectId === form.subject_id &&
                      row.status !== "passed" &&
                      row.status !== "failed" &&
                      row.score == null,
                  )
                  .sort((a, b) => a.paceNumber - b.paceNumber)
                  .map((row) => (
                    <option key={row.id} value={String(row.paceNumber)}>
                      {toAcePaceNumber(row.paceNumber)}
                    </option>
                  ))}
              </select>
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
              accept={TEST_PHOTO_ACCEPT}
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
          {Array.from(scoresBySubject.entries())
            .sort((a, b) =>
              compareSubjectNames(
                subjects.find((s) => s.id === a[0])?.name ?? "",
                subjects.find((s) => s.id === b[0])?.name ?? "",
              ),
            )
            .map(
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
                      {subjectDisplayName(subject?.name ?? "Unknown Subject")}
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
                      .sort(
                        (a, b) =>
                          toInternalPaceNumber(a.pace_number) -
                          toInternalPaceNumber(b.pace_number),
                      )
                      .map((s) => {
                        const ace = toAcePaceNumber(s.pace_number);
                        const verified =
                          s.review_status === "approved" || s.entered_into_ace;
                        const rejected = s.review_status === "rejected";
                        const statusText = rejected
                          ? "Needs attention"
                          : verified
                            ? "Verified by MCA"
                            : "Pending review";
                        return (
                        <button
                          key={s.id}
                          onClick={() => toggleExpand(s)}
                          title={`PACE ${ace}: ${s.score}% — ${new Date(s.reported_at).toLocaleDateString()} — ${statusText}`}
                          className="flex flex-col items-center gap-1 group"
                        >
                          <Star
                            className={`h-7 w-7 transition-colors ${
                              verified
                                ? "fill-amber-400 text-amber-500"
                                : rejected
                                  ? "fill-transparent text-destructive"
                                  : "fill-transparent text-foreground/30 group-hover:text-foreground/50"
                            }`}
                          />
                          <span className="text-xs text-foreground/60">
                            {ace}
                          </span>
                        </button>
                        );
                      })}
                  </div>

                  {subjectScores.map((s) =>
                    expandedScoreId === s.id ? (
                      <div
                        key={`${s.id}-detail`}
                        className="mt-4 rounded-lg border border-border/50 bg-secondary/30 p-4 text-sm space-y-2"
                      >
                        <p>
                          <strong>PACE {toAcePaceNumber(s.pace_number)}</strong> — {s.score}% on{" "}
                          {new Date(s.reported_at).toLocaleDateString()}
                        </p>
                        <p
                          className={
                            s.review_status === "rejected"
                              ? "text-destructive"
                              : s.review_status === "approved" || s.entered_into_ace
                                ? "text-amber-600"
                                : "text-foreground/60"
                          }
                        >
                          {s.review_status === "rejected"
                            ? "Needs attention"
                            : s.review_status === "approved" || s.entered_into_ace
                              ? "Verified"
                              : "Pending review"}
                          {s.review_status === "rejected" && s.admin_note
                            ? ` — ${s.admin_note}`
                            : ""}
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
