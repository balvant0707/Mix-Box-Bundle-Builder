/**
 * Converts a browser File into the {bytes, mimeType, fileName} shape the
 * admin box-save endpoints expect, so an uploaded image survives
 * JSON.stringify (a raw File object serializes to "{}").
 *
 * Returns null for anything that isn't a File (already-saved image URLs are
 * plain strings and pass through unchanged elsewhere).
 */
export function fileToUploadPayload(file) {
  if (!(file instanceof File)) return Promise.resolve(null);

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIndex = result.indexOf(",");
      const bytes = commaIndex >= 0 ? result.slice(commaIndex + 1) : result;
      resolve({ bytes, mimeType: file.type || "application/octet-stream", fileName: file.name || "upload" });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Resolves a form image field (File | existing-URL string | null) to what
 * the save payload should send: {bytes,...} for a new upload, null to
 * explicitly clear an existing image, or undefined to leave it untouched.
 */
export async function resolveImageField(value) {
  if (value instanceof File) return fileToUploadPayload(value);
  if (value === null) return null;
  return undefined;
}
