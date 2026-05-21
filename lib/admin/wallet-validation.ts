import { z } from 'zod'

export type Chain = 'SOL' | 'ETH' | 'BTC'

const SOL_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const ETH_RE = /^0x[a-fA-F0-9]{40}$/
const BTC_LEGACY_RE = /^[13][a-km-zA-HJ-NP-Z1-9]{25,34}$/
const BTC_BECH32_RE = /^bc1[a-z0-9]{6,87}$/

export function validateAddress(chain: Chain, address: string): boolean {
  switch (chain) {
    case 'SOL': return SOL_RE.test(address)
    case 'ETH': return ETH_RE.test(address)
    case 'BTC': return BTC_LEGACY_RE.test(address) || BTC_BECH32_RE.test(address)
  }
}

export function normalizeAddress(chain: Chain, address: string): string {
  return chain === 'ETH' ? address.toLowerCase() : address
}

export const CreateWalletSchema = z.object({
  address: z.string().min(1),
  label: z.string().min(1).max(80),
  chain: z.enum(['SOL', 'ETH', 'BTC']),
  entityId: z.string().min(1),
  accountCode: z.string().optional(),
  isExternal: z.boolean().default(false),
  overviewOnly: z.boolean().default(false),
  includeInOverview: z.boolean().default(true),
  backfill: z.boolean().optional(),
}).superRefine((val, ctx) => {
  if (!validateAddress(val.chain, val.address)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['address'],
      message: `Invalid ${val.chain} address format`,
    })
  }
  if (val.backfill === true) {
    if (val.chain !== 'SOL') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backfill'],
        message: 'Backfill is only supported for SOL wallets',
      })
    }
    if (val.isExternal === true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['backfill'],
        message: 'Backfill is not supported for external wallets',
      })
    }
  }
})

export type CreateWalletInput = z.infer<typeof CreateWalletSchema>
