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
  ownerOnly,
  codeLabel = "Manager code",
  verify,
  onOk,
  onClose,
}: {
  title: string;
  hint: string;
  actionLabel: string;
  ownerOnly?: boolean; // require the OWNER's password rather than any manager
  codeLabel?: string;
  // Optional override: instead of just checking the code against
  // /api/verify-manager, run the guarded action itself with the code (e.g.
  // verify-and-delete in one call). Throw to show the message inline.
  verify?: (code: string) => Promise<{ name?: string } | void>;
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
      if (verify) {
        const r = await verify(code);
        onOk({ name: r?.name || "Manager" });
      } else {
        const r = await api<{ ok: boolean; name: string }>("/api/verify-manager", {
          method: "POST",
          body: JSON.stringify({ code, ownerOnly: !!ownerOnly }),
        });
        onOk({ name: r.name });
      }
    } catch (e: any) {
      setErr(e.message || "Not recognised.");
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
      <label className="label">{codeLabel}</label>
      <input
        type="password"
        className="input tracking-widest"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && go()}
        placeholder={`Enter ${codeLabel.toLowerCase()}`}
        autoFocus
      />
      {err && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-600">{err}</p>}
    </Modal>
  );
}
