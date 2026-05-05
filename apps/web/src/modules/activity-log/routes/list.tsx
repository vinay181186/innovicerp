import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, History, Loader2 } from 'lucide-react';
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
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { authenticatedRoute } from '@/routes/_authenticated';
import { useActivityLog } from '../api';

const PAGE_SIZE = 50;

const searchSchema = z.object({
  search: z.string().optional(),
  action: z.string().optional(),
  userId: z.string().optional(),
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
});

export const activityLogListRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'activity-log',
  validateSearch: searchSchema,
  component: ActivityLogListPage,
});

const ACTION_COLORS: Record<string, string> = {
  CREATE: 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
  EDIT: 'text-blue-600 dark:text-blue-400 bg-blue-500/10',
  DELETE: 'text-rose-600 dark:text-rose-400 bg-rose-500/10',
  RESTORE: 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  IMPORT: 'text-violet-600 dark:text-violet-400 bg-violet-500/10',
  'OP START': 'text-amber-600 dark:text-amber-400 bg-amber-500/10',
  'OP COMPLETE': 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10',
  DISPATCH: 'text-cyan-600 dark:text-cyan-400 bg-cyan-500/10',
  'PERM DELETE': 'text-rose-700 dark:text-rose-500 bg-rose-500/20',
};

function ActivityLogListPage() {
  const search = activityLogListRoute.useSearch();
  const navigate = activityLogListRoute.useNavigate();

  const [pendingSearch, setPendingSearch] = useState(search.search ?? '');

  const offset = (search.page - 1) * PAGE_SIZE;
  const query = useMemo(
    () => ({
      ...(search.search ? { search: search.search } : {}),
      ...(search.action ? { action: search.action } : {}),
      ...(search.userId ? { userId: search.userId } : {}),
      ...(search.fromDate ? { fromDate: search.fromDate } : {}),
      ...(search.toDate ? { toDate: search.toDate } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    [search, offset],
  );
  const { data, isLoading, isError, error, isFetching } = useActivityLog(query);

  const onSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void navigate({
      search: () => ({
        ...(pendingSearch ? { search: pendingSearch } : {}),
        ...(search.action ? { action: search.action } : {}),
        ...(search.userId ? { userId: search.userId } : {}),
        ...(search.fromDate ? { fromDate: search.fromDate } : {}),
        ...(search.toDate ? { toDate: search.toDate } : {}),
        page: 1,
      }),
      replace: true,
    });
  };

  const setFilter = (key: 'action' | 'userId' | 'fromDate' | 'toDate', value: string) => {
    void navigate({
      search: (prev) => {
        const next = { ...prev, page: 1 };
        if (value) {
          (next as Record<string, unknown>)[key] = value;
        } else {
          delete (next as Record<string, unknown>)[key];
        }
        return next;
      },
      replace: true,
    });
  };

  const onClear = () => {
    setPendingSearch('');
    void navigate({ search: () => ({ page: 1 }), replace: true });
  };

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const goToPage = (n: number) => {
    void navigate({ search: (prev) => ({ ...prev, page: n }), replace: true });
  };

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link to="/">
            <ArrowLeft />
            Back to home
          </Link>
        </Button>

        <div className="flex items-start gap-3">
          <History className="mt-1 h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Activity log</h1>
            <p className="text-sm text-muted-foreground">
              Append-only audit trail. Filter by action, user, or date range; full-text search
              across action / entity / detail / user / ref.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Filters</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSearchSubmit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3 lg:grid-cols-5">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="search">Search</Label>
                  <Input
                    id="search"
                    type="search"
                    value={pendingSearch}
                    onChange={(e) => setPendingSearch(e.target.value)}
                    placeholder="action / entity / detail / user / ref"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="action">Action</Label>
                  <Select
                    id="action"
                    value={search.action ?? ''}
                    onChange={(e) => setFilter('action', e.target.value)}
                  >
                    <option value="">All actions</option>
                    {(data?.actions ?? []).map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="userId">User</Label>
                  <Select
                    id="userId"
                    value={search.userId ?? ''}
                    onChange={(e) => setFilter('userId', e.target.value)}
                  >
                    <option value="">All users</option>
                    {(data?.users ?? [])
                      .filter((u) => u.id !== null)
                      .map((u) => (
                        <option key={u.id ?? u.name} value={u.id ?? ''}>
                          {u.name}
                        </option>
                      ))}
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="fromDate">From</Label>
                  <Input
                    id="fromDate"
                    type="date"
                    value={search.fromDate ?? ''}
                    onChange={(e) => setFilter('fromDate', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="toDate">To</Label>
                  <Input
                    id="toDate"
                    type="date"
                    value={search.toDate ?? ''}
                    onChange={(e) => setFilter('toDate', e.target.value)}
                  />
                </div>
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

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entries</CardTitle>
            <CardDescription>
              {data ? `${data.total} matching · page ${search.page} of ${totalPages}` : 'Loading…'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Detail</TableHead>
                    <TableHead>Ref</TableHead>
                    <TableHead>User</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    <TableEmpty colSpan={7}>
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading…
                      </span>
                    </TableEmpty>
                  ) : isError ? (
                    <TableEmpty colSpan={7}>
                      <span className="text-destructive">
                        {error instanceof Error ? error.message : 'Failed to load activity log'}
                      </span>
                    </TableEmpty>
                  ) : !data || data.entries.length === 0 ? (
                    <TableEmpty colSpan={7}>No activity matches these filters.</TableEmpty>
                  ) : (
                    data.entries.map((e) => {
                      const dt = new Date(e.ts);
                      const date = dt.toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      });
                      const time = dt.toLocaleTimeString('en-IN', {
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false,
                      });
                      const colorClass =
                        ACTION_COLORS[e.action] ?? 'text-muted-foreground bg-muted';
                      return (
                        <TableRow key={e.id}>
                          <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                            {date}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {time}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-block rounded px-2 py-0.5 text-[11px] font-bold ${colorClass}`}
                            >
                              {e.action}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm font-medium">{e.entity}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {e.detail || '—'}
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            {e.refId ?? '—'}
                          </TableCell>
                          <TableCell className="text-xs">
                            <span className="text-amber-600 dark:text-amber-400">{e.userName}</span>
                            {e.userId === null ? (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                (snapshot)
                              </span>
                            ) : null}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {data && data.total > PAGE_SIZE ? (
          <div className="flex items-center justify-between text-sm">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goToPage(search.page - 1)}
              disabled={search.page <= 1}
            >
              Previous
            </Button>
            <span className="text-muted-foreground">
              Page {search.page} of {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => goToPage(search.page + 1)}
              disabled={search.page >= totalPages}
            >
              Next
            </Button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
