// JC Status — the VIEW body, laid out to the 2026-09-18 mockup:
//
//   A  header bar     Job Card : <code> + status badge · Back to List · Print
//                     Job Card · Excel · ▶ Production Entry · ✎ Edit Job Card
//   B  recovery       rework / repair child banner (only on such a card)
//   C  header tile    part · references · Order / Completed / WIP / Rejected
//                     (NC) / Pending tiles · due date · priority · status
//   D  route flow     the wrapping strip of fixed-size operation cards
//   E  operations     one card per op — expanded for the current op and the
//                     next one, collapsed rows for the rest; Show All
//                     Operations Expanded / Expand All at the section's right
//   F  tabs           Documents & Quality | Remarks | Related Records | History
//
// Same data hooks as before (useJobCard, useJcOpsEnriched, useOpLog,
// useJobCardStatusExtras, useJobCardEditModel for the live drawing, useMyCompany
// for the print); every figure the old layout showed is still on the page.
// EDIT mode is untouched — it lives in jc-status-content.tsx.
import type { OpLog } from '@innovic/shared';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Download, Loader2, Pencil, Printer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FilePreviewModal } from '@/components/shared/file-preview-modal';
import { effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { drawingViewUrl } from '@/lib/drawing-url';
import { useJcOpsEnriched, useOpLog } from '@/modules/op-entry/api';
import { useMyCompany } from '@/modules/settings/api';
import { useJobCard, useJobCardEditModel, useJobCardStatusExtras } from '../api';
import { exportJobCardExcel } from '../lib/export-job-card-excel';
import { printJobCard } from '../lib/print-job-card';
import { JcOpCard } from './jc-op-card';
import { RecoveryBanner } from './jc-recovery-banner';
import { JcStatusBadge } from './jc-status-badge';
import {
  JcRouteFlowPanel,
  JcViewSummary,
  SectionBar,
  currentOp,
  type JcDrawingRef,
} from './jc-view-summary';
import { JcViewTabs } from './jc-view-tabs';

/** Which stored drawings have a thumbnail worth auto-loading. Anything else
 *  (PDF, DWG, a stray .zip) gets a card and an open action instead of a
 *  broken image. */
const IMAGE_RE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

export function JcStatusViewContent({ id }: { id: string }): React.JSX.Element {
  const navigate = useNavigate();
  const { data: jc, isLoading, isError, error } = useJobCard(id);
  // `opsLoading` gates the Print button: the ops come from their own query, so
  // a click landing between "job card loaded" and "ops loaded" printed a Job
  // Card whose Operation Routing table said "No operations". It also holds the
  // derived WIP / Rejected tiles at "—" until the rows are here. Loaded-ness
  // for those tiles is read off the DATA (`opsData !== undefined`), not the
  // flag: after a failed query `isLoading` is false with no rows, and a zero
  // summed over no rows would print as a fact.
  const { data: opsData, isLoading: opsLoading } = useJcOpsEnriched(
    { jobCardId: id },
    { enabled: Boolean(id) },
  );
  const ops = useMemo(() => opsData ?? [], [opsData]);
  const opsLoaded = opsData !== undefined;
  const { data: logs = [] } = useOpLog({ jobCardId: id, limit: 300 }, { enabled: Boolean(id) });
  // Server-computed extras: QC docs, per-op machine name + tool details, and the
  // merged completion feed (op_log ∪ NC ∪ OSP) with a real total (ISSUE-174).
  const { data: extras } = useJobCardStatusExtras(id);
  const { data: company } = useMyCompany();
  // Edit button uses the SAME key as the page it opens (/job-cards/$id/edit →
  // jc_create edit). Hidden until the access matrix has loaded.
  const { data: eff } = useMyAccess();
  const canWrite = effectiveFormPerms(eff, 'jc_create').edit;

  const [flowOpen, setFlowOpen] = useState(true);
  const [detailOpen, setDetailOpen] = useState(true);
  const [drawingPreviewOpen, setDrawingPreviewOpen] = useState(false);

  // WHICH DRAWING THIS SCREEN SHOWS — and the page says so, because up to FOUR
  // different files can sit behind one job card and they are not
  // interchangeable. The print the customer sent with the order is what the
  // part must be made to; the item master's drawing is the generic one for that
  // part number and can easily be a revision behind. Showing one without naming
  // it is how a part gets made to the wrong print.
  //
  // Order, first one that exists wins:
  //   1. the SALES ORDER line's drawing   (soLineDrawingFilePath)
  //   2. the JWSO line's drawing          (jwLineDrawingFilePath)
  //   3. this job card's own upload       (jc.drawingFilePath)
  //
  // The first and second come from the edit model, where the API resolves
  // them LIVE off the source line on every read rather than copying them onto
  // the card. That is the whole point: upload a corrected print against the
  // order and the shop floor sees it on the next refresh, instead of building
  // to a file frozen at the moment the card was raised. A card has at most one
  // source, so 1 and 2 are never both set.
  //
  // There is NO item-master fallback any more (user decision 2026-09-21):
  // items no longer carry drawings — they carry a product image, which is a
  // picture, not a controlled document, and is shown by the ItemBadge instead.
  const { data: model } = useJobCardEditModel(id);
  /** Caption suffix for the revision printed on that drawing, when there is
   *  one. Blank rather than "Rev —": an empty revision is not a fact. */
  const revSuffix = (rev: string | null | undefined): string => (rev ? ` · Rev ${rev}` : '');
  const drawing = model?.soLineDrawingFilePath
    ? {
        path: model.soLineDrawingFilePath,
        label: `Sales order drawing${revSuffix(model.soLineRevision)}`,
        source: 'so_line' as const,
      }
    : model?.jwLineDrawingFilePath
      ? {
          path: model.jwLineDrawingFilePath,
          label: `Job work order drawing${revSuffix(model.jwLineRevision)}`,
          source: 'jw_line' as const,
        }
      : jc?.drawingFilePath
        ? {
            path: jc.drawingFilePath,
            label: 'Attached to this Job Card',
            source: 'job_card' as const,
          }
        : null;

  // Auto-loaded on open, and asked for as a VIEW. Never `download`: the page
  // opening a thumbnail is nobody deciding to keep a copy, and logging it as one
  // would make the access log useless for the question it exists to answer.
  // Only fetched for an image — a PDF has no thumbnail to show.
  const wantThumb = Boolean(drawing && IMAGE_RE.test(drawing.path));
  const { data: drawingUrl } = useQuery({
    queryKey: ['jc-drawing', drawing?.path ?? null],
    queryFn: () =>
      drawingViewUrl({
        path: drawing?.path ?? '',
        source: drawing?.source ?? 'job_card',
        ...(jc?.code ? { refCode: jc.code } : {}),
      }),
    enabled: wantThumb,
    staleTime: 60_000,
  });
  // The stored path is `<upload-stamp>-<original name>`; the stamp is stripped
  // so the page names the file the way the user uploaded it.
  const drawingRef: JcDrawingRef | null = drawing
    ? {
        label: drawing.label,
        fileName:
          drawing.path
            .split('/')
            .pop()
            ?.replace(/^\d{10,}-/, '') ?? 'drawing',
        thumbUrl: wantThumb ? (drawingUrl ?? null) : null,
      }
    : null;

  const sortedOps = useMemo(() => [...ops].sort((a, b) => a.opSeq - b.opSeq), [ops]);
  const logsByOp = useMemo(() => {
    const m = new Map<string, OpLog[]>();
    for (const l of logs) {
      const arr = m.get(l.jcOpId) ?? [];
      arr.push(l);
      m.set(l.jcOpId, arr);
    }
    // Latest first — by date, then by the time on that date.
    for (const arr of m.values()) {
      arr.sort(
        (a, b) =>
          b.logDate.localeCompare(a.logDate) ||
          (b.startTime ?? '').localeCompare(a.startTime ?? ''),
      );
    }
    return m;
  }, [logs]);
  // Per-op machine name (flow chips) + tool details (info block) — both
  // server-resolved (opExtras); the op-entry enriched op omits them. Keyed by
  // op id.
  const opExtraById = useMemo(
    () => new Map((extras?.opExtras ?? []).map((e) => [e.jcOpId, e])),
    [extras?.opExtras],
  );
  /** ADR-103 — lowest-sequence op; the one client material feeds. */
  const firstOpId = useMemo(() => sortedOps[0]?.id ?? null, [sortedOps]);

  // ── Which op cards are open ──
  // Default: the CURRENT op (lowest-seq op not complete) and the one after it;
  // on a finished card, the last op. `Show All Operations Expanded` overrides
  // that for every op; `Expand All` / `Collapse All` writes the per-op set.
  const defaultOpen = useMemo(() => {
    const cur = currentOp(sortedOps) ?? sortedOps[sortedOps.length - 1];
    if (!cur) return new Set<string>();
    const i = sortedOps.indexOf(cur);
    const next = sortedOps[i + 1];
    return new Set<string>([cur.id, ...(next ? [next.id] : [])]);
  }, [sortedOps]);
  const [showAll, setShowAll] = useState(false);
  // null = the default set (so the default follows the data until the user
  // touches a card); a Set once the user has.
  const [openIds, setOpenIds] = useState<Set<string> | null>(null);
  const effectiveOpen = openIds ?? defaultOpen;
  const isOpen = (opId: string): boolean => showAll || effectiveOpen.has(opId);
  const toggleOp = (opId: string): void => {
    if (showAll) {
      // Collapsing one card while "all" is on: drop the override and keep
      // every other card open, exactly as the user sees them.
      setShowAll(false);
      const next = new Set(sortedOps.map((o) => o.id));
      next.delete(opId);
      setOpenIds(next);
      return;
    }
    const next = new Set(effectiveOpen);
    if (next.has(opId)) next.delete(opId);
    else next.add(opId);
    setOpenIds(next);
  };
  const allOpen = sortedOps.length > 0 && sortedOps.every((o) => isOpen(o.id));

  if (isLoading) {
    return (
      <div className="empty-state">
        <Loader2 className="inline h-4 w-4 animate-spin" /> Loading job card…
      </div>
    );
  }
  if (isError || !jc) {
    return (
      <div className="empty-state" style={{ color: 'var(--red)' }}>
        {error instanceof Error ? error.message : 'Job card not found'}
      </div>
    );
  }

  const openOpEntry = (): void => void navigate({ to: '/op-entry', search: { jc: jc.code } });
  const openDrawing = (): void => setDrawingPreviewOpen(true);

  return (
    <div>
      {/* ── A. Header bar ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <span className="section-hdr" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>
          Job Card :{' '}
          <span className="mono" style={{ color: 'var(--text)' }}>
            {jc.code}
          </span>
        </span>
        <JcStatusBadge status={jc.computedStatus} />
        <span style={{ flex: 1 }} />
        <Link to="/job-cards" className="btn btn-ghost btn-sm">
          <ArrowLeft size={14} /> Back to List
        </Link>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          disabled={opsLoading}
          onClick={() => {
            if (!printJobCard({ jc, ops, company })) window.alert('Allow popups to print.');
          }}
        >
          <Printer size={13} /> Print Job Card
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => exportJobCardExcel({ jc, ops, logs })}
          title="Download Excel (with production log)"
        >
          <Download size={13} /> Excel
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={openOpEntry}>
          ▶ Production Entry
        </button>
        {canWrite ? (
          <Link
            to="/job-cards/$id/edit"
            params={{ id }}
            className="btn btn-ghost btn-sm"
            title="Edit this Job Card — add/route ops, or outsource an operation's balance"
          >
            <Pencil size={14} /> Edit Job Card
          </Link>
        ) : null}
      </div>

      {/* ── B. Rework / repair child banner (null on an ordinary card) ── */}
      <RecoveryBanner jc={jc} />

      {/* ── C. Header tile ── */}
      <JcViewSummary
        jc={jc}
        ops={ops}
        opsLoaded={opsLoaded}
        sortedOps={sortedOps}
        rmAvailable={extras?.rmAvailable ?? null}
        drawing={drawingRef}
        onOpenDrawing={openDrawing}
      />
      {drawingPreviewOpen && drawing ? (
        <FilePreviewModal
          storagePath={drawing.path}
          kind="drawing"
          source={drawing.source}
          refCode={jc.code}
          onClose={() => setDrawingPreviewOpen(false)}
        />
      ) : null}

      {/* ── D. Route / Operation Flow ── */}
      <JcRouteFlowPanel
        jc={jc}
        sortedOps={sortedOps}
        opExtraById={opExtraById}
        open={flowOpen}
        onToggle={() => setFlowOpen((v) => !v)}
      />

      {/* ── E. Operations Details ── */}
      <div className="panel" style={{ marginBottom: 12 }}>
        <SectionBar
          title="Operations Details"
          open={detailOpen}
          onToggle={() => setDetailOpen((v) => !v)}
          right={
            sortedOps.length > 0 ? (
              <>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    fontSize: 12,
                    color: 'var(--text2)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={showAll}
                    onChange={(e) => {
                      setShowAll(e.target.checked);
                      // Turning it off returns to the default set, not to
                      // whatever was open before — the plain reading of "off".
                      if (!e.target.checked) setOpenIds(null);
                    }}
                  />
                  Show All Operations Expanded
                </label>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    if (allOpen) {
                      setShowAll(false);
                      setOpenIds(new Set());
                    } else {
                      setOpenIds(new Set(sortedOps.map((o) => o.id)));
                    }
                  }}
                >
                  {allOpen ? '⤡ Collapse All' : '⤢ Expand All'}
                </button>
              </>
            ) : null
          }
        />
        {detailOpen ? (
          <div style={{ padding: '2px 0' }}>
            {sortedOps.length === 0 ? (
              <div className="empty-state">No operations</div>
            ) : (
              sortedOps.map((o, i) => (
                <JcOpCard
                  key={o.id}
                  jc={jc}
                  op={o}
                  index={i + 1}
                  expanded={isOpen(o.id)}
                  onToggle={() => toggleOp(o.id)}
                  machineName={opExtraById.get(o.id)?.machineName ?? null}
                  toolDetails={opExtraById.get(o.id)?.toolDetails ?? null}
                  // ADR-103: the client-material tile belongs to the FIRST op —
                  // the one the material feeds and the only one the gate caps.
                  rmAvailable={o.id === firstOpId ? (extras?.rmAvailable ?? null) : null}
                  logs={logsByOp.get(o.id) ?? []}
                  onStart={(opId) =>
                    void navigate({
                      to: '/op-entry',
                      search: { jc: jc.code, op: opId, mode: 'start' },
                    })
                  }
                  onLog={(opId) =>
                    void navigate({
                      to: '/op-entry',
                      search: { jc: jc.code, op: opId, mode: 'complete' },
                    })
                  }
                  // The register has no per-op filter; its ?search= seeds the
                  // box with this job card's code (matched against jcCode /
                  // operation / item), so the inspector lands on this card's
                  // calls rather than the whole queue.
                  onQc={() =>
                    void navigate({ to: '/qc-call-register', search: { search: jc.code } })
                  }
                />
              ))
            )}
          </div>
        ) : null}
      </div>

      {/* ── F. Documents & Quality | Remarks | Related Records | History ── */}
      <JcViewTabs
        jc={jc}
        ops={ops}
        extras={extras}
        drawing={drawingRef}
        onOpenDrawing={openDrawing}
      />
    </div>
  );
}
