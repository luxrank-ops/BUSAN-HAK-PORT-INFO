// ============================================================================
// BUSAN HAK PORT INFO — Cloudflare Workers 어댑터
// firebase-admin/storage 대체 (Cloud Storage JSON API)
// ============================================================================
import { getGoogleAccessToken, resolveProjectId, SCOPE } from './google-auth.js';

export class File {
  constructor(readonly bucketName: string, readonly name: string) {}

  private get objectNameUrl(): string {
    return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.bucketName)}/o/${encodeURIComponent(this.name)}`;
  }

  async save(
    data: string | Buffer | Uint8Array,
    options?: { contentType?: string; resumable?: boolean; metadata?: Record<string, any> }
  ): Promise<void> {
    const token = await getGoogleAccessToken(SCOPE.devstorage);
    const meta = options?.metadata || {};
    const contentType = String(options?.contentType || meta.contentType || 'application/octet-stream');
    const hasRichMeta = Boolean(meta.cacheControl || meta.contentDisposition || meta.contentEncoding || meta.metadata);

    if (hasRichMeta) {
      const boundary = `cf_gcs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      const objectMeta: Record<string, any> = {
        name: this.name,
        contentType,
        ...(meta.cacheControl ? { cacheControl: String(meta.cacheControl) } : {}),
        ...(meta.contentDisposition ? { contentDisposition: String(meta.contentDisposition) } : {}),
        ...(meta.contentEncoding ? { contentEncoding: String(meta.contentEncoding) } : {}),
        ...(meta.metadata && typeof meta.metadata === 'object' ? { metadata: meta.metadata } : {})
      };
      const payloadBuf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : Buffer.from(data);
      const head = Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(objectMeta)}\r\n` +
        `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`,
        'utf-8'
      );
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`, 'utf-8');
      const body = Buffer.concat([head, payloadBuf, tail]);
      const res = await fetch(
        `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucketName)}/o?uploadType=multipart`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body
        }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`storage_save_failed:${res.status}:${text.slice(0, 300)}`);
      }
      return;
    }

    const res = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(this.bucketName)}/o?uploadType=media&name=${encodeURIComponent(this.name)}`,
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

  async delete(options?: { ignoreNotFound?: boolean }): Promise<void> {
    const token = await getGoogleAccessToken(SCOPE.devstorage);
    const res = await fetch(this.objectNameUrl, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 404 && options?.ignoreNotFound) return;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`storage_delete_failed:${res.status}:${text.slice(0, 300)}`);
    }
  }
}

class Bucket {
  constructor(readonly name: string) {}
  file(objectPath: string): File {
    return new File(this.name, objectPath);
  }
  async getFiles(options?: { prefix?: string; maxResults?: number }): Promise<[File[]]> {
    const token = await getGoogleAccessToken(SCOPE.devstorage);
    const url = new URL(`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(this.name)}/o`);
    if (options?.prefix) url.searchParams.set('prefix', options.prefix);
    if (options?.maxResults) url.searchParams.set('maxResults', String(options.maxResults));
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`storage_list_failed:${res.status}:${text.slice(0, 300)}`);
    }
    const json: any = await res.json().catch(() => ({}));
    const files = (Array.isArray(json.items) ? json.items : []).map((item: any) => new File(this.name, String(item.name || '')));
    return [files];
  }
}

class Storage {
  bucket(name?: string): Bucket {
    const resolved = String(name || '').trim()
      || String((globalThis as any).process?.env?.FIREBASE_STORAGE_BUCKET || '').trim()
      || `${resolveProjectId()}.firebasestorage.app`;
    return new Bucket(resolved);
  }
}

let storage: Storage | null = null;

export function getStorage(_app?: any): Storage {
  if (!storage) storage = new Storage();
  return storage;
}
