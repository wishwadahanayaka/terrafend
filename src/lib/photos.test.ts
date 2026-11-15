import { beforeEach, describe, expect, it, vi } from 'vitest'
import { newPhotoPath, PHOTO_NAME_PATTERN } from './photoName'
import { uploadPhoto } from './photos'

// Stand-ins for the Supabase client and the sign-in. Nothing here reaches the network.
const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  from: vi.fn(),
  getSession: vi.fn(),
  ensure: vi.fn(),
}))

vi.mock('./supabase', () => ({
  supabase: {
    storage: { from: (bucket: string) => mocks.from(bucket) },
    auth: { getSession: () => mocks.getSession() },
  },
}))
vi.mock('./session', () => ({ ensureAnonymousSession: () => mocks.ensure() }))

const USER_ID = '3f2b8c1e-5a47-4d0e-9b61-0c7d2e8a41f6'

describe('newPhotoPath', () => {
  it('is a random uuid and .jpg, with no folder', () => {
    for (let i = 0; i < 20; i++) {
      const path = newPhotoPath()
      expect(path).toMatch(PHOTO_NAME_PATTERN)
      expect(path).not.toContain('/')
    }
  })

  it('never repeats', () => {
    const paths = new Set(Array.from({ length: 200 }, () => newPhotoPath()))
    expect(paths.size).toBe(200)
  })

  it('does not match the old <user id>/<name> style', () => {
    expect(`${USER_ID}/${newPhotoPath()}`).not.toMatch(PHOTO_NAME_PATTERN)
    expect(`${USER_ID}/9a1c3b52-7d44-4e0f-8a2b-61c5d9e0f3a7.jpg`).not.toMatch(PHOTO_NAME_PATTERN)
  })
})

describe('uploadPhoto', () => {
  const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' })

  beforeEach(() => {
    mocks.upload.mockReset().mockResolvedValue({ error: null })
    mocks.from.mockReset().mockReturnValue({ upload: mocks.upload })
    mocks.getSession.mockReset().mockResolvedValue({ data: { session: { user: { id: USER_ID } } } })
    mocks.ensure.mockReset().mockResolvedValue(undefined)
  })

  it('uploads under a random name with no user id in it', async () => {
    const result = await uploadPhoto(file)

    expect(result.error).toBeNull()
    expect(result.path).toMatch(PHOTO_NAME_PATTERN)
    expect(result.path).not.toContain(USER_ID)
    expect(mocks.from).toHaveBeenCalledWith('report-photos')
    const [path, sent, options] = mocks.upload.mock.calls[0]
    expect(path).toBe(result.path)
    expect(sent).toBe(file)
    // No replacing an existing file, and always labelled as the JPEG shrinkPhoto makes
    expect(options).toEqual({ upsert: false, contentType: 'image/jpeg' })
  })

  it('does not look up the user id at all', async () => {
    await uploadPhoto(file)
    expect(mocks.getSession).not.toHaveBeenCalled()
  })

  it('gives a new name to every upload', async () => {
    const a = await uploadPhoto(file)
    const b = await uploadPhoto(file)
    expect(a.path).not.toBe(b.path)
  })

  it('returns an error message and no path when the upload fails', async () => {
    mocks.upload.mockResolvedValue({ error: { message: 'nope' } })
    const result = await uploadPhoto(file)
    expect(result.path).toBeNull()
    expect(result.error).toEqual(expect.any(String))
    expect(result.error).not.toBe('')
  })

  it('uploads nothing when signing in fails', async () => {
    mocks.ensure.mockRejectedValue(new Error('offline'))
    const result = await uploadPhoto(file)
    expect(result.path).toBeNull()
    expect(mocks.upload).not.toHaveBeenCalled()
  })
})
