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
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabaseClient";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InByb2l5aW9xZmJqY21wcnNucWhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxMDY1MjMsImV4cCI6MjEwMTY4MjUyM30.yufhfBU7Wm9dOHuJz85-zuFd-8plw8YEGeV1NcG6dhA";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formatPhoneNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  const len = digits.length;
  if (len === 0) return "";
  if (len < 4) return `(${digits}`;
  if (len < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Last grade completed, collected once at enrollment as a reference point.
// "none" = child hasn't completed a grade yet (entering Kindergarten) — Kindergarten
// doesn't enroll in tuition, it's a one-time kit purchase through the store (not live
// on this site yet), so those students are excluded from tuition math below.
//
// An ordered array, not a Record — JS objects always enumerate integer-like keys
// ("1".."11") in numeric order before any non-numeric key ("none", "k"), no matter
// where those non-numeric keys appear in the source, which pushed the two
// Kindergarten options to the bottom of the dropdown regardless of listing order here.
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

const isKindergartenRoute = (lastGradeCompleted: string) =>
  lastGradeCompleted === "none";
const isHighSchoolTier = (lastGradeCompleted: string) =>
  ["8", "9", "10", "11"].includes(lastGradeCompleted);

// Fallback only — used for the instant the page renders before the live
// query below resolves. The real numbers always come from subscription_plans
// so a price change in the admin portal shows up here automatically instead
// of silently going stale.
type PlanPrices = {
  elementary: { annual: number; monthly: number };
  high_school: { annual: number; monthly: number };
};

const DEFAULT_PLAN_PRICES: PlanPrices = {
  elementary: { annual: 1100, monthly: 99 },
  high_school: { annual: 1175, monthly: 109 },
};

const Enroll = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [planPrices, setPlanPrices] = useState<PlanPrices>(DEFAULT_PLAN_PRICES);
  const [formData, setFormData] = useState({
    parentFirstName: "",
    parentLastName: "",
    secondParentName: "",
    email: "",
    phone: "",
    addressStreet: "",
    addressCity: "",
    addressState: "",
    addressZip: "",
    paymentPlan: "annual",
    students: [
      {
        firstName: "",
        lastName: "",
        gender: "",
        birthdate: "",
        lastGradeCompleted: "",
      },
    ],
  });

  const urlStatus = new URLSearchParams(window.location.search).get("status");

  useEffect(() => {
    if (urlStatus === "cancelled") {
      toast({
        title: "Checkout cancelled",
        description:
          "No payment was made. You can fill out the form again whenever you're ready.",
        variant: "destructive",
      });
    }
  }, [urlStatus]);

  useEffect(() => {
    const loadPrices = async () => {
      const { data, error } = await supabase
        .from("subscription_plans")
        .select("tuition_tier, frequency, price")
        .eq("active", true);

      if (error || !data) {
        console.error(
          "[MCA enroll] failed to load live tuition prices, using fallback",
          error,
        );
        return;
      }

      const next: PlanPrices = {
        elementary: { ...DEFAULT_PLAN_PRICES.elementary },
        high_school: { ...DEFAULT_PLAN_PRICES.high_school },
      };
      for (const row of data) {
        if (
          row.tuition_tier === "elementary" ||
          row.tuition_tier === "high_school"
        ) {
          if (row.frequency === "annual" || row.frequency === "monthly") {
            next[row.tuition_tier][row.frequency] = Number(row.price);
          }
        }
      }
      setPlanPrices(next);
    };
    loadPrices();
  }, []);

  const tuitionEligibleStudents = formData.students.filter(
    (s) => s.lastGradeCompleted && !isKindergartenRoute(s.lastGradeCompleted),
  );
  const hasKindergartenStudent = formData.students.some((s) =>
    isKindergartenRoute(s.lastGradeCompleted),
  );
  const hasAnyTuitionEligibleStudent = tuitionEligibleStudents.length > 0;

  const tuitionAmount = tuitionEligibleStudents.reduce((total, student) => {
    const highSchool = isHighSchoolTier(student.lastGradeCompleted);
    const tierPrices = highSchool
      ? planPrices.high_school
      : planPrices.elementary;
    return (
      total +
      (formData.paymentPlan === "annual"
        ? tierPrices.annual
        : tierPrices.monthly)
    );
  }, 0);

  const totalDue = hasAnyTuitionEligibleStudent ? tuitionAmount : 0;

  const addStudent = () => {
    setFormData({
      ...formData,
      students: [
        ...formData.students,
        {
          firstName: "",
          lastName: "",
          gender: "",
          birthdate: "",
          lastGradeCompleted: "",
        },
      ],
    });
  };

  const removeStudent = (index: number) => {
    const updated = formData.students.filter((_, i) => i !== index);
    setFormData({ ...formData, students: updated });
  };

  const updateStudent = (index: number, field: string, value: string) => {
    const updated = [...formData.students];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, students: updated });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!EMAIL_PATTERN.test(formData.email)) {
      toast({
        title: "Invalid email address",
        description:
          "Please enter a valid email address (e.g. name@example.com).",
        variant: "destructive",
      });
      return;
    }

    const phoneDigits = formData.phone.replace(/\D/g, "");
    if (phoneDigits.length !== 10) {
      toast({
        title: "Invalid phone number",
        description: "Please enter a 10-digit phone number.",
        variant: "destructive",
      });
      return;
    }

    // The grade picker is not a native input, so the browser can't enforce
    // it. A blank grade would be treated as Kindergarten and not charged.
    const missingGrade = formData.students.findIndex((s) => !s.lastGradeCompleted);
    if (missingGrade !== -1) {
      toast({
        title: "Last grade completed is required",
        description: `Please choose the last grade completed for Student ${missingGrade + 1}.`,
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/create-enrollment-checkout`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            apikey: SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            parent: {
              firstName: formData.parentFirstName,
              lastName: formData.parentLastName,
              secondParentName: formData.secondParentName,
              email: formData.email,
              phone: formData.phone,
              addressStreet: formData.addressStreet,
              addressCity: formData.addressCity,
              addressState: formData.addressState,
              addressZip: formData.addressZip,
            },
            paymentPlan: formData.paymentPlan,
            students: formData.students,
            origin: window.location.origin,
          }),
        },
      );

      const data = await res.json();

      if (!res.ok || data.error) {
        toast({
          title: "Couldn't start checkout",
          description:
            data.error ||
            "Something went wrong. Please try again or call us at (844) 663-4477.",
          variant: "destructive",
        });
        setIsSubmitting(false);
        return;
      }

      window.location.href = data.url;
    } catch (err) {
      console.error("[MCA enroll] fetch threw an error:", err);
      toast({
        title: "Couldn't start checkout",
        description:
          "Something went wrong. Please try again or call us at (844) 663-4477.",
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  if (urlStatus === "success") {
    return (
      <div className="flex flex-col min-h-screen bg-background">
        <section className="bg-primary text-primary-foreground py-24 flex-1 flex items-center">
          <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center max-w-2xl">
            <h1 className="text-4xl sm:text-5xl font-bold font-serif mb-6 text-white">
              You're Enrolled!
            </h1>
            <p className="text-xl text-primary-foreground/90 leading-relaxed mb-4">
              Thank you for enrolling with Midwest Christian Academy. Your
              payment was successful.
            </p>
            <p className="text-lg text-primary-foreground/80 leading-relaxed">
              Our team will reach out shortly to get your child's diagnostic
              assessment scheduled. If you have any questions in the meantime,
              call us at (844) 663-4477.
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
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl font-bold font-serif mb-6 text-white">
              Enroll Your Child in Midwest Christian Academy
            </h1>
            <p className="text-xl text-primary-foreground/90 leading-relaxed font-medium mb-4">
              We'll handle the curriculum. You get your evenings back.
            </p>
            <p className="text-lg text-primary-foreground/80 leading-relaxed">
              When you enroll, we don't hand you a stack of books and wish you
              luck. Your child takes a diagnostic assessment, and we prescribe
              the exact curriculum built around where they actually are, not
              just their grade on paper. We keep the records. We track the path
              to graduation. And we're here on Zoom when you get stuck.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto bg-secondary p-8 md:p-10 rounded-2xl border border-border/50 shadow-sm">
            <h2 className="text-2xl font-bold font-serif text-primary mb-6">
              Parent/Guardian Information
            </h2>

            <form className="space-y-8" onSubmit={handleSubmit}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="parentFirstName">First Name</Label>
                  <Input
                    id="parentFirstName"
                    placeholder="First name"
                    className="bg-background"
                    value={formData.parentFirstName}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        parentFirstName: e.target.value,
                      })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="parentLastName">Last Name</Label>
                  <Input
                    id="parentLastName"
                    placeholder="Last name"
                    className="bg-background"
                    value={formData.parentLastName}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        parentLastName: e.target.value,
                      })
                    }
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="secondParentName">
                  Second Parent/Guardian Name (optional)
                </Label>
                <Input
                  id="secondParentName"
                  placeholder="Second parent or guardian name"
                  className="bg-background"
                  value={formData.secondParentName}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      secondParentName: e.target.value,
                    })
                  }
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="name@example.com"
                    className="bg-background"
                    pattern="[^\s@]+@[^\s@]+\.[^\s@]+"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({ ...formData, email: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="(555) 555-5555"
                    className="bg-background"
                    pattern="\(\d{3}\) \d{3}-\d{4}"
                    value={formData.phone}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        phone: formatPhoneNumber(e.target.value),
                      })
                    }
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="addressStreet">Street Address</Label>
                <Input
                  id="addressStreet"
                  placeholder="Street address"
                  className="bg-background"
                  value={formData.addressStreet}
                  onChange={(e) =>
                    setFormData({ ...formData, addressStreet: e.target.value })
                  }
                  required
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="addressCity">City</Label>
                  <Input
                    id="addressCity"
                    placeholder="City"
                    className="bg-background"
                    value={formData.addressCity}
                    onChange={(e) =>
                      setFormData({ ...formData, addressCity: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressState">State</Label>
                  <Input
                    id="addressState"
                    placeholder="State"
                    className="bg-background"
                    value={formData.addressState}
                    onChange={(e) =>
                      setFormData({ ...formData, addressState: e.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addressZip">ZIP Code</Label>
                  <Input
                    id="addressZip"
                    placeholder="ZIP code"
                    className="bg-background"
                    value={formData.addressZip}
                    onChange={(e) =>
                      setFormData({ ...formData, addressZip: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="border-t border-border/50 pt-8">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-2xl font-bold font-serif text-primary">
                    Student Information
                  </h2>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addStudent}
                    className="flex items-center gap-2"
                  >
                    <Plus className="h-4 w-4" />
                    Add Student
                  </Button>
                </div>

                <div className="space-y-8">
                  {formData.students.map((student, index) => (
                    <div
                      key={index}
                      className="bg-background border border-border/50 p-6 rounded-xl relative"
                    >
                      {formData.students.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeStudent(index)}
                          className="absolute top-4 right-4 text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}

                      <h3 className="font-semibold text-lg mb-4 text-foreground/80">
                        Student {index + 1}
                      </h3>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <Label htmlFor={`studentFirstName-${index}`}>
                            First Name
                          </Label>
                          <Input
                            id={`studentFirstName-${index}`}
                            placeholder="First name"
                            className="bg-background"
                            value={student.firstName}
                            onChange={(e) =>
                              updateStudent(index, "firstName", e.target.value)
                            }
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`studentLastName-${index}`}>
                            Last Name
                          </Label>
                          <Input
                            id={`studentLastName-${index}`}
                            placeholder="Last name"
                            className="bg-background"
                            value={student.lastName}
                            onChange={(e) =>
                              updateStudent(index, "lastName", e.target.value)
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                        <div className="space-y-2">
                          <Label>Gender</Label>
                          <RadioGroup
                            value={student.gender}
                            onValueChange={(value) =>
                              updateStudent(index, "gender", value)
                            }
                            className="flex gap-6"
                          >
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem
                                value="male"
                                id={`gender-male-${index}`}
                              />
                              <Label
                                htmlFor={`gender-male-${index}`}
                                className="cursor-pointer"
                              >
                                Male
                              </Label>
                            </div>
                            <div className="flex items-center space-x-2">
                              <RadioGroupItem
                                value="female"
                                id={`gender-female-${index}`}
                              />
                              <Label
                                htmlFor={`gender-female-${index}`}
                                className="cursor-pointer"
                              >
                                Female
                              </Label>
                            </div>
                          </RadioGroup>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`birthdate-${index}`}>
                            Birthdate
                          </Label>
                          <Input
                            id={`birthdate-${index}`}
                            type="date"
                            className="bg-background"
                            value={student.birthdate}
                            onChange={(e) =>
                              updateStudent(index, "birthdate", e.target.value)
                            }
                            required
                          />
                        </div>
                      </div>

                      <div className="mt-6">
                        <div className="space-y-2 max-w-sm">
                          <Label htmlFor={`lastGradeCompleted-${index}`}>
                            Last Grade Completed
                          </Label>
                          <Select
                            value={student.lastGradeCompleted}
                            onValueChange={(value) =>
                              updateStudent(index, "lastGradeCompleted", value)
                            }
                          >
                            <SelectTrigger className="bg-background">
                              <SelectValue placeholder="Select last grade completed" />
                            </SelectTrigger>
                            <SelectContent>
                              {LAST_GRADE_COMPLETED_OPTIONS.map(
                                ([value, label]) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {isKindergartenRoute(student.lastGradeCompleted) && (
                        <div className="mt-4 p-4 rounded-lg bg-accent/10 border border-accent/30 text-sm text-foreground/80">
                          Kindergarten enrolls through our curriculum kit store
                          rather than a tuition plan. That option isn't live on
                          this site yet — please call us at (844) 663-4477 and
                          we'll get your child's Kindergarten kit started
                          directly.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {hasAnyTuitionEligibleStudent && (
                <div className="border-t border-border/50 pt-8">
                  <h2 className="text-2xl font-bold font-serif text-primary mb-6">
                    Tuition & Payment Plan
                  </h2>

                  <div className="bg-background p-6 rounded-xl border border-border/50 mb-6">
                    <h3 className="font-semibold text-lg mb-2">
                      Tuition Calculation
                    </h3>
                    <p className="text-foreground/80 mb-1">
                      Based on your{" "}
                      {tuitionEligibleStudents.length > 1
                        ? "children's last grade completed"
                        : "child's last grade completed"}
                      , we've calculated the total tuition due.
                    </p>
                  </div>

                  <div className="space-y-4 mb-8">
                    <Label className="text-lg">Select Payment Plan</Label>
                    <RadioGroup
                      value={formData.paymentPlan}
                      onValueChange={(value) =>
                        setFormData({ ...formData, paymentPlan: value })
                      }
                      className="grid grid-cols-1 sm:grid-cols-2 gap-4"
                    >
                      <div className="flex items-center space-x-3 border border-border/50 p-4 rounded-xl cursor-pointer hover:bg-secondary/50 transition-colors">
                        <RadioGroupItem value="annual" id="annual" />
                        <Label
                          htmlFor="annual"
                          className="cursor-pointer flex-1"
                        >
                          <div className="font-semibold">Annual Plan</div>
                          <div className="text-sm text-foreground/70">
                            Selected for all students
                          </div>
                        </Label>
                      </div>
                      <div className="flex items-center space-x-3 border border-border/50 p-4 rounded-xl cursor-pointer hover:bg-secondary/50 transition-colors">
                        <RadioGroupItem value="monthly" id="monthly" />
                        <Label
                          htmlFor="monthly"
                          className="cursor-pointer flex-1"
                        >
                          <div className="font-semibold">Monthly Plan</div>
                          <div className="text-sm text-foreground/70">
                            Selected for all students
                          </div>
                        </Label>
                      </div>
                    </RadioGroup>
                  </div>

                  <div className="bg-secondary/50 p-6 rounded-xl border border-border/50">
                    <h3 className="font-bold font-serif text-xl mb-4">
                      Due at Enrollment
                    </h3>
                    <div className="space-y-2 text-sm mb-4">
                      <div className="flex justify-between">
                        <span className="text-foreground/80">
                          First{" "}
                          {formData.paymentPlan === "annual"
                            ? "Annual"
                            : "Monthly"}{" "}
                          Payment
                        </span>
                        <span>${tuitionAmount}</span>
                      </div>
                    </div>
                    <div className="border-t border-border pt-4 flex justify-between items-center font-bold text-lg">
                      <span>Total Due Today</span>
                      <span className="text-primary">${totalDue}</span>
                    </div>
                  </div>
                </div>
              )}

              <div className="pt-4">
                <Button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    (!hasAnyTuitionEligibleStudent && !hasKindergartenStudent)
                  }
                  className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-6"
                >
                  {isSubmitting ? "Submitting..." : "Submit Application"}
                </Button>
                <p className="text-center text-sm text-foreground/60 mt-4">
                  You'll be redirected to a secure Stripe checkout to complete
                  payment. Once enrolled, our team will reach out to get your
                  child's diagnostic assessment scheduled.
                </p>
              </div>
            </form>
          </div>
        </div>
      </section>
    </div>
  );
};

export default Enroll;
