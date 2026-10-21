import { API_BASE } from "./site";

const KEY = "sw_token";
let held = ""; // used when storage is blocked

/**
 * Same host: the passcode rides in an httpOnly cookie and nothing here is needed. Different host (Pages
 * calling a separate server): browsers withhold third-party cookies, so the code's proof is kept here and
 * sent as a bearer token instead.
 */
export function keepToken(t: unknown) {
  if (!API_BASE || typeof t !== "string" || !t) return;
  held = t;
  try {
    localStorage.setItem(KEY, t);
  } catch {
    /* storage can be blocked; the page keeps it for this visit */
  }
}

function token(): string {
  if (!API_BASE) return "";
  try {
    return localStorage.getItem(KEY) || held;
  } catch {
    return held;
  }
}

/** `fetch` aimed at the planner's host, never sending cookies across sites. */
export function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const t = token();
  if (t) headers.set("authorization", `Bearer ${t}`);
  return fetch(`${API_BASE}${path}`, { cache: "no-store", ...init, headers, credentials: API_BASE ? "omit" : "same-origin" });
}
