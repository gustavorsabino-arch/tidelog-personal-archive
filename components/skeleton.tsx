import type { CSSProperties } from 'react'

type SkeletonProps = {
  width?: number | string
  height?: number | string
  radius?: number | string
  style?: CSSProperties
}

export function Skeleton({ width = '100%', height = 16, radius = 4, style }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className="skeleton"
      style={{
        display: 'inline-block',
        width,
        height,
        borderRadius: radius,
        ...style,
      }}
    />
  )
}
