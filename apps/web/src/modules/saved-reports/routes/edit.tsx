import type { AdHocSpec } from '@innovic/shared';
import { Link, createRoute, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { apiDownload } from '@/lib/api';
import { useExitConfirm } from '@/lib/exit-guard';
import { useEditConflict } from '@/lib/use-edit-conflict';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useFetchSavedReport,
  usePreviewSpec,
  useSavedReport,
  useSourceCatalog,
  useUpdateSavedReport,
} from '../api';
import { Builder, type SaveInput } from '../components/builder';

// ADR-225 — the fields THIS screen can edit, and what the user calls each one
// (the builder's own labels; none of the four has a row in docs/NAMING.md).
//
// `spec` — the whole builder canvas (source, columns, filters, grouping, the
// total) — is ONE JSONB column, so it is one field to the diff: either the
// report definition changed or it did not. The owner's decision (ADR-225) is
// that it is not merged any finer than that; merging a rename against somebody
// else's rebuilt canvas buys nothing worth having.
//
// `sourceKey` is deliberately NOT in the list: it is a copy of `spec.sourceKey`,
// so it is not a field of its own to the user. It rides along whenever `spec`
// goes, which keeps the two columns from drifting apart.
const REPORT_EDITABLE = ['name', 'description', 'isShared', 'spec'] as const;

const REPORT_LABELS: Record<string, string> = {
  name: 'Report Name',
  description: 'Description',
  isShared: 'Shared',
  spec: 'The report itself',
};

export const savedReportEditRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports/$id/edit',
  component: SavedReportEditPage,
});

function SavedReportEditPage() {
  const { id } = savedReportEditRoute.useParams();
  const navigate = useNavigate();
  const sourcesQ = useSourceCatalog();
  const reportQ = useSavedReport(id);
  const previewMutation = usePreviewSpec();
  const updateMutation = useUpdateSavedReport(id);
  const fetchReport = useFetchSavedReport();
  // ADR-225 / §20.4 — sends only what changed, merges onto someone else's save
  // instead of overwriting it, and raises the 3-second notice. Also subscribes to
  // this one report, so a shared report's other editor is announced the moment
  // they save rather than after this user has rebuilt the canvas.
  //
  // It never re-seeds the builder: the hook deliberately does not touch form
  // state, and `<Builder>` reads `initial` only in its `useState` initialisers,
  // so a conflict re-read cannot discard work in progress.
  const conflict = useEditConflict({
    table: 'saved_reports',
    id,
    record: reportQ.data,
    refetch: () => fetchReport(id),
    editableKeys: REPORT_EDITABLE,
    label: (f) => REPORT_LABELS[f] ?? f,
    noun: 'report',
  });
  const [saveError, setSaveError] = useState<string | undefined>(undefined);
  const [excelLoading, setExcelLoading] = useState(false);
  const exit = useExitConfirm();

  const onExcel = async (spec: AdHocSpec) => {
    setExcelLoading(true);
    try {
      await apiDownload('/saved-reports/preview/export.xlsx', { method: 'POST', json: spec });
    } finally {
      setExcelLoading(false);
    }
  };

  const onSave = (input: SaveInput) => {
    setSaveError(undefined);
    const current = {
      name: input.name,
      description: input.description,
      isShared: input.isShared,
      spec: input.spec,
    };
    void (async () => {
      try {
        const saved = await conflict.save(current, (payload, expectedUpdatedAt) =>
          updateMutation.mutateAsync({
            ...payload,
            // `sourceKey` is a copy of the spec's own source, so it travels with
            // the spec and never on its own.
            ...(payload.spec ? { sourceKey: payload.spec.sourceKey } : {}),
            ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
          }),
        );
        // null = nothing actually changed; the user has been told and nothing was
        // written. Stay in the builder.
        if (saved === null) return;
        exit.leave(() => void navigate({ to: '/saved-reports/$id', params: { id } }));
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    })();
  };

  const loading = sourcesQ.isLoading || reportQ.isLoading;
  const errored = sourcesQ.isError || reportQ.isError;
  const errorMessage =
    sourcesQ.error instanceof Error
      ? sourcesQ.error.message
      : reportQ.error instanceof Error
        ? reportQ.error.message
        : 'Try again.';

  return (
    <div>
      {exit.dialog}
      {/* Legacy header — renderReportBuilder L17554-59. Legacy serves both new and edit
          from the one renderReportBuilder, so this matches routes/new.tsx exactly. */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="section-hdr m-0">Edit Saved Report</div>
        <div className="flex items-center gap-2">
          <Link to="/saved-reports/$id" params={{ id }} className="btn btn-sm btn-ghost">
            ← Back to Report
          </Link>
        </div>
      </div>

      {loading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="empty-state">Loading…</div>
          </div>
        </div>
      ) : errored || !sourcesQ.data || !reportQ.data ? (
        <div className="panel">
          <div className="panel-hdr">
            <div className="panel-title">Could not load saved report. Try again.</div>
          </div>
          <div className="panel-body">
            <div className="empty-state">{errorMessage}</div>
          </div>
        </div>
      ) : (
        <Builder
          sources={sourcesQ.data.sources}
          initial={{
            name: reportQ.data.name,
            description: reportQ.data.description,
            isShared: reportQ.data.isShared,
            spec: reportQ.data.spec,
          }}
          onSave={onSave}
          onPreview={(spec) => previewMutation.mutate(spec)}
          preview={previewMutation.data}
          previewLoading={previewMutation.isPending}
          previewError={
            previewMutation.error instanceof Error ? previewMutation.error.message : undefined
          }
          onExcel={onExcel}
          excelLoading={excelLoading}
          saving={updateMutation.isPending}
          saveError={saveError}
          saveLabel="Save Changes"
        />
      )}
    </div>
  );
}
