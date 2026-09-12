// Open qty of an NC = rejected − cleared − failed (docs/QC-NC-HANDLING-DESIGN.md
// §3). The server sends it ready-made as `openQty`; the fallback covers a row
// read through an API that predates the column (the default '0' would
// otherwise cap every dispose box at 0). For a pending NC the two are the
// same number by definition — nothing has been cleared or failed yet.
import type { NcRegister } from '@innovic/shared';

export function ncOpenQty(nc: NcRegister): number {
  const fromServer = Number(nc.openQty);
  if (Number.isFinite(fromServer) && fromServer > 0) return fromServer;
  const computed = Number(nc.rejectedQty) - Number(nc.clearedQty) - Number(nc.failedQty);
  return Number.isFinite(computed) && computed > 0 ? computed : 0;
}
