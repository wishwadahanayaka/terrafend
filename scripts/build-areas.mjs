// Builds the DS division and district boundary files from the Survey Department of Sri Lanka's
// boundaries, published by OCHA on the Humanitarian Data Exchange (HDX, dataset "cod-ab-lka",
// licence CC BY-IGO). Run it with `npm run areas` when HDX publishes a new version.
//
// What it does:
//   1. asks HDX's API for the dataset and downloads the GeoJSON zip (about 130 MB, kept in
//      .cache/areas/ so a rerun doesn't download it again)
//   2. takes the DS division layer (admin level 3) out of the zip
//   3. simplifies it with mapshaper (run through npx at a fixed version, so it isn't a project
//      dependency), which keeps neighbouring divisions joined, and dissolves it into districts
//   4. applies the name fixes below, checks the result, and writes
//        src/data/areas/ds.json and src/data/areas/districts.json   (for the app)
//        supabase/functions/landslide-refresh/ds-names.json        (names only, for the function)
//
// Nothing here is edited by hand afterwards: a problem in the source is fixed in NAME_FIXES.

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, inflateRawSync } from 'node:zlib'
import { COMPLETE_AT_LIMIT, CUT_OFF, LIMIT_BYTES, MISENCODED, NAME_NOTES } from './area-name-fixes.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.cache', 'areas')
const APP_OUT = join(ROOT, 'src', 'data', 'areas')
const FUNCTION_OUT = join(ROOT, 'supabase', 'functions', 'landslide-refresh', 'ds-names.json')

const HDX_DATASET = 'cod-ab-lka'
const HDX_API = `https://data.humdata.org/api/3/action/package_show?id=${HDX_DATASET}`
// An exact version, so the same input gives the same files whenever this is run. To upgrade, change it
// here, run `npm run areas` and look at the diff of src/data/areas/ (the version is in each file's meta).
const MAPSHAPER = 'mapshaper@0.7.100'
// How far a simplified border may stray from the real one. The areas are drawn as "somewhere in this
// division", so about 200 m is plenty, and it keeps the DS file near 100 KB gzipped.
const SIMPLIFY_METRES = 200
// About 11 m: finer than the simplification, so it costs nothing in accuracy
const PRECISION = 0.0001

export const LICENCE = 'CC BY-IGO 3.0'
export const ATTRIBUTION =
  'Administrative boundaries: Survey Department of Sri Lanka, via OCHA (Humanitarian Data Exchange), CC BY-IGO 3.0. Simplified, with name fixes, by TerraFend.'

// ---- Fixes to the source names (the lists are in area-name-fixes.mjs) ----

// "district" in Sinhala (දිස්ත්‍රික්කය) and Tamil (மாவட்டம்), as far as the cut-off names still have it
const DISTRICT_WORD_SI = 'දිස්'
const DISTRICT_WORD_TA = 'மாவ'

const cutOff = new Map(CUT_OFF.map(([code, lang, from, to]) => [`${code}:${lang}`, { from, to }]))
const completeAtLimit = new Set(COMPLETE_AT_LIMIT.map(([code, lang]) => `${code}:${lang}`))
const bytes = (s) => Buffer.byteLength(s, 'utf8')

// Each fix says what is wrong. apply() returns how many names it changed; one that changes nothing
// is reported, so it can be removed once HDX corrects the source.
export const NAME_FIXES = [
  {
    what: 'District names in Sinhala and Tamil end in the word "district", cut off part-way by the 50-byte field ("ගම්පහ දිස්ත්‍රික්", "ත්‍රිකුණාමළය දිස්", "களுத்துறை மாவட்டம"). The word is removed; the app adds its own.',
    apply(area) {
      if (area.level !== 'district') return 0
      const si = area.si.split(' ' + DISTRICT_WORD_SI)[0].trim()
      const ta = area.ta.split(' ' + DISTRICT_WORD_TA)[0].trim()
      const changed = (si !== area.si) + (ta !== area.ta)
      area.si = si
      area.ta = ta
      return changed
    },
  },
  {
    what: `Kalutara is written ${MISENCODED.map(([from]) => from).join(', ')} in Sinhala: a legacy-font conversion error (ඵ in place of ළු). It is ${MISENCODED.map(([, to]) => to).join(', ')}.`,
    apply(area) {
      let changed = 0
      for (const [from, to] of MISENCODED) {
        if (area.si.includes(from)) {
          area.si = area.si.replace(from, to)
          changed++
        }
      }
      return changed
    },
  },
  {
    what: `${CUT_OFF.length} DS division names in Sinhala and Tamil are cut off mid-word by the 50-byte field ("ශ්‍රී ජයවර්ධනපුර ක", "புதுக்குடியிருப்"). They are completed from a list (AI-written, NEEDS REVIEW BY A NATIVE SPEAKER).`,
    apply(area) {
      if (area.level !== 'ds') return 0
      let changed = 0
      for (const lang of ['si', 'ta']) {
        const fix = cutOff.get(`${area.code}:${lang}`)
        if (fix && area[lang] === fix.from) {
          area[lang] = fix.to
          changed++
        }
      }
      return changed
    },
  },
]

// DS names at the byte limit that are neither completed nor checked as whole. Run on the source names,
// before any fix.
export function unexplainedAtLimit(divisions) {
  const found = []
  for (const d of divisions) {
    for (const lang of ['si', 'ta']) {
      const key = `${d.code}:${lang}`
      if (bytes(d[lang]) < LIMIT_BYTES) continue
      if (cutOff.get(key)?.from === d[lang] || completeAtLimit.has(key)) continue
      found.push(`${d.code} ${lang} "${d[lang]}" (${d.en}) is at the 50-byte limit: complete it in CUT_OFF or list it in COMPLETE_AT_LIMIT`)
    }
  }
  return found
}

// ---- Download ----

async function datasetInfo() {
  const res = await fetch(HDX_API, { headers: { 'User-Agent': 'TerraFend build-areas script' } })
  if (!res.ok) throw new Error(`HDX API answered ${res.status}`)
  const { result } = await res.json()
  const resource = result.resources.find((r) => /geojson/i.test(r.format) && /\.zip$/i.test(r.name))
  if (!resource) throw new Error('HDX dataset has no GeoJSON zip')
  return {
    title: result.title,
    licence: result.license_title,
    licenceId: result.license_id,
    source: result.dataset_source,
    datasetModified: result.last_modified,
    resource: { name: resource.name, url: resource.url, modified: resource.last_modified ?? resource.metadata_modified, size: resource.size },
  }
}

async function download(info) {
  mkdirSync(CACHE, { recursive: true })
  const stamp = String(info.resource.modified ?? info.datasetModified).replace(/[^0-9]/g, '').slice(0, 14)
  const file = join(CACHE, `${stamp}-${info.resource.name}`)
  if (existsSync(file)) {
    console.log(`Using the cached ${file}`)
    return file
  }
  console.log(`Downloading ${info.resource.url} (${Math.round(info.resource.size / 1e6)} MB)...`)
  const res = await fetch(info.resource.url, { headers: { 'User-Agent': 'TerraFend build-areas script' } })
  if (!res.ok) throw new Error(`Download answered ${res.status}`)
  writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  return file
}

// ---- A small zip reader (just enough for this one file: no encryption, deflate or stored) ----

export function zipEntries(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70_000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('not a zip file')
  let count = buf.readUInt16LE(eocd + 10)
  let dirOffset = buf.readUInt32LE(eocd + 16)
  // ZIP64: the real numbers are in the ZIP64 end record
  if (dirOffset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20
    if (buf.readUInt32LE(locator) !== 0x07064b50) throw new Error('ZIP64 locator missing')
    const record = Number(buf.readBigUInt64LE(locator + 8))
    count = Number(buf.readBigUInt64LE(record + 32))
    dirOffset = Number(buf.readBigUInt64LE(record + 48))
  }
  const entries = []
  let p = dirOffset
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory')
    const method = buf.readUInt16LE(p + 10)
    let compressed = buf.readUInt32LE(p + 20)
    let size = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    let local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    // ZIP64 sizes and offset live in the extra field
    let e = p + 46 + nameLen
    const end = e + extraLen
    while (e < end) {
      const id = buf.readUInt16LE(e)
      const len = buf.readUInt16LE(e + 2)
      if (id === 0x0001) {
        let q = e + 4
        if (size === 0xffffffff) {
          size = Number(buf.readBigUInt64LE(q))
          q += 8
        }
        if (compressed === 0xffffffff) {
          compressed = Number(buf.readBigUInt64LE(q))
          q += 8
        }
        if (local === 0xffffffff) local = Number(buf.readBigUInt64LE(q))
      }
      e += 4 + len
    }
    entries.push({ name, method, compressed, size, local })
    p += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

export function zipRead(buf, entry) {
  if (buf.readUInt32LE(entry.local) !== 0x04034b50) throw new Error(`bad local header for ${entry.name}`)
  const start = entry.local + 30 + buf.readUInt16LE(entry.local + 26) + buf.readUInt16LE(entry.local + 28)
  const data = buf.subarray(start, start + entry.compressed)
  if (entry.method === 0) return data
  if (entry.method === 8) return inflateRawSync(data)
  throw new Error(`${entry.name}: compression method ${entry.method} is not supported`)
}

// ---- Simplifying ----

// mapshaper is run in the cache folder with plain file names, so the spaces in the project's path
// never reach the shell
function mapshaper(args) {
  execSync(`npx --yes ${MAPSHAPER} ${args.join(' ')}`, { cwd: CACHE, stdio: ['ignore', 'inherit', 'inherit'] })
}

const FIELDS = 'adm3_pcode,adm3_name,adm3_name1,adm3_name2,adm2_pcode,adm2_name,adm2_name1,adm2_name2'

function simplify(admin3) {
  writeFileSync(join(CACHE, 'admin3.geojson'), admin3)
  mapshaper(['-i', 'admin3.geojson', '-filter-fields', FIELDS, '-simplify', `interval=${SIMPLIFY_METRES}`, 'keep-shapes', '-o', 'ds.geojson', `precision=${PRECISION}`])
  // Dissolving the already simplified divisions keeps district borders exactly on division borders
  mapshaper(['-i', 'ds.geojson', '-dissolve', 'adm2_pcode', 'copy-fields=adm2_name,adm2_name1,adm2_name2', '-o', 'districts.geojson', `precision=${PRECISION}`])
  return {
    ds: JSON.parse(readFileSync(join(CACHE, 'ds.geojson'), 'utf8')),
    districts: JSON.parse(readFileSync(join(CACHE, 'districts.geojson'), 'utf8')),
  }
}

// ---- Names and checks ----

const nfc = (s) => String(s ?? '').normalize('NFC').trim()

export function areaOf(feature, level) {
  const p = feature.properties
  return level === 'ds'
    ? { level, code: p.adm3_pcode, district: p.adm2_pcode, en: nfc(p.adm3_name), si: nfc(p.adm3_name1), ta: nfc(p.adm3_name2) }
    : { level, code: p.adm2_pcode, en: nfc(p.adm2_name), si: nfc(p.adm2_name1), ta: nfc(p.adm2_name2) }
}

export function applyFixes(areas) {
  const used = NAME_FIXES.map(() => 0)
  for (const area of areas) NAME_FIXES.forEach((fix, i) => (used[i] += fix.apply(area)))
  return used
}

const SINHALA = /[඀-෿]/u
const TAMIL = /[஀-௿]/u
const LATIN_NAME = /^[A-Za-z0-9 .()'&/-]+$/
const IN_SRI_LANKA = ([x, y]) => x >= 79.4 && x <= 82.1 && y >= 5.7 && y <= 10.0

// Every problem found, as text. Empty means the files can be written.
export function problems(divisions, districts, features) {
  const found = []
  const districtCodes = new Set(districts.map((d) => d.code))
  if (districts.length !== 25) found.push(`expected 25 districts, got ${districts.length}`)
  if (divisions.length < 330) found.push(`expected at least 330 DS divisions, got ${divisions.length}`)
  for (const [list, pattern] of [
    [divisions, /^LK\d{4}$/],
    [districts, /^LK\d{2}$/],
  ]) {
    const codes = list.map((a) => a.code)
    if (new Set(codes).size !== codes.length) found.push('a p-code appears twice')
    for (const a of list) {
      if (!pattern.test(a.code)) found.push(`odd p-code ${a.code}`)
      if (!LATIN_NAME.test(a.en)) found.push(`${a.code}: English name "${a.en}"`)
      if (!SINHALA.test(a.si) || /[A-Za-z]/.test(a.si)) found.push(`${a.code}: Sinhala name "${a.si}"`)
      if (!TAMIL.test(a.ta) || /[A-Za-z]/.test(a.ta)) found.push(`${a.code}: Tamil name "${a.ta}"`)
      if (a.si.includes('ඵ')) found.push(`${a.code}: Sinhala name "${a.si}" has ඵ, often a legacy-font error`)
      // Districts only: Tamil DS names such as மாவனல்லை (Mawanella) start with the same letters
      if (a.level === 'district' && (a.si.includes(DISTRICT_WORD_SI) || a.ta.includes(DISTRICT_WORD_TA))) {
        found.push(`${a.code}: name still has the word "district"`)
      }
    }
  }
  for (const d of divisions) if (!districtCodes.has(d.district)) found.push(`${d.code}: district ${d.district} unknown`)
  // English DS names must be unique within a district, or the landslide names can't be matched
  const seen = new Set()
  for (const d of divisions) {
    const key = `${d.district}:${d.en.toLowerCase()}`
    if (seen.has(key)) found.push(`${d.code}: "${d.en}" twice in ${d.district}`)
    seen.add(key)
  }
  for (const f of features) {
    const g = f.geometry
    const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : null
    if (!polygons || polygons.length === 0) {
      found.push(`${f.properties.code}: no polygon`)
      continue
    }
    for (const ring of polygons.flat()) {
      if (ring.length < 4) found.push(`${f.properties.code}: a ring with ${ring.length} points`)
      if (!ring.every(IN_SRI_LANKA)) found.push(`${f.properties.code}: a point outside Sri Lanka`)
    }
  }
  return found
}

// ---- Writing ----

function meta(info, level) {
  return {
    title: level === 'ds' ? 'Sri Lanka: Divisional Secretariat (DS) divisions' : 'Sri Lanka: districts',
    source: 'Survey Department of Sri Lanka, via OCHA (Humanitarian Data Exchange)',
    dataset: `https://data.humdata.org/dataset/${HDX_DATASET}`,
    licence: LICENCE,
    licenceUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
    attribution: ATTRIBUTION,
    sourceModified: info.datasetModified,
    changes: [`simplified to about ${SIMPLIFY_METRES} m with ${MAPSHAPER}`, `coordinates rounded to ${PRECISION} degrees`, ...NAME_FIXES.map((f) => f.what)],
    notes: NAME_NOTES,
    builtBy: 'scripts/build-areas.mjs (npm run areas). Do not edit by hand.',
  }
}

// One feature per line, so a rebuild shows up as a readable diff
function geojsonText(metaInfo, features) {
  const head = JSON.stringify({ type: 'FeatureCollection', meta: metaInfo }, null, 2).replace(/\n}$/, ',\n  "features": [\n')
  return head + features.map((f) => '    ' + JSON.stringify(f)).join(',\n') + '\n  ]\n}\n'
}

const byCode = (a, b) => a.code.localeCompare(b.code)
const feature = (area, geometry) => ({
  type: 'Feature',
  properties: area.level === 'ds' ? { code: area.code, district: area.district, en: area.en, si: area.si, ta: area.ta } : { code: area.code, en: area.en, si: area.si, ta: area.ta },
  geometry,
})

function sizes(file) {
  const raw = readFileSync(file)
  return `${Math.round(raw.length / 1024)} KB, ${Math.round(gzipSync(raw, { level: 9 }).length / 1024)} KB gzipped`
}

async function main() {
  const info = await datasetInfo()
  console.log(`${info.title}: ${info.licence} (${info.licenceId}), source ${info.source}, modified ${info.datasetModified}`)
  if (info.licenceId !== 'cc-by-igo') throw new Error(`The licence changed to ${info.licenceId}: check it before using the new data`)
  const zip = readFileSync(await download(info))
  const entries = zipEntries(zip)
  const admin3 = entries.find((e) => /admin3\.geojson$/i.test(e.name))
  if (!admin3) throw new Error(`No admin3 layer in the zip: ${entries.map((e) => e.name).join(', ')}`)

  const { ds, districts } = simplify(zipRead(zip, admin3))
  const divisionAreas = ds.features.map((f) => areaOf(f, 'ds'))
  const districtAreas = districts.features.map((f) => areaOf(f, 'district'))
  const unexplained = unexplainedAtLimit(divisionAreas)
  if (unexplained.length) throw new Error(`Not written, names may be cut off:\n  ${unexplained.join('\n  ')}`)
  const used = applyFixes([...divisionAreas, ...districtAreas])
  NAME_FIXES.forEach((fix, i) => console.log(`Fix used ${used[i]} times: ${fix.what.slice(0, 80)}...`))
  const unused = NAME_FIXES.filter((_, i) => used[i] === 0)
  if (unused.length) console.warn(`These fixes changed nothing (has HDX fixed the source?):\n  ${unused.map((f) => f.what).join('\n  ')}`)
  if (used[2] !== CUT_OFF.length) console.warn(`Only ${used[2]} of the ${CUT_OFF.length} cut-off names were found as listed: some may be fixed in the source now`)

  const dsFeatures = ds.features.map((f, i) => feature(divisionAreas[i], f.geometry)).sort((a, b) => byCode(a.properties, b.properties))
  const districtFeatures = districts.features.map((f, i) => feature(districtAreas[i], f.geometry)).sort((a, b) => byCode(a.properties, b.properties))
  const found = problems(divisionAreas, districtAreas, [...dsFeatures, ...districtFeatures])
  if (found.length) throw new Error(`Not written, the data has problems:\n  ${found.join('\n  ')}`)

  mkdirSync(APP_OUT, { recursive: true })
  const dsFile = join(APP_OUT, 'ds.json')
  const districtFile = join(APP_OUT, 'districts.json')
  writeFileSync(dsFile, geojsonText(meta(info, 'ds'), dsFeatures))
  writeFileSync(districtFile, geojsonText(meta(info, 'district'), districtFeatures))

  // The function only needs the English names, to match the names in NBRO's warnings
  const names = {
    meta: { ...meta(info, 'ds'), title: 'Sri Lanka: districts and DS divisions, English names and p-codes', changes: undefined },
    districts: districtAreas.sort(byCode).map(({ code, en }) => ({ code, en })),
    divisions: divisionAreas.sort(byCode).map(({ code, district, en }) => ({ code, district, en })),
  }
  mkdirSync(dirname(FUNCTION_OUT), { recursive: true })
  writeFileSync(FUNCTION_OUT, JSON.stringify(names, null, 1) + '\n')

  console.log(`\n${dsFeatures.length} DS divisions: ${dsFile}\n  ${sizes(dsFile)}`)
  console.log(`${districtFeatures.length} districts: ${districtFile}\n  ${sizes(districtFile)}`)
  console.log(`Names for the function: ${FUNCTION_OUT}\n  ${sizes(FUNCTION_OUT)}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message ?? err)
    process.exit(1)
  })
}
