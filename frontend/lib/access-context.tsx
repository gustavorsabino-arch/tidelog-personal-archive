'use client'

import { createContext, useContext } from 'react'

import { useAccess } from '@/hooks/use-access'

type SharedAccessValue = ReturnType<typeof useAccess>

const AccessContext = createContext<SharedAccessValue | null>(null)

export function AccessProvider({ children }: { children: React.ReactNode }) {
  const value = useAccess()
  return (
    <AccessContext.Provider value={value}>
      {children}
    </AccessContext.Provider>
  )
}

export function useSharedAccess(): SharedAccessValue {
  const value = useContext(AccessContext)
  if (!value) {
    throw new Error('useSharedAccess must be used within an AccessProvider.')
  }

  return value
}
