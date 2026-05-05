import { Link, createRoute } from '@tanstack/react-router';
import { ArrowRight, Eye, Loader2, Plus, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useSavedReportsList, useDeleteSavedReport } from '../api';

export const savedReportsListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'saved-reports',
  component: SavedReportsListPage,
});

function SavedReportsListPage() {
  const { data, isLoading, isError, error } = useSavedReportsList();
  const deleteMutation = useDeleteSavedReport();

  const onDelete = (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This soft-deletes; admins can recover.`)) return;
    deleteMutation.mutate(id);
  };

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-1 h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Saved reports</h1>
              <p className="text-sm text-muted-foreground">
                Drag-and-drop builder layered on the engine — pick a source, choose columns +
                filters, save and re-run.
              </p>
            </div>
          </div>
          <Button asChild>
            <Link to="/saved-reports/new">
              <Plus />
              New report
            </Link>
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-6">
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load saved reports</CardTitle>
              <CardDescription>
                {error instanceof Error ? error.message : 'Unknown error'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : data.reports.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No saved reports yet</CardTitle>
              <CardDescription>
                Click <span className="font-medium">New report</span> to compose one.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <div className="grid gap-3">
            {data.reports.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between gap-3 rounded-lg border bg-card p-4 text-card-foreground"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Link
                      to="/saved-reports/$id"
                      params={{ id: r.id }}
                      className="font-medium hover:underline"
                    >
                      {r.name}
                    </Link>
                    {r.isShared ? (
                      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                        shared
                      </span>
                    ) : (
                      <span className="rounded-full border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        private
                      </span>
                    )}
                  </div>
                  {r.description ? (
                    <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                  ) : null}
                  <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {r.sourceKey} · {r.spec.columns.length} columns ·{' '}
                    {r.spec.filters.length === 0
                      ? 'no filters'
                      : `${r.spec.filters.length} filter${r.spec.filters.length === 1 ? '' : 's'}`}
                    {r.ownerEmail ? ` · ${r.ownerEmail}` : null}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/saved-reports/$id" params={{ id: r.id }}>
                      <Eye />
                      Run
                    </Link>
                  </Button>
                  <Button asChild variant="ghost" size="sm">
                    <Link to="/saved-reports/$id/edit" params={{ id: r.id }}>
                      Edit
                      <ArrowRight />
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(r.id, r.name)}
                    aria-label={`Delete ${r.name}`}
                  >
                    <Trash2 className="text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
