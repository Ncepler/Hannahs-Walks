import { createHmac, timingSafeEqual } from 'node:crypto';

export type Scope = 'site' | 'premium';
export const COOKIE: Record<Scope, string> = { site: 'sw_site', premium: 'sw_premium' };
const ENV: Record<Scope, string> = { site: 'SITE_PASSCODE', premium: 'PREMIUM_PASSCODE' };

const mac = (key: string, msg: string) => createHmac('sha256', key).update(msg).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

const passcode = (s: Scope) => process.env[ENV[s]] ?? '';
export const needsCode = (s: Scope) => !!passcode(s);
export const configured = () => !!process.env.SESSION_SECRET;

/** Cookie value: an HMAC of a constant, keyed with SESSION_SECRET. */
export const token = (s: Scope) => mac(process.env.SESSION_SECRET ?? '', `sw:${s}`).toString('hex');

/** True when no code is set, or the cookie proves the code was entered. Fails closed without a secret. */
export const hasAccess = (s: Scope, cookie?: string) =>
  !needsCode(s) || (configured() && !!cookie && same(Buffer.from(cookie), Buffer.from(token(s))));

/** Constant-time check of the code itself. */
export const codeOk = (s: Scope, code: string) => needsCode(s) && same(mac('code', code), mac('code', passcode(s)));
