Every master/document detail page.
```jsx
<DetailHeader backLabel="Back to Vendor Master" onBack={back} code="VND-012" name="Precision Heat Treat"
  badges={<Badge tone="green">Active</Badge>} actions={<><Button variant="ghost" size="sm">✏ Edit</Button><Button variant="danger" size="sm">Delete</Button></>}>
  <ReadGrid><ReadField label="Contact person" value="R. Kulkarni" /><ReadField label="Address" value={addr} full pre /></ReadGrid>
</DetailHeader>
```