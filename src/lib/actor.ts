import { getSession } from "./session";

// The signed-in user's name, for audit entries. Falls back to a role label
// only when there's no session (e.g. seed scripts).
export async function currentActor(fallback = "Admin"): Promise<string> {
  const s = await getSession();
  return s?.name || fallback;
}
