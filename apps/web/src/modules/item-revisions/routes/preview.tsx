// Drawing page — one Item + Drawing Rev (ABC/1) and its drawing.
//
// Header: ABC/1 · item name · Drawing No. · Print · Download. The drawing is
// shown inline through a server-minted VIEW link (source 'item_revision').
// Download appears only for people with the drawing-download tick (the same
// canDownloadDrawings check the file preview uses); the server refuses it to
// everyone else anyway. Below: the drawing's history and the documents that
// name this Item + Rev, each linking to its own page.
//
// ADR-290: the Drawing Rev Status chip, change note, Released On / By and the
// release "File check" (first 12 characters of the stored file hash); the
// same release actions as the Drawing Register's row ⋯; and the drawing
// corrections asked on a released Rev (Approve / Reject for the Drawing
// Release switch).

import type { RevStatusAction } from '@innovic/shared';
import { Icon } from '@/ui/core';
import { createRoute, useRouter } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import {
  canDownloadDrawings,
  canPrintDrawings,
  canReleaseDrawings,
  useMyAccess,
} from '@/lib/access-control';
import { fmtDateTime } from '@/lib/date';
import { logDrawingPrint, saveDrawing } from '@/lib/drawing-url';
import { useSession } from '@/lib/session';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useItemRevision } from '../api';
import { DrawingCorrectionsTable } from '../components/drawing-corrections-table';
import { DrawingHistoryTable, LinkedDocsTable } from '../components/drawing-history-tables';
import { DrawingViewer, drawingFileKind, useDrawingViewUrl } from '../components/drawing-viewer';
import { ReplaceDrawingDialog } from '../components/replace-drawing-dialog';
import { RevStatusBadge } from '../components/rev-status-badge';
import {
  RevActionDialog,
  revActionsFor,
  useRevActionRights,
  type RevActionTarget,
} from '../components/rev-status-actions';
import { printDrawing } from '../lib/print-drawing';
import { RefreshFailedNote, hardError } from '@/lib/refresh-failed-note';
import { oneOf, usePersistentState } from '@/lib/use-persistent-state';

export const itemRevisionPreviewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'drawings/$itemRevisionId',
  component: DrawingPage,
});

type TabKey = 'drawing' | 'history' | 'linked' | 'corrections';

function DrawingPage(): React.JSX.Element {
  const { itemRevisionId } = itemRevisionPreviewRoute.useParams();
  const router = useRouter();
  const query = useItemRevision(itemRevisionId);
  const { data: rev, isLoading, isError, error } = query;
  const { data: eff } = useMyAccess();
  const { data: me } = useSession();
  const { data: company } = useMyCompany();
  const mayDownload = canDownloadDrawings(eff, me?.role);
  // ADR-289 — Print only for the "Can print drawings" switch; the server
  // checks it again (and logs the print) before the window opens.
  const mayPrint = canPrintDrawings(eff, me?.role);
  const path = rev?.drawingFilePath ?? null;
  const view = useDrawingViewUrl(path, rev?.label ?? '');
  const [tab, setTab] = usePersistentState<TabKey>(
    `rev-preview:${itemRevisionId}:tab`,
    'drawing',
    oneOf(['drawing', 'history', 'linked', 'corrections']),
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const rights = useRevActionRights();
  const mayRelease = canReleaseDrawings(eff, me?.role);
  const [acting, setActing] = useState<RevStatusAction | null>(null);
  const [replacing, setReplacing] = useState(false);

  if (isLoading) return <PageState state="loading" message="Loading drawing…" />;
  if (!rev || hardError(query)) {
    return (
      <PageState
        state="error"
        message={error instanceof Error ? error.message : 'Drawing not found.'}
      />
    );
  }

  const target: RevActionTarget = {
    id: rev.id,
    label: rev.label,
    releaseStatus: rev.releaseStatus,
    updatedAt: rev.updatedAt,
    hasFile: Boolean(path),
  };
  const actions = revActionsFor(target, rights);
  const corrections = rev.corrections ?? [];
  // ADR-319 — also on a Rev with no file: "Upload drawing…" gives it its first file.
  const mayReplace = rights.replace && rev.releaseStatus !== 'obsolete';

  const onPrint = async (): Promise<void> => {
    setNotice(null);
    setPrinting(true);
    try {
      await logDrawingPrint({ itemRevisionId: rev.id, ...(path ? { path } : {}) });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not print the drawing.');
      return;
    } finally {
      setPrinting(false);
    }
    const ok = printDrawing({
      revision: rev,
      company,
      fileUrl: view.url,
      fileKind: path ? drawingFileKind(path) : 'none',
    });
    if (!ok) setNotice('Allow popups to print.');
  };
  const onDownload = async (): Promise<void> => {
    if (!path) return;
    setNotice(null);
    setSaving(true);
    try {
      await saveDrawing({
        path,
        source: 'item_revision',
        refCode: rev.label,
        fileName: fileNameFromPath(path),
      });
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'Could not download the drawing.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-fill">
      <RefreshFailedNote show={isError} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 'var(--sp-2)',
          marginBottom: 'var(--panel-gap)',
        }}
      >
        <button type="button" className="btn btn-ghost" onClick={() => router.history.back()}>
          <ArrowLeft size={14} /> Back
        </button>
        <span className="td-code" style={{ fontSize: 'var(--fs-md)' }}>
          {rev.label}
        </span>
        <span className="panel-title">Drawing</span>
        <span style={{ flex: 1 }} />
        {actions.map((a) => (
          <button
            key={a.action}
            type="button"
            className={
              a.action === 'reject' || a.action === 'obsolete'
                ? 'btn btn-ghost red'
                : 'btn btn-ghost'
            }
            onClick={() => setActing(a.action)}
            disabled={Boolean(a.disabledReason)}
            title={a.disabledReason}
          >
            {a.label}
          </button>
        ))}
        {mayReplace ? (
          <button type="button" className="btn btn-ghost" onClick={() => setReplacing(true)}>
            {path ? 'Replace drawing…' : 'Upload drawing…'}
          </button>
        ) : null}
        {mayPrint ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onPrint()}
            disabled={!path || printing}
            title={path ? undefined : 'This Drawing Rev has no drawing file'}
          >
            <Icon name="printer" size={13} /> {printing ? 'Printing…' : 'Print'}
          </button>
        ) : null}
        {mayDownload && path ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onDownload()}
            disabled={saving}
          >
            <Icon name="download" size={13} /> {saving ? 'Downloading…' : 'Download'}
          </button>
        ) : null}
      </div>

      {notice ? (
        <div style={{ marginBottom: 'var(--panel-gap)' }}>
          <Banner tone="error" role="alert" flush onDismiss={() => setNotice(null)}>
            {notice}
          </Banner>
        </div>
      ) : null}

      <Panel>
        <DocIdent>
          <IdentCode>{rev.label}</IdentCode>
          <span>{rev.itemName ?? '— unknown item —'}</span>
          <IdentSep />
          <span className="text3">Drawing No.</span>
          <span className="mono fw-700">{rev.drawingNo ?? '—'}</span>
          <IdentSep />
          <span className="text3">Route Card</span>
          <span className="mono fw-700">{rev.routeCardCode ?? '—'}</span>
          <IdentSep />
          <span className="text3">Drawing Rev Status</span>
          <RevStatusBadge status={rev.releaseStatus} />
        </DocIdent>
        <DocIdent>
          <span className="text3">Released On</span>
          <span className="mono">{fmtDateTime(rev.releasedAt)}</span>
          <IdentSep />
          <span className="text3">Released By</span>
          <span>{rev.releasedByName ?? '—'}</span>
          <IdentSep />
          <span className="text3">File check</span>
          <span className="mono" title={rev.fileHash ?? undefined}>
            {rev.fileHash ? rev.fileHash.slice(0, 12) : '—'}
          </span>
          {rev.changeNote ? (
            <>
              <IdentSep />
              <span className="text3">Change Note</span>
              <span title={rev.changeNote}>{rev.changeNote}</span>
            </>
          ) : null}
        </DocIdent>
      </Panel>

      <TabStrip
        label="Drawing"
        activeKey={tab}
        onChange={(k) => setTab(k as TabKey)}
        tabs={[
          { key: 'drawing', label: 'Drawing' },
          { key: 'history', label: 'Drawing History', count: rev.history.length },
          { key: 'linked', label: 'Linked Documents', count: rev.linkedDocs.length },
          { key: 'corrections', label: 'Drawing corrections', count: corrections.length },
        ]}
      />

      <Panel fill bodyPadding={tab === 'drawing' ? undefined : 'none'}>
        {tab === 'drawing' ? (
          path ? (
            <DrawingViewer path={path} url={view.url} error={view.error} label={rev.label} />
          ) : (
            <div className="empty-state">Not uploaded — no drawing on file for {rev.label}.</div>
          )
        ) : null}
        {tab === 'history' ? <DrawingHistoryTable rows={rev.history} /> : null}
        {tab === 'linked' ? <LinkedDocsTable rows={rev.linkedDocs} /> : null}
        {tab === 'corrections' ? (
          <DrawingCorrectionsTable rows={corrections} label={rev.label} mayDecide={mayRelease} />
        ) : null}
      </Panel>

      {acting ? (
        <RevActionDialog target={target} action={acting} onClose={() => setActing(null)} />
      ) : null}
      {replacing ? (
        <ReplaceDrawingDialog
          revision={rev}
          firstFile={!path}
          onCancel={() => setReplacing(false)}
          onDone={() => setReplacing(false)}
        />
      ) : null}
    </div>
  );
}
