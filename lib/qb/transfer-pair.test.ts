import { expect, test } from 'bun:test'
import { isTransferPair, type TransferLeg } from './transfer-pair'

const outbound: TransferLeg = {
  id: 'out', txHash: '0xshared', entityId: 'opco', walletAddress: '0xBuyback',
  counterpartyAddress: '0xVelar', direction: 'out', asset: 'USDC', qty: 249999.99,
}
const inbound: TransferLeg = {
  ...outbound, id: 'in', walletAddress: '0xVelar', counterpartyAddress: '0xBuyback', direction: 'in',
}

test('reciprocal wallet legs share posting state despite differing GL accounts', () => {
  expect(isTransferPair(outbound, inbound)).toBe(true)
})

test('same hash does not post two deposits into different wallets', () => {
  const revenue: TransferLeg = { ...inbound, id: 'revenue', walletAddress: 'Revenue - Team Protocol', counterpartyAddress: 'CRQd_u7aK', qty: 532.41 }
  const climate: TransferLeg = { ...revenue, id: 'climate', walletAddress: 'Panama Opco - Climate Fund' }
  expect(isTransferPair(revenue, climate)).toBe(false)
  expect(isTransferPair(outbound, { ...inbound, walletAddress: '0xOther' })).toBe(false)
  expect(isTransferPair(outbound, { ...inbound, entityId: 'foundation' })).toBe(false)
})
