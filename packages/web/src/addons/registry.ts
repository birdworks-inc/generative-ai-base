import { ReactNode, LazyExoticComponent, ComponentType } from 'react'

export interface AddonDefinition {
  id: string
  label: string
  to: string
  icon: ReactNode
  display: 'usecase' | 'tool' | 'none'
  component: LazyExoticComponent<ComponentType>
}

export const addonRegistry: AddonDefinition[] = []
