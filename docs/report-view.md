# Report view

The `/report` view has five tabs: MoM Comparison, YTD Trend, Balance Sheet, P&L and Presentation. `/presentation` redirects here. The Balance Sheet and P&L tabs reuse their existing screens and API endpoints; their previous `/accounting` and `/pnl` routes remain available for old deep links. Access follows the existing `qb:read` permission. Report figures come from `/api/report/financials`, which reads cached monthly QuickBooks P&L reports; no live QB calls occur when opening MoM or YTD.

## Accounting definitions

- **Revenue:** signed `Income + Other Income`.
- **Expenses:** signed `Expenses + Other Expenses`. Credits and reversals stay negative.
- **Net income:** the reported QB figure, reconciled to `Revenue − Expenses`.
- **Management subgroup:** a sum of leaf QB accounts with their original P&L section and sign retained. Parent subtotals never count twice.
- **Reported group:** sum of the entity P&Ls currently cached. Missing entities are disclosed. Intercompany amounts remain gross.
- **Unclassified:** any new account without an explicit mapping or a code-less line, such as Opco's March 2026 “Services” income. It stays in revenue/expenses and appears in the audit warning.
- **YTD comparison:** January through the chosen month versus the same cutoff in the previous year. The variance appears only when both periods contain all required months and entities.

MoM in Reported group shows four entity cards and a current-month subgroup matrix by entity. Choosing one entity switches to a focused comparison: its revenue, expenses and net income in both selected months and their change, followed by a subgroup table with compare month, current month and MoM change for that entity only. The subgroup name is plain text; only amounts open the QuickBooks account breakdown. Historically active subgroups remain visible at zero in months without a balance. Variances let the reader switch between the two compared months. Missing P&Ls appear as dashes, not zeros. YTD Trend shows the selected metric in its chart, cards and monthly table, with a separate value for each available entity. Clicking a monthly or YTD value opens the same account breakdown; clicking a numbered account opens the existing live-first QuickBooks GL transaction modal. The modal keeps P&L account signs and shows any subtotal difference explicitly. YTD charts use curved lines and subtle area fills, while the table supplies exact monthly values.

## Slides

1. Cover
2. MoM comparison, one column for each entity
3. Revenue trend
4. Net income trend
5. YTD comparison
6. Revenue composition
7. Operating expenses
8. Compensation expenses, including token compensation
9. Tech fees: SaaS, infrastructure and smart contract audits
10. Professional services
11. Other operating costs
12. Other P&L items, including intercompany and asset movements
13. QB reported P&L bridge

The slides use Orca navy, teal and gold, support fullscreen and browser PDF printing, and allow private speaker notes in local browser storage. No CXM company labels or legacy expense categories are used. The account inventory and August expense tie-out are documented in [the P&L audit](./report-pnl-inventory-2026-jan-aug.md).

## Remaining data limitation

Juku has no cached P&L from January through August 2026. It appears as missing in the tables and trends, and the group is marked partial. Intercompany elimination requires a separate general-ledger reconciliation; the reported gross P&L remains the source of truth until then.
