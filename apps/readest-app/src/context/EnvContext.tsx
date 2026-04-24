'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';
import { runHermesMigration } from '@/services/migration/hermesMigration';
import { EnvConfigType } from '../services/environment';
import { AppService } from '@/types/system';
import env from '../services/environment';

interface EnvContextType {
  envConfig: EnvConfigType;
  appService: AppService | null;
}

const EnvContext = createContext<EnvContextType | undefined>(undefined);

// Coalesce React strict-mode double mounts and concurrent bootstrap calls so startup stays single-flight.
let appServiceInitPromise: Promise<AppService> | null = null;

const initializeAppService = (envConfig: EnvConfigType): Promise<AppService> => {
  if (!appServiceInitPromise) {
    appServiceInitPromise = (async () => {
      await runHermesMigration();
      return envConfig.getAppService();
    })().finally(() => {
      appServiceInitPromise = null;
    });
  }

  return appServiceInitPromise;
};

export const EnvProvider = ({ children }: { children: ReactNode }) => {
  const [envConfig] = useState<EnvConfigType>(env);
  const [appService, setAppService] = useState<AppService | null>(null);

  React.useEffect(() => {
    const init = async () => {
      const service = await initializeAppService(envConfig);
      setAppService(service);
    };
    void init();
    window.addEventListener('error', (e) => {
      if (e.message === 'ResizeObserver loop limit exceeded') {
        e.stopImmediatePropagation();
        e.preventDefault();
        return true;
      }
      return false;
    });
  }, [envConfig]);

  return <EnvContext.Provider value={{ envConfig, appService }}>{children}</EnvContext.Provider>;
};

export const useEnv = (): EnvContextType => {
  const context = useContext(EnvContext);
  if (!context) throw new Error('useEnv must be used within EnvProvider');
  return context;
};
