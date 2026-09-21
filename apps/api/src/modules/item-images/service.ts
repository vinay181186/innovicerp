// Item images service — the ONE place a link to an item's product image is
// minted (user decision 2026-09-21; migration 0136 `items.image_path`).
//
// This is deliberately NOT the drawing-files route, and deliberately lighter:
//   - it is a PRODUCT PICTURE (a 3D render shown as a thumbnail next to
//     code · name on every screen), not a controlled drawing. There is no
//     "who took our drawings?" question to answer for it, so NO activity_log
//     row is written per view — a list of 50 job cards would otherwise write
//     50 log rows every time it opened;
//   - there is NO download gate. Anyone signed in to the company who can see
//     the item can see its picture;
//   - the link lives ITEM_IMAGE_URL_EXPIRES_SEC (an hour) rather than 120 s,
//     because the browser caches it and reuses it across every row that shows
//     the same item.
// What it keeps from drawing-files: the SERVER signs with the service-role key
// (the bucket is private), and it only signs a path this company owns.

import {
  ITEM_IMAGE_FOLDER,
  ITEM_IMAGE_URL_EXPIRES_SEC,
  type ItemImageUrlQuery,
  type ItemImageUrlResponse,
} from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { supabaseAdmin } from '../../lib/supabase-admin';

/** Same private bucket as every other file in the system (0039); the picture
 *  is separated from drawings by its FOLDER (`<companyId>/item-images/…`), not
 *  by a bucket of its own. */
const IMAGE_BUCKET = 'qc-docs';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/**
 * Is this path a product image THIS company may see?
 *
 * Two ways in, either is enough:
 *   1. the path sits in this company's own image folder,
 *      `<companyId>/item-images/…`. The Item form previews the picture the
 *      moment the upload finishes — BEFORE the item is saved — so at that
 *      instant no items row points at it yet. The folder prefix is the
 *      company id, which nobody outside the company knows or can spoof
 *      (the prefix is checked against the SIGNED-IN user's company, not
 *      against anything the caller sends);
 *   2. a live item of this company has it as its image_path (covers a file
 *      that was stored under an older layout, if one ever is).
 * Anything else — another company's folder, a drawing path, a QC document —
 * is Not Found, unsigned. Only `items` is consulted: a picture hangs off the
 * item and nowhere else.
 */
async function pathIsCompanyImage(
  user: AuthContext,
  companyId: string,
  path: string,
): Promise<boolean> {
  if (path.startsWith(`${companyId}/${ITEM_IMAGE_FOLDER}/`)) return true;
  return withUserContext(user, async (tx) => {
    const rs = await tx.execute(sql`
      -- Cast to int, not a raw boolean: the app reads scalars back with
      -- Number() over an ::int cast (see drawing-files), so a driver handing
      -- back the string 't' would fail CLOSED.
      SELECT (EXISTS (
        SELECT 1 FROM public.items
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
           AND image_path = ${path}
      ))::int AS "owned"
    `);
    const row = (rs as unknown as Array<Record<string, unknown>>)[0];
    return Number(row?.['owned'] ?? 0) === 1;
  });
}

/**
 * Mint a link to one item image. Order: signed in (route) → path is this
 * company's → sign. Nothing is signed for a path that fails the check.
 */
export async function getItemImageUrl(
  input: ItemImageUrlQuery,
  user: AuthContext,
): Promise<ItemImageUrlResponse> {
  const companyId = requireCompany(user);
  const path = input.path.trim();
  // Same error as an unknown path: a caller must not be able to tell a
  // malformed request from one that named someone else's file.
  if (path === '') throw new NotFoundError('Item image not found');

  if (!(await pathIsCompanyImage(user, companyId, path))) {
    throw new NotFoundError('Item image not found');
  }

  // Service-role client: the bucket is private and the API is the only place
  // the service-role key exists. Inline display only — no `download` option.
  const { data, error } = await supabaseAdmin.storage
    .from(IMAGE_BUCKET)
    .createSignedUrl(path, ITEM_IMAGE_URL_EXPIRES_SEC);
  if (error || !data?.signedUrl) {
    // Storage has no such object even though the path is ours — a file
    // deleted from the bucket behind the ERP's back.
    throw new NotFoundError('That item image is no longer stored. Upload it again on the item.');
  }

  return { url: data.signedUrl, expiresIn: ITEM_IMAGE_URL_EXPIRES_SEC };
}
