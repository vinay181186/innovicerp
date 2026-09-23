Single-row count strip above any list or on the dashboard — never render counts as separate cards.
```jsx
<StatStrip items={[
  { key: 'open', label: 'Open', count: 12, color: 'var(--amber)', active: true, onClick: () => {} },
  { key: 'all', label: 'All PRs', count: 48, color: 'var(--cyan)', onClick: () => {} },
]} />
```
Active filter = coloured label + 2px bottom border in its own colour.