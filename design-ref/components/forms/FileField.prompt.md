Upload fields exactly as the product renders them. Viewing a file always opens FilePreview in-app — never window.open.
```jsx
<FileField variant="attach" fileName={null} onPick={upload} />
<FileField variant="drawing" fileName="BF-SH-2210_RevB.pdf" onView={preview} onRemove={clear} />
<FileField variant="image" />
```