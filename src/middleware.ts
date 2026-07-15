import { NextRequest, NextResponse } from "next/server";
import { verifySession, SESSION_COOKIE } from "@/lib/auth";
import { canAccessPage, isReadOnly } from "@/lib/access";

// Methods that only read. Anything else changes data.
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Gate the whole app behind a login. Public: the login page and the auth API.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname === "/register" ||
    pathname.startsWith("/api/auth/") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico";
  if (isPublic) return NextResponse.next();

  const session = await verifySession(req.cookies.get(SESSION_COOKIE)?.value);

  if (!session) {
    // Not authenticated.
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  // View-only roles (Management / Board) may open every screen but must never
  // change data. Block every mutating API call at this single choke point, so
  // the guarantee holds no matter which route or button is used. Auth endpoints
  // returned above as public, so sign-in, sign-out and store-switching still work.
  if (isReadOnly(session.role) && pathname.startsWith("/api/") && !SAFE_METHODS.has(req.method)) {
    return NextResponse.json(
      { error: "Management is a view-only account and can't make changes." },
      { status: 403 },
    );
  }

  // Authenticated — enforce role-based access on page navigations. A role that
  // opens a screen it may not use is sent to its dashboard. (Dashboard "/" is
  // allowed for every role, so this can't loop.)
  if (!pathname.startsWith("/api/") && !canAccessPage(session.role, pathname)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
