import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { cleanPrompt, DEFAULT_MODEL, planWalk, type PlannerClient } from "@/lib/ai";
import { PREMIUM_MAX_CHARS } from "@/lib/config";
import { corsHeaders, preflight } from "@/lib/cors";
import { COOKIE, hasAccess, proof } from "@/lib/session";
import type { Pace } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 30;
export const OPTIONS = preflight;

// In-memory counters: a speed bump on a serverless host, not a guarantee. Set a spend limit in the
// Anthropic console as the real backstop.
const PER_IP = 6;
const perIp = new Map<string, number[]>();
const today = { key: "", n: 0 };
const PACES: Pace[] = ["easy", "steady", "brisk"];

function allowed(ip: string): boolean {
  const now = Date.now();
  const recent = (perIp.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  const key = new Date(now).toISOString().slice(0, 10);
  if (today.key !== key) Object.assign(today, { key, n: 0 });
  const cap = Number(process.env.AI_DAILY_CAP) || 40;
  if (recent.length >= PER_IP || today.n >= cap) return false;
  perIp.set(ip, [...recent, now]);
  today.n++;
  return true;
}

export async function POST(req: NextRequest) {
  const t0 = Date.now();
  // Only the status and the time taken are ever logged. Never the note, never the answer.
  const reply = (status: number, body: unknown) => {
    console.info(`plan ${status} ${Date.now() - t0}ms`);
    return NextResponse.json(body, { status, headers: corsHeaders(req) });
  };

  const body = await req.json().catch(() => null);
  const prompt = typeof body?.prompt === "string" ? cleanPrompt(body.prompt) : "";
  if (!prompt || prompt.length > PREMIUM_MAX_CHARS) return reply(400, { error: "bad_request" });
  const pace: Pace = PACES.includes(body?.pace) ? body.pace : "steady";
  const returnHome = body?.returnHome !== false;

  if (!hasAccess("premium", proof(req.cookies.get(COOKIE.premium)?.value, req.headers.get("authorization")))) return reply(401, { error: "locked" });
  if (!process.env.ANTHROPIC_API_KEY) return reply(503, { error: "planner_unavailable" });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!allowed(ip)) return reply(429, { error: "rate_limited" });

  try {
    // Two attempts at most, so each gets a short leash inside the 30 s the route is allowed.
    const client = new Anthropic({ timeout: 12_000, maxRetries: 0 });
    const plan = await planWalk(client as unknown as PlannerClient, { prompt, pace, returnHome }, {
      model: process.env.ANTHROPIC_MODEL || DEFAULT_MODEL,
      signal: req.signal,
    });
    return reply(200, plan);
  } catch (err) {
    if (req.signal.aborted) return reply(499, { error: "aborted" });
    if (err instanceof Anthropic.APIError && err.status === 429) return reply(429, { error: "rate_limited" });
    return reply(502, { error: "planner_error" });
  }
}
