// Thumbnails for the pinned message's images.
//
// A user row's attachments carry web image URLs and project attachment
// paths. Paths are read through `sdk.projects.attachments.read` and shown
// from a blob URL, kept in a small cache so scrolling back and forth does
// not refetch them.

export type ImageSource = { kind: "web"; url: string } | { kind: "local"; path: string };

const SAFE_WEB_IMAGE = /^(https?:|data:image\/)/i;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item !== "")
    : [];
}

/** The images of a user row's `attachments`, in order. */
export function imageSourcesOf(attachments: unknown): ImageSource[] {
  if (attachments === null || typeof attachments !== "object") return [];
  const fields = attachments as Record<string, unknown>;
  return [
    ...strings(fields.imageUrls)
      .filter((url) => SAFE_WEB_IMAGE.test(url))
      .map((url): ImageSource => ({ kind: "web", url })),
    ...strings(fields.localImagePaths).map((path): ImageSource => ({ kind: "local", path })),
  ];
}

const MAX_CACHED = 60;
const blobUrls = new Map<string, Promise<string | null>>();

export interface AttachmentBytes {
  bytes: Uint8Array;
  mimeType: string;
}

function revoke(pending: Promise<string | null>): void {
  void pending.then((url) => {
    if (url !== null) URL.revokeObjectURL(url);
  });
}

/**
 * A blob URL for an attachment, loaded once. The oldest URLs are revoked past
 * the cache size; a failed load is forgotten so it can be retried.
 */
export function cachedBlobUrl(
  key: string,
  load: () => Promise<AttachmentBytes>,
): Promise<string | null> {
  const hit = blobUrls.get(key);
  if (hit !== undefined) {
    blobUrls.delete(key);
    blobUrls.set(key, hit);
    return hit;
  }
  const pending = load().then(
    ({ bytes, mimeType }) =>
      URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType })),
    () => {
      blobUrls.delete(key);
      return null;
    },
  );
  blobUrls.set(key, pending);
  while (blobUrls.size > MAX_CACHED) {
    const oldest = blobUrls.entries().next().value;
    if (oldest === undefined) break;
    blobUrls.delete(oldest[0]);
    revoke(oldest[1]);
  }
  return pending;
}

/** Revoke every cached URL, including ones still loading. */
export function clearBlobUrls(): void {
  for (const pending of blobUrls.values()) revoke(pending);
  blobUrls.clear();
}
