The ONE table for every list, register, nested line table and line editor — same ruled-sheet design everywhere; only modifiers change.
```jsx
<DataTable onRowClick={open} columns={[{ header: 'Sr No', width: '5%', render: (r, i) => i + 1, className: 'text3' }, { header: 'SO No.', key: 'code', className: 'td-code', width: '14%' }, { header: 'Customer', key: 'customer', align: 'left' }]} rows={orders} />
<DataTable frozen autoWidth … />        // wide register, first column pinned
<DataTable density="compact" … />       // line items inside an expanded row
<DataTable editable … />                // inputs in cells
```
Design (fixed): 2px --blue2 rules top & bottom · header Barlow Condensed 800 11px uppercase --blue2 on --bg4 · 1px --border2 gridlines · cream (#fffbf2) / white rows · --bg4 hover · 13px cells, 8px padding, centred · Sr No first, Action last.
`variant="list"` is deprecated (legacy unruled look).