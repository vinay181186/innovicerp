// "Material received" badge rendering (legacy renderJWMaster L12648-12650):
//   ✓ Full        — receivedQty >= expectedQty (green)
//   ◑ Partial     — 0 < receivedQty < expectedQty (amber)
//   ✕ Not received — receivedQty == 0 (red)
//
// receivedQty is the customer material QC-ACCEPTED across the JWSO's lines
// (partyReceivedQty from the API — Σ Party GRN accepted, rejects never count).
// expectedQty is what the lines need (ADR-203): Σ order qty of the lines that
// have a Customer RM, 1 RM piece per finished part (rmRequiredQty on the list).

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
        Partly Received ({safeReceived})
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
