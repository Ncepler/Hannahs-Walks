import { NextRequest, NextResponse } from "next/server";
import { codeOk, configured, COOKIE, hasAccess, needsCode, token, type Scope } from "@/lib/session";

const attempts = new Map<string, number[]>();
const scopeOf = (v: unknown): Scope | null => (v === "site" || v === "premium" ? v : null);

/** Does this scope need a code, and has this browser already entered it? */
export async function GET(req: NextRequest) {
  const scope = scopeOf(req.nextUrl.searchParams.get("scope"));
  if (!scope) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  return NextResponse.json({ required: needsCode(scope), unlocked: hasAccess(scope, req.cookies.get(COOKIE[scope])?.value) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const scope = scopeOf(body?.scope);
  if (!scope || typeof body?.code !== "string") return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!needsCode(scope)) return NextResponse.json({ ok: true });
  if (!configured()) return NextResponse.json({ error: "not_configured" }, { status: 503 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const recent = (attempts.get(ip) ?? []).filter((t) => Date.now() - t < 600_000);
  if (recent.length >= 10) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  attempts.set(ip, [...recent, Date.now()]);

  if (!codeOk(scope, body.code)) return NextResponse.json({ ok: false }, { status: 401 });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE[scope], token(scope), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
