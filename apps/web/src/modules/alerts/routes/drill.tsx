// Alerts drill-down page (T-041d Phase A). Mirrors legacy
// `_alertDrillDown` modal — renders the records table for one alert
// with the columns declared in the registry definition.

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2 } from 'lucide-react';
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
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAlert } from '../api';
import { DEPT_LABEL, DEPT_TONE } from '../lib/dept';

export const alertsDrillRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts/$code',
  component: AlertDrillPage,
});

function AlertDrillPage() {
  const { code } = alertsDrillRoute.useParams();
  const { data, isLoading, isError, error } = useAlert(code);

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/alerts">
            <ArrowLeft />
            Back to alerts
          </Link>
        </Button>

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
              <CardTitle>
                {error?.message?.toLowerCase().includes('not found')
                  ? 'Alert not found'
                  : 'Failed to load alert'}
              </CardTitle>
              <CardDescription>
                {error?.message?.toLowerCase().includes('not found')
                  ? `No registered alert with code ${code}.`
                  : (error?.message ?? 'Unknown error')}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex items-center gap-3">
                <span className={`text-xs font-bold uppercase ${DEPT_TONE[data.alert.dept].text}`}>
                  {DEPT_LABEL[data.alert.dept]}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{data.alert.code}</span>
                <span className="font-mono text-sm font-bold text-amber-600 dark:text-amber-400">
                  {data.alert.count} record{data.alert.count === 1 ? '' : 's'}
                </span>
              </div>
              <h1 className="text-2xl font-semibold tracking-tight">{data.alert.name}</h1>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {data.columns.map((c) => (
                        <TableHead key={c.key} className={c.type === 'number' ? 'text-right' : ''}>
                          {c.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.alert.records.length === 0 ? (
                      <TableEmpty colSpan={data.columns.length}>
                        ✅ No records — alert is currently clear.
                      </TableEmpty>
                    ) : (
                      data.alert.records.map((row, i) => (
                        <TableRow key={`row-${i}`}>
                          {data.columns.map((c) => {
                            const v = row[c.key];
                            const display =
                              v == null
                                ? ''
                                : c.type === 'number'
                                  ? Number(v).toLocaleString()
                                  : String(v);
                            return (
                              <TableCell
                                key={c.key}
                                className={
                                  c.type === 'number'
                                    ? 'text-right font-mono'
                                    : c.type === 'date'
                                      ? 'font-mono text-sm'
                                      : ''
                                }
                              >
                                {display}
                              </TableCell>
                            );
                          })}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </main>
  );
}
