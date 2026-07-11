"use client";

import { useState } from "react";
import type { Supplier } from "@/lib/types";
import { Modal } from "@/components/ui";

export const EMPTY_SUPPLIER: Partial<Supplier> = {
  code: "",
  name: "",
  address: "",
  city: "",
  country: "",
  contactPerson: "",
  phone: "",
  email: "",
  deliverySchedule: "",
  leadTime: 0,
  minOrderAmount: 0,
  taxId: "",
  taxPct: 10,
};

export function SupplierModal({
  initial,
  isNew,
  busy,
  onClose,
  onSave,
}: {
  initial: Partial<Supplier>;
  isNew: boolean;
  busy: boolean;
  onClose: () => void;
  onSave: (s: Partial<Supplier>) => void;
}) {
  const [form, setForm] = useState<Partial<Supplier>>(initial);
  const set = (k: keyof Supplier, v: any) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Add Supplier" : `Edit Supplier — ${initial.name}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !form.name} onClick={() => onSave(form)}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Supplier name</label>
          <input className="input" autoFocus value={form.name || ""} onChange={(e) => set("name", e.target.value)} />
        </div>
        {isNew && (
          <div>
            <label className="label">Code</label>
            <input
              className="input"
              placeholder="auto"
              value={form.code || ""}
              onChange={(e) => set("code", e.target.value)}
            />
          </div>
        )}
        <div>
          <label className="label">Contact person</label>
          <input className="input" value={form.contactPerson || ""} onChange={(e) => set("contactPerson", e.target.value)} />
        </div>
        <div>
          <label className="label">Phone</label>
          <input className="input" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} />
        </div>
        <div>
          <label className="label">Email</label>
          <input className="input" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
        </div>
        <div>
          <label className="label">Delivery day</label>
          <input
            className="input"
            placeholder="e.g. TUE"
            value={form.deliverySchedule || ""}
            onChange={(e) => set("deliverySchedule", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Lead time (days)</label>
          <input className="input" type="number" value={form.leadTime ?? 0} onChange={(e) => set("leadTime", e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="label">Address</label>
          <input className="input" value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
        </div>
        <div>
          <label className="label">City</label>
          <input className="input" value={form.city || ""} onChange={(e) => set("city", e.target.value)} />
        </div>
        <div>
          <label className="label">Tax ID</label>
          <input className="input" value={form.taxId || ""} onChange={(e) => set("taxId", e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
