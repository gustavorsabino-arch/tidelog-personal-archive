export type InternalTransferLeg = {
  id: string
  txHash: string
  entityId: string
  walletAddress: string
  counterpartyAddress: string | null
  direction: 'in' | 'out'
  asset: string
  qty: number
  usd: number | null
}

// Hash identifies the on-chain operation, not a single asset movement.
export function isInternalTransferPair(a: InternalTransferLeg, b: InternalTransferLeg): boolean {
  return a.id !== b.id
    && a.txHash === b.txHash
    && a.entityId === b.entityId
    && a.asset === b.asset
    && a.direction !== b.direction
    && a.walletAddress.toLowerCase() === b.counterpartyAddress?.toLowerCase()
    && b.walletAddress.toLowerCase() === a.counterpartyAddress?.toLowerCase()
    && Math.abs(Math.abs(a.qty) - Math.abs(b.qty)) < 1e-9
}
