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
import { t } from '../i18n'

// The values must match the check constraints in the reports table. Their names come from
// the translation files (hazard.<value>), and the database values never change with language.
export const HAZARD_TYPES = [
  { value: 'flood', icon: Waves },
  { value: 'landslide', icon: Mountain },
  { value: 'fallen_tree', icon: TreeDeciduous },
  { value: 'fallen_power_line', icon: Zap },
  { value: 'road_closed', icon: OctagonX },
  { value: 'accident', icon: CarFront },
  { value: 'road_works', icon: Construction },
  { value: 'damaged_road_or_bridge', icon: TriangleAlert },
  { value: 'wild_elephant', icon: PawPrint },
  { value: 'protest_or_road_block', icon: Megaphone },
  { value: 'other', icon: CircleQuestionMark },
] as const satisfies readonly { value: string; icon: LucideIcon }[]

// Class names are written out in full so Tailwind can find them
export const SEVERITIES = [
  { value: 'passable', bg: 'bg-green-600' },
  { value: 'large_vehicles_only', bg: 'bg-amber-600' },
  { value: 'blocked', bg: 'bg-red-600' },
] as const

export type HazardType = (typeof HAZARD_TYPES)[number]['value']
export type Severity = (typeof SEVERITIES)[number]['value']

export function hazardLabel(value: HazardType): string {
  return t(`hazard.${value}`)
}

export function hazardIcon(value: HazardType): LucideIcon {
  return HAZARD_TYPES.find((h) => h.value === value)?.icon ?? CircleQuestionMark
}

export function severityLabel(value: Severity): string {
  return t(`severity.${value}`)
}

// Roads that are blocked, or open to large vehicles only. These always show on the map;
// passable reports only show when the Reports layer is switched on.
export function isSerious(value: Severity): boolean {
  return value !== 'passable'
}

// True when the Reports layer settings alone would keep a report of this severity off the map
export function hiddenByLayers(severity: Severity, showPassable: boolean): boolean {
  return !showPassable && !isSerious(severity)
}

// What the map draws from the loaded reports. Serious ones always show, passable ones need the
// Reports layer, and a person's own reports always show, so a report just sent never seems lost.
export function isShownOnMap(
  report: { id: string; severity: Severity },
  showPassable: boolean,
  mine: { has(id: string): boolean },
): boolean {
  return !hiddenByLayers(report.severity, showPassable) || mine.has(report.id)
}

export function severityBg(value: Severity): string {
  return SEVERITIES.find((s) => s.value === value)?.bg ?? 'bg-slate-600'
}
