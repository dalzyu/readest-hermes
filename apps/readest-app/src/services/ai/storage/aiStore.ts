import { TextChunk, ScoredChunk, BookIndexMeta, AIConversation, AIMessage } from '../types';
import type { VocabularyEntry, BookSeries } from '@/services/contextTranslation/types';
import { aiLogger } from '../logger';

const DB_NAME = 'hermes-ai';
const DB_VERSION = 8;
const CHUNKS_STORE = 'chunks';
const META_STORE = 'bookMeta';
const CONVERSATIONS_STORE = 'conversations';
const MESSAGES_STORE = 'messages';
const VOCAB_STORE = 'vocabulary';
const SERIES_STORE = 'bookSeries';
const DICTIONARY_STORE = 'dictionaryData';

export interface PageSearchBounds {
  minPage?: number;
  maxPage?: number;
}

export interface LegacyBookSeriesRecord {
  id: string;
  name: string;
  bookHashes: string[];
  createdAt: number;
  updatedAt: number;
}

function isLegacySeriesRecord(
  value: BookSeries | LegacyBookSeriesRecord,
): value is LegacyBookSeriesRecord {
  return 'bookHashes' in value;
}

export function normalizeSeriesRecord(raw: BookSeries | LegacyBookSeriesRecord): BookSeries {
  if (!isLegacySeriesRecord(raw)) {
    return {
      ...raw,
      volumes: [...raw.volumes].sort((a, b) => a.volumeIndex - b.volumeIndex),
    };
  }

  return {
    id: raw.id,
    name: raw.name,
    volumes: raw.bookHashes.map((bookHash, index) => ({
      bookHash,
      volumeIndex: index + 1,
      label: `Vol. ${index + 1}`,
    })),
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

export function normalizeSeriesRecords(
  records: Array<BookSeries | LegacyBookSeriesRecord>,
): BookSeries[] {
  return records.map(normalizeSeriesRecord).sort((a, b) => a.name.localeCompare(b.name));
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function normalizeSearchBounds(bounds?: number | PageSearchBounds): PageSearchBounds {
  if (typeof bounds === 'number') {
    return { maxPage: bounds };
  }

  return bounds ?? {};
}

function isPageWithinBounds(pageNumber: number, bounds?: number | PageSearchBounds): boolean {
  const normalized = normalizeSearchBounds(bounds);
  if (normalized.minPage !== undefined && pageNumber < normalized.minPage) return false;
  if (normalized.maxPage !== undefined && pageNumber > normalized.maxPage) return false;
  return true;
}

class AIStore {
  private db: IDBDatabase | null = null;
  private chunkCache = new Map<string, TextChunk[]>();
  private metaCache = new Map<string, BookIndexMeta>();
  private conversationCache = new Map<string, AIConversation[]>();
  private seriesMigrationComplete = false;
  private seriesMigrationPromise: Promise<void> | null = null;

  async recoverFromError(): Promise<void> {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // ignore close errors
      }
      this.db = null;
    }
    this.chunkCache.clear();
    this.metaCache.clear();
    this.conversationCache.clear();
    this.seriesMigrationComplete = false;
    this.seriesMigrationPromise = null;
    await this.openDB();
  }

  private async openDB(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => {
        aiLogger.store.error('openDB', request.error?.message || 'Unknown error');
        reject(request.error);
      };
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // force re-indexing on early schema changes
        if (oldVersion > 0 && oldVersion < 2) {
          if (db.objectStoreNames.contains(CHUNKS_STORE)) db.deleteObjectStore(CHUNKS_STORE);
          if (db.objectStoreNames.contains(META_STORE)) db.deleteObjectStore(META_STORE);
          if (db.objectStoreNames.contains('bm25Indices')) db.deleteObjectStore('bm25Indices');
          aiLogger.store.error('migration', 'Clearing old AI stores for re-indexing (v2)');
        }

        if (oldVersion < 8 && db.objectStoreNames.contains('bm25Indices')) {
          db.deleteObjectStore('bm25Indices');
        }

        const upgradeTx = (event.target as IDBOpenDBRequest).transaction!;
        const openOrCreateStore = (storeName: string, keyPath: string): IDBObjectStore => {
          if (!db.objectStoreNames.contains(storeName)) {
            return db.createObjectStore(storeName, { keyPath });
          }
          return upgradeTx.objectStore(storeName);
        };
        const ensureIndex = (store: IDBObjectStore, indexName: string, keyPath: string): void => {
          if (!store.indexNames.contains(indexName)) {
            store.createIndex(indexName, keyPath, { unique: false });
          }
        };

        const chunksStore = openOrCreateStore(CHUNKS_STORE, 'id');
        ensureIndex(chunksStore, 'bookHash', 'bookHash');

        openOrCreateStore(META_STORE, 'bookHash');

        const conversationsStore = openOrCreateStore(CONVERSATIONS_STORE, 'id');
        ensureIndex(conversationsStore, 'bookHash', 'bookHash');

        const messagesStore = openOrCreateStore(MESSAGES_STORE, 'id');
        ensureIndex(messagesStore, 'conversationId', 'conversationId');

        const vocabularyStore = openOrCreateStore(VOCAB_STORE, 'id');
        ensureIndex(vocabularyStore, 'bookHash', 'bookHash');
        ensureIndex(vocabularyStore, 'term', 'term');
        ensureIndex(vocabularyStore, 'addedAt', 'addedAt');
        ensureIndex(vocabularyStore, 'dueAt', 'dueAt');

        openOrCreateStore(SERIES_STORE, 'id');
        openOrCreateStore(DICTIONARY_STORE, 'id');
      };
    });
  }

  async saveMeta(meta: BookIndexMeta): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readwrite');
      tx.objectStore(META_STORE).put(meta);
      tx.oncomplete = () => {
        this.metaCache.set(meta.bookHash, meta);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveMeta', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getMeta(bookHash: string): Promise<BookIndexMeta | null> {
    if (this.metaCache.has(bookHash)) return this.metaCache.get(bookHash)!;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(META_STORE, 'readonly').objectStore(META_STORE).get(bookHash);
      req.onsuccess = () => {
        const meta = req.result as BookIndexMeta | undefined;
        if (meta) this.metaCache.set(bookHash, meta);
        resolve(meta || null);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async isIndexed(bookHash: string): Promise<boolean> {
    const meta = await this.getMeta(bookHash);
    return meta !== null && meta.totalChunks > 0;
  }

  async getIndexedStateMap(bookHashes: string[]): Promise<Record<string, boolean>> {
    const uniqueBookHashes = [...new Set(bookHashes.filter(Boolean))];
    if (uniqueBookHashes.length === 0) return {};

    const result: Record<string, boolean> = {};
    const pending: string[] = [];

    for (const bookHash of uniqueBookHashes) {
      const cachedMeta = this.metaCache.get(bookHash);
      if (cachedMeta) {
        result[bookHash] = cachedMeta.totalChunks > 0;
      } else {
        pending.push(bookHash);
      }
    }

    if (pending.length === 0) return result;

    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(META_STORE, 'readonly');
      const store = tx.objectStore(META_STORE);
      let remaining = pending.length;

      for (const bookHash of pending) {
        const req = store.get(bookHash);
        req.onsuccess = () => {
          const meta = req.result as BookIndexMeta | undefined;
          if (meta) this.metaCache.set(bookHash, meta);
          result[bookHash] = meta !== undefined && meta.totalChunks > 0;
          remaining -= 1;
          if (remaining === 0) resolve(result);
        };
        req.onerror = () => reject(req.error);
      }

      tx.onerror = () => reject(tx.error);
    });
  }

  async saveChunks(chunks: TextChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    const bookHash = chunks[0]!.bookHash;
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHUNKS_STORE, 'readwrite');
      const store = tx.objectStore(CHUNKS_STORE);
      for (const chunk of chunks) store.put(chunk);
      tx.oncomplete = () => {
        this.chunkCache.set(bookHash, chunks);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveChunks', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getChunks(bookHash: string): Promise<TextChunk[]> {
    if (this.chunkCache.has(bookHash)) {
      aiLogger.store.loadChunks(bookHash, this.chunkCache.get(bookHash)!.length);
      return this.chunkCache.get(bookHash)!;
    }
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(CHUNKS_STORE, 'readonly')
        .objectStore(CHUNKS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const chunks = req.result as TextChunk[];
        this.chunkCache.set(bookHash, chunks);
        aiLogger.store.loadChunks(bookHash, chunks.length);
        resolve(chunks);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async vectorSearch(
    bookHash: string,
    queryEmbedding: number[],
    topK: number,
    maxPage?: number | PageSearchBounds,
  ): Promise<ScoredChunk[]> {
    const chunks = await this.getChunks(bookHash);
    const beforeFilter = chunks.filter((c) => c.embedding).length;
    const scored: ScoredChunk[] = [];
    for (const chunk of chunks) {
      if (!isPageWithinBounds(chunk.pageNumber, maxPage)) continue;
      if (!chunk.embedding) continue;
      scored.push({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
        searchMethod: 'vector',
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, topK);
    const normalizedBounds = normalizeSearchBounds(maxPage);
    if (normalizedBounds.maxPage !== undefined)
      aiLogger.search.spoilerFiltered(beforeFilter, results.length, normalizedBounds.maxPage);
    if (results.length > 0) aiLogger.search.vectorResults(results.length, results[0]!.score);
    return results;
  }

  async clearBook(bookHash: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CHUNKS_STORE, META_STORE], 'readwrite');
      const cursor = tx.objectStore(CHUNKS_STORE).index('bookHash').openCursor(bookHash);
      cursor.onsuccess = (e) => {
        const c = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (c) {
          c.delete();
          c.continue();
        }
      };
      tx.objectStore(META_STORE).delete(bookHash);
      tx.oncomplete = () => {
        this.chunkCache.delete(bookHash);
        this.metaCache.delete(bookHash);
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  // conversation persistence methods

  async saveConversation(conversation: AIConversation): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      tx.objectStore(CONVERSATIONS_STORE).put(conversation);
      tx.oncomplete = () => {
        this.conversationCache.delete(conversation.bookHash);
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('saveConversation', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getConversations(bookHash: string): Promise<AIConversation[]> {
    if (this.conversationCache.has(bookHash)) {
      return this.conversationCache.get(bookHash)!;
    }
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(CONVERSATIONS_STORE, 'readonly')
        .objectStore(CONVERSATIONS_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () => {
        const conversations = (req.result as AIConversation[]).sort(
          (a, b) => b.updatedAt - a.updatedAt,
        );
        this.conversationCache.set(bookHash, conversations);
        resolve(conversations);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async deleteConversation(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([CONVERSATIONS_STORE, MESSAGES_STORE], 'readwrite');

      // delete conversation
      tx.objectStore(CONVERSATIONS_STORE).delete(id);

      // delete all messages for this conversation
      const cursor = tx.objectStore(MESSAGES_STORE).index('conversationId').openCursor(id);
      cursor.onsuccess = (e) => {
        const c = (e.target as IDBRequest<IDBCursorWithValue>).result;
        if (c) {
          c.delete();
          c.continue();
        }
      };

      tx.oncomplete = () => {
        this.conversationCache.clear();
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('deleteConversation', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async updateConversationTitle(id: string, title: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CONVERSATIONS_STORE, 'readwrite');
      const store = tx.objectStore(CONVERSATIONS_STORE);
      const req = store.get(id);
      req.onsuccess = () => {
        const conversation = req.result as AIConversation | undefined;
        if (conversation) {
          conversation.title = title;
          conversation.updatedAt = Date.now();
          store.put(conversation);
        }
      };
      tx.oncomplete = () => {
        this.conversationCache.clear();
        resolve();
      };
      tx.onerror = () => {
        aiLogger.store.error('updateConversationTitle', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async saveMessage(message: AIMessage): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(MESSAGES_STORE, 'readwrite');
      tx.objectStore(MESSAGES_STORE).put(message);
      tx.oncomplete = () => resolve();
      tx.onerror = () => {
        aiLogger.store.error('saveMessage', tx.error?.message || 'TX error');
        reject(tx.error);
      };
    });
  }

  async getMessages(conversationId: string): Promise<AIMessage[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(MESSAGES_STORE, 'readonly')
        .objectStore(MESSAGES_STORE)
        .index('conversationId')
        .getAll(conversationId);
      req.onsuccess = () => {
        const messages = (req.result as AIMessage[]).sort((a, b) => a.createdAt - b.createdAt);
        resolve(messages);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // vocabulary methods

  async saveVocabularyEntry(entry: VocabularyEntry): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VOCAB_STORE, 'readwrite');
      tx.objectStore(VOCAB_STORE).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getVocabularyByBook(bookHash: string): Promise<VocabularyEntry[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db
        .transaction(VOCAB_STORE, 'readonly')
        .objectStore(VOCAB_STORE)
        .index('bookHash')
        .getAll(bookHash);
      req.onsuccess = () =>
        resolve((req.result as VocabularyEntry[]).sort((a, b) => b.addedAt - a.addedAt));
      req.onerror = () => reject(req.error);
    });
  }

  async getAllVocabulary(): Promise<VocabularyEntry[]> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(VOCAB_STORE, 'readonly').objectStore(VOCAB_STORE).getAll();
      req.onsuccess = () =>
        resolve((req.result as VocabularyEntry[]).sort((a, b) => b.addedAt - a.addedAt));
      req.onerror = () => reject(req.error);
    });
  }

  async deleteVocabularyEntry(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(VOCAB_STORE, 'readwrite');
      tx.objectStore(VOCAB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async searchVocabulary(query: string): Promise<VocabularyEntry[]> {
    const all = await this.getAllVocabulary();
    const lower = query.toLowerCase();
    return all.filter(
      (e) => e.term.toLowerCase().includes(lower) || e.context.toLowerCase().includes(lower),
    );
  }

  // series methods

  private async getRawSeriesRecords(): Promise<Array<BookSeries | LegacyBookSeriesRecord>> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(SERIES_STORE, 'readonly').objectStore(SERIES_STORE).getAll();
      req.onsuccess = () => resolve(req.result as Array<BookSeries | LegacyBookSeriesRecord>);
      req.onerror = () => reject(req.error);
    });
  }

  async saveSeries(series: BookSeries): Promise<void> {
    const normalized = normalizeSeriesRecord(series);
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SERIES_STORE, 'readwrite');
      tx.objectStore(SERIES_STORE).put(normalized);
      tx.oncomplete = () => {
        this.seriesMigrationComplete = true;
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async saveLegacySeriesRecord(series: LegacyBookSeriesRecord): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SERIES_STORE, 'readwrite');
      tx.objectStore(SERIES_STORE).put(series);
      tx.oncomplete = () => {
        this.seriesMigrationComplete = false;
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    });
  }

  async migrateLegacySeriesRecords(): Promise<void> {
    if (this.seriesMigrationComplete) return;
    if (this.seriesMigrationPromise) {
      await this.seriesMigrationPromise;
      return;
    }

    this.seriesMigrationPromise = (async () => {
      const records = await this.getRawSeriesRecords();
      const legacyRecords = records.filter(isLegacySeriesRecord);
      if (legacyRecords.length === 0) {
        this.seriesMigrationComplete = true;
        return;
      }

      const db = await this.openDB();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SERIES_STORE, 'readwrite');
        const store = tx.objectStore(SERIES_STORE);
        for (const record of legacyRecords) {
          store.put(normalizeSeriesRecord(record));
        }
        tx.oncomplete = () => {
          this.seriesMigrationComplete = true;
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      });
    })();

    try {
      await this.seriesMigrationPromise;
    } finally {
      this.seriesMigrationPromise = null;
    }
  }

  async getAllSeries(): Promise<BookSeries[]> {
    await this.migrateLegacySeriesRecords();
    const records = await this.getRawSeriesRecords();
    return normalizeSeriesRecords(records);
  }

  async getSeriesForBook(bookHash: string): Promise<BookSeries | null> {
    const all = await this.getAllSeries();
    return (
      all.find((series) => series.volumes.some((volume) => volume.bookHash === bookHash)) || null
    );
  }

  async deleteSeries(id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SERIES_STORE, 'readwrite');
      tx.objectStore(SERIES_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async getRecord<T>(store: string, id: string): Promise<T | null> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(id);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  }

  async putRecord<T>(store: string, record: T): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async deleteRecord(store: string, id: string): Promise<void> {
    const db = await this.openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
}

export const aiStore = new AIStore();
