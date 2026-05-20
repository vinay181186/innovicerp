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
      <span className="badge b-green">
        <span aria-hidden style={{ marginRight: 4 }}>
          ✓
        </span>
        Full
      </span>
    );
  }
  if (safeReceived > 0) {
    return (
      <span className="badge b-amber">
        <span aria-hidden style={{ marginRight: 4 }}>
          ◑
        </span>
        Partial ({safeReceived})
      </span>
    );
  }
  return (
    <span className="badge b-red">
      <span aria-hidden style={{ marginRight: 4 }}>
        ✕
      </span>
      Not received
    </span>
  );
}
