// Print + Export ▾ (CSV / Excel) for a Day Log or the Team Day Logs table.
// The caller hands over the table model (lib/export.ts) and a print function,
// so both buttons show exactly what is on screen.

import { useState } from 'react';
import { useMyCompany } from '@/modules/settings/api';
import type { Company } from '@innovic/shared';
import { ActionMenu } from '@/ui/layout';
import { exportCsv, exportXlsx, type ExportTable } from '../lib/export';
import { errText } from '../lib/format';

export function PrintExportTools({
  table,
  fileName,
  sheetName,
  onPrint,
}: {
  table: ExportTable | null;
  fileName: string;
  sheetName: string;
  onPrint: (company: Company | undefined) => boolean;
}): React.JSX.Element {
  const { data: company } = useMyCompany();
  const [err, setErr] = useState<string | null>(null);
  const off = !table || table.rows.length === 0;
  return (
    <>
      {err ? <span style={{ color: 'var(--red2)', fontSize: 'var(--fs-xs)' }}>{err}</span> : null}
      <button
        type="button"
        className="btn btn-ghost"
        disabled={off}
        onClick={() => {
          setErr(onPrint(company) ? null : 'The print window was blocked. Allow pop-ups.');
        }}
      >
        🖨 Print
      </button>
      <ActionMenu
        label="Export"
        items={[
          {
            label: 'CSV',
            disabled: off,
            onClick: () => {
              if (table) exportCsv(table, fileName);
            },
          },
          {
            label: 'Excel',
            disabled: off,
            onClick: () => {
              if (!table) return;
              exportXlsx(table, fileName, sheetName).then(
                () => setErr(null),
                (e: unknown) => setErr(errText(e, 'Could not build the Excel file.')),
              );
            },
          },
        ]}
      />
    </>
  );
}
