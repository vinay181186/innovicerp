Item identity everywhere (lists, cards, headers). In sheets, put ItemImageBox fill in its own 8% "Thumbnail" column and ItemBadge showImage={false} beside it.
```jsx
<ItemBadge code="BF-SH-2210" revision="B" name="Pinion Shaft" />
<ItemBadge size="tile" code="BF-SH-2210" revision="B" name="Pinion Shaft" codeColor="var(--text)" />
```