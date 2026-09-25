Card view for every document list — the SO and GRN lists already share this exact anatomy (each had a local QtyBox copy).
```jsx
<DocCard accent="var(--amber)" code="IN-GRN-26-0142" title="Precision Heat Treat" badges={<Badge tone="amber">QC Pending</Badge>}
  metrics={<QtyStrip items={[{label:'Received',value:60},{label:'Accepted',value:0},{label:'Rejected',value:0},{label:'Lines',value:2}]} />}
  meta={['2026-09-23', <>PO <b style={{color:'var(--purple)'}}>IN-MPO-26-0311</b></>, 'DC 4471']} expanded onToggle={t}>
  <LinesPanel code="IN-GRN-26-0142" onOpenDetail={open}><DataTable … /></LinesPanel>
</DocCard>
```