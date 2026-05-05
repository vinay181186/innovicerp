import type { ReportColumn, ReportFilterField } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Download, Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { apiDownload } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useReportList, useReportRun } from '../api';
import { downloadCsv, rowsToCsv } from '../lib/csv';

const runSearchSchema = z.record(z.string()).default({});

export const reportRunRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'reports/$slug',
  validateSearch: runSearchSchema,
  component: ReportRunPage,
});

function ReportRunPage() {
  const { slug } = reportRunRoute.useParams();
  const search = reportRunRoute.useSearch();
  const navigate = reportRunRoute.useNavigate();

  const { data: list } = useReportList();
  const definition = useMemo(() => list?.reports.find((r) => r.slug === slug), [list, slug]);

  const [pendingFilters, setPendingFilters] = useState<Record<string, string>>(() =>
    stripBlanks(search),
  );
  const appliedFilters: Record<string, string> = useMemo(() => stripBlanks(search), [search]);

  const { data, isLoading, isFetching, isError, error } = useReportRun(slug, appliedFilters);

  const onApply = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      search: () => stripBlanks(pendingFilters),
      replace: true,
    });
  };

  const onClear = () => {
    setPendingFilters({});
    void navigate({ search: () => ({}), replace: true });
  };

  const onCsv = () => {
    if (!data) return;
    const csv = rowsToCsv(data.columns, data.rows);
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    downloadCsv(`${data.slug}-${stamp}.csv`, csv);
  };

  const [excelLoading, setExcelLoading] = useState(false);
  const onExcel = async () => {
    if (!slug) return;
    const params = new URLSearchParams(appliedFilters);
    const qs = params.toString();
    setExcelLoading(true);
    try {
      await apiDownload(`/reports/${slug}/export.xlsx${qs ? `?${qs}` : ''}`, {}, `${slug}.xlsx`);
    } finally {
      setExcelLoading(false);
    }
  };

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/reports">
            <ArrowLeft />
            Back to reports
          </Link>
        </Button>

        {!definition ? (
          <Card>
            <CardHeader>
              <CardTitle>Report not found</CardTitle>
              <CardDescription>
                There is no registered report with slug <span className="font-mono">{slug}</span>.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">{definition.title}</h1>
              <p className="text-sm text-muted-foreground">{definition.description}</p>
            </div>

            {definition.filters.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Filters</CardTitle>
                </CardHeader>
                <CardContent>
                  <form onSubmit={onApply} className="space-y-4">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      {definition.filters.map((filter) => (
                        <FilterInput
                          key={filter.key}
                          filter={filter}
                          value={pendingFilters[filter.key] ?? ''}
                          onChange={(v) =>
                            setPendingFilters((prev) => ({ ...prev, [filter.key]: v }))
                          }
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button type="submit" disabled={isFetching}>
                        {isFetching ? <Loader2 className="animate-spin" /> : null}
                        Apply
                      </Button>
                      <Button type="button" variant="outline" onClick={onClear}>
                        Clear
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            ) : null}

            <Card>
              <CardHeader>
                <div className="flex items-baseline justify-between gap-4">
                  <div>
                    <CardTitle className="text-base">Results</CardTitle>
                    <CardDescription>
                      {data
                        ? `${data.rowCount} rows · refreshed ${new Date(
                            data.generatedAt,
                          ).toLocaleTimeString()}`
                        : 'No results yet.'}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onCsv}
                      disabled={!data || data.rowCount === 0}
                    >
                      <Download />
                      Export CSV
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={onExcel}
                      disabled={!data || data.rowCount === 0 || excelLoading}
                    >
                      {excelLoading ? <Loader2 className="animate-spin" /> : <Download />}
                      Export Excel
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <ResultsTable
                  columns={definition.columns}
                  data={data}
                  isLoading={isLoading}
                  isError={isError}
                  errorMessage={error instanceof Error ? error.message : undefined}
                />
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}

function FilterInput(props: {
  filter: ReportFilterField;
  value: string;
  onChange: (v: string) => void;
}) {
  const { filter, value, onChange } = props;
  return (
    <div className="space-y-2">
      <Label htmlFor={`filter-${filter.key}`}>{filter.label}</Label>
      {filter.kind === 'date' ? (
        <Input
          id={`filter-${filter.key}`}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Select
          id={`filter-${filter.key}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">All</option>
          {(filter.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt.replaceAll('_', ' ')}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}

function ResultsTable(props: {
  columns: ReportColumn[];
  data: ReturnType<typeof useReportRun>['data'];
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | undefined;
}) {
  const { columns, data, isLoading, isError, errorMessage } = props;

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col.key}>{col.label}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableEmpty colSpan={columns.length}>
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Running…
              </span>
            </TableEmpty>
          ) : isError ? (
            <TableEmpty colSpan={columns.length}>
              <span className="text-destructive">{errorMessage ?? 'Failed to run report.'}</span>
            </TableEmpty>
          ) : !data || data.rows.length === 0 ? (
            <TableEmpty colSpan={columns.length}>No rows match these filters.</TableEmpty>
          ) : (
            data.rows.map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col.key}>{renderCell(col, row[col.key])}</TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function renderCell(col: ReportColumn, raw: unknown): React.ReactNode {
  if (raw === null || raw === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (col.type === 'number') {
    return <span className="font-mono text-sm">{Number(raw).toLocaleString()}</span>;
  }
  if (col.type === 'date' || col.type === 'datetime') {
    return <span className="font-mono text-xs">{String(raw)}</span>;
  }
  return <span className="text-sm">{String(raw)}</span>;
}

function stripBlanks(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && v.length > 0) out[k] = v;
  }
  return out;
}
