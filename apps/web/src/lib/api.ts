import { env } from './env';
import { supabase } from './supabase';

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type RequestInitWithJson = Omit<RequestInit, 'body'> & { json?: unknown };

// Friendly, plain-language copy for the failure modes users actually hit.
const NETWORK_MESSAGE = "Couldn't reach the server. Check your internet connection and try again.";
const SERVER_MESSAGE = 'The server had a problem. Please try again in a moment.';

/**
 * Turn a server validation payload (Zod `flatten()`: { formErrors, fieldErrors })
 * into a single readable sentence, so the UI shows the actual reason instead of
 * the opaque "Request validation failed". Returns null when nothing usable is
 * present (caller falls back to the generic message).
 */
function humanizeValidationDetails(details: unknown): string | null {
  const d = details as
    | { formErrors?: unknown; fieldErrors?: Record<string, unknown> }
    | null
    | undefined;
  if (!d || typeof d !== 'object') return null;
  const parts: string[] = [];
  if (Array.isArray(d.formErrors)) parts.push(...d.formErrors.filter((m): m is string => !!m));
  if (d.fieldErrors && typeof d.fieldErrors === 'object') {
    for (const [field, msgs] of Object.entries(d.fieldErrors)) {
      if (Array.isArray(msgs) && msgs.length > 0) parts.push(`${field}: ${msgs.join(', ')}`);
    }
  }
  return parts.length > 0 ? parts.join('; ') : null;
}

/** crypto.randomUUID exists only in secure contexts (https / localhost); a
 *  shop-floor PC opening the app over plain http on a LAN IP has no such
 *  function, so fall back to getRandomValues rather than break every save. */
function newRequestKey(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInitWithJson = {},
): Promise<T> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  if (init.json !== undefined) headers.set('content-type', 'application/json');
  // ADR-172: every write carries a one-off key. When a slow save drops the
  // connection and the browser resends the request, the API recognises the
  // repeat and answers with the first run's result instead of running the
  // handler again ("IN-DC-00043/R1 already exists" after a 14 s wait, while
  // the challan had in fact been created).
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && !headers.has('idempotency-key')) {
    headers.set('idempotency-key', newRequestKey());
  }

  // A dropped connection / DNS / CORS failure rejects fetch with a TypeError —
  // translate it into a friendly ApiError instead of leaking "Failed to fetch".
  let res: Response;
  try {
    res = await fetch(new URL(path, env.VITE_API_URL), {
      ...init,
      headers,
      body:
        init.json !== undefined ? JSON.stringify(init.json) : ((init as RequestInit).body ?? null),
    });
  } catch (cause) {
    throw new ApiError(0, 'network_error', NETWORK_MESSAGE, cause);
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON response (e.g. a proxy/gateway HTML error page). Don't crash on
      // JSON.parse — surface a friendly message keyed off the status.
      if (!res.ok) {
        throw new ApiError(
          res.status,
          'http_error',
          res.status >= 500 ? SERVER_MESSAGE : `Request failed (HTTP ${res.status}).`,
        );
      }
      return null as T;
    }
  }

  if (!res.ok) {
    const e = (body ?? {}) as { error?: string; message?: string; details?: unknown };
    // For validation errors, prefer the specific field reason over the generic
    // "Request validation failed" the server sends.
    const friendly = e.error === 'validation_error' ? humanizeValidationDetails(e.details) : null;
    const fallback = res.status >= 500 ? SERVER_MESSAGE : `HTTP ${res.status}`;
    throw new ApiError(
      res.status,
      e.error ?? 'http_error',
      friendly ?? e.message ?? fallback,
      e.details,
    );
  }
  return body as T;
}

/**
 * Fetches a binary download (e.g., xlsx export) and triggers a browser
 * download. Auth header is attached the same way as `apiFetch`. The
 * filename is derived from the response's content-disposition header
 * if present, otherwise the caller-supplied fallback.
 */
export async function apiDownload(
  path: string,
  init: RequestInitWithJson = {},
  fallbackFilename: string = 'download',
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const headers = new Headers(init.headers);
  if (session?.access_token) headers.set('authorization', `Bearer ${session.access_token}`);
  if (init.json !== undefined) headers.set('content-type', 'application/json');

  let res: Response;
  try {
    res = await fetch(new URL(path, env.VITE_API_URL), {
      ...init,
      headers,
      body:
        init.json !== undefined ? JSON.stringify(init.json) : ((init as RequestInit).body ?? null),
    });
  } catch (cause) {
    throw new ApiError(0, 'network_error', NETWORK_MESSAGE, cause);
  }

  if (!res.ok) {
    const text = await res.text();
    let e: { error?: string; message?: string; details?: unknown } = {};
    try {
      e = text ? (JSON.parse(text) as typeof e) : {};
    } catch {
      e = {};
    }
    throw new ApiError(
      res.status,
      e.error ?? 'http_error',
      e.message ?? (res.status >= 500 ? SERVER_MESSAGE : `HTTP ${res.status}`),
      e.details,
    );
  }

  const filename = parseContentDispositionFilename(
    res.headers.get('content-disposition'),
    fallbackFilename,
  );
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function parseContentDispositionFilename(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  return match?.[1] ?? fallback;
}

export { ApiError };
