import { AppService } from '@/types/system';
import { CLOUD_ENABLED } from './constants';

// Hermes offline builds are fail-closed: only explicit backend URLs are accepted.
const resolveBaseUrl = (envVarName: 'NEXT_PUBLIC_API_BASE_URL' | 'NEXT_PUBLIC_NODE_BASE_URL') => {
  const configuredBaseUrl = process.env[envVarName]?.trim();

  if (configuredBaseUrl) {
    return configuredBaseUrl;
  }

  if (CLOUD_ENABLED) {
    throw new Error(`${envVarName} must be set when cloud features are enabled`);
  }

  return '';
};

export const getBaseUrl = () => resolveBaseUrl('NEXT_PUBLIC_API_BASE_URL');
export const getNodeBaseUrl = () => resolveBaseUrl('NEXT_PUBLIC_NODE_BASE_URL');

declare global {
  interface Window {
    __HERMES_CLI_ACCESS?: boolean;
  }
}

export const isTauriAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'tauri';
export const isWebAppPlatform = () => process.env['NEXT_PUBLIC_APP_PLATFORM'] === 'web';
export const hasCli = () => window.__HERMES_CLI_ACCESS === true;
export const isPWA = () => window.matchMedia('(display-mode: standalone)').matches;

export const isMacPlatform = () =>
  typeof window !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const getCommandPaletteShortcut = () => (isMacPlatform() ? '⌘⇧P' : 'Ctrl+Shift+P');

const hasConfiguredBaseUrl = (
  envVarName: 'NEXT_PUBLIC_API_BASE_URL' | 'NEXT_PUBLIC_NODE_BASE_URL',
) => Boolean(process.env[envVarName]?.trim());

const isWebDevMode = () => process.env['NODE_ENV'] === 'development' && isWebAppPlatform();

// Dev API only in development mode and web platform
// with command `pnpm dev-web`
// for production build or tauri app use the production Web API
export const getAPIBaseUrl = () =>
  isWebDevMode() && !hasConfiguredBaseUrl('NEXT_PUBLIC_API_BASE_URL')
    ? '/api'
    : `${getBaseUrl()}/api`;

// For Node.js API that currently not supported in some edge runtimes
export const getNodeAPIBaseUrl = () =>
  isWebDevMode() && !hasConfiguredBaseUrl('NEXT_PUBLIC_NODE_BASE_URL')
    ? '/api'
    : `${getNodeBaseUrl()}/api`;

export interface EnvConfigType {
  getAppService: () => Promise<AppService>;
}

let nativeAppService: AppService | null = null;
const getNativeAppService = async () => {
  if (!nativeAppService) {
    const { NativeAppService } = await import('@/services/nativeAppService');
    nativeAppService = new NativeAppService();
    await nativeAppService.init();
  }
  return nativeAppService;
};

let webAppService: AppService | null = null;
const getWebAppService = async () => {
  if (!webAppService) {
    const { WebAppService } = await import('@/services/webAppService');
    webAppService = new WebAppService();
    await webAppService.init();
  }
  return webAppService;
};

const environmentConfig: EnvConfigType = {
  getAppService: async () => {
    if (isTauriAppPlatform()) {
      return getNativeAppService();
    } else {
      return getWebAppService();
    }
  },
};

export default environmentConfig;
