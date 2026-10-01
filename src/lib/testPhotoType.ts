// Photo types the test-score-photos bucket accepts (kept in sync with the
// bucket's allowed_mime_types). Some browsers report an empty type for
// iPhone HEIC/HEIF photos, so the type is filled in from the extension.

export const TEST_PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.jpg,.jpeg,.png,.webp,.gif,.heic,.heif";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
};

/** The content type to upload with, or null when the file is not an accepted photo. */
export function testPhotoContentType(file: { name: string; type: string }): string | null {
  const type = (file.type || "").toLowerCase();
  if (ALLOWED_TYPES.has(type)) return type === "image/jpg" ? "image/jpeg" : type;
  if (type && type !== "application/octet-stream") return null;
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return BY_EXTENSION[ext] ?? null;
}
