import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, preflight } from "@/lib/cors";
import { codeOk, configured, COOKIE, hasAccess, needsCode, proof, token, type Scope } from "@/lib/session";

const attempts = new Map<string, number[]>();
const send = (req: NextRequest, body: unknown, status = 200) => NextResponse.json(body, { status, headers: corsHeaders(req) });
export const OPTIONS = preflight;
const scopeOf = (v: unknown): Scope | null => (v === "site" || v === "premium" ? v : null);

/** Does this scope need a code, and has this browser already entered it? */
export async function GET(req: NextRequest) {
  const scope = scopeOf(req.nextUrl.searchParams.get("scope"));
  if (!scope) return send(req, { error: "bad_request" }, 400);
  const sent = proof(req.cookies.get(COOKIE[scope])?.value, req.headers.get("authorization"));
  return send(req, { required: needsCode(scope), unlocked: hasAccess(scope, sent) });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const scope = scopeOf(body?.scope);
  if (!scope || typeof body?.code !== "string") return send(req, { error: "bad_request" }, 400);
  if (!needsCode(scope)) return send(req, { ok: true });
  if (!configured()) return send(req, { error: "not_configured" }, 503);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  const recent = (attempts.get(ip) ?? []).filter((t) => Date.now() - t < 600_000);
  if (recent.length >= 10) return send(req, { error: "rate_limited" }, 429);
  attempts.set(ip, [...recent, Date.now()]);

  if (!codeOk(scope, body.code)) return send(req, { ok: false }, 401);
  // The token is also returned for pages on another host, which cannot keep the cookie.
  const res = send(req, { ok: true, token: token(scope) });
  res.cookies.set(COOKIE[scope], token(scope), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
