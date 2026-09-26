// Saved Report run page — house layout (section header + panels), was a
// shadcn Card page. Data, routes and export calls are unchanged.

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { ApiError, apiDownload } from '@/lib/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSavedReport, useSavedReportRun, useSourceCatalog } from '../api';
import { ResultTable } from '../components/result-table';

export const savedReportRunRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports/$id',
  component: SavedReportRunPage,
});

function SavedReportRunPage(): React.JSX.Element {
  const { id } = savedReportRunRoute.useParams();
  const reportQ = useSavedReport(id);
  const runQ = useSavedReportRun(id);
  const { data: catalog } = useSourceCatalog();
  const [excelLoading, setExcelLoading] = useState(false);

  const onExcel = async () => {
    setExcelLoading(true);
    try {
      await apiDownload(
        `/saved-reports/${id}/export.xlsx`,
        {},
        `${reportQ.data?.name ?? 'report'}.xlsx`,
      );
    } finally {
      setExcelLoading(false);
    }
  };

  const report = reportQ.data;
  // Source label ("Sales Orders"), never the raw source key.
  const sourceLabel = report
    ? catalog?.sources.find((s) => s.sourceKey === report.sourceKey)?.label
    : undefined;

  return (
    <div>
      <Link to="/saved-reports" className="btn btn-ghost btn-sm" style={{ marginBottom: 10 }}>
        <ArrowLeft size={14} /> Back to Saved Reports
      </Link>

      {reportQ.isLoading ? (
        <div className="panel">
          <div className="panel-body empty-state">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading…
          </div>
        </div>
      ) : reportQ.isError || !report ? (
        <div className="panel">
          <div className="panel-body empty-state" style={{ color: 'var(--red2)' }}>
            {/* 404 (or no row) = the report is gone; any other failure shows
                the server's own message so a network/permission error is
                not mistaken for a deletion. */}
            {reportQ.isError &&
            !(reportQ.error instanceof ApiError && reportQ.error.status === 404) &&
            reportQ.error instanceof Error
              ? reportQ.error.message
              : 'Saved report not found. It may have been deleted.'}
          </div>
        </div>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
              marginBottom: 12,
            }}
          >
            <div>
              <div className="section-hdr" style={{ marginBottom: 2 }}>
                {report.name}
              </div>
              {report.description ? (
                <div className="text2" style={{ fontSize: 12 }}>
                  {report.description}
                </div>
              ) : null}
              <div
                className="text3"
                style={{
                  fontSize: 11,
                  marginTop: 4,
                  display: 'flex',
                  gap: 8,
                  alignItems: 'center',
                }}
              >
                {sourceLabel ? <span>{sourceLabel}</span> : null}
                {report.isShared ? (
                  <span className="badge b-green">Shared</span>
                ) : (
                  <span className="badge b-grey">Private</span>
                )}
              </div>
            </div>
            <Link to="/saved-reports/$id/edit" params={{ id }} className="btn btn-ghost btn-sm">
              ✎ Edit
            </Link>
          </div>

          <ResultTable
            data={runQ.data}
            isLoading={runQ.isLoading}
            isError={runQ.isError}
            errorMessage={runQ.error instanceof Error ? runQ.error.message : undefined}
            filenamePrefix={report.name.replace(/[^a-z0-9-]/gi, '_').toLowerCase()}
            onExcel={onExcel}
            excelLoading={excelLoading}
          />
        </>
      )}
    </div>
  );
}
