// My Day Log: each part of the sheet that can hold typed, unsaved work (the new
// rows, an open edit form) reports it here, so the tab's "Leave this day?" guard
// sees all of them. A part that goes away stops counting by itself.

import { createContext, useContext, useEffect } from 'react';

export const DayDirtyReport = createContext<(part: string, dirty: boolean) => void>(
  () => undefined,
);

export function useReportDayDirty(part: string, dirty: boolean): void {
  const report = useContext(DayDirtyReport);
  useEffect(() => {
    report(part, dirty);
    return () => report(part, false);
  }, [report, part, dirty]);
}
