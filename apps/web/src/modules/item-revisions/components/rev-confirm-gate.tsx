// ADR-290 / ADR-323 — "Latest verified drawing is ABC/2. This line specifies
// ABC/1. Confirm with the customer." The SO / JWSO form may not save until
// every such line carries the "Confirmed" tick. A client confirm only — the
// server does not store it.
//
// The form owns the ticks here, and a headless <RevConfirmProbe> in each
// line's main row reads the same look-up (same query key — no second request)
// to know which lines need one, mounted or not.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useItemRevisionLookup } from '../api';

export interface RevConfirmGate {
  /** Probe → gate: this line's latest verified label (null = no question). */
  report: (lineKey: string, latestLabel: string | null) => void;
  /** The `confirm` prop for DrawingRevInfo on this line. */
  confirmFor: (lineKey: string) => { checked: boolean; onChange: (checked: boolean) => void };
  /** First line (in form order) still waiting for its tick, with the latest
   *  verified label to name in the message; null when all are confirmed. */
  firstPending: (lineKeys: readonly string[]) => { index: number; latestLabel: string } | null;
}

export function useRevConfirmGate(): RevConfirmGate {
  // Latest verified label per line, as the probes last saw it.
  const latest = useRef(new Map<string, string>());
  // The label each line's tick was given for — a different latest asks again.
  const [ticked, setTicked] = useState<Readonly<Record<string, string>>>({});
  const tickedRef = useRef(ticked);
  tickedRef.current = ticked;

  const report = useCallback((lineKey: string, latestLabel: string | null) => {
    if (latestLabel) latest.current.set(lineKey, latestLabel);
    else latest.current.delete(lineKey);
  }, []);

  const confirmFor = useCallback(
    (lineKey: string) => {
      const label = latest.current.get(lineKey) ?? '';
      return {
        checked: Boolean(label) && ticked[lineKey] === label,
        onChange: (checked: boolean) =>
          setTicked((prev) => {
            const next = { ...prev };
            const now = latest.current.get(lineKey);
            if (checked && now) next[lineKey] = now;
            else delete next[lineKey];
            return next;
          }),
      };
    },
    [ticked],
  );

  const firstPending = useCallback((lineKeys: readonly string[]) => {
    for (let i = 0; i < lineKeys.length; i += 1) {
      const key = lineKeys[i] as string;
      const label = latest.current.get(key);
      if (label && tickedRef.current[key] !== label) return { index: i, latestLabel: label };
    }
    return null;
  }, []);

  return useMemo(() => ({ report, confirmFor, firstPending }), [report, confirmFor, firstPending]);
}

/** Renders nothing: tells the gate whether this line needs the tick. Mount it
 *  in the line's always-visible row. */
export function RevConfirmProbe({
  gate,
  lineKey,
  itemId,
  rev,
}: {
  gate: RevConfirmGate;
  lineKey: string;
  itemId: string | null | undefined;
  rev: string | null | undefined;
}): null {
  const lookup = useItemRevisionLookup(itemId, rev);
  const label = itemId ? (lookup.data?.release?.latestReleasedLabel ?? null) : null;
  const { report } = gate;
  useEffect(() => {
    report(lineKey, label);
  }, [report, lineKey, label]);
  useEffect(() => () => report(lineKey, null), [report, lineKey]);
  return null;
}
