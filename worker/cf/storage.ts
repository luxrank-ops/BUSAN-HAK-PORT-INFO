// ============================================================================
// BUSAN HAK PORT INFO — Cloudflare Workers 어댑터
// firebase-admin/storage 대체 (Cloud Storage JSON API)
// ============================================================================
import { getGoogleAccessToken, SCOPE } from './google-auth.js';

class File {
  constructor(private readonly bucketName: string, private readonly objectPath: string) {}

  private get objectNameUrl(): string {
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucketName)}/o/${encodeURIComponent(this.objectPath)}`;
  }

  async save(data: string | Buffer | Uint8Array, options?: { contentType?: string; metadata?: Record<string, any> }): Promise<void> {
    const token = await getGoogleAccessToken(SCOPE.devstorage);
    const contentType = options?.contentType || 'application/octet-stream';
    const res = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucketName)}/o?uploadType=media&name=${encodeURIComponent(this.objectPath)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': contentType
        },
        body: typeof data === 'string' ? data : (data as any)
      }
    );
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`storage_save_failed:${res.status}:${text.slice(0, 300)}`);
    }
  }

  async download(): Promise<[Buffer]> {
    const token = await getGoogleAccessToken(SCOPE.devstorage);
    const res = await fetch(`${this.objectNameUrl}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`storage_download_failed:${res.status}:${text.slice(0, 300)}`);
    }
    return [Buffer.from(await res.arrayBuffer())];
  }

  async exists(): Promise<[boolean]> {
    const token = await getGoogleAccessToken(SCOPE.devstorage);
    const res = await fetch(this.objectNameUrl, { headers: { Authorization: `Bearer ${token}` } });
    return [res.ok];
  }
}

class Bucket {
  constructor(private readonly name: string) {}
  file(objectPath: string): File {
    return new File(this.name, objectPath);
  }
}

class Storage {
  bucket(name: string): Bucket {
    return new Bucket(name);
  }
}

let storage: Storage | null = null;

export function getStorage(_app?: any): Storage {
  if (!storage) storage = new Storage();
  return storage;
}
