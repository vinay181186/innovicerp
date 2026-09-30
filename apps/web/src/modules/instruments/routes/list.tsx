// Instrument Register (ADR-193 phase 4a) — one row per serial-tracked Tool /
// Instrument piece: Instrument Status, calibration dates, who holds it. Click a
// row for its calibration history and actions. Registering never moves stock;
// the strip above the table lists pieces received but not yet registered.
import {
  INSTRUMENT_STATUSES,
  INSTRUMENT_STATUS_LABELS,
  type InstrumentStatus,
} from '@innovic/shared';
import { createRoute } from '@tanstack/react-router';
import { Loader2, Plus } from 'lucide-react';
import { useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate } from '@/lib/date';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Banner } from '@/ui/feedback';
import { Select } from '@/ui/forms';
import { ListFooter, ListHeader } from '@/ui/layout';
import { useInstrumentsList, useUnregisteredInstruments } from '../api';
import { InstrumentDetailModal } from '../components/instrument-detail-modal';
import {
  RegisterInstrumentModal,
  type RegisterSeed,
} from '../components/register-instrument-modal';
import { DUE_COLOUR, INSTRUMENT_STATUS_BADGE, dueTone } from '../lib/instrument-ui';

const PAGE_SIZE = 50;
type DueFilter = '' | 'week' | 'overdue';

export const instrumentsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'instruments',
  component: InstrumentsListPage,
});

function InstrumentsListPage(): React.JSX.Element {
  // Same form key as Tool Issue: the storekeeper who issues instruments keeps
  // their register. view → the page, entry → register / calibrate / scrap.
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'toolissue_create');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<InstrumentStatus | ''>('');
  const [due, setDue] = useState<DueFilter>('');
  const [page, setPage] = useState(1);
  // undefined = closed; null = open with no item chosen.
  const [registerSeed, setRegisterSeed] = useState<RegisterSeed | null | undefined>(undefined);
  const [viewId, setViewId] = useState<string | null>(null);

  const allowed = !eff || perms.view;
  const { data, isLoading, isError, error } = useInstrumentsList(
    {
      search: search.trim() || undefined,
      status: status || undefined,
      due: due || undefined,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    },
    allowed,
  );
  const { data: unregistered } = useUnregisteredInstruments();
  const pending = (unregistered ?? []).filter((u) => u.unregisteredQty > 0);

  if (!allowed) {
    return (
      <div className="empty-state" style={{ color: 'var(--amber2)', padding: 40 }}>
        You do not have permission to view the Instrument Register. Ask an admin.
      </div>
    );
  }

  const filtered = Boolean(search.trim() || status || due);

  return (
    <div>
      <ListHeader
        title="Instrument Register"
        icon="📏"
        count={data?.total}
        noun="instrument"
        search={search}
        onSearch={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search item code, name, Instrument Serial No., location, held by…"
        filters={
          <>
            <Select
              value={status}
              aria-label="Instrument Status"
              onChange={(e) => {
                setStatus(e.target.value as InstrumentStatus | '');
                setPage(1);
              }}
              options={[
                { value: '', label: 'All' },
                ...INSTRUMENT_STATUSES.map((s) => ({
                  value: s,
                  label: INSTRUMENT_STATUS_LABELS[s],
                })),
              ]}
            />
            <Select
              value={due}
              aria-label="Calibration Due"
              onChange={(e) => {
                setDue(e.target.value as DueFilter);
                setPage(1);
              }}
              options={[
                { value: '', label: 'Any Calibration Due' },
                { value: 'week', label: 'Due in 7 days' },
                { value: 'overdue', label: 'Overdue' },
              ]}
            />
          </>
        }
        filtersActive={filtered}
        onClearFilters={() => {
          setSearch('');
          setStatus('');
          setDue('');
          setPage(1);
        }}
        primary={
          perms.entry ? (
            <button type="button" className="btn btn-primary" onClick={() => setRegisterSeed(null)}>
              <Plus size={14} /> Register Instrument
            </button>
          ) : null
        }
      />

      {pending.length > 0 ? (
        <Banner tone="info" title="Received but not registered">
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            {pending.map((u) => (
              <span key={u.itemId} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                <span className="mono fw-700" style={{ color: 'var(--text)' }}>
                  {u.itemCode}
                </span>
                × <span className="mono">{u.unregisteredQty}</span>
                {perms.entry ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setRegisterSeed({ itemId: u.itemId, itemCode: u.itemCode })}
                  >
                    Register
                  </button>
                ) : null}
              </span>
            ))}
          </div>
        </Banner>
      ) : null}

      <div className="panel">
        {isLoading ? (
          <div className="panel-body text3">
            <Loader2 size={14} className="inline animate-spin" /> Loading…
          </div>
        ) : isError ? (
          <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load instruments.'}
          </div>
        ) : (
          <div className="tbl-wrap">
            <table className="innovic-table tbl-grid">
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Item Name</th>
                  <th>Instrument Serial No.</th>
                  <th>Instrument Status</th>
                  <th>Calibration Due</th>
                  <th>Last Calibrated</th>
                  <th>Location</th>
                  <th>Held By</th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).map((ins) => {
                  const tone = dueTone(ins.calibrationDueOn, ins.isCalibrationOverdue);
                  return (
                    <tr
                      key={ins.id}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setViewId(ins.id)}
                    >
                      <td>
                        <span className="td-code mono fw-700" style={{ color: 'var(--text)' }}>
                          {ins.itemCode}
                        </span>
                      </td>
                      <td
                        title={ins.itemName ?? ''}
                        style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {ins.itemName || '—'}
                      </td>
                      <td className="mono fw-700" style={{ whiteSpace: 'nowrap' }}>
                        {ins.serialNo}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`badge ${INSTRUMENT_STATUS_BADGE[ins.status]}`}>
                          {INSTRUMENT_STATUS_LABELS[ins.status]}
                        </span>
                        {ins.writeoffPending ? (
                          <span className="badge b-red" style={{ marginLeft: 4 }}>
                            Write-off pending
                          </span>
                        ) : null}
                      </td>
                      <td
                        style={{
                          whiteSpace: 'nowrap',
                          color: DUE_COLOUR[tone],
                          fontWeight: tone === 'overdue' || tone === 'soon' ? 700 : undefined,
                        }}
                      >
                        {fmtDate(ins.calibrationDueOn)}
                        {tone === 'overdue' ? ' · Overdue' : ''}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtDate(ins.lastCalibratedOn)}</td>
                      <td
                        title={ins.location ?? ''}
                        style={{ maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {ins.location || '—'}
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {ins.heldBy || '—'}
                        {ins.toolIssueCode ? (
                          <span className="mono" style={{ marginLeft: 6, color: 'var(--purple)' }}>
                            {ins.toolIssueCode}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
                {(data?.items ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={8} className="empty-state">
                      {filtered ? 'No instruments match.' : 'No instruments registered yet.'}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {data ? (
        <ListFooter
          total={data.total}
          shown={data.items.length}
          noun="instrument"
          page={page}
          pageSize={PAGE_SIZE}
          onPage={setPage}
        />
      ) : null}

      {registerSeed !== undefined && perms.entry ? (
        <RegisterInstrumentModal seed={registerSeed} onClose={() => setRegisterSeed(undefined)} />
      ) : null}
      {viewId ? (
        <InstrumentDetailModal
          instrumentId={viewId}
          canAct={perms.entry}
          onClose={() => setViewId(null)}
        />
      ) : null}
    </div>
  );
}
