// Customize Dashboard — mirror of legacy _dashConfigScreen (L3390). Reorder +
// toggle widgets, toggle quick links, save the per-user layout.

import { Loader2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useDashboardConfigScreen, useSaveDashboardConfig } from '../api';

export function HomeCustomize({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { data, isLoading } = useDashboardConfigScreen();
  const save = useSaveDashboardConfig();

  if (isLoading || !data) {
    return <div className="empty-state" style={{ padding: 40 }}><Loader2 className="inline h-4 w-4 animate-spin" /> Loading…</div>;
  }
  return <CustomizeInner data={data} onClose={onClose} save={save} />;
}

function CustomizeInner({
  data,
  onClose,
  save,
}: {
  data: NonNullable<ReturnType<typeof useDashboardConfigScreen>['data']>;
  onClose: () => void;
  save: ReturnType<typeof useSaveDashboardConfig>;
}): React.JSX.Element {
  const allKeys = useMemo(() => data.widgets.map((w) => w.key), [data.widgets]);
  const selectedInit = data.config.widgets ?? allKeys;
  const qlInit = data.config.quickLinks ?? data.quickLinks.filter((l) => l.hasAccess).map((l) => l.page);

  // Order: selected first (in saved order), then the rest in registry order.
  const initialOrder = useMemo(() => {
    const ord: string[] = [];
    for (const k of selectedInit) if (allKeys.includes(k)) ord.push(k);
    for (const k of allKeys) if (!ord.includes(k)) ord.push(k);
    return ord;
  }, [allKeys, selectedInit]);

  const [order, setOrder] = useState<string[]>(initialOrder);
  const [checked, setChecked] = useState<Set<string>>(new Set(selectedInit));
  const [ql, setQl] = useState<Set<string>>(new Set(qlInit));

  const byKey = useMemo(() => new Map(data.widgets.map((w) => [w.key, w])), [data.widgets]);

  const move = (idx: number, dir: -1 | 1): void => {
    const j = idx + dir;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[idx], next[j]] = [next[j]!, next[idx]!];
    setOrder(next);
  };
  const toggle = (k: string): void => setChecked((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleQl = (p: string): void => setQl((s) => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const setAllWidgets = (on: boolean): void => setChecked(on ? new Set(data.widgets.filter((w) => w.hasAccess).map((w) => w.key)) : new Set());
  const setAllQl = (on: boolean): void => setQl(on ? new Set(data.quickLinks.filter((l) => l.hasAccess).map((l) => l.page)) : new Set());

  async function doSave(): Promise<void> {
    const widgets = order.filter((k) => checked.has(k));
    const quickLinks = data.quickLinks.filter((l) => ql.has(l.page)).map((l) => l.page);
    await save.mutateAsync({ widgets, quickLinks });
    onClose();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <div className="section-hdr" style={{ marginBottom: 0 }}>⚙ Customize Dashboard</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => setAllWidgets(true)}>☑ Select All</button>
          <button type="button" className="btn btn-ghost" onClick={() => setAllWidgets(false)}>☐ Deselect All</button>
          <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => void doSave()}>{save.isPending ? 'Saving…' : '✔ Save Layout'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--cyan)', marginBottom: 8 }}>📋 WIDGETS (check to show, arrows to reorder)</div>
      <div style={{ marginBottom: 20 }}>
        {order.map((key, idx) => {
          const w = byKey.get(key);
          if (!w) return null;
          const isChecked = checked.has(key);
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: isChecked ? 'var(--bg3)' : 'var(--bg4)', border: `1px solid ${isChecked ? w.color : 'var(--border)'}`, borderRadius: 8, marginBottom: 4, opacity: w.hasAccess ? 1 : 0.4 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: 10, lineHeight: 1 }} disabled={idx === 0} onClick={() => move(idx, -1)} title="Move up">▲</button>
                <button type="button" className="btn btn-ghost btn-sm" style={{ padding: '0 4px', fontSize: 10, lineHeight: 1 }} disabled={idx === order.length - 1} onClick={() => move(idx, 1)} title="Move down">▼</button>
              </div>
              <input type="checkbox" checked={isChecked} disabled={!w.hasAccess} onChange={() => toggle(key)} style={{ width: 16, height: 16, accentColor: w.color }} />
              <span style={{ fontSize: 13 }}>{w.icon}</span>
              <div style={{ flex: 1 }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{w.label}</span>{' '}
                <span style={{ fontSize: 10, color: w.color }}>{w.dept ?? 'general'}</span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--text3)' }}>{w.desc}</span>
            </div>
          );
        })}
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', marginBottom: 8 }}>🚀 QUICK ACCESS LINKS</div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setAllQl(true)}>☑ All</button>
        <button type="button" className="btn btn-ghost btn-sm" style={{ fontSize: 10 }} onClick={() => setAllQl(false)}>☐ None</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 6 }}>
        {data.quickLinks.map((l) => {
          const isChecked = ql.has(l.page);
          return (
            <label key={l.page} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: isChecked ? 'var(--bg3)' : 'var(--bg4)', border: `1px solid ${isChecked ? `${l.color}60` : 'var(--border)'}`, borderRadius: 6, cursor: l.hasAccess ? 'pointer' : 'not-allowed', opacity: l.hasAccess ? 1 : 0.4, fontSize: 11 }}>
              <input type="checkbox" checked={isChecked} disabled={!l.hasAccess} onChange={() => toggleQl(l.page)} style={{ width: 14, height: 14, accentColor: l.color }} />
              <span>{l.icon} {l.label}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
