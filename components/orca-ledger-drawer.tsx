'use client'
import { useEffect, useRef, useState } from 'react'
import { fmtNum, fmtUSD, fmtAddr } from '@/lib/format'
import { CopyButton } from '@/components/copy-button'
import type { OrcaLedgerRow, OrcaWalletSummary, LotTraceEntry } from '@/lib/types'

interface Props {
  row: OrcaLedgerRow | null
  pairedRow: OrcaLedgerRow | null
  walletSummary: OrcaWalletSummary | null
  onClose: () => void
  onJumpTo: (txKey: string) => void
  targetIsFiltered: boolean
  onShowInTable: () => void
}

export function OrcaLedgerDrawer({ row, pairedRow, walletSummary, onClose, onJumpTo, targetIsFiltered, onShowInTable }: Props) {
  const previousRowKey = useRef<string | null>(null)
  const [isFlashing, setIsFlashing] = useState(false)

  useEffect(() => {
    if (!row) {
      previousRowKey.current = null
      setIsFlashing(false)
      return
    }
    const key = `${row.txHash}::${row.walletAddr}::${row.dir}`
    if (previousRowKey.current !== null && previousRowKey.current !== key) {
      // Drawer was already open with a different row — flash to signal update.
      setIsFlashing(false) // reset to allow re-trigger
      requestAnimationFrame(() => setIsFlashing(true))
    }
    previousRowKey.current = key
  }, [row])

  useEffect(() => {
    if (!isFlashing) return
    const id = setTimeout(() => setIsFlashing(false), 1200)
    return () => clearTimeout(id)
  }, [isFlashing])

  useEffect(() => {
    if (!row) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [row, onClose])

  if (!row) return null

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 9998 }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(480px, 100vw)', background: 'var(--surface)', borderLeft: '1px solid var(--border)', overflowY: 'auto', zIndex: 9999, padding: 24, fontFamily: 'var(--sans)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', color: 'var(--muted)', fontSize: '1.2rem', cursor: 'pointer' }}>×</button>

        <header className={isFlashing ? 'drawer-header-flash' : undefined} style={{ marginBottom: 20 }}>
          <HeaderContent row={row} />
        </header>

        {targetIsFiltered && (
          <div style={{
            background: 'var(--surface2)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            padding: '8px 12px',
            marginBottom: 16,
            fontSize: '0.78rem',
            color: 'var(--muted)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}>
            <span>Source row is hidden by current table filters.</span>
            <button
              onClick={onShowInTable}
              style={{
                background: 'var(--accent-bg)',
                color: 'var(--accent)',
                border: `1px solid color-mix(in srgb, var(--accent) 25%, transparent)`,
                borderRadius: 4,
                padding: '4px 10px',
                fontSize: '0.72rem',
                fontWeight: 600,
                fontFamily: 'var(--mono)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >Show in table</button>
          </div>
        )}

        {row.internal && pairedRow ? (
          <InternalPair primary={row} paired={pairedRow} onJumpTo={onJumpTo} />
        ) : row.dir === 'In' ? (
          <InRowContent row={row} onJumpTo={onJumpTo} />
        ) : (
          <OutRowContent row={row} onJumpTo={onJumpTo} />
        )}

        {walletSummary && (
          <section style={{ marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <h3 style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 8 }}>After this transaction</h3>
            <div style={{ fontSize: '0.78rem' }}>
              <div>Wallet balance: <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{fmtNum(row.balanceAfter, 4)} ORCA</span></div>
              <div>Open lots: <span style={{ fontFamily: 'var(--mono)' }}>{walletSummary.remainingLots.length}</span></div>
              <div>Lifetime realized G/L: <span style={{ fontFamily: 'var(--mono)', color: walletSummary.lifetimeRealizedGain >= 0 ? 'var(--green)' : 'var(--red)' }}>{walletSummary.lifetimeRealizedGain >= 0 ? '+' : ''}{fmtUSD(walletSummary.lifetimeRealizedGain)}</span></div>
            </div>
          </section>
        )}
      </aside>
    </>
  )
}

function HeaderContent({ row }: { row: OrcaLedgerRow }) {
  const isGenesis = row.priceSource === 'genesis'
  const dirSymbol = row.dir === 'In' ? '↑' : '↓'
  const dirLabel = row.internal ? `Internal ${row.dir}` : isGenesis ? 'Genesis Mint' : `External ${row.dir}`
  return (
    <>
      <h2 style={{ fontSize: '1rem', marginBottom: 4 }}>
        <span style={{ color: row.dir === 'In' ? 'var(--green)' : 'var(--red)' }}>{dirSymbol}</span>{' '}
        {dirLabel} · {fmtNum(row.qty, 4)} ORCA
      </h2>
      <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>
        {new Date(row.date).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })} UTC
      </div>
      <div style={{ fontSize: '0.78rem', marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
        <strong>{row.wallet}</strong>
        <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{fmtAddr(row.walletAddr, 6)}</span>
        <CopyButton address={row.walletAddr} />
      </div>
      {(() => {
        const addr = row.counterparty ?? row.internalPairedWalletAddr
        const label = row.counterpartyLabel ?? row.internalPairedWalletLabel
        if (!addr) return null
        return (
          <div style={{ fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>Counterparty:</span>
            {label && <span>{label}</span>}
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{fmtAddr(addr, 6)}</span>
            <CopyButton address={addr} />
          </div>
        )
      })()}
      <div style={{ fontSize: '0.78rem' }}>
        Tx: {isGenesis
          ? <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted2)' }}>{row.txHash}</span>
          : <a href={`https://solscan.io/tx/${row.txHash}`} target="_blank" rel="noreferrer" style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>{row.txHash.slice(0, 8)}…{row.txHash.slice(-4)}</a>}
      </div>
    </>
  )
}

function InRowContent({ row, onJumpTo }: { row: OrcaLedgerRow; onJumpTo: (k: string) => void }) {
  return (
    <section>
      <h3 style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 8 }}>Lot created</h3>
      {row.lots.length === 0 ? <div style={{ color: 'var(--muted)' }}>No lot info</div> : row.lots.map((l, i) => (
        <LotRow key={i} l={l} onJumpTo={onJumpTo} />
      ))}
    </section>
  )
}

function OutRowContent({ row, onJumpTo }: { row: OrcaLedgerRow; onJumpTo: (k: string) => void }) {
  if (row.noBasis) {
    return (
      <section style={{ background: 'rgba(255, 70, 70, 0.08)', border: '1px solid rgba(255, 70, 70, 0.3)', padding: 12, borderRadius: 6 }}>
        <div style={{ color: 'var(--red)', fontWeight: 600, marginBottom: 4 }}>⚠ No cost basis</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--muted)' }}>This wallet had no acquisition lots at this date. The disposal is recorded but realized gain cannot be computed. Likely cause: missing genesis/seed lot.</div>
      </section>
    )
  }
  const totalQty = row.lots.reduce((s, l) => s + l.qty, 0)
  const totalCost = row.lots.reduce((s, l) => s + l.qty * l.costPerUnit, 0)
  const proceeds = (row.price ?? 0) * totalQty
  return (
    <section>
      <h3 style={{ fontSize: '0.85rem', color: 'var(--muted)', marginBottom: 8 }}>Lots consumed (FIFO)</h3>
      {row.lots.map((l, i) => <LotRow key={i} l={l} onJumpTo={onJumpTo} showJump showGain />)}
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontSize: '0.78rem' }}>
        <div>Total: <span style={{ fontFamily: 'var(--mono)' }}>{fmtNum(totalQty, 4)} ORCA</span> · Cost: <span style={{ fontFamily: 'var(--mono)' }}>{fmtUSD(totalCost)}</span></div>
        <div>Proceeds: <span style={{ fontFamily: 'var(--mono)' }}>{fmtUSD(proceeds)}</span> · Realized: <span style={{ fontFamily: 'var(--mono)', color: row.realizedGain >= 0 ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>{row.realizedGain >= 0 ? '+' : ''}{fmtUSD(row.realizedGain)} {row.realizedTerm ? `(${row.realizedTerm.toUpperCase()})` : ''}</span></div>
      </div>
    </section>
  )
}

function InternalPair({ primary, paired, onJumpTo }: { primary: OrcaLedgerRow; paired: OrcaLedgerRow; onJumpTo: (k: string) => void }) {
  const out = primary.dir === 'Out' ? primary : paired
  const inn = primary.dir === 'In' ? primary : paired
  return (
    <section>
      <h3 style={{ fontSize: '0.85rem', color: '#6af', marginBottom: 8 }}>Internal transfer · same entity</h3>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>↓ Out from {out.wallet}</div>
        {out.lots.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: '0.78rem' }}>(basis moved to receiver — no realization)</div> : out.lots.map((l, i) => <LotRow key={i} l={l} onJumpTo={onJumpTo} />)}
      </div>
      <div>
        <div style={{ fontSize: '0.78rem', fontWeight: 600 }}>↑ In to {inn.wallet}</div>
        {inn.lots.map((l, i) => <LotRow key={i} l={l} onJumpTo={onJumpTo} showJump />)}
      </div>
    </section>
  )
}

function LotRow({ l, onJumpTo, showJump = false, showGain = false }: { l: LotTraceEntry; onJumpTo: (k: string) => void; showJump?: boolean; showGain?: boolean }) {
  const targetKey = `${l.acqTxHash}::${l.acqWalletAddr}::In`
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border)', fontSize: '0.78rem' }}>
      <div>
        <div>{new Date(l.acqDate).toLocaleDateString('en-US', { dateStyle: 'medium', timeZone: 'UTC' })}</div>
        <div style={{ color: 'var(--muted)', fontSize: '0.7rem' }}>{l.daysHeld}d · {l.term}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontFamily: 'var(--mono)' }}>{fmtNum(l.qty, 4)} @ ${l.costPerUnit.toFixed(4)}</div>
        {showGain && <div style={{ fontFamily: 'var(--mono)', color: l.gain >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.7rem' }}>{l.gain >= 0 ? '+' : ''}{fmtUSD(l.gain)}</div>}
        {showJump && (
          <button onClick={() => onJumpTo(targetKey)} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '0.65rem', cursor: 'pointer', padding: 0 }}>↗︎ jump to source</button>
        )}
      </div>
    </div>
  )
}
