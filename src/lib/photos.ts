import imageCompression from 'browser-image-compression'
import { ensureAnonymousSession } from './session'
import { supabase } from './supabase'

const PHOTO_BUCKET = 'report-photos'

// The library redraws the picture on a canvas and saves a fresh JPEG, which
// drops the original's hidden metadata (GPS location, camera, time). We never
// pass preserveExif, so none of it is copied back. The web worker is off
// because by default it loads a helper script from a CDN.
export function shrinkPhoto(file: File): Promise<File> {
  return imageCompression(file, {
    maxWidthOrHeight: 1280,
    maxSizeMB: 0.5,
    fileType: 'image/jpeg',
    useWebWorker: false,
  })
}

type UploadResult = { path: string; error: null } | { path: null; error: string }

export async function uploadPhoto(file: File): Promise<UploadResult> {
  const failed = {
    path: null,
    error: 'Couldn’t upload your photo. Try again, or remove the photo to send without it.',
  } as const

  try {
    await ensureAnonymousSession()
  } catch {
    return failed
  }
  const { data } = await supabase.auth.getSession()
  const userId = data.session?.user.id
  if (!userId) return failed

  // The storage rules only allow <user id>/<file>, and no updates, so each upload gets a new name
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const { error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, file, { upsert: false, contentType: 'image/jpeg' })

  return error ? failed : { path, error: null }
}

export function photoUrl(path: string): string {
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}
