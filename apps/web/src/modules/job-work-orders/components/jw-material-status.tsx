// "Material received" badge rendering (legacy renderJWMaster L12648-12650):
//   ✓ Full        — receivedQty >= expectedQty (green)
//   ◑ Partial     — 0 < receivedQty < expectedQty (amber)
//   ✕ Not received — receivedQty == 0 (red)
//
// receivedQty is the ACTUAL client-material received = Σ Party GRN receipts
// (partyReceivedQty from the API), NOT the manually-typed header
// materialReceivedQty (which can be typed without any GRNs posted).
// expectedQty is the header clientMaterialQty (order/expected intent).

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
