// The same shape the database accepts for a new photo (migration 0009). A test compares the two.
export const PHOTO_NAME_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/

// A random name with no user id and no folder. Photos used to be saved under <user id>/, which put
// the id in every photo link and let anyone group one person's photos. Who uploaded a photo is
// recorded by Storage itself, where only the database can read it. The name is always .jpg because
// shrinkPhoto saves a JPEG. There are no updates, so each upload needs a new name.
export function newPhotoPath(): string {
  return `${crypto.randomUUID()}.jpg`
}
