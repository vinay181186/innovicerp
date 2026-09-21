import type { SupportedStorage } from '@supabase/supabase-js';

// Storage adapter for supabase-js that keeps the login in a SESSION COOKIE and ends it when the
// LAST ERP tab closes (user decisions 2026-09-19 and 2026-09-21).
//
// Wanted behaviour, in the user's words: "one login per browser — every tab shares it, a second
// tab does not ask again; close the ERP tab and the next open asks for login, compulsory."
//
//   - a cookie without Expires/Max-Age is shared by every tab of the browser, so reloads and
//     extra tabs keep the login and token refresh keeps working while a tab is open;
//   - on top of that, every ERP tab announces itself in localStorage (a heartbeat every few
//     seconds, its entry marked "closing" on pagehide). A page load that is NOT a reload of a
//     still-registered tab looks for other live tabs; none → the session cookie is dropped
//     BEFORE supabase-js reads it, so the app starts on /login. Chrome's "continue running in background" /
//     "continue where you left off" therefore change nothing: those keep the cookie, but the
//     tab register says nobody is alive.
//   - no idle timeout.
//
// "Live" = heartbeat younger than LIVE_WINDOW_MS. Chrome throttles timers in hidden tabs to once
// a minute (intensive throttling), so the window is 2.5 minutes — a background tab still counts
// as open. A tab discarded by Memory Saver stops beating; a NEW tab opened after that asks for
// login, and the discarded tab, when clicked, reloads and follows the same rule.
//
// Reload vs new tab: sessionStorage is per tab and survives a reload, so a tab that finds its
// own id there AND whose own heartbeat is still fresh is a reload → keep. Chrome restores
// sessionStorage for "continue where you left off" tabs too, but the heartbeat is then stale
// (the browser was closed), so the restored tab asks for login — as wanted.
//
// Size: a real session is ~2 KB (JWT ~810 B + user object ~1 KB). Browsers cap ONE cookie at
// ~4 KB, so the value is URL-encoded and split defensively into <=3000-char chunks named
// `<key>.0`, `<key>.1`, ... and re-joined on read.
//
// Bandwidth: the cookie is scoped to the web app's own origin (Cloudflare Pages). The API lives on
// another host, so the cookie never travels with API calls — only ~2 KB on static-asset requests.
//
// Migration: users signed in before the cookie deploy still have the session in localStorage.
// The first read moves it into the cookie and deletes the localStorage copy.
//
// erp-test / Playwright: storageState captures cookies, so the existing login setup works
// unchanged — a fresh context has no tab register, and the first page of that context is a
// "new tab with no live peers"; the login setup signs in on it, so nothing is dropped.

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

// ── Tab register ───────────────────────────────────────────────────────────────────────────
const TABS_KEY = 'innovic-erp-tabs'; // localStorage: { [tabId]: lastBeatMs | -closingMs }
const TAB_ID_KEY = 'innovic-erp-tab'; // sessionStorage: this tab's id (survives reload)
const BEAT_MS = 5_000;
const LIVE_WINDOW_MS = 150_000;
/** pagehide fires on a RELOAD as well as on close, so a leaving tab cannot simply drop its
 *  entry — it marks it "closing" (negative timestamp). Its own reload within this window
 *  recognises the mark and keeps the login; a NEW tab never counts a closing tab as alive. */
const RELOAD_WINDOW_MS = 30_000;

function readTabs(): Record<string, number> {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function writeTabs(tabs: Record<string, number>) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
  } catch {
    /* storage full / blocked — the login then simply behaves like a plain session cookie */
  }
}

/** Drops entries older than the live window; returns the survivors. */
function pruneTabs(now: number): Record<string, number> {
  const tabs = readTabs();
  for (const [id, v] of Object.entries(tabs)) {
    if (typeof v !== 'number') delete tabs[id];
    else if (v < 0 ? now + v > RELOAD_WINDOW_MS : now - v > LIVE_WINDOW_MS) delete tabs[id];
  }
  return tabs;
}

/** Registers this tab and decides whether the login may be kept. Runs ONCE, before supabase-js
 *  reads the session. Returns true when the session cookie must be dropped. */
function startTabRegister(): boolean {
  let tabId: string | null = null;
  try {
    tabId = sessionStorage.getItem(TAB_ID_KEY);
  } catch {
    /* sessionStorage blocked — treat as a new tab */
  }
  const now = Date.now();
  const tabs = pruneTabs(now);
  const ownBeat = tabId ? tabs[tabId] : undefined;
  // Own entry still present (live beat, or the closing mark of our own reload) → a reload.
  const isReload = typeof ownBeat === 'number';
  // A peer counts only while it is really beating — a closing tab is not alive.
  const peersAlive = Object.entries(tabs).some(([id, v]) => id !== tabId && v > 0);
  const dropSession = !isReload && !peersAlive;

  if (!tabId) {
    tabId = `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try {
      sessionStorage.setItem(TAB_ID_KEY, tabId);
    } catch {
      /* fine — the heartbeat still keeps peers alive for other tabs */
    }
  }
  const me = tabId;
  const beat = () => {
    const live = pruneTabs(Date.now());
    live[me] = Date.now();
    writeTabs(live);
  };
  let timer: number | null = null;
  const run = () => {
    beat();
    if (timer === null) timer = window.setInterval(beat, BEAT_MS);
  };
  run();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') beat();
  });
  // Closing / navigating away / reloading: mark the entry "closing" at once, so a new tab
  // opened right after a close asks for login without waiting for the beat to age out, while
  // this tab's own reload still finds its mark. Best effort — a crash skips it and the live
  // window handles that. A back/forward-cache return (pageshow) re-registers.
  window.addEventListener('pagehide', () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    const live = pruneTabs(Date.now());
    live[me] = -Date.now();
    writeTabs(live);
  });
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) run();
  });
  return dropSession;
}

/** Playwright only: the login setup stores its cookies for later contexts, which start as
 *  "new tab, no live peers" and would be logged out. auth.setup.ts sets this flag before
 *  saving storageState. It keeps only the browser's OWN login — nothing anyone could gain. */
const E2E_KEEP_KEY = 'innovic-erp-e2e-keep-login';

function e2eKeep(): boolean {
  try {
    return localStorage.getItem(E2E_KEEP_KEY) === '1';
  } catch {
    return false;
  }
}

export function createBrowserSessionStorage(): SupportedStorage {
  const dropOnFirstRead = startTabRegister() && !e2eKeep();
  let dropped = !dropOnFirstRead;
  return {
    getItem: (key) => {
      if (!dropped && /-auth-token$/.test(key)) {
        // First read of the session after a fresh open with no live ERP tab: end the
        // previous login. Only the session key — PKCE code verifiers etc. are left alone.
        dropped = true;
        removeChunked(key);
        try {
          localStorage.removeItem(key);
        } catch {
          /* ignore */
        }
        return null;
      }
      return readChunked(key) ?? migrateFromLocalStorage(key);
    },
    setItem: (key, value) => writeChunked(key, value),
    removeItem: (key) => removeChunked(key),
  };
}
