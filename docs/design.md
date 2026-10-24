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

Analytics line charts keep the previous period in grey and use the same calendar labels as bars. Pointer, touch and keyboard inspection on the chart show the selected date and exact selected and previous amounts in a compact tooltip, without a separate scrubber. Each horizontal grid line shows its scale value, including zero. Total Wealth inspection includes horizontal and vertical dashed guides.

The custom date dialog separates its actions from the fields by 24 px. Cancel aligns left below Start date and Apply aligns right below End date. Date fields stack on narrow screens.

Transactions uses date and category filters without a separate subcategory selector. The toolbar places Clear filters and the compact 10/25/50/100 rows selector (with an accessible name) on the left and Add transaction on the right. Successful transaction creation returns to Transactions. Kind appears before Description, which receives the most table width; income and expense kinds and amounts use the same semantic colors as Analytics. Row editing uses the existing pencil icon and opens a centered modal with a dark backdrop. Numbered pagination shows five consecutive page links, the last page, and ellipses as needed, with the total page count. The shared page header no longer shows Reporting month.

Dashboard line previews use 8 by 8 px circular HTML markers over the chart. They stay outside the SVG scaling transform, so wide and narrow monitors render the same diameter. Exact-value titles remain attached to each marker.

## Recurring transactions

Recurring starts with Needs confirmation and a 90-day upcoming view, followed by the schedule form/list and recent posted, matched or skipped occurrences. Pending items show the due date, account, category, amount and overdue status, with Confirm, Adjust, Skip and Link transaction actions. These items do not change balances until recorded or linked. Automatic schedules are explicitly labeled.

The form supports weekly, every two weeks, monthly and yearly frequencies, with confirmation as the default. Edit schedule changes future occurrences only. A pending occurrence can be adjusted separately. Stop/resume retains history and pending items. Resume includes missed dates. Linking uses a modal with eligible unlinked transactions within 14 days (all history pages are fetched), and replaces a generated entry rather than counting both. Dialogs use native modal keyboard behavior, explicit errors and disabled saving controls.

Processing runs at wallet open, each visible minute and focus/visibility return. Failures show an error and retry action. UTC dates, month-end behavior and catch-up are explained by the form. The interface never requires a global Run due action. CSV preview labels exact unique recurring matches.
