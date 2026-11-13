// Thumbnails for the pinned message's images.
//
// A user row's attachments carry web image URLs and project attachment
// paths. Paths are read through `sdk.projects.attachments.read` and shown
// from a blob URL, kept in a small cache so scrolling back and forth does
// not refetch them.

import { rowOf } from "./message";

export type ImageSource = { kind: "web"; url: string } | { kind: "local"; path: string };

const SAFE_WEB_IMAGE = /^(https?:|data:image\/)/i;

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item !== "")
    : [];
}

/** The images of a `threads.message` answer (or of a bare row), in order. */
export function imageSourcesOf(response: unknown): ImageSource[] {
  const attachments = rowOf(response)?.attachments;
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
    void oldest[1].then((url) => {
      if (url !== null) URL.revokeObjectURL(url);
    });
  }
  return pending;
}
