"use client";

import { useState } from "react";
import { Building2, Users, Plus, Store as StoreIcon, Trash2, Pencil } from "lucide-react";
import { useFetch, api } from "@/lib/client";
import { canManageStaff } from "@/lib/access";
import type { Role } from "@/lib/auth";
import { PageHeader, StatCard, Card, Spinner, ErrorBox, Badge, Modal, EmptyState } from "@/components/ui";
import { confirmDialog } from "@/components/confirm";
import { Select, type SelectOption } from "@/components/Select";
import { num, shortDate } from "@/lib/format";
import { buildLogin, storeLoginDomain, passwordProblem } from "@/lib/userIdentity";

// Role choices for the employee forms, with a one-line description each. Owner
// and Management are cross-store, high-privilege roles — only an owner may assign
// them (the server enforces this too).
function roleOptions(isOwner: boolean): SelectOption[] {
  return [
    { value: "store_crew", label: "Store Crew", description: "Shop floor — POS, inventory, stock count" },
    { value: "store_manager", label: "Store Manager", description: "Runs one store; manages its staff" },
    { value: "asst_store_manager", label: "Assistant Store Manager", description: "Supports the store manager" },
    { value: "procurement", label: "Procurement", description: "Ordering & suppliers; sees cost / profit" },
    { value: "accountant", label: "Accountant", description: "Invoices and reports" },
    // Cross-store, elevated roles — only an owner may assign these.
    ...(isOwner
      ? [
          { value: "area_manager", label: "Area Manager", description: "Oversees several owner-assigned stores" },
          { value: "ops_manager", label: "Operation Manager", description: "Works across every store" },
          { value: "management", label: "Management (CEO / Board)", description: "Sees everything, every store — view only" },
          { value: "owner", label: "Owner", description: "Full access to everything" },
        ]
      : []),
  ];
}

type StoreRow = { id: string; name: string; createdAt: string; users: number };
type UserRow = {
  id: string;
  username: string;
  name: string;
  role: string;
  storeId: string;
  storeIds?: string[];
  storeName: string;
};

const ROLE_TONE: Record<string, "brand" | "violet" | "amber" | "emerald" | "rose" | "gold"> = {
  owner: "violet",
  management: "violet",
  ops_manager: "rose",
  area_manager: "rose",
  store_manager: "gold",
  asst_store_manager: "amber",
  manager: "gold",
  accountant: "emerald",
  procurement: "brand",
  operations: "amber",
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

// Checkbox list of stores an Area Manager may access (home store always on).
function StoreChecklist({
  stores,
  selected,
  homeId,
  onToggle,
}: {
  stores: StoreRow[];
  selected: string[];
  homeId: string;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="col-span-2">
      <label className="label">Stores this area manager can access</label>
      <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-slate-200 p-2">
        {stores.map((s) => {
          const isHome = s.id === homeId;
          const checked = isHome || selected.includes(s.id);
          return (
            <label key={s.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked}
                disabled={isHome}
                onChange={() => onToggle(s.id)}
                className="h-4 w-4 accent-brand-600"
              />
              <span className="min-w-0 flex-1 truncate text-ink-800">{s.name}</span>
              {isHome && <span className="text-[10px] font-semibold uppercase text-slate-400">home</span>}
            </label>
          );
        })}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        The home store is always included. Tick the other stores this area manager oversees.
      </p>
    </div>
  );
}

export default function StoresPage() {
  const { data: stores, loading, error, reload } = useFetch<StoreRow[]>("/api/stores");
  const { data: users, reload: reloadUsers } = useFetch<UserRow[]>("/api/users");
  const { data: session } = useFetch<{ user: { id: string; role: string } }>("/api/auth/session");
  const [addingStore, setAddingStore] = useState(false);
  const [addingUser, setAddingUser] = useState(false);
  const [editingStore, setEditingStore] = useState<StoreRow | null>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [migResult, setMigResult] = useState<{ id: string; name: string; from: string; to: string }[] | null>(null);

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

  // Convert every existing account's login to the store-scoped email format in
  // one go, then show the owner each person's new login.
  async function migrateLogins() {
    if (
      !(await confirmDialog({
        title: "Convert existing logins to email format",
        message:
          "Every current account gets a new login like name@onmart-store.kh. Passwords stay the same and anyone signed in stays signed in — but from now on they sign in with the new address. Continue?",
        confirmText: "Convert logins",
      }))
    )
      return;
    setMigrating(true);
    try {
      const r = await api<{ converted: number; changes: { id: string; name: string; from: string; to: string }[] }>(
        "/api/users/migrate-logins",
        { method: "POST" },
      );
      setMigResult(r.changes);
      reloadUsers();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setMigrating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Stores & Employees"
        subtitle="Manage every store location and the employees who can sign in — accountant, procurement, operations"
        actions={
          <div className="flex flex-wrap gap-2">
            {isOwner && (
              <button className="btn-ghost" disabled={migrating} onClick={migrateLogins} title="Convert every existing account to a name@onmart-store.kh login">
                {migrating ? "Converting…" : "Convert logins to email"}
              </button>
            )}
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
                <li key={s.id} className="flex items-center justify-between gap-2 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-ink-800">{s.name}</p>
                    <p className="text-xs text-slate-400">
                      {s.id} · created {shortDate(s.createdAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="slate">{s.users} user{s.users === 1 ? "" : "s"}</Badge>
                    {isOwner && (
                      <button
                        onClick={() => setEditingStore(s)}
                        title="Rename store"
                        className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </div>
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
                const editable = canManage && (isOwner || u.role !== "owner");
                return (
                  <li key={u.id} className="flex items-center justify-between gap-2 px-5 py-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-ink-800">
                        {u.name} <span className="font-normal text-slate-400">@{u.username}</span>
                      </p>
                      <p className="text-xs text-slate-400">{u.storeName}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={ROLE_TONE[u.role] || "slate"}>{ROLE_LABEL[u.role] || u.role}</Badge>
                      {editable && (
                        <button
                          onClick={() => setEditingUser(u)}
                          title="Edit employee"
                          className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Pencil size={15} />
                        </button>
                      )}
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
      {editingStore && (
        <EditStoreModal
          store={editingStore}
          onClose={() => setEditingStore(null)}
          onDone={() => {
            setEditingStore(null);
            reload();
          }}
        />
      )}
      {editingUser && (
        <EditUserModal
          user={editingUser}
          stores={storeList}
          isOwner={isOwner}
          onClose={() => setEditingUser(null)}
          onDone={() => {
            setEditingUser(null);
            reloadUsers();
            reload();
          }}
        />
      )}

      {migResult && (
        <Modal
          open
          onClose={() => setMigResult(null)}
          title="Logins converted"
          footer={
            <button className="btn-primary" onClick={() => setMigResult(null)}>
              Done
            </button>
          }
        >
          {migResult.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">Every account was already in the email format — nothing to change.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-slate-600">
                <b>{migResult.length}</b> login{migResult.length === 1 ? "" : "s"} updated. Passwords are unchanged. Give each
                person their new login below:
              </p>
              <div className="max-h-72 space-y-1.5 overflow-y-auto pr-0.5">
                {migResult.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2">
                    <p className="text-sm font-semibold text-ink-800">{c.name}</p>
                    <p className="text-[12px] text-slate-500">
                      <span className="line-through">{c.from}</span>{" "}
                      <span className="mx-1 text-slate-300">→</span>{" "}
                      <span className="font-mono font-semibold text-brand-600">{c.to}</span>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function EditStoreModal({ store, onClose, onDone }: { store: StoreRow; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(store.name);
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api(`/api/stores/${store.id}`, { method: "PATCH", body: JSON.stringify({ name }) });
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
      title="Edit Store"
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !name.trim()} onClick={save}>
            {busy ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <label className="label">Store name / location</label>
      <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
      <p className="mt-2 text-xs text-slate-500">Renaming a store doesn&apos;t change any of its products or history.</p>
    </Modal>
  );
}

function EditUserModal({
  user,
  stores,
  isOwner,
  onClose,
  onDone,
}: {
  user: UserRow;
  stores: StoreRow[];
  isOwner: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    name: user.name,
    // Edit the local part only — the store's domain is shown as a suffix and
    // re-attached on save, so an existing login converts to the email format too.
    username: user.username.split("@")[0],
    password: "",
    role: user.role,
    storeId: user.storeId,
    storeIds: user.storeIds ?? [],
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStore = (id: string) =>
    setForm((f) => ({ ...f, storeIds: f.storeIds.includes(id) ? f.storeIds.filter((x) => x !== id) : [...f.storeIds, id] }));

  const selStore = stores.find((s) => s.id === form.storeId);
  const domain = storeLoginDomain(selStore);
  const fullLogin = buildLogin(form.username, selStore);
  const pwProblem = form.password ? passwordProblem(form.password) : null;
  const canSave = !!form.username.trim() && !!form.storeId && !pwProblem;

  async function save() {
    setBusy(true);
    try {
      // Only send a password when the owner typed a new one.
      const body: any = {
        name: form.name,
        username: form.username,
        role: form.role,
        storeId: form.storeId,
        storeIds: form.storeIds,
      };
      if (form.password.trim()) body.password = form.password.trim();
      await api(`/api/users/${user.id}`, { method: "PATCH", body: JSON.stringify(body) });
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
      title={`Edit ${user.name}`}
      footer={
        <>
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={busy || !canSave} onClick={save}>
            {busy ? "Saving…" : "Save"}
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
          <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-200 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
            <input
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-ink-800 outline-none placeholder:text-slate-400"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              placeholder="e.g. sok"
            />
            <span className="flex items-center whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 font-mono text-[12px] text-slate-500">
              @{domain}
            </span>
          </div>
          {form.username.trim() && (
            <p className="mt-1 text-[11px] text-slate-400">
              Signs in as <span className="font-semibold text-slate-600">{fullLogin}</span>
            </p>
          )}
        </div>
        <div>
          <label className="label">New password (leave blank to keep)</label>
          <input
            className="input"
            type="text"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder="letters + numbers, 8+"
          />
          <p className={`mt-1 text-[11px] ${pwProblem ? "font-semibold text-rose-500" : "text-slate-400"}`}>
            {pwProblem || "Leave blank to keep. New password needs 8+ chars with letters and numbers."}
          </p>
        </div>
        <div>
          <label className="label">Role</label>
          <Select value={form.role} onChange={(v) => set("role", v)} options={roleOptions(isOwner)} />
        </div>
        <div className="col-span-2">
          <label className="label">{form.role === "area_manager" ? "Home store" : "Store"}</label>
          <Select
            value={form.storeId}
            onChange={(v) => set("storeId", v)}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Pick a store"
          />
        </div>
        {form.role === "area_manager" && (
          <StoreChecklist stores={stores} selected={form.storeIds} homeId={form.storeId} onToggle={toggleStore} />
        )}
      </div>
    </Modal>
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
    role: "store_crew",
    storeId: stores[0]?.id || "",
    storeIds: [] as string[],
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const toggleStore = (id: string) =>
    setForm((f) => ({ ...f, storeIds: f.storeIds.includes(id) ? f.storeIds.filter((x) => x !== id) : [...f.storeIds, id] }));

  // The login is built from the typed local part + the chosen store's domain, so
  // the manager sees the exact address the employee will sign in with.
  const selStore = stores.find((s) => s.id === form.storeId);
  const domain = storeLoginDomain(selStore);
  const fullLogin = buildLogin(form.username, selStore);
  const pwProblem = form.password ? passwordProblem(form.password) : null;
  const canSubmit = !!form.username.trim() && !!form.storeId && !pwProblem && !!form.password;

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
          <button className="btn-primary" disabled={busy || !canSubmit} onClick={save}>
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
          <div className="flex items-stretch overflow-hidden rounded-xl border border-slate-200 focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/10">
            <input
              className="min-w-0 flex-1 bg-transparent px-3.5 py-2.5 text-sm text-ink-800 outline-none placeholder:text-slate-400"
              value={form.username}
              onChange={(e) => set("username", e.target.value)}
              placeholder="e.g. sok"
            />
            <span className="flex items-center whitespace-nowrap border-l border-slate-200 bg-slate-50 px-3 font-mono text-[12px] text-slate-500">
              @{domain}
            </span>
          </div>
          {form.username.trim() && (
            <p className="mt-1 text-[11px] text-slate-400">
              Signs in as <span className="font-semibold text-slate-600">{fullLogin}</span>
            </p>
          )}
        </div>
        <div>
          <label className="label">Password</label>
          <input
            className="input"
            type="text"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            placeholder="letters + numbers, 8+"
          />
          <p className={`mt-1 text-[11px] ${pwProblem ? "font-semibold text-rose-500" : "text-slate-400"}`}>
            {pwProblem || "At least 8 characters, with letters and numbers."}
          </p>
        </div>
        <div>
          <label className="label">Role</label>
          <Select value={form.role} onChange={(v) => set("role", v)} options={roleOptions(isOwner)} />
        </div>
        <div className="col-span-2">
          <label className="label">{form.role === "area_manager" ? "Home store" : "Store"}</label>
          <Select
            value={form.storeId}
            onChange={(v) => set("storeId", v)}
            options={stores.map((s) => ({ value: s.id, label: s.name }))}
            placeholder="Pick a store"
          />
        </div>
        {form.role === "area_manager" && (
          <StoreChecklist stores={stores} selected={form.storeIds} homeId={form.storeId} onToggle={toggleStore} />
        )}
      </div>
    </Modal>
  );
}
