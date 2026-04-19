import { FileSystem } from '@/types/system';
import { ReadSettings, SystemSettings } from '@/types/settings';
import { DEFAULT_HIGHLIGHT_COLORS, UserHighlightColor, ViewSettings } from '@/types/book';
import { v4 as uuidv4 } from 'uuid';
import {
  DEFAULT_BOOK_LAYOUT,
  DEFAULT_BOOK_STYLE,
  DEFAULT_BOOK_FONT,
  DEFAULT_BOOK_LANGUAGE,
  DEFAULT_VIEW_CONFIG,
  DEFAULT_READSETTINGS,
  SYSTEM_SETTINGS_VERSION,
  DEFAULT_TTS_CONFIG,
  DEFAULT_MOBILE_VIEW_SETTINGS,
  DEFAULT_SYSTEM_SETTINGS,
  DEFAULT_CJK_VIEW_SETTINGS,
  DEFAULT_MOBILE_READSETTINGS,
  DEFAULT_SCREEN_CONFIG,
  DEFAULT_TRANSLATOR_CONFIG,
  SETTINGS_FILENAME,
  DEFAULT_MOBILE_SYSTEM_SETTINGS,
  DEFAULT_ANNOTATOR_CONFIG,
  DEFAULT_EINK_VIEW_SETTINGS,
} from './constants';
import { DEFAULT_AI_SETTINGS, DEFAULT_AI_PROFILE } from './ai/constants';
import type { AISettings, AITaskType, ModelEntry, ProviderConfig } from './ai/types';
import { getTargetLang, isCJKEnv } from '@/utils/misc';
import { safeLoadJSON, safeSaveJSON } from './persistence';

import { resolveContextTranslationFieldSources } from '@/services/contextTranslation/defaults';
export interface Context {
  fs: FileSystem;
  isMobile: boolean;
  isEink: boolean;
  isAppDataSandbox: boolean;
}

export function getDefaultViewSettings(ctx: Context): ViewSettings {
  return {
    ...DEFAULT_BOOK_LAYOUT,
    ...DEFAULT_BOOK_STYLE,
    ...DEFAULT_BOOK_FONT,
    ...DEFAULT_BOOK_LANGUAGE,
    ...(ctx.isMobile ? DEFAULT_MOBILE_VIEW_SETTINGS : {}),
    ...(ctx.isEink ? DEFAULT_EINK_VIEW_SETTINGS : {}),
    ...(isCJKEnv() ? DEFAULT_CJK_VIEW_SETTINGS : {}),
    ...DEFAULT_VIEW_CONFIG,
    ...DEFAULT_TTS_CONFIG,
    ...DEFAULT_SCREEN_CONFIG,
    ...DEFAULT_ANNOTATOR_CONFIG,
    ...{ ...DEFAULT_TRANSLATOR_CONFIG, translateTargetLang: getTargetLang() },
  };
}

/**
 * Normalize highlight color prefs into the current shape:
 * - `userHighlightColors` becomes `UserHighlightColor[]`. Legacy `string[]` entries
 *   are lifted into `{ hex }`. A legacy `highlightColorLabels` map (shipped only in
 *   draft builds of this feature) is folded in: hex entries attach to matching user
 *   colors, named entries move into `defaultHighlightLabels`.
 */
export function migrateHighlightColorPrefs(read: ReadSettings): void {
  const rawUser = (read.userHighlightColors ?? []) as unknown[];
  const userColors: UserHighlightColor[] = rawUser
    .map((entry) => {
      if (typeof entry === 'string') {
        return { hex: entry.trim().toLowerCase() };
      }
      if (entry && typeof entry === 'object' && 'hex' in entry) {
        const { hex, label } = entry as UserHighlightColor;
        return {
          hex: typeof hex === 'string' ? hex.trim().toLowerCase() : '',
          ...(label?.trim() ? { label: label.trim() } : {}),
        };
      }
      return { hex: '' };
    })
    .filter((entry) => entry.hex.startsWith('#'));

  read.defaultHighlightLabels = { ...(read.defaultHighlightLabels ?? {}) };

  const legacyLabels = (read as unknown as { highlightColorLabels?: unknown }).highlightColorLabels;
  if (legacyLabels && typeof legacyLabels === 'object') {
    const labels = legacyLabels as Record<string, unknown>;
    for (const name of DEFAULT_HIGHLIGHT_COLORS) {
      const value = labels[name];
      if (typeof value === 'string' && value.trim() && !read.defaultHighlightLabels[name]) {
        read.defaultHighlightLabels[name] = value.trim();
      }
    }
    for (const entry of userColors) {
      if (entry.label) continue;
      const value = labels[entry.hex];
      if (typeof value === 'string' && value.trim()) {
        entry.label = value.trim();
      }
    }
    delete (read as unknown as { highlightColorLabels?: unknown }).highlightColorLabels;
  }

  read.userHighlightColors = userColors;
}

function getLegacyModelSelection(
  provider: ProviderConfig,
  task: AITaskType,
): { providerId: string; modelId: string } | undefined {
  const kind: ModelEntry['kind'] = task === 'embedding' ? 'embedding' : 'chat';
  const modelId = provider.models.find((model) => model.kind === kind)?.id;
  if (!modelId) return undefined;
  return { providerId: provider.id, modelId };
}

function migrateProviderConfigShape(provider: unknown): ProviderConfig | null {
  if (!provider || typeof provider !== 'object') return null;
  const legacy = provider as ProviderConfig & {
    model?: string;
    embeddingModel?: string;
    apiStyle?: 'chat-completions' | 'responses';
    providerType?: string;
  };
  const legacyProviderType = (provider as { providerType?: string }).providerType;
  if (!legacy.id || !legacyProviderType) return null;

  const providerType =
    legacyProviderType === 'openai-compatible'
      ? 'openai'
      : (legacyProviderType as ProviderConfig['providerType']);
  const existingModels = Array.isArray((legacy as ProviderConfig).models)
    ? (legacy as ProviderConfig).models.filter((model) => model?.id && model?.kind)
    : [];
  const migratedModels: ModelEntry[] = [...existingModels];
  if (migratedModels.length === 0 && typeof legacy.model === 'string' && legacy.model.trim()) {
    migratedModels.push({ id: legacy.model.trim(), kind: 'chat' });
  }
  if (
    typeof legacy.embeddingModel === 'string' &&
    legacy.embeddingModel.trim() &&
    !migratedModels.some((model) => model.kind === 'embedding')
  ) {
    migratedModels.push({ id: legacy.embeddingModel.trim(), kind: 'embedding' });
  }

  return {
    id: legacy.id,
    name: legacy.name ?? '',
    providerType,
    baseUrl: legacy.baseUrl ?? '',
    apiKey: legacy.apiKey,
    models: migratedModels,
    apiStandard:
      (legacy as { apiStandard?: 'chat-completions' | 'responses' }).apiStandard ?? legacy.apiStyle,
  };
}

function migrateAISettingsShape(aiSettings: AISettings): AISettings {
  const providers = aiSettings.providers
    .map((provider) => migrateProviderConfigShape(provider))
    .filter((provider): provider is ProviderConfig => provider !== null);

  const legacyModelAssignments = (
    aiSettings as AISettings & {
      modelAssignments?: Partial<Record<AITaskType, string>>;
    }
  ).modelAssignments;
  const existingProfiles = Array.isArray(aiSettings.profiles) ? aiSettings.profiles : [];
  const profiles =
    existingProfiles.length > 0
      ? existingProfiles
      : [
          {
            ...DEFAULT_AI_PROFILE,
            modelAssignments: Object.fromEntries(
              (Object.entries(legacyModelAssignments ?? {}) as Array<[AITaskType, string]>).flatMap(
                ([task, providerId]) => {
                  const provider = providers.find((entry) => entry.id === providerId);
                  const selection = provider ? getLegacyModelSelection(provider, task) : undefined;
                  return selection ? [[task, selection]] : [];
                },
              ),
            ),
          },
        ];

  const activeProfileId =
    aiSettings.activeProfileId &&
    profiles.some((profile) => profile.id === aiSettings.activeProfileId)
      ? aiSettings.activeProfileId
      : profiles[0]?.id || DEFAULT_AI_PROFILE.id;

  return {
    ...DEFAULT_AI_SETTINGS,
    ...aiSettings,
    providers,
    profiles,
    activeProfileId,
    developerMode: aiSettings.developerMode ?? false,
  };
}

export function migrateContextTranslationSource(settings: SystemSettings): void {
  const current = settings.globalReadSettings.contextTranslation;
  if (!current) return;

  current.fieldSources = resolveContextTranslationFieldSources(current);
  delete (current as { source?: unknown }).source;
}

export async function loadSettings(ctx: Context): Promise<SystemSettings> {
  const defaultSettings: SystemSettings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...(ctx.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
    version: SYSTEM_SETTINGS_VERSION,
    localBooksDir: await ctx.fs.getPrefix('Books'),
    koreaderSyncDeviceId: uuidv4(),
    globalReadSettings: {
      ...DEFAULT_READSETTINGS,
      ...(ctx.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
    },
    globalViewSettings: getDefaultViewSettings(ctx),
  } as SystemSettings;

  let settings = await safeLoadJSON<SystemSettings>(
    ctx.fs,
    SETTINGS_FILENAME,
    'Settings',
    defaultSettings,
  );

  const version = settings.version ?? 0;
  if (ctx.isAppDataSandbox || version < SYSTEM_SETTINGS_VERSION) {
    settings.version = SYSTEM_SETTINGS_VERSION;
  }
  settings = {
    ...DEFAULT_SYSTEM_SETTINGS,
    ...(ctx.isMobile ? DEFAULT_MOBILE_SYSTEM_SETTINGS : {}),
    ...settings,
  };
  settings.globalReadSettings = {
    ...DEFAULT_READSETTINGS,
    ...(ctx.isMobile ? DEFAULT_MOBILE_READSETTINGS : {}),
    ...settings.globalReadSettings,
  };
  migrateHighlightColorPrefs(settings.globalReadSettings);
  migrateContextTranslationSource(settings);
  settings.globalViewSettings = {
    ...getDefaultViewSettings(ctx),
    ...settings.globalViewSettings,
  };
  settings.aiSettings = migrateAISettingsShape({
    ...DEFAULT_AI_SETTINGS,
    ...settings.aiSettings,
  });

  settings.localBooksDir = await ctx.fs.getPrefix('Books');

  if (!settings.kosync.deviceId) {
    settings.kosync.deviceId = uuidv4();
    await saveSettings(ctx.fs, settings);
  }

  return settings;
}

export async function saveSettings(fs: FileSystem, settings: SystemSettings): Promise<void> {
  await safeSaveJSON(fs, SETTINGS_FILENAME, 'Settings', settings);
}
