import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BookOpen, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

// Fill in with the hosted PDF URL to show a "Download the guide" button on
// the success panel. Empty = no button.
const GUIDE_PDF_URL = "";

const SUPABASE_URL = "https://proiyioqfbjcmprsnqhf.supabase.co";

type StandardTrackingFieldKey = string;
type RegisteredCustomFieldId = string;
type TrackingCustomField = { value?: unknown; label: string };
type TrackingFileField = { file?: File; label: string };
type TrackingImageDataField = { dataUrl?: string; label: string };

const postTrackingEvent = (
  trackingPayload: Record<string, unknown> & {
    formData: Record<StandardTrackingFieldKey, unknown>;
    formLabels: Record<StandardTrackingFieldKey, string>;
  },
  options: {
    customFields?: Record<RegisteredCustomFieldId, TrackingCustomField>;
    fileFields?: Record<RegisteredCustomFieldId, TrackingFileField>;
    imageDataFields?: Record<RegisteredCustomFieldId, TrackingImageDataField>;
  } = {},
) => {
  const { customFields = {}, fileFields = {}, imageDataFields = {} } = options;
  const eventPayload = {
    ...trackingPayload,
    formData: { ...trackingPayload.formData },
    formLabels: { ...trackingPayload.formLabels },
  };
  const body = new FormData();

  for (const [key, field] of Object.entries(customFields)) {
    if (field.value === undefined) continue;
    eventPayload.formData[key] = field.value;
    eventPayload.formLabels[key] = field.label;
  }

  for (const [key, field] of Object.entries(imageDataFields)) {
    const dataUrl = field.dataUrl;
    if (!dataUrl) continue;
    if (!dataUrl.startsWith("data:image/")) {
      throw new Error("Image data field must be a data:image/* base64 string");
    }
    eventPayload.formData[key] = dataUrl;
    eventPayload.formLabels[key] = field.label;
  }

  for (const [key, field] of Object.entries(fileFields)) {
    const file = field.file;
    if (!file) continue;
    if (file.size > 50 * 1024 * 1024) {
      throw new Error("File must be 50 MB or smaller");
    }
    eventPayload.formData[key] = {
      filename: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    };
    eventPayload.formLabels[key] = field.label;
    body.append(key, file, file.name);
  }

  for (const key of Object.keys(eventPayload.formData)) {
    eventPayload.formLabels[key] ||= key;
  }

  body.append("event", JSON.stringify(eventPayload));

  fetch("https://backend.leadconnectorhq.com/external-tracking/events", {
    method: "POST",
    headers: {
      version: "2021-07-28",
    },
    body,
  }).catch(() => {});
};

const CurriculumGuide = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [honeypot, setHoneypot] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-website-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form: "curriculum_guide",
          first_name: formData.firstName,
          last_name: formData.lastName,
          email: formData.email,
          phone: formData.phone,
          page_url: window.location.href,
          website: honeypot,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
    } catch (err) {
      console.error("[MCA curriculum guide] submit failed", err);
      const message =
        "We couldn't send your request. Please try again, or call (844) 663-4477 or email David@midwestchristianacademy.com.";
      setSubmitError(message);
      toast({
        title: "Something went wrong",
        description: message,
        variant: "destructive",
      });
      setIsSubmitting(false);
      return;
    }

    const trackingPayload = {
      type: "external_form_submission",
      timestamp: Date.now(),
      formId: "Curriculum Guide Request",
      formData: {
        first_name: formData.firstName,
        last_name: formData.lastName,
        email: formData.email,
        phone: formData.phone,
      },
      formLabels: {
        first_name: "First Name",
        last_name: "Last Name",
        email: "Email Address",
        phone: "Phone Number",
      },
      url: window.location.href,
      title: document.title,
      path: window.location.pathname,
      userAgent: navigator.userAgent,
      trackingId: "tk_d5df2c9fea464b2a8b65bfc566cf9521",
      locationId: "9YFQxlzS8RBbYsxQ9knD",
      sessionId: crypto.randomUUID(),
      properties: {
        deviceType: /Mobile|Android|iPhone/i.test(navigator.userAgent)
          ? "mobile"
          : "desktop",
      },
    };

    try {
      postTrackingEvent(trackingPayload);
    } catch {
      // Analytics only - never block the success state.
    }

    toast({
      title: "Guide Requested",
      description: "We'll send the curriculum guide to your email shortly.",
    });
    setIsSubmitted(true);
    setIsSubmitting(false);
  };

  const resetForm = () => {
    setFormData({ firstName: "", lastName: "", email: "", phone: "" });
    setHoneypot("");
    setSubmitError(null);
    setIsSubmitted(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <section className="py-16 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto bg-secondary rounded-3xl overflow-hidden shadow-xl border border-border/50 flex flex-col md:flex-row">
            <div className="md:w-5/12 bg-primary text-primary-foreground p-10 flex flex-col justify-center relative overflow-hidden">
              <div className="absolute inset-0 opacity-10 flex items-center justify-center pointer-events-none">
                <BookOpen className="w-64 h-64 absolute -left-10" />
              </div>
              <div className="relative z-10">
                <h1 className="text-3xl font-bold font-serif mb-4 text-white leading-tight">
                  Not sure homeschooling is right for your family yet? Start
                  here.
                </h1>
                <p className="text-primary-foreground/90 mb-6 leading-relaxed">
                  Get our free curriculum guide and discover how the A.C.E.
                  system can fit your child's unique needs.
                </p>
                <ul className="space-y-3 text-sm text-primary-foreground/80">
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-accent" />
                    Overview of concept mastery
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-accent" />
                    Grade-by-grade breakdown
                  </li>
                  <li className="flex items-center gap-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-accent" />
                    Graduation pathways
                  </li>
                </ul>
              </div>
            </div>

            <div className="md:w-7/12 p-10 bg-background">
              {isSubmitted ? (
                <div
                  role="status"
                  className="flex flex-col items-center text-center py-8"
                >
                  <div className="h-16 w-16 rounded-full bg-accent/20 flex items-center justify-center mb-6">
                    <CheckCircle2 className="h-9 w-9 text-accent" />
                  </div>
                  <h2 className="text-2xl font-bold font-serif text-primary mb-3">
                    Your Curriculum Guide is on its way
                  </h2>
                  <p className="text-foreground/80 leading-relaxed mb-8 max-w-sm">
                    Thanks{formData.firstName ? `, ${formData.firstName}` : ""}!
                    We'll send the guide to{" "}
                    <span className="font-semibold">{formData.email}</span>{" "}
                    shortly. Keep an eye on your inbox (and spam folder, just
                    in case).
                  </p>
                  {GUIDE_PDF_URL && (
                    <Button
                      asChild
                      className="w-full bg-accent text-primary hover:bg-accent/90 text-lg py-6 font-semibold mb-4"
                    >
                      <a href={GUIDE_PDF_URL} target="_blank" rel="noreferrer">
                        Download the guide
                      </a>
                    </Button>
                  )}
                  <button
                    type="button"
                    onClick={resetForm}
                    className="text-sm text-primary underline underline-offset-4 hover:text-accent transition-colors"
                  >
                    Submit another
                  </button>
                </div>
              ) : (
                <>
                <h2 className="text-2xl font-bold font-serif text-primary mb-6">
                  Where should we send it?
                </h2>
                <form className="space-y-6" onSubmit={handleSubmit}>
                  <div
                    aria-hidden="true"
                    className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden"
                  >
                    <label htmlFor="website">Website</label>
                    <input
                      id="website"
                      name="website"
                      type="text"
                      tabIndex={-1}
                      autoComplete="off"
                      value={honeypot}
                      onChange={(e) => setHoneypot(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      placeholder="First Name"
                      value={formData.firstName}
                      onChange={(e) =>
                        setFormData({ ...formData, firstName: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      placeholder="Last Name"
                      value={formData.lastName}
                      onChange={(e) =>
                        setFormData({ ...formData, lastName: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Email Address"
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
                      placeholder="Phone Number"
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData({ ...formData, phone: e.target.value })
                      }
                      required
                    />
                  </div>
                  {submitError && (
                    <p
                      role="alert"
                      className="text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-4 py-3"
                    >
                      {submitError}
                    </p>
                  )}
                  <Button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full bg-accent text-primary hover:bg-accent/90 text-lg py-6 font-semibold mt-4"
                  >
                    {isSubmitting ? "Sending..." : "Get the Free Guide"}
                  </Button>
                </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};

export default CurriculumGuide;
