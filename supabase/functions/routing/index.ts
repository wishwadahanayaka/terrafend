import { withSupabase } from '@supabase/server'

const ORS_URL = 'https://api.openrouteservice.org'
const ORS_TIMEOUT_MS = 15_000

const ALLOWED_ORIGINS = ['http://localhost:5173', 'https://terrafend.vercel.app']

const BOX = { minLng: 79.4, maxLng: 82.1, minLat: 5.7, maxLat: 10.0 }

type Point = { lat: number; lng: number }

// Thrown for anything we want to show the user as a plain message
class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message)
  }
}

const MESSAGES = {
  dailyLimit: 'The daily limit for searches and routes has been reached. Please try again tomorrow.',
  tooMany: 'Too many requests right now. Please wait a moment and try again.',
  noRoute: 'No driving route found between those points. Try moving them closer to a road.',
  general: 'Something went wrong. Please try again.',
}

function isNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function readPoint(v: unknown, name: string, box: boolean): Point {
  const p = v as Partial<Point> | null
  if (!p || !isNumber(p.lat) || !isNumber(p.lng)) {
    throw new ApiError(`${name} needs a lat and a lng.`, 400)
  }
  const limits = box ? BOX : { minLng: -180, maxLng: 180, minLat: -90, maxLat: 90 }
  if (p.lng < limits.minLng || p.lng > limits.maxLng || p.lat < limits.minLat || p.lat > limits.maxLat) {
    throw new ApiError(box ? `${name} must be inside Sri Lanka.` : `${name} is not a valid position.`, 400)
  }
  return { lat: p.lat, lng: p.lng }
}

// Sends the request to OpenRouteService. The key goes in a header, so it never
// shows up in a URL or a log line.
async function callOrs(path: string, init: RequestInit = {}): Promise<unknown> {
  const key = Deno.env.get('ORS_API_KEY')
  if (!key) {
    console.error('ORS_API_KEY is not set')
    throw new ApiError(MESSAGES.general, 500)
  }

  let res: Response
  try {
    res = await fetch(`${ORS_URL}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: key, Accept: 'application/json, application/geo+json' },
      signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
    })
  } catch {
    console.error('ORS request failed or timed out')
    throw new ApiError(MESSAGES.general, 502)
  }

  if (res.ok) return await res.json()

  // ORS errors look like { error: { code, message } }. Only the status and code are logged.
  let code: number | undefined
  try {
    const body = await res.json()
    code = typeof body?.error === 'number' ? body.error : body?.error?.code
  } catch {
    // the body wasn't JSON, the status is enough
  }
  console.error(`ORS error: status ${res.status}, code ${code ?? 'none'}`)

  if (res.status === 403) throw new ApiError(MESSAGES.dailyLimit, 503)
  if (res.status === 429) throw new ApiError(MESSAGES.tooMany, 429)
  // 2009, 2010 and 2016 are "route not found", "point not found", "no route between entry and exit"
  if (res.status === 404 || (code !== undefined && [2009, 2010, 2016].includes(code))) {
    throw new ApiError(MESSAGES.noRoute, 404)
  }
  throw new ApiError(MESSAGES.general, 502)
}

async function search(input: Record<string, unknown>) {
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (text.length < 2 || text.length > 100) {
    throw new ApiError('Type between 2 and 100 characters to search.', 400)
  }

  const params = new URLSearchParams({ text, 'boundary.country': 'LK', size: '5' })
  if (input.focus !== undefined) {
    const focus = readPoint(input.focus, 'focus', false)
    params.set('focus.point.lat', String(focus.lat))
    params.set('focus.point.lon', String(focus.lng))
  }

  const data = (await callOrs(`/geocode/autocomplete?${params}`)) as {
    features?: { properties?: { label?: unknown }; geometry?: { coordinates?: unknown[] } }[]
  }

  // Pelias puts longitude first
  const results = []
  for (const f of data.features ?? []) {
    const [lng, lat] = f.geometry?.coordinates ?? []
    const label = f.properties?.label
    if (typeof label === 'string' && isNumber(lat) && isNumber(lng)) results.push({ label, lat, lng })
  }
  return results.slice(0, 5)
}

async function route(input: Record<string, unknown>) {
  const start = readPoint(input.start, 'start', true)
  const end = readPoint(input.end, 'end', true)

  const data = (await callOrs('/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [
        [start.lng, start.lat],
        [end.lng, end.lat],
      ],
    }),
  })) as {
    features?: {
      geometry?: { coordinates?: number[][] }
      properties?: { summary?: { distance?: unknown; duration?: unknown } }
    }[]
  }

  const feature = data.features?.[0]
  const line = feature?.geometry?.coordinates
  const summary = feature?.properties?.summary
  if (!Array.isArray(line) || !isNumber(summary?.distance) || !isNumber(summary?.duration)) {
    console.error('ORS route response had an unexpected shape')
    throw new ApiError(MESSAGES.general, 502)
  }

  return {
    coordinates: line.map(([lng, lat]) => [lng, lat]),
    distance_m: Math.round(summary.distance),
    duration_s: Math.round(summary.duration),
  }
}

// Checks the user's token (the JWT kept by supabase-js) and runs the action.
// CORS is handled below, so it's switched off here.
const handleRequest = withSupabase({ auth: 'user', cors: 'disabled' }, async (req, ctx) => {
  // The old anon key is also a valid JWT but has no user in it, so ask for a real one
  if (!ctx.userClaims?.id || ctx.userClaims.role !== 'authenticated') {
    return Response.json({ error: 'Please sign in first.' }, { status: 401 })
  }
  if (req.method !== 'POST') {
    return Response.json({ error: 'Use POST.' }, { status: 405 })
  }

  try {
    const input = await req.json().catch(() => null)
    if (!input || typeof input !== 'object') throw new ApiError('Send a JSON body.', 400)

    if (input.action === 'search') return Response.json(await search(input))
    if (input.action === 'route') return Response.json(await route(input))
    throw new ApiError('Unknown action. Use "search" or "route".', 400)
  } catch (err) {
    if (err instanceof ApiError) return Response.json({ error: err.message }, { status: err.status })
    console.error('Unexpected error:', (err as Error).message)
    return Response.json({ error: MESSAGES.general }, { status: 500 })
  }
})

// Only the app's own addresses get CORS headers. This isn't the security
// check (the token is), it just tells browsers which sites may read answers.
function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin')
  const headers: Record<string, string> = { Vary: 'Origin' }
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS'
    // Echo what the browser asked for, since supabase-js adds a few headers of its own
    headers['Access-Control-Allow-Headers'] =
      req.headers.get('Access-Control-Request-Headers') ?? 'authorization, apikey, content-type, x-client-info'
    headers['Access-Control-Max-Age'] = '86400'
  }
  return headers
}

export default {
  fetch: async (req: Request) => {
    const cors = corsHeaders(req)
    // The browser's pre-check carries no token, so it is answered before the token check
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

    const res = await handleRequest(req)
    const headers = new Headers(res.headers)
    for (const [name, value] of Object.entries(cors)) headers.set(name, value)
    return new Response(res.body, { status: res.status, headers })
  },
}
