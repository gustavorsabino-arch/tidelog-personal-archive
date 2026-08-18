'use client'
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { apiFetch } from '@/lib/api'
import { ENTITIES, ENTITY_COLORS, STABLE_TOKENS, TOKEN_COLORS } from '@/lib/constants'
import { fmtDate, fmtNum, fmtUSD } from '@/lib/format'
import { Skeleton } from '@/components/skeleton'
import { PriceWithSource } from '@/components/price-with-source'
import type { BsAccount, BsSection, BsTree } from '@/lib/qb/balance-sheet'
import type { OnchainSummary } from '@/lib/accounting/onchain-summary'
import { GlDrillDrawer } from '@/components/gl-drill-drawer'
import type { GlDrillScope } from '@/lib/qb/gl-data'

type BsResponse = {
  entity: string
  asOf: string
  bsAsOf: string | null
  bsFetchedAt: string | null
  fetchedAt: string
  bs: BsTree | null
  bsError: string | null
  onchain: OnchainSummary | null
  onchainError: string | null
}

function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return `${secs}s ago`
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function BsRow({
  node, depth, onGlClick,
}: {
  node: BsSection | BsAccount
  depth: number
  onGlClick: (glCode: string, label: string) => void
}) {
  if (node.kind === 'account') {
    const handleClick = node.glCode ? () => onGlClick(node.glCode!, node.label) : undefined
    return (
      <tr>
        <td
          title={node.label}
          style={{
            paddingTop: 6, paddingRight: 10, paddingBottom: 6, paddingLeft: depth * 16 + 10,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0,
          }}
        >
          {node.glCode ? (
            <button
              className="gl-badge-button"
              onClick={handleClick}
              title="View transactions"
              style={{
                fontFamily: 'var(--mono)', fontSize: '0.7rem', background: 'var(--surface2)',
                color: 'var(--accent)', padding: '1px 6px', borderRadius: 4, marginRight: 8,
                border: 'none', cursor: 'pointer',
              }}
            >{node.glCode}</button>
          ) : null}
          {node.glCode ? node.label.replace(/^\d{4,}\s*·?\s*/, '') : node.label}
        </td>
        {/* Amount clickable → same GL drill as /pnl. Shows PERIOD ACTIVITY
            (year-start → as-of month-end), not the cumulative balance. */}
        <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>
          {handleClick ? (
            <button
              onClick={handleClick}
              title="View transactions"
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontFamily: 'inherit', fontSize: 'inherit', color: 'var(--accent)',
                textDecoration: 'underline', textDecorationStyle: 'dotted', textUnderlineOffset: 3,
                whiteSpace: 'nowrap',
              }}
            >{fmtUSD(node.amount)}</button>
          ) : (
            fmtUSD(node.amount)
          )}
        </td>
      </tr>
    )
  }

  return (
    <>
      <tr>
        <td
          title={node.title}
          style={{
            paddingTop: 8, paddingRight: 10, paddingBottom: 8, paddingLeft: depth * 16 + 10,
            fontWeight: 600, fontSize: '0.85rem',
            borderTop: '1px solid var(--border)',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0,
          }}
        >
          {node.title}
        </td>
        <td style={{
          paddingTop: 8, paddingRight: 10, paddingBottom: 8,
          fontWeight: 600, fontSize: '0.85rem',
          textAlign: 'right', fontFamily: 'var(--mono)', whiteSpace: 'nowrap',
          borderTop: '1px solid var(--border)',
        }}>{fmtUSD(node.total)}</td>
      </tr>
      {node.children.map((child, i) => (
        <BsRow key={i} node={child} depth={depth + 1} onGlClick={onGlClick} />
      ))}
    </>
  )
}

export default function AccountingPage() {
  const [entity, setEntity] = useState<(typeof ENTITIES)[number]>('Opco')
  const [asOf, setAsOf] = useState(todayUtc())

  const swrKey = `/api/accounting/balance-sheet?entity=${entity}&asOf=${asOf}`
  const { data, isLoading, error: swrError, mutate } = useSWR<BsResponse>(
    swrKey,
    apiFetch<BsResponse>,
  )
  const loading = isLoading
  const error = swrError ? (swrError instanceof Error ? swrError.message : String(swrError)) : null

  const glTotal = data?.bs?.totals.assets ?? 0
  const onchainTotal = data?.onchain?.totalUsd ?? 0
  const hasOnchain = (data?.onchain?.byToken?.length ?? 0) > 0

  const rows = useMemo(() => data?.bs?.sections ?? [], [data])

  // GL drill drawer — same component /pnl uses. A balance-sheet amount is a
  // CUMULATIVE balance, but the GL cache is period-bounded, so the drill
  // shows the year's ACTIVITY: Jan 1 of the as-of year → month-end of the
  // as-of month (cache granularity is monthly; a mid-month as-of would
  // otherwise exclude the current month's row).
  const [drill, setDrill] = useState<{
    entity: GlDrillScope
    accountNumber: string
    accountLabel: string
    periodStart: string
    periodEnd: string
  } | null>(null)

  function openDrill(glCode: string, label: string) {
    const effectiveAsOf = data?.bsAsOf ?? asOf
    const year = effectiveAsOf.slice(0, 4)
    const monthNum = Number(effectiveAsOf.slice(5, 7))
    const lastDay = new Date(Date.UTC(Number(year), monthNum, 0)).getUTCDate()
    setDrill({
      entity,
      accountNumber: glCode,
      accountLabel: `${label} · ${year} activity`,
      periodStart: `${year}-01-01`,
      periodEnd: `${year}-${String(monthNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
    })
  }

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Balance Sheet</div>
        <div className="page-sub">QuickBooks GL · on-chain reconciliation</div>
      </div>

      <div className="controls-bar">
        <div className="entity-tabs">
          {ENTITIES.map((e) => (
            <button
              key={e}
              className={`entity-tab${entity === e ? ' active' : ''}`}
              onClick={() => setEntity(e)}
              style={entity === e ? { color: ENTITY_COLORS[e] } : undefined}
            >
              {e}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--muted)' }}>
          As of
          <input
            type="date"
            className="fsel"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
            max={todayUtc()}
          />
        </label>
        {data?.bsAsOf && data.bsAsOf !== asOf ? (
          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
            Snapshot: {fmtDate(data.bsAsOf)}
          </span>
        ) : null}
        {data?.bsFetchedAt ? (
          <span style={{ color: 'var(--muted)', fontSize: '0.75rem' }}>
            QB fetched {fmtRelative(data.bsFetchedAt)}
          </span>
        ) : null}
        <button
          onClick={() => mutate()}
          disabled={loading}
          className="fsel"
          style={{ fontSize: '0.75rem', cursor: loading ? 'default' : 'pointer' }}
          title="Re-read cached snapshot"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {loading && !data ? (
        <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
          {[0, 1].map((i) => (
            <div key={i} className="card">
              <Skeleton width={90} height={10} style={{ marginBottom: 10 }} />
              <Skeleton width={140} height={22} style={{ marginBottom: 8 }} />
              <Skeleton width={180} height={10} />
            </div>
          ))}
        </div>
      ) : (
      <div className="cards-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
        <div className="card">
          <div className="card-label">GL Total (Assets)</div>
          <div className="card-value">{fmtUSD(glTotal, 0)}</div>
          {data?.bs ? (
            <div className="card-sub">
              L {fmtUSD(data.bs.totals.liabilities, 0)} · E {fmtUSD(data.bs.totals.equity, 0)}
            </div>
          ) : data?.bsError ? (
            <div className="card-sub" style={{ color: 'var(--red)' }}>QB error</div>
          ) : null}
        </div>
        <div className="card">
          <div className="card-label">On-Chain Total</div>
          <div className={`card-value${hasOnchain ? '' : ' orange'}`} style={hasOnchain ? undefined : { color: 'var(--muted)' }}>
            {hasOnchain ? fmtUSD(onchainTotal, 0) : '—'}
          </div>
          <div className="card-sub">
            {hasOnchain
              ? `${data?.onchain?.walletCount ?? 0} wallets · snapshot ${data?.onchain?.snapshotDate ?? '—'}`
              : 'Run fetch-balances cron'}
          </div>
        </div>
      </div>
      )}

      {error ? (
        <div className="empty">
          <div className="empty-icon">⚠️</div>
          <div>{error}</div>
        </div>
      ) : null}

      {data?.onchainError ? (
        <div style={{
          marginTop: 12, padding: '8px 12px', borderRadius: 'var(--radius)',
          background: 'var(--surface)', border: '1px solid var(--border)',
          color: 'var(--red)', fontSize: '0.75rem',
        }}>
          On-chain summary unavailable: {data.onchainError}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, marginTop: 16 }}>
        {/* On-chain per-token */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
            On-Chain Balances
          </div>
          {loading && !data ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <tbody>
                {[0, 1, 2, 3, 4].map((i) => (
                  <tr key={i}>
                    <td style={{ padding: '6px 10px' }}><Skeleton width={60} height={12} /></td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={70} height={12} /></td>
                    <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={80} height={12} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : data?.onchain && data.onchain.byToken.length > 0 ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface2)' }}>
                  <th style={{ padding: '8px 10px', textAlign: 'left', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Token</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Amount</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Price</th>
                  <th style={{ padding: '8px 10px', textAlign: 'right', fontSize: '0.65rem', color: 'var(--muted)', textTransform: 'uppercase' }}>USD</th>
                </tr>
              </thead>
              <tbody>
                {data.onchain.byToken.map((t) => {
                  const missingPrice = t.priceUsd === 0 && !STABLE_TOKENS.has(t.token) && t.amount > 0
                  return (
                    <tr key={t.token}>
                      <td style={{ padding: '6px 10px' }}>
                        <span style={{
                          display: 'inline-block', width: 8, height: 8, borderRadius: 4,
                          background: TOKEN_COLORS[t.token] ?? TOKEN_COLORS.default, marginRight: 8,
                        }} />
                        {t.token}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtNum(t.amount, 4)}</td>
                      <td
                        style={{
                          padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)',
                        }}
                        title={missingPrice ? 'No price available — USD treated as 0' : undefined}
                      >
                        <PriceWithSource
                          value={missingPrice ? null : t.priceUsd}
                          source={t.source}
                          kind={data?.onchain?.kind ?? 'live'}
                          asOfDate={data?.onchain?.snapshotDate ?? null}
                        />
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'var(--mono)' }}>{fmtUSD(t.usd, 0)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          ) : (
            <div className="empty" style={{ padding: 24 }}>
              <div style={{ fontSize: '0.75rem' }}>No on-chain snapshot yet for {entity}.</div>
            </div>
          )}
        </div>

        {/* QB BS tree */}
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
          <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', fontWeight: 600 }}>
            QuickBooks General Ledger
          </div>
          {loading && !data ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed' }}>
                <colgroup>
                  <col />
                  <col style={{ width: 140 }} />
                </colgroup>
                <tbody>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <tr key={i}>
                      <td style={{ padding: '6px 10px' }}><Skeleton width={160} height={12} /></td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}><Skeleton width={90} height={12} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : data?.bs && rows.length > 0 ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: '0.8rem', tableLayout: 'fixed' }}>
                <colgroup>
                  <col />
                  <col style={{ width: 140 }} />
                </colgroup>
                <tbody>
                  {rows.map((section, i) => (
                    <BsRow key={i} node={section} depth={0} onGlClick={openDrill} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty" style={{ padding: 24 }}>
              <div style={{ fontSize: '0.75rem' }}>
                {data?.bsError ? `QB: ${data.bsError}` : `No QB BS data for ${entity}.`}
              </div>
            </div>
          )}
        </div>
      </div>

      {drill ? (
        <GlDrillDrawer
          open={!!drill}
          onClose={() => setDrill(null)}
          entity={drill.entity}
          accountNumber={drill.accountNumber}
          accountLabel={drill.accountLabel}
          periodStart={drill.periodStart}
          periodEnd={drill.periodEnd}
        />
      ) : null}
    </div>
  )
}
