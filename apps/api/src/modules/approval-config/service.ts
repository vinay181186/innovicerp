// Approval Configuration service.
//
// Single row per company (1:1 with the company). Admin-only writes; any
// authenticated caller in the company can read so the PO list can show
// "you can approve" badges. Mirror of legacy db.approvalConfig.

import {
  APPROVAL_CONFIG_DEFAULTS,
  type ApprovalConfig,
  type ApprovalHistoryResponse,
  type SaveApprovalConfigInput,
} from '@innovic/shared';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { activityLog, approvalConfig, users } from '../../db/schema';
import { type AuthContext, withUserContext } from '../../db/with-user-context';
import { requireAdminRole } from '../../lib/auth';
import { AuthorizationError } from '../../lib/errors';
import { emitActivityLog } from '../activity-log/service';

const requireCompany = (user: AuthContext): string => {
  if (!user.companyId) throw new AuthorizationError('User is not assigned to a company');
  return user.companyId;
};

function toConfig(row: {
  poApproval: boolean;
  poManagerLimit: string;
  prApproval: boolean;
  invoiceApproval: boolean;
  poApprovers: unknown;
}): ApprovalConfig {
  const approvers = Array.isArray(row.poApprovers) ? (row.poApprovers as string[]) : [];
  return {
    poApproval: row.poApproval,
    poManagerLimit: Number(row.poManagerLimit),
    prApproval: row.prApproval,
    invoiceApproval: row.invoiceApproval,
    poApprovers: approvers.filter((s) => typeof s === 'string'),
  };
}

export async function getApprovalConfig(user: AuthContext): Promise<ApprovalConfig> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select()
      .from(approvalConfig)
      .where(and(eq(approvalConfig.companyId, companyId), isNull(approvalConfig.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return { ...APPROVAL_CONFIG_DEFAULTS };
    return toConfig(row);
  });
}

export async function saveApprovalConfig(
  input: SaveApprovalConfigInput,
  user: AuthContext,
): Promise<ApprovalConfig> {
  requireAdminRole(user);
  const companyId = requireCompany(user);

  // Validate the approver IDs are real users in the same company (anything
  // bogus is silently dropped — same defensive stance as access-control).
  const approverIds = [...new Set(input.poApprovers)];
  let validApproverIds: string[] = [];

  return withUserContext(user, async (tx) => {
    if (approverIds.length > 0) {
      const found = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            inArray(users.id, approverIds),
            eq(users.companyId, companyId),
            isNull(users.deletedAt),
          ),
        );
      validApproverIds = found.map((f) => f.id);
    }

    const existingRows = await tx
      .select()
      .from(approvalConfig)
      .where(and(eq(approvalConfig.companyId, companyId), isNull(approvalConfig.deletedAt)))
      .limit(1);
    const existing = existingRows[0];

    let saved;
    if (existing) {
      const updated = await tx
        .update(approvalConfig)
        .set({
          poApproval: input.poApproval,
          poManagerLimit: String(input.poManagerLimit),
          prApproval: input.prApproval,
          invoiceApproval: input.invoiceApproval,
          poApprovers: validApproverIds,
          updatedBy: user.id,
          updatedAt: new Date(),
        })
        .where(eq(approvalConfig.id, existing.id))
        .returning();
      saved = updated[0]!;
    } else {
      const inserted = await tx
        .insert(approvalConfig)
        .values({
          companyId,
          poApproval: input.poApproval,
          poManagerLimit: String(input.poManagerLimit),
          prApproval: input.prApproval,
          invoiceApproval: input.invoiceApproval,
          poApprovers: validApproverIds,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning();
      saved = inserted[0]!;
    }

    await emitActivityLog(
      tx,
      {
        action: 'CONFIG',
        entity: 'Approval Configuration',
        detail: `PO approval: ${input.poApproval ? 'ON' : 'OFF'} · limit ₹${input.poManagerLimit} · invoice approval: ${input.invoiceApproval ? 'ON' : 'OFF'} · approvers: ${validApproverIds.length}`,
        refId: null,
      },
      companyId,
      user,
    );

    return toConfig(saved);
  });
}

const APPROVAL_HISTORY_ACTIONS = ['APPROVE', 'REJECT', 'PAYMENT'] as const;
const APPROVAL_HISTORY_LIMIT = 20;

export async function getApprovalHistory(user: AuthContext): Promise<ApprovalHistoryResponse> {
  const companyId = requireCompany(user);
  return withUserContext(user, async (tx) => {
    const rows = await tx
      .select({
        id: activityLog.id,
        ts: activityLog.ts,
        action: activityLog.action,
        entity: activityLog.entity,
        detail: activityLog.detail,
        refId: activityLog.refId,
        userId: activityLog.userId,
        userName: users.fullName,
      })
      .from(activityLog)
      .leftJoin(users, eq(users.id, activityLog.userId))
      .where(
        and(
          eq(activityLog.companyId, companyId),
          or(...APPROVAL_HISTORY_ACTIONS.map((a) => eq(activityLog.action, a))),
        ),
      )
      .orderBy(desc(activityLog.ts))
      .limit(APPROVAL_HISTORY_LIMIT);

    return {
      items: rows.map((r) => ({
        id: r.id,
        ts: r.ts.toISOString(),
        action: r.action,
        entity: r.entity,
        detail: r.detail ?? '',
        refId: r.refId,
        userId: r.userId,
        userName: r.userName,
      })),
    };
  });
}
