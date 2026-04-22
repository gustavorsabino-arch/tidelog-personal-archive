import test from 'node:test'
import assert from 'node:assert/strict'

import { attachBudgetActualDrillControlTotals } from './qb-drill-plan.ts'

test('keeps zero-net drill accounts in the task plan so GL detail is still fetched', () => {
  const planned = attachBudgetActualDrillControlTotals(
    [
      { entity: 'Opco', accountNumber: '60130' },
      { entity: 'Opco', accountNumber: '60510' },
    ],
    {
      Opco: {
        '60130': 100,
      },
    },
  )

  assert.deepEqual(planned, [
    { entity: 'Opco', accountNumber: '60130', accountTotal: 100 },
    { entity: 'Opco', accountNumber: '60510', accountTotal: 0 },
  ])
})
