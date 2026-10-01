// JC Operations — mirrors legacy renderJCOps (HTML L11349). The board is the
// ADR-199 fit table (DataTable + tableKey); its columns and row actions live
// in ../components/jc-ops-columns.tsx.

import {
  type ChangeJcOpMachineInput,
  type GenerateOspPrResult,
  type JcOpsBoardRow,
  type OutsourceOpBalanceInput,
} from '@innovic/shared';
import { opSrNo } from '@innovic/shared';
import { useQueryClient } from '@tanstack/react-query';
import { Link, createRoute } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { itemCodeWithRev } from '@/lib/item-code';
import { useDebounce } from '@/lib/use-debounce';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
// The system OSP PR path Op Entry uses — do not build a parallel one.
import { useGenerateOspPr } from '@/modules/op-entry/api';
import { useVendorsList } from '@/modules/vendors/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Select } from '@/ui/forms';
import { DataTable, Panel } from '@/ui/data';
import { TABLE_KEYS } from '@/ui/data/table-keys';
import { ListHeader, PageState } from '@/ui/layout';
import { useMachinesList } from '../../machines/api';
import { jcOpsBoardKeys, useChangeJcOpMachine, useJcOpsBoard, useOutsourceOpBalance } from '../api';
import {
  JC_OPS_DEFAULT_HIDDEN,
  JC_OPS_DEFAULT_PINNED,
  type JcOpsActionProps,
  jcOpsColumns,
  jcOpsRowMenu,
  renderJcOpsLink,
} from '../components/jc-ops-columns';
import '../jc-ops.css';

export const jcOpsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'jc-ops',
  component: JcOpsPage,
});

function JcOpsPage(): React.JSX.Element {
  // Tier-driven, per department (jc_create sits in Production). Add Operation,
  // Change Machine and Outsource balance all rewrite a saved JC's routing → edit.
  // Create PR is a purchase action — it opens the PR create flow, so it uses the
  // SAME key as that page (pr_create entry), which the server also enforces.
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;
  const canCreatePr = effectiveFormPerms(eff, 'pr_create').entry;
  // ▶ Start / ✚ Log deep links into Op Entry — the same gate the Job Queue
  // uses for the same two links.
  const canOpEntry = effectiveFormPerms(eff, 'op_entry').entry;
  const [jcCode, setJcCode] = useState('');
  // Server-side `?search=` (GET /jc-ops matches JC no., operation, item code
  // and POL). The box shows every keystroke; the query waits 300ms.
  const [searchInput, setSearchInput] = useState('');
  const searchTerm = useDebounce(searchInput.trim(), 300);
  const [editRow, setEditRow] = useState<JcOpsBoardRow | null>(null);
  const [prRow, setPrRow] = useState<JcOpsBoardRow | null>(null);
  const [outsourceRow, setOutsourceRow] = useState<JcOpsBoardRow | null>(null);
  const columns = useMemo(() => jcOpsColumns(), []);
  const actionProps: JcOpsActionProps = {
    canWrite,
    canCreatePr,
    canOpEntry,
    onEdit: setEditRow,
    onCreatePr: setPrRow,
    onOutsource: setOutsourceRow,
  };

  const { data, isLoading, isFetching, isError, error } = useJcOpsBoard({
    jcCode: jcCode || undefined,
    search: searchTerm || undefined,
    limit: 1000,
    offset: 0,
  });

  // Legacy L11400 "+ Add Operation" opened a modal to pick a JC, then added an
  // op to it. Ops are edited on the Job Card edit page, so we link there.
  // The button stays DISABLED until a JC is picked in the filter — an op
  // always belongs to one job card, so there is nothing to add it to before.
  const selectedJc = (data?.jcOptions ?? []).find((j) => j.jcCode === jcCode);

  // "Hide page" (Access Control → Config): once access has loaded, a user whose
  // VIEW was removed for this page sees the no-access panel, not the page. `eff`
  // is undefined only while access loads — don't block then, or every legitimate
  // user flashes this panel on cold load.
  if (eff && !effectiveFormPerms(eff, 'jc_create').view) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view JC Operations. Ask an admin.
      </div>
    );
  }

  return (
    <div>
      <ListHeader
        title="JC Operations"
        icon="⨯"
        count={data?.items.length}
        noun="operation"
        filterNote={jcCode || undefined}
        search={searchInput}
        onSearch={setSearchInput}
        searchPlaceholder="Search JC no., operation, item code, POL…"
        updating={isFetching && !isLoading}
        onClearFilters={() => {
          setSearchInput('');
          setJcCode('');
        }}
        filtersActive={searchInput.trim() !== '' || jcCode !== ''}
        filters={
          <Select
            aria-label="Job Card"
            value={jcCode}
            onChange={(e) => setJcCode(e.target.value)}
            options={[
              { value: '', label: 'All Job Cards' },
              ...(data?.jcOptions ?? []).map((j) => ({ value: j.jcCode, label: j.jcCode })),
            ]}
          />
        }
        primary={
          canWrite ? (
            selectedJc ? (
              <Link
                to="/job-cards/$id/edit"
                params={{ id: selectedJc.jcId }}
                className="btn btn-primary"
              >
                + Add Operation
              </Link>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled
                title="Pick a Job Card in the JC filter first"
              >
                + Add Operation
              </button>
            )
          ) : null
        }
      />

      {isError ? (
        <PageState
          state="error"
          message={error instanceof Error ? error.message : 'Could not load operations. Try again.'}
        />
      ) : (
        <Panel bodyPadding="none">
          <DataTable
            tableKey={TABLE_KEYS.jcOpsBoard}
            columns={columns}
            rows={data?.items ?? []}
            rowKey={(o) => o.jcOpId}
            loading={isLoading}
            emptyText="No Operations yet."
            defaultPinned={JC_OPS_DEFAULT_PINNED}
            defaultHidden={JC_OPS_DEFAULT_HIDDEN}
            // An outsource op keeps its amber tint (jc-ops.css, solid token).
            rowClassName={(o) => (o.opType === 'outsource' ? 'jc-ops-osp-row' : undefined)}
            rowMenu={(o) => jcOpsRowMenu(o, actionProps)}
            renderLink={renderJcOpsLink}
          />
        </Panel>
      )}

      {editRow ? <ChangeMachineModal row={editRow} onClose={() => setEditRow(null)} /> : null}

      {prRow ? <CreatePrModal row={prRow} onClose={() => setPrRow(null)} /> : null}

      {outsourceRow ? (
        <OutsourceBalanceModal row={outsourceRow} onClose={() => setOutsourceRow(null)} />
      ) : null}
    </div>
  );
}

function ChangeMachineModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const [machineId, setMachineId] = useState(row.machineId ?? '');
  const [err, setErr] = useState<string | null>(null);
  const { data: machinesData } = useMachinesList({ limit: 200, offset: 0 });
  const mut = useChangeJcOpMachine();

  // A finished op has no remaining qty to route anywhere, so the server refuses
  // the swap. Say so as the dialog OPENS rather than after a pointless round
  // trip -- the user should not fill in a form that cannot be saved.
  const finished = row.status === 'complete';

  const onSave = (): void => {
    setErr(null);
    if (!machineId) {
      setErr('Machine is required.');
      return;
    }
    const input: ChangeJcOpMachineInput = { machineId };
    mut.mutate(
      { id: row.jcOpId, input },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(e instanceof Error ? e.message : 'Could not change the machine. Try again.'),
      },
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(1100px, 96vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          Change Machine — {row.jcCode} Op {opSrNo(row.opSeq)}
        </div>
        <div
          style={{
            background: 'var(--bg3)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Operation: <b>{row.operation}</b> · Planned machine:{' '}
            <b className="mono">{row.machineCode ?? '—'}</b>
          </div>
          {/* ADR-125 — this used to read "only ... operations that have not yet
              started", which 0095 made false. Spell out what actually happens
              instead: the switch routes the REMAINING qty only, and the pieces
              already made keep their own machine on every report. */}
          {row.machines.length > 1 ? (
            // ADR-126 — after a second swap the completed total spans several
            // machines, so naming only the current one would be a lie. List them.
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Already made:{' '}
              {row.machines.map((m, i) => (
                <span key={m.machineCode}>
                  {i > 0 ? ' · ' : ''}
                  <b style={{ color: 'var(--text2)' }}>{m.machineCode}</b>: {m.qty} pcs
                </span>
              ))}
              . Each stays recorded against its own machine. The new machine takes the remaining{' '}
              <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs.
            </div>
          ) : row.completed > 0 ? (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              {row.completed} pcs already made stay recorded against{' '}
              <b style={{ color: 'var(--text2)' }}>
                {row.machines[0]?.machineCode ?? row.machineCode ?? 'the planned machine'}
              </b>
              . The new machine takes the remaining{' '}
              <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs.
            </div>
          ) : (
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
              Nothing logged yet — the new machine takes all{' '}
              <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs.
            </div>
          )}
        </div>
        <div>
          <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
            Assign Machine <span className="req">★</span>
          </div>
          <select
            className="innovic-select"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
            style={{ width: '100%', fontSize: 12 }}
          >
            <option value="">— Select machine —</option>
            {(machinesData?.machines ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.code} — {m.name}
              </option>
            ))}
          </select>
        </div>
        {finished || err ? (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              background: 'rgba(239,68,68,0.08)',
              border: '1px solid var(--red)',
              color: 'var(--red2)',
              borderRadius: 6,
              fontSize: 12,
              lineHeight: 1.5,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
            }}
          >
            <span aria-hidden="true" style={{ fontSize: 14, fontWeight: 700, lineHeight: 1.3 }}>
              &#10007;
            </span>
            <span>
              {err ?? 'This operation is Completed — nothing is left to run on another machine.'}
            </span>
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {finished ? 'Close' : 'Cancel'}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={mut.isPending || finished}
          >
            {mut.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Saving…
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Raise the Purchase Request for a pending outsource op. Routed through the
// SYSTEM OSP PR path (POST /op-entry/osp-pr → generateOspPr), the same one Op
// Entry uses (2026-09-28 form audit). The old hand form POSTed to
// /purchase-requests with sourceJcOpId, which the server refuses for every
// hand-raised request ("a Job Work OSP request is raised by the system"), so
// the op never got its PR from this board. The system path numbers the PR
// itself (IN-JWPR-#####), takes the vendor from System Settings → OSP
// Processes and the qty from the Job Card, and stamps the op pr_raised — so
// there is nothing to type: this is a confirm box that shows the number after.
function CreatePrModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const qc = useQueryClient();
  const generate = useGenerateOspPr();
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateOspPrResult | null>(null);

  const onSave = (): void => {
    setErr(null);
    generate.mutate(
      { jcOpId: row.jcOpId },
      {
        onSuccess: (res) => {
          // Reflect the op's new pr_raised state on the board immediately.
          void qc.invalidateQueries({ queryKey: jcOpsBoardKeys.all });
          setResult(res);
        },
        onError: (e) => setErr(e instanceof Error ? e.message : 'Could not raise PR. Try again.'),
      },
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(560px, 96vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          Create Purchase Request — {row.jcCode} Op {opSrNo(row.opSeq)}
        </div>
        <div
          style={{
            background: 'var(--bg3)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Operation: <b>{row.operation}</b> · Planned machine:{' '}
            <b className="mono">{row.machineCode ?? '—'}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {/* POL — the CUSTOMER's own PO line number, ahead of the item code.
                Omitted when there is no sales order behind this job card. */}
            {row.clientPoLineNo ? (
              <>
                POL{' '}
                <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                  {row.clientPoLineNo}
                </span>{' '}
                ·{' '}
              </>
            ) : null}
            Item:{' '}
            {/* The code carries weight even on a muted context line -- it is the
                value someone checks before acting in this modal. */}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCodeWithRev(row.jcItemCode, row.itemRevision)}
            </span>{' '}
            · PR Qty <b style={{ color: 'var(--text)' }}>{row.jcOrderQty}</b> (the Job Card&apos;s
            Order Qty)
          </div>
        </div>

        {result ? (
          <div
            role="status"
            style={{
              padding: '10px 12px',
              background: 'var(--green3)',
              border: '1px solid var(--green)',
              color: 'var(--green2)',
              borderRadius: 6,
              fontSize: 12,
            }}
          >
            PR <b className="mono">{result.prCode}</b> raised
            {result.vendorName ? (
              <>
                {' '}
                for <b>{result.vendorName}</b>
              </>
            ) : null}
            {result.autoPoCreated && result.poCode ? (
              <>
                {' '}
                · draft PO <b className="mono">{result.poCode}</b> created
              </>
            ) : null}
            . It now waits for approval on the Purchase Request list.
          </div>
        ) : (
          <div className="text3" style={{ fontSize: 12 }}>
            The system numbers this request (IN-JWPR-#####), takes the vendor from System Settings →
            OSP Processes for &ldquo;{row.operation}&rdquo;, and shows the number here once saved.
          </div>
        )}

        {err ? (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: 8,
              background: 'var(--red3)',
              color: 'var(--red2)',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {result ? 'Close' : 'Cancel'}
          </button>
          {result ? null : (
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSave}
              disabled={generate.isPending}
            >
              {generate.isPending ? (
                <>
                  <Loader2 size={14} className="inline animate-spin" /> Raising…
                </>
              ) : (
                'Raise PR'
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Outsource the remaining qty of an in-house PROCESS op (ADR-081 dual-lane).
// Prefills qty to the op's `available` (also the max) and resolves the vendor
// against the vendors master. Submitting POSTs to /jc-ops/:id/outsource-balance
// which validates qty ≤ available, stamps the op's outsource vendor, and raises
// a jw_osp PR; the existing OSP PR→PO→DC→GRN→QC flow reconciles the balance.
function OutsourceBalanceModal({
  row,
  onClose,
}: {
  row: JcOpsBoardRow;
  onClose: () => void;
}): React.JSX.Element {
  const outsource = useOutsourceOpBalance();
  const [qty, setQty] = useState<number>(row.available);
  const [vendorCode, setVendorCode] = useState<string>(row.outsourceVendorCode ?? '');
  // "CODE — Name" of the picked vendor, kept so the label survives the search
  // page moving on. Seeded with the op's current vendor code.
  const [vendorLabel, setVendorLabel] = useState<string>(row.outsourceVendorCode ?? '');
  // The vendor box searches the SERVER (?search=) — a fixed first page of 200
  // left every vendor after it unpickable. The saved value is still the CODE.
  const [vendorSearch, setVendorSearch] = useState('');
  // Active vendors only (A10): a disabled vendor is not offered for a NEW pick.
  // The op's current vendor still reads right via vendorLabel / its code.
  const { data: vendorsData, isFetching: vendorsFetching } = useVendorsList({
    ...(vendorSearch.trim() ? { search: vendorSearch.trim() } : {}),
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const vendorOptions = (vendorsData?.vendors ?? []).map((v) => ({
    id: v.id,
    code: v.code,
    name: v.name,
  }));
  const pickedVendor = vendorCode ? vendorOptions.find((v) => v.code === vendorCode) : undefined;
  const pickedLabel = pickedVendor
    ? `${pickedVendor.code} — ${pickedVendor.name}`
    : vendorCode
      ? vendorLabel || vendorCode
      : undefined;
  const [err, setErr] = useState<string | null>(null);

  const onSave = (): void => {
    setErr(null);
    if (qty <= 0 || qty > row.available) {
      setErr(`Qty must be between 1 and Available (${row.available}).`);
      return;
    }
    if (!vendorCode.trim()) {
      setErr('Vendor is required.');
      return;
    }
    const input: OutsourceOpBalanceInput = { qty, vendorCode: vendorCode.trim() };
    outsource.mutate(
      { id: row.jcOpId, input },
      {
        onSuccess: () => onClose(),
        onError: (e) =>
          setErr(
            e instanceof Error ? e.message : 'Could not outsource the pending qty. Try again.',
          ),
      },
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 20,
          width: 'min(480px, 96vw)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="section-hdr" style={{ marginBottom: 14 }}>
          Outsource Available Qty — {row.jcCode} Op {opSrNo(row.opSeq)}
        </div>
        <div
          style={{
            background: 'var(--bg3)',
            padding: '10px 14px',
            borderRadius: 8,
            marginBottom: 14,
            border: '1px solid var(--border)',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            Operation: <b>{row.operation}</b> · Planned machine:{' '}
            <b className="mono">{row.machineCode ?? '—'}</b>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
            {/* POL — the CUSTOMER's own PO line number, ahead of the item code. */}
            {row.clientPoLineNo ? (
              <>
                POL{' '}
                <span className="mono" style={{ color: 'var(--purple)', fontWeight: 700 }}>
                  {row.clientPoLineNo}
                </span>{' '}
                ·{' '}
              </>
            ) : null}
            Item:{' '}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCodeWithRev(row.jcItemCode, row.itemRevision)}
            </span>{' '}
            · Available: <b style={{ color: 'var(--amber2)' }}>{row.available}</b> pcs. Sends this
            qty to a vendor as an OSP purchase request.
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 120px' }}>
            <div
              className="text3"
              style={{
                fontSize: 11,
                marginBottom: 4,
                color: 'var(--amber2)',
              }}
            >
              Qty to Outsource <span className="req">★</span>
            </div>
            <input
              type="number"
              min={1}
              max={row.available}
              className="innovic-select"
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              style={{ width: '100%', fontSize: 12 }}
            />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <div className="text3" style={{ fontSize: 11, marginBottom: 4 }}>
              Vendor <span className="req">★</span>
            </div>
            <SearchableSelect
              id="outsource-balance-vendor"
              value={pickedVendor?.id ?? null}
              onChange={(id) => {
                const v = id ? vendorOptions.find((x) => x.id === id) : undefined;
                setVendorCode(v?.code ?? '');
                setVendorLabel(v ? `${v.code} — ${v.name}` : '');
              }}
              onSearch={setVendorSearch}
              loading={vendorsFetching}
              options={vendorOptions}
              placeholder="🔍 Vendor code or name"
              valueLabel={pickedLabel}
              selectedLabel={(v) => (v.code ? `${v.code} — ${v.name}` : v.name)}
            />
          </div>
        </div>

        {err ? (
          <div
            style={{
              marginTop: 12,
              padding: 8,
              background: 'rgba(239,68,68,0.08)',
              color: 'var(--red2)',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            {err}
          </div>
        ) : null}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            disabled={outsource.isPending}
          >
            {outsource.isPending ? (
              <>
                <Loader2 size={14} className="inline animate-spin" /> Outsourcing…
              </>
            ) : (
              'Outsource Available'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
