import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateRawSync, gzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { COMPLETE_AT_LIMIT, CUT_OFF, LIMIT_BYTES, MISENCODED } from '../../scripts/area-name-fixes.mjs'
import { applyFixes, ATTRIBUTION, LICENCE, problems, unexplainedAtLimit, zipEntries, zipRead } from '../../scripts/build-areas.mjs'

// The DS division and district boundaries (src/data/areas/), written by scripts/build-areas.mjs from
// the Survey Department's data on HDX. No network: the files are read as committed, and the script's
// own pieces are tried on small made-up inputs.

const ROOT = join(__dirname, '..', '..')
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts))
type Feature = { properties: { code: string; district?: string; en: string; si: string; ta: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }
type Collection = { type: string; meta: Record<string, unknown>; features: Feature[] }
const ds: Collection = JSON.parse(read('src', 'data', 'areas', 'ds.json').toString('utf8'))
const districts: Collection = JSON.parse(read('src', 'data', 'areas', 'districts.json').toString('utf8'))
const names = JSON.parse(read('supabase', 'functions', 'landslide-refresh', 'ds-names.json').toString('utf8'))

const SINHALA = new RegExp('[\\u0d80-\\u0dff]', 'u')
const TAMIL = new RegExp('[\\u0b80-\\u0bff]', 'u')
const ringsOf = (f: Feature): number[][][] =>
  f.geometry.type === 'Polygon' ? (f.geometry.coordinates as number[][][]) : (f.geometry.coordinates as number[][][][]).flat()

describe('the boundary files', () => {
  it('carry the source, the licence (CC BY-IGO) and the attribution in their metadata', () => {
    for (const file of [ds, districts]) {
      expect(file.type).toBe('FeatureCollection')
      expect(file.meta).toMatchObject({
        source: 'Survey Department of Sri Lanka, via OCHA (Humanitarian Data Exchange)',
        dataset: 'https://data.humdata.org/dataset/cod-ab-lka',
        licence: 'CC BY-IGO 3.0',
        licenceUrl: 'https://creativecommons.org/licenses/by/3.0/igo/',
        attribution: ATTRIBUTION,
      })
      expect(String(file.meta.builtBy)).toMatch(/build-areas\.mjs/)
      // the changes made to the data are listed, as the licence asks
      expect((file.meta.changes as string[]).some((c) => /simplified/.test(c))).toBe(true)
    }
    expect(LICENCE).toBe('CC BY-IGO 3.0')
  })

  it('credit the data in the README', () => {
    const readme = read('README.md').toString('utf8')
    expect(readme).toContain(ATTRIBUTION)
    expect(readme).toContain('https://data.humdata.org/dataset/cod-ab-lka')
  })

  it('have the 25 districts and 339 DS divisions, each with a p-code and its district', () => {
    expect(districts.features).toHaveLength(25)
    expect(ds.features).toHaveLength(339)
    const districtCodes = new Set(districts.features.map((f) => f.properties.code))
    expect(new Set(ds.features.map((f) => f.properties.code)).size).toBe(339)
    for (const f of districts.features) expect(f.properties.code).toMatch(/^LK\d{2}$/)
    for (const f of ds.features) {
      expect(f.properties.code).toMatch(/^LK\d{4}$/)
      expect(districtCodes.has(f.properties.district!), f.properties.code).toBe(true)
      expect(f.properties.code.startsWith(f.properties.district!)).toBe(true)
    }
  })

  it('include the divisions created in recent years (missing from older copies of the data)', () => {
    const en = new Set(ds.features.map((f) => f.properties.en))
    for (const name of ['Norwood', 'Ambagamuwa Korale', 'Thalawakele', 'Kothmale East', 'Kothmale West']) expect(en.has(name), name).toBe(true)
  })

  it('name every area in English, Sinhala and Tamil', () => {
    for (const f of [...ds.features, ...districts.features]) {
      const { code, en, si, ta } = f.properties
      expect(en, code).toMatch(/^[A-Za-z0-9 .()'&/-]+$/)
      expect(SINHALA.test(si), `${code} si "${si}"`).toBe(true)
      expect(TAMIL.test(ta), `${code} ta "${ta}"`).toBe(true)
    }
  })

  it('have the name fixes applied: no word "district", Kalutara spelled right, no cut-off names', () => {
    for (const f of districts.features) {
      expect(f.properties.si, f.properties.code).not.toContain('දිස්')
      expect(f.properties.ta, f.properties.code).not.toContain('மாவட்ட')
    }
    const byCode = new Map([...ds.features, ...districts.features].map((f) => [f.properties.code, f.properties]))
    expect(byCode.get('LK13')!.si).toBe('කළුතර')
    for (const f of [...ds.features, ...districts.features]) expect(f.properties.si).not.toContain('ඵ')
    for (const [code, lang, from, to] of CUT_OFF) {
      const area = byCode.get(code)!
      expect(area, code).toBeDefined()
      expect(area[lang as 'si' | 'ta']).toBe(to)
      expect(area[lang as 'si' | 'ta']).not.toBe(from)
    }
    // The Sinhala was cut off at the byte limit and is completed; the Tamil is under the limit and left as written
    expect(byCode.get('LK1124')).toMatchObject({ en: 'Sri Jayawardanapura Kotte', si: 'ශ්‍රී ජයවර්ධනපුර කෝට්ටේ', ta: 'ஸ்ரீ ஜயவர்தனபுர' })
  })

  it('have polygons that are closed rings inside Sri Lanka', () => {
    for (const f of [...ds.features, ...districts.features]) {
      const rings = ringsOf(f)
      expect(rings.length, f.properties.code).toBeGreaterThan(0)
      for (const ring of rings) {
        expect(ring.length).toBeGreaterThanOrEqual(4)
        expect(ring[0]).toEqual(ring[ring.length - 1])
        for (const [x, y] of ring) {
          expect(x >= 79.4 && x <= 82.1 && y >= 5.7 && y <= 10.0, `${f.properties.code} ${x},${y}`).toBe(true)
        }
      }
    }
  })

  it('stay small: the DS divisions under 150 KB gzipped, the districts under 60 KB', () => {
    expect(gzipSync(read('src', 'data', 'areas', 'ds.json'), { level: 9 }).length).toBeLessThan(150 * 1024)
    expect(gzipSync(read('src', 'data', 'areas', 'districts.json'), { level: 9 }).length).toBeLessThan(60 * 1024)
  })

  it('give the function the same names and p-codes as the app', () => {
    expect(names.districts).toEqual(districts.features.map((f) => ({ code: f.properties.code, en: f.properties.en })))
    expect(names.divisions).toEqual(ds.features.map((f) => ({ code: f.properties.code, district: f.properties.district, en: f.properties.en })))
    expect(names.meta.licence).toBe('CC BY-IGO 3.0')
  })
})

describe('the name fixes list', () => {
  it('only completes cut-off names: each full name starts with what the source has', () => {
    for (const [code, lang, from, to] of CUT_OFF) {
      expect(to.startsWith(from), `${code} ${lang}`).toBe(true)
      expect(to.length).toBeGreaterThan(from.length)
      expect(Buffer.byteLength(from, 'utf8'), `${code} ${lang} is not at the limit`).toBeGreaterThanOrEqual(LIMIT_BYTES)
    }
  })

  it('lists each name once, and only codes that exist', () => {
    const codes = new Set(ds.features.map((f) => f.properties.code))
    const keys = [...CUT_OFF.map(([c, l]) => `${c}:${l}`), ...COMPLETE_AT_LIMIT.map(([c, l]) => `${c}:${l}`)]
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(codes.has(key.split(':')[0]), key).toBe(true)
  })

  it('says the completions need a native speaker to review them', () => {
    expect(read('scripts', 'area-name-fixes.mjs').toString('utf8')).toContain('NEEDS REVIEW BY A NATIVE SPEAKER')
  })
})

describe('the build script pins its tools', () => {
  const script = read('scripts', 'build-areas.mjs').toString('utf8')

  it('runs mapshaper at one exact version, which is also written into the data files', () => {
    expect(script).toMatch(/const MAPSHAPER = 'mapshaper@\d+\.\d+\.\d+'/)
    // the only way it is run goes through that constant, never a bare or "latest" mapshaper
    const codeLines = script.split('\n').filter((l) => !l.trim().startsWith('//'))
    expect(codeLines.join('\n').match(/npx /g)).toHaveLength(1)
    expect(script).toContain('execSync(`npx --yes ${MAPSHAPER} ')
    expect(script).not.toMatch(/mapshaper@(latest|next|\^|~)/)
    for (const file of [ds, districts]) {
      expect((file.meta.changes as string[]).some((c) => /with mapshaper@\d+\.\d+\.\d+$/.test(c))).toBe(true)
    }
  })
})

describe('the build script', () => {
  const district = (si: string, ta: string) => ({ level: 'district', code: 'LK13', en: 'Kalutara', si, ta })
  const division = (code: string, si: string, ta: string) => ({ level: 'ds', code, district: code.slice(0, 4), en: 'X', si, ta })

  it('removes the word "district", whole or cut off, and repairs Kalutara', () => {
    const areas = [district('කඵතර දිස්ත්‍රික්ක', 'களுத்துறை மாவட்டம'), { ...district('ත්‍රිකුණාමළය දිස්', 'திருகோணமலை மாவட்ட'), code: 'LK53' }]
    const used = applyFixes(areas)
    expect(areas.map((a) => [a.si, a.ta])).toEqual([
      ['කළුතර', 'களுத்துறை'],
      ['ත්‍රිකුණාමළය', 'திருகோணமலை'],
    ])
    expect(used).toEqual([4, 1, 0])
    expect(MISENCODED).toEqual([['කඵතර', 'කළුතර']])
  })

  it('leaves a Tamil DS name that only starts like the word "district" (மாவனல்லை, Mawanella)', () => {
    const area = division('LK9206', 'මාවනැල්ල', 'மாவனல்லை')
    applyFixes([area])
    expect(area.ta).toBe('மாவனல்லை')
  })

  it('completes a listed cut-off name only when the source still has it cut off', () => {
    const [code, lang, from, to] = CUT_OFF[0]
    const cut = { ...division(code, '', ''), [lang]: from }
    const fixed = { ...division(code, '', ''), [lang]: 'already whole' }
    applyFixes([cut, fixed])
    expect(cut[lang as 'si']).toBe(to)
    expect(fixed[lang as 'si']).toBe('already whole')
  })

  it('stops on a name at the byte limit that is neither completed nor checked', () => {
    const long = 'අ'.repeat(17)
    expect(Buffer.byteLength(long)).toBeGreaterThanOrEqual(LIMIT_BYTES)
    expect(unexplainedAtLimit([division('LK9999', long, 'சரி')])).toHaveLength(1)
    expect(unexplainedAtLimit([division('LK9999', 'කෙටි', 'சரி')])).toEqual([])
    const [code, lang, from] = CUT_OFF[0]
    expect(unexplainedAtLimit([{ ...division(code, 'කෙටි', 'சரி'), [lang]: from }])).toEqual([])
  })

  it('finds problems instead of writing bad files', () => {
    const square = { type: 'Polygon', coordinates: [[[80, 7], [80.1, 7], [80.1, 7.1], [80, 7]]] }
    const good = { ...division('LK1103', 'කොළඹ', 'கொழும்பு'), district: 'LK11', en: 'Colombo' }
    const dists = Array.from({ length: 25 }, (_, i) => ({ level: 'district', code: `LK${String(11 + i).padStart(2, '0')}`, en: 'D', si: 'ද', ta: 'த' }))
    // 330 made-up divisions, LK1100 to LK1429, in the districts LK11 to LK14
    const many = Array.from({ length: 330 }, (_, i) => {
      const code = `LK${1100 + i}`
      return { ...good, code, district: code.slice(0, 4), en: `Colombo ${i}` }
    })
    const feature = (code: string, geometry: unknown = square) => ({ properties: { code }, geometry })
    expect(problems(many, dists, [feature('LK1103')])).toEqual([])
    expect(problems(many, dists.slice(1), [])).toContain('expected 25 districts, got 24')
    expect(problems([...many, many[0]], dists, [])).toContain('a p-code appears twice')
    expect(problems([{ ...many[0], si: 'Colombo' }, ...many.slice(1)], dists, []).join()).toMatch(/Sinhala name/)
    expect(problems([{ ...many[0], district: 'LK99' }, ...many.slice(1)], dists, []).join()).toMatch(/district LK99 unknown/)
    expect(problems(many, dists, [feature('LK1103', { type: 'Polygon', coordinates: [[[70, 7], [80, 7], [80, 8], [70, 7]]] })]).join()).toMatch(/outside Sri Lanka/)
    expect(problems(many, dists, [feature('LK1103', null)]).join()).toMatch(/no polygon/)
  })

  it('reads a zip: stored and deflated files', () => {
    const zip = makeZip([
      ['lka_admin3.geojson', Buffer.from('{"type":"FeatureCollection"}'), true],
      ['readme.txt', Buffer.from('hello'), false],
    ])
    const entries = zipEntries(zip)
    expect(entries.map((e: { name: string }) => e.name)).toEqual(['lka_admin3.geojson', 'readme.txt'])
    expect(zipRead(zip, entries[0]).toString()).toBe('{"type":"FeatureCollection"}')
    expect(zipRead(zip, entries[1]).toString()).toBe('hello')
    expect(() => zipEntries(Buffer.from('not a zip at all, just some text'))).toThrow(/not a zip/)
  })
})

// A minimal zip file, enough to test the reader
function makeZip(files: [name: string, data: Buffer, deflate: boolean][]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const [name, data, deflate] of files) {
    const body = deflate ? deflateRawSync(data) : data
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(deflate ? 8 : 0, 8)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(deflate ? 8 : 0, 10)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, nameBuf, body)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + body.length
  }
  const dir = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(dir.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, dir, end])
}
