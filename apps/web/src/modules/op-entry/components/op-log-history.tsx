import type { OpLog } from '@innovic/shared';
import { Loader2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Props {
  logs: OpLog[];
  isLoading: boolean;
}

const TYPE_LABEL: Record<OpLog['logType'], string> = {
  start: 'Start',
  complete: 'Complete',
  qc: 'QC',
};

export function OpLogHistory({ logs, isLoading }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Shift</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Qty</TableHead>
          <TableHead className="text-right">Reject</TableHead>
          <TableHead>Operator</TableHead>
          <TableHead>Remarks</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isLoading ? (
          <TableEmpty colSpan={7}>
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading log…
            </span>
          </TableEmpty>
        ) : logs.length === 0 ? (
          <TableEmpty colSpan={7}>No log entries yet.</TableEmpty>
        ) : (
          logs.map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-mono text-xs">{l.logDate}</TableCell>
              <TableCell className="text-xs uppercase text-muted-foreground">{l.shift}</TableCell>
              <TableCell className="text-xs uppercase text-muted-foreground">
                {TYPE_LABEL[l.logType]}
              </TableCell>
              <TableCell className="text-right font-mono text-sm">{l.qty}</TableCell>
              <TableCell className="text-right font-mono text-sm text-destructive">
                {l.rejectQty || ''}
              </TableCell>
              <TableCell className="text-sm">{l.operatorName ?? '—'}</TableCell>
              <TableCell className="text-xs text-muted-foreground">{l.remarks ?? ''}</TableCell>
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}
