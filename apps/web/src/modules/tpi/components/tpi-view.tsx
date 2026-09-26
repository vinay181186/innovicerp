// TPI — Third Party Inspection (legacy renderTPI L21381). Pending TPI ops with
// an inline TPI entry form (accept/reject + Inspector/Organization/Cert No) +
// completed TPI records table. The submit reuses op-entry submitQcLog with
// isTpi + tpi metadata (op_log, migration 0037). Legacy chrome.
//
// Extracted from tpi/routes/index.tsx so the same screen can render both as its
// own route AND as the "🔍 TPI" tab on QC Call Register (screen-merge audit).
// All state here is local — TPI has no URL-driven search params — so the view
// is safe to mount inside another route. Pass `title` when it IS the page.

import {
  SHIFTS,
  SHIFT_LABELS,
  type Shift,
  type SubmitQcLogInput,
  type TpiCompletedRow,
  type TpiPendingRow,
  opSrNo,
} from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { QcReportAttach, QcReportLink } from '@/components/shared/qc-report-attach';
import { matchesSearchTerm } from '@/components/shared/search-match';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { ListHeader } from '@/ui/layout';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { fmtDate, todayIst, todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { useSubmitQcLog } from '@/modules/op-entry/api';
import { useTpiMastersList } from '@/modules/tpi-masters/api';
import { useTpi } from '../api';

// Excel export of completed TPI records (legacy _tpiExport L21572 / "⬇ Excel"
// button). Client-side from the loaded `completed` rows — columns mirror the
// legacy completed table. xlsx is dynamic-imported so the cost only lands when
// the user actually exports.
async function exportTpiRecords(rows: TpiCompletedRow[]): Promise<void> {
  const { utils: xlsxUtils, write: xlsxWrite } = await import('xlsx');
  const respLabel = (d: number | null): string =>
    d === null ? '' : d <= 0 ? 'Same day' : `${d} day${d === 1 ? '' : 's'}`;
  const aoa: (string | number)[][] = [
    [
      'JC No.',
      'Op',
      'SO No.',
      // POL — the CUSTOMER's own purchase-order line number, its own column
      // immediately before the item code, as on every other export.
      'POL',
      'Item Code',
      // The drawing revision gets its own column instead of riding inside the
      // item code as CODE/REV. This sheet is filtered and VLOOKUP-ed against
      // Item Master, where a slashed code matches nothing. Same call as the Job
      // Card export.
      'Drawing Rev',
      // The part name is a column of its own for the same reason, and it earns
      // its place because a job-card number says WHICH JOB and not which part —
      // whoever reads this sheet back needs the part named, not just coded.
      'Item Name',
      'Operation',
      'Accepted',
      'Rejected',
      'Call Date',
      'TPI Date',
      'Days to Attend',
      'Inspector Name',
      'Organisation',
      'TPI Certificate No.',
    ],
    ...rows.map((l) => [
      l.jcCode,
      `Op ${opSrNo(l.opSeq)}`,
      l.soCode ?? '',
      l.clientPoLineNo ?? '',
      l.itemCode ?? '',
      l.itemRevision ?? '',
      l.itemName ?? '',
      l.operation,
      l.accepted,
      l.rejected,
      l.callDate ?? '',
      l.attendedDate,
      respLabel(l.respDays),
      l.inspector ?? '',
      l.organization ?? '',
      l.certNo ?? '',
    ]),
  ];
  const sheet = xlsxUtils.aoa_to_sheet(aoa);
  const wb = xlsxUtils.book_new();
  xlsxUtils.book_append_sheet(wb, sheet, 'TPI Records');
  const buf = xlsxWrite(wb, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([buf], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TPI_Records_${todayIst()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function TpiView(props: { title?: string }): React.JSX.Element {
  const { data, isLoading, isFetching, isError, error } = useTpi();
  const [openId, setOpenId] = useState<string | null>(null);

  // Client-side search over the rows already loaded — every text column the
  // two lists show (JC, SO, POL, item code / name, operation, inspector,
  // organisation, certificate).
  const [term, setTerm] = useState('');
  const pending = (data?.pending ?? []).filter((o) =>
    matchesSearchTerm(
      [o.jcCode, o.soCode, o.clientPoLineNo, o.itemCode, o.itemRevision, o.itemName, o.operation],
      term,
    ),
  );
  const completed = (data?.completed ?? []).filter((l) =>
    matchesSearchTerm(
      [
        l.jcCode,
        l.soCode,
        l.clientPoLineNo,
        l.itemCode,
        l.itemRevision,
        l.itemName,
        l.operation,
        l.inspector,
        l.organization,
        l.certNo,
      ],
      term,
    ),
  );

  return (
    <div>
      <ListHeader
        title={props.title ?? 'TPI'}
        icon="🔍"
        count={data ? pending.length : undefined}
        noun="pending TPI call"
        search={term}
        onSearch={setTerm}
        searchPlaceholder="Search JC, SO, POL, item, operation, inspector, certificate…"
        updating={isFetching && !isLoading}
        tools={
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            title="Export the completed TPI records on screen to Excel"
            disabled={completed.length === 0}
            onClick={() => void exportTpiRecords(completed)}
          >
            ⬇ Export
          </button>
        }
      />

      {isLoading ? (
        <div className="panel">
          <div className="empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading TPI…
          </div>
        </div>
      ) : isError || !data ? (
        <div className="panel">
          <div className="empty-state" style={{ color: 'var(--red2)' }}>
            {error instanceof Error ? error.message : 'Could not load TPI. Try again.'}
          </div>
        </div>
      ) : (
        <>
          <div className="panel" style={{ marginBottom: 16 }}>
            {/* Legacy L21472 hand-rolls this strip rather than using .panel-hdr /
                .panel-title (13px bold on --bg4, 10/14 padding) — mirrored. */}
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--bg4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                <span style={{ color: 'var(--amber2)' }}>⏳</span> Pending TPI ({pending.length})
              </span>
            </div>
            <div style={{ padding: 10 }}>
              {pending.length === 0 ? (
                <div className="empty-state" style={{ padding: 20, color: 'var(--green2)' }}>
                  ✅ No pending TPI calls
                </div>
              ) : (
                pending.map((o) => (
                  <PendingTpi
                    key={o.jcOpId}
                    o={o}
                    open={openId === o.jcOpId}
                    onToggle={() => setOpenId(openId === o.jcOpId ? null : o.jcOpId)}
                    onDone={() => setOpenId(null)}
                  />
                ))
              )}
            </div>
          </div>

          <div className="panel">
            {/* Legacy L21477 hand-rolls this strip too — same shape as Pending. */}
            <div
              style={{
                padding: '10px 14px',
                background: 'var(--bg4)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13 }}>
                <span style={{ color: 'var(--green2)' }}>✅</span> Completed TPI ({completed.length}
                )
              </span>
            </div>
            <div className="tbl-wrap">
              <table className="innovic-table tbl-grid">
                <thead>
                  <tr>
                    <th>JC No.</th>
                    <th>Op</th>
                    <th>SO No.</th>
                    {/* POL — the CUSTOMER's own purchase-order line number,
                        immediately before the item code. */}
                    <th style={{ color: 'var(--purple)' }}>POL</th>
                    <th>Item Code</th>
                    {/* The item code says which part number was inspected but not
                        what the part IS, so the name gets its own column next to
                        it rather than being crammed into the same cell. */}
                    <th>Item Name</th>
                    <th>Operation</th>
                    <th className="th-num">Accepted</th>
                    <th className="th-num">Rejected</th>
                    <th>Call Date</th>
                    <th>TPI Date</th>
                    <th>Days to Attend</th>
                    <th>Inspector Name</th>
                    <th>Organisation</th>
                    <th>TPI Certificate No.</th>
                    <th>Report</th>
                  </tr>
                </thead>
                <tbody>
                  {completed.length === 0 ? (
                    <tr>
                      <td colSpan={16} className="empty-state">
                        No TPI records yet.
                      </td>
                    </tr>
                  ) : (
                    completed.map((l, i) => (
                      // Legacy L21451 stripes rows inline: odd --bg, even --bg3.
                      // `.innovic-table tbody tr:nth-child(even) td` already paints
                      // the even ones (td beats tr), so this supplies the --bg the
                      // odd rows would otherwise miss.
                      <tr
                        key={l.logId}
                        style={{ background: i % 2 === 0 ? 'var(--bg)' : 'var(--bg3)' }}
                      >
                        <td className="fw-700 cyan" style={{ fontSize: 12 }}>
                          {l.jcCode}
                        </td>
                        <td style={{ fontSize: 11 }}>Op {opSrNo(l.opSeq)}</td>
                        <td style={{ fontSize: 11, color: 'var(--cyan)' }}>{l.soCode ?? '—'}</td>
                        <td className="mono fw-700" style={{ color: 'var(--purple)' }}>
                          {l.clientPoLineNo ?? '—'}
                        </td>
                        <td className="mono fw-700" style={{ fontSize: 11, color: 'var(--text)' }}>
                          {itemCodeWithRev(l.itemCode, l.itemRevision)}
                        </td>
                        {/* A part name is free text of any length, so it is capped
                            and clipped rather than allowed to stretch a row that
                            already carries thirteen other columns; the full name
                            stays available on hover. An item the join could not
                            resolve prints nothing at all — a dash here would read
                            as a part deliberately left unnamed. */}
                        <td
                          className="fw-700"
                          style={{
                            fontSize: 11,
                            maxWidth: 180,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          {...(l.itemName ? { title: l.itemName } : {})}
                        >
                          {l.itemName ? l.itemName : null}
                        </td>
                        <td style={{ fontSize: 11 }}>{l.operation}</td>
                        <td className="td-num mono fw-700" style={{ color: 'var(--green2)' }}>
                          {l.accepted}
                        </td>
                        <td
                          className="td-num mono fw-700"
                          style={{ color: l.rejected > 0 ? 'var(--red2)' : 'var(--text3)' }}
                        >
                          {l.rejected}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--amber2)' }}>
                          {fmtDate(l.callDate)}
                        </td>
                        <td style={{ fontSize: 11, color: 'var(--green2)' }}>
                          {fmtDate(l.attendedDate)}
                        </td>
                        <td
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color:
                              l.respDays !== null && l.respDays <= 0
                                ? 'var(--green)'
                                : 'var(--amber)',
                          }}
                        >
                          {l.respDays === null
                            ? '—'
                            : l.respDays <= 0
                              ? 'Same day'
                              : `${l.respDays} day${l.respDays === 1 ? '' : 's'}`}
                        </td>
                        <td style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)' }}>
                          {l.inspector ?? '—'}
                        </td>
                        <td className="text2" style={{ fontSize: 11 }}>
                          {l.organization ?? '—'}
                        </td>
                        <td style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)' }}>
                          {l.certNo ?? '—'}
                        </td>
                        <td style={{ fontSize: 11 }}>
                          {l.qcReportPath ? (
                            <QcReportLink
                              path={l.qcReportPath}
                              name={l.qcReportName}
                              label="Report"
                            />
                          ) : (
                            '—'
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PendingTpi(props: {
  o: TpiPendingRow;
  open: boolean;
  onToggle: () => void;
  onDone: () => void;
}): React.JSX.Element {
  const { o, open, onToggle, onDone } = props;
  const submit = useSubmitQcLog();
  const companyId = useSession().data?.companyId ?? null;
  // TPI posts through op-entry's submitQcLog, which now enforces BOTH qc_submit
  // `entry` (ordinary QC accept/reject) AND tpi_submit `entry` (the TPI-specific
  // gate). The QC tier grants tpi_submit by default, so this only bites when an
  // admin switches TPI OFF for someone — mirror that here so the button hides
  // exactly when the server would refuse.
  const { data: eff } = useMyAccess();
  const canEntry =
    effectiveFormPerms(eff, 'qc_submit').entry && effectiveFormPerms(eff, 'tpi_submit').entry;
  const [logDate, setLogDate] = useState(todayLocal());
  const [shift, setShift] = useState<Shift>('day');
  const [accept, setAccept] = useState('');
  const [reject, setReject] = useState('0');
  const [inspector, setInspector] = useState('');
  const [organization, setOrganization] = useState('');
  const [certNo, setCertNo] = useState('');
  const [remarks, setRemarks] = useState('');
  const [qcReportPath, setQcReportPath] = useState<string | null>(null);
  const [qcReportName, setQcReportName] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Inspector now picks from TPI Master instead of being typed free-hand — the
  // same person used to arrive as "Mr. Sharma", "Mr sharma" and "R. Sharma", so
  // no TPI history could be grouped by inspector. Only ACTIVE inspectors are
  // offered; a retired one stays readable on the records he already signed.
  // Server-side search (limit 50) — never load the whole master into the page.
  const [inspectorSearch, setInspectorSearch] = useState('');
  const inspectorQuery = useTpiMastersList({
    search: inspectorSearch || undefined,
    isActive: true,
    limit: 50,
    offset: 0,
  });
  const inspectorOptions = useMemo(
    () =>
      (inspectorQuery.data?.items ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.organization ?? '',
      })),
    [inspectorQuery.data],
  );

  async function send(): Promise<void> {
    setErr(null);
    const acc = Number(accept || '0');
    const rej = Number(reject || '0');
    if (!Number.isInteger(acc) || acc < 0 || !Number.isInteger(rej) || rej < 0) {
      setErr('Accepted and Rejected must be whole numbers, 0 or more.');
      return;
    }
    if (acc + rej <= 0) {
      setErr('Enter the Accepted and/or Rejected qty.');
      return;
    }
    if (acc + rej > o.qcPending) {
      setErr(`Accepted + Rejected (${acc + rej}) cannot be more than QC Pending (${o.qcPending}).`);
      return;
    }
    if (!inspector.trim() || !organization.trim()) {
      setErr('Inspector Name and Organisation are required.');
      return;
    }
    const input: SubmitQcLogInput = {
      jcOpId: o.jcOpId,
      qty: acc,
      rejectQty: rej,
      logDate,
      shift,
      operatorName: inspector.trim(),
      isTpi: true,
      tpiInspector: inspector.trim(),
      tpiOrganization: organization.trim(),
      ...(certNo.trim() ? { tpiCertNo: certNo.trim() } : {}),
      ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      ...(qcReportPath ? { qcReportPath, qcReportName } : {}),
    };
    try {
      await submit.mutateAsync(input);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save TPI Inspection. Try again.');
    }
  }

  return (
    <div
      style={{
        border: `1px solid ${open ? 'var(--green)' : 'var(--border)'}`,
        borderRadius: 8,
        marginBottom: 8,
        background: 'var(--bg2)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          padding: '10px 14px',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
        onClick={onToggle}
      >
        <div>
          <b className="cyan" style={{ fontSize: 13 }}>
            {o.jcCode}
          </b>{' '}
          <span className="text3" style={{ fontSize: 11 }}>
            Op {opSrNo(o.opSeq)} — {o.operation}
          </span>
          {o.waitDays > 1 ? (
            <span style={{ fontSize: 11, color: 'var(--red2)', fontWeight: 700, marginLeft: 8 }}>
              ⚠ Waiting {o.waitDays} days
            </span>
          ) : null}
          <div className="text2" style={{ fontSize: 11 }}>
            {o.soCode ?? '—'} •{' '}
            {/* The item code is the value the inspector matches against the
                drawing, so it is the darkest text token and bold. The rest of
                the line — the SO code, the part name, the order quantity —
                stays on the muted line colour, which is what makes the code
                stand out at a glance. */}
            <span className="mono fw-700" style={{ color: 'var(--text)' }}>
              {itemCodeWithRev(o.itemCode, o.itemRevision)}
            </span>
            {/* The inspector reads this line to know what is on the table in
                front of him, and a job-card number plus a part number does not
                tell him that — the part has to be named. It is `inline-block`
                because this line is ordinary flowing text, and an inline span
                ignores a width cap and would let a long name push "Order: N pcs"
                onto a second line. A name the join could not resolve prints
                nothing, leaving the line exactly as it has always read. */}
            {o.itemName ? (
              <>
                {' • '}
                <span
                  className="fw-700"
                  style={{
                    display: 'inline-block',
                    maxWidth: 260,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    verticalAlign: 'bottom',
                  }}
                  title={o.itemName}
                >
                  {o.itemName}
                </span>
              </>
            ) : null}{' '}
            • Order: {o.orderQty} pcs
          </div>
          {o.callDate ? (
            <div style={{ fontSize: 11, color: 'var(--amber2)' }}>
              Called: {fmtDate(o.callDate)}
            </div>
          ) : null}
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--amber2)' }}>{o.qcPending}</div>
          <div className="text3" style={{ fontSize: 11 }}>
            QC Pending
          </div>
        </div>
      </div>

      {/* No `entry` → the form is simply not drawn. No notice either: an
          expanded row that shows only its figures reads as view-only on its own. */}
      {open && canEntry ? (
        <div
          style={{
            padding: 14,
            background: 'rgba(34,197,94,0.04)',
            borderTop: '2px solid var(--green)',
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--green2)', marginBottom: 12 }}>
            TPI Entry
          </div>

          {/* Legacy L21413-21416: Date | Shift */}
          <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11 }}>
                TPI Date
              </label>
              <input
                type="date"
                className="innovic-input"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11 }}>
                Shift
              </label>
              <select
                className="innovic-select"
                value={shift}
                onChange={(e) => setShift(e.target.value as Shift)}
              >
                {SHIFTS.map((s) => (
                  <option key={s} value={s}>
                    {SHIFT_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Legacy L21417-21420: the big centred Accept / Reject qty inputs */}
          <div className="form-grid" style={{ gap: 10, marginBottom: 12 }}>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11, color: 'var(--green2)' }}>
                ✅ Accepted (max {o.qcPending})
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={accept}
                onChange={(e) => setAccept(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--green2)',
                  textAlign: 'center',
                  padding: 8,
                  border: '2px solid var(--green)',
                  background: 'var(--bg)',
                }}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" style={{ fontSize: 11, color: 'var(--red2)' }}>
                ❌ Rejected
              </label>
              <input
                type="number"
                className="innovic-input"
                min={0}
                max={o.qcPending}
                value={reject}
                onChange={(e) => setReject(e.target.value)}
                placeholder="0"
                style={{
                  fontSize: 20,
                  fontWeight: 800,
                  color: 'var(--red2)',
                  textAlign: 'center',
                  padding: 8,
                  border: '2px solid var(--red)',
                  background: 'var(--bg)',
                }}
              />
            </div>
          </div>

          {/* Legacy L21421-21428: purple "TPI DETAILS (Required)" box. The purple
              belongs to the box + its heading — legacy's labels inside are plain. */}
          <div
            style={{
              border: '1px solid var(--purple)',
              borderRadius: 8,
              padding: 12,
              marginBottom: 12,
              background: 'rgba(139,92,246,0.04)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', marginBottom: 8 }}>
              🔍 TPI Details
            </div>
            <div className="form-grid" style={{ gap: 10 }}>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 11 }}>
                  Inspector Name<span className="req">★</span>
                </label>
                {/* What gets SAVED is unchanged: still the inspector's name as
                    plain text (tpiInspector / operatorName), never an id — a TPI
                    log is a record of what was true on the day and keeps its own
                    name snapshot. Picking also fills Organization, which stays
                    editable because a one-off site visit can differ from the
                    inspector's usual firm. */}
                <SearchableSelect
                  id={`tpi-inspector-${o.jcOpId}`}
                  value={inspectorOptions.find((op) => op.code === inspector)?.id ?? null}
                  valueLabel={inspector || undefined}
                  onChange={(id) => {
                    const picked = inspectorOptions.find((op) => op.id === id);
                    setInspector(picked?.code ?? '');
                    if (picked?.name) setOrganization(picked.name);
                  }}
                  onSearch={setInspectorSearch}
                  loading={inspectorQuery.isFetching}
                  options={inspectorOptions}
                  selectedLabel={(op) => op.code ?? op.name}
                  placeholder="Search Inspector…"
                  emptyText="No Inspectors match. Add one in TPI Master."
                />
              </div>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 11 }}>
                  Organisation<span className="req">★</span>
                </label>
                <input
                  className="innovic-input"
                  value={organization}
                  onChange={(e) => setOrganization(e.target.value)}
                  placeholder="e.g. L&T QA Department"
                />
              </div>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 11 }}>
                  TPI Certificate No.
                </label>
                <input
                  className="innovic-input"
                  style={{ fontWeight: 700, color: 'var(--purple)' }}
                  value={certNo}
                  onChange={(e) => setCertNo(e.target.value)}
                  placeholder="e.g. TPI-2026-045"
                />
              </div>
              <div className="form-grp">
                <label className="form-label" style={{ fontSize: 11 }}>
                  Remarks
                </label>
                <input
                  className="innovic-input"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Observations…"
                />
              </div>
            </div>
          </div>

          {/* Legacy L21429-21433: attach row sits between the details box and the
              action buttons. QcReportAttach renders the same picker + × Remove. */}
          <div style={{ marginBottom: 12 }}>
            <QcReportAttach
              companyId={companyId}
              fileName={qcReportName}
              onUploaded={(path, name) => {
                setQcReportPath(path);
                setQcReportName(name);
              }}
              onClear={() => {
                setQcReportPath(null);
                setQcReportName(null);
              }}
            />
          </div>

          {err ? (
            <div role="alert" style={{ color: 'var(--red2)', fontSize: 12, marginBottom: 8 }}>
              {err}
            </div>
          ) : null}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-success"
              style={{
                fontWeight: 700,
                fontSize: 13,
                padding: '8px 24px',
              }}
              disabled={submit.isPending}
              onClick={() => void send()}
            >
              {submit.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Submit TPI
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
