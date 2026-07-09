import { cookies } from "next/headers";
import { verifySession, SESSION_COOKIE, type Session } from "./auth";

/** Current session from the request cookie (Route Handlers / Server Components). */
export async function getSession(): Promise<Session | null> {
  return verifySession(cookies().get(SESSION_COOKIE)?.value);
}
