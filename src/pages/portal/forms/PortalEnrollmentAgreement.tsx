import { useEffect, useState } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import type { PortalContext } from "../PortalLayout";

const emptyForm = (
  family: PortalContext["family"],
  student: PortalContext["selectedStudent"],
) => ({
  fatherName: family.parent_name,
  motherName: family.second_parent_name ?? "",
  mailingAddress: family.address ?? "",
  shippingSameAsMailing: true,
  shippingAddress: "",
  phone: family.phone,
  email: family.email,
  supervisorName: "",
  supervisorFamiliarWithAce: false,
  studentName: student?.student_name ?? "",
  studentGender: student?.gender ?? "",
  studentBirthdate: student?.birthdate ?? "",
  lastSchoolAttended: "",
  lastGradeCompleted: student?.last_grade_completed ?? "",
  lastGradeWhen: "",
  signature: "",
});

export default function PortalEnrollmentAgreement() {
  const { family, selectedStudent } = useOutletContext<PortalContext>();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState(emptyForm(family, selectedStudent));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This form is inherently per-student — the student-specific fields
  // (name, gender, birthdate, grade) were only ever set from the initial
  // useState call above, so switching the student selector in the portal
  // header while this form is open left those fields showing the PREVIOUS
  // student while student_id on submit correctly followed the new one,
  // risking a mismatched name saved under the right id. Re-seeding the
  // whole form on student change fixes that; the tradeoff is any parent-side
  // edits (address, phone, supervisor info) made before switching are reset
  // too, which is acceptable since this is meant to be filled out fresh per
  // student anyway.
  useEffect(() => {
    setForm(emptyForm(family, selectedStudent));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStudent?.id]);

  const set = <K extends keyof ReturnType<typeof emptyForm>>(
    key: K,
    value: ReturnType<typeof emptyForm>[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!form.fatherName && !form.motherName) {
      setError("At least one parent/guardian name is required.");
      return;
    }
    if (!form.studentName) {
      setError("Student name is required.");
      return;
    }
    if (!form.signature.trim()) {
      setError("Type your full name as your signature to submit.");
      return;
    }

    setSubmitting(true);

    const { error: insertError } = await supabase
      .from("form_submissions")
      .insert({
        family_id: family.id,
        student_id: selectedStudent?.id ?? null,
        form_type: "enrollment_agreement",
        submitted_data: {
          father_name: form.fatherName,
          mother_name: form.motherName,
          mailing_address: form.mailingAddress,
          shipping_address: form.shippingSameAsMailing
            ? form.mailingAddress
            : form.shippingAddress,
          phone: form.phone,
          email: form.email,
          supervisor_name: form.supervisorName || null,
          supervisor_familiar_with_ace: form.supervisorFamiliarWithAce,
          student_name: form.studentName,
          student_gender: form.studentGender,
          student_birthdate: form.studentBirthdate,
          last_school_attended: form.lastSchoolAttended,
          last_grade_completed: form.lastGradeCompleted,
          last_grade_when: form.lastGradeWhen,
        },
        signer_name: form.signature.trim(),
      });

    if (insertError) {
      setError(insertError.message);
      setSubmitting(false);
      return;
    }

    toast({
      title: "Enrollment agreement submitted",
      description: "Thank you — this is on file.",
    });
    setSubmitting(false);
    navigate("/portal/forms");
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary">
          Enrollment Agreement
        </h2>
        <p className="text-sm text-foreground/60">Midwest Christian Academy</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Father's Name</Label>
              <Input
                className="bg-background"
                value={form.fatherName}
                onChange={(e) => set("fatherName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Mother's Name</Label>
              <Input
                className="bg-background"
                value={form.motherName}
                onChange={(e) => set("motherName", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Mailing Address</Label>
            <Input
              className="bg-background"
              value={form.mailingAddress}
              onChange={(e) => set("mailingAddress", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                id="same-as-mailing"
                checked={form.shippingSameAsMailing}
                onCheckedChange={(v) => set("shippingSameAsMailing", !!v)}
              />
              <Label
                htmlFor="same-as-mailing"
                className="cursor-pointer font-normal"
              >
                Shipping address is the same as mailing address
              </Label>
            </div>
            {!form.shippingSameAsMailing && (
              <div className="space-y-1.5">
                <Label>Shipping Address</Label>
                <Input
                  className="bg-background"
                  value={form.shippingAddress}
                  onChange={(e) => set("shippingAddress", e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Preferred Phone</Label>
              <Input
                className="bg-background"
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email Address</Label>
              <Input
                className="bg-background"
                type="email"
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>
              Supervisor of student's schoolwork, if other than parent (name,
              address, phone)
            </Label>
            <Input
              className="bg-background"
              value={form.supervisorName}
              onChange={(e) => set("supervisorName", e.target.value)}
              placeholder="Leave blank if the parent is the supervisor"
            />
            <div className="flex items-center gap-2">
              <Checkbox
                id="ace-familiar"
                checked={form.supervisorFamiliarWithAce}
                onCheckedChange={(v) => set("supervisorFamiliarWithAce", !!v)}
              />
              <Label
                htmlFor="ace-familiar"
                className="cursor-pointer font-normal"
              >
                Supervisor is familiar with the ACE system
              </Label>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-4">
          <h3 className="font-semibold text-foreground">Student Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Student's Name</Label>
              <Input
                className="bg-background"
                value={form.studentName}
                onChange={(e) => set("studentName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Birthdate</Label>
              <Input
                className="bg-background"
                type="date"
                value={form.studentBirthdate ?? ""}
                onChange={(e) => set("studentBirthdate", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Last School Attended</Label>
              <Input
                className="bg-background"
                value={form.lastSchoolAttended}
                onChange={(e) => set("lastSchoolAttended", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Last Grade Completed</Label>
              <Input
                className="bg-background"
                value={form.lastGradeCompleted ?? ""}
                onChange={(e) => set("lastGradeCompleted", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>When (month/year last grade was completed)</Label>
            <Input
              className="bg-background"
              value={form.lastGradeWhen}
              onChange={(e) => set("lastGradeWhen", e.target.value)}
            />
          </div>
        </div>

        <div className="rounded-xl border border-border/50 bg-secondary/30 p-5 space-y-3">
          <h3 className="font-semibold text-foreground">
            Enrollment Agreement
          </h3>
          <p className="text-sm text-foreground/80 leading-relaxed">
            I, the signee, am entirely responsible for the payment of all fees
            for this account. I have, to the best of my knowledge, answered
            correctly all parts of the Enrollment Form. I understand the
            registration fee is to be paid each school year beginning July 1st.
            I also understand that the registration fee is non-refundable. I
            further understand that my student is to be supervised during study
            time by a parent or a responsible adult who will not allow the
            student to take short cuts by copying answers from the score keys.
          </p>
          <div className="space-y-1.5 pt-2">
            <Label>
              Signature of Parent/Guardian (type your full legal name)
            </Label>
            <Input
              className="bg-background"
              value={form.signature}
              onChange={(e) => set("signature", e.target.value)}
              placeholder="Full name"
            />
            <p className="text-xs text-foreground/50">
              Submitting this form on {new Date().toLocaleDateString()}{" "}
              constitutes your signature.
            </p>
          </div>
          <p className="text-xs text-foreground/50">
            Questions about your bill or account should be directed to
            admin@mcahomeschool.com.
          </p>
        </div>

        <Button type="submit" disabled={submitting}>
          {submitting ? "Submitting..." : "Sign & Submit"}
        </Button>
      </form>
    </div>
  );
}
