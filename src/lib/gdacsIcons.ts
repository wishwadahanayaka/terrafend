import { Activity, Flame, Mountain, Sun, Tornado, Waves, type LucideIcon } from 'lucide-react'
import type { GdacsType } from './gdacs'

// One icon for each kind of event
export const GDACS_ICON: Record<GdacsType, LucideIcon> = {
  TC: Tornado,
  EQ: Activity,
  FL: Waves,
  VO: Mountain,
  DR: Sun,
  WF: Flame,
}
