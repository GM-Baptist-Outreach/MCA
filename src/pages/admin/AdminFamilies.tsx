import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabaseClient";
import { Input } from "@/components/ui/input";
import { ChevronRight } from "lucide-react";

interface FamilyRow {
  id: string;
  parent_name: string;
  second_parent_name: string | null;
  email: string;
  phone: string;
  student_count: number;
  active_enrollment_count: number;
}

const AdminFamilies = () => {
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("families")
        .select(
          `
          id, parent_name, second_parent_name, email, phone,
          students ( id, enrollments ( id, status ) )
        `,
        )
        .order("parent_name");

      if (!error && data) {
        const rows: FamilyRow[] = data.map((f: any) => {
          const students = f.students ?? [];
          const activeCount = students.reduce(
            (sum: number, s: any) =>
              sum +
              (s.enrollments?.filter((e: any) => e.status === "active")
                .length ?? 0),
            0,
          );
          return {
            id: f.id,
            parent_name: f.parent_name,
            second_parent_name: f.second_parent_name,
            email: f.email,
            phone: f.phone,
            student_count: students.length,
            active_enrollment_count: activeCount,
          };
        });
        setFamilies(rows);
      }
      setLoading(false);
    };
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return families;
    return families.filter((f) =>
      [f.parent_name, f.second_parent_name, f.email, f.phone]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term),
    );
  }, [families, search]);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold font-serif text-primary">Families</h2>

      <Input
        placeholder="Search parent name, email, phone..."
        className="bg-background max-w-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {loading ? (
        <p className="text-foreground/60">Loading...</p>
      ) : (
        <div className="rounded-xl border border-border/50 overflow-x-auto" data-tour="admin-families-list">
          <table className="w-full text-sm">
            <thead className="bg-secondary text-left">
              <tr>
                <th className="p-3">Parent(s)</th>
                <th className="p-3">Email</th>
                <th className="p-3">Phone</th>
                <th className="p-3">Students</th>
                <th className="p-3">Active Enrollments</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((f, i) => (
                <tr
                  key={f.id}
                  className="border-t border-border/50 hover:bg-secondary/30"
                >
                  <td className="p-3">
                    {f.parent_name}
                    {f.second_parent_name && ` & ${f.second_parent_name}`}
                  </td>
                  <td className="p-3">{f.email}</td>
                  <td className="p-3">{f.phone}</td>
                  <td className="p-3">{f.student_count}</td>
                  <td className="p-3">{f.active_enrollment_count}</td>
                  <td className="p-3">
                    <Link
                      to={`/admin/families/${f.id}`}
                      className="flex items-center gap-1 text-primary hover:underline"
                      data-tour={i === 0 ? "admin-family-view" : undefined}
                    >
                      View <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="p-3 text-center text-foreground/60"
                  >
                    {families.length === 0
                      ? "No families yet."
                      : "No families match your search."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AdminFamilies;
