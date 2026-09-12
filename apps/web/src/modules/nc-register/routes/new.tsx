// Report NC route (UI-003-06).

import type { CreateNcRegisterInput } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { z } from 'zod';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { useExitConfirm } from '@/lib/exit-guard';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useCreateNcRegister } from '../api';
import { NcRegisterForm } from '../components/nc-register-form';

// Everything is OPTIONAL: this screen is still opened bare from "+ Report NC".
// When a QC operation card sends the user here it hands over the job card, the
// item and the operation that rejected the pieces, so the inspector types the
// defect and nothing else. Same shape as purchase-orders/routes/from-pr.tsx.
// Values arrive as URL strings; opSeq / rejectedQty are turned into numbers
// below and silently dropped if they are not numbers.
const ncNewSearchSchema = z.object({
  jobCardId: z.string().uuid().optional(),
  jcOpId: z.string().uuid().optional(),
  opSeq: z.string().optional(),
  operation: z.string().optional(),
  itemId: z.string().uuid().optional(),
  itemCode: z.string().optional(),
  itemName: z.string().optional(),
  rejectedQty: z.string().optional(),
});

export const ncRegisterNewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'nc-register/new',
  validateSearch: ncNewSearchSchema,
  component: NcRegisterNewPage,
});

// "12" → 12; "", "abc", undefined → undefined (the field just stays empty).
function toInt(v: string | undefined): number | undefined {
  if (v == null || v.trim() === '') return undefined;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? undefined : n;
}

function NcRegisterNewPage(): React.JSX.Element {
  const search = ncRegisterNewRoute.useSearch();
  const navigate = useNavigate();
  const create = useCreateNcRegister();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goBack = useCallback(() => void navigate({ to: '/nc-register' }), [navigate]);
  const exit = useExitConfirm({ onExit: goBack });
  // Tier-driven, per department (QC). The ❌ Report NC button is hidden from
  // anyone without entry rights, but this screen had no gate of its own —
  // typing the URL still handed over the form (an L1 Viewer, an L4 Approver).
  const { data: eff, isLoading: accessLoading } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'nc_dispose');

  // What the op card handed over, mapped onto the form's own field names
  // (operation → operationText, itemCode → itemCodeText, …). Absent keys are
  // left out entirely so the form's own defaults still apply.
  //
  // itemCode arrives BARE and must stay bare. It seeds itemCodeText, which is
  // submitted and stored as the NC's durable snapshot of the part — a customer's
  // drawing revision appended here would be written into the record as if it
  // were part of the code. The revision is shown on the NC's READ screens, where
  // it is joined live off the SO line, never carried in through this seed.
  const opSeq = toInt(search.opSeq);
  const rejectedQty = toInt(search.rejectedQty);
  const seed = {
    ...(search.jobCardId ? { jobCardId: search.jobCardId } : {}),
    ...(search.jcOpId ? { jcOpId: search.jcOpId } : {}),
    ...(opSeq != null ? { opSeq } : {}),
    ...(search.operation ? { operationText: search.operation } : {}),
    ...(search.itemId ? { itemId: search.itemId } : {}),
    ...(search.itemCode ? { itemCodeText: search.itemCode } : {}),
    ...(search.itemName ? { itemNameText: search.itemName } : {}),
    ...(rejectedQty != null ? { rejectedQty } : {}),
  };

  if (accessLoading) {
    return (
      <div>
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading NC Register…
      </div>
    );
  }

  if (!perms.entry) {
    return (
      <div className="panel">
        <div className="panel-body">
          <div style={{ marginBottom: 8 }}>
            <Link to="/nc-register" className="btn btn-ghost btn-sm">
              <ArrowLeft size={14} /> Back to NC Register
            </Link>
          </div>
          <div className="empty-state" style={{ color: 'var(--amber)' }}>
            ⛔ You do not have create access to NC Register. Ask an admin for L2 Data Entry or above
            in QC.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {exit.dialog}
      <Link to="/nc-register" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to NC Register
      </Link>
      <div className="panel">
        <div className="panel-hdr">
          <div>
            <div className="panel-title">❌ Report Non-Conformance</div>
            <div className="text3" style={{ fontSize: 11, marginTop: 2 }}>
              Status starts as <span className="mono">pending</span> until disposition.
            </div>
          </div>
        </div>
        <div className="panel-body">
          <NcRegisterForm
            mode="create"
            initial={seed}
            submitError={submitError}
            submitLabel="Save"
            onCancel={() => exit.leave(goBack)}
            onSubmit={async (values: CreateNcRegisterInput) => {
              setSubmitError(null);
              try {
                const created = await create.mutateAsync(values);
                exit.leave(
                  () => void navigate({ to: '/nc-register/$id', params: { id: created.id } }),
                );
              } catch (e) {
                setSubmitError(e instanceof Error ? e.message : 'Failed to report NC.');
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
