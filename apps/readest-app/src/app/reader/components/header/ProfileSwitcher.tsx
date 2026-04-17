import React from 'react';
import { useEnv } from '@/context/EnvContext';
import { useSettingsStore } from '@/store/settingsStore';
import { useTranslation } from '@/hooks/useTranslation';

const ProfileSwitcher: React.FC = () => {
  const _ = useTranslation();
  const { envConfig } = useEnv();
  const { settings, setSettings, saveSettings } = useSettingsStore();
  const aiSettings = settings.aiSettings;

  const profiles = aiSettings?.profiles ?? [];
  const activeProfileId = aiSettings?.activeProfileId ?? profiles[0]?.id ?? '';

  if (profiles.length === 0) return null;

  return (
    <select
      className='select select-bordered select-xs bg-base-100 text-base-content h-7 min-h-7 max-w-36'
      value={activeProfileId}
      onChange={(event) => {
        const nextSettings = {
          ...settings,
          aiSettings: {
            ...aiSettings,
            activeProfileId: event.target.value,
          },
        };
        setSettings(nextSettings);
        void saveSettings(envConfig, nextSettings);
      }}
      title={_('AI Profile')}
      aria-label={_('AI Profile')}
    >
      {profiles.map((profile) => (
        <option key={profile.id} value={profile.id}>
          {profile.name}
        </option>
      ))}
    </select>
  );
};

export default ProfileSwitcher;
