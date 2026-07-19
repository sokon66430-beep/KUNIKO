"use client";

// A small manager-code prompt. Verifies the code against /api/verify-manager
// (store manager / assistant / owner) and calls onOk when it's accepted. Used to
// gate device actions like entering or leaving Till Mode.

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/client";
import { Modal } from "@/components/ui";

export function ManagerGate({
  title,
  hint,
  actionLabel,
  onOk,
  onClose,
}: {
  title: string;
  hint: string;
  actionLabel: string;
  onOk: (mgr: { name: string }) => void;
  onClose: () => void;
}) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function go() {
    if (!code.trim()) return;
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ ok: boolean; name: string }>("/api/verify-manager", {
        method: "POST",
        body: JSON.stringify({ code }),
      });
      onOk({ name: r.name });
    } catch (e: any) {
      setErr(e.message || "Manager code not recognised.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={title}
      footer={
        <div className="flex w-full justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !code.trim()} onClick={go}>
            <ShieldCheck size={16} /> {busy ? "Checking…" : actionLabel}
          </button>
        </div>
      }
    >
      <p className="mb-3 text-sm text-slate-500">{hint}</p>
      <label className="label">Manager code</label>
      <input
        type="password"
        className="input tracking-widest"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder="Enter manager code"
        autoFocus
      />
      {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{err}</p>}
    </Modal>
  );
}
