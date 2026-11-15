// Ask ERP attachments (ADR-293): up to AI_CHAT_FILES_MAX images / PDFs, each up to
// aiChatFileMaxBytes (image 3.5 MB, PDF 5 MB; 12 MB in all), sent as raw base64 (no `data:` prefix). Limits come from
// the shared contract so the browser and the server refuse the same files.

import {
  AI_CHAT_FILE_TYPES,
  AI_CHAT_FILES_MAX,
  AI_CHAT_FILES_TOTAL_MAX_BYTES,
  aiChatFileMaxBytes,
  type AiChatFile,
} from '@innovic/shared';

export interface PickedFile extends AiChatFile {
  id: string;
  size: number;
}

export const ACCEPT = AI_CHAT_FILE_TYPES.join(',');

export function rejectText(name: string): string {
  return `${name} not added — only images (PNG, JPG) up to 3.5 MB and PDF up to 5 MB; ${AI_CHAT_FILES_MAX} files, 12 MB in all.`;
}

function allowedType(type: string): type is AiChatFile['type'] {
  return (AI_CHAT_FILE_TYPES as readonly string[]).includes(type);
}

export function sizeLabel(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : '';
      resolve(url.slice(url.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(file);
  });
}

/** Adds what fits to `current`; names every file it refused. */
export async function addFiles(
  current: PickedFile[],
  files: File[],
): Promise<{ next: PickedFile[]; rejected: string[] }> {
  const next = [...current];
  const rejected: string[] = [];
  for (const f of files) {
    const name = (f.name || 'Pasted image').slice(0, 200);
    const type = f.type;
    const total = next.reduce((n, x) => n + x.size, 0) + f.size;
    if (
      !allowedType(type) ||
      f.size > aiChatFileMaxBytes(type) ||
      total > AI_CHAT_FILES_TOTAL_MAX_BYTES ||
      next.length >= AI_CHAT_FILES_MAX
    ) {
      rejected.push(name);
      continue;
    }
    try {
      const data = await readBase64(f);
      next.push({
        id: `${Date.now()}-${next.length}-${name}`,
        name,
        type,
        data,
        size: f.size,
      });
    } catch {
      rejected.push(name);
    }
  }
  return { next, rejected };
}
