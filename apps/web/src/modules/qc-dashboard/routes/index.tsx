import { Link, createRoute } from '@tanstack/react-router';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  Loader2,
  ShieldCheck,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useQcDashboard } from '../api';

const searchSchema = z.object({
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .optional(),
  engineer: z.string().optional(),
});

export const qcDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'qc-dashboard',
  validateSearch: searchSchema,
  component: QcDashboardPage,
});

function currentMonthIso(): string {
  return new Date().toISOString().slice(0, 7);
}

function rateColor(pct: number | null): string {
  if (pct === null) return 'text-muted-foreground';
  if (pct >= 95) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 85) return 'text-amber-600 dark:text-amber-400';
  return 'text-rose-600 dark:text-rose-400';
}

function waitColor(days: number | null): string {
  if (days === null) return 'text-muted-foreground';
  if (days >= 3) return 'text-rose-600 dark:text-rose-400';
  if (days >= 2) return 'text-amber-600 dark:text-amber-400';
  return 'text-emerald-600 dark:text-emerald-400';
}

function QcDashboardPage() {
  const search = qcDashboardRoute.useSearch();
  const navigate = qcDashboardRoute.useNavigate();
  const [monthInput, setMonthInput] = useState(search.month ?? currentMonthIso());

  // Query is sent without our locally-edited month until the user commits via
  // blur or the dashboard refetches with the URL; URL is the source of truth.
  const { data, isLoading, isError, error, isFetching } = useQcDashboard({
    month: search.month,
    engineer: search.engineer,
  });

  // When the URL search changes from outside (back/forward, deep link), sync.
  useMemo(() => {
    if (search.month && search.month !== monthInput) setMonthInput(search.month);
  }, [search.month, monthInput]);

  function applyMonth(next: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(next)) return;
    void navigate({ search: (prev) => ({ ...prev, month: next }) });
  }
  function applyEngineer(next: string): void {
    void navigate({
      search: (prev) => ({ ...prev, engineer: next === '' ? undefined : next }),
    });
  }

  if (isLoading) {
    return (
      <main className="container max-w-6xl py-10">
        <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading QC dashboard…
        </div>
      </main>
    );
  }
  if (isError || !data) {
    return (
      <main className="container max-w-6xl py-10">
        <div className="rounded-lg border border-destructive/50 bg-destructive/5 p-4 text-sm">
          <div className="inline-flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error instanceof Error ? error.message : 'Failed to load QC dashboard'}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container max-w-6xl space-y-6 py-8">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link to="/">
                <ArrowLeft />
                Home
              </Link>
            </Button>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">QC dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Pending QC calls, engineer performance, and the top rejection reasons for the month.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label htmlFor="qc-month" className="text-[10px] uppercase tracking-wide">
              Month
            </Label>
            <Input
              id="qc-month"
              type="month"
              className="h-9 w-[150px]"
              value={monthInput}
              onChange={(e) => setMonthInput(e.target.value)}
              onBlur={(e) => applyMonth(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="qc-engineer" className="text-[10px] uppercase tracking-wide">
              Engineer
            </Label>
            <Select
              id="qc-engineer"
              className="h-9 w-[180px]"
              value={search.engineer ?? ''}
              onChange={(e) => applyEngineer(e.target.value)}
            >
              <option value="">All engineers</option>
              {data.engineers.map((eng) => (
                <option key={eng} value={eng}>
                  {eng}
                </option>
              ))}
            </Select>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>
          Showing month <span className="font-mono">{data.month}</span>
          {data.engineer ? (
            <>
              {' '}
              · engineer <span className="font-mono">{data.engineer}</span>
            </>
          ) : null}
        </span>
        <span className="inline-flex items-center gap-1">
          {isFetching ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              refreshing
            </>
          ) : (
            <>refreshed {new Date(data.generatedAt).toLocaleTimeString()}</>
          )}
        </span>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
        <KpiTile
          title="Pending calls"
          value={data.summary.pendingCalls}
          tone={data.summary.pendingCalls > 0 ? 'warn' : 'ok'}
          hint={
            data.summary.overdueCalls > 0
              ? `${data.summary.overdueCalls} overdue (>1d)`
              : 'caught up'
          }
        />
        <KpiTile
          title="Overdue calls"
          value={data.summary.overdueCalls}
          tone={data.summary.overdueCalls > 0 ? 'danger' : 'ok'}
          hint="qc_call_date > 1 day old"
        />
        <KpiTile title="Inspected today" value={data.summary.inspectedToday} tone="info" />
        <KpiTile title="Accepted today" value={data.summary.acceptedToday} tone="ok" />
        <KpiTile title="Rejected today" value={data.summary.rejectedToday} tone="danger" />
        <KpiTile
          title="Today rate"
          value={data.summary.todayRatePct ?? '—'}
          valueSuffix={data.summary.todayRatePct !== null ? '%' : ''}
          tone="rate"
          rate={data.summary.todayRatePct}
        />
        <KpiTile
          title="Month rate"
          value={data.summary.monthRatePct ?? '—'}
          valueSuffix={data.summary.monthRatePct !== null ? '%' : ''}
          tone="rate"
          rate={data.summary.monthRatePct}
          hint={`${data.summary.monthCalls} calls`}
        />
      </div>

      {/* Two-column: pending + engineer perf */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Pending calls</CardTitle>
              <CardDescription>Oldest call-date first</CardDescription>
            </div>
            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              {data.summary.pendingCalls}
            </span>
          </CardHeader>
          <CardContent className="px-0">
            {data.pending.length === 0 ? (
              <div className="flex flex-col items-center gap-1 py-10 text-sm text-muted-foreground">
                <ShieldCheck className="h-6 w-6 text-emerald-500" />
                No QC pending — caught up.
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>JC</TableHead>
                      <TableHead>Op</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Called</TableHead>
                      <TableHead>Wait</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.pending.map((row) => (
                      <TableRow key={row.jcOpId} className="hover:bg-accent">
                        <TableCell className="font-mono text-xs">
                          <Link
                            to="/op-entry"
                            search={{ jc: row.jcCode } as Record<string, unknown>}
                            className="text-primary hover:underline"
                          >
                            {row.jcCode}
                            <ChevronRight className="ml-0.5 inline h-3 w-3" />
                          </Link>
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-mono">{row.opSeq}</span> {row.operation}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {row.itemCode ?? '—'}
                          {row.soCode ? (
                            <span className="block text-[10px] text-muted-foreground/70">
                              SO {row.soCode}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-xs">{row.qcCallDate ?? '—'}</TableCell>
                        <TableCell className={`text-xs font-medium ${waitColor(row.waitDays)}`}>
                          {row.waitDays === null ? '—' : `${row.waitDays}d`}
                          {row.waitDays !== null && row.waitDays > 1 ? (
                            <CircleAlert className="ml-1 inline h-3 w-3" />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-mono text-sm font-semibold text-amber-600 dark:text-amber-400">
                          {row.qcPending}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">Engineer performance</CardTitle>
              <CardDescription>{data.month} · click an engineer to filter</CardDescription>
            </div>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
              {data.summary.monthCalls} calls
            </span>
          </CardHeader>
          <CardContent className="px-0">
            {data.engineerPerf.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No QC logs this month.
              </div>
            ) : (
              <div className="max-h-[420px] overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Engineer</TableHead>
                      <TableHead className="text-right">Calls</TableHead>
                      <TableHead className="text-right text-emerald-600">Accept</TableHead>
                      <TableHead className="text-right text-rose-600">Reject</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">
                        <Clock className="ml-auto h-3 w-3" />
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.engineerPerf.map((row) => {
                      const selected = data.engineer === row.engineer;
                      return (
                        <TableRow
                          key={row.engineer}
                          className={
                            selected
                              ? 'bg-primary/10 hover:bg-primary/15'
                              : 'cursor-pointer hover:bg-accent'
                          }
                          onClick={() => applyEngineer(selected ? '' : row.engineer)}
                        >
                          <TableCell className="text-xs font-medium">
                            {row.engineer}
                            {selected ? (
                              <span className="ml-1 text-[10px] text-primary">▶</span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-right font-mono">{row.calls}</TableCell>
                          <TableCell className="text-right font-mono text-emerald-600 dark:text-emerald-400">
                            {row.acceptedQty}
                          </TableCell>
                          <TableCell className="text-right font-mono text-rose-600 dark:text-rose-400">
                            {row.rejectedQty}
                          </TableCell>
                          <TableCell
                            className={`text-right font-mono font-semibold ${rateColor(row.ratePct)}`}
                          >
                            {row.ratePct === null ? '—' : `${row.ratePct}%`}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground">
                            {row.avgResponseDays === null ? '—' : `${row.avgResponseDays}d`}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rejection reasons */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Top rejection reasons</CardTitle>
          <CardDescription>{data.month} · max 8 categories</CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {data.topRejectionReasons.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No rejections recorded this month.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reason</TableHead>
                  <TableHead className="text-right">Count</TableHead>
                  <TableHead>Share</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.topRejectionReasons.map((row) => (
                  <TableRow key={row.reasonCategory}>
                    <TableCell className="text-sm font-medium capitalize">
                      {row.reasonCategory}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                      {row.count}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                          <div
                            className="h-full bg-rose-500"
                            style={{ width: `${Math.max(row.pct, 2)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-xs text-muted-foreground">
                          {row.pct}%
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

interface KpiTileProps {
  title: string;
  value: number | string;
  valueSuffix?: string;
  hint?: string;
  tone: 'ok' | 'warn' | 'danger' | 'info' | 'rate';
  rate?: number | null;
}

function KpiTile(props: KpiTileProps) {
  const { title, value, valueSuffix, hint, tone, rate } = props;
  const color =
    tone === 'rate'
      ? rateColor(rate ?? null)
      : tone === 'ok'
        ? value === 0
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-foreground'
        : tone === 'warn'
          ? 'text-amber-600 dark:text-amber-400'
          : tone === 'danger'
            ? value === 0
              ? 'text-muted-foreground'
              : 'text-rose-600 dark:text-rose-400'
            : 'text-foreground';
  return (
    <div className="rounded-lg border bg-card p-3 text-card-foreground">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{title}</div>
      <div className={`mt-1 font-mono text-2xl font-bold ${color}`}>
        {value}
        {valueSuffix ?? ''}
      </div>
      {hint ? <div className="text-[10px] text-muted-foreground">{hint}</div> : null}
    </div>
  );
}
