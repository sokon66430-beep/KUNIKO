"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, ArrowDown, LayoutGrid, Save, RotateCcw, GripVertical } from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { PageHeader, Card, Spinner, ErrorBox } from "@/components/ui";
import { MENU_GROUPS_DATA } from "@/components/Sidebar";

type Item = { href: string; label: string };
type Group = { label: string; items: Item[] };
type SavedLayout = { group: string; hrefs: string[] }[];

const BY_HREF: Record<string, Item> = Object.fromEntries(MENU_GROUPS_DATA.flatMap((g) => g.items).map((i) => [i.href, i]));

// Seed the editable layout from what's saved (or the defaults), appending any
// function not placed anywhere into its default section.
function seed(saved?: SavedLayout): Group[] {
  if (!saved || !saved.length) return MENU_GROUPS_DATA.map((g) => ({ label: g.label, items: [...g.items] }));
  const groups: Group[] = saved.map((g) => ({ label: g.group, items: g.hrefs.map((h) => BY_HREF[h]).filter(Boolean) }));
  const placed = new Set(saved.flatMap((g) => g.hrefs));
  for (const dg of MENU_GROUPS_DATA) {
    for (const it of dg.items) {
      if (placed.has(it.href)) continue;
      let grp = groups.find((g) => g.label === dg.label);
      if (!grp) { grp = { label: dg.label, items: [] }; groups.push(grp); }
      grp.items.push(it);
      placed.add(it.href);
    }
  }
  return groups;
}

export default function MenuLayoutPage() {
  const role = useRole();
  const { data, loading, error } = useFetch<{ menuLayout?: SavedLayout }>("/api/business");
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [overGroup, setOverGroup] = useState<string | null>(null);
  const drag = useRef<{ from: string; href: string } | null>(null);

  useEffect(() => {
    if (!data || groups) return;
    setGroups(seed(data.menuLayout));
  }, [data, groups]);

  // Move a function to a section at an index (index null = append to the end).
  function move(from: string, href: string, to: string, index: number | null) {
    setGroups((gs) => {
      if (!gs) return gs;
      const copy = gs.map((g) => ({ ...g, items: [...g.items] }));
      const src = copy.find((g) => g.label === from);
      const dst = copy.find((g) => g.label === to);
      if (!src || !dst) return gs;
      const fromIdx = src.items.findIndex((i) => i.href === href);
      if (fromIdx < 0) return gs;
      const [item] = src.items.splice(fromIdx, 1);
      let idx = index == null ? dst.items.length : index;
      if (from === to && fromIdx < idx) idx -= 1; // account for the removal
      dst.items.splice(Math.max(0, Math.min(idx, dst.items.length)), 0, item);
      return copy;
    });
    setSaved(false);
  }

  function nudge(groupLabel: string, i: number, dir: -1 | 1) {
    const g = groups?.find((x) => x.label === groupLabel);
    if (!g) return;
    const j = i + dir;
    if (j < 0 || j >= g.items.length) return;
    move(groupLabel, g.items[i].href, groupLabel, dir === 1 ? j + 1 : j);
  }

  function resetDefault() {
    setGroups(MENU_GROUPS_DATA.map((g) => ({ label: g.label, items: [...g.items] })));
    setSaved(false);
  }

  async function save() {
    if (!groups) return;
    setBusy(true);
    try {
      const menuLayout: SavedLayout = groups.map((g) => ({ group: g.label, hrefs: g.items.map((i) => i.href) }));
      await api("/api/business", { method: "PATCH", body: JSON.stringify({ menuLayout }) });
      setSaved(true);
      setTimeout(() => window.location.reload(), 500); // sidebar picks up the new layout
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
        subtitle="Drag any function to reorder it — or drop it into another section. Use the arrows for fine moves. Applies to everyone in this store."
        actions={
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={resetDefault}>
              <RotateCcw size={15} /> Reset
            </button>
            <button className="btn-primary" disabled={busy} onClick={save}>
              <Save size={16} /> {busy ? "Saving…" : saved ? "Saved ✓" : "Save layout"}
            </button>
          </div>
        }
      />

      <div className="grid gap-5 sm:grid-cols-2">
        {groups.map((g) => (
          <Card
            key={g.label}
            title={g.label}
            icon={<LayoutGrid size={15} />}
            className={overGroup === g.label ? "ring-2 ring-brand-300" : undefined}
          >
            <div
              className="min-h-[3rem] space-y-1.5"
              onDragOver={(e) => {
                e.preventDefault();
                setOverGroup(g.label);
              }}
              onDragLeave={() => setOverGroup((o) => (o === g.label ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOverGroup(null);
                if (drag.current) move(drag.current.from, drag.current.href, g.label, null);
                drag.current = null;
              }}
            >
              {g.items.length === 0 && (
                <p className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400">
                  Drop a function here
                </p>
              )}
              {g.items.map((it, i) => (
                <div
                  key={it.href}
                  draggable
                  onDragStart={() => (drag.current = { from: g.label, href: it.href })}
                  onDragEnd={() => (drag.current = null)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setOverGroup(null);
                    if (drag.current) move(drag.current.from, drag.current.href, g.label, i);
                    drag.current = null;
                  }}
                  className="flex cursor-grab items-center gap-2 rounded-xl bg-slate-50 px-2.5 py-2 ring-1 ring-slate-200 transition hover:ring-slate-300 active:cursor-grabbing"
                >
                  <GripVertical size={15} className="shrink-0 text-slate-300" />
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-white text-[11px] font-bold text-slate-500 ring-1 ring-slate-200">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink-800">{it.label}</span>
                  <button
                    onClick={() => nudge(g.label, i, -1)}
                    disabled={i === 0}
                    title="Move up"
                    className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowUp size={15} />
                  </button>
                  <button
                    onClick={() => nudge(g.label, i, 1)}
                    disabled={i === g.items.length - 1}
                    title="Move down"
                    className="grid h-7 w-7 place-items-center rounded-lg text-slate-500 transition hover:bg-white hover:text-ink-900 disabled:cursor-not-allowed disabled:opacity-30"
                  >
                    <ArrowDown size={15} />
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
