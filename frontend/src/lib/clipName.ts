/**
 * Human-readable label for an uploaded clip.
 *
 * Phone camera rolls hand us names like "04DBC3C2-1271-4EB1-..." or
 * "Screen Recording 2026-09-20 at 4.04.24 AM". Those are not labels a golfer
 * recognises, so fall back to something readable.
 */
const UUIDISH = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NOISY =
  /^(img|vid|video|mov|image|clip|pxl|dsc|screen[\s_-]?recording|screenshot|whatsapp|untitled)\b/i;

/**
 * Phone camera rolls hand us names like "04DBC3C2-1271-4EB1-..." or
 * "IMG_4417". Those are not labels a golfer recognises, so fall back to a
 * readable description instead of printing the raw file name.
 */
export function prettyClipName(raw: string | null): string | null {
  if (!raw) return null;
  const t = raw.replace(/\.[^.]+$/, "").trim();
  if (t === "" || UUIDISH.test(t) || NOISY.test(t) || /^[0-9a-f-]{16,}$/i.test(t)) {
    return "Uploaded clip";
  }
  return t.replace(/[_-]+/g, " ").slice(0, 32);
}

