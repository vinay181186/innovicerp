// Item product image — the 3D render that sits beside `code · name` everywhere
// (user decision 2026-09-21). Three helpers, one file:
//
//   useItemImageUrl     — a signed link for a stored image, cached for almost
//                         its whole lifetime. NOT a drawing: no per-view audit
//                         row, no download tick. `GET /item-images/url` is the
//                         server's long-lived, unlogged route for exactly this.
//   resizeImageForUpload — shrink the picked file in the browser to at most
//                         ITEM_IMAGE_MAX_EDGE on its longest side, so every
//                         thumbnail is small and sharp and the bucket never
//                         holds a 12 MP phone photo.
//   uploadItemImage     — put the resized file in the private bucket under
//                         `<companyId>/item-images/` via the shared uploader.
//
// Drawings keep their own gated, logged path (`@/lib/drawing-url`). Do not
// route a drawing through here.

import {
  ITEM_IMAGE_FOLDER,
  ITEM_IMAGE_MAX_BYTES,
  ITEM_IMAGE_MAX_EDGE,
  ITEM_IMAGE_MIME_TYPES,
  ITEM_IMAGE_URL_EXPIRES_SEC,
  type ItemImageUrlResponse,
} from '@innovic/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';
import { uploadFile } from './storage';

/** Cache the signed link a little shorter than the server's expiry so a URL
 *  served from cache is always still valid. */
const URL_CACHE_MS = (ITEM_IMAGE_URL_EXPIRES_SEC - 120) * 1000;

export function useItemImageUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['item-image', path ?? null],
    queryFn: () =>
      apiFetch<ItemImageUrlResponse>(
        `/item-images/url?path=${encodeURIComponent(path ?? '')}`,
      ).then((r) => r.url),
    enabled: Boolean(path),
    staleTime: URL_CACHE_MS,
    gcTime: URL_CACHE_MS,
    retry: false,
  });
}

export interface ResizedImage {
  blob: Blob;
  /** Suggested file name — original stem, extension matching the output type. */
  fileName: string;
}

const MAX_MB = Math.round(ITEM_IMAGE_MAX_BYTES / (1024 * 1024));

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image'));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not process the image'))),
      type,
      quality,
    );
  });
}

/** True when the picture actually uses transparency anywhere — those keep PNG
 *  so the render's background stays clear; everything else becomes a JPEG. */
function hasTransparency(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] !== 255) return true;
  }
  return false;
}

/** Validate the picked file and shrink it for upload. Throws a plain-English
 *  Error the form shows under the field. */
export async function resizeImageForUpload(file: File): Promise<ResizedImage> {
  if (!(ITEM_IMAGE_MIME_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('Please choose a JPG, PNG or WebP image');
  }
  if (file.size > ITEM_IMAGE_MAX_BYTES) {
    throw new Error(`Image is larger than ${MAX_MB} MB`);
  }

  const img = await loadImage(file);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) throw new Error('That file could not be read as an image');

  const scale = Math.min(1, ITEM_IMAGE_MAX_EDGE / Math.max(srcW, srcH));
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image');
  ctx.drawImage(img, 0, 0, w, h);

  // A render with a see-through background stays PNG; everything else becomes
  // a JPEG on a white ground (JPEG has no alpha — without the fill, any
  // transparent pixel would come out black).
  const keepPng = file.type !== 'image/jpeg' && hasTransparency(ctx, w, h);
  let blob: Blob;
  if (keepPng) {
    blob = await canvasToBlob(canvas, 'image/png');
  } else {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
  }

  const stem = (file.name.replace(/\.[^.]+$/, '') || 'item-image').slice(0, 80);
  return { blob, fileName: `${stem}.${keepPng ? 'png' : 'jpg'}` };
}

/** Resize + upload. Returns the storage path to save as `items.imagePath`. */
export async function uploadItemImage(file: File, companyId: string): Promise<string> {
  const { blob, fileName } = await resizeImageForUpload(file);
  const out = new File([blob], fileName, { type: blob.type });
  return uploadFile(out, companyId, { folder: ITEM_IMAGE_FOLDER });
}
