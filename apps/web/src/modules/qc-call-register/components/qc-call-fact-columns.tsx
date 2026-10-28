// QC Call Register — the facts every kind of call carries (QcRegisterFacts):
// Client PO No., and the step the call inspects (Planned Machine / Actual
// Machine). Shared by the Pending and Completed tables and the Inspect popup's
// facts strip, so the three read the step the same way. Labels per NAMING.md.

import { type QcRegisterFacts, type QcSourceStep, opSrNo } from '@innovic/shared';
import type { DataTableColumn } from '@/ui/data';

/** "Op 20 Turning" — the same label the Operation column and the popup heading use. */
export function stepOpLabel(step: QcSourceStep): string {
  return `Op ${opSrNo(step.opSeq)}${step.operation ? ` ${step.operation}` : ''}`;
}

/** "CNC-1 12 pcs · CNC-3 8 pcs" — every machine that logged output, with its pieces. */
export function actualMachinesWithQty(step: QcSourceStep): string {
  return step.actualMachines.map((m) => `${m.code} ${m.qty} pcs`).join(' · ');
}

/** Planned Machine as text: 'Outsourced', the machine code, else '' (no step / none set). */
export function plannedMachineText(step: QcSourceStep | null | undefined): string {
  if (!step) return '';
  return step.outsourced ? 'Outsourced' : (step.plannedMachine ?? '');
}

/** Actual Machine as text: 'Outsourced', "CNC-1 12 pcs · CNC-3 8 pcs", else ''. */
export function actualMachineText(step: QcSourceStep | null | undefined): string {
  if (!step) return '';
  return step.outsourced ? 'Outsourced' : actualMachinesWithQty(step);
}

/** The same three facts as Excel cells (the register Export). Incoming QC has
 *  no machine columns on screen, so none in its export either. */
export function factExportCells(
  vm: QcRegisterFacts,
  withMachines: boolean,
): Record<string, string> {
  const po = { 'Client PO No.': vm.clientPoNo?.trim() ?? '' };
  if (!withMachines) return po;
  return {
    'Planned Machine': plannedMachineText(vm.sourceStep),
    'Actual Machine': actualMachineText(vm.sourceStep),
    ...po,
  };
}

function faintDash(): React.JSX.Element {
  return <span className="text3">—</span>;
}

/** Planned Machine, Actual Machine, Client PO No. — in that order. */
export function factColumns<T extends QcRegisterFacts>(): DataTableColumn<T>[] {
  return [
    {
      id: 'planned_machine',
      kind: 'code',
      header: 'Planned Machine',
      sortFilterField: 'plannedMachine',
      nowrap: true,
      render: (vm) => {
        const s = vm.sourceStep;
        if (!s) return faintDash();
        if (s.outsourced) return <span className="text2">Outsourced</span>;
        return (
          <div style={{ lineHeight: 1.25 }}>
            <div className="mono fw-700" style={{ color: 'var(--text)' }}>
              {s.plannedMachine ?? '—'}
            </div>
            <div className="text3" style={{ fontSize: 11 }}>
              {stepOpLabel(s)}
            </div>
          </div>
        );
      },
      title: (vm) =>
        vm.sourceStep
          ? `${plannedMachineText(vm.sourceStep) || '—'} · ${stepOpLabel(vm.sourceStep)}`
          : '',
    },
    {
      id: 'actual_machine',
      kind: 'code',
      header: 'Actual Machine',
      sortFilterField: 'actualMachine',
      nowrap: true,
      render: (vm) => {
        const s = vm.sourceStep;
        if (!s) return faintDash();
        if (s.outsourced) return <span className="text2">Outsourced</span>;
        if (s.actualMachines.length === 0) return faintDash();
        return (
          <span className="mono fw-700" style={{ color: 'var(--text)' }}>
            {s.actualMachines.map((m) => m.code).join(' · ')}
          </span>
        );
      },
      title: (vm) => actualMachineText(vm.sourceStep),
    },
    {
      id: 'client_po_no',
      kind: 'code',
      header: 'Client PO No.',
      sortFilterField: 'clientPoNo',
      className: 'mono',
      nowrap: true,
      render: (vm) => vm.clientPoNo?.trim() || faintDash(),
      title: (vm) => vm.clientPoNo ?? '',
    },
  ];
}
