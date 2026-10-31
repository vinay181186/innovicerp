// Drawing page — one Item + Drawing Rev (ABC/1) and its drawing.
//
// Header: ABC/1 · item name · Drawing No. · Print · Download. The drawing is
// shown inline through a server-minted VIEW link (source 'item_revision').
// Download appears only for people with the drawing-download tick (the same
// canDownloadDrawings check the file preview uses); the server refuses it to
// everyone else anyway. Below: the drawing's history and the documents that
// name this Item + Rev, each linking to its own page.

import { createRoute, useRouter } from '@tanstack/react-router';
import { ArrowLeft, Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { fileNameFromPath } from '@/components/shared/file-preview-modal';
import { canDownloadDrawings, useMyAccess } from '@/lib/access-control';
import { saveDrawing } from '@/lib/drawing-url';
import { useSession } from '@/lib/session';
import { useMyCompany } from '@/modules/settings/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { Panel } from '@/ui/data';
import { Banner } from '@/ui/feedback';
import { DocIdent, IdentCode, IdentSep } from '@/ui/forms';
import { PageState } from '@/ui/layout';
import { TabStrip } from '@/ui/navigation';
import { useItemRevision } from '../api';
import { DrawingHistoryTable, LinkedDocsTable } from '../components/drawing-history-tables';
import { DrawingViewer, drawingFileKind, useDrawingViewUrl } from '../components/drawing-viewer';
import { printDrawing } from '../lib/print-drawing';

export const itemRevisionPreviewRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'drawings/$itemRevisionId',
  component: DrawingPage,
});

type TabKey = 'drawing' | 'history' | 'linked';

function DrawingPage(): React.JSX.Element {
  const { itemRevisionId } = itemRevisionPreviewRoute.useParams();
  const router = useRouter();
  const { data: rev, isLoading, isError, error } = useItemRevision(itemRevisionId);
  const { data: eff } = useMyAccess();
  const { data: me } = useSession();
  const { data: company } = useMyCompany();
  const mayDownload = canDownloadDrawings(eff, me?.role);
  const path = rev?.drawingFilePath ?? null;
  const view = useDrawingViewUrl(path, rev?.label ?? '');
  const [tab, setTab] = useState<TabKey>('drawing');
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (isLoading) return <PageState state="loading" message="Loading drawing…" />;
  if (isError || !rev) {
    return (
      <PageState
        state="error"
        message={error instanceof Error ? error.message : 'Drawing not found.'}
      />
    );
  }

  const onPrint = (): void => {
    setNotice(null);
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
        <button type="button" className="btn btn-ghost" onClick={onPrint} disabled={!path}>
          <Printer size={13} /> Print
        </button>
        {mayDownload && path ? (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void onDownload()}
            disabled={saving}
          >
            <Download size={13} /> {saving ? 'Downloading…' : 'Download'}
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
      </Panel>
    </div>
  );
}
