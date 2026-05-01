import type { RunningOp } from '@innovic/shared';
import { Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useStopOp } from '../api';
import { RunningOpStatusBadge } from './status-badge';

interface Props {
  rows: RunningOp[];
}

export function RunningOpsBoard({ rows }: Props) {
  const stop = useStopOp();
  const running = rows.filter((r) => r.status === 'running');
  const recent = rows.filter((r) => r.status !== 'running').slice(0, 20);

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Running now ({running.length})
        </h2>
        <div className="rounded-md border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>JC</TableHead>
                <TableHead>Op</TableHead>
                <TableHead>Operation</TableHead>
                <TableHead>Machine</TableHead>
                <TableHead>Operator</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {running.length === 0 ? (
                <TableEmpty colSpan={8}>No ops currently running.</TableEmpty>
              ) : (
                running.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm font-medium text-primary">
                      {r.jobCardCode}
                    </TableCell>
                    <TableCell className="font-mono text-sm">{r.opSeq}</TableCell>
                    <TableCell>{r.operation}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.machineCode ?? (r.isOsp ? 'OSP' : '—')}
                    </TableCell>
                    <TableCell className="text-sm">{r.operatorName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {r.startDate} {r.startTime.slice(0, 5)}
                    </TableCell>
                    <TableCell>
                      <RunningOpStatusBadge status={r.status} />
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={stop.isPending}
                        onClick={() => void stop.mutateAsync(r.id)}
                      >
                        <Square />
                        Stop
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {recent.length > 0 ? (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Recent (last {recent.length})
          </h2>
          <div className="rounded-md border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>JC</TableHead>
                  <TableHead>Op</TableHead>
                  <TableHead>Operation</TableHead>
                  <TableHead>Machine</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Ended</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recent.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-sm">{r.jobCardCode}</TableCell>
                    <TableCell className="font-mono text-sm">{r.opSeq}</TableCell>
                    <TableCell>{r.operation}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.machineCode ?? (r.isOsp ? 'OSP' : '—')}
                    </TableCell>
                    <TableCell className="text-sm">{r.operatorName ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {r.endedAt ? r.endedAt.slice(0, 16).replace('T', ' ') : '—'}
                    </TableCell>
                    <TableCell>
                      <RunningOpStatusBadge status={r.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
