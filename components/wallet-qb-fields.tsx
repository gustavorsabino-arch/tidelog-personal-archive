'use client'
import { CatalogCombobox } from '@/components/catalog-combobox'
import { useAllQbVendors } from '@/lib/hooks/use-qb-vendors'
import { useAllQbClasses } from '@/lib/hooks/use-qb-classes'

type Props = {
  vendorName: string | null
  qbClassName: string | null
  onVendorChange: (next: string | null) => void
  onClassChange: (next: string | null) => void
  disabled?: boolean
}

export function WalletQbFields({ vendorName, qbClassName, onVendorChange, onClassChange, disabled }: Props) {
  const { vendors, isLoading: vLoading, refresh: vRefresh, refreshing: vRefreshing } = useAllQbVendors()
  const { classes, isLoading: cLoading, refresh: cRefresh, refreshing: cRefreshing } = useAllQbClasses()
  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <span className="budget-scope-label" style={{ display: 'block', marginBottom: 6 }}>
          Vendor <span style={{ color: 'var(--muted)', fontWeight: 400 }}>(optional)</span>
        </span>
        <CatalogCombobox
          value={vendorName}
          options={vendors.map((v) => ({ value: v.displayName, label: v.displayName }))}
          isLoading={vLoading}
          refreshing={vRefreshing}
          onRefresh={vRefresh}
          disabled={disabled}
          placeholder="— vendor"
          onChange={onVendorChange}
        />
      </div>
      <div style={{ marginBottom: 12 }}>
        <span className="budget-scope-label" style={{ display: 'block', marginBottom: 6 }}>Class</span>
        <CatalogCombobox
          value={qbClassName}
          options={classes.map((c) => ({ value: c.qbClassName, label: c.qbClassName }))}
          isLoading={cLoading}
          refreshing={cRefreshing}
          onRefresh={cRefresh}
          disabled={disabled}
          placeholder="— class"
          onChange={onClassChange}
        />
      </div>
    </>
  )
}
