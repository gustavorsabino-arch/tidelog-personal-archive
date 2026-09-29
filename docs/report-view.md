# Report view

The new `/report` view has three tabs: MoM Comparison, YTD Trend and Presentation. `/presentation` redirects here. Access follows the existing `qb:read` permission. The figures come from `/api/report/financials`, which reads cached monthly QuickBooks P&L reports; no live QB calls occur when opening the view.

## Accounting definitions

- **Revenue:** signed `Income + Other Income`.
- **Expenses:** signed `Expenses + Other Expenses`. Credits and reversals stay negative.
- **Net income:** the reported QB figure, reconciled to `Revenue − Expenses`.
- **Management subgroup:** a sum of leaf QB accounts with their original P&L section and sign retained. Parent subtotals never count twice.
- **Reported group:** sum of the entity P&Ls currently cached. Missing entities are disclosed. Intercompany amounts remain gross.
- **Unclassified:** any new account without an explicit mapping or a code-less line, such as Opco's March 2026 “Services” income. It stays in revenue/expenses and appears in the audit warning.
- **YTD comparison:** January through the chosen month versus the same cutoff in the previous year. The variance appears only when both periods contain all required months and entities.

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
