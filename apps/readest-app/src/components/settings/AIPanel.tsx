import clsx from 'clsx';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  PiCheckCircle,
  PiWarningCircle,
  PiArrowsClockwise,
  PiSpinner,
  PiTrash,
  PiPencilSimple,
  PiPlus,
} from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { createProviderFromConfig } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import type {
  AISettings,
  AIProviderType,
  AIProviderApiStyle,
  ProviderConfig,
  AITaskType,
} from '@/services/ai/types';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const PROVIDER_TYPE_LABELS: Record<AIProviderType, string> = {
  ollama: 'Ollama (Local)',
  openai: 'OpenAI',
  'openai-compatible': 'OpenAI-Compatible',
  anthropic: 'Anthropic',
  google: 'Google AI',
  openrouter: 'OpenRouter',
  deepseek: 'DeepSeek',
  mistral: 'Mistral',
  groq: 'Groq',
  xai: 'xAI (Grok)',
  cohere: 'Cohere',
  fireworks: 'Fireworks',
  togetherai: 'Together AI',
  'ai-gateway': 'AI Gateway (Cloud)',
};

const PROVIDER_TYPES_ORDERED: AIProviderType[] = [
  'ollama',
  'openai-compatible',
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
  'mistral',
  'groq',
  'ai-gateway',
];

const REQUIRES_API_KEY: Set<AIProviderType> = new Set([
  'openai',
  'anthropic',
  'google',
  'openrouter',
  'deepseek',
  'mistral',
  'groq',
  'xai',
  'cohere',
  'fireworks',
  'togetherai',
  'ai-gateway',
]);

const HAS_API_STYLE: Set<AIProviderType> = new Set(['openai-compatible', 'openai']);

const HAS_EMBEDDING: Set<AIProviderType> = new Set([
  'ollama',
  'openai',
  'openai-compatible',
  'google',
  'mistral',
  'ai-gateway',
]);

const TASK_LABELS: Record<AITaskType, string> = {
  translation: 'Translation',
  dictionary: 'Dictionary',
  chat: 'Chat',
  embedding: 'Embedding',
};

function generateProviderId(): string {
  return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function emptyConfig(providerType: AIProviderType): ProviderConfig {
  return {
    id: generateProviderId(),
    name: PROVIDER_TYPE_LABELS[providerType] ?? providerType,
    providerType,
    baseUrl:
      providerType === 'ollama'
        ? 'http://127.0.0.1:11434'
        : providerType === 'openai-compatible'
          ? 'http://127.0.0.1:8080'
          : '',
    model: providerType === 'ollama' ? 'llama3.2' : '',
    embeddingModel: providerType === 'ollama' ? 'nomic-embed-text' : undefined,
    embeddingBaseUrl: providerType === 'openai-compatible' ? 'http://127.0.0.1:8081' : undefined,
    apiStyle: HAS_API_STYLE.has(providerType) ? 'chat-completions' : undefined,
  };
}

// ---------------------------------------------------------------------------
// ProviderForm — inline add/edit form for one ProviderConfig
// ---------------------------------------------------------------------------

interface ProviderFormProps {
  config: ProviderConfig;
  onChange: (config: ProviderConfig) => void;
  onSave: () => void;
  onCancel: () => void;
  isNew: boolean;
  _: (key: string) => string;
}

const ProviderForm: React.FC<ProviderFormProps> = ({
  config,
  onChange,
  onSave,
  onCancel,
  isNew,
  _,
}) => {
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [fetchingModels, setFetchingModels] = useState(false);

  const update = (patch: Partial<ProviderConfig>) => onChange({ ...config, ...patch });

  const fetchOllamaModels = useCallback(async () => {
    if (!config.baseUrl) return;
    setFetchingModels(true);
    try {
      const response = await fetch(`${config.baseUrl}/api/tags`);
      if (!response.ok) throw new Error('Failed');
      const data = await response.json();
      setOllamaModels(data.models?.map((m: { name: string }) => m.name) || []);
    } catch {
      setOllamaModels([]);
    } finally {
      setFetchingModels(false);
    }
  }, [config.baseUrl]);

  useEffect(() => {
    if (config.providerType === 'ollama' && config.baseUrl) {
      fetchOllamaModels();
    }
  }, [config.providerType, config.baseUrl, fetchOllamaModels]);

  return (
    <div className='card border-base-200 bg-base-100 border shadow'>
      <div className='divide-base-200 divide-y'>
        {/* Provider Type */}
        <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
          <span>{_('Provider Type')}</span>
          <select
            className='select select-bordered select-sm bg-base-100 text-base-content w-full'
            value={config.providerType}
            onChange={(e) => {
              const newType = e.target.value as AIProviderType;
              const fresh = emptyConfig(newType);
              onChange({ ...fresh, id: config.id, name: config.name || fresh.name });
            }}
          >
            {PROVIDER_TYPES_ORDERED.map((t) => (
              <option key={t} value={t}>
                {PROVIDER_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        {/* Name */}
        <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
          <span>{_('Display Name')}</span>
          <input
            type='text'
            className='input input-bordered input-sm w-full'
            value={config.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={PROVIDER_TYPE_LABELS[config.providerType]}
          />
        </div>

        {/* Base URL (for types that need it) */}
        {(config.providerType === 'ollama' ||
          config.providerType === 'openai-compatible' ||
          config.providerType === 'openai') && (
          <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
            <div className='flex w-full items-center justify-between'>
              <span>{_('Server URL')}</span>
              {config.providerType === 'ollama' && (
                <button
                  className='btn btn-ghost btn-xs'
                  onClick={fetchOllamaModels}
                  disabled={fetchingModels}
                  title={_('Refresh Models')}
                >
                  <PiArrowsClockwise className='size-4' />
                </button>
              )}
            </div>
            <input
              type='text'
              className='input input-bordered input-sm w-full'
              value={config.baseUrl}
              onChange={(e) => update({ baseUrl: e.target.value })}
              placeholder={
                config.providerType === 'ollama'
                  ? 'http://127.0.0.1:11434'
                  : 'http://127.0.0.1:8080'
              }
            />
            {config.providerType === 'openai-compatible' && (
              <p className='text-base-content/50 text-xs'>
                {_('Works with llama.cpp, LM Studio, vLLM, LocalAI, Jan.ai, KoboldCpp, and more')}
              </p>
            )}
          </div>
        )}

        {/* API Key */}
        {REQUIRES_API_KEY.has(config.providerType) && (
          <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
            <span>{_('API Key')}</span>
            <input
              type='password'
              className='input input-bordered input-sm w-full'
              value={config.apiKey ?? ''}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={
                config.providerType === 'openrouter'
                  ? 'sk-or-...'
                  : config.providerType === 'anthropic'
                    ? 'sk-ant-...'
                    : 'sk-...'
              }
            />
          </div>
        )}

        {/* Optional API Key for openai-compatible */}
        {config.providerType === 'openai-compatible' && (
          <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
            <span>{_('API Key (optional)')}</span>
            <input
              type='password'
              className='input input-bordered input-sm w-full'
              value={config.apiKey ?? ''}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={_('Leave blank if not required')}
            />
          </div>
        )}

        {/* API Style */}
        {HAS_API_STYLE.has(config.providerType) && (
          <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
            <span>{_('API Style')}</span>
            <select
              className='select select-bordered select-sm bg-base-100 text-base-content w-full'
              value={config.apiStyle || 'chat-completions'}
              onChange={(e) => update({ apiStyle: e.target.value as AIProviderApiStyle })}
            >
              <option value='chat-completions'>{_('Chat Completions')}</option>
              <option value='responses'>{_('Responses')}</option>
            </select>
          </div>
        )}

        {/* Model */}
        <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
          <span>{_('Model')}</span>
          {config.providerType === 'ollama' && ollamaModels.length > 0 ? (
            <select
              className='select select-bordered select-sm bg-base-100 text-base-content w-full'
              value={config.model}
              onChange={(e) => update({ model: e.target.value })}
            >
              {ollamaModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          ) : (
            <input
              type='text'
              className='input input-bordered input-sm w-full'
              value={config.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder={
                config.providerType === 'anthropic'
                  ? 'claude-sonnet-4-20250514'
                  : config.providerType === 'google'
                    ? 'gemini-2.5-flash'
                    : config.providerType === 'openrouter'
                      ? 'openai/gpt-4o-mini'
                      : 'model-name'
              }
            />
          )}
        </div>

        {/* Embedding fields */}
        {HAS_EMBEDDING.has(config.providerType) && (
          <>
            {config.providerType === 'openai-compatible' && (
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <span>{_('Embedding Base URL')}</span>
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={config.embeddingBaseUrl ?? ''}
                  onChange={(e) => update({ embeddingBaseUrl: e.target.value })}
                  placeholder='http://127.0.0.1:8081'
                />
              </div>
            )}
            <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
              <span>{_('Embedding Model')}</span>
              {config.providerType === 'ollama' && ollamaModels.length > 0 ? (
                <select
                  className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                  value={config.embeddingModel ?? ''}
                  onChange={(e) => update({ embeddingModel: e.target.value })}
                >
                  {ollamaModels.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type='text'
                  className='input input-bordered input-sm w-full'
                  value={config.embeddingModel ?? ''}
                  onChange={(e) => update({ embeddingModel: e.target.value })}
                  placeholder={
                    config.providerType === 'google'
                      ? 'gemini-embedding-001'
                      : 'text-embedding-3-small'
                  }
                />
              )}
            </div>
            {config.providerType === 'openai-compatible' && (
              <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                <span>{_('Embedding API Key (optional)')}</span>
                <input
                  type='password'
                  className='input input-bordered input-sm w-full'
                  value={config.embeddingApiKey ?? ''}
                  onChange={(e) => update({ embeddingApiKey: e.target.value })}
                  placeholder={_('Leave blank if not required')}
                />
              </div>
            )}
          </>
        )}

        {/* No embedding warning */}
        {!HAS_EMBEDDING.has(config.providerType) && (
          <div className='config-item'>
            <span className='text-warning text-xs'>
              {_(
                'This provider does not support embeddings. RAG requires a separate embedding provider.',
              )}
            </span>
          </div>
        )}

        {/* Save / Cancel */}
        <div className='flex items-center justify-end gap-2 px-4 py-3'>
          <button className='btn btn-ghost btn-sm' onClick={onCancel}>
            {_('Cancel')}
          </button>
          <button
            className='btn btn-primary btn-sm'
            onClick={onSave}
            disabled={!config.model.trim()}
          >
            {isNew ? _('Add Provider') : _('Save')}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// AIPanel — main settings component
// ---------------------------------------------------------------------------

const AIPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const aiSettings: AISettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;

  const [enabled, setEnabled] = useState(aiSettings.enabled);
  const [providers, setProviders] = useState<ProviderConfig[]>(aiSettings.providers ?? []);
  const [activeProviderId, setActiveProviderId] = useState(aiSettings.activeProviderId ?? '');
  const [modelAssignments, setModelAssignments] = useState(aiSettings.modelAssignments ?? {});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<ProviderConfig | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newConfig, setNewConfig] = useState<ProviderConfig>(emptyConfig('ollama'));
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const isMounted = useRef(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const saveFullAiSettings = useCallback(
    async (patch: Partial<AISettings>) => {
      const currentSettings = settingsRef.current;
      if (!currentSettings) return;
      const current: AISettings = currentSettings.aiSettings ?? DEFAULT_AI_SETTINGS;
      const updated: AISettings = { ...current, ...patch };
      const newSettings = { ...currentSettings, aiSettings: updated };
      setSettings(newSettings);
      await saveSettings(envConfig, newSettings);
    },
    [envConfig, setSettings, saveSettings],
  );

  useEffect(() => {
    isMounted.current = true;
  }, []);

  // Persist enabled
  useEffect(() => {
    if (!isMounted.current) return;
    if (enabled !== aiSettings.enabled) {
      saveFullAiSettings({ enabled });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // Persist providers list
  useEffect(() => {
    if (!isMounted.current) return;
    saveFullAiSettings({ providers, activeProviderId, modelAssignments });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, activeProviderId, modelAssignments]);

  const handleAddProvider = () => {
    const updated = [...providers, newConfig];
    setProviders(updated);
    if (updated.length === 1) {
      setActiveProviderId(newConfig.id);
    }
    setAddingNew(false);
    setNewConfig(emptyConfig('ollama'));
  };

  const handleSaveEdit = () => {
    if (!editingConfig) return;
    setProviders(providers.map((p) => (p.id === editingId ? editingConfig : p)));
    setEditingId(null);
    setEditingConfig(null);
  };

  const handleDeleteProvider = (id: string) => {
    const updated = providers.filter((p) => p.id !== id);
    setProviders(updated);
    if (activeProviderId === id && updated.length > 0) {
      setActiveProviderId(updated[0]!.id);
    }
    // Clean up model assignments
    const cleaned = { ...modelAssignments };
    for (const task of Object.keys(cleaned) as AITaskType[]) {
      if (cleaned[task] === id) delete cleaned[task];
    }
    setModelAssignments(cleaned);
  };

  const handleTestConnection = async () => {
    const config = providers.find((p) => p.id === activeProviderId);
    if (!config || !enabled) return;
    setConnectionStatus('testing');
    setErrorMessage('');
    try {
      const provider = createProviderFromConfig(config);
      const ok = await provider.healthCheck();
      if (ok) {
        setConnectionStatus('success');
      } else {
        setConnectionStatus('error');
        setErrorMessage(_('Connection failed'));
      }
    } catch (e) {
      setConnectionStatus('error');
      setErrorMessage((e as Error).message || _('Connection failed'));
    }
  };

  const disabledSection = !enabled ? 'opacity-50 pointer-events-none select-none' : '';
  const activeConfig = providers.find((p) => p.id === activeProviderId);

  return (
    <div className='my-4 w-full space-y-6'>
      {/* Enable toggle */}
      <div className='w-full'>
        <h2 className='mb-2 font-medium'>{_('AI Assistant')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <span>{_('Enable AI Assistant')}</span>
              <input
                type='checkbox'
                className='toggle'
                checked={enabled}
                onChange={() => setEnabled(!enabled)}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Provider List */}
      <div className={clsx('w-full', disabledSection)}>
        <div className='mb-2 flex items-center justify-between'>
          <h2 className='font-medium'>{_('Providers')}</h2>
          {!addingNew && (
            <button
              className='btn btn-ghost btn-xs'
              onClick={() => setAddingNew(true)}
              disabled={!enabled}
            >
              <PiPlus className='size-4' />
              {_('Add')}
            </button>
          )}
        </div>

        {/* Existing providers */}
        <div className='space-y-2'>
          {providers.map((p) => {
            if (editingId === p.id && editingConfig) {
              return (
                <ProviderForm
                  key={p.id}
                  config={editingConfig}
                  onChange={setEditingConfig}
                  onSave={handleSaveEdit}
                  onCancel={() => {
                    setEditingId(null);
                    setEditingConfig(null);
                  }}
                  isNew={false}
                  _={_}
                />
              );
            }
            return (
              <div
                key={p.id}
                className={clsx(
                  'card border-base-200 bg-base-100 border shadow',
                  activeProviderId === p.id && 'ring-primary ring-2',
                )}
              >
                <div className='config-item'>
                  <div className='flex items-center gap-2'>
                    <input
                      type='radio'
                      name='active-provider'
                      className='radio radio-sm'
                      checked={activeProviderId === p.id}
                      onChange={() => setActiveProviderId(p.id)}
                    />
                    <div>
                      <div className='text-sm font-medium'>{p.name}</div>
                      <div className='text-base-content/50 text-xs'>
                        {PROVIDER_TYPE_LABELS[p.providerType] ?? p.providerType} &middot;{' '}
                        {p.model || _('No model')}
                      </div>
                    </div>
                  </div>
                  <div className='flex items-center gap-1'>
                    <button
                      className='btn btn-ghost btn-xs'
                      onClick={() => {
                        setEditingId(p.id);
                        setEditingConfig({ ...p });
                      }}
                      title={_('Edit')}
                    >
                      <PiPencilSimple className='size-4' />
                    </button>
                    <button
                      className='btn btn-ghost btn-xs text-error'
                      onClick={() => handleDeleteProvider(p.id)}
                      title={_('Delete')}
                    >
                      <PiTrash className='size-4' />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {providers.length === 0 && !addingNew && (
            <div className='text-base-content/50 py-4 text-center text-sm'>
              {_('No providers configured. Click Add to get started.')}
            </div>
          )}
        </div>

        {/* Add new form */}
        {addingNew && (
          <div className='mt-2'>
            <ProviderForm
              config={newConfig}
              onChange={setNewConfig}
              onSave={handleAddProvider}
              onCancel={() => {
                setAddingNew(false);
                setNewConfig(emptyConfig('ollama'));
              }}
              isNew={true}
              _={_}
            />
          </div>
        )}
      </div>

      {/* Connection Test */}
      <div className={clsx('w-full', disabledSection)}>
        <h2 className='mb-2 font-medium'>{_('Connection')}</h2>
        <div className='card border-base-200 bg-base-100 border shadow'>
          <div className='divide-base-200 divide-y'>
            <div className='config-item'>
              <div className='flex flex-col'>
                <span className='text-sm'>
                  {activeConfig
                    ? `${activeConfig.name} — ${activeConfig.model}`
                    : _('No active provider')}
                </span>
              </div>
              <div className='flex items-center gap-2'>
                <button
                  className='btn btn-outline btn-sm'
                  onClick={handleTestConnection}
                  disabled={!enabled || !activeConfig || connectionStatus === 'testing'}
                >
                  {connectionStatus === 'testing' ? (
                    <PiSpinner className='size-4 animate-spin' />
                  ) : (
                    _('Test Connection')
                  )}
                </button>
                {connectionStatus === 'success' && (
                  <span className='text-success flex items-center gap-1 text-sm'>
                    <PiCheckCircle className='size-4 shrink-0' />
                    {_('Connected')}
                  </span>
                )}
                {connectionStatus === 'error' && (
                  <span className='text-error flex items-center gap-1 text-sm'>
                    <PiWarningCircle className='size-4 shrink-0' />
                    {errorMessage || _('Failed')}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Advanced: Model Assignments */}
      {providers.length > 1 && (
        <div className={clsx('w-full', disabledSection)}>
          <button
            className='mb-2 flex items-center gap-1 font-medium'
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span className={clsx('transition-transform', showAdvanced && 'rotate-90')}>
              &#9654;
            </span>
            {_('Task Routing (Advanced)')}
          </button>
          {showAdvanced && (
            <div className='card border-base-200 bg-base-100 border shadow'>
              <div className='divide-base-200 divide-y'>
                <div className='px-4 py-2'>
                  <p className='text-base-content/50 text-xs'>
                    {_(
                      'Assign different providers to different tasks. Leave as "Default" to use the active provider.',
                    )}
                  </p>
                </div>
                {(['translation', 'dictionary', 'chat', 'embedding'] as AITaskType[]).map(
                  (task) => (
                    <div
                      key={task}
                      className='config-item !h-auto flex-col !items-start gap-2 py-3'
                    >
                      <span>{_(TASK_LABELS[task])}</span>
                      <select
                        className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                        value={modelAssignments[task] ?? ''}
                        onChange={(e) =>
                          setModelAssignments({
                            ...modelAssignments,
                            [task]: e.target.value || undefined,
                          })
                        }
                      >
                        <option value=''>{_('Default (active provider)')}</option>
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} — {p.model}
                          </option>
                        ))}
                      </select>
                    </div>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AIPanel;
