'use client'
import { useState, useMemo } from 'react'

type Column<T> = {
  key: string
  label: string
  render: (row: T) => React.ReactNode
  sortable?: boolean
  numeric?: boolean
  width?: string
}

type Props<T> = {
  data: T[]
  columns: Column<T>[]
  defaultSort?: { col: string; dir: 'asc' | 'desc' }
  maxHeight?: string
}

export function DataTable<T extends Record<string, unknown>>({ data, columns, defaultSort, maxHeight = '600px' }: Props<T>) {
  const [sort, setSort] = useState(defaultSort || { col: '', dir: 'desc' as const })

  const sorted = useMemo(() => {
    if (!sort.col) return data
    return [...data].sort((a, b) => {
      const av = a[sort.col]
      const bv = b[sort.col]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv))
      return sort.dir === 'asc' ? cmp : -cmp
    })
  }, [data, sort])

  function toggleSort(col: string) {
    setSort(prev =>
      prev.col === col
        ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { col, dir: 'desc' }
    )
  }

  return (
    <div className="table-wrap" style={{ maxHeight, overflow: 'auto' }}>
      <table>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                className={[
                  col.numeric ? 'num' : '',
                  col.sortable !== false ? (sort.col === col.key ? `sort-${sort.dir}` : '') : 'no-sort',
                ].filter(Boolean).join(' ')}
                style={col.width ? { width: col.width } : undefined}
                onClick={() => col.sortable !== false && toggleSort(col.key)}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length} style={{ padding: 32, textAlign: 'center', color: 'var(--muted)', fontFamily: 'var(--sans)', fontSize: '0.82rem' }}>
                No data matches the current filters.
              </td>
            </tr>
          ) : (
            sorted.map((row, i) => (
              <tr key={i}>
                {columns.map(col => (
                  <td key={col.key} className={col.numeric ? 'num' : ''}>
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}
