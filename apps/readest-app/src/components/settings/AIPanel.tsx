import React, { useState, useEffect, useCallback, useRef } from 'react';
import { PiCheckCircle, PiWarningCircle, PiPlus, PiPencilSimple, PiTrash } from 'react-icons/pi';

import { useTranslation } from '@/hooks/useTranslation';
import { useSettingsStore } from '@/store/settingsStore';
import { useEnv } from '@/context/EnvContext';
import { getAIProvider } from '@/services/ai/providers';
import { DEFAULT_AI_SETTINGS } from '@/services/ai/constants';
import { SUPPORTED_PROVIDER_TYPES } from '@/services/ai/capabilities';
import type { AISettings, AIProfile, AITaskType } from '@/services/ai/types';
import { BoxedList, SettingLabel, SettingsSwitchRow } from './primitives';

type ConnectionStatus = 'idle' | 'testing' | 'success' | 'error';

interface ProviderDraft {
  name: string;
  providerType: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
}

const emptyDraft = (): ProviderDraft => ({
  name: '',
  providerType: SUPPORTED_PROVIDER_TYPES[0],
  baseUrl: '',
  chatModel: '',
  embeddingModel: '',
});

type ProviderWithLegacyModels = AISettings['providers'][number] & {
  model?: unknown;
  embeddingModel?: unknown;
};

const getLegacyModelField = (
  provider: AISettings['providers'][number],
  field: 'model' | 'embeddingModel',
) => (provider as ProviderWithLegacyModels)[field];

const AIPanel: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();

  const aiSettings: AISettings = settings?.aiSettings ?? DEFAULT_AI_SETTINGS;
  const enabled = aiSettings.enabled;
  const providers = aiSettings.providers ?? [];
  const profiles = aiSettings.profiles?.length
    ? aiSettings.profiles
    : [{ id: 'default', name: 'Default', modelAssignments: {}, inferenceParamsByTask: {} }];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProviderDraft>(emptyDraft());
  const [adding, setAdding] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [profilesOpen, setProfilesOpen] = useState(false);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const saveAiSettings = useCallback(
    async (patch: Partial<AISettings>) => {
      const current = settingsRef.current;
      if (!current) return;
      const next = { ...current, aiSettings: { ...current.aiSettings, ...patch } };
      setSettings(next);
      await saveSettings(envConfig, next);
    },
    [envConfig, setSettings, saveSettings],
  );

  const handleToggleEnabled = () => {
    saveAiSettings({ enabled: !enabled });
  };

  // ---- Provider CRUD ----
  const startAdd = () => {
    setAdding(true);
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const startEdit = (id: string) => {
    const p = providers.find((pr) => pr.id === id);
    if (!p) return;
    setAdding(false);
    setEditingId(id);
    const chatModel =
      p.models?.find((m) => m.kind === 'chat')?.id ?? getLegacyModelField(p, 'model') ?? '';
    const embeddingModel =
      p.models?.find((m) => m.kind === 'embedding')?.id ??
      getLegacyModelField(p, 'embeddingModel') ??
      '';
    setDraft({
      name: p.name,
      providerType: p.providerType,
      baseUrl: p.baseUrl,
      chatModel: String(chatModel),
      embeddingModel: String(embeddingModel),
    });
  };

  const handleSaveNew = async () => {
    const id = `${draft.providerType}-${Date.now()}`;
    const newProvider = {
      id,
      name: draft.name || draft.providerType,
      providerType: draft.providerType as AISettings['providers'][number]['providerType'],
      baseUrl: draft.baseUrl,
      models: [
        ...(draft.chatModel ? [{ id: draft.chatModel, kind: 'chat' as const }] : []),
        ...(draft.embeddingModel ? [{ id: draft.embeddingModel, kind: 'embedding' as const }] : []),
      ],
    };
    await saveAiSettings({ providers: [...providers, newProvider] });
    setAdding(false);
    setDraft(emptyDraft());
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    const updated = providers.map((p) => {
      if (p.id !== editingId) return p;
      return {
        ...p,
        name: draft.name || p.name,
        providerType: draft.providerType as AISettings['providers'][number]['providerType'],
        baseUrl: draft.baseUrl,
        models: [
          ...(draft.chatModel ? [{ id: draft.chatModel, kind: 'chat' as const }] : []),
          ...(draft.embeddingModel
            ? [{ id: draft.embeddingModel, kind: 'embedding' as const }]
            : []),
        ],
      };
    });
    await saveAiSettings({ providers: updated });
    setEditingId(null);
    setDraft(emptyDraft());
  };

  const handleDelete = async (id: string) => {
    await saveAiSettings({ providers: providers.filter((p) => p.id !== id) });
  };

  const handleCancel = () => {
    setAdding(false);
    setEditingId(null);
    setDraft(emptyDraft());
  };

  // ---- Connection test ----
  const handleTestConnection = async () => {
    setConnectionStatus('testing');
    setErrorMessage('');
    try {
      // Find the provider that would serve chat tasks
      const chatProvider = providers.find(
        (p) =>
          (p.models?.some((m) => m.kind === 'chat') || getLegacyModelField(p, 'model')) &&
          (p.models?.some((m) => m.kind === 'embedding') ||
            getLegacyModelField(p, 'embeddingModel')),
      );
      // Fallback: first provider with any chat model
      const routedProvider =
        chatProvider ??
        providers.find(
          (p) => p.models?.some((m) => m.kind === 'chat') || getLegacyModelField(p, 'model'),
        );
      if (!routedProvider) {
        setConnectionStatus('error');
        setErrorMessage(_('No configured provider found'));
        return;
      }
      const chatModelId =
        routedProvider.models?.find((m) => m.kind === 'chat')?.id ??
        String(getLegacyModelField(routedProvider, 'model') ?? '');
      const hasEmbedding =
        !!routedProvider.models?.find((m) => m.kind === 'embedding') ||
        !!getLegacyModelField(routedProvider, 'embeddingModel');
      const provider = getAIProvider(routedProvider as never);
      const ok = await provider.healthCheck({
        requireEmbedding: !hasEmbedding ? false : undefined,
        modelId: chatModelId,
      });
      setConnectionStatus(ok ? 'success' : 'error');
      if (!ok) setErrorMessage(_('Connection failed'));
    } catch (err) {
      setConnectionStatus('error');
      setErrorMessage((err as Error).message || _('Connection failed'));
    }
  };

  // ---- Profiles ----
  const activeProfile = profiles.find((p) => p.id === aiSettings.activeProfileId) ?? profiles[0];

  const updateProfileInference = async (
    task: AITaskType,
    field: keyof NonNullable<AIProfile['inferenceParamsByTask'][AITaskType]>,
    value: string,
  ) => {
    if (!activeProfile) return;
    const updatedProfiles = profiles.map((p) => {
      if (p.id !== activeProfile.id) return p;
      const currentParams = p.inferenceParamsByTask[task] ?? {};
      return {
        ...p,
        inferenceParamsByTask: {
          ...p.inferenceParamsByTask,
          [task]: { ...currentParams, [field]: value },
        },
      };
    });
    await saveAiSettings({ profiles: updatedProfiles });
  };

  const disabledSection = !enabled ? 'opacity-50 pointer-events-none select-none' : '';

  return (
    <div className='my-4 w-full space-y-6'>
      <BoxedList title={_('AI Assistant')}>
        <SettingsSwitchRow
          label={_('Enable AI Assistant')}
          checked={enabled}
          onChange={handleToggleEnabled}
        />
      </BoxedList>

      {/* Providers list */}
      <BoxedList title={_('Providers')}>
        {providers.map((p) => (
          <div key={p.id} className='flex min-h-14 items-center justify-between gap-3 pe-4'>
            <span className='text-base-content text-sm'>{p.name}</span>
            <div className='flex gap-1'>
              <button className='btn btn-ghost btn-sm' title='Edit' onClick={() => startEdit(p.id)}>
                <PiPencilSimple className='size-4' />
              </button>
              <button
                className='btn btn-ghost btn-sm'
                title='Delete'
                onClick={() => handleDelete(p.id)}
                disabled={!enabled}
              >
                <PiTrash className='size-4' />
              </button>
            </div>
          </div>
        ))}
        <button className='btn btn-outline btn-sm ms-4 mb-2' onClick={startAdd} disabled={!enabled}>
          <PiPlus className='size-4' />
          {_('Add')}
        </button>
      </BoxedList>

      {/* Add / Edit form */}
      {(adding || editingId) && (
        <BoxedList
          title={adding ? _('Add Provider') : _('Edit Provider')}
          className={disabledSection}
        >
          <div className='flex flex-col gap-3 pe-4 py-3'>
            <div className='flex flex-col gap-1'>
              <SettingLabel>{_('Provider Type')}</SettingLabel>
              <select
                className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                value={draft.providerType}
                onChange={(e) => setDraft((d) => ({ ...d, providerType: e.target.value }))}
                disabled={!!editingId}
              >
                {SUPPORTED_PROVIDER_TYPES.map((pt) => (
                  <option key={pt} value={pt}>
                    {pt}
                  </option>
                ))}
              </select>
            </div>
            <div className='flex flex-col gap-1'>
              <SettingLabel>{_('Name')}</SettingLabel>
              <input
                type='text'
                className='input input-bordered input-sm w-full'
                value={draft.name}
                placeholder={providers.find((p) => p.id === editingId)?.name ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <SettingLabel>{_('Base URL')}</SettingLabel>
              <input
                type='text'
                className='input input-bordered input-sm w-full'
                value={draft.baseUrl}
                onChange={(e) => setDraft((d) => ({ ...d, baseUrl: e.target.value }))}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <SettingLabel>{_('Chat Model')}</SettingLabel>
              <input
                type='text'
                className='input input-bordered input-sm w-full'
                value={draft.chatModel}
                onChange={(e) => setDraft((d) => ({ ...d, chatModel: e.target.value }))}
              />
            </div>
            <div className='flex flex-col gap-1'>
              <SettingLabel>{_('Embedding Model')}</SettingLabel>
              <input
                type='text'
                className='input input-bordered input-sm w-full'
                value={draft.embeddingModel}
                onChange={(e) => setDraft((d) => ({ ...d, embeddingModel: e.target.value }))}
              />
              {draft.providerType === 'ai-gateway' && (
                <datalist id='ai-gateway-embedding-model-options'>
                  {[
                    'openai/text-embedding-3-small',
                    'openai/text-embedding-3-large',
                    'google/text-embedding-004',
                    'cohere/embed-multilingual-v3',
                  ].map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              )}
            </div>
            <div className='flex gap-2'>
              <button
                className='btn btn-primary btn-sm'
                onClick={adding ? handleSaveNew : handleSaveEdit}
              >
                {_('Save')}
              </button>
              <button className='btn btn-ghost btn-sm' onClick={handleCancel}>
                {_('Cancel')}
              </button>
            </div>
          </div>
        </BoxedList>
      )}

      {/* Connection test */}
      <BoxedList title={_('Connection')} className={disabledSection}>
        <div className='flex min-h-14 items-center justify-between gap-3 pe-4'>
          <button
            className='btn btn-outline btn-sm'
            onClick={handleTestConnection}
            disabled={!enabled || connectionStatus === 'testing'}
          >
            {_('Test Connection')}
          </button>
          <div>
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
      </BoxedList>

      {/* AI Profiles */}
      <BoxedList title={_('AI Profiles')} className={disabledSection}>
        <button
          className='btn btn-ghost btn-sm ms-4'
          onClick={() => setProfilesOpen(!profilesOpen)}
        >
          {profilesOpen ? _('Hide Profiles') : _('AI Profiles')}
        </button>
        {profilesOpen && activeProfile && (
          <div className='pe-4 py-3 space-y-3'>
            {(['translation', 'dictionary', 'chat', 'embedding'] as AITaskType[]).map((task) => (
              <div key={task} className='flex flex-col gap-1'>
                <SettingLabel>{task}</SettingLabel>
                <select
                  className='select select-bordered select-sm bg-base-100 text-base-content w-full'
                  data-testid={`task-reasoning-${task}`}
                  value={activeProfile.inferenceParamsByTask[task]?.reasoningEffort ?? ''}
                  onChange={(e) => updateProfileInference(task, 'reasoningEffort', e.target.value)}
                >
                  <option value=''>{_('Default')}</option>
                  <option value='off'>{_('Off')}</option>
                  <option value='low'>{_('Low')}</option>
                  <option value='medium'>{_('Medium')}</option>
                  <option value='high'>{_('High')}</option>
                </select>
              </div>
            ))}
          </div>
        )}
      </BoxedList>
    </div>
  );
};

export default AIPanel;
