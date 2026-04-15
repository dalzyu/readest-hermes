import type { LanguageModel, EmbeddingModel } from 'ai';

// ---------------------------------------------------------------------------
// Provider type taxonomy
// ---------------------------------------------------------------------------

/** All supported provider types. */
export type AIProviderType =
  | 'ollama'
  | 'openai'
  | 'openai-compatible'
  | 'anthropic'
  | 'google'
  | 'openrouter'
  | 'deepseek'
  | 'mistral'
  | 'groq'
  | 'xai'
  | 'cohere'
  | 'fireworks'
  | 'togetherai'
  | 'ai-gateway';

/** @deprecated Use AIProviderType. Kept for migration convenience. */
export type AIProviderName = AIProviderType;

export type AIProviderApiStyle = 'chat-completions' | 'responses';

// ---------------------------------------------------------------------------
// Inference parameters
// ---------------------------------------------------------------------------

export interface InferenceParams {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  topK?: number;
  seed?: number;
  stopSequences?: string[];
}

/** Per-task default overrides. */
export const TASK_INFERENCE_DEFAULTS: Record<AITaskType, InferenceParams> = {
  translation: { temperature: 0.3, maxTokens: 1024 },
  dictionary: { temperature: 0.3, maxTokens: 1024 },
  chat: { temperature: 0.7, maxTokens: 2048 },
  embedding: {},
};

// ---------------------------------------------------------------------------
// Provider configuration (one entry per user-configured provider)
// ---------------------------------------------------------------------------

export interface ProviderConfig {
  id: string;
  name: string;
  providerType: AIProviderType;
  baseUrl: string;
  model: string;
  apiKey?: string;
  embeddingBaseUrl?: string;
  embeddingModel?: string;
  embeddingApiKey?: string;
  apiStyle?: AIProviderApiStyle;
  inferenceParams?: InferenceParams;
}

// ---------------------------------------------------------------------------
// Task routing
// ---------------------------------------------------------------------------

export type AITaskType = 'translation' | 'dictionary' | 'chat' | 'embedding';

export interface ModelAssignments {
  translation?: string; // provider config id
  dictionary?: string;
  chat?: string;
  embedding?: string;
}

// ---------------------------------------------------------------------------
// Provider interface (runtime)
// ---------------------------------------------------------------------------

export interface AIProvider {
  id: string;
  name: string;
  providerType: AIProviderType;
  requiresAuth: boolean;

  getModel(params?: InferenceParams): LanguageModel;
  getEmbeddingModel(): EmbeddingModel;

  isAvailable(): Promise<boolean>;
  healthCheck(options?: { requireEmbedding?: boolean }): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Top-level AI settings (persisted in SystemSettings.aiSettings)
// ---------------------------------------------------------------------------

export interface AISettings {
  enabled: boolean;
  providers: ProviderConfig[];
  activeProviderId: string;
  modelAssignments: ModelAssignments;

  spoilerProtection: boolean;
  maxContextChunks: number;
  indexingMode: 'on-demand' | 'background';
}

export interface TextChunk {
  id: string;
  bookHash: string;
  sectionIndex: number;
  chapterTitle: string;
  text: string;
  embedding?: number[];
  pageNumber: number; // page number using Readest's 1500 chars/page formula
}

export interface ScoredChunk extends TextChunk {
  score: number;
  searchMethod: 'bm25' | 'vector' | 'hybrid';
}

export interface BookIndexMeta {
  bookHash: string;
  bookTitle: string;
  authorName: string;
  totalSections: number;
  totalChunks: number;
  embeddingModel: string;
  lastUpdated: number;
}

export interface IndexingState {
  bookHash: string;
  status: 'idle' | 'indexing' | 'complete' | 'error';
  progress: number;
  chunksProcessed: number;
  totalChunks: number;
  error?: string;
}

export interface EmbeddingProgress {
  current: number;
  total: number;
  phase: 'chunking' | 'embedding' | 'indexing';
}

export interface IndexResult {
  status: 'complete' | 'empty' | 'partial' | 'already-indexed';
  chunksProcessed: number;
  totalSections: number;
  skippedSections: number;
  errorMessages: string[];
  durationMs: number;
}

// stored AI conversation for a book
export interface AIConversation {
  id: string;
  bookHash: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

// single message in an AI conversation
export interface AIMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}
