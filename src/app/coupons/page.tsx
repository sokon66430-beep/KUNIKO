"use client";

import { useMemo, useState } from "react";
import { Ticket, Plus, Ban, Play, Printer } from "lucide-react";
import { useFetch, api, useRole } from "@/lib/client";
import { canManagePromotions } from "@/lib/access";
import { PageHeader, Card, Spinner, ErrorBox, Badge, Table, THead, Th, TBody, Tr, Td, EmptyState, Modal } from "@/components/ui";
import { Select } from "@/components/Select";
import { usd } from "@/lib/format";
import { couponDetail, couponStatus, type CouponStatus } from "@/lib/coupons";
import { storeToday } from "@/lib/storetime";
import type { Coupon } from "@/lib/types";

// ---------------------------------------------------------------------------
// Coupons — the vouchers customers bring in.
//
// Two shapes, one screen, because a shop thinks of them as one thing:
//   a CAMPAIGN — one code printed on a thousand leaflets, used over and over
//   a VOUCHER BOOK — many one-time codes, each good for a single customer
// The difference is the "used once" switch and how many are made.
//
// A supplier's coupon that already has a barcode is entered with that code, so
// the paper the customer is holding is the paper that works.
// ---------------------------------------------------------------------------

const TONE: Record<CouponStatus, "emerald" | "amber" | "rose" | "slate"> = {
  Active: "emerald",
  Scheduled: "amber",
  Expired: "slate",
  Used: "slate",
  Stopped: "rose",
};

export default function CouponsPage() {
  const role = useRole();
  const canEdit = role ? canManagePromotions(role) : false;
  const { data, loading, error, reload } = useFetch<{ coupons: Coupon[] }>("/api/coupons");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [made, setMade] = useState<Coupon[] | null>(null);

  const today = storeToday();
  const [form, setForm] = useState({
    name: "",
    kind: "amount" as "amount" | "percent",
    discountAmount: "",
    discountPercent: "",
    maxDiscount: "",
    minSpend: "",
    startDate: today,
    endDate: today,
    singleUse: "yes" as "yes" | "no",
    count: "1",
    code: "",
  });
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const coupons = data?.coupons ?? [];
  const summary = useMemo(() => {
    const live = coupons.filter((c) => couponStatus(c, today) === "Active").length;
    const used = coupons.filter((c) => c.timesUsed > 0).length;
    return { total: coupons.length, live, used };
  }, [coupons, today]);

  async function create() {
    setBusy(true);
    setErr(null);
    try {
      const res = await api<{ coupons: Coupon[] }>("/api/coupons", {
        method: "POST",
        body: JSON.stringify({
          name: form.name,
          discountAmount: form.kind === "amount" ? Number(form.discountAmount) : 0,
          discountPercent: form.kind === "percent" ? Number(form.discountPercent) : 0,
          maxDiscount: Number(form.maxDiscount) || 0,
          minSpend: Number(form.minSpend) || 0,
          startDate: form.startDate,
          endDate: form.endDate,
          singleUse: form.singleUse === "yes",
          count: Number(form.count) || 1,
          code: form.code.trim() || undefined,
        }),
      });
      setOpen(false);
      setMade(res.coupons); // straight to the printable sheet — they're no use unprinted
      reload();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(c: Coupon) {
    try {
      await api("/api/coupons", { method: "PATCH", body: JSON.stringify({ id: c.id, active: !c.active }) });
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Coupons"
        subtitle="Vouchers a customer hands over. The cashier scans the barcode at the till — no code to type and no manager needed."
        actions={
          canEdit && (
            <button onClick={() => setOpen(true)} className="btn-primary">
              <Plus size={16} /> New coupon
            </button>
          )
        }
      />

      {error && <ErrorBox message={error} />}

      {loading && !data ? (
        <Spinner label="Loading coupons…" />
      ) : coupons.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Ticket size={22} />}
            title="No coupons yet"
            hint="Make one for a $1-off leaflet or a book of one-time vouchers. Stookii prints the barcode; scanning it at the till takes the money off automatically."
            action={
              canEdit && (
                <button onClick={() => setOpen(true)} className="btn-primary">
                  <Plus size={16} /> New coupon
                </button>
              )
            }
          />
        </Card>
      ) : (
        <Card>
          <p className="mb-3 text-[12px] text-slate-500">
            {summary.total} coupons · {summary.live} usable today · {summary.used} redeemed
          </p>
          <Table>
            <THead>
              <Tr>
                <Th>Barcode</Th>
                <Th>Name</Th>
                <Th>Worth</Th>
                <Th>Valid</Th>
                <Th>Used</Th>
                <Th>Status</Th>
                <Th> </Th>
              </Tr>
            </THead>
            <TBody>
              {coupons.map((c) => {
                const status = couponStatus(c, today);
                return (
                  <Tr key={c.id}>
                    <Td>
                      <span className="font-mono text-[12.5px] font-semibold">{c.code}</span>
                    </Td>
                    <Td>{c.name}</Td>
                    <Td>
                      {couponDetail(c)}
                      {c.minSpend ? <span className="block text-[11px] text-slate-400">min {usd(c.minSpend)}</span> : null}
                    </Td>
                    <Td>
                      <span className="text-[12px]">
                        {c.startDate} → {c.endDate}
                      </span>
                    </Td>
                    <Td>
                      {c.timesUsed}
                      {c.singleUse ? <span className="text-slate-400"> / 1</span> : null}
                    </Td>
                    <Td>
                      <Badge tone={TONE[status]}>{status}</Badge>
                    </Td>
                    <Td>
                      {canEdit && (
                        <button onClick={() => toggle(c)} className="btn-ghost text-[12px]" title={c.active ? "Stop it" : "Start it again"}>
                          {c.active ? <Ban size={14} /> : <Play size={14} />}
                        </button>
                      )}
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title="New coupon">
        {err && <ErrorBox message={err} />}
        <div className="space-y-3">
          <div>
            <label className="label">Name</label>
            <input
              className="input"
              value={form.name}
              placeholder="e.g. New Year $1 off"
              onChange={(e) => set({ name: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-slate-400">What the cashier sees when it&apos;s scanned.</p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Takes off</label>
              <Select
                value={form.kind}
                onChange={(v) => set({ kind: v as "amount" | "percent" })}
                options={[
                  { value: "amount", label: "An amount ($)" },
                  { value: "percent", label: "A percentage (%)" },
                ]}
              />
            </div>
            <div>
              <label className="label">{form.kind === "amount" ? "Dollars off" : "Percent off"}</label>
              <input
                className="input"
                inputMode="decimal"
                value={form.kind === "amount" ? form.discountAmount : form.discountPercent}
                onChange={(e) =>
                  form.kind === "amount"
                    ? set({ discountAmount: e.target.value })
                    : set({ discountPercent: e.target.value })
                }
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {form.kind === "percent" && (
              <div>
                <label className="label">Never more than ($)</label>
                <input
                  className="input"
                  inputMode="decimal"
                  value={form.maxDiscount}
                  placeholder="optional"
                  onChange={(e) => set({ maxDiscount: e.target.value })}
                />
                <p className="mt-1 text-[11px] text-slate-400">Caps a big basket. Leave empty for no cap.</p>
              </div>
            )}
            <div>
              <label className="label">Basket must reach ($)</label>
              <input
                className="input"
                inputMode="decimal"
                value={form.minSpend}
                placeholder="optional"
                onChange={(e) => set({ minSpend: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">First day</label>
              <input type="date" className="input" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} />
            </div>
            <div>
              <label className="label">Last day</label>
              <input type="date" className="input" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Can it be used more than once?</label>
              <Select
                value={form.singleUse}
                onChange={(v) => set({ singleUse: v as "yes" | "no" })}
                options={[
                  { value: "yes", label: "One customer, once only" },
                  { value: "no", label: "Reusable — one code for everyone" },
                ]}
              />
              <p className="mt-1 text-[11px] leading-snug text-slate-400">
                {form.singleUse === "yes"
                  ? "Each printed voucher works exactly once, then the till refuses it."
                  : "The same barcode on every leaflet, used as many times as you like."}
              </p>
            </div>
            <div>
              <label className="label">How many to make</label>
              <input
                className="input"
                inputMode="numeric"
                value={form.count}
                disabled={form.singleUse === "no" || !!form.code.trim()}
                onChange={(e) => set({ count: e.target.value.replace(/\D/g, "") })}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                {form.singleUse === "no" ? "A reusable coupon is one code." : "Each gets its own barcode. Up to 500."}
              </p>
            </div>
          </div>

          <div>
            <label className="label">Barcode already printed on the coupon</label>
            <input
              className="input font-mono"
              value={form.code}
              placeholder="Leave empty and Stookii makes one"
              onChange={(e) => set({ code: e.target.value, count: e.target.value.trim() ? "1" : form.count })}
            />
            <p className="mt-1 text-[11px] leading-snug text-slate-400">
              For a supplier&apos;s coupon that already has a barcode — type it here and the till will recognise that paper.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
            <button onClick={create} disabled={busy} className="btn-primary">
              {busy ? "Making…" : "Make coupon"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Straight to a printable sheet: a coupon that exists only in the system
          is no use to anybody — it has to end up on paper in a customer's hand. */}
      <Modal open={!!made} onClose={() => setMade(null)} title={`${made?.length ?? 0} coupon${made?.length === 1 ? "" : "s"} ready`}>
        <p className="mb-3 text-[12.5px] text-slate-500">
          Print these and hand them out. The number under each barcode is what the till reads.
        </p>
        <div className="max-h-72 overflow-auto rounded-xl border border-slate-200 p-3" id="coupon-sheet">
          <div className="grid grid-cols-2 gap-3">
            {(made || []).map((c) => (
              <div key={c.id} className="rounded-lg border border-dashed border-slate-300 p-3 text-center">
                <p className="text-[12px] font-bold text-ink-900">{c.name}</p>
                <p className="text-[11px] text-slate-500">{couponDetail(c)}</p>
                <p className="mt-2 font-mono text-[15px] font-extrabold tracking-widest text-ink-900">{c.code}</p>
                <p className="text-[10px] text-slate-400">
                  {c.startDate} → {c.endDate}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button onClick={() => setMade(null)} className="btn-ghost">
            Done
          </button>
          <button onClick={() => window.print()} className="btn-primary">
            <Printer size={15} /> Print
          </button>
        </div>
      </Modal>
    </div>
  );
}
