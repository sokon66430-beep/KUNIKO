"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Check } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import type { Role } from "@/lib/auth";
import { PageHeader, Card, Spinner, ErrorBox } from "@/components/ui";

type PermissionsResponse = {
  roles: Role[];
  pages: { href: string; label: string }[];
  permissions: Partial<Record<Role, string[]>>;
};

const ROLE_LABEL: Record<string, string> = {
  area_manager: "Area Manager",
  manager: "Manager",
  accountant: "Accountant",
  procurement: "Procurement",
  operations: "Operations",
};

export default function PermissionsPage() {
  const { data, loading, error } = useFetch<PermissionsResponse>("/api/permissions");
  // Local mirror of { role: deniedHrefs[] } so a toggle flips instantly
  // instead of waiting on the next background refetch.
  const [denied, setDenied] = useState<Partial<Record<Role, string[]>> | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // `${role}:${href}` in flight

  useEffect(() => {
    if (data && !denied) setDenied(data.permissions);
  }, [data, denied]);

  if (loading && !denied) return <Spinner label="Loading permissions…" />;
  if (error) return <ErrorBox message={error} />;
  if (!data || !denied) return null;

  async function toggle(role: Role, href: string, currentlyAllowed: boolean) {
    const key = `${role}:${href}`;
    setSaving(key);
    const prev = denied![role] ?? [];
    const next = currentlyAllowed ? Array.from(new Set([...prev, href])) : prev.filter((h) => h !== href);
    setDenied((d) => ({ ...(d as any), [role]: next }));
    try {
      await api("/api/permissions", {
        method: "PATCH",
        body: JSON.stringify({ role, href, allowed: !currentlyAllowed }),
      });
    } catch (e: any) {
      // Revert on failure.
      setDenied((d) => ({ ...(d as any), [role]: prev }));
      alert(e.message);
    } finally {
      setSaving(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Permissions"
        subtitle="Control which functions each role can see and use. The owner always has full access."
      />

      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              <th className="sticky left-0 z-10 bg-slate-50/70 px-5 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                Function
              </th>
              {data.roles.map((role) => (
                <th
                  key={role}
                  className="px-3 py-3 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"
                >
                  {ROLE_LABEL[role] || role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.pages.map((page) => (
              <tr key={page.href} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/40">
                <td className="sticky left-0 z-10 bg-white px-5 py-3 font-medium text-ink-800">{page.label}</td>
                {data.roles.map((role) => {
                  const isDenied = (denied[role] ?? []).includes(page.href);
                  const key = `${role}:${page.href}`;
                  const busy = saving === key;
                  return (
                    <td key={role} className="px-3 py-3 text-center">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => toggle(role, page.href, !isDenied)}
                        title={
                          isDenied
                            ? `${ROLE_LABEL[role] || role} cannot use ${page.label} — click to allow`
                            : `${ROLE_LABEL[role] || role} can use ${page.label} — click to deny`
                        }
                        className={`mx-auto grid h-6 w-6 place-items-center rounded-md border transition disabled:opacity-50 ${
                          isDenied
                            ? "border-slate-200 bg-white hover:border-slate-300"
                            : "border-brand-600 bg-brand-600 hover:bg-brand-700"
                        }`}
                      >
                        {!isDenied && <Check size={14} className="text-white" />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="mt-4 flex items-start gap-2 text-xs text-slate-400">
        <ShieldCheck size={14} className="mt-0.5 shrink-0" />
        Dashboard is always available to every signed-in role, so there's always somewhere safe to land.
      </p>
    </div>
  );
}
