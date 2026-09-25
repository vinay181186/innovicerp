Top of every list / register page (SO, Vendors, GRN, PR, JC…). Never hand-roll this band.
```jsx
<ListHeader icon="🏭" title="Vendor Master" count={42} noun="vendor" search={q} onSearch={setQ}
  primary={<Button>+ Add Vendor</Button>}>
  <StatStrip items={…} />
</ListHeader>
```
Order inside the toolbar: search → filters/Export → Updating… → primary.