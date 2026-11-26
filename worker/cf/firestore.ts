// ============================================================================
// BUSAN HAK PORT INFO — Cloudflare Workers 어댑터
// Firestore REST 클라이언트 (firebase-admin/firestore 대체)
// ============================================================================
/**
 * Cloudflare Workers 에는 gRPC(TCP·HTTP/2) 와 문자열 코드 생성(new Function) 이
 * 없어 firebase-admin 의 Firestore 를 쓸 수 없습니다. 그래서 서버 코드가 쓰는
 * API 표면만 Firestore REST(v1) 위에 그대로 구현했습니다.
 *
 * 지원: collection().doc().get/set/update/delete/create, collection().add,
 *       where/orderBy/limit/offset/get, count().get(), batch(), runTransaction(),
 *       FieldValue.serverTimestamp/increment/arrayUnion/arrayRemove/delete
 *
 * 값 매핑은 Firestore REST 의 typed value 형식(stringValue 등)을 그대로 사용합니다.
 */
import { getGoogleAccessToken, resolveProjectId, SCOPE } from './google-auth.js';

type Json = any;

export class Timestamp {
  readonly seconds: number;
  readonly nanoseconds: number;
  constructor(seconds: number, nanoseconds: number) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }
  static fromDate(date: Date): Timestamp {
    const ms = date.getTime();
    return new Timestamp(Math.floor(ms / 1000), (ms % 1000) * 1e6);
  }
  static fromMillis(ms: number): Timestamp {
    return Timestamp.fromDate(new Date(ms));
  }
  static now(): Timestamp {
    return Timestamp.fromMillis(Date.now());
  }
  static fromISOString(iso: string): Timestamp {
    const ms = Date.parse(iso);
    if (Number.isNaN(ms)) return new Timestamp(0, 0);
    return Timestamp.fromDate(new Date(ms));
  }
  toMillis(): number {
    return this.seconds * 1000 + Math.floor(this.nanoseconds / 1e6);
  }
  toDate(): Date {
    return new Date(this.toMillis());
  }
  toJSON(): { seconds: number; nanoseconds: number; _seconds: number; _nanoseconds: number } {
    return {
      seconds: this.seconds,
      nanoseconds: this.nanoseconds,
      _seconds: this.seconds,
      _nanoseconds: this.nanoseconds
    };
  }
  isEqual(other: Timestamp): boolean {
    return other instanceof Timestamp && other.seconds === this.seconds && other.nanoseconds === this.nanoseconds;
  }
}

export class FieldValueTransform {
  constructor(readonly kind: 'serverTimestamp' | 'delete' | 'increment' | 'arrayUnion' | 'arrayRemove', readonly operand?: any) {}
}

export const FieldValue = {
  serverTimestamp(): FieldValueTransform {
    return new FieldValueTransform('serverTimestamp');
  },
  delete(): FieldValueTransform {
    return new FieldValueTransform('delete');
  },
  increment(n: number): FieldValueTransform {
    return new FieldValueTransform('increment', Number(n) || 0);
  },
  arrayUnion(...values: any[]): FieldValueTransform {
    return new FieldValueTransform('arrayUnion', values);
  },
  arrayRemove(...values: any[]): FieldValueTransform {
    return new FieldValueTransform('arrayRemove', values);
  }
};

export function isFieldValueTransform(value: any): value is FieldValueTransform {
  return value instanceof FieldValueTransform;
}

// ── 값 인코딩/디코딩 ─────────────────────────────────────────────────────────

function encodeValue(value: any): Json {
  if (value === null) return { nullValue: null };
  if (value === undefined) return { nullValue: null };
  if (value instanceof Timestamp) {
    return { timestampValue: new Date(value.toMillis()).toISOString() };
  }
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((v) => encodeValue(v)) } };
  }
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    if (Number.isInteger(value) && Math.abs(value) < 2 ** 53) return { integerValue: String(value) };
    return { doubleValue: value };
  }
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'object') {
    const fields: Json = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      fields[k] = encodeValue(v);
    }
    return { mapValue: { fields } };
  }
  return { nullValue: null };
}

function decodeValue(value: Json): any {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return Timestamp.fromISOString(String(value.timestampValue));
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return { latitude: value.geoPointValue.latitude, longitude: value.geoPointValue.longitude };
  if ('bytesValue' in value) return value.bytesValue;
  if ('arrayValue' in value) return (value.arrayValue?.values || []).map((v: Json) => decodeValue(v));
  if ('mapValue' in value) return decodeFields(value.mapValue?.fields || {});
  return null;
}

function decodeFields(fields: Json): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = decodeValue(v);
  return out;
}

function encodeFields(data: Record<string, any>): {
  fields: Json;
  deletePaths: string[];
  transforms: Array<{ fieldPath: string; transform: FieldValueTransform }>;
} {
  const fields: Json = {};
  const deletePaths: string[] = [];
  const transforms: Array<{ fieldPath: string; transform: FieldValueTransform }> = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    if (isFieldValueTransform(v)) {
      if (v.kind === 'delete') {
        deletePaths.push(k);
      } else {
        transforms.push({ fieldPath: k, transform: v });
      }
      continue;
    }
    fields[k] = encodeValue(v);
  }
  return { fields, deletePaths, transforms };
}

function transformToRest(t: { fieldPath: string; transform: FieldValueTransform }): Json | null {
  const base = { fieldPath: t.fieldPath };
  switch (t.transform.kind) {
    case 'serverTimestamp':
      return { ...base, setToServerValue: 'REQUEST_TIME' };
    case 'increment': {
      const n = Number(t.transform.operand) || 0;
      return {
        ...base,
        increment: Number.isInteger(n) ? { integerValue: String(n) } : { doubleValue: n }
      };
    }
    case 'arrayUnion':
      return { ...base, appendMissingElements: { values: (t.transform.operand || []).map((v: any) => encodeValue(v)) } };
    case 'arrayRemove':
      return { ...base, removeAllFromArray: { values: (t.transform.operand || []).map((v: any) => encodeValue(v)) } };
    default:
      return null;
  }
}

// ── 참조·스냅샷 ──────────────────────────────────────────────────────────────

const documentRoot = (): string =>
  `https://firestore.googleapis.com/v1/projects/${resolveProjectId()}/databases/(default)/documents`;

/** 커밋 write 의 document name 은 URL 이 아닌 리소스 경로(projects/…/documents/…)여야 합니다. */
const fullDocumentName = (path: string): string =>
  `projects/${resolveProjectId()}/databases/(default)/documents/${path}`;

async function firestoreFetch(url: string, init: RequestInit = {}): Promise<{ status: number; json: Json; text: string }> {
  const token = await getGoogleAccessToken(SCOPE.datastore);
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });
  const text = await res.text();
  let json: Json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  return { status: res.status, json, text };
}

export class DocumentSnapshot {
  constructor(
    readonly id: string,
    readonly exists: boolean,
    private readonly raw: Json | null,
    readonly ref: DocumentReference
  ) {}
  data(): Record<string, any> | undefined {
    if (!this.exists || !this.raw) return undefined;
    return decodeFields(this.raw.fields || {});
  }
  get(field: string): any {
    const data = this.data();
    if (!data) return undefined;
    if (Object.prototype.hasOwnProperty.call(data, field)) return data[field];
    const parts = String(field || '').split('.').filter(Boolean);
    let cursor: any = data;
    for (const part of parts) {
      if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined;
      cursor = cursor[part];
    }
    return cursor;
  }
  get createTime(): Timestamp | null {
    return this.raw?.createTime ? Timestamp.fromISOString(this.raw.createTime) : null;
  }
  get updateTime(): Timestamp | null {
    return this.raw?.updateTime ? Timestamp.fromISOString(this.raw.updateTime) : null;
  }
}

export class QuerySnapshot {
  constructor(readonly docs: DocumentSnapshot[]) {}
  get size(): number {
    return this.docs.length;
  }
  get empty(): boolean {
    return this.docs.length === 0;
  }
  forEach(cb: (doc: DocumentSnapshot) => void): void {
    this.docs.forEach(cb);
  }
}

type Filter = { field: string; op: string; value: any };

const FILTER_OPS: Record<string, string> = {
  '==': 'EQUAL',
  '!=': 'NOT_EQUAL',
  '<': 'LESS_THAN',
  '<=': 'LESS_THAN_OR_EQUAL',
  '>': 'GREATER_THAN',
  '>=': 'GREATER_THAN_OR_EQUAL',
  'array-contains': 'ARRAY_CONTAINS',
  'array-contains-any': 'ARRAY_CONTAINS_ANY',
  in: 'IN',
  'not-in': 'NOT_IN'
};

export class WriteBatch {
  private writes: Json[] = [];
  constructor(private readonly db: Firestore) {}
  set(ref: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }): WriteBatch {
    this.writes.push(this.db.buildSetWrite(ref, data, Boolean(options?.merge)));
    return this;
  }
  update(ref: DocumentReference, data: Record<string, any>): WriteBatch {
    this.writes.push(this.db.buildUpdateWrite(ref, data));
    return this;
  }
  delete(ref: DocumentReference): WriteBatch {
    this.writes.push({ delete: fullDocumentName(ref.path) });
    return this;
  }
  create(ref: DocumentReference, data: Record<string, any>): WriteBatch {
    this.writes.push(this.db.buildUpdateWrite(ref, data, { exists: false }));
    return this;
  }
  async commit(): Promise<void> {
    if (!this.writes.length) return;
    const pending = this.writes.splice(0, this.writes.length);
    await this.db.commitWrites(pending);
  }
}

export class Transaction {
  private writes: Json[] = [];
  constructor(private readonly db: Firestore, private readonly transactionId?: string) {}
  async get(ref: DocumentReference): Promise<DocumentSnapshot> {
    return ref.get(this.transactionId);
  }
  create(ref: DocumentReference, data: Record<string, any>): Transaction {
    this.writes.push(this.db.buildUpdateWrite(ref, data, { exists: false }));
    return this;
  }
  set(ref: DocumentReference, data: Record<string, any>, options?: { merge?: boolean }): Transaction {
    this.writes.push(this.db.buildSetWrite(ref, data, Boolean(options?.merge)));
    return this;
  }
  update(ref: DocumentReference, data: Record<string, any>): Transaction {
    this.writes.push(this.db.buildUpdateWrite(ref, data));
    return this;
  }
  delete(ref: DocumentReference): Transaction {
    this.writes.push({ delete: fullDocumentName(ref.path) });
    return this;
  }
  _collect(): Json[] {
    return this.writes;
  }
}

export class DocumentReference {
  constructor(readonly firestore: Firestore, readonly path: string) {}
  get id(): string {
    return this.path.split('/').pop() || '';
  }
  collection(name: string): CollectionReference {
    return new CollectionReference(this.firestore, String(name), this.path);
  }
  async get(transactionId?: string): Promise<DocumentSnapshot> {
    const url = new URL(`${documentRoot()}/${this.path}`);
    if (transactionId) url.searchParams.set('transaction', transactionId);
    const res = await firestoreFetch(url.toString());
    if (res.status === 404) return new DocumentSnapshot(this.id, false, null, this);
    if (res.status !== 200) {
      throw new Error(`firestore_get_failed:${res.status}:${res.text.slice(0, 200)}`);
    }
    return new DocumentSnapshot(this.id, true, res.json, this);
  }
  async set(data: Record<string, any>, options?: { merge?: boolean }): Promise<void> {
    await this.firestore.commitWrites([this.firestore.buildSetWrite(this, data, Boolean(options?.merge))]);
  }
  async update(data: Record<string, any>): Promise<void> {
    await this.firestore.commitWrites([this.firestore.buildUpdateWrite(this, data)]);
  }
  async create(data: Record<string, any>): Promise<void> {
    await this.firestore.commitWrites([this.firestore.buildUpdateWrite(this, data, { exists: false })]);
  }
  async delete(): Promise<void> {
    await this.firestore.commitWrites([{ delete: fullDocumentName(this.path) }]);
  }
}

export class Query {
  protected filters: Filter[] = [];
  protected orders: Array<{ field: string; direction: 'asc' | 'desc' }> = [];
  protected selectFields: string[] | null = null;
  protected limitValue: number | null = null;
  protected offsetValue = 0;
  constructor(
    protected readonly firestore: Firestore,
    protected readonly collectionId: string,
    protected readonly parentPath: string = ''
  ) {}

  where(field: string, op: string, value: any): Query {
    const q = this._clone();
    q.filters.push({ field, op, value });
    return q;
  }
  orderBy(field: string, direction: 'asc' | 'desc' = 'asc'): Query {
    const q = this._clone();
    q.orders.push({ field, direction });
    return q;
  }
  select(...fields: string[]): Query {
    const q = this._clone();
    q.selectFields = fields.map((f) => String(f)).filter(Boolean);
    return q;
  }
  limit(n: number): Query {
    const q = this._clone();
    q.limitValue = n;
    return q;
  }
  offset(n: number): Query {
    const q = this._clone();
    q.offsetValue = n;
    return q;
  }
  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    const self = this;
    return {
      async get() {
        return self._runCount();
      }
    };
  }
  private _clone(): Query {
    const q = new Query(this.firestore, this.collectionId, this.parentPath);
    q.filters = [...this.filters];
    q.orders = [...this.orders];
    q.selectFields = this.selectFields ? [...this.selectFields] : null;
    q.limitValue = this.limitValue;
    q.offsetValue = this.offsetValue;
    return q;
  }

  private _queryEndpoint(suffix: 'runQuery' | 'runAggregationQuery'): string {
    return this.parentPath
      ? `${documentRoot()}/${this.parentPath}:${suffix}`
      : `${documentRoot()}:${suffix}`;
  }

  private _structuredQuery(): Json {
    const sq: Json = { from: [{ collectionId: this.collectionId }] };
    if (this.selectFields) {
      sq.select = { fields: this.selectFields.map((fieldPath) => ({ fieldPath })) };
    }
    if (this.filters.length === 1) {
      const f = this.filters[0];
      sq.where = {
        fieldFilter: {
          field: { fieldPath: f.field },
          op: FILTER_OPS[f.op] || 'EQUAL',
          value: encodeValue(f.value)
        }
      };
    } else if (this.filters.length > 1) {
      sq.where = {
        compositeFilter: {
          op: 'AND',
          filters: this.filters.map((f) => ({
            fieldFilter: {
              field: { fieldPath: f.field },
              op: FILTER_OPS[f.op] || 'EQUAL',
              value: encodeValue(f.value)
            }
          }))
        }
      };
    }
    if (this.orders.length) {
      sq.orderBy = this.orders.map((o) => ({
        field: { fieldPath: o.field },
        direction: o.direction === 'desc' ? 'DESCENDING' : 'ASCENDING'
      }));
    }
    if (this.limitValue !== null) sq.limit = this.limitValue;
    if (this.offsetValue) sq.offset = this.offsetValue;
    return sq;
  }

  async get(): Promise<QuerySnapshot> {
    // 조건 없이 컬렉션 전체를 읽는 경우 listDocuments 로 페이지네이션 처리합니다.
    if (!this.filters.length && !this.orders.length && !this.offsetValue) {
      return this._listAll();
    }
    const res = await firestoreFetch(this._queryEndpoint('runQuery'), {
      method: 'POST',
      body: JSON.stringify({ structuredQuery: this._structuredQuery() })
    });
    if (res.status !== 200) {
      throw new Error(`firestore_query_failed:${res.status}:${res.text.slice(0, 300)}`);
    }
    const docs: DocumentSnapshot[] = [];
    for (const item of Array.isArray(res.json) ? res.json : []) {
      if (!item?.document) continue;
      const doc = item.document;
      const id = String(doc.name || '').split('/').pop() || '';
      docs.push(new DocumentSnapshot(id, true, doc, new DocumentReference(this.firestore, String(doc.name).split('/documents/')[1] || '')));
    }
    return new QuerySnapshot(docs);
  }

  private async _listAll(): Promise<QuerySnapshot> {
    const docs: DocumentSnapshot[] = [];
    let pageToken = '';
    const collectionPath = this.parentPath ? `${this.parentPath}/${this.collectionId}` : this.collectionId;
    for (let guard = 0; guard < 200; guard += 1) {
      const remaining = this.limitValue !== null ? Math.max(0, this.limitValue - docs.length) : 1000;
      if (this.limitValue !== null && remaining <= 0) break;
      const url = new URL(`${documentRoot()}/${collectionPath}`);
      url.searchParams.set('pageSize', String(Math.min(1000, remaining)));
      if (this.selectFields) {
        for (const fieldPath of this.selectFields) {
          url.searchParams.append('mask.fieldPaths', fieldPath);
        }
      }
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await firestoreFetch(url.toString());
      if (res.status !== 200) {
        throw new Error(`firestore_list_failed:${res.status}:${res.text.slice(0, 300)}`);
      }
      for (const doc of res.json?.documents || []) {
        const id = String(doc.name || '').split('/').pop() || '';
        docs.push(new DocumentSnapshot(id, true, doc, new DocumentReference(this.firestore, String(doc.name).split('/documents/')[1] || '')));
      }
      if (this.limitValue !== null && docs.length >= this.limitValue) break;
      pageToken = String(res.json?.nextPageToken || '');
      if (!pageToken) break;
    }
    if (this.limitValue !== null) return new QuerySnapshot(docs.slice(0, this.limitValue));
    return new QuerySnapshot(docs);
  }

  private async _runCount(): Promise<{ data: () => { count: number } }> {
    const res = await firestoreFetch(this._queryEndpoint('runAggregationQuery'), {
      method: 'POST',
      body: JSON.stringify({
        structuredQuery: this._structuredQuery(),
        aggregations: [{ alias: 'count', count: {} }]
      })
    });
    if (res.status !== 200) {
      throw new Error(`firestore_count_failed:${res.status}:${res.text.slice(0, 300)}`);
    }
    const first = Array.isArray(res.json) ? res.json[0] : null;
    const raw = first?.result?.aggregateFields?.count?.integerValue;
    const count = Number(raw || 0);
    return { data: () => ({ count }) };
  }
}

export class CollectionReference extends Query {
  constructor(firestore: Firestore, collectionId: string, parentPath: string = '') {
    super(firestore, collectionId, parentPath);
  }
  get id(): string {
    return this.collectionId;
  }
  doc(id?: string): DocumentReference {
    const docId = id && String(id).trim() ? String(id) : generateDocId();
    const fullPath = this.parentPath ? `${this.parentPath}/${this.collectionId}/${docId}` : `${this.collectionId}/${docId}`;
    return new DocumentReference(this.firestore, fullPath);
  }
  async add(data: Record<string, any>): Promise<DocumentReference> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function generateDocId(): string {
  const bytes = new Uint8Array(20);
  (globalThis as any).crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 20; i += 1) out += ID_CHARS[bytes[i] % ID_CHARS.length];
  return out;
}

export class Firestore {
  collection(name: string): CollectionReference {
    return new CollectionReference(this, String(name));
  }
  batch(): WriteBatch {
    return new WriteBatch(this);
  }
  async runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    let lastError: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      let transactionId: string | undefined;
      try {
        const beginRes = await firestoreFetch(`${documentRoot()}:beginTransaction`, {
          method: 'POST',
          body: JSON.stringify({ options: { readWrite: {} } })
        });
        if (beginRes.status === 200 && beginRes.json?.transaction) {
          transactionId = String(beginRes.json.transaction);
        }
      } catch {
        // beginTransaction 실패 시 낙관적 커밋으로 안전하게 폴백
      }

      const tx = new Transaction(this, transactionId);
      try {
        const result = await fn(tx);
        const writes = tx._collect();
        if (transactionId) {
          await this.commitWrites(writes, transactionId);
        } else if (writes.length) {
          await this.commitWrites(writes);
        }
        return result;
      } catch (err: any) {
        if (transactionId) {
          await firestoreFetch(`${documentRoot()}:rollback`, {
            method: 'POST',
            body: JSON.stringify({ transaction: transactionId })
          }).catch(() => {});
        }
        lastError = err;
        const msg = String(err?.message || err);
        if (!/ALREADY_EXISTS|ABORTED|conflict|FAILED_PRECONDITION/i.test(msg)) throw err;
      }
    }
    throw lastError || new Error('transaction_failed');
  }

  buildSetWrite(ref: DocumentReference, data: Record<string, any>, merge: boolean): Json {
    const { fields, deletePaths, transforms } = encodeFields(data);
    const restTransforms = transforms.map(transformToRest).filter(Boolean);
    const valuePaths = Object.keys(fields);

    // merge: true 인데 일반 필드·삭제 없이 transform(serverTimestamp/increment 등)만 있는 경우
    // updateMask 에 transform 필드를 넣으면 Firestore REST 가 필드를 삭제/충돌 처리하므로 전용 transform write 를 사용합니다.
    if (merge && !valuePaths.length && !deletePaths.length && restTransforms.length) {
      return {
        transform: {
          document: fullDocumentName(ref.path),
          fieldTransforms: restTransforms
        }
      };
    }

    const write: Json = { update: { name: fullDocumentName(ref.path), fields } };
    if (merge) {
      write.updateMask = { fieldPaths: [...valuePaths, ...deletePaths] };
    }
    if (restTransforms.length) {
      write.updateTransforms = restTransforms;
    }
    return write;
  }

  buildUpdateWrite(ref: DocumentReference, data: Record<string, any>, precondition?: { exists: boolean }): Json {
    const { fields, deletePaths, transforms } = encodeFields(data);
    const restTransforms = transforms.map(transformToRest).filter(Boolean);
    const valuePaths = Object.keys(fields);
    const effectivePrecondition = precondition ?? { exists: true };

    if (!valuePaths.length && !deletePaths.length && restTransforms.length) {
      return {
        transform: {
          document: fullDocumentName(ref.path),
          fieldTransforms: restTransforms
        },
        currentDocument: { exists: effectivePrecondition.exists }
      };
    }

    const write: Json = { update: { name: fullDocumentName(ref.path), fields } };
    write.updateMask = { fieldPaths: [...valuePaths, ...deletePaths] };
    if (restTransforms.length) write.updateTransforms = restTransforms;
    write.currentDocument = { exists: effectivePrecondition.exists };
    return write;
  }

  async commitWrites(writes: Json[], transactionId?: string): Promise<void> {
    if (!writes.length && !transactionId) return;
    if (transactionId) {
      const res = await firestoreFetch(`${documentRoot()}:commit`, {
        method: 'POST',
        body: JSON.stringify({ transaction: transactionId, writes })
      });
      if (res.status !== 200) {
        throw new Error(`firestore_commit_failed:${res.status}:${res.text.slice(0, 300)}`);
      }
      return;
    }
    // Firestore commit 은 한 번에 최대 500건입니다.
    for (let i = 0; i < writes.length; i += 400) {
      const chunk = writes.slice(i, i + 400);
      const res = await firestoreFetch(`${documentRoot()}:commit`, {
        method: 'POST',
        body: JSON.stringify({ writes: chunk })
      });
      if (res.status !== 200) {
        throw new Error(`firestore_commit_failed:${res.status}:${res.text.slice(0, 300)}`);
      }
    }
  }
}

let singleton: Firestore | null = null;

export function getFirestore(_app?: any, _databaseId?: string): Firestore {
  if (!singleton) singleton = new Firestore();
  return singleton;
}

export function initializeFirestore(_app?: any, _settings?: any, _databaseId?: string): Firestore {
  return getFirestore();
}

export { Timestamp as FirestoreTimestamp };
