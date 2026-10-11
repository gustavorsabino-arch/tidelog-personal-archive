export type TransferLeg = {
  id: string
  txHash: string
  entityId: string
  walletAddress: string
  counterpartyAddress: string | null
  direction: 'in' | 'out'
  asset: string
  qty: number
}

function sameAddress(a: string | null, b: string | null): boolean {
  if (!a || !b) return false
  return a === b || (a.startsWith('0x') && b.startsWith('0x') && a.toLowerCase() === b.toLowerCase())
}

// One hash can move tokens to several wallets. Only opposite sides of the
// same wallet-to-wallet movement share one posting status.
export function isTransferPair(a: TransferLeg, b: TransferLeg): boolean {
  return a.id !== b.id
    && a.txHash === b.txHash
    && a.entityId === b.entityId
    && a.asset === b.asset
    && a.direction !== b.direction
    && sameAddress(a.walletAddress, b.counterpartyAddress)
    && sameAddress(b.walletAddress, a.counterpartyAddress)
    && Math.abs(Math.abs(a.qty) - Math.abs(b.qty)) <= Math.max(0.000001, 1e-9 * Math.max(Math.abs(a.qty), Math.abs(b.qty)))
}
