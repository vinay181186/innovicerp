// Stock Count — one page for a new count, a draft being keyed in, and a
// submitted / posted count (ADR-193 phase 2). The server owns every rule:
// whole numbers for NOS / SET, one line per item, approver ≠ counter, the
// snapshot on Submit and the "below booked" confirmation on Approve.
import {
  STOCK_COUNT_PURPOSE_LABELS,
  STOCK_COUNT_PURPOSES,
  STOCK_COUNT_REASON_MIN,
  STOCK_COUNT_STATUS_LABELS,
  type StockCountPurpose,
} from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { fmtDate, todayLocal } from '@/lib/date';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Select } from '@/ui/forms';
import {
  useCreateStockCount,
  useReplaceStockCountLines,
  useStockCount,
  useStockCountAction,
} from '../api';
import { CancelCountPanel, ConfirmBelowBookedPanel, type ShortItem } from '../components/panels';
import { StockCountAddBar } from '../components/add-bar';
import { StockCountLinesTable } from '../components/lines-table';
import { type DraftLine, fromServer } from '../lib/draft-line';
import { mergeStockCountSheet } from '../lib/excel';
import { STATUS_BADGE } from './list';

export const stockCountDetailRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'stock-counts/$id',
  component: StockCountPage,
});

const errText = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : fallback;

function StockCountPage(): React.JSX.Element {
  const { id } = stockCountDetailRoute.useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { data: me } = useSession();
  const { data: eff } = useMyAccess();
  const perms = effectiveFormPerms(eff, 'stockcount_create');
  const { data: sc, isLoading } = useStockCount(isNew ? undefined : id);

  const editable = isNew || sc?.status === 'draft';
  const [countDate, setCountDate] = useState(todayLocal());
  const [purpose, setPurpose] = useState<StockCountPurpose>('opening');
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmShort, setConfirmShort] = useState<ShortItem[] | null>(null);
  const [confirmReason, setConfirmReason] = useState('');
  const [cancelReason, setCancelReason] = useState<string | null>(null);

  // Load the saved count into the editor once.
  const loadedFor = useRef<string | null>(null);
  useEffect(() => {
    if (sc && loadedFor.current !== sc.id) {
      loadedFor.current = sc.id;
      setCountDate(sc.countDate);
      setPurpose(sc.purpose);
      setRemarks(sc.remarks ?? '');
      setLines((sc.lines ?? []).map(fromServer));
    }
  }, [sc]);

  const create = useCreateStockCount();
  const replace = useReplaceStockCountLines();
  const submit = useStockCountAction('submit');
  const approve = useStockCountAction('approve');
  const cancel = useStockCountAction('cancel');
  const busy =
    create.isPending ||
    replace.isPending ||
    submit.isPending ||
    approve.isPending ||
    cancel.isPending;

  const addLine = (line: DraftLine): void => {
    if (lines.some((l) => l.itemId === line.itemId)) {
      setMsg({ ok: false, text: `${line.itemCode} is already on this count.` });
      return;
    }
    setLines((ls) => [...ls, line]);
  };

  const payloadLines = ():
    | Array<{ itemId: string; countedQty: number; reason?: string }>
    | string => {
    const out: Array<{ itemId: string; countedQty: number; reason?: string }> = [];
    for (const l of lines) {
      const q = Number(l.countedQty);
      if (l.countedQty.trim() === '' || !Number.isFinite(q) || q < 0)
        return `${l.itemCode}: enter the counted qty (0 or more).`;
      out.push({
        itemId: l.itemId,
        countedQty: q,
        ...(l.reason.trim() ? { reason: l.reason.trim() } : {}),
      });
    }
    return out.length ? out : 'Add at least one item.';
  };

  const save = async (): Promise<string | null> => {
    setMsg(null);
    const ls = payloadLines();
    if (typeof ls === 'string') {
      setMsg({ ok: false, text: ls });
      return null;
    }
    try {
      if (isNew) {
        const c = await create.mutateAsync({
          countDate,
          purpose,
          ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
          lines: ls,
        });
        await navigate({ to: '/stock-counts/$id', params: { id: c.id }, replace: true });
        return c.id;
      }
      await replace.mutateAsync({ id, remarks: remarks.trim(), lines: ls });
      setMsg({ ok: true, text: 'Draft saved.' });
      return id;
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not save.') });
      return null;
    }
  };

  const doSubmit = async (): Promise<void> => {
    const savedId = await save();
    if (!savedId) return;
    try {
      await submit.mutateAsync({ id: savedId });
      setMsg({
        ok: true,
        text: 'Submitted — system stock snapshotted. Another user must approve to post.',
      });
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not submit.') });
    }
  };

  const doApprove = async (reason?: string): Promise<void> => {
    setMsg(null);
    try {
      await approve.mutateAsync({ id, ...(reason ? { confirmReason: reason } : {}) });
      setConfirmShort(null);
      setMsg({ ok: true, text: 'Posted — stock updated.' });
    } catch (e) {
      const details = (
        e as {
          details?: {
            needsConfirmation?: boolean;
            short?: Array<{ itemCode: string; newInStock: number; booked: number }>;
          };
        }
      ).details;
      if (details?.needsConfirmation && details.short) {
        setConfirmShort(details.short);
        return;
      }
      setMsg({ ok: false, text: errText(e, 'Could not approve.') });
    }
  };

  const doCancel = async (): Promise<void> => {
    if (!cancelReason || cancelReason.trim().length < STOCK_COUNT_REASON_MIN) {
      setMsg({ ok: false, text: `Give a reason (at least ${STOCK_COUNT_REASON_MIN} characters).` });
      return;
    }
    try {
      await cancel.mutateAsync({ id, reason: cancelReason.trim() });
      setCancelReason(null);
      setMsg({ ok: true, text: 'Cancelled.' });
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not cancel.') });
    }
  };

  // ── Excel: Item Code · Counted Qty · Reason ──
  const importFile = async (file: File): Promise<void> => {
    setMsg(null);
    try {
      const r = await mergeStockCountSheet(file, lines);
      setLines(r.lines);
      setMsg({ ok: r.ok, text: r.text });
    } catch (e) {
      setMsg({ ok: false, text: errText(e, 'Could not read the sheet.') });
    }
  };

  if (!isNew && isLoading) {
    return (
      <div className="panel-body text3">
        <Loader2 size={14} className="inline animate-spin" /> Loading…
      </div>
    );
  }
  const status = sc?.status ?? 'draft';
  const canApprove =
    sc?.status === 'submitted' && perms.approve && !sc.blockedApproverIds.includes(me?.id ?? '');

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <Link to="/stock-counts" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Stock Count
        </Link>
        <span className="td-code" style={{ fontSize: 16 }}>
          {isNew ? 'New Stock Count' : sc?.code}
        </span>
        {!isNew ? (
          <span className={`badge ${STATUS_BADGE[status]}`}>
            {STOCK_COUNT_STATUS_LABELS[status]}
          </span>
        ) : null}
      </div>

      <div className="panel">
        <div className="panel-body">
          <div className="form-grid">
            <div className="form-grp">
              <label className="form-label" htmlFor="sc-date">
                Count Date ★
              </label>
              <input
                id="sc-date"
                type="date"
                className="innovic-input"
                value={countDate}
                disabled={!isNew}
                onChange={(e) => setCountDate(e.target.value)}
              />
            </div>
            <div className="form-grp">
              <label className="form-label" htmlFor="sc-purpose">
                Purpose ★
              </label>
              <Select
                id="sc-purpose"
                value={purpose}
                disabled={!isNew}
                onChange={(e) => setPurpose(e.target.value as StockCountPurpose)}
                options={STOCK_COUNT_PURPOSES.map((p) => ({
                  value: p,
                  label: STOCK_COUNT_PURPOSE_LABELS[p],
                }))}
              />
            </div>
            <div className="form-grp form-full">
              <label className="form-label" htmlFor="sc-remarks">
                Remarks
              </label>
              <input
                id="sc-remarks"
                className="innovic-input"
                value={remarks}
                disabled={!editable}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>
          {sc?.status === 'posted' ? (
            <div className="text3" style={{ fontSize: 12, marginTop: 6 }}>
              Posted {sc.approvedAt ? fmtDate(sc.approvedAt.slice(0, 10)) : ''} by{' '}
              {sc.approvedByName ?? '—'}
              {sc.approvalReason ? ` · confirmed below booked: ${sc.approvalReason}` : ''}
            </div>
          ) : null}
          {sc?.status === 'cancelled' ? (
            <div className="text3" style={{ fontSize: 12, marginTop: 6 }}>
              Cancelled — {sc.cancelReason}
            </div>
          ) : null}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 12 }}>
        <StockCountLinesTable
          lines={lines}
          setLines={setLines}
          saved={sc?.lines ?? []}
          status={status}
          editable={editable}
        />
        {editable && perms.entry ? (
          <StockCountAddBar onAdd={addLine} onFile={(f) => void importFile(f)} />
        ) : null}
      </div>

      {msg ? (
        <div
          style={{ marginTop: 10, color: msg.ok ? 'var(--green)' : 'var(--red2)', fontSize: 13 }}
        >
          {msg.text}
        </div>
      ) : null}

      {confirmShort ? (
        <ConfirmBelowBookedPanel
          short={confirmShort}
          reason={confirmReason}
          setReason={setConfirmReason}
          busy={busy}
          onPost={() => void doApprove(confirmReason.trim())}
          onBack={() => setConfirmShort(null)}
        />
      ) : null}
      {cancelReason !== null ? (
        <CancelCountPanel
          reason={cancelReason}
          setReason={setCancelReason}
          busy={busy}
          onCancel={() => void doCancel()}
          onBack={() => setCancelReason(null)}
        />
      ) : null}

      <div style={{ marginTop: 14, display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {editable && perms.entry ? (
          <>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => void save()}
            >
              Save Draft
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => void doSubmit()}
            >
              {busy ? <Loader2 size={14} className="inline animate-spin" /> : null} Submit for
              approval
            </button>
          </>
        ) : null}
        {canApprove ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy}
            onClick={() => void doApprove()}
          >
            Approve &amp; Post
          </button>
        ) : null}
        {sc?.status === 'submitted' && sc.blockedApproverIds.includes(me?.id ?? '') ? (
          <span className="text3" style={{ fontSize: 12, alignSelf: 'center' }}>
            Waiting for another user to approve.
          </span>
        ) : null}
        {!isNew &&
        (sc?.status === 'draft' || sc?.status === 'submitted') &&
        perms.edit &&
        cancelReason === null ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy}
            onClick={() => setCancelReason('')}
          >
            Cancel count
          </button>
        ) : null}
      </div>
    </div>
  );
}
