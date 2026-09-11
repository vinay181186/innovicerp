// Access Control service — admin manages per-user permission matrix.
//
// Mirror of legacy db.userAccess CRUD (renderAccessControl L13861 list +
// _editAccess L13917 save handler). All writes admin-only. Reads:
// - `getMyAccess` returns the caller's own EffectiveAccess (any role; web
//   shell uses it to gate buttons + sidebar)
// - `listUserAccess` / `getUserAccess` are admin-only
//
// ADR-035 option A was "matrix is UI-only enforcement". 0100 starts
// closing that: `requireFormAccess` (../../lib/access) enforces the matrix
// server-side, and is wired into the approve/reject paths first because
// the `approve` action is new and has no legacy behaviour to preserve.
// The remaining modules' write endpoints are still role-gated only.

import {
  ACCESS_DEPTS,
  ACCESS_DEPT_KEYS,
  isAccessDeptKey,
  roleForAccess,
  ACCESS_FORM_KEYS,
  type AccessDeptsMap,
  type AccessFormKey,
  type AccessFormsMap,
  canDownloadDrawings,
  cascadeFormsMap,
  effectiveFormPerms,
  type EffectiveAccess,
  type ListUserAccessResponse,
  normalizeDeptsMap,
  pruneDeptsMap,
  pruneFormsMap,
  type QcUserOption,
  type SaveUserAccessInput,
  type UserAccess,
  type UserAccessListItem,
} from '@innovic/shared';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { userAccess, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError, NotFoundError, ValidationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

// Coerce a raw jsonb cell into a typed map. jsonb is `unknown` from the
// driver; defensive cast keeps the service free of `any`.
function asDeptsMap(v: unknown): AccessDeptsMap {
  return (v && typeof v === 'object' ? (v as AccessDeptsMap) : {}) ?? {};
}
function asFormsMap(v: unknown): AccessFormsMap {
  return (v && typeof v === 'object' ? (v as AccessFormsMap) : {}) ?? {};
}

function rowToUserAccess(r: {
  id: string;
  userId: string;
  companyId: string;
  fullAccess: boolean;
  auditor: boolean;
  drawingDownload: boolean;
  mainDept: string | null;
  departments: unknown;
  forms: unknown;
  createdAt: Date;
  updatedAt: Date;
}): UserAccess {
  return {
    id: r.id,
    userId: r.userId,
    companyId: r.companyId,
    auditor: r.auditor,
    // "Can download drawing files" (migration 0121). A whole-account switch
    // like fullAccess and auditor, so it rides alongside them rather than
    // living in the per-form map. Reported raw — whether it actually GRANTS a
    // download is canDownloadDrawings' decision, made in one place.
    drawingDownload: r.drawingDownload,
    mainDept: r.mainDept,
    fullAccess: r.fullAccess,
    departments: asDeptsMap(r.departments),
    forms: asFormsMap(r.forms),
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

// Count granted depts / forms for the list-row summary. A form counts as
// hand-configured if any of view/entry/edit/approve is true, or if money was
// granted below the department's normal level (`price`) or taken away above it
// (`priceOff`) — those are decisions someone made by hand and the row should
// not read as "nothing set here".
function countDepts(m: AccessDeptsMap): number {
  const tiers = normalizeDeptsMap(m);
  return ACCESS_DEPT_KEYS.reduce((n, k) => (tiers[k] ? n + 1 : n), 0);
}
function countForms(m: AccessFormsMap): number {
  return ACCESS_FORM_KEYS.reduce((n, k) => {
    const p = m[k];
    return p &&
      (p.view ||
        p.entry ||
        p.edit ||
        p.approve ||
        p.price ||
        p.priceOff ||
        // A page with only OFF switches set (Hide page / No create / No edit /
        // No approve) is still a hand-made decision — count it, or the row reads
        // "nothing configured" when in fact an action was taken away.
        p.viewOff ||
        p.entryOff ||
        p.editOff ||
        p.approveOff)
      ? n + 1
      : n;
  }, 0);
}

// "Sales L3 · Store L1" — the headline for one matrix row. Precomputed
// server-side so the list page does not have to pull every user's full
// matrix just to render a column.
function tierSummary(m: AccessDeptsMap): string {
  const tiers = normalizeDeptsMap(m);
  const parts = ACCESS_DEPTS.flatMap((d) => {
    const t = tiers[d.key];
    return t ? [`${d.label} ${t}`] : [];
  });
  return parts.join(' · ');
}

// Caller's own effective access — fail-closed: if no row exists, deny
// everything (admin can still grant themselves via the matrix UI).
export async function getMyAccess(user: AuthContext): Promise<EffectiveAccess> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(userAccess)
      .where(
        and(
          eq(userAccess.userId, user.id),
          eq(userAccess.companyId, companyId),
          isNull(userAccess.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) {
      return {
        fullAccess: false,
        auditor: false,
        // Fail closed, like every other flag here: nobody set this person up,
        // so they may look at a drawing but not take a copy away.
        drawingDownload: false,
        departments: {},
        forms: {},
      };
    }
    return {
      fullAccess: row.fullAccess,
      auditor: row.auditor,
      // Carried on /access-control/me so the screens can decide whether to
      // render a Download button. The button is only the courtesy half — the
      // refusal that holds is on the drawing-link route (drawing-files).
      drawingDownload: row.drawingDownload,
      departments: normalizeDeptsMap(asDeptsMap(row.departments)),
      forms: cascadeFormsMap(asFormsMap(row.forms)),
    };
  });
}

// Admin list: every user in the company + matrix summary. Self-join so
// users without an access row still appear (deptCount=0, formCount=0).
export async function listUserAccess(user: AuthContext): Promise<ListUserAccessResponse> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        userId: users.id,
        userName: users.fullName,
        userEmail: users.email,
        role: users.role,
        isActive: users.isActive,
        acFullAccess: userAccess.fullAccess,
        acAuditor: userAccess.auditor,
        acDrawingDownload: userAccess.drawingDownload,
        acMainDept: userAccess.mainDept,
        acDepartments: userAccess.departments,
        acForms: userAccess.forms,
      })
      .from(users)
      .leftJoin(
        userAccess,
        and(eq(userAccess.userId, users.id), isNull(userAccess.deletedAt)),
      )
      .where(and(eq(users.companyId, companyId), isNull(users.deletedAt)))
      .orderBy(desc(users.isActive), asc(users.fullName), asc(users.email));

    const items: UserAccessListItem[] = rows.map((r) => {
      const fullAccess = r.acFullAccess ?? false;
      const auditor = r.acAuditor ?? false;
      const depts = asDeptsMap(r.acDepartments);
      const forms = asFormsMap(r.acForms);
      const totalDepts = ACCESS_DEPT_KEYS.length;
      const totalForms = ACCESS_FORM_KEYS.length;
      return {
        userId: r.userId,
        userName: r.userName,
        userEmail: r.userEmail,
        role: r.role,
        isActive: r.isActive,
        fullAccess,
        auditor,
        // The STORED tick, not the effective answer. The list is the admin's
        // editing view: it has to show what is actually saved on the row, so a
        // Full Access account reads "download: off, but covered by L6" rather
        // than pretending someone ticked a box nobody ticked. What a person may
        // really do is canDownloadDrawings' answer, asked at the point of use.
        drawingDownload: r.acDrawingDownload ?? false,
        mainDept: r.acMainDept ?? null,
        derivedRole: roleForAccess({ fullAccess, auditor, departments: normalizeDeptsMap(depts) }),
        deptCount: fullAccess || auditor ? totalDepts : countDepts(depts),
        totalDepts,
        formCount: fullAccess ? totalForms : countForms(forms),
        totalForms,
        tierSummary: fullAccess
          ? 'L6 Super Admin — every department'
          : auditor
            ? 'L7 Auditor — reads every department'
            : tierSummary(depts),
      };
    });

    return { items };
  });
}

// ── QC user options ────────────────────────────────────────────
// The forms that ARE a QC entry: recording an inspection on a job-card
// operation, and recording one on incoming goods. Someone who may create on
// either of these is someone who may sign off an inspection, which is exactly
// what a "QC By" dropdown is asking for.
//
// Deliberately NOT every qc-department form. Entry rights on QC Process Master
// or TPI Master mean "may maintain a lookup list", not "may inspect", and
// putting those people forward as inspectors would name someone who does not
// do the job.
const QC_ENTRY_FORMS: readonly AccessFormKey[] = ['qc_submit', 'qc_incoming'];

/** Was this person GIVEN the right to make a QC entry?
 *
 *  Asked through the app's own permission function rather than re-derived
 *  here, so the dropdown can never disagree with what the QC screens actually
 *  let someone do. That matters in three ways a tier comparison got wrong:
 *
 *    - a per-form grant counts. Someone given explicit entry on QC Call
 *      Register without a Quality tier is a QC user, and was invisible before.
 *    - "No create" counts. An admin who switched entry OFF for QC on one
 *      person meant it; they were still being offered as an inspector.
 *    - L1 still falls out on its own, because the L1 tier grants no entry —
 *      the old min-tier rule is subsumed rather than removed.
 *
 *  Full Access counts, on the user's explicit instruction: those accounts may
 *  make any entry in the system, QC included, so refusing to let one be
 *  recorded as the inspector would deny something that is actually true. They
 *  are sorted to the BOTTOM instead (see the ordering below) so the people
 *  whose job this is open the list, rather than being mixed in with admins. */
function wasGrantedQcEntry(eff: EffectiveAccess): boolean {
  return QC_ENTRY_FORMS.some((f) => effectiveFormPerms(eff, f).entry);
}

/** Did their QUALITY access grant this, as opposed to Full Access covering
 *  everything? Not a filter — only the sort key that separates the QC team and
 *  the people given QC rights from the admins who merely may. */
function grantedQcEntryDirectly(eff: EffectiveAccess): boolean {
  return wasGrantedQcEntry({ ...eff, fullAccess: false });
}

/** Their Quality tier for display, whatever it is — L1 included. The tier no
 *  longer decides who is on the list, so it is reported rather than filtered
 *  on: someone can now qualify through a per-form grant with a low tier, or
 *  none at all. `normalizeDeptsMap` reads the pre-0100 literal `true` as L1. */
function qcTierLabel(departments: unknown): string | null {
  return normalizeDeptsMap(asDeptsMap(departments))['qc'] ?? null;
}

// The people Access Control actually lets do QC work — the source list behind
// every "QC By" dropdown.
//
// Readable by ANY authenticated user in the company, deliberately NOT
// admin-only: the QC clerk filling in an incoming inspection is the person who
// opens this list, and `requireAdminRole` would break the one screen it exists
// for. It returns names and emails only — never the permission maps — which is
// no more than `/tasks/user-options` already exposes for every user.
//
// `users.role` is not the filter (see the schema comment in @innovic/shared):
// the role is derived as the narrowest role covering everything someone was
// granted, so a Quality lead who also writes Production derives as 'manager'
// and would vanish from the list. What someone was GRANTED is the honest answer,
// and `wasGrantedQcEntry` asks the app's own permission function for it.
export async function listQcUserOptions(user: AuthContext): Promise<QcUserOption[]> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        acFullAccess: userAccess.fullAccess,
        acAuditor: userAccess.auditor,
        acMainDept: userAccess.mainDept,
        acDepartments: userAccess.departments,
        // Needed because the qualifying test is the app's real permission
        // check, which unions the department tier with per-form grants and
        // then subtracts the per-page OFF switches.
        acForms: userAccess.forms,
      })
      .from(users)
      .leftJoin(
        userAccess,
        and(
          eq(userAccess.userId, users.id),
          eq(userAccess.companyId, companyId),
          isNull(userAccess.deletedAt),
        ),
      )
      .where(
        and(
          eq(users.companyId, companyId),
          eq(users.isActive, true),
          isNull(users.deletedAt),
        ),
      );

    // `_direct` rides along purely as a sort key and is stripped before return,
    // so the wire shape stays exactly QcUserOption.
    const options: Array<QcUserOption & { _direct: boolean }> = rows.flatMap((r) => {
      const fullAccess = r.acFullAccess ?? false;
      // Built exactly as getMyAccess builds it, so this asks the same question
      // of the same shape the QC screens ask of themselves.
      const eff: EffectiveAccess = {
        fullAccess,
        auditor: r.acAuditor ?? false,
        // Irrelevant to who may sign off an inspection, but the shape is the
        // shape — leaving it out would make this a different object from the
        // one getMyAccess builds, which is the whole point of building it here.
        drawingDownload: false,
        departments: normalizeDeptsMap(asDeptsMap(r.acDepartments)),
        forms: cascadeFormsMap(asFormsMap(r.acForms)),
      };
      if (!wasGrantedQcEntry(eff)) return [];
      const tier = qcTierLabel(r.acDepartments);
      return [
        {
          id: r.id,
          // A login with no name set would otherwise render as a blank row.
          name: r.fullName?.trim() || r.email,
          email: r.email,
          tier,
          isQcDept: r.acMainDept === 'qc',
          fullAccess,
          // Sort key only — see the ordering below. Not part of the wire shape
          // the UI reads.
          _direct: grantedQcEntryDirectly(eff),
        },
      ];
    });

    // Three bands, so the list opens on the people whose job this actually is:
    //   1. the QC team          — Quality is their MAIN department
    //   2. granted QC entry     — a Quality tier or a per-form grant says so
    //   3. everyone else        — Full Access accounts who merely MAY do it
    // Within a band, by name. Band 3 exists because Full Access covers every
    // entry in the system including QC, so those accounts genuinely qualify —
    // but an admin is rarely the person who inspected, and burying the QC team
    // under them is what made this dropdown read as "everybody".
    const band = (o: (typeof options)[number]): number =>
      o.isQcDept ? 0 : o._direct ? 1 : 2;
    return options
      .sort((a, b) => (band(a) === band(b) ? a.name.localeCompare(b.name) : band(a) - band(b)))
      .map(({ _direct: _drop, ...o }) => o);
  });
}

// Admin: full row for one user (used by the Configure modal). Returns a
// default-empty shape if no row exists yet so the modal can render
// without a separate code path.
export async function getUserAccess(userId: string, user: AuthContext): Promise<UserAccess> {
  requireAdminRole(user);
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    // Confirm the target user belongs to caller's company.
    const target = await tx
      .select({ id: users.id, companyId: users.companyId })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (target.length === 0 || target[0]!.companyId !== companyId) {
      throw new NotFoundError(`User ${userId} not found`);
    }

    const rows = await tx
      .select()
      .from(userAccess)
      .where(
        and(
          eq(userAccess.userId, userId),
          eq(userAccess.companyId, companyId),
          isNull(userAccess.deletedAt),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (row) return rowToUserAccess(row);

    // No row yet — return a synthetic default so the modal can show
    // un-saved defaults without writing first. UI calls save to persist.
    return {
      id: '',
      userId,
      companyId,
      fullAccess: false,
      auditor: false,
      // Granted, never assumed — an un-configured account opens with the box
      // unticked, same as every other switch on this shape.
      drawingDownload: false,
      mainDept: null,
      departments: {},
      forms: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  });
}

// Admin: upsert one user's matrix. Cascades view⊆entry⊆edit on save,
// prunes unknown dept/form keys, emits activity log.
export async function saveUserAccess(
  userId: string,
  input: SaveUserAccessInput,
  user: AuthContext,
): Promise<UserAccess> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  const cleanDepts = pruneDeptsMap(input.departments);
  const cleanForms = cascadeFormsMap(pruneFormsMap(input.forms));
  // L6 and L7 are mutually exclusive: Super Admin already reads everything
  // AND writes, so an account marked both is really just a Super Admin.
  // Resolving it here means the stored row can never say two things at once.
  const auditor = input.fullAccess ? false : input.auditor;
  // "Can download drawing files" (0121) is stored EXACTLY as the admin ticked
  // it — deliberately not forced true for Full Access and not forced false for
  // anything. L6 covering downloads is canDownloadDrawings' rule, and writing a
  // second copy of it into this row is how the two would come to disagree: an
  // account demoted out of L6 later would keep a tick nobody meant to give.
  const drawingDownload = input.drawingDownload;
  // The main department has to be a real department that this person actually
  // holds a tier in. A stale value — the admin picked Design, then cleared the
  // Design row by hand — would leave the screen claiming a department the
  // access no longer backs. Neither whole-account level is departmental.
  const mainDept =
    input.fullAccess || auditor
      ? null
      : input.mainDept && isAccessDeptKey(input.mainDept) && cleanDepts[input.mainDept]
        ? input.mainDept
        : null;
  // `users.role` is DERIVED, never chosen (ADR-136). It is still what gates
  // 120 write paths, so it has to be written — but making it a consequence of
  // the access is what stops the role and the matrix ever contradicting.
  const derivedRole = roleForAccess({ fullAccess: input.fullAccess, auditor, departments: cleanDepts });

  return withUserContext(user, async (tx) => {
    // Confirm target user in caller's company.
    const target = await tx
      .select({
        id: users.id,
        fullName: users.fullName,
        email: users.email,
        companyId: users.companyId,
        role: users.role,
      })
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (target.length === 0 || target[0]!.companyId !== companyId) {
      throw new NotFoundError(`User ${userId} not found`);
    }
    const targetUser = target[0]!;

    // Dropping someone out of admin is now a one-click accident waiting to
    // happen: an admin with no access row loads an EMPTY box, so pressing Save
    // without touching anything derives them to viewer and locks them out with
    // no undo. Two guards.
    //
    // Yourself: always refused, whatever you tick. You cannot confirm your own
    // demotion, because if it is wrong there is nobody left to reverse it.
    if (userId === user.id && derivedRole !== 'admin' && targetUser.role === 'admin') {
      throw new ValidationError(
        'This would remove your own admin access — ask another admin to do it.',
      );
    }
    // Someone else: allowed, but only on purpose. The modal asks first and
    // resends with the flag set.
    if (
      userId !== user.id &&
      targetUser.role === 'admin' &&
      derivedRole !== 'admin' &&
      !input.confirmAdminChange
    ) {
      throw new ValidationError(
        `${targetUser.fullName ?? targetUser.email} is an admin. Saving this access would ` +
          `change them to "${derivedRole}" and they would lose admin rights. Tick Full Access ` +
          `to keep them an admin, or confirm the change.`,
      );
    }
    if (targetUser.role !== derivedRole) {
      await tx
        .update(users)
        .set({ role: derivedRole as typeof users.$inferSelect.role, updatedBy: user.id, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    const existingRows = await tx
      .select()
      .from(userAccess)
      .where(
        and(
          eq(userAccess.userId, userId),
          eq(userAccess.companyId, companyId),
          isNull(userAccess.deletedAt),
        ),
      )
      .limit(1);
    const existing = existingRows[0];

    let saved;
    if (existing) {
      const updated = await tx
        .update(userAccess)
        .set({
          fullAccess: input.fullAccess,
          auditor,
          drawingDownload,
          mainDept,
          departments: cleanDepts,
          forms: cleanForms,
          updatedBy: user.id,
          updatedAt: new Date(),
        })
        .where(eq(userAccess.id, existing.id))
        .returning();
      saved = updated[0]!;
    } else {
      const inserted = await tx
        .insert(userAccess)
        .values({
          userId,
          companyId,
          fullAccess: input.fullAccess,
          auditor,
          drawingDownload,
          mainDept,
          departments: cleanDepts,
          forms: cleanForms,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      saved = inserted[0]!;
    }

    await emitActivityLog(
      tx,
      {
        action: 'ACCESS',
        entity: 'Access Control',
        // Record WHAT the access became, not just that it changed — a bare
        // "updated access" line is useless to the person auditing it later.
        detail:
          `Updated access for ${targetUser.fullName ?? targetUser.email} — ` +
          (input.fullAccess
            ? 'L6 Super Admin (full access)'
            : auditor
              ? 'L7 Auditor (reads every department, writes nothing)'
              : `main dept ${mainDept ?? 'none'}; ` +
                (tierSummary(cleanDepts) || 'no departments') +
                `; ${countForms(cleanForms)} form override(s)`) +
          // Say whether this person can now take a copy of a drawing away, and
          // ask the app's OWN function rather than reading the tick — L6 and
          // admin pass without a tick, so the raw column would make the audit
          // trail say "no" about someone who can. One rule, one place.
          `; drawing download ${
            canDownloadDrawings({ fullAccess: input.fullAccess, drawingDownload }, derivedRole)
              ? 'YES'
              : 'no'
          }` +
          ` [role → ${derivedRole}]`,
        refId: userId,
      },
      companyId,
      user,
    );

    return rowToUserAccess(saved);
  });
}
