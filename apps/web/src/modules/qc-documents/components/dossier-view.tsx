// ADR-252 QC Dossier — the first, default tab of QC Documents. Pick an SO or
// JWSO; the left pane is its folder tree (Order → POL → report folders), the
// right pane the order summary or the selected POL's file sheet. Every place a
// QC report is kept (the QC entry, QC Documents uploads, the Job Card form)
// arrives in ONE server read (GET /qc-documents/dossier).
//
// URL: view=dossier&kind=so|jwso&orderId=&lineId=&folder=&search= — the
// dashboard's "QC report missing" rows deep-link straight to a POL.

import type { QcDossierLine, QcDossierOrderKind } from '@innovic/shared';
import { useMemo, useState } from 'react';
import { matchesSearchTerm, normalizeSearchTerm } from '@/components/shared/search-match';
import { SearchableSelect } from '@/components/shared/searchable-select';
import { canDeleteRecords, effectiveFormPerms, useMyAccess } from '@/lib/access-control';
import { itemCodeWithRev } from '@/lib/item-code';
import { soNoWithInternal } from '@/lib/so-number';
import { Panel, StatStrip } from '@/ui/data';
import { ListHeader, PageState } from '@/ui/layout';
import { useQcDossier, useQcDossierOrders } from '../api';
import { qcDocumentsListRoute } from '../routes/list';
import '../dossier.css';
import { DossierFileSheet, DossierLineHead, lineFileCount } from './dossier-files';
import { lineRows, rowSearchFields, unlinkedRows, zipPlan, zipRootName } from './dossier-model';
import { DossierSummary } from './dossier-summary';
import { DossierTree, UNLINKED_ID, polLabel, type DossierSelection } from './dossier-tree';
import { buildDossierZip, type ZipProgress } from './dossier-zip';
import { useMaySaveFiles } from './qc-doc-shared';
import { useDossierUpload } from './use-dossier-upload';

function lineFields(l: QcDossierLine): Array<string | number | null> {
  return [
    polLabel(l),
    l.itemCode,
    itemCodeWithRev(l.itemCode, l.itemRevision, ''),
    l.itemName,
    ...l.jobCards.map((j) => j.code),
  ];
}

export function DossierView({ toggle }: { toggle: React.ReactNode }): React.JSX.Element {
  const search = qcDocumentsListRoute.useSearch();
  const navigate = qcDocumentsListRoute.useNavigate();
  const { data: eff } = useMyAccess();
  const canUpload = effectiveFormPerms(eff, 'qcdocs_upload').entry;
  const canDelete = canDeleteRecords(eff);
  const maySave = useMaySaveFiles();
  const rights = useMemo(
    () => ({ canUpload, canDelete, maySave }),
    [canUpload, canDelete, maySave],
  );
  const upload = useDossierUpload();

  const [pickSearch, setPickSearch] = useState('');
  const orders = useQcDossierOrders(pickSearch);
  const options = orders.data?.orders ?? [];
  // No order in the URL → the newest one in the picker (as the Matrix does).
  const kind: QcDossierOrderKind | undefined = search.orderId
    ? (search.kind ?? 'so')
    : options[0]?.kind;
  const orderId = search.orderId ?? options[0]?.id;
  const { data: dossier, isLoading, isFetching, isError, error } = useQcDossier(kind, orderId);

  const [term, setTerm] = useState(search.search ?? '');
  const q = search.search ?? '';
  const sel: DossierSelection = { lineId: search.lineId, folder: search.folder };
  const select = (s: DossierSelection): void =>
    void navigate({
      search: (p) => ({ ...p, kind, orderId, lineId: s.lineId, folder: s.folder }),
      replace: true,
    });

  const lines = useMemo(() => {
    const all = dossier?.lines ?? [];
    if (!q) return all;
    return all.filter(
      (l) =>
        matchesSearchTerm(lineFields(l), q) ||
        lineRows(l).some((r) => matchesSearchTerm(rowSearchFields(r), q)),
    );
  }, [dossier?.lines, q]);

  const line = dossier?.lines.find((l) => l.lineId === sel.lineId);
  const rows = useMemo(() => {
    if (!dossier) return [];
    const raw =
      sel.lineId === UNLINKED_ID
        ? unlinkedRows(dossier.unlinked)
        : line
          ? lineRows(line, sel.folder)
          : [];
    if (!q || (line && matchesSearchTerm(lineFields(line), q))) return raw;
    return raw.filter((r) => matchesSearchTerm(rowSearchFields(r), q));
  }, [dossier, line, sel.lineId, sel.folder, q]);

  const [zip, setZip] = useState<ZipProgress | null>(null);
  const [zipMsg, setZipMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function runZip(only?: QcDossierLine): Promise<void> {
    if (!dossier || !kind || !orderId || zip) return;
    setZipMsg(null);
    const items = zipPlan(
      dossier.order,
      only ? [only] : dossier.lines,
      only ? [] : dossier.unlinked,
    );
    const root = zipRootName(dossier.order);
    const zipName = only ? `${root}_POL-${polLabel(only)}` : root;
    try {
      const res = await buildDossierZip({ kind, orderId, zipName, items, onProgress: setZip });
      setZipMsg(
        res.failed.length === 0
          ? { ok: true, text: `ZIP saved — ${res.saved} files.` }
          : {
              ok: false,
              text:
                res.saved === 0
                  ? `No ZIP saved — none of the files could be fetched: ${res.failed.join(', ')}.`
                  : `ZIP saved with ${res.saved} of ${items.length} files. Could not fetch: ${res.failed.join(', ')}.`,
            },
      );
    } catch (e) {
      setZipMsg({ ok: false, text: e instanceof Error ? e.message : 'Could not build the ZIP.' });
    } finally {
      setZip(null);
    }
  }
  const zipLabel = (what: string): string =>
    zip ? `Zipping ${zip.done}/${zip.total}…` : `⬇ ZIP (${what})`;

  const picker = (
    <div style={{ minWidth: 340 }}>
      <SearchableSelect
        id="qc-dossier-order"
        value={kind && orderId ? `${kind}:${orderId}` : null}
        valueLabel={
          dossier
            ? `${soNoWithInternal(dossier.order.code, dossier.order.internalSoNo)}${dossier.order.customerName ? ` · ${dossier.order.customerName}` : ''}`
            : undefined
        }
        onChange={(v) => {
          const [k, id] = (v ?? '').split(':');
          void navigate({
            search: (p) => ({
              ...p,
              kind: k === 'jwso' ? 'jwso' : k === 'so' ? 'so' : undefined,
              orderId: id || undefined,
              lineId: undefined,
              folder: undefined,
            }),
            replace: true,
          });
        }}
        onSearch={setPickSearch}
        loading={orders.isFetching}
        placeholder="Search SO / JWSO No., Internal SO No., customer…"
        options={options.map((o) => ({
          id: `${o.kind}:${o.id}`,
          code: o.internalSoNo ? `${o.code} · ${o.internalSoNo}` : o.code,
          name: o.customerName ?? '',
        }))}
      />
    </div>
  );

  const header = (
    <ListHeader
      title="QC Documents"
      icon="🗃"
      count={dossier ? lines.length : undefined}
      noun="POL"
      updating={isFetching && !isLoading}
      searchSlot={picker}
      filters={
        <input
          className="innovic-input"
          style={{ minWidth: 260 }}
          placeholder="Search POL, item code, item name, JC No., report, file…"
          aria-label="Search the dossier"
          value={term}
          onChange={(e) => {
            setTerm(e.target.value);
            const n = normalizeSearchTerm(e.target.value);
            void navigate({ search: (p) => ({ ...p, search: n || undefined }), replace: true });
          }}
        />
      }
      filtersActive={term.trim() !== ''}
      onClearFilters={() => {
        setTerm('');
        void navigate({ search: (p) => ({ ...p, search: undefined }), replace: true });
      }}
      tools={
        <>
          {toggle}
          {rights.maySave && dossier && dossier.totals.files > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={zip !== null}
              title="One ZIP with the folder tree below"
              onClick={() => void runZip()}
            >
              {zipLabel(dossier.order.kind === 'so' ? 'SO' : 'JWSO')}
            </button>
          ) : null}
        </>
      }
    />
  );

  if (!orderId) {
    return (
      <div>
        {header}
        <PageState
          state={orders.isLoading ? 'loading' : 'empty'}
          message={orders.isLoading ? 'Loading…' : 'No SO or JWSO yet.'}
        />
      </div>
    );
  }

  return (
    <div>
      {header}
      {upload.input}
      {isError ? (
        <PageState
          state="error"
          message={
            error instanceof Error ? error.message : 'Could not load the dossier. Try again.'
          }
        />
      ) : !dossier ? (
        <PageState state="loading" message="Loading…" />
      ) : (
        <>
          <StatStrip
            style={{ marginBottom: 'var(--sp-3)' }}
            items={[
              {
                key: 'complete',
                label: 'POL complete',
                count: dossier.totals.complete,
                color: 'var(--green2)',
              },
              {
                key: 'missing',
                label: 'POL with reports missing',
                count: dossier.totals.reportMissing,
                color: 'var(--red2)',
              },
              {
                key: 'reports',
                label: 'Reports to upload',
                count: dossier.totals.missingReports,
                color: 'var(--red2)',
                title: 'QC entries saved without their report (mandatory and optional)',
              },
              { key: 'pending', label: 'POL QC not done', count: dossier.totals.qcPending },
              { key: 'noqc', label: 'POL no QC steps / no JC', count: dossier.totals.noQc },
              { key: 'files', label: 'Files', count: dossier.totals.files },
            ]}
          />
          {upload.busyLabel || upload.err || zipMsg ? (
            <div
              role={upload.err || (zipMsg && !zipMsg.ok) ? 'alert' : 'status'}
              className="qd-msg"
              style={{
                color: upload.err || (zipMsg && !zipMsg.ok) ? 'var(--red2)' : 'var(--green2)',
              }}
            >
              {upload.busyLabel
                ? `Uploading ${upload.busyLabel} report…`
                : (upload.err ?? zipMsg?.text)}
            </div>
          ) : null}
          <div className="qd-panes">
            <Panel title="Folders" bodyPadding="none" className="qd-pane">
              <DossierTree dossier={dossier} lines={lines} sel={sel} onSelect={select} />
            </Panel>
            <Panel bodyPadding="none" className="qd-pane">
              {sel.lineId === UNLINKED_ID ? (
                <>
                  <div className="qd-head">
                    <span className="qd-t">Unlinked</span>
                    <span className="qd-kv">Files on this order that trace to no POL</span>
                  </div>
                  <DossierFileSheet
                    rows={rows}
                    orderCode={dossier.order.code}
                    showReport
                    rights={rights}
                    onUpload={upload.start}
                  />
                </>
              ) : line ? (
                <>
                  <DossierLineHead
                    line={line}
                    kind={dossier.order.kind}
                    folder={sel.folder}
                    rights={rights}
                    onUpload={upload.start}
                    zipButton={
                      rights.maySave && lineFileCount(line) > 0 ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled={zip !== null}
                          onClick={() => void runZip(line)}
                        >
                          {zipLabel(`POL ${polLabel(line)}`)}
                        </button>
                      ) : null
                    }
                  />
                  <DossierFileSheet
                    rows={rows}
                    orderCode={dossier.order.code}
                    showReport={!sel.folder}
                    rights={rights}
                    onUpload={upload.start}
                  />
                </>
              ) : (
                <DossierSummary
                  dossier={dossier}
                  lines={lines}
                  onOpenLine={(id) => select({ lineId: id, folder: undefined })}
                />
              )}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}
