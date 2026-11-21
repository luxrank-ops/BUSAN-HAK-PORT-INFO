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

function encodeFields(data: Record<string, any>): { fields: Json; transforms: Array<{ fieldPath: string; transform: FieldValueTransform }> } {
  const fields: Json = {};
  const transforms: Array<{ fieldPath: string; transform: FieldValueTransform }> = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined) continue;
    if (isFieldValueTransform(v)) {
      transforms.push({ fieldPath: k, transform: v });
      continue;
    }
    fields[k] = encodeValue(v);
  }
  return { fields, transforms };
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
    return data ? data[field] : undefined;
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
  constructor(private readonly db: Firestore) {}
  async get(ref: DocumentReference): Promise<DocumentSnapshot> {
    return ref.get();
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
  async get(): Promise<DocumentSnapshot> {
    const res = await firestoreFetch(`${documentRoot()}/${this.path}`);
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
  protected limitValue: number | null = null;
  protected offsetValue = 0;
  constructor(protected readonly firestore: Firestore, protected readonly collectionId: string) {}

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
    const q = new Query(this.firestore, this.collectionId);
    q.filters = [...this.filters];
    q.orders = [...this.orders];
    q.limitValue = this.limitValue;
    q.offsetValue = this.offsetValue;
    return q;
  }

  private _structuredQuery(): Json {
    const sq: Json = { from: [{ collectionId: this.collectionId }] };
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
    const res = await firestoreFetch(`${documentRoot()}:runQuery`, {
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
    for (let guard = 0; guard < 30; guard += 1) {
      const url = new URL(`${documentRoot()}/${this.collectionId}`);
      url.searchParams.set('pageSize', '1000');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const res = await firestoreFetch(url.toString());
      if (res.status !== 200) {
        throw new Error(`firestore_list_failed:${res.status}:${res.text.slice(0, 300)}`);
      }
      for (const doc of res.json?.documents || []) {
        const id = String(doc.name || '').split('/').pop() || '';
        docs.push(new DocumentSnapshot(id, true, doc, new DocumentReference(this.firestore, String(doc.name).split('/documents/')[1] || '')));
      }
      pageToken = String(res.json?.nextPageToken || '');
      if (!pageToken) break;
    }
    if (this.limitValue !== null) return new QuerySnapshot(docs.slice(0, this.limitValue));
    return new QuerySnapshot(docs);
  }

  private async _runCount(): Promise<{ data: () => { count: number } }> {
    const res = await firestoreFetch(`${documentRoot()}:runAggregationQuery`, {
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
  constructor(firestore: Firestore, collectionId: string) {
    super(firestore, collectionId);
  }
  get id(): string {
    return this.collectionId;
  }
  doc(id?: string): DocumentReference {
    const docId = id && String(id).trim() ? String(id) : generateDocId();
    return new DocumentReference(this.firestore, `${this.collectionId}/${docId}`);
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
    // 단일 문서 선점(create) 위주로 쓰이므로, 충돌 시 재시도하는 낙관적 트랜잭션으로 처리합니다.
    let lastError: any = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const tx = new Transaction(this);
      try {
        const result = await fn(tx);
        const writes = tx._collect();
        if (writes.length) await this.commitWrites(writes);
        return result;
      } catch (err: any) {
        lastError = err;
        const msg = String(err?.message || err);
        if (!/ALREADY_EXISTS|ABORTED|conflict|FAILED_PRECONDITION/i.test(msg)) throw err;
      }
    }
    throw lastError || new Error('transaction_failed');
  }

  buildSetWrite(ref: DocumentReference, data: Record<string, any>, merge: boolean): Json {
    const { fields, transforms } = encodeFields(data);
    const write: Json = { update: { name: fullDocumentName(ref.path), fields } };
    if (merge) {
      const maskPaths = Object.keys(data || {}).filter((k) => (data as any)[k] !== undefined);
      write.updateMask = { fieldPaths: maskPaths };
    }
    if (transforms.length) {
      write.updateTransforms = transforms.map(transformToRest).filter(Boolean);
    }
    return write;
  }

  buildUpdateWrite(ref: DocumentReference, data: Record<string, any>, precondition?: { exists: boolean }): Json {
    const { fields, transforms } = encodeFields(data);
    const write: Json = { update: { name: fullDocumentName(ref.path), fields } };
    write.updateMask = { fieldPaths: Object.keys(data || {}).filter((k) => (data as any)[k] !== undefined) };
    if (transforms.length) write.updateTransforms = transforms.map(transformToRest).filter(Boolean);
    if (precondition) write.currentDocument = { exists: precondition.exists };
    return write;
  }

  async commitWrites(writes: Json[]): Promise<void> {
    if (!writes.length) return;
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
