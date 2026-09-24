Second row of ListHeader on document lists that filter by status via pills (SO, GRN). Lists whose statuses have counts use StatStrip instead — never both.
```jsx
<StatusPills options={['draft','open','closed']} value={s} onChange={setS} right={<ViewToggle value={v} onChange={setV} expandAll={all} onExpandAll={toggle} />} />
```