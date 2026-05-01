import type { JcOpEnriched } from '@innovic/shared';
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { JcOpStatusBadge } from './status-badge';

interface Props {
  ops: JcOpEnriched[];
  selectedOpId: string | null;
  onSelect: (opId: string) => void;
}

export function JcOpsTable({ ops, selectedOpId, onSelect }: Props) {
  if (ops.length === 0) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Op</TableHead>
            <TableHead>Operation</TableHead>
            <TableHead>Machine</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Done</TableHead>
            <TableHead className="text-right">Available</TableHead>
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableEmpty colSpan={7}>No ops on this job card.</TableEmpty>
        </TableBody>
      </Table>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Op</TableHead>
          <TableHead>Operation</TableHead>
          <TableHead>Machine</TableHead>
          <TableHead>Type</TableHead>
          <TableHead className="text-right">Done</TableHead>
          <TableHead className="text-right">Available</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {ops.map((op) => {
          const machineLabel = op.machineCode ?? op.machineCodeText ?? '—';
          const isSelected = op.id === selectedOpId;
          return (
            <TableRow
              key={op.id}
              data-selected={isSelected ? 'true' : undefined}
              className={`cursor-pointer hover:bg-accent ${isSelected ? 'bg-accent' : ''}`}
              onClick={() => onSelect(op.id)}
            >
              <TableCell className="font-mono text-sm font-medium">{op.opSeq}</TableCell>
              <TableCell>{op.operation}</TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {machineLabel}
              </TableCell>
              <TableCell className="text-xs uppercase text-muted-foreground">{op.opType}</TableCell>
              <TableCell className="text-right font-mono text-sm">{op.completedQty}</TableCell>
              <TableCell className="text-right font-mono text-sm font-semibold">
                {op.available}
              </TableCell>
              <TableCell>
                <JcOpStatusBadge status={op.computedStatus} />
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
