import { areaStyle, type Level } from '../lib/landslide'

// One level's sample: the same fill and outline the map draws (hex colour plus an alpha pair)
export default function LevelSwatch({ level }: { level: Level }) {
  const style = areaStyle(level)
  return (
    <span
      className="inline-block h-3.5 w-5 shrink-0 rounded-sm"
      style={{
        backgroundColor: `${style.fillColor}${Math.round(style.fillOpacity * 255).toString(16).padStart(2, '0')}`,
        border: `${Math.min(style.weight, 3)}px ${style.dashArray ? 'dashed' : 'solid'} ${style.color}`,
      }}
      aria-hidden="true"
    />
  )
}
