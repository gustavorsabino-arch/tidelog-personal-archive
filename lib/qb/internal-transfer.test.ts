import { expect, test } from 'bun:test'
import { isInternalTransferPair, type InternalTransferLeg } from './internal-transfer-match'

const outgoing: InternalTransferLeg = {
  id: 'out', txHash: '0xabc', entityId: 'opco',
  walletAddress: '0xManagement', counterpartyAddress: '0xBuyback',
  direction: 'out', asset: 'ORCA', qty: 7703.13, usd: 10765.65,
}
const incoming: InternalTransferLeg = {
  ...outgoing, id: 'in', walletAddress: '0xBuyback',
  counterpartyAddress: '0xManagement', direction: 'in',
}

test('reciprocal wallet movements with the same hash are one internal transfer', () => {
  expect(isInternalTransferPair(outgoing, incoming)).toBe(true)
  expect(isInternalTransferPair(incoming, outgoing)).toBe(true)
})

test('hash alone cannot match unrelated movements or a second QuickBooks entity', () => {
  for (const changed of [
    { asset: 'USDC' }, { entityId: 'foundation' }, { qty: 7700 },
    { direction: 'out' as const },
    { walletAddress: '0xOther' }, { counterpartyAddress: '0xOther' },
    { txHash: '0xdef' },
  ]) {
    expect(isInternalTransferPair(outgoing, { ...incoming, ...changed })).toBe(false)
  }
})

test('different price estimates do not split the same on-chain transfer', () => {
  expect(isInternalTransferPair(outgoing, { ...incoming, usd: 10760 })).toBe(true)
})
