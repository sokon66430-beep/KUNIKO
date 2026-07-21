// Store-scoped login names and the password policy.
//
// Pure string helpers with no Node dependencies, so BOTH the API routes and the
// browser forms import the same rules — the preview a manager sees while adding
// an employee is exactly what the server stores, and the strength check can't be
// bypassed by editing the page (the server re-checks).

/**
 * The email-style domain for a store: `onmart-<store>.kh`.
 *
 * Built from the store's slug id (or name), with a leading "on-mart"/"onmart"
 * stripped so it doesn't read "onmart-on-mart-…". Examples:
 *   "on-mart-tk-592" -> "onmart-tk-592.kh"
 *   "onmart-tk"      -> "onmart-tk.kh"
 */
export function storeLoginDomain(store: { id?: string; name?: string } | null | undefined): string {
  const raw = String(store?.id || store?.name || "store")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const rest = raw.replace(/^on-?mart-?/, "") || raw;
  return `onmart-${rest}.kh`;
}

/**
 * A full login from a typed local part + the target store.
 * `"Sok"` at store "on-mart-tk-592" -> `"sok@onmart-tk-592.kh"`.
 * Anything the user types after an "@" is dropped — the store decides the domain.
 */
export function buildLogin(localPart: string, store: { id?: string; name?: string } | null | undefined): string {
  const local = String(localPart || "")
    .trim()
    .toLowerCase()
    .split("@")[0]
    .replace(/[^a-z0-9._-]/g, "");
  if (!local) return "";
  return `${local}@${storeLoginDomain(store)}`;
}

/**
 * Password policy: at least 8 characters, with at least one letter AND one
 * number. Returns a human error message, or null when the password is fine.
 */
export function passwordProblem(pw: string): string | null {
  const p = String(pw || "");
  if (p.length < 8) return "Password must be at least 8 characters.";
  if (!/[A-Za-z]/.test(p)) return "Password needs at least one letter.";
  if (!/[0-9]/.test(p)) return "Password needs at least one number.";
  return null;
}
