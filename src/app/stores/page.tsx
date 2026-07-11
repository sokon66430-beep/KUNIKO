"use client";

import { useState } from "react";
import { Building2, Users, Plus, Store as StoreIcon, Trash2 } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { canManageStaff } from "@/lib/access";
import type { Role } from "@/lib/auth";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { num, shortDate } from "@/lib/format";

type StoreRow = { id: string; name: string; createdAt: string; users: number };
type UserRow = { id: string; username: string; name: string; role: string; storeId: string; storeName: string };

const ROLE_TONE: Record<string, "brand" | "violet" | "amber" | "emerald" | "rose" | "gold"> = {
  owner: "violet",
  area_manager: "rose",
  manager: "gold",
  accountant: "emerald",
  procurement: "brand",
  operations: "amber",
};
const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  area_manager: "Area Manager",
  manager: "Manager",
  accountant: "Accountant",
  procurement: "Procurement",
  operations: "Operations",
};

export default function StoresPage() {
  const { data: stores, loading, error, reload } = useFetch<StoreRow[]>("/api/stores");
  const { data: users, reload: reloadUsers } = useFetch<UserRow[]>("/api/users");
  const { data: session } = useFetch<{ user: { id: string; role: string } }>("/api/auth/session");
  const [addingStore, setAddingStore] = useState(false);
  const [addingUser, setAddingUser] = useState(false);

  const storeList = stores || [];
  const userList = users || [];
  // Creating a new store is reserved for the owner (the server enforces this too).
  const role = (session?.user.role || "operations") as Role;
  const isOwner = role === "owner";
  const canManage = canManageStaff(role); // owner / manager / area manager may remove staff
  const myId = session?.user.id;

  async function removeUser(u: UserRow) {
    if (
      !(await confirmDialog({
        title: "Remove employee",
        message: `Remove ${u.name} (@${u.username})? They will no longer be able to sign in.`,
        confirmText: "Remove",
      }))
    )
      return;
    try {
      await api(`/api/users/${u.id}`, { method: "DELETE" });
      reloadUsers();
      reload();
    } catch (e: any) {
      alert(e.message);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stores & Employees"
        subtitle="Manage every store location and the employees who can sign in — accountant, procurement, operations"
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setAddingUser(true)}>
              <Users size={18} /> Add Employee
            </button>
            {isOwner && (
              <button className="btn-primary" onClick={() => setAddingStore(true)}>
                <Plus size={18} /> Add Store
              </button>
            )}
          </div>
        }
      />

      {error && <ErrorBox message={error} />}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard label="Stores" value={num(storeList.length)} icon={<Building2 size={18} />} accent="brand" />
        <StatCard label="Employees" value={num(userList.length)} icon={<Users size={18} />} accent="violet" />
        <StatCard
          label="Owners"
          value={num(userList.filter((u) => u.role === "owner").length)}
          icon={<StoreIcon size={18} />}
          accent="amber"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Stores */}
        <Card className="p-0">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-sm font-bold text-ink-900">Stores</h3>
          </div>
          {loading ? (
            <Spinner label="Loading…" />
          ) : storeList.length === 0 ? (
            <EmptyState title="No stores" />
          ) : (
            <ul className="divide-y divide-slate-50">
              {storeList.map((s) => (
                <li key={s.id} className="flex items-center justify-between px-5 py-3">
                  <div>
                    <p className="font-semibold text-ink-800">{s.name}</p>
                    <p className="text-xs text-slate-400">
                      {s.id} · created {shortDate(s.createdAt)}
                    </p>
                  </div>
                  <Badge tone="slate">{s.users} user{s.users === 1 ? "" : "s"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Employees */}
        <Card className="p-0">
          <div className="border-b border-slate-100 px-5 py-3.5">
            <h3 className="text-sm font-bold text-ink-900">Employees</h3>
          </div>
          {userList.length === 0 ? (
            <EmptyState title="No employees" />
          ) : (
            <ul className="divide-y divide-slate-50">
              {userList.map((u) => {
                const deletable = canManage && u.id !== myId && (isOwner || u.role !== "owner");
                return (
                  <li key={u.id} className="flex items-center justify-between gap-2 px-5 py-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-800">
                        {u.name} <span className="font-normal text-slate-400">@{u.username}</span>
                      </p>
                      <p className="text-xs text-slate-400">{u.storeName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={ROLE_TONE[u.role] || "slate"}>{ROLE_LABEL[u.role] || u.role}</Badge>
                      {deletable && (
                        <button
                          onClick={() => removeUser(u)}
                          title="Remove employee"
                          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      {addingStore && (
        <AddStoreModal
          onClose={() => setAddingStore(false)}
          onDone={() => {
            setAddingStore(false);
            reload();
          }}
        />
      )}
      {addingUser && (
        <AddUserModal
          stores={storeList}
          isOwner={isOwner}
          onClose={() => setAddingUser(false)}
          onDone={() => {
            setAddingUser(false);
            reloadUsers();
            reload();
          }}
        />
      )}
    </div>
  );
}

function AddStoreModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("/api/stores", { method: "POST", body: JSON.stringify({ name }) });
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Add Store"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Creating…" : "Create Store"}
          </button>
        </>
      }
    >
      <label className="label">Store name / location</label>
      <input
        className="input"
        autoFocus
        placeholder="e.g. ON Mart PP – BKK1"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <p className="mt-2 text-xs text-slate-500">
        A new store starts with the full product catalog and an empty order history. Set its details in Store
        Settings after creating it.
      </p>
    </Modal>
  );
}

function AddUserModal({
  stores,
  isOwner,
  onClose,
  onDone,
}: {
  stores: StoreRow[];
  isOwner: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: "",
    username: "",
    password: "",
    role: "operations",
    storeId: stores[0]?.id || "",
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    try {
      await api("/api/users", { method: "POST", body: JSON.stringify(form) });
      onDone();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title="Add Employee"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            disabled={busy || !form.username.trim() || !form.password || !form.storeId}
            onClick={save}
          >
            {busy ? "Creating…" : "Create Employee"}
          </button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Full name</label>
          <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div>
          <label className="label">Username</label>
          <input className="input" value={form.username} onChange={(e) => set("username", e.target.value)} />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="text" value={form.password} onChange={(e) => set("password", e.target.value)} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={form.role} onChange={(e) => set("role", e.target.value)}>
            <option value="operations">Operations</option>
            <option value="procurement">Procurement</option>
            <option value="accountant">Accountant</option>
            <option value="manager">Manager (can remove staff)</option>
            <option value="area_manager">Area Manager (can remove staff)</option>
            {/* Only an owner can create another owner (no privilege escalation). */}
            {isOwner && <option value="owner">Owner (full access)</option>}
          </select>
        </div>
        <div className="col-span-2">
          <label className="label">Store</label>
          <select className="input" value={form.storeId} onChange={(e) => set("storeId", e.target.value)}>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </Modal>
  );
}
