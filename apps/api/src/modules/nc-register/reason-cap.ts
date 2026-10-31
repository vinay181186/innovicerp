// An auto-created NC's reason is built from fixed text plus a remark someone
// typed (op remarks ≤ 500, GRN / Party GRN QC Remarks ≤ 2000). The NC edit
// form refuses a reason over 2000 characters (nc-register schemas, `reason`
// max 2000), so an auto reason longer than that could never be saved again.
// This cuts the TYPED part, never the fixed text, so the whole stays ≤ 2000.

export const NC_REASON_MAX = 2000;

/** `head + remark + tail`, with `remark` cut (ending '…') so the result is at
 *  most NC_REASON_MAX characters. */
export function capNcReason(head: string, remark: string, tail = ''): string {
  const room = NC_REASON_MAX - head.length - tail.length;
  if (remark.length <= room) return head + remark + tail;
  if (room <= 1) return (head + tail).slice(0, NC_REASON_MAX);
  return head + remark.slice(0, room - 1) + '…' + tail;
}
