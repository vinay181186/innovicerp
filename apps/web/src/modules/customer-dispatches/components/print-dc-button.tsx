// Per-card 🖨 Print DC on the Customer Dispatch list — a thin button over
// usePrintDc (which the ⋯ menu's Print item shares).

import { Loader2, Printer } from 'lucide-react';
import { usePrintDc } from './use-print-dc';

export function PrintDcButton({ dispatchId }: { dispatchId: string }): React.JSX.Element {
  const { start, loading } = usePrintDc(dispatchId);

  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={(e) => {
        e.stopPropagation();
        void start();
      }}
      disabled={loading}
      title="Print the Delivery Challan for this dispatch"
      style={{ whiteSpace: 'nowrap' }}
    >
      {loading ? <Loader2 size={13} className="inline animate-spin" /> : <Printer size={13} />}{' '}
      Print DC
    </button>
  );
}
