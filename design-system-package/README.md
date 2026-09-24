# Innovic ERP — design-system upload package

Everything Claude Design needs to reproduce the Innovic ERP look. Built 2026-09-23 from the
live `test` branch, based on the three screens you named: **Job Cards table**, **Job Card page**,
**Purchase Orders list**.

## What to upload, and in what order

Upload all of these in one go; the order only matters for how you introduce them.

| # | File | Why it matters |
|---|---|---|
| 1 | `00-DESIGN-SYSTEM.md` | **Start here.** The overview: principles, colour, type, spacing, every component rule, the page patterns and the 12 hard rules. If you upload only one file, upload this. |
| 2 | `01-tokens.css` | The real token file from the app. This is the source of truth for every colour, font, radius and size — Claude should copy values from here, never guess. |
| 3 | `02-innovic-theme.css` | The real 1630-line component stylesheet. Lets Claude reuse actual class names instead of inventing new ones. |
| 4 | `03-component-reference.md` | Class-by-class inventory (1035 lines) with real markup for every panel, table, button, badge, form and modal, plus the full z-index ladder. |
| 5 | `04-page-anatomy.md` | The three reference screens broken down region by region and column by column (642 lines), ending in 36 reusable rules. |
| 6 | `screenshots/*.png` | Four images — the two lists, the detail page, and a component board showing tokens, type scale, buttons, badges and the form grid. |

## Suggested prompt to paste alongside them

> These files describe the design system of Innovic ERP, a manufacturing ERP.
> `00-DESIGN-SYSTEM.md` is the overview, `01-tokens.css` is the source of truth for all values,
> and the screenshots show the three reference screens. Build a design system from these:
> reuse the existing tokens and class names, keep the information density, and follow the hard
> rules at the end of the overview. Do not introduce new colours, gradients, shadows on cards,
> or rounded corners above 8px.

## About the screenshots

They are rendered from the application's own `tokens.css` and `innovic-theme.css` using the
real class names, with representative sample data — so every colour, font, border, spacing and
table rule is genuinely the app's. They are **not** photographs of the live site (it needs a
login I do not have) and the rows are illustrative, not live records.

If you would rather have real screenshots of the live site, take these four yourself and drop
them into `screenshots/`, overwriting the same filenames — nothing else in the package needs to
change:

1. Production → Job Cards (the list, top of page)
2. Any Job Card detail page
3. Purchase → Purchase Orders (list view)
4. Any create/edit form, for the field layout

## Re-rendering the screenshots

`renders/*.html` are the pages that produced the images. Open any of them in a browser to see
it live. They link to `../01-tokens.css` and `../02-innovic-theme.css`, so if you refresh those
two files from the repo the renders update with them.

- `renders/_shell.js` — the top nav + breadcrumb chrome
- `renders/_data.js` — the sample rows
- `renders/_render-helpers.css` — a handful of classes that replicate the inline styles the
  React components set (StatStrip cells, progress bars). **Not part of the design system** —
  they exist only so a static HTML page can reproduce the same pixels.
