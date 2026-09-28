import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
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

type AdminUser = {
  id: string;
  auth_user_id: string;
  name: string | null;
  email: string;
  created_at: string;
  is_self: boolean;
};

const FUNCTIONS_URL =
  "https://proiyioqfbjcmprsnqhf.supabase.co/functions/v1/manage-admin-users";

const AdminUsers = () => {
  const { toast } = useToast();
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [newEmail, setNewEmail] = useState("");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingAdmin, setRemovingAdmin] = useState<AdminUser | null>(null);
  const [removing, setRemoving] = useState(false);

  const callFunction = async (body: Record<string, unknown>) => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    const res = await fetch(FUNCTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, data: await res.json() };
  };

  const loadAdmins = async () => {
    setLoading(true);
    const { ok, data } = await callFunction({ action: "list" });
    if (!ok) {
      toast({
        title: "Couldn't load admin users",
        description: data.error,
        variant: "destructive",
      });
    } else {
      setAdmins(data.admins ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadAdmins();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail) return;
    setAdding(true);

    const { ok, data } = await callFunction({
      action: "add",
      email: newEmail,
      name: newName || null,
    });

    if (!ok) {
      toast({
        title: "Couldn't add admin",
        description: data.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Admin added",
        description: `${newEmail} can now log in with a magic link.`,
      });
      setNewEmail("");
      setNewName("");
      loadAdmins();
    }
    setAdding(false);
  };

  const confirmRemove = async () => {
    if (!removingAdmin) return;
    setRemoving(true);

    const { ok, data } = await callFunction({
      action: "remove",
      admin_user_id: removingAdmin.id,
    });

    if (!ok) {
      toast({
        title: "Couldn't remove admin",
        description: data.error,
        variant: "destructive",
      });
    } else {
      toast({
        title: "Admin removed",
        description: `${removingAdmin.email} no longer has admin access.`,
      });
      loadAdmins();
    }
    setRemoving(false);
    setRemovingAdmin(null);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold font-serif text-primary mb-2">
          Admin Users
        </h2>
        <p className="text-sm text-foreground/60">
          Anyone added here gets full access to everything in this dashboard —
          enrollments, pricing, and other admins. Removing someone only revokes
          their admin access; it doesn't delete their account. You can't remove
          your own admin access — have another admin do it.
        </p>
      </div>

      <form
        onSubmit={handleAdd}
        className="flex flex-col sm:flex-row gap-3 items-end bg-secondary p-4 rounded-xl border border-border/50"
      >
        <div className="space-y-2 flex-1">
          <Label htmlFor="new-admin-email">Email</Label>
          <Input
            id="new-admin-email"
            type="email"
            placeholder="staff@midwestchristianacademy.com"
            className="bg-background"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
        </div>
        <div className="space-y-2 flex-1">
          <Label htmlFor="new-admin-name">Name (optional)</Label>
          <Input
            id="new-admin-name"
            placeholder="Full name"
            className="bg-background"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
        </div>
        <Button type="submit" disabled={adding || !newEmail}>
          {adding ? "Adding..." : "Add Admin"}
        </Button>
      </form>

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-3">Name</th>
                <th className="p-3">Email</th>
                <th className="p-3">Added</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-t border-border/50">
                  <td className="p-3">
                    {a.name ?? "—"}
                    {a.is_self && (
                      <span className="text-foreground/50"> (you)</span>
                    )}
                  </td>
                  <td className="p-3">{a.email}</td>
                  <td className="p-3">
                    {new Date(a.created_at).toLocaleDateString()}
                  </td>
                  <td className="p-3">
                    {!a.is_self && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setRemovingAdmin(a)}
                      >
                        Remove
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
              {admins.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    className="p-3 text-center text-foreground/60"
                  >
                    No admins found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AlertDialog
        open={!!removingAdmin}
        onOpenChange={(open) => !open && setRemovingAdmin(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removingAdmin?.email} as an admin?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They'll lose access to this entire dashboard immediately. Their
              login account itself isn't deleted — they just won't be recognized
              as an admin anymore.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove} disabled={removing}>
              {removing ? "Removing..." : "Confirm Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AdminUsers;
