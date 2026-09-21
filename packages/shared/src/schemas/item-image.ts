// Item product image — the 3D render shown as a fixed-size thumbnail next to
// item code · name everywhere (user decision 2026-09-21).
//
// It is NOT a controlled drawing: no per-view audit row, long-lived signed
// URL, cached in the browser. Drawings (SO/JWSO line) keep their own gated,
// logged route (drawing-files). The picture is stored in the private bucket
// under `<companyId>/item-images/…`, resized in the browser before upload so
// every thumbnail is small and sharp.

import { z } from 'zod';

export const ITEM_IMAGE_FOLDER = 'item-images';
/** Accepted upload types — real pictures only; PDFs belong to the drawing field. */
export const ITEM_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
/** Hard cap on the ORIGINAL file the user picks (before browser resize). */
export const ITEM_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
/** Longest edge after the browser resize; stored as JPEG/WebP at this size. */
export const ITEM_IMAGE_MAX_EDGE = 800;
/** Thumbnail box sizes used by the shared badge: table row / card & header / item page. */
export const ITEM_IMAGE_SIZES = { row: 40, card: 56, page: 96 } as const;
/** Signed-URL lifetime; the web caches the URL a little shorter than this. */
export const ITEM_IMAGE_URL_EXPIRES_SEC = 60 * 60;

export const itemImageUrlQuerySchema = z.object({
  path: z.string().min(1).max(512),
});
export type ItemImageUrlQuery = z.infer<typeof itemImageUrlQuerySchema>;

export const itemImageUrlResponseSchema = z.object({
  url: z.string().url(),
  expiresIn: z.number().int().positive(),
});
export type ItemImageUrlResponse = z.infer<typeof itemImageUrlResponseSchema>;
