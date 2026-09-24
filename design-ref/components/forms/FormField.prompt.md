Form label + control on the 12-column FormGrid. Pick `size` by what the field holds — never stretch a short value.
```jsx
<FormGrid>
  <DocNumberInput label="SO No." size="sm" required />
  <FormField label="Date" size="sm"><Input type="date" /></FormField>
  <FormField label="GST %" size="xs"><Input className="mono" /></FormField>
  <FormField label="Client" size="lg" required><SearchableSelect … /></FormField>
  <FormField label="Remarks" size="full"><Textarea rows={2} /></FormField>
</FormGrid>
```
xs %/rev/days/UOM · sm qty/rate/date/doc no. · md select/ref · lg party/name/email · full remarks.
Inputs outside a form (table cells, toolbars) use `.fw-xs/.fw-sm/.fw-md/.fw-lg` instead of inline widths.
