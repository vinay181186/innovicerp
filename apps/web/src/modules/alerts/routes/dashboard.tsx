// Alerts dashboard (T-041d Phase A). Mirrors legacy `renderAlerts`
// (legacy/InnovicERP_v82_12_3_DataLossFix_29-04-2026.html L22323):
//   - per-dept summary chips with the legacy colour palette
//   - total-records chip
//   - main table: dept · code · name · count
//   - clickable row when count > 0 → drill-down route
//   - "show zero records" toggle (legacy default false)
//   - manual refresh button (60s polling otherwise)

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowRight, Bell, BellOff, BellRing, Loader2, RefreshCw } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
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
import { useAlerts, alertsKeys, useMySubscriptions, useToggleSubscription } from '../api';
import { DEPT_LABEL, DEPT_TONE } from '../lib/dept';
import { useQueryClient } from '@tanstack/react-query';

export const alertsDashboardRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts',
  component: AlertsDashboardPage,
});

function AlertsDashboardPage() {
  const { data, isLoading, isFetching, isError, error, refetch } = useAlerts();
  const subscriptions = useMySubscriptions();
  const toggleSub = useToggleSubscription();
  const qc = useQueryClient();
  const [showZero, setShowZero] = useState(false);

  const subscribedCodes = useMemo(() => {
    const set = new Set<string>();
    for (const s of subscriptions.data?.subscriptions ?? []) set.add(s.code);
    return set;
  }, [subscriptions.data]);

  const visible = useMemo(() => {
    if (!data) return [];
    const sorted = [...data.alerts].sort((a, b) => a.code.localeCompare(b.code));
    return showZero ? sorted : sorted.filter((a) => a.count > 0);
  }, [data, showZero]);

  const total = useMemo(() => (data ? data.alerts.reduce((s, a) => s + a.count, 0) : 0), [data]);

  const byDept = useMemo(() => {
    const out: Record<string, number> = {};
    if (!data) return out;
    for (const a of data.alerts) {
      out[a.dept] = (out[a.dept] ?? 0) + a.count;
    }
    return out;
  }, [data]);

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <Bell className="mt-1 h-6 w-6 text-muted-foreground" />
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Alerts dashboard</h1>
              <p className="text-sm text-muted-foreground">
                Live tripwires across sales, purchase, store, design, production, and QC.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link to="/alerts/config">Configure</Link>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void qc.invalidateQueries({ queryKey: alertsKeys.list() });
                void refetch();
              }}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? 'animate-spin' : ''} />
              Refresh
            </Button>
          </div>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-6">
              <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading alerts…
              </div>
            </CardContent>
          </Card>
        ) : isError || !data ? (
          <Card>
            <CardHeader>
              <CardTitle>Failed to load alerts</CardTitle>
              <CardDescription>
                {error instanceof Error ? error.message : 'Unknown error'}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <>
            {/* Department summary chips. */}
            <div className="flex flex-wrap items-stretch gap-3">
              {(Object.keys(byDept) as Array<keyof typeof DEPT_TONE>).map((dept) => (
                <div
                  key={dept}
                  className={`min-w-[100px] rounded-lg border p-3 text-center ${DEPT_TONE[dept].border}`}
                >
                  <div
                    className={`text-[10px] font-semibold uppercase tracking-wide ${DEPT_TONE[dept].text}`}
                  >
                    {DEPT_LABEL[dept]}
                  </div>
                  <div
                    className={`mt-1 font-mono text-2xl font-bold ${
                      byDept[dept] === 0 ? 'text-emerald-600' : 'text-amber-600'
                    }`}
                  >
                    {byDept[dept]}
                  </div>
                </div>
              ))}
              <div className="min-w-[100px] rounded-lg border-2 border-rose-300 p-3 text-center dark:border-rose-700">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-rose-600 dark:text-rose-400">
                  Total
                </div>
                <div
                  className={`mt-1 font-mono text-2xl font-bold ${
                    total === 0 ? 'text-emerald-600' : 'text-rose-600'
                  }`}
                >
                  {total}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end">
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={showZero}
                  onChange={(e) => setShowZero(e.target.checked)}
                  className="h-4 w-4 cursor-pointer accent-cyan-600"
                />
                <Label className="cursor-pointer text-xs">Show zero-record alerts</Label>
              </label>
            </div>

            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-32">Department</TableHead>
                      <TableHead className="w-24">Code</TableHead>
                      <TableHead>Alert</TableHead>
                      <TableHead className="w-24 text-right">Records</TableHead>
                      <TableHead className="w-14 text-center">Email</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visible.length === 0 ? (
                      <TableEmpty colSpan={6}>
                        {total === 0
                          ? '✅ No alerts! Everything is clear.'
                          : 'All alerts have zero records — flip the toggle above to see them.'}
                      </TableEmpty>
                    ) : (
                      visible.map((a) => {
                        const isUrgent =
                          a.count > 0 &&
                          (a.name.toLowerCase().includes('overdue') ||
                            a.name.toLowerCase().includes('pending'));
                        const countTone =
                          a.count === 0
                            ? 'text-emerald-600'
                            : isUrgent
                              ? 'text-rose-600'
                              : 'text-amber-600';
                        const interactive = a.count > 0;
                        const subscribed = subscribedCodes.has(a.code);
                        const subBusy = toggleSub.isPending && toggleSub.variables?.code === a.code;
                        return (
                          <TableRow
                            key={a.code}
                            className={interactive ? 'cursor-pointer' : 'opacity-60'}
                          >
                            <TableCell>
                              <span
                                className={`text-xs font-bold uppercase ${DEPT_TONE[a.dept].text}`}
                              >
                                {DEPT_LABEL[a.dept]}
                              </span>
                            </TableCell>
                            <TableCell>
                              <span className="font-mono text-xs text-muted-foreground">
                                {a.code}
                              </span>
                            </TableCell>
                            <TableCell className="font-medium">{a.name}</TableCell>
                            <TableCell className={`text-right font-mono text-base ${countTone}`}>
                              {a.count}
                            </TableCell>
                            <TableCell className="text-center">
                              <button
                                type="button"
                                disabled={subBusy || subscriptions.isLoading}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleSub.mutate({ code: a.code, subscribed: !subscribed });
                                }}
                                className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                                aria-pressed={subscribed}
                                aria-label={
                                  subscribed
                                    ? `Unsubscribe from ${a.code} email digest`
                                    : `Subscribe to ${a.code} email digest`
                                }
                                title={
                                  subscribed
                                    ? 'Subscribed — click to unsubscribe'
                                    : 'Not subscribed — click to receive the email digest'
                                }
                              >
                                {subBusy ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : subscribed ? (
                                  <BellRing className="h-4 w-4 text-cyan-600" />
                                ) : (
                                  <BellOff className="h-4 w-4" />
                                )}
                              </button>
                            </TableCell>
                            <TableCell>
                              {interactive ? (
                                <Link
                                  to="/alerts/$code"
                                  params={{ code: a.code }}
                                  className="inline-flex items-center text-muted-foreground hover:text-foreground"
                                  aria-label={`Drill into ${a.code}`}
                                >
                                  <ArrowRight className="h-4 w-4" />
                                </Link>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              💡 Click any alert with records to see the underlying rows. Use the{' '}
              <Bell className="inline h-3 w-3 align-text-bottom" /> column to opt into the email
              digest for that alert. Configure on/off in{' '}
              <Link to="/alerts/config" className="underline">
                Alert configuration
              </Link>{' '}
              (admin only).
            </p>
          </>
        )}
      </div>
    </main>
  );
}
