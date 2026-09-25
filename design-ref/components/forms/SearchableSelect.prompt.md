Combobox for picking any master or document — never a plain free-text input or <select> for these.
```jsx
<FormField label="Vendor" required>
  <SearchableSelect value={vendorId} onChange={setVendorId} options={[{ id: '1', code: 'VND-012', name: 'Precision Heat Treat' }]} />
</FormField>
```
Placeholder "🔍 Click to browse or type to search…". Highlighted row = solid Innovic blue with white text. ↑/↓/Enter/Esc keyboard support. Typing clears the saved id.