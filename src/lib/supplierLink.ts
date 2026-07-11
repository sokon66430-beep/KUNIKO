// One rule for the whole app: a product may be linked to a supplier ONLY if
// that supplier already exists in the system. We never invent / free-text a
// supplier from a name we can't verify — the user must add it under Suppliers
// first. A blank supplier is allowed (product simply has none yet).

type SupplierLite = { code: string; name: string };

export type SupplierResolution =
  | { status: "none" } // no supplier given — allowed
  | { status: "ok"; code: string; name: string } // matched a real supplier
  | { status: "unknown"; input: string }; // a name/code that isn't in the system

export function resolveSupplier(
  suppliers: SupplierLite[],
  name?: string | null,
  code?: string | null,
): SupplierResolution {
  const n = (name || "").trim();
  const c = (code || "").trim();
  if (!n && !c) return { status: "none" };

  if (c) {
    const byCode = suppliers.find((s) => s.code === c);
    if (byCode) return { status: "ok", code: byCode.code, name: byCode.name };
  }
  if (n && n !== "—") {
    const byName = suppliers.find((s) => s.name.toLowerCase() === n.toLowerCase());
    if (byName) return { status: "ok", code: byName.code, name: byName.name };
  }
  if (!n || n === "—") return { status: "none" }; // only a stale code, no real name
  return { status: "unknown", input: n || c };
}

export const supplierNotInSystem = (input: string) =>
  `Supplier "${input}" is not in the system yet. Add it under Suppliers first, then link the product.`;
