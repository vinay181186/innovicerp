// Drawing files service — the ONE place a link to a drawing is minted.
//
// Until 2026-09-11 the browser signed its own Storage links with the user's
// session (apps/web/src/lib/storage.ts) and the only rule on the `qc-docs`
// bucket was "same company". Two consequences the user asked to end:
//   - anybody who could open the ERP could fetch ANY drawing, and could save a
//     copy, because the difference between "view" and "download" is one HTTP
//     header the browser sets for itself;
//   - nothing was recorded. Nobody could answer "who took our drawings?".
//
// So the SERVER signs now. The browser asks this service, the service proves
// the path is a drawing this company actually owns, decides whether this person
// may take a copy away, mints a short-lived URL with the service-role key, and
// writes an activity_log row. See canDownloadDrawings (@innovic/shared) for the
// permission rule itself and the honest limit on what it buys — anyone who can
// see a drawing on screen can photograph it; what this buys is a Download
// button restricted to named people, a server that refuses a hand-crafted
// request from anyone else, and a log of every view and every download.

import { canDownloadDrawings, type DrawingUrlQuery, type DrawingUrlResponse } from '@innovic/shared';
import { sql } from 'drizzle-orm';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { AuthorizationError, NotFoundError } from '../../lib/errors';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { appendActivityLog } from '../activity-log/service';
import { getMyAccess } from '../access-control/service';

/** Every drawing in the system lives in this one private bucket (0039). */
const DRAWING_BUCKET = 'qc-docs';

/** 120 seconds to LOOK at one — exactly what the browser used to mint for
 *  itself, so nothing a viewer does today gets shorter. Long enough to open a
 *  PDF, short enough that a copied URL is worthless by the time it is pasted
 *  anywhere. */
const VIEW_EXPIRY_SECONDS = 120;

/** 600 seconds to SAVE one. A drawing can be tens of megabytes on a site
 *  connection, and a download that dies at 90% is a download the person simply
 *  retries — which costs another log row and teaches nothing. */
const DOWNLOAD_EXPIRY_SECONDS = 600;

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

/** What a log line calls each place a drawing can hang off. `source` is sent by
 *  the screen purely so the trail names the DOCUMENT, not a storage path nobody
 *  can read back. */
const SOURCE_LABEL: Record<string, string> = {
  so_line: 'Sales Order line',
  jw_line: 'JWSO line',
  job_card: 'Job Card',
  item: 'Item master',
  qc_document: 'QC document',
  so_document: 'SO document',
};

/**
 * Is this path really a drawing THIS company owns?
 *
 * A storage path is a guessable string — `<company-uuid>/drawings/part.pdf` is
 * the shape of every one of them — so it must never be taken on trust. The only
 * safe definition of "a file you may open" is "a file some row you own points
 * at", and that is literally what this asks: is the path referenced by at least
 * one live row in this company, in any of the seven tables that can hold one?
 *
 * Every branch carries `company_id = :companyId`, so a path belonging to
 * another company matches nothing and is refused as Not Found — the caller
 * cannot even learn that the file exists. The whole thing also runs inside
 * withUserContext, so RLS applies underneath as a second wall.
 *
 * Soft-deleted rows do NOT count, everywhere the table has `deleted_at`: a line
 * somebody removed is a document that no longer exists, and its drawing goes
 * with it. `so_line_drawing_revisions` is the one exception, and deliberately —
 * it is append-only by design (no deleted_at column at all), which is what lets
 * the drawing-history tab still open superseded revisions of a live line.
 *
 * EXISTS, not COUNT: Postgres stops at the first match, so the seven branches
 * cost one index probe in the common case rather than seven full scans.
 */
async function pathBelongsToCompany(
  user: AuthContext,
  companyId: string,
  path: string,
): Promise<boolean> {
  return withUserContext(user, async (tx) => {
    const rs = await tx.execute(sql`
      -- Cast to int, not a raw boolean: the whole app reads scalars back with
      -- Number() over an ::int cast, and a driver handing back the string 't'
      -- instead of true would fail CLOSED — nobody could open any drawing.
      SELECT (EXISTS (
        SELECT 1 FROM public.sales_order_lines
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
           AND drawing_file_path = ${path}
        UNION ALL
        SELECT 1 FROM public.job_work_order_lines
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
           AND drawing_file_path = ${path}
        UNION ALL
        SELECT 1 FROM public.job_cards
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
           AND drawing_file_path = ${path}
        UNION ALL
        SELECT 1 FROM public.items
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
           AND drawing_file_path = ${path}
        UNION ALL
        -- Append-only history; no deleted_at to filter on, which is what keeps
        -- superseded drawings of a LIVE line openable.
        SELECT 1 FROM public.so_line_drawing_revisions
         WHERE company_id = ${companyId}::uuid
           AND drawing_file_path = ${path}
        UNION ALL
        SELECT 1 FROM public.qc_documents
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
           AND storage_path = ${path}
        UNION ALL
        SELECT 1 FROM public.file_registry
         WHERE company_id = ${companyId}::uuid AND deleted_at IS NULL
           AND storage_path = ${path}
      ))::int AS "owned"
    `);
    const row = (rs as unknown as Array<Record<string, unknown>>)[0];
    return Number(row?.['owned'] ?? 0) === 1;
  });
}

/** "JWSO line IN-JW-00042 — bracket-rev-B.pdf". What the person auditing this
 *  later actually needs: which document, and which file. */
function logDetail(input: DrawingUrlQuery, path: string): string {
  const where = input.source ? SOURCE_LABEL[input.source] || input.source : 'Drawing';
  const which = input.refCode ? `${where} ${input.refCode}` : where;
  // Fall back to the last path segment when the screen sent no file name, so
  // the line never reads as a bare UUID folder.
  const fileName = input.fileName?.trim() || path.split('/').pop() || path;
  return `${which} — ${fileName}`;
}

/**
 * Mint a short-lived link to one drawing.
 *
 * ORDER MATTERS, and it is the point of the whole route:
 *   1. the caller must be signed in (the route asserts this before we are called)
 *   2. the path must be a drawing this company owns — else Not Found, unsigned
 *   3. `download` is REFUSED here unless canDownloadDrawings says yes
 *   4. only then is a URL minted
 *
 * Step 3 sits BEFORE step 4 on purpose. A URL that exists has already escaped:
 * it is a bearer token, and signing one "just to throw it away" after a failed
 * check would mean the refusal depended on this process not leaking, logging or
 * erroring in between. Nothing is signed for someone who may not have it.
 */
export async function getDrawingUrl(
  input: DrawingUrlQuery,
  user: AuthContext,
): Promise<DrawingUrlResponse> {
  const companyId = requireCompany(user);
  const path = input.path.trim();
  // Deliberately the same error as an unknown path: a caller must not be able
  // to tell a malformed request from one that named someone else's file.
  if (path === '') throw new NotFoundError('Drawing file not found');

  if (!(await pathBelongsToCompany(user, companyId, path))) {
    throw new NotFoundError('Drawing file not found');
  }

  if (input.mode === 'download') {
    const eff = await getMyAccess(user);
    // ONE rule, shared with the screens that decide whether to draw a Download
    // button, so the button and the server can never disagree. Admin and L6
    // Full Access are handled inside it — no second copy of that here.
    if (!canDownloadDrawings(eff, user.role)) {
      // The REFUSAL is logged, under its own action name. Two reasons:
      //   - it must not be written as 'drawing_download'. Filtering the log on
      //     that action has to return the copies that actually left the
      //     building, and a refusal in that list would read as one that did.
      //   - a refusal is the more interesting row of the two. Somebody hand-
      //     crafting a download request they were not given is exactly what the
      //     log exists to surface, and logging nothing would hide it.
      await appendActivityLog(
        {
          action: 'drawing_download_refused',
          entity: input.source ?? 'drawing',
          detail: `Download refused (no drawing-download permission) — ${logDetail(input, path)}`,
          refId: input.refCode ?? null,
        },
        user,
      );
      throw new AuthorizationError(
        'You do not have permission to download drawing files. ' +
          'Ask an admin to enable it for you.',
      );
    }
  }

  const expiresIn = input.mode === 'download' ? DOWNLOAD_EXPIRY_SECONDS : VIEW_EXPIRY_SECONDS;
  // Service-role client: the bucket is private and the API is the only place
  // the service-role key exists. `download` is the one option that separates
  // the two modes — a string makes the browser SAVE the file under that name,
  // `false` lets it display inline.
  const { data, error } = await supabaseAdmin.storage
    .from(DRAWING_BUCKET)
    .createSignedUrl(path, expiresIn, {
      download:
        input.mode === 'download' ? (input.fileName?.trim() || path.split('/').pop() || true) : false,
    });
  if (error || !data?.signedUrl) {
    // Storage says there is no such object even though a row points at it —
    // a file deleted from the bucket behind the ERP's back. Same Not Found the
    // user would get for a path they do not own; the reason is in the message.
    throw new NotFoundError('That drawing file is no longer stored. Ask for it to be re-uploaded.');
  }

  // Logged AFTER the link exists, so the trail records links that were really
  // handed out rather than attempts that failed on a missing object. Written in
  // its own transaction (appendActivityLog) — there is no mutation here to be
  // atomic with.
  await appendActivityLog(
    {
      action: input.mode === 'download' ? 'drawing_download' : 'drawing_view',
      entity: input.source ?? 'drawing',
      detail: logDetail(input, path),
      refId: input.refCode ?? null,
    },
    user,
  );

  return { url: data.signedUrl, expiresIn, mode: input.mode };
}
