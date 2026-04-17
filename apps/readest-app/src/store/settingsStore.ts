import i18n from '@/i18n/i18n';
import { create } from 'zustand';
import { SystemSettings } from '@/types/settings';
import { EnvConfigType } from '@/services/environment';
import { initDayjs } from '@/utils/time';
import { DEFAULT_AI_PROFILE } from '@/services/ai/constants';

export type FontPanelView = 'main-fonts' | 'custom-fonts';

interface SettingsState {
  settings: SystemSettings;
  settingsDialogBookKey: string;
  isSettingsDialogOpen: boolean;
  isSettingsGlobal: boolean;
  fontPanelView: FontPanelView;
  activeSettingsItemId: string | null;
  setSettings: (settings: SystemSettings) => void;
  saveSettings: (envConfig: EnvConfigType, settings: SystemSettings) => Promise<void>;
  setSettingsDialogBookKey: (bookKey: string) => void;
  setSettingsDialogOpen: (open: boolean) => void;
  setSettingsGlobal: (global: boolean) => void;
  setFontPanelView: (view: FontPanelView) => void;
  setActiveSettingsItemId: (id: string | null) => void;

  applyUILanguage: (uiLanguage?: string) => void;
}

function normalizeSettings(settings: SystemSettings): SystemSettings {
  const aiSettings = settings.aiSettings;
  if (!aiSettings) return settings;
  if ((aiSettings.profiles ?? []).length > 0) return settings;
  const legacyAssignments = (
    aiSettings as typeof aiSettings & {
      modelAssignments?: Record<string, string>;
    }
  ).modelAssignments;
  const profileAssignments = Object.fromEntries(
    Object.entries(legacyAssignments ?? {}).map(([task, providerId]) => [task, { providerId }]),
  );

  return {
    ...settings,
    aiSettings: {
      ...aiSettings,
      profiles: [
        {
          ...DEFAULT_AI_PROFILE,
          modelAssignments: profileAssignments,
        },
      ],
      activeProfileId: DEFAULT_AI_PROFILE.id,
    },
  };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: {} as SystemSettings,
  settingsDialogBookKey: '',
  isSettingsDialogOpen: false,
  isSettingsGlobal: true,
  fontPanelView: 'main-fonts',
  activeSettingsItemId: null,
  setSettings: (settings) => set({ settings: normalizeSettings(settings) }),
  saveSettings: async (envConfig: EnvConfigType, settings: SystemSettings) => {
    const appService = await envConfig.getAppService();
    await appService.saveSettings(settings);
  },
  setSettingsDialogBookKey: (bookKey) => set({ settingsDialogBookKey: bookKey }),
  setSettingsDialogOpen: (open) => set({ isSettingsDialogOpen: open }),
  setSettingsGlobal: (global) => set({ isSettingsGlobal: global }),
  setFontPanelView: (view) => set({ fontPanelView: view }),
  setActiveSettingsItemId: (id) => set({ activeSettingsItemId: id }),

  applyUILanguage: (uiLanguage?: string) => {
    const locale = uiLanguage ? uiLanguage : navigator.language;
    i18n.changeLanguage(locale);
    initDayjs(locale);
  },
}));
