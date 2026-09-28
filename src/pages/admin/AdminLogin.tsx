import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabaseClient";
import { useNavigate } from "react-router-dom";

const ADMIN_ROUTE = "/admin";

const AdminLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [magicLinkStatus, setMagicLinkStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [passwordStatus, setPasswordStatus] = useState<
    "idle" | "sending" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setMagicLinkStatus("sending");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}${ADMIN_ROUTE}`,
      },
    });

    if (error) {
      setMagicLinkStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setMagicLinkStatus("sent");
  };

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordStatus("sending");
    setErrorMessage("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setPasswordStatus("error");
      setErrorMessage(error.message);
      return;
    }

    navigate(ADMIN_ROUTE);
  };

  return (
    <div className="flex flex-col min-h-screen bg-background items-center justify-center px-4">
      <div className="max-w-sm w-full bg-secondary p-8 rounded-2xl border border-border/50 shadow-sm">
        <h1 className="text-2xl font-bold font-serif text-primary mb-2">
          Admin Login
        </h1>
        <p className="text-sm text-foreground/70 mb-6">
          Midwest Christian Academy staff only.
        </p>

        <div className="space-y-2 mb-4">
          <Label htmlFor="admin-email">Email Address</Label>
          <Input
            id="admin-email"
            type="email"
            placeholder="you@midwestchristianacademy.com"
            className="bg-background"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>

        <form onSubmit={handlePasswordLogin} className="space-y-4 mb-6">
          <div className="space-y-2">
            <Label htmlFor="admin-password">Password</Label>
            <Input
              id="admin-password"
              type="password"
              className="bg-background"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          <Button
            type="submit"
            disabled={passwordStatus === "sending" || !password}
            className="w-full"
          >
            {passwordStatus === "sending"
              ? "Logging in..."
              : "Log In with Password"}
          </Button>
        </form>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t border-border/50" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-secondary px-2 text-foreground/60">or</span>
          </div>
        </div>

        {magicLinkStatus === "sent" ? (
          <p className="text-sm text-foreground/80">
            Check your email for a login link. You can close this tab.
          </p>
        ) : (
          <form onSubmit={handleMagicLink}>
            <Button
              type="submit"
              variant="outline"
              disabled={magicLinkStatus === "sending" || !email}
              className="w-full"
            >
              {magicLinkStatus === "sending"
                ? "Sending..."
                : "Email Me a Login Link Instead"}
            </Button>
          </form>
        )}

        {errorMessage && (
          <p className="text-sm text-destructive mt-4">{errorMessage}</p>
        )}
      </div>
    </div>
  );
};

export default AdminLogin;
