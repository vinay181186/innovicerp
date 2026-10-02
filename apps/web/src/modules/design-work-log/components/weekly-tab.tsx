// Design Work Log — Weekly View tab (ADR-203 frozen header). Chrome: the week
// navigator. The engineers × days grid (with its TOTAL row) is unchanged, now
// in a filling panel so it is the page's one scrolling table and its column
// header stays frozen.

import { useMemo, useState } from 'react';
import { fmtDate } from '@/lib/date';
import { Panel } from '@/ui/data';
import { useDesignWorkLogList } from '../api';
import { addDays, dayName, localYmd, todayStr } from './work-log-shared';

// The TOTAL row sticks to the bottom of the scroller (as on Backup), opaque so
// rows scrolling under it do not show through, above the body's pinned first
// column (z 4). Its first cell is pinned left too and sits one higher.
const TOTAL_CELL: React.CSSProperties = {
  position: 'sticky',
  bottom: 0,
  background: 'var(--bg4)',
  zIndex: 5,
};
const TOTAL_LABEL_CELL: React.CSSProperties = { ...TOTAL_CELL, left: 0, zIndex: 6 };

export function WeeklyTab(): React.JSX.Element {
  const [refDate, setRefDate] = useState(todayStr());
  const weekDates = useMemo(() => {
    const d = new Date(refDate + 'T00:00:00');
    const day = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
    const out: string[] = [];
    for (let i = 0; i < 7; i++) {
      const dd = new Date(mon);
      dd.setDate(mon.getDate() + i);
      out.push(localYmd(dd));
    }
    return out;
  }, [refDate]);

  const { data } = useDesignWorkLogList({
    fromDate: weekDates[0],
    toDate: weekDates[6],
    limit: 2000,
    offset: 0,
  });
  const logs = useMemo(() => data?.items ?? [], [data?.items]);

  const engineers = useMemo(() => {
    const s = new Set<string>();
    logs.forEach((l) => s.add(l.engineerText));
    return Array.from(s).sort();
  }, [logs]);

  function getHrs(eng: string, date: string): number {
    return logs
      .filter((l) => l.engineerText === eng && l.logDate === date)
      .reduce((s, l) => s + l.hours, 0);
  }

  let gt = 0;
  return (
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          marginBottom: 'var(--panel-gap)',
        }}
      >
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRefDate(addDays(refDate, -7))}
        >
          ←
        </button>
        <div style={{ fontSize: 14, fontWeight: 700, minWidth: 200, textAlign: 'center' }}>
          {fmtDate(weekDates[0])} — {fmtDate(weekDates[6])}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setRefDate(addDays(refDate, 7))}
        >
          →
        </button>
      </div>

      <Panel fill bodyPadding="none">
        <div className="tbl-wrap">
          <table className="innovic-table tbl-grid">
            <thead>
              <tr>
                <th>Design Engineer</th>
                {weekDates.map((dt) => (
                  <th key={dt} style={{ fontSize: 11 }}>
                    {dayName(dt)}
                    <br />
                    {fmtDate(dt)}
                  </th>
                ))}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {engineers.map((eng) => {
                let wt = 0;
                return (
                  <tr key={eng}>
                    <td className="fw-700" style={{ fontSize: 12 }}>
                      {eng}
                    </td>
                    {weekDates.map((dt) => {
                      const hrs = getHrs(eng, dt);
                      wt += hrs;
                      return (
                        <td
                          key={dt}
                          className="mono"
                          style={{
                            fontWeight: 700,
                            color: hrs >= 7 ? 'var(--green)' : hrs > 0 ? undefined : 'var(--text3)',
                          }}
                        >
                          {hrs > 0 ? hrs.toFixed(1) : '0'}
                        </td>
                      );
                    })}
                    <td
                      className="mono fw-700"
                      style={{
                        color: wt >= 30 ? 'var(--green)' : wt >= 20 ? 'var(--amber)' : 'var(--red)',
                      }}
                    >
                      {(() => {
                        gt += wt;
                        return `${wt.toFixed(1)}h`;
                      })()}
                    </td>
                  </tr>
                );
              })}
              <tr style={{ background: 'var(--bg4)' }}>
                <td className="fw-700" style={{ ...TOTAL_LABEL_CELL, color: 'var(--blue)' }}>
                  TOTAL
                </td>
                {weekDates.map((dt) => {
                  const ct = engineers.reduce((s, eng) => s + getHrs(eng, dt), 0);
                  return (
                    <td key={dt} className="mono fw-700" style={TOTAL_CELL}>
                      {ct.toFixed(1)}
                    </td>
                  );
                })}
                <td className="mono fw-700" style={{ ...TOTAL_CELL, color: 'var(--blue)' }}>
                  {gt.toFixed(1)}h
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
