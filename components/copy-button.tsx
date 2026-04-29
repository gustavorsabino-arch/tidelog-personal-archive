'use client'
import { useState } from 'react'

/**
 * Compact copy-to-clipboard icon button with an instant hover tooltip.
 *
 * Use inline next to a label/address. The tooltip shows the address that
 * will be copied; on success the icon flips to a green ✓ for ~1.2s and the
 * tooltip swaps to "Copied!" while still hovered.
 */
export function CopyButton({
  address,
  style,
}: {
  address: string
  style?: React.CSSProperties
}) {
  const [copied, setCopied] = useState(false)
  const [hovered, setHovered] = useState(false)
  const copy = async () => {
    await navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        type="button"
        onClick={copy}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={copied ? 'Copied' : `Copy ${address}`}
        style={{
          background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          color: copied ? 'var(--green)' : 'var(--muted)',
          fontSize: '0.72rem', lineHeight: 1, flexShrink: 0,
          ...style,
        }}
      >
        {copied ? '✓' : '⧉'}
      </button>
      {hovered && (
        <span
          role="tooltip"
          style={{
            position: 'absolute', bottom: '100%', left: '50%',
            transform: 'translateX(-50%)', marginBottom: 4,
            padding: '4px 8px',
            background: 'var(--surface2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 4,
            fontSize: '0.65rem', fontFamily: 'var(--mono)',
            whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 100,
          }}
        >
          {copied ? 'Copied!' : address}
        </span>
      )}
    </span>
  )
}
