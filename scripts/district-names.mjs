// Writes src/data/areas/district-names.json: each district's name in English, Sinhala and Tamil, read
// from districts.json. The landslide card names the district, and importing districts.json for that
// would put 47 KB of boundary lines (gzipped) in the part that loads with the areas. Run it after
// `npm run areas`; a test checks the two files agree, so one can't be updated without the other.
//   npm run areas:names

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FROM = join(ROOT, 'src', 'data', 'areas', 'districts.json')
const TO = join(ROOT, 'src', 'data', 'areas', 'district-names.json')

// { LK11: { en, si, ta }, ... } in the order of the boundary file
export function districtNamesOf(districts) {
  const out = {}
  for (const feature of districts.features) {
    const { code, en, si, ta } = feature.properties
    out[code] = { en, si, ta }
  }
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const names = districtNamesOf(JSON.parse(readFileSync(FROM, 'utf8')))
  writeFileSync(TO, JSON.stringify(names, null, 1) + '\n')
  console.log(`wrote ${Object.keys(names).length} districts to ${TO}`)
}
