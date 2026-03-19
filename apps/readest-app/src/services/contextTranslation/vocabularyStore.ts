// All persistence is handled by aiStore (DB v4).
// Previously this opened its own IndexedDB connection which conflicted with aiStore.
export { aiStore as vocabularyStore } from '@/services/ai/storage/aiStore';
