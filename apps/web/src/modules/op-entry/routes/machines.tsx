import type { JcOpEnriched, RunningOp } from '@innovic/shared';
import { Link, createRoute } from '@tanstack/react-router';
import { ArrowLeft, Loader2, Play } from 'lucide-react';
import { useMemo } from 'react';
import { z } from 'zod';
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
import { useMachinesList } from '@/modules/machines/api';
import { authenticatedRoute } from '@/routes/_authenticated';
import {
  useJcOpsEnriched,
  useRealtimeRunningOps,
  useRunningOps,
  useStartOp,
} from '../api';
import { MachineCard } from '../components/machine-card';
import { OpEntryForm } from '../components/op-entry-form';

const searchSchema = z.object({
  m: z.string().uuid().optional(),
});

export const machineOpEntryRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: 'op-entry/machines',
  validateSearch: searchSchema,
  component: MachineOpEntryPage,
});

function MachineOpEntryPage() {
  const search = machineOpEntryRoute.useSearch();
  const navigate = machineOpEntryRoute.useNavigate();

  useRealtimeRunningOps();
  const machines = useMachinesList({ limit: 200, offset: 0 });
  const running = useRunningOps({ status: 'running' });

  const selectedMachineId = search.m ?? null;
  const selectedMachine = useMemo(
    () => machines.data?.machines.find((m) => m.id === selectedMachineId) ?? null,
    [machines.data, selectedMachineId],
  );
  const runningByMachine = useMemo(() => {
    const map = new Map<string, RunningOp>();
    for (const r of running.data ?? []) {
      if (r.machineId && r.status === 'running' && !r.isOsp) map.set(r.machineId, r);
    }
    return map;
  }, [running.data]);
  const selectedRunning = selectedMachineId ? runningByMachine.get(selectedMachineId) ?? null : null;

  // Pending ops for the selected machine when idle. Fetch all jc_ops for the
  // machine, filter client-side to "available" + "waiting" (the legacy
  // pickable subset, line 5625-5627).
  const machineOps = useJcOpsEnriched(
    selectedMachineId && !selectedRunning ? { machineId: selectedMachineId } : { machineId: '' },
    { enabled: Boolean(selectedMachineId && !selectedRunning) },
  );
  const pendingOps = useMemo<JcOpEnriched[]>(
    () =>
      (machineOps.data ?? []).filter(
        (o) => o.available > 0 && (o.computedStatus === 'available' || o.computedStatus === 'waiting'),
      ),
    [machineOps.data],
  );

  // For the running case, fetch the single running op enriched (so the form
  // has fresh availability + status).
  const runningOpEnriched = useJcOpsEnriched(
    selectedRunning ? { jobCardCode: selectedRunning.jobCardCode } : { jobCardCode: '' },
    { enabled: Boolean(selectedRunning) },
  );
  const runningOpRow = useMemo<JcOpEnriched | null>(() => {
    if (!selectedRunning || !runningOpEnriched.data) return null;
    return (
      runningOpEnriched.data.find(
        (o) => o.id === selectedRunning.jcOpId,
      ) ?? null
    );
  }, [selectedRunning, runningOpEnriched.data]);

  function selectMachine(id: string | null) {
    void navigate({
      search: () => (id ? { m: id } : {}),
      replace: true,
    });
  }

  return (
    <main className="container max-w-6xl py-10">
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Machine Op Entry</h1>
            <p className="text-sm text-muted-foreground">
              Pick a machine to log work; running machines show the active session.
            </p>
          </div>
          <Button variant="outline" asChild>
            <Link to="/op-entry">
              <ArrowLeft />
              JC-wise entry
            </Link>
          </Button>
        </div>

        {machines.isLoading ? (
          <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading machines…
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {(machines.data?.machines ?? []).map((m) => (
              <MachineCard
                key={m.id}
                machine={m}
                running={runningByMachine.get(m.id) ?? null}
                isSelected={m.id === selectedMachineId}
                onSelect={() => selectMachine(m.id === selectedMachineId ? null : m.id)}
              />
            ))}
          </div>
        )}

        {selectedMachine ? (
          selectedRunning && runningOpRow ? (
            <section className="space-y-3">
              <h2 className="text-lg font-semibold">
                {selectedMachine.code} — <span className="text-green-600">● Running</span>
              </h2>
              <OpEntryForm op={runningOpRow} activeRunningId={selectedRunning.id} />
            </section>
          ) : selectedRunning ? (
            <p className="text-sm text-muted-foreground">Loading running op…</p>
          ) : (
            <PendingOpsSection
              machineCode={selectedMachine.code}
              ops={pendingOps}
              isLoading={machineOps.isLoading}
            />
          )
        ) : (
          <p className="rounded-md border border-dashed bg-muted/40 p-6 text-center text-sm text-muted-foreground">
            Select a machine above to view its session or pending jobs.
          </p>
        )}
      </div>
    </main>
  );
}

interface PendingOpsSectionProps {
  machineCode: string;
  ops: JcOpEnriched[];
  isLoading: boolean;
}

function PendingOpsSection({ machineCode, ops, isLoading }: PendingOpsSectionProps) {
  const start = useStartOp();
  function handleStart(opId: string) {
    void start.mutateAsync({
      jcOpId: opId,
      startDate: new Date().toISOString().slice(0, 10),
      startTime: new Date().toTimeString().slice(0, 5),
      shift: 'day',
    });
  }
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">
        {machineCode} — <span className="text-muted-foreground">○ Idle</span>
      </h2>
      <div className="rounded-md border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>JC</TableHead>
              <TableHead>Op</TableHead>
              <TableHead>Operation</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableEmpty colSpan={5}>
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading pending jobs…
                </span>
              </TableEmpty>
            ) : ops.length === 0 ? (
              <TableEmpty colSpan={5}>No pending jobs assigned to this machine.</TableEmpty>
            ) : (
              ops.map((op) => (
                <TableRow key={op.id}>
                  <TableCell className="font-mono text-sm font-medium text-primary">
                    {op.jobCardCode}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{op.opSeq}</TableCell>
                  <TableCell>{op.operation}</TableCell>
                  <TableCell className="text-right font-mono text-sm font-semibold">
                    {op.available}
                  </TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      onClick={() => handleStart(op.id)}
                      disabled={start.isPending}
                    >
                      <Play />
                      Start
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
