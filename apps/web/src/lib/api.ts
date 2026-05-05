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

  const res = await fetch(new URL(path, env.VITE_API_URL), {
    ...init,
    headers,
    body:
      init.json !== undefined ? JSON.stringify(init.json) : ((init as RequestInit).body ?? null),
  });

  const text = await res.text();
  const body = text ? (JSON.parse(text) as unknown) : null;

  if (!res.ok) {
    const e = (body ?? {}) as { error?: string; message?: string; details?: unknown };
    throw new ApiError(
      res.status,
      e.error ?? 'http_error',
      e.message ?? `HTTP ${res.status}`,
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

  const res = await fetch(new URL(path, env.VITE_API_URL), {
    ...init,
    headers,
    body:
      init.json !== undefined ? JSON.stringify(init.json) : ((init as RequestInit).body ?? null),
  });

  if (!res.ok) {
    const text = await res.text();
    const e = (text ? JSON.parse(text) : {}) as {
      error?: string;
      message?: string;
      details?: unknown;
    };
    throw new ApiError(
      res.status,
      e.error ?? 'http_error',
      e.message ?? `HTTP ${res.status}`,
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
