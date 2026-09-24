@deprecated alias — renders a StatStrip. The Plans screen's 3px-top tiles were a third count design; unified onto StatStrip.
```jsx
<KpiTiles items={[{ key: 'np', label: 'Needs Planning', value: 6, color: 'var(--red)' }]} onSelect={…} />   // ≡ <StatStrip …/>
```