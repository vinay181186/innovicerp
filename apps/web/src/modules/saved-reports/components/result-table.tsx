// Renders the result of a run / preview: header card, optional summary
// table, then the row table with CSV export. Shared by the run route and
// the builder live preview.

import type { AdHocColumn, RunAdHocResponse } from '@innovic/shared';
import { Download, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { downloadCsv, rowsToCsv } from '../lib/csv';

interface Props {
  data: RunAdHocResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  errorMessage?: string | undefined;
  filenamePrefix: string;
}

export function ResultTable({
  data,
  isLoading,
  isError,
  errorMessage,
  filenamePrefix,
}: Props): JSX.Element {
  const onCsv = () => {
    if (!data) return;
    const csv = rowsToCsv(data.columns, data.rows);
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    downloadCsv(`${filenamePrefix}-${stamp}.csv`, csv);
  };

  return (
    <div className="space-y-6">
      {data && data.summary.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Summary</CardTitle>
            <CardDescription>
              Grouped count
              {data.summaryColumn ? ` + ${data.summaryFunction} of ${data.summaryColumn}` : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    {data.summaryColumn ? (
                      <TableHead className="text-right">
                        {data.summaryFunction} ({data.summaryColumn})
                      </TableHead>
                    ) : null}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.summary.map((row, i) => (
                    <TableRow key={`${row.group}-${i}`}>
                      <TableCell className="font-medium">{row.group}</TableCell>
                      <TableCell className="text-right font-mono">
                        {row.count.toLocaleString()}
                      </TableCell>
                      {data.summaryColumn ? (
                        <TableCell className="text-right font-mono">
                          {row.aggregate ? Number(row.aggregate).toLocaleString() : '—'}
                        </TableCell>
                      ) : null}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  {(data?.columns ?? []).map((col) => (
                    <TableHead key={col.key} className={col.type === 'number' ? 'text-right' : ''}>
                      {col.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableEmpty colSpan={Math.max(1, data?.columns.length ?? 1)}>
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Running…
                    </span>
                  </TableEmpty>
                ) : isError ? (
                  <TableEmpty colSpan={Math.max(1, data?.columns.length ?? 1)}>
                    <span className="text-destructive">
                      {errorMessage ?? 'Failed to run report.'}
                    </span>
                  </TableEmpty>
                ) : !data || data.rows.length === 0 ? (
                  <TableEmpty colSpan={Math.max(1, data?.columns.length ?? 1)}>
                    No rows match this spec.
                  </TableEmpty>
                ) : (
                  data.rows.map((row, i) => (
                    <TableRow key={i}>
                      {data.columns.map((col) => (
                        <TableCell
                          key={col.key}
                          className={col.type === 'number' ? 'text-right font-mono' : ''}
                        >
                          {renderCell(col, row[col.key])}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function renderCell(col: AdHocColumn, raw: unknown): JSX.Element {
  if (raw === null || raw === undefined) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (col.type === 'number') {
    return <span>{Number(raw).toLocaleString()}</span>;
  }
  return <span className="text-sm">{String(raw)}</span>;
}
