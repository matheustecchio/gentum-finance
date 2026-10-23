# Interface design

Gentum uses a dark neutral interface with white controls and semantic colors for financial data. The interface runs inside the local Tauri desktop application. The public website is a separate static surface.

## Visual roles

The tokens in `frontend/src/styles/global.css` define the shared palette:

| Role | Token | Color |
| --- | --- | --- |
| Canvas | `--canvas` | `#0a0a0a` |
| Surface | `--surface` | `#101010` |
| Raised surface | `--surface-raised` | `#181818` |
| Primary text | `--text` | `#f0f0f0` |
| Secondary text | `--muted` | `#adadad` |
| Interface accent | `--accent` | `#eeeeee` |
| Income and positive changes | `--income` | `#65d6a0` |
| Spending and negative changes | `--expense` | `#ff8290` |
| Assets and net cash-flow amounts | `--assets` | `#86b4ff` |

JetBrains Mono is self-hosted from the bundled Latin variable font. Its SIL Open Font License is included beside the font. Surfaces use fine borders and restrained corners. Focus outlines, native controls, placeholders, selection and scrollbars follow the shared theme. Category colors remain the user's saved colors.

## Brand assets

The approved wallet monogram is used in the sidebar, SVG favicon, and native app icon. `frontend/src/assets/icons/gentum-app.svg` is the app mark; `gentum-brand.svg` and `gentum-mark.svg` provide the full signature and light-background mark. The native PNG in `desktop/icons/icon.png` comes from the same VectorCraft artboard. Editable sources stay local in the ignored `raw-icons/` folder.

## Analytics

Analytics is the initial navigation destination. It uses the available main-column width without an additional outer panel. The existing cards still open their detailed charts and transaction views.

Income and spending previews use the API's ordered trend buckets. Labels identify the dates or months without opening a detail view. The six-month view labels all six calendar months, including future months, without plotting future values. Summary cards stack below 380 px so month labels stay readable. Missing or unsupported amounts leave a gap rather than inventing a value. Native point and bar tooltips show exact supported amounts.

The Total Wealth preview labels its own history dates, independently of the cash-flow period selector. It has extra space above it. The current amount remains independent of the selected cash-flow range.

The active database appears in the sidebar footer as `Local database: <name>`, with the application version below it. Database switching and optional PIN protection retain their existing behavior.

Chart view and style selectors use aligned 20 px icons in 40 px rounded rectangular buttons. Chart bars retain exact-value tooltips and keyboard access without a focus border; keyboard inspection uses a faint neutral fill. Exact-value tables remain available to assistive technology without a visible disclosure link.

## Validation

Frontend unit tests cover calendar labels, missing months, future buckets and unsupported history amounts. Browser tests cover semantic colors, semester labels, spacing, the database footer, keyboard navigation and narrow layouts. Keep financial values as integer cents and preserve server-side financial calculations.
