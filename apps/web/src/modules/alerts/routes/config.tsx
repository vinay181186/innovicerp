// Alert configuration (T-041d Phase A). Admin/manager-only — toggles
// per-rule on/off, persisted as alert_config rows. Mirrors legacy
// `renderAlertConfig` (legacy HTML L22427) which gated on `isAdmin()`;
// our service layer additionally allows `manager` role to match the
// `manager_write` RLS policy.

import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Settings } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSession } from '@/lib/session';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useAlertConfig, useToggleAlert } from '../api';
import { DEPT_LABEL, DEPT_TONE } from '../lib/dept';

export const alertsConfigRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'alerts/config',
  component: AlertsConfigPage,
});

function AlertsConfigPage() {
  const { data: session } = useSession();
  const canEdit = session?.role === 'admin' || session?.role === 'manager';

  return (
    <main className="container max-w-5xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/alerts">
            <ArrowLeft />
            Back to alerts
          </Link>
        </Button>

        <div className="flex items-start gap-3">
          <Settings className="mt-1 h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Alert configuration</h1>
            <p className="text-sm text-muted-foreground">
              Toggle per-rule on/off for this company. Operators see the dashboard but can't change
              toggles.
            </p>
          </div>
        </div>

        {!canEdit ? (
          <Card>
            <CardHeader>
              <CardTitle>Admin access required</CardTitle>
              <CardDescription>
                Your role ({session?.role ?? 'unknown'}) cannot change alert configuration. The
                dashboard remains visible — only admin/manager can flip toggles.
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          <ConfigTable />
        )}
      </div>
    </main>
  );
}

function ConfigTable() {
  const { data, isLoading, isError, error } = useAlertConfig();
  const toggle = useToggleAlert();
  const [pending, setPending] = useState<string | null>(null);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        </CardContent>
      </Card>
    );
  }
  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Failed to load configuration</CardTitle>
          <CardDescription>
            {error instanceof Error ? error.message : 'Unknown error'}
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const onToggle = (code: string, next: boolean) => {
    setPending(code);
    toggle.mutate(
      { code, active: next },
      {
        onSettled: () => setPending(null),
      },
    );
  };

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Active</TableHead>
              <TableHead className="w-24">Code</TableHead>
              <TableHead className="w-32">Dept</TableHead>
              <TableHead>Alert</TableHead>
              <TableHead className="w-28">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.map((e) => (
              <TableRow key={e.code} className={e.active ? '' : 'opacity-60'}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={e.active}
                    disabled={pending === e.code}
                    onChange={(ev) => onToggle(e.code, ev.target.checked)}
                    className="h-4 w-4 cursor-pointer accent-emerald-600 disabled:cursor-wait"
                  />
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{e.code}</span>
                </TableCell>
                <TableCell>
                  <span className={`text-xs font-bold uppercase ${DEPT_TONE[e.dept].text}`}>
                    {DEPT_LABEL[e.dept]}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="font-medium">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.description}</div>
                </TableCell>
                <TableCell>
                  {e.isOverridden ? (
                    <span className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                      override
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                      default
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
