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

import HelpTip from '@/components/primitives/HelpTip';
import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { createProviderFromConfig } from '@/services/ai/providers';
import {
  DEFAULT_AI_SETTINGS,
  DEFAULT_AI_PROFILE,
  providerConfigCanServeEmbeddings,
  providerTypeSupportsEmbeddings,
  resolveEmbeddingModelId,
  resolveChatModelId,
} from '@/services/ai/constants';
import type {
  AISettings,
  AIProviderType,
  AIProviderApiStandard,
  ProviderConfig,
  AITaskType,
  ModelEntry,
  ModelAssignments,
  TaskModelSelection,
  InferenceParams,
} from '@/services/ai/types';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

const PROVIDER_TYPE_LABELS: Record<AIProviderType, string> = {
  ollama: 'Ollama',
  openai: 'OpenAI',
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
  'ai-gateway': 'AI Gateway',
};

const PROVIDER_TYPES_ORDERED: AIProviderType[] = [
  'ollama',
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

const HAS_API_STANDARD: Set<AIProviderType> = new Set(['openai']);

const TASK_LABELS: Record<AITaskType, string> = {
  translation: 'Translation',
  dictionary: 'Dictionary',
  chat: 'Chat',
  embedding: 'Embedding',
};

function generateProviderId(): string {
  return `provider-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function generateProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getModelsByKind(config: ProviderConfig, kind: ModelEntry['kind']): ModelEntry[] {
  return (config.models ?? []).filter((model) => model.kind === kind);
}

function getPrimaryModel(config: ProviderConfig, kind: ModelEntry['kind']): string {
  return getModelsByKind(config, kind)[0]?.id ?? '';
}

function emptyConfig(providerType: AIProviderType): ProviderConfig {
  const defaults: ModelEntry[] =
    providerType === 'ollama'
      ? [
          { id: 'llama3.2', kind: 'chat' },
          { id: 'nomic-embed-text', kind: 'embedding' },
        ]
      : providerType === 'openai'
        ? [
            { id: 'gpt-4o-mini', kind: 'chat' },
            { id: 'text-embedding-3-small', kind: 'embedding' },
          ]
        : providerType === 'google'
          ? [
              { id: 'gemini-2.5-flash', kind: 'chat' },
              { id: 'gemini-embedding-001', kind: 'embedding' },
            ]
          : providerType === 'mistral'
            ? [
                { id: 'mistral-large-latest', kind: 'chat' },
                { id: 'mistral-embed', kind: 'embedding' },
              ]
            : providerType === 'ai-gateway'
              ? [
                  { id: 'google/gemini-2.5-flash-lite', kind: 'chat' },
                  { id: 'openai/text-embedding-3-small', kind: 'embedding' },
                ]
              : [];

  return {
    id: generateProviderId(),
    name: '',
    providerType,
    baseUrl:
      providerType === 'ollama'
        ? 'http://127.0.0.1:11434'
        : providerType === 'openai'
          ? 'https://api.openai.com'
          : '',
    models: defaults,
    apiStandard: HAS_API_STANDARD.has(providerType) ? 'chat-completions' : undefined,
  };
}

function normalizeProviderConfig(
  config: ProviderConfig | (ProviderConfig & { [key: string]: unknown }),
): ProviderConfig {
  const legacy = config as ProviderConfig & {
    providerType?: string;
    model?: string;
    embeddingModel?: string;
    apiStyle?: AIProviderApiStandard;
  };
  const models = Array.isArray(config.models) ? [...config.models] : [];
  if (models.length === 0 && typeof legacy.model === 'string' && legacy.model.trim()) {
    models.push({ id: legacy.model.trim(), kind: 'chat' });
  }
  if (
    typeof legacy.embeddingModel === 'string' &&
    legacy.embeddingModel.trim() &&
    !models.some((model) => model.kind === 'embedding')
  ) {
    models.push({ id: legacy.embeddingModel.trim(), kind: 'embedding' });
  }
  return {
    id: config.id,
    name: config.name ?? '',
    providerType: (legacy.providerType === 'openai-compatible'
      ? 'openai'
      : config.providerType) as AIProviderType,
    baseUrl: config.baseUrl ?? '',
    apiKey: config.apiKey,
    models,
    apiStandard: config.apiStandard ?? legacy.apiStyle,
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

  const chatModel = getPrimaryModel(config, 'chat');

  const setModelEntry = (index: number, patch: Partial<ModelEntry>) => {
    const nextModels = [...(config.models ?? [])];
    const current = nextModels[index];
    if (!current) return;
    nextModels[index] = { ...current, ...patch };
    onChange({ ...config, models: nextModels });
  };

  const addModelEntry = () => {
    const nextModels = [...(config.models ?? []), { id: '', kind: 'chat' as const }];
    onChange({ ...config, models: nextModels });
  };

  const removeModelEntry = (index: number) => {
    const nextModels = [...(config.models ?? [])];
    nextModels.splice(index, 1);
    onChange({ ...config, models: nextModels });
  };

  return (
    <div className='card border-base-200 bg-base-100 border shadow'>
      <div className='divide-base-200 divide-y'>
        <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
          <span>{_('Provider Type')}</span>
          <select
            className='select select-bordered select-sm bg-base-100 text-base-content w-full'
            value={config.providerType}
            onChange={(e) => {
              const newType = e.target.value as AIProviderType;
              const fresh = emptyConfig(newType);
              onChange({ ...fresh, id: config.id, name: config.name });
            }}
          >
            {PROVIDER_TYPES_ORDERED.map((t) => (
              <option key={t} value={t}>
                {PROVIDER_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

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

        <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
          <div className='flex w-full items-center justify-between'>
            <span>{_('Base URL')}</span>
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
                : config.providerType === 'openai'
                  ? 'https://api.openai.com'
                  : 'https://your-endpoint.example.com'
            }
          />
        </div>

        <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
          <span>{_('API Key')}</span>
          <input
            type='password'
            className='input input-bordered input-sm w-full'
            value={config.apiKey ?? ''}
            onChange={(e) => update({ apiKey: e.target.value })}
            placeholder={
              REQUIRES_API_KEY.has(config.providerType)
                ? 'sk-...'
                : _('Leave blank if not required')
            }
          />
        </div>

        {HAS_API_STANDARD.has(config.providerType) && (
          <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
            <span className='flex items-center gap-1'>
              {_('API Standard')}
              <HelpTip
                tip={_(
                  'Chat Completions uses /v1/chat/completions. Responses uses the newer /v1/responses endpoint.',
                )}
              />
            </span>
            <select
              className='select select-bordered select-sm bg-base-100 text-base-content w-full'
              value={config.apiStandard || 'chat-completions'}
              onChange={(e) => update({ apiStandard: e.target.value as AIProviderApiStandard })}
            >
              <option value='chat-completions'>{_('Chat Completions')}</option>
              <option value='responses'>{_('Responses')}</option>
            </select>
          </div>
        )}

        <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
          <div className='flex w-full items-center justify-between'>
            <span className='flex items-center gap-1'>
              {_('Models')}
              <HelpTip
                tip={_(
                  'Add one or more chat models and embedding models for this endpoint. Chat models handle translation/Q&A; embedding models power retrieval indexing.',
                )}
              />
            </span>
            <button className='btn btn-ghost btn-xs' type='button' onClick={addModelEntry}>
              <PiPlus className='size-4' />
              {_('Add model')}
            </button>
          </div>
          <div className='flex w-full flex-col gap-2'>
            {(config.models ?? []).map((model, index) => {
              const allowEmbedding = providerTypeSupportsEmbeddings(config.providerType);
              return (
                <div
                  key={`${model.kind}-${index}`}
                  className='grid w-full gap-2 sm:grid-cols-[1fr,1fr,140px,auto]'
                >
                  <input
                    type='text'
                    className='input input-bordered input-sm w-full'
                    value={model.id}
                    onChange={(e) => setModelEntry(index, { id: e.target.value })}
                    list={config.providerType === 'ollama' ? 'ollama-model-options' : undefined}
                    placeholder='model-id'
                  />
                  <input
                    type='text'
                    className='input input-bordered input-sm w-full'
                    value={model.label ?? ''}
                    onChange={(e) => setModelEntry(index, { label: e.target.value })}
                    placeholder={_('Label (optional)')}
                  />
                  <div className='flex items-center gap-2'>
                    <select
                      className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                      value={model.kind}
                      onChange={(e) =>
                        setModelEntry(index, { kind: e.target.value as ModelEntry['kind'] })
                      }
                      disabled={!allowEmbedding}
                    >
                      <option value='chat'>{_('Chat')}</option>
                      <option value='embedding'>{_('Embedding')}</option>
                    </select>
                    <HelpTip
                      tip={_(
                        'Chat models generate answers. Embedding models build semantic vectors used for retrieval and indexing.',
                      )}
                    />
                  </div>
                  <button
                    className='btn btn-ghost btn-sm text-error'
                    type='button'
                    onClick={() => removeModelEntry(index)}
                    aria-label={_('Remove model')}
                  >
                    <PiTrash className='size-4' />
                  </button>
                </div>
              );
            })}
          </div>
          {config.providerType === 'ollama' && ollamaModels.length > 0 && (
            <datalist id='ollama-model-options'>
              {ollamaModels.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          )}
        </div>

        {!providerTypeSupportsEmbeddings(config.providerType) && (
          <div className='config-item'>
            <span className='text-warning text-xs'>
              {_(
                'This provider does not support embeddings. Assign a separate embedding provider for RAG.',
              )}
            </span>
          </div>
        )}

        {providerTypeSupportsEmbeddings(config.providerType) &&
          !resolveEmbeddingModelId(config) && (
            <div className='config-item'>
              <span className='text-warning text-xs'>
                {_('Configure an embedding model before using this provider for book indexing.')}
              </span>
            </div>
          )}

        <div className='flex items-center justify-end gap-2 px-4 py-3'>
          <button className='btn btn-ghost btn-sm' onClick={onCancel}>
            {_('Cancel')}
          </button>
          <button
            className='btn btn-primary btn-sm'
            onClick={onSave}
            disabled={!config.name.trim() || !chatModel.trim()}
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
  const profiles = aiSettings.profiles ?? [];

  const initialProfiles = profiles.length > 0 ? profiles : [DEFAULT_AI_PROFILE];
  const initialActiveProfileId = aiSettings.activeProfileId || initialProfiles[0]!.id;
  const activeProfile =
    initialProfiles.find((profile) => profile.id === initialActiveProfileId) ?? initialProfiles[0]!;

  const [enabled, setEnabled] = useState(aiSettings.enabled);
  const [providers, setProviders] = useState<ProviderConfig[]>(
    (aiSettings.providers ?? []).map((provider) =>
      normalizeProviderConfig(provider as ProviderConfig),
    ),
  );
  const [profilesState, setProfilesState] = useState(initialProfiles);
  const [activeProfileId, setActiveProfileId] = useState(initialActiveProfileId);
  const [activeProviderId, setActiveProviderId] = useState(
    activeProfile.modelAssignments.chat?.providerId ?? aiSettings.providers[0]?.id ?? '',
  );
  const [developerMode, setDeveloperMode] = useState(aiSettings.developerMode ?? false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingConfig, setEditingConfig] = useState<ProviderConfig | null>(null);
  const [addingNew, setAddingNew] = useState(false);
  const [newConfig, setNewConfig] = useState<ProviderConfig>(emptyConfig('ollama'));
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const selectedProfile =
    profilesState.find((profile) => profile.id === activeProfileId) ??
    profilesState[0] ??
    DEFAULT_AI_PROFILE;
  const modelAssignments: ModelAssignments = selectedProfile.modelAssignments ?? {};
  const inferenceParamsByTask = selectedProfile.inferenceParamsByTask ?? {};
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

  const updateActiveProfile = useCallback(
    (updater: (profile: typeof selectedProfile) => typeof selectedProfile) => {
      setProfilesState((currentProfiles) => {
        const existing =
          currentProfiles.find((profile) => profile.id === activeProfileId) ?? selectedProfile;
        const nextProfile = updater(existing);
        return currentProfiles.map((profile) =>
          profile.id === nextProfile.id ? nextProfile : profile,
        );
      });
    },
    [activeProfileId, selectedProfile],
  );

  const updateTaskAssignment = useCallback(
    (task: AITaskType, selection: TaskModelSelection | undefined) => {
      updateActiveProfile((profile) => ({
        ...profile,
        modelAssignments: { ...profile.modelAssignments, [task]: selection },
      }));
    },
    [updateActiveProfile],
  );

  const updateTaskInferenceParams = useCallback(
    (task: AITaskType, patch: Partial<InferenceParams>) => {
      updateActiveProfile((profile) => ({
        ...profile,
        inferenceParamsByTask: {
          ...profile.inferenceParamsByTask,
          [task]: {
            ...profile.inferenceParamsByTask[task],
            ...patch,
          },
        },
      }));
    },
    [updateActiveProfile],
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

  // Persist providers/profile routing
  useEffect(() => {
    if (!isMounted.current) return;
    saveFullAiSettings({
      providers,
      developerMode,
      profiles: profilesState,
      activeProfileId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [providers, profilesState, activeProfileId, developerMode]);

  useEffect(() => {
    const nextProviderId =
      selectedProfile.modelAssignments.chat?.providerId ?? providers[0]?.id ?? '';
    setActiveProviderId(nextProviderId);
  }, [selectedProfile, providers]);

  const handleAddProvider = () => {
    const updated = [...providers, newConfig];
    setProviders(updated);
    if (updated.length === 1) {
      setActiveProviderId(newConfig.id);
      const firstChatModel = getModelsByKind(newConfig, 'chat')[0]?.id;
      updateTaskAssignment('chat', { providerId: newConfig.id, modelId: firstChatModel });
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
    if (activeProviderId === id) {
      setActiveProviderId(updated[0]?.id ?? '');
    }
    // Clean up model assignments
    setProfilesState((currentProfiles) =>
      currentProfiles.map((profile) => {
        const cleaned: ModelAssignments = { ...profile.modelAssignments };
        for (const task of Object.keys(cleaned) as AITaskType[]) {
          if (cleaned[task]?.providerId === id) delete cleaned[task];
        }
        return { ...profile, modelAssignments: cleaned };
      }),
    );
  };

  const handleAddProfile = () => {
    const nextProfile = {
      ...selectedProfile,
      id: generateProfileId(),
      name: `${selectedProfile.name} Copy`,
    };
    setProfilesState([...profilesState, nextProfile]);
    setActiveProfileId(nextProfile.id);
  };

  const handleBlankProfile = () => {
    const defaultAssignments = Object.fromEntries(
      (['translation', 'dictionary', 'chat', 'embedding'] as AITaskType[]).flatMap((task) => {
        const kind: ModelEntry['kind'] = task === 'embedding' ? 'embedding' : 'chat';
        const provider = providers.find((entry) => getModelsByKind(entry, kind).length > 0);
        const modelId = provider ? getModelsByKind(provider, kind)[0]?.id : undefined;
        return provider && modelId ? [[task, { providerId: provider.id, modelId }]] : [];
      }),
    ) as ModelAssignments;

    const nextProfile = {
      ...DEFAULT_AI_PROFILE,
      id: generateProfileId(),
      name: `Profile ${profilesState.length + 1}`,
      modelAssignments: defaultAssignments,
    };
    setProfilesState([...profilesState, nextProfile]);
    setActiveProfileId(nextProfile.id);
  };

  const handleDeleteProfile = () => {
    if (profilesState.length <= 1) return;
    const filtered = profilesState.filter((profile) => profile.id !== activeProfileId);
    setProfilesState(filtered);
    setActiveProfileId(filtered[0]!.id);
  };
  const handleTestConnection = async () => {
    const config = providers.find((p) => p.id === activeProviderId);
    if (!config || !enabled) return;
    setConnectionStatus('testing');
    setErrorMessage('');

    const embeddingProviderId = modelAssignments.embedding?.providerId ?? activeProviderId;
    const requireEmbedding = embeddingProviderId === config.id;
    const chatModelId =
      modelAssignments.chat?.providerId === config.id
        ? modelAssignments.chat.modelId || resolveChatModelId(config)
        : resolveChatModelId(config);
    const embeddingModelId =
      modelAssignments.embedding?.providerId === config.id
        ? modelAssignments.embedding.modelId || resolveEmbeddingModelId(config)
        : resolveEmbeddingModelId(config);

    if (requireEmbedding && !providerConfigCanServeEmbeddings(config)) {
      setConnectionStatus('error');
      setErrorMessage(
        providerTypeSupportsEmbeddings(config.providerType)
          ? _('Configure an embedding model before using this provider for book indexing.')
          : _(
              'This provider does not support embeddings. Assign a separate embedding provider for book indexing.',
            ),
      );
      return;
    }

    try {
      const provider = createProviderFromConfig(config);
      const ok = await provider.healthCheck({
        requireEmbedding,
        modelId: chatModelId,
        embeddingModelId,
      });
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
            <div className='config-item'>
              <span className='flex items-center gap-1'>
                {_('Developer Mode')}
                <HelpTip
                  tip={_(
                    'Shows a popup debug panel with system prompt, user prompt, raw model output, and parsed result.',
                  )}
                />
              </span>
              <input
                type='checkbox'
                className='toggle'
                checked={developerMode}
                onChange={() => setDeveloperMode(!developerMode)}
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
                      onChange={() => {
                        setActiveProviderId(p.id);
                        const firstChatModel = getModelsByKind(p, 'chat')[0]?.id;
                        updateTaskAssignment('chat', { providerId: p.id, modelId: firstChatModel });
                      }}
                    />
                    <div>
                      <div className='text-sm font-medium'>{p.name}</div>
                      <div className='text-base-content/50 text-xs'>
                        {PROVIDER_TYPE_LABELS[p.providerType] ?? p.providerType} &middot;{' '}
                        {resolveChatModelId(p) || _('No model')}
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
                    ? `${activeConfig.name} — ${resolveChatModelId(activeConfig) || _('No model')}`
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

      {/* AI Profiles */}
      {providers.length > 0 && (
        <div className={clsx('w-full', disabledSection)}>
          <button
            className='mb-2 flex items-center gap-1 font-medium'
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <span className={clsx('transition-transform', showAdvanced && 'rotate-90')}>
              &#9654;
            </span>
            {_('AI Profiles')}
          </button>
          {showAdvanced && (
            <div className='card border-base-200 bg-base-100 border shadow'>
              <div className='divide-base-200 divide-y'>
                <div className='flex flex-wrap items-center gap-2 px-4 py-3'>
                  {profilesState.map((profile) => (
                    <button
                      key={profile.id}
                      className={clsx(
                        'btn btn-xs',
                        profile.id === activeProfileId ? 'btn-primary' : 'btn-ghost',
                      )}
                      onClick={() => setActiveProfileId(profile.id)}
                    >
                      {profile.name}
                    </button>
                  ))}
                  <button className='btn btn-ghost btn-xs' onClick={handleBlankProfile}>
                    <PiPlus className='size-4' />
                    {_('New')}
                  </button>
                  <button className='btn btn-ghost btn-xs' onClick={handleAddProfile}>
                    {_('Duplicate')}
                  </button>
                  <button
                    className='btn btn-ghost btn-xs text-error'
                    onClick={handleDeleteProfile}
                    disabled={profilesState.length <= 1}
                  >
                    <PiTrash className='size-4' />
                    {_('Delete')}
                  </button>
                </div>

                <div className='config-item !h-auto flex-col !items-start gap-2 py-3'>
                  <span>{_('Profile Name')}</span>
                  <input
                    type='text'
                    className='input input-bordered input-sm w-full'
                    value={selectedProfile.name}
                    onChange={(e) =>
                      updateActiveProfile((profile) => ({ ...profile, name: e.target.value }))
                    }
                  />
                </div>

                {(['translation', 'dictionary', 'chat', 'embedding'] as AITaskType[]).map(
                  (task) => {
                    const kind: ModelEntry['kind'] = task === 'embedding' ? 'embedding' : 'chat';
                    const selectableProviders = providers.filter(
                      (provider) => getModelsByKind(provider, kind).length > 0,
                    );
                    const selection = modelAssignments[task];
                    const selectedProvider =
                      selectableProviders.find(
                        (provider) => provider.id === selection?.providerId,
                      ) ??
                      (task === 'chat'
                        ? selectableProviders.find((provider) => provider.id === activeProviderId)
                        : selectableProviders[0]);
                    const modelOptions = selectedProvider
                      ? getModelsByKind(selectedProvider, kind)
                      : [];
                    const selectedModelId =
                      modelOptions.find((model) => model.id === selection?.modelId)?.id ||
                      modelOptions[0]?.id ||
                      '';
                    const params = inferenceParamsByTask[task] ?? {};

                    return (
                      <div
                        key={task}
                        className='config-item !h-auto flex-col !items-start gap-3 py-3'
                      >
                        <span>{_(TASK_LABELS[task])}</span>
                        <div className='grid w-full gap-2 sm:grid-cols-2'>
                          <select
                            className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                            value={selectedProvider?.id ?? ''}
                            onChange={(e) => {
                              const providerId = e.target.value;
                              const provider = selectableProviders.find(
                                (item) => item.id === providerId,
                              );
                              const firstModelId = provider
                                ? getModelsByKind(provider, kind)[0]?.id
                                : undefined;
                              updateTaskAssignment(
                                task,
                                providerId ? { providerId, modelId: firstModelId } : undefined,
                              );
                            }}
                          >
                            {selectableProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                          <select
                            className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                            value={selectedModelId}
                            onChange={(e) => {
                              if (!selectedProvider) return;
                              updateTaskAssignment(task, {
                                providerId: selectedProvider.id,
                                modelId: e.target.value,
                              });
                            }}
                            disabled={!selectedProvider}
                          >
                            {modelOptions.map((model) => (
                              <option key={model.id} value={model.id}>
                                {model.label || model.id}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className='grid w-full gap-2 sm:grid-cols-4'>
                          <input
                            type='number'
                            className='input input-bordered input-sm w-full'
                            placeholder={_('Temperature')}
                            value={params.temperature ?? ''}
                            onChange={(e) =>
                              updateTaskInferenceParams(task, {
                                temperature: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                          />
                          <input
                            type='number'
                            className='input input-bordered input-sm w-full'
                            placeholder={_('Top-p')}
                            value={params.topP ?? ''}
                            onChange={(e) =>
                              updateTaskInferenceParams(task, {
                                topP: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                          />
                          <input
                            type='number'
                            className='input input-bordered input-sm w-full'
                            placeholder={_('Max tokens')}
                            value={params.maxTokens ?? ''}
                            onChange={(e) =>
                              updateTaskInferenceParams(task, {
                                maxTokens: e.target.value ? Number(e.target.value) : undefined,
                              })
                            }
                          />
                          <select
                            className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                            value={params.reasoningEffort ?? ''}
                            onChange={(e) =>
                              updateTaskInferenceParams(task, {
                                reasoningEffort: (e.target.value ||
                                  undefined) as InferenceParams['reasoningEffort'],
                              })
                            }
                          >
                            <option value=''>{_('Reasoning')}</option>
                            <option value='low'>{_('Low')}</option>
                            <option value='medium'>{_('Medium')}</option>
                            <option value='high'>{_('High')}</option>
                          </select>
                        </div>
                      </div>
                    );
                  },
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
