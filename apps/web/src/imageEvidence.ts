import { sha256 as portableSha256 } from '@noble/hashes/sha2.js';

export interface ImageEvidence {
  imageIndex: number;
  fileName: string;
  surface: string;
  sha256: string;
}

export interface EvidenceManifest {
  algorithm: 'SHA-256';
  checksum: string;
  images: ImageEvidence[];
}

/** Hash original bytes, never a thumbnail, URL, or OCR/preprocessed image. */
export async function sha256(bytes: BufferSource): Promise<string> {
  const original = ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new Uint8Array(bytes);
  // Safari withholds SubtleCrypto on HTTP LAN URLs. Both paths hash the same original bytes.
  const digest = globalThis.crypto?.subtle
    ? new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
    : portableSha256(original);
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function hashImage(image: Blob): Promise<string> {
  return sha256(await image.arrayBuffer());
}

/** A single-image checksum is its raw hash; multi-image checksums bind the ordered manifest. */
export async function createEvidenceManifest(images: ImageEvidence[]): Promise<EvidenceManifest | undefined> {
  if (images.length === 0) return undefined;
  const canonicalImages = images.map(({ imageIndex, fileName, surface, sha256 }) => ({ imageIndex, fileName, surface, sha256 }));
  const checksum = images.length === 1
    ? images[0].sha256
    : await sha256(new TextEncoder().encode(JSON.stringify(canonicalImages)));
  return { algorithm: 'SHA-256', checksum, images: canonicalImages };
}

/** Optional surface names come from filenames; otherwise retain an explicit image identity. */
export function surfaceForImage(fileName: string, imageIndex: number): string {
  const namedSurface = fileName.match(/(?:^|[\s_.-])(front|back|crimp|side|bottom|top|cap)(?=[\s_.-]|$)/i)?.[1];
  return namedSurface ? namedSurface[0].toUpperCase() + namedSurface.slice(1).toLowerCase() : `Image ${imageIndex + 1}`;
}

export function blobToDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Could not read photograph'));
    reader.onerror = () => reject(reader.error || new Error('Could not read photograph'));
    reader.readAsDataURL(blob);
  });
}
