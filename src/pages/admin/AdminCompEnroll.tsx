import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
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
import { Plus, Trash2 } from "lucide-react";

// Same ordering fix as the public Enroll page — an ordered array, not a
// Record, so the two Kindergarten options lead the list instead of JS
// pushing them after "1".."11" (integer-like keys always sort first).
const LAST_GRADE_COMPLETED_OPTIONS: Array<[string, string]> = [
  ["none", "None — entering Kindergarten this year"],
  ["k", "Kindergarten (completed) — entering 1st Grade"],
  ["1", "1st Grade"],
  ["2", "2nd Grade"],
  ["3", "3rd Grade"],
  ["4", "4th Grade"],
  ["5", "5th Grade"],
  ["6", "6th Grade"],
  ["7", "7th Grade"],
  ["8", "8th Grade"],
  ["9", "9th Grade"],
  ["10", "10th Grade"],
  ["11", "11th Grade"],
];

const COMP_REASON_LABELS: Record<string, string> = {
  financial_hardship: "Financial Hardship",
  staff_family: "Staff / Family",
  scholarship: "Scholarship",
  pilot: "Pilot / Trial",
  other: "Other",
};

function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len === 0) return "";
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

interface StudentForm {
  firstName: string;
  lastName: string;
  gender: string;
  birthdate: string;
  lastGradeCompleted: string;
}

const emptyStudent = (): StudentForm => ({
  firstName: "",
  lastName: "",
  gender: "",
  birthdate: "",
  lastGradeCompleted: "",
});

const AdminCompEnroll = () => {
  const { toast } = useToast();

  const [parentFirstName, setParentFirstName] = useState("");
  const [parentLastName, setParentLastName] = useState("");
  const [secondParentName, setSecondParentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [addressStreet, setAddressStreet] = useState("");
  const [addressCity, setAddressCity] = useState("");
  const [addressState, setAddressState] = useState("");
  const [addressZip, setAddressZip] = useState("");
  const [paymentPlan, setPaymentPlan] = useState("monthly");
  const [compReason, setCompReason] = useState("");
  const [students, setStudents] = useState<StudentForm[]>([emptyStudent()]);

  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    familyId: string;
    students: { id: string; name: string; tier: string | null }[];
  } | null>(null);

  const updateStudent = (
    index: number,
    field: keyof StudentForm,
    value: string,
  ) => {
    setStudents((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [field]: value };
      return next;
    });
  };

  const addStudent = () => setStudents((prev) => [...prev, emptyStudent()]);
  const removeStudent = (index: number) =>
    setStudents((prev) => prev.filter((_, i) => i !== index));

  const resetForm = () => {
    setParentFirstName("");
    setParentLastName("");
    setSecondParentName("");
    setEmail("");
    setPhone("");
    setAddressStreet("");
    setAddressCity("");
    setAddressState("");
    setAddressZip("");
    setPaymentPlan("monthly");
    setCompReason("");
    setStudents([emptyStudent()]);
  };

  const canSubmit =
    parentFirstName.trim() &&
    parentLastName.trim() &&
    email.trim() &&
    phone.replace(/\D/g, "").length === 10 &&
    compReason &&
    students.length > 0 &&
    students.every(
      (s) => s.firstName.trim() && s.lastName.trim() && s.lastGradeCompleted,
    );

  const confirmEnroll = async () => {
    setConfirming(false);
    setSubmitting(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch(
      "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1/admin-comp-enroll",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: {
            firstName: parentFirstName,
            lastName: parentLastName,
            secondParentName,
            email,
            phone,
            addressStreet,
            addressCity,
            addressState,
            addressZip,
          },
          paymentPlan,
          compReason,
          students,
        }),
      },
    );
    const data = await res.json();

    if (!res.ok || data.error) {
      toast({
        title: "Couldn't create enrollment",
        description: data.error || "Check the admin-comp-enroll function logs.",
        variant: "destructive",
      });
    } else {
      setResult({ familyId: data.family_id, students: data.students });
      toast({ title: "Enrolled without payment" });
      resetForm();
    }
    setSubmitting(false);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <Link
          to="/admin/families"
          className="mb-2 inline-block text-sm text-primary hover:underline"
          data-marker="MCA_R7_BACK_TO_FAMILIES"
        >
          ← Back to Families
        </Link>
        <h2 className="text-2xl font-bold font-serif text-primary mb-2">
          Enroll Without Payment
        </h2>
        <p className="text-sm text-foreground/60">
          Creates a real family, students, and enrollment records — the same way
          a paid enrollment does, including the CRM contact and confirmation
          email — but with no Stripe charge. Every enrollment created here is
          permanently marked as a comp enrollment ($0) so it's never mistaken
          for real revenue in any list or report.
        </p>
      </div>

      {result && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-sm space-y-2">
          <p className="font-medium text-foreground">
            Enrolled {result.students.length} student
            {result.students.length > 1 ? "s" : ""} with no payment.
          </p>
          <ul className="list-disc list-inside text-foreground/70">
            {result.students.map((s) => (
              <li key={s.id}>
                {s.name}
                {s.tier
                  ? ` — ${s.tier.replace("_", " ")}`
                  : " — Kindergarten (no tuition record)"}
              </li>
            ))}
          </ul>
          <Link
            to={`/admin/families/${result.familyId}`}
            className="text-primary hover:underline font-medium"
          >
            View this family →
          </Link>
        </div>
      )}

      <div className="rounded-2xl border border-border/50 bg-secondary p-6 space-y-8">
        <div>
          <h3 className="font-semibold text-foreground mb-4">
            Parent / Guardian
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="comp-parent-first">First Name</Label>
              <Input
                id="comp-parent-first"
                className="bg-background"
                value={parentFirstName}
                onChange={(e) => setParentFirstName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-parent-last">Last Name</Label>
              <Input
                id="comp-parent-last"
                className="bg-background"
                value={parentLastName}
                onChange={(e) => setParentLastName(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5 mt-4">
            <Label htmlFor="comp-second-parent">
              Second Parent/Guardian Name (optional)
            </Label>
            <Input
              id="comp-second-parent"
              className="bg-background"
              value={secondParentName}
              onChange={(e) => setSecondParentName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div className="space-y-1.5">
              <Label htmlFor="comp-email">Email Address</Label>
              <Input
                id="comp-email"
                type="email"
                className="bg-background"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-phone">Phone Number</Label>
              <Input
                id="comp-phone"
                type="tel"
                className="bg-background"
                value={phone}
                onChange={(e) => setPhone(formatPhoneNumber(e.target.value))}
              />
            </div>
          </div>
          <div className="space-y-1.5 mt-4">
            <Label htmlFor="comp-street">Street Address (optional)</Label>
            <Input
              id="comp-street"
              className="bg-background"
              value={addressStreet}
              onChange={(e) => setAddressStreet(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="space-y-1.5">
              <Label htmlFor="comp-city">City</Label>
              <Input
                id="comp-city"
                className="bg-background"
                value={addressCity}
                onChange={(e) => setAddressCity(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-state">State</Label>
              <Input
                id="comp-state"
                className="bg-background"
                value={addressState}
                onChange={(e) => setAddressState(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="comp-zip">ZIP Code</Label>
              <Input
                id="comp-zip"
                className="bg-background"
                value={addressZip}
                onChange={(e) => setAddressZip(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-foreground">Students</h3>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addStudent}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> Add Student
            </Button>
          </div>
          <div className="space-y-6">
            {students.map((student, index) => (
              <div
                key={index}
                className="bg-background border border-border/50 p-4 rounded-xl relative"
              >
                {students.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeStudent(index)}
                    className="absolute top-3 right-3 text-destructive hover:text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <p className="text-sm font-semibold text-foreground/80 mb-3">
                  Student {index + 1}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>First Name</Label>
                    <Input
                      className="bg-secondary"
                      value={student.firstName}
                      onChange={(e) =>
                        updateStudent(index, "firstName", e.target.value)
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Last Name</Label>
                    <Input
                      className="bg-secondary"
                      value={student.lastName}
                      onChange={(e) =>
                        updateStudent(index, "lastName", e.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                  <div className="space-y-1.5">
                    <Label>Gender</Label>
                    <RadioGroup
                      value={student.gender}
                      onValueChange={(v) => updateStudent(index, "gender", v)}
                      className="flex gap-6 pt-2"
                    >
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem
                          value="male"
                          id={`comp-gender-male-${index}`}
                        />
                        <Label
                          htmlFor={`comp-gender-male-${index}`}
                          className="cursor-pointer font-normal"
                        >
                          Male
                        </Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem
                          value="female"
                          id={`comp-gender-female-${index}`}
                        />
                        <Label
                          htmlFor={`comp-gender-female-${index}`}
                          className="cursor-pointer font-normal"
                        >
                          Female
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`comp-birthdate-${index}`}>Birthdate</Label>
                    <Input
                      id={`comp-birthdate-${index}`}
                      type="date"
                      className="bg-secondary"
                      value={student.birthdate}
                      onChange={(e) =>
                        updateStudent(index, "birthdate", e.target.value)
                      }
                    />
                  </div>
                </div>
                <div className="mt-4 max-w-sm">
                  <Label>Last Grade Completed</Label>
                  <Select
                    value={student.lastGradeCompleted}
                    onValueChange={(v) =>
                      updateStudent(index, "lastGradeCompleted", v)
                    }
                  >
                    <SelectTrigger className="bg-secondary">
                      <SelectValue placeholder="Select last grade completed" />
                    </SelectTrigger>
                    <SelectContent>
                      {LAST_GRADE_COMPLETED_OPTIONS.map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>Record As Plan (for reference only — $0 either way)</Label>
            <RadioGroup
              value={paymentPlan}
              onValueChange={setPaymentPlan}
              className="flex gap-4"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="annual" id="comp-annual" />
                <Label
                  htmlFor="comp-annual"
                  className="cursor-pointer font-normal"
                >
                  Annual
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="monthly" id="comp-monthly" />
                <Label
                  htmlFor="comp-monthly"
                  className="cursor-pointer font-normal"
                >
                  Monthly
                </Label>
              </div>
            </RadioGroup>
          </div>
          <div className="space-y-2">
            <Label htmlFor="comp-reason">Reason (required)</Label>
            <Select value={compReason} onValueChange={setCompReason}>
              <SelectTrigger id="comp-reason" className="bg-background">
                <SelectValue placeholder="Select a reason" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(COMP_REASON_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button
          disabled={!canSubmit || submitting}
          onClick={() => setConfirming(true)}
          variant="secondary"
          className="border border-primary/30"
        >
          {submitting ? "Enrolling..." : "Enroll Without Payment"}
        </Button>
      </div>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enroll {students.length} student{students.length > 1 ? "s" : ""}{" "}
              with no payment?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This creates a real family and enrollment record —{" "}
              {parentFirstName} {parentLastName} will get the same welcome email
              a paying family gets, and this will show up in the CRM. Every
              enrollment record is permanently marked{" "}
              <strong>
                $0 / comp — {compReason ? COMP_REASON_LABELS[compReason] : ""}
              </strong>{" "}
              so it's never confused with real revenue. This can't be undone
              from here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEnroll}>
              Confirm — No Payment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminCompEnroll;
