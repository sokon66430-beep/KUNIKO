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
  owner: "Owner",
  management: "Management",
  ops_manager: "Operation Manager",
  area_manager: "Area Manager",
  store_manager: "Store Manager",
  asst_store_manager: "Asst. Store Manager",
  store_crew: "Store Crew",
  manager: "Manager",
  accountant: "Accountant",
  procurement: "Procurement",
  operations: "Operations",
};

// Leadership roles that always have full access — shown as fixed, all-on columns
// (not toggleable). Owner has full control; Management (CEO/Board) sees every
// function but is view-only, so its access can't be restricted either.
const FIXED_ROLES: { role: Role; label: string; note: string }[] = [
  { role: "owner", label: "Owner", note: "Full access" },
  { role: "management", label: "Management", note: "View-only · sees all" },
];

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

      {/* The card is the scroll area (both directions), so the header row can
          stay frozen on top and the Function column frozen on the left. */}
      <Card className="max-h-[calc(100vh-14rem)] overflow-auto !p-0">
        {/* border-separate (not collapse) — sticky headers glitch inside a
            border-collapse table, so each cell carries its own bottom border. */}
        <table className="w-full min-w-[720px] border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-30 border-b border-slate-100 bg-slate-50 px-5 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">
                Function
              </th>
              {FIXED_ROLES.map((f) => (
                <th
                  key={f.role}
                  className="sticky top-0 z-20 border-b border-slate-100 bg-slate-50 px-3 py-3 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"
                >
                  {f.label}
                  <span className="mt-0.5 block text-[9px] font-semibold normal-case tracking-normal text-slate-400">{f.note}</span>
                </th>
              ))}
              {data.roles.map((role) => (
                <th
                  key={role}
                  className="sticky top-0 z-20 border-b border-slate-100 bg-slate-50 px-3 py-3 text-center text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500"
                >
                  {ROLE_LABEL[role] || role}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.pages.map((page) => (
              <tr key={page.href} className="hover:bg-slate-50/40">
                <td className="sticky left-0 z-10 border-b border-slate-50 bg-white px-5 py-3 font-medium text-ink-800">
                  {page.label}
                </td>
                {FIXED_ROLES.map((f) => (
                  <td key={f.role} className="border-b border-slate-50 px-3 py-3 text-center">
                    <span
                      title={`${f.label} always has access to every function`}
                      className="mx-auto grid h-6 w-6 cursor-not-allowed place-items-center rounded-md border border-brand-200 bg-brand-100"
                    >
                      <Check size={14} className="text-brand-500" />
                    </span>
                  </td>
                ))}
                {data.roles.map((role) => {
                  const isDenied = (denied[role] ?? []).includes(page.href);
                  const key = `${role}:${page.href}`;
                  const busy = saving === key;
                  return (
                    <td key={role} className="border-b border-slate-50 px-3 py-3 text-center">
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
        Owner and Management always have full access (Management is view-only), so their columns can&apos;t be
        changed. Dashboard is always available to every signed-in role, so there&apos;s always somewhere safe to land.
      </p>
    </div>
  );
}
