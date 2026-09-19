import type { SupportedStorage } from '@supabase/supabase-js';

// Storage adapter for supabase-js that keeps the login in a SESSION COOKIE (user decision
// 2026-09-19). The browser's own cookie semantics give exactly the wanted behaviour with no
// tab-liveness tricks of our own:
//   - a cookie without Expires/Max-Age is shared by every tab of the browser and deleted when
//     the browser closes, so the next start shows /login;
//   - reloads and new tabs keep the login; token refresh keeps working while a tab is open;
//   - no idle timeout.
//
// Size: a real session is ~2 KB (JWT ~810 B + user object ~1 KB). Browsers cap ONE cookie at
// ~4 KB, so the value is URL-encoded and split defensively into <=3000-char chunks named
// `<key>.0`, `<key>.1`, ... and re-joined on read.
//
// Bandwidth: the cookie is scoped to the web app's own origin (Cloudflare Pages). The API lives on
// another host, so the cookie never travels with API calls — only ~2 KB on static-asset requests.
//
// Caveat (same as any website): browsers set to "Continue where you left off" / restore tabs may
// keep session cookies across a restart — browser behaviour, not ours.
//
// Migration: users signed in before this deploy still have the session in localStorage. The
// first read moves it into the cookie and deletes the localStorage copy, so the deploy does not
// force anyone out; from then on closing the browser ends the login.
//
// erp-test / Playwright: storageState captures cookies, so the existing login setup works
// unchanged.

const CHUNK_SIZE = 3000;

function readCookies(): Map<string, string> {
  const out = new Map<string, string>();
  if (!document.cookie) return out;
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=');
    if (eq > 0) out.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return out;
}

function cookieAttrs(): string {
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  // No Expires / Max-Age on purpose — that is what makes it a session cookie.
  return `; Path=/; SameSite=Lax${secure}`;
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}${cookieAttrs()}`;
}

function expireCookie(name: string) {
  document.cookie = `${name}=${cookieAttrs()}; Max-Age=0`;
}

function readChunked(key: string): string | null {
  const cookies = readCookies();
  const whole = cookies.get(key);
  if (whole !== undefined) return decodeURIComponent(whole);
  const chunks: string[] = [];
  for (let i = 0; ; i += 1) {
    const chunk = cookies.get(`${key}.${i}`);
    if (chunk === undefined) break;
    chunks.push(chunk);
  }
  return chunks.length > 0 ? decodeURIComponent(chunks.join('')) : null;
}

function writeChunked(key: string, value: string) {
  const encoded = encodeURIComponent(value);
  const count = Math.max(1, Math.ceil(encoded.length / CHUNK_SIZE));
  for (let i = 0; i < count; i += 1) {
    writeCookie(`${key}.${i}`, encoded.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE));
  }
  // A previous, larger value may have left higher-index chunks behind.
  const existing = readCookies();
  for (let i = count; existing.has(`${key}.${i}`); i += 1) expireCookie(`${key}.${i}`);
  if (existing.has(key)) expireCookie(key);
}

function removeChunked(key: string) {
  const existing = readCookies();
  if (existing.has(key)) expireCookie(key);
  for (let i = 0; existing.has(`${key}.${i}`); i += 1) expireCookie(`${key}.${i}`);
}

/** One-time move of a pre-deploy localStorage session into the cookie. */
function migrateFromLocalStorage(key: string): string | null {
  try {
    const legacy = localStorage.getItem(key);
    if (legacy === null) return null;
    writeChunked(key, legacy);
    localStorage.removeItem(key);
    return legacy;
  } catch {
    return null;
  }
}

export function createBrowserSessionStorage(): SupportedStorage {
  return {
    getItem: (key) => readChunked(key) ?? migrateFromLocalStorage(key),
    setItem: (key, value) => writeChunked(key, value),
    removeItem: (key) => removeChunked(key),
  };
}
