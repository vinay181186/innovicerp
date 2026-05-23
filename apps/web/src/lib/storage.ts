// Shared Supabase Storage helpers — the app's general file-upload/download
// capability. First stood up for QC Documents (migration 0039: private
// `qc-docs` bucket + storage.objects RLS for authenticated users); generalised
// here so any module (item drawings, etc.) can reuse it without re-implementing
// the upload + signed-URL dance.
//
// All files currently live in the one private `qc-docs` bucket, namespaced by
// `${companyId}/<folder>/` path prefix. NOTE: the bucket's storage.objects
// policies grant read to ANY authenticated user (not per-company) — path prefix
// is organisational, not a security boundary. Hardening that (path-prefix RLS
// keyed to the JWT company) is a separate org-wide task; see DECISIONS ADR-032.

import { supabase } from './supabase';

export const DEFAULT_BUCKET = 'qc-docs';

interface UploadOpts {
  /** Storage bucket id (default `qc-docs`). */
  bucket?: string;
  /** Sub-folder under the company prefix, e.g. `item-drawings`. */
  folder?: string;
}

/** Uploads a file to Storage and returns its path within the bucket. */
export async function uploadFile(
  file: File,
  companyId: string,
  opts?: UploadOpts,
): Promise<string> {
  const bucket = opts?.bucket ?? DEFAULT_BUCKET;
  const safe = file.name.replace(/[^\w.-]+/g, '_');
  const folder = opts?.folder ? `${opts.folder}/` : '';
  const path = `${companyId}/${folder}${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from(bucket).upload(path, file, { upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return path;
}

/** Issues a short-lived signed URL for downloading/viewing a stored file. */
export async function signedUrl(
  storagePath: string,
  opts?: { bucket?: string; expiresIn?: number },
): Promise<string> {
  const bucket = opts?.bucket ?? DEFAULT_BUCKET;
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(storagePath, opts?.expiresIn ?? 120);
  if (error || !data) throw new Error(`Could not open file: ${error?.message ?? 'unknown'}`);
  return data.signedUrl;
}
