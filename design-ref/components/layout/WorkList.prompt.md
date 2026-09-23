Dashboard building blocks. Colours come only from --sig-* (severity) and --dept-* (quick links).
```jsx
<WorkList items={[{ severity: 'critical', icon: '⚠️', title: 'NC-0214 awaiting disposition', detail: 'JC-0917 · 4 pcs', age: 5, action: 'Dispose' }]} />
<Panel title="Needs Attention" bodyPadding={0}><AttentionList items={[{ icon: '🔴', label: '2 SOs overdue', severity: 'critical' }]} /></Panel>
<StatRow icon="📥" label="GRNs received" value={4} />
<QuickLinks links={[{ icon: '📋', label: 'SO Master', color: 'var(--dept-sales)' }]} />
```