import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, hasAccess, needsCode } from "./lib/session";

/** Next 16's name for middleware. With SITE_PASSCODE set, the whole site waits behind the code. */
export function proxy(req: NextRequest) {
  if (!needsCode("site")) return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname === "/unlock" || pathname === "/api/unlock") return NextResponse.next();
  if (hasAccess("site", req.cookies.get(COOKIE.site)?.value)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "locked" }, { status: 401 });
  return NextResponse.rewrite(new URL("/unlock", req.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|icon.svg|robots.txt).*)"] };
