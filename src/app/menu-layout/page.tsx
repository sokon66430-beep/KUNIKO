"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUp, ArrowDown, LayoutGrid, Save, RotateCcw } from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { PageHeader, Card, Spinner, ErrorBox } from "@/components/ui";
import { MENU_GROUPS_DATA } from "@/components/Sidebar";

type Item = { href: string; label: string };
type Group = { label: string; items: Item[] };

// Apply a saved order (list of hrefs) within a group: listed first in that
// order, the rest keep their default position after.
function applyOrder(items: Item[], order: string[]): Item[] {
  if (!order.length) return items;
  const idx = (h: string) => {
    const i = order.indexOf(h);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return items.map((it, i) => ({ it, i })).sort((a, b) => idx(a.it.href) - idx(b.it.href) || a.i - b.i).map((x) => x.it);
}

export default function MenuLayoutPage() {
  const role = useRole();
  const { data, loading, error } = useFetch<{ menuOrder?: string[] }>("/api/business");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // Seed local groups from the saved order once business loads.
  useEffect(() => {
    if (!data || groups) return;
    const order = Array.isArray(data.menuOrder) ? data.menuOrder : [];
    setGroups(MENU_GROUPS_DATA.map((g) => ({ label: g.label, items: applyOrder(g.items, order) })));
  }, [data, groups]);

  const flatOrder = useMemo(() => (groups ? groups.flatMap((g) => g.items.map((i) => i.href)) : []), [groups]);

  function move(groupLabel: string, index: number, dir: -1 | 1) {
    setGroups((gs) =>
      (gs || []).map((g) => {
        if (g.label !== groupLabel) return g;
        const items = [...g.items];
        const j = index + dir;
        if (j < 0 || j >= items.length) return g;
        [items[index], items[j]] = [items[j], items[index]];
        return { ...g, items };
      }),
    );
    setSaved(false);
  }

  function resetDefault() {
    setGroups(MENU_GROUPS_DATA.map((g) => ({ label: g.label, items: [...g.items] })));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    try {
      await api("/api/business", { method: "PATCH", body: JSON.stringify({ menuOrder: flatOrder }) });
      setSaved(true);
      // Reload so the sidebar picks up the new order right away.
      setTimeout(() => window.location.reload(), 500);
    } catch (e: any) {
      alert(e.message);
      setBusy(false);
    }
  }

  if (role && role !== "owner") {
    return (
      <div>
        <PageHeader title="Menu Layout" subtitle="Owner only" />
        <ErrorBox message="Only the owner can rearrange the menu." />
      </div>
    );
  }
  if (loading && !groups) return <Spinner label="Loading…" />;
  if (error) return <ErrorBox message={error} />;
  if (!groups) return null;

  return (
    <div>
      <PageHeader
        title="Menu Layout"
        subtitle="Arrange the sidebar — move any function up or down within its section. The order applies to everyone in this store."
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={resetDefault}>
              <RotateCcw size={15} /> Reset
            </button>
            <button className="btn-primary" disabled={busy} onClick={save}>
              <Save size={16} /> {busy ? "Saving…" : saved ? "Saved ✓" : "Save order"}
            </button>
          </div>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((g) => (
          <Card key={g.label} title={g.label} icon={<LayoutGrid size={15} />}>
            <div className="space-y-1.5">
              {g.items.map((it, i) => (
                <div key={it.href} className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{it.label}</span>
                  <button
                    onClick={() => move(g.label, i, -1)}
                    disabled={i === 0}
                    title="Move up"
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    onClick={() => move(g.label, i, 1)}
                    disabled={i === g.items.length - 1}
                    title="Move down"
                    className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowDown size={16} />
                  </button>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
