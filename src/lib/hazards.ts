import {
  CarFront,
  CircleQuestionMark,
  Construction,
  Megaphone,
  Mountain,
  OctagonX,
  PawPrint,
  TreeDeciduous,
  TriangleAlert,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react'

// The values must match the check constraints in the reports table
export const HAZARD_TYPES = [
  { value: 'flood', label: 'Flood', icon: Waves },
  { value: 'landslide', label: 'Landslide', icon: Mountain },
  { value: 'fallen_tree', label: 'Fallen tree', icon: TreeDeciduous },
  { value: 'fallen_power_line', label: 'Fallen power line', icon: Zap },
  { value: 'road_closed', label: 'Road closed', icon: OctagonX },
  { value: 'accident', label: 'Accident', icon: CarFront },
  { value: 'road_works', label: 'Road works', icon: Construction },
  { value: 'damaged_road_or_bridge', label: 'Damaged road or bridge', icon: TriangleAlert },
  { value: 'wild_elephant', label: 'Wild elephant', icon: PawPrint },
  { value: 'protest_or_road_block', label: 'Protest or road block', icon: Megaphone },
  { value: 'other', label: 'Other', icon: CircleQuestionMark },
] as const satisfies readonly { value: string; label: string; icon: LucideIcon }[]

export const SEVERITIES = [
  { value: 'passable', label: 'Passable' },
  { value: 'large_vehicles_only', label: 'Large vehicles only' },
  { value: 'blocked', label: 'Blocked' },
] as const

export type HazardType = (typeof HAZARD_TYPES)[number]['value']
export type Severity = (typeof SEVERITIES)[number]['value']

export function hazardLabel(value: HazardType): string {
  return HAZARD_TYPES.find((h) => h.value === value)?.label ?? value
}

export function severityLabel(value: Severity): string {
  return SEVERITIES.find((s) => s.value === value)?.label ?? value
}
