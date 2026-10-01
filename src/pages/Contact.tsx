import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, Phone, MapPin, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

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

const Contact = () => {
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });
  const [honeypot, setHoneypot] = useState("");
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setSubmitError(null);

    const [firstName, ...lastNameParts] = formData.name.trim().split(/\s+/);
    const lastName = lastNameParts.join(" ");

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/submit-website-form`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          form: "contact",
          first_name: firstName || "",
          last_name: lastName || "",
          email: formData.email,
          phone: formData.phone,
          message: formData.message,
          page_url: window.location.href,
          website: honeypot,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        // A 400 is a validation problem the visitor can fix, so show it as-is.
        if (res.status === 400 && typeof data?.error === "string") {
          setSubmitError(data.error);
          toast({ title: "Please check the form", description: data.error, variant: "destructive" });
          setIsSubmitting(false);
          return;
        }
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
    } catch (err) {
      console.error("[MCA contact] submit failed", err);
      const message =
        "We couldn't send your message. Please try again, or call (844) 663-4477 or email David@midwestchristianacademy.com.";
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
      formId: "Contact Form",
      formData: {
        first_name: firstName || "",
        last_name: lastName || "",
        email: formData.email,
        phone: formData.phone,
        calendar_notes: formData.message,
      },
      formLabels: {
        first_name: "First Name",
        last_name: "Last Name",
        email: "Email Address",
        phone: "Phone Number",
        calendar_notes: "Message",
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
      title: "Message Sent",
      description: "Thank you for reaching out. We will get back to you soon.",
    });
    setIsSubmitted(true);
    setIsSubmitting(false);
  };

  const resetForm = () => {
    setFormData({ name: "", email: "", phone: "", message: "" });
    setHoneypot("");
    setSubmitError(null);
    setIsSubmitted(false);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <section className="bg-primary text-primary-foreground py-16 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <h1 className="text-4xl sm:text-5xl font-bold font-serif mb-6 text-white">
              Contact Us
            </h1>
            <p className="text-xl text-primary-foreground/90 leading-relaxed">
              We're here to answer your questions and guide you through the
              homeschool process.
            </p>
          </div>
        </div>
      </section>

      <section className="py-16 lg:py-24">
        <div className="container mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16">
            <div>
              <h2 className="text-3xl font-bold font-serif text-primary mb-8">
                Get in Touch
              </h2>

              <div className="space-y-8 mb-12">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <Phone className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-serif text-primary mb-1">
                      Phone
                    </h3>
                    <p className="text-foreground/80 mb-1">(844) 663-4477</p>
                    <p className="text-sm text-foreground/60">
                      Mon-Thu, 8:00 AM - 4:30 PM
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <Mail className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-serif text-primary mb-1">
                      Email
                    </h3>
                    <a
                      href="mailto:David@midwestchristianacademy.com"
                      className="text-foreground/80 hover:text-primary transition-colors"
                    >
                      David@midwestchristianacademy.com
                    </a>
                  </div>
                </div>

                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-accent/20 flex items-center justify-center shrink-0">
                    <MapPin className="h-6 w-6 text-accent" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold font-serif text-primary mb-1">
                      Office
                    </h3>
                    <p className="text-foreground/80">
                      2300 NW 32nd Street
                      <br />
                      Newcastle, OK 73065
                    </p>
                  </div>
                </div>
              </div>

              <div className="mb-12">
                <h3 className="text-xl font-bold font-serif text-primary mb-4">
                  Connect With Us
                </h3>
                <div className="flex gap-6">
                  <a
                    href="https://www.facebook.com/MidwestChristianAcademy"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:text-accent transition-colors font-medium flex items-center gap-2"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M22 12c0-5.523-4.477-10-10-10S2 6.477 2 12c0 4.991 3.657 9.128 8.438 9.878v-6.987h-2.54V12h2.54V9.797c0-2.506 1.492-3.89 3.777-3.89 1.094 0 2.238.195 2.238.195v2.46h-1.26c-1.243 0-1.63.771-1.63 1.562V12h2.773l-.443 2.89h-2.33v6.988C18.343 21.128 22 16.991 22 12z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Facebook
                  </a>
                  <a
                    href="https://www.instagram.com/midwestchristianacademy"
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:text-accent transition-colors font-medium flex items-center gap-2"
                  >
                    <svg
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fillRule="evenodd"
                        d="M12.315 2c2.43 0 2.784.013 3.808.06 1.064.049 1.791.218 2.427.465a4.902 4.902 0 011.772 1.153 4.902 4.902 0 011.153 1.772c.247.636.416 1.363.465 2.427.048 1.067.06 1.407.06 4.123v.08c0 2.643-.012 2.987-.06 4.043-.049 1.064-.218 1.791-.465 2.427a4.902 4.902 0 01-1.153 1.772 4.902 4.902 0 01-1.772 1.153c-.636.247-1.363.416-2.427.465-1.067.048-1.407.06-4.123.06h-.08c-2.643 0-2.987-.012-4.043-.06-1.064-.049-1.791-.218-2.427-.465a4.902 4.902 0 01-1.772-1.153 4.902 4.902 0 01-1.153-1.772c-.247-.636-.416-1.363-.465-2.427-.047-1.024-.06-1.379-.06-3.808v-.63c0-2.43.013-2.784.06-3.808.049-1.064.218-1.791.465-2.427a4.902 4.902 0 011.153-1.772A4.902 4.902 0 015.45 2.525c.636-.247 1.363-.416 2.427-.465C8.901 2.013 9.256 2 11.685 2h.63zm-.081 1.802h-.468c-2.456 0-2.784.011-3.807.058-.975.045-1.504.207-1.857.344-.467.182-.8.398-1.15.748-.35.35-.566.683-.748 1.15-.137.353-.3.882-.344 1.857-.047 1.023-.058 1.351-.058 3.807v.468c0 2.456.011 2.784.058 3.807.045.975.207 1.504.344 1.857.182.466.399.8.748 1.15.35.35.683.566 1.15.748.353.137.882.3 1.857.344 1.054.048 1.37.058 4.041.058h.08c2.597 0 2.917-.01 3.96-.058.976-.045 1.505-.207 1.858-.344.466-.182.8-.398 1.15-.748.35-.35.566-.683.748-1.15.137-.353.3-.882.344-1.857.048-1.055.058-1.37.058-4.041v-.08c0-2.597-.01-2.917-.058-3.96-.045-.976-.207-1.505-.344-1.858a3.097 3.097 0 00-.748-1.15 3.098 3.098 0 00-1.15-.748c-.353-.137-.882-.3-1.857-.344-1.023-.047-1.351-.058-3.807-.058zM12 6.865a5.135 5.135 0 110 10.27 5.135 5.135 0 010-10.27zm0 1.802a3.333 3.333 0 100 6.666 3.333 3.333 0 000-6.666zm5.338-3.205a1.2 1.2 0 110 2.4 1.2 1.2 0 010-2.4z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Instagram
                  </a>
                </div>
              </div>

              <div className="w-full h-64 lg:h-80 bg-secondary rounded-2xl overflow-hidden border border-border/50">
                <iframe
                  src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3235.803875883713!2d-97.6015522!3d35.2441989!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x87b20f3a479a0e6d%3A0xb3c99a0ed46067b6!2s2300%20NW%2032nd%20St%2C%20Newcastle%2C%20OK%2073065!5e0!3m2!1sen!2sus!4v1716301234567!5m2!1sen!2sus"
                  width="100%"
                  height="100%"
                  style={{ border: 0 }}
                  allowFullScreen
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title="Midwest Christian Academy Location"
                ></iframe>
              </div>
            </div>

            <div className="bg-secondary p-8 rounded-2xl border border-border/50">
              {isSubmitted ? (
                <div
                  role="status"
                  className="flex flex-col items-center text-center py-8"
                >
                  <div className="h-16 w-16 rounded-full bg-accent/20 flex items-center justify-center mb-6">
                    <CheckCircle2 className="h-9 w-9 text-accent" />
                  </div>
                  <h3 className="text-2xl font-bold font-serif text-primary mb-3">
                    You're all set!
                  </h3>
                  <p className="text-foreground/80 leading-relaxed mb-8 max-w-sm">
                    Thanks for reaching out
                    {formData.name.trim() ? `, ${formData.name.trim().split(/\s+/)[0]}` : ""}.
                    We received your message and will get back to you at{" "}
                    <span className="font-semibold">{formData.email}</span>{" "}
                    soon.
                  </p>
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
                <h3 className="text-2xl font-bold font-serif text-primary mb-6">
                  Send a Message
                </h3>
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
                    <Label htmlFor="name">Full Name</Label>
                    <Input
                      id="name"
                      placeholder="Your name"
                      className="bg-background"
                      value={formData.name}
                      onChange={(e) =>
                        setFormData({ ...formData, name: e.target.value })
                      }
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="email">Email Address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Your email address"
                      className="bg-background"
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
                      placeholder="Your phone number"
                      className="bg-background"
                      value={formData.phone}
                      onChange={(e) =>
                        setFormData({ ...formData, phone: e.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="message">Message</Label>
                    <Textarea
                      id="message"
                      placeholder="How can we help you?"
                      className="min-h-[120px] bg-background"
                      maxLength={5000}
                      value={formData.message}
                      onChange={(e) =>
                        setFormData({ ...formData, message: e.target.value })
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
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 text-lg py-6"
                  >
                    {isSubmitting ? "Sending..." : "Send Message"}
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

export default Contact;
