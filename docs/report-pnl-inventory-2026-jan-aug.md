# Report: P&L account inventory, January–August 2026

Source: the monthly QuickBooks P&L cache displayed in Tidelog, checked for each of Opco, Foundation, Juku and Zagreus. Amounts below are USD. This is a reported, gross view of the entities, with no intercompany elimination. No Report deployment has been made.

## Coverage and accounting checks

| Entity | Jan | Feb | Mar | Apr | May | Jun | Jul | Aug | Distinct numbered accounts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | ---: |
| Opco | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 54 |
| Foundation | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 16 |
| Juku | missing | missing | missing | missing | missing | missing | missing | missing | — |
| Zagreus | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | 58 |

There are **87 distinct numbered accounts** across the available reports (the same number can occur in more than one entity), plus one account without a number. Each of the 24 available entity-month P&Ls was checked at the leaf-account level against its QuickBooks section subtotals and net income. The one unnumbered account is **Opco / March / Income / Services / $8,562.25**. It must be retained in “Unclassified QB accounts” until its QB account identity is clarified. A report that silently drops it would understate March revenue by $8,562.25.

Juku returned `pnl.not_cached` for all eight months. Its blank periods are **missing**, not zero. Group comparisons and presentation totals must be labelled partial (three of four entities) until Juku is connected and its monthly P&L is cached.

| Month | Opco revenue | Opco expenses | Opco net | Foundation revenue | Foundation expenses | Foundation net | Zagreus revenue | Zagreus expenses | Zagreus net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Jan | 400,618.91 | 742,875.91 | -342,257.00 | 0.00 | 15,214.13 | -15,214.13 | 471,900.63 | 810,463.58 | -338,562.95 |
| Feb | 562,924.34 | 683,027.35 | -120,103.01 | 0.00 | 25,089.09 | -25,089.09 | 251,728.91 | 458,574.63 | -206,845.72 |
| Mar | -319,692.58 | 482,327.03 | -802,019.61 | 885,062.91 | 1,076,942.00 | -191,879.09 | 431,389.67 | 464,843.84 | -33,454.17 |
| Apr | 447,251.61 | 540,810.36 | -93,558.75 | 239,685.64 | 59,317.49 | 180,368.15 | 643,439.70 | 639,062.59 | 4,377.11 |
| May | 1,244,686.66 | 512,467.04 | 732,219.62 | 38,376.00 | 13,936.43 | 24,439.57 | 533,125.37 | 506,356.47 | 26,768.90 |
| Jun | 298,137.13 | 1,097,843.01 | -799,705.88 | 49,846.00 | 57,611.80 | -7,765.80 | 755,818.19 | 654,273.00 | 101,545.19 |
| Jul | 192,908.85 | 548,960.99 | -356,052.14 | 33,336.00 | 146,640.30 | -113,304.30 | 268,438.74 | 309,795.21 | -41,356.47 |
| Aug | 328,106.96 | 652,796.21 | -324,689.25 | 52,720.38 | 64,784.62 | -12,064.24 | 352,108.73 | 297,016.25 | 55,092.48 |

Revenue includes the signed `Income + Other Income`; expenses are the signed `Expenses + Other Expenses`. Net income equals revenue minus expenses, with zero-cent residual for each cached month. This matters when gains, credits or reversals are negative: using `abs()` on an expense or loss changes the result. The existing P&L card currently uses absolute values for its “Total Expenses” display and can therefore show a different amount from the signed accounting bridge (for example Foundation January shows $16,573.67, while signed expenses are $15,214.13). Its QB net-income figure is still correct. Report calculations use the signed bridge.

The [account-level audit snapshot](./report-pnl-accounts-2026-jan-aug.tsv) contains all 129 entity/section/account rows with their eight monthly signed balances in **cents**. A zero is an account that appears in another month; no Juku rows exist because its P&L is unavailable. The snapshot test sums those rows to all 24 QB revenue and expense totals.

August illustrates the expense tie-out: compensation $429,797.39; software, hosting and security $83,250.89; professional services $66,552.67; HR $300.00; travel $14,304.95; marketing $11,262.82; office $1,282.86; other operating $9,993.85; intercompany $330,757.53; reconciliation $66,970.35; depreciation $123.77. **Total $1,014,597.08**, equal to the reported August expense balance for the three available entities.

## Management subgroups and exact account coverage

Each leaf is assigned to exactly one management subgroup **inside its original QB section**. Thus a realized gain in Other Expenses remains in Other Expenses; the subgroup does not flip its accounting sign or double-count a parent subtotal. Account names, the entity, month, signed amount, and QB section remain available for drilldown. The mapping in `lib/report/pnl-inventory.ts` is the executable version of this table.

| Area | Subgroup | QB account numbers observed |
| --- | --- | --- |
| Revenue | Protocol & product | 40110, 40905 |
| Revenue | Managed services & intercompany revenue | 40001, 40102 |
| Revenue | Treasury & investment income | 70002, 70110, 70140, 71020 |
| Revenue | Digital asset gains and losses | 70003, 70004, 70005, 70150, 70510, 73001 |
| Revenue | Other income | 70001, 70009, 70015, 71010, 71099 |
| Compensation | Employee cash | 60110, 60120, 60130, 60150 |
| Compensation | Employee token | 60210, 60220 |
| Compensation | Contractor cash | 60310, 60320, 60330, 60340 |
| Compensation | Contractor token | 60410 |
| Compensation | Benefits, insurance & severance | 60160, 60350, 60520, 60610, 60650 |
| Technology | Software & SaaS | 61010, 61020 |
| Technology | Hosting, blockchain & security | 61110, 61120, 61130 |
| Technology | Smart contract audits | 62050 |
| Operations | Professional services & governance | 62010, 62020, 62030, 62040, 62060, 62080, 62090 |
| Operations | HR & recruiting | 63030, 63040, 63050 |
| Operations | Travel & entertainment | 64010, 64020, 64030, 64050, 64060, 64070 |
| Operations | Company offsite | 64110, 64120, 64130, 64140, 64150, 64160, 64170 |
| Operations | Marketing & incentives | 65030, 65040, 65099 |
| Operations | Transaction & treasury fees | 66010, 66020, 66030, 66040 |
| Operations | Office & hardware | 67010, 67020, 67030 |
| Operations | Intercompany charges | 68140 |
| Operations | Other operating expenses | 69020, 69030, 69040, 69050; 69099 only when named “Uncategorized Expense” |
| Below operating result | Interest & financing | 71002 |
| Below operating result | Other non-operating expense | 71001 |
| Below operating result | Depreciation | 71003, 72000 |
| Below operating result | Company taxes | 75001, 75002 |
| Review separately | Reconciliation discrepancies | 74000; 69099 only when named “Reconciliation Discrepancies” |
| Review separately | Unclassified QB accounts | March Opco “Services” without number; any future unknown account |

## Items to keep visible in the C-level analysis

- **Intercompany:** Opco's 68140 charge in August is $330,757.53. Zagreus's 40001 + 40102 revenue is also $330,757.53 that month. This is a candidate elimination, not proof of matching transactions. Keep reported gross amounts and provide a separately reconciled elimination bridge only after checking the general ledger.
- **Treasury and assets:** Opco 70110 DeFi lending in May is $1,007,703.53; Foundation 70005 unrealized gain in March is $885,062.91; Foundation 73001 in March is a $903,236.08 other-expense balance. Show operating performance separately from these volatile asset items while preserving the QB reported net income.
- **Corrections and credits:** Opco 66030 Wallet Funding is **-$42,243.31** in March; Foundation 61020 Company Tools is **-$5,800.80** in July. These reduce their signed expense groups. Do not take the absolute value.
- **Reconciliation:** Opco 74000 contributes $66,970.35 of August other expenses. Show it separately rather than hiding it in operating expenses.
- **Source gaps:** Juku is unavailable for all eight months. Any comparison that implies four fully reported companies would be misleading.
