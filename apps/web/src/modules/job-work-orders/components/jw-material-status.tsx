// Legacy renderJWMaster (line 12648-12650) "Material" column rendering:
//   ✓ Full       — material_received_qty >= order_qty (green)
//   ◑ Partial    — 0 < material_received_qty < order_qty (amber)
//   ✕ Not Received — material_received_qty == 0 or null (red)
//
// Inputs are numeric strings from the API (clientMaterialQtyTotal /
// materialReceivedQtyTotal on the list shape; clientMaterialQty /
// materialReceivedQty on the line shape). Per-JW rendering on the list
// page sums across lines; per-line rendering on the detail page uses the
// line's own qty + orderQty.

interface Props {
  receivedQty: number;
  expectedQty: number;
}

export function JwMaterialStatusBadge({ receivedQty, expectedQty }: Props) {
  const safeExpected = Math.max(0, expectedQty);
  const safeReceived = Math.max(0, receivedQty);

  if (safeExpected > 0 && safeReceived >= safeExpected) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/40 dark:text-green-300">
        <span aria-hidden>✓</span>
        Full
      </span>
    );
  }
  if (safeReceived > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
        <span aria-hidden>◑</span>
        Partial ({safeReceived})
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
      <span aria-hidden>✕</span>
      Not received
    </span>
  );
}
