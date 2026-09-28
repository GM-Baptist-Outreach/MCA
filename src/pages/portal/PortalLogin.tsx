import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PORTAL_ROUTE = "/portal";

const PortalLogin = () => {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSending(true);

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${PORTAL_ROUTE}`,
      },
    });

    if (otpError) {
      setError(otpError.message);
    } else {
      setSent(true);
    }
    setSending(false);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold font-serif text-primary">
            Parent Portal
          </h1>
          <p className="text-sm text-foreground/60">
            Midwest Christian Academy
          </p>
        </div>

        {sent ? (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-6 text-center space-y-2">
            <p className="font-medium text-foreground">Check your email</p>
            <p className="text-sm text-foreground/70">
              We sent a login link to {email}. Click it to access the portal —
              no password needed.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setSent(false)}>
              Use a different email
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                {error}
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="portal-email">Email Address</Label>
              <Input
                id="portal-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="bg-background"
                required
              />
              <p className="text-xs text-foreground/50">
                Use the email address on file with your enrollment.
              </p>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={sending || !email}
            >
              {sending ? "Sending..." : "Send Login Link"}
            </Button>
          </form>
        )}

        <p className="text-center text-xs text-foreground/50">
          <Link to="/" className="hover:underline">
            Back to homepage
          </Link>
        </p>
      </div>
    </div>
  );
};

export default PortalLogin;
