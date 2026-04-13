import { resolvePluginLanguage } from '../languagePolicy';
import type { ContextLookupMode } from '../modes';
import type { LookupPlugin } from './types';
import { fallbackPlugin } from './fallbackPlugin';
import { zhPlugin } from './zhPlugin';
import { enPlugin } from './enPlugin';
import { jaPlugin } from './jaPlugin';

const PLUGIN_MAP: Record<string, LookupPlugin> = {
  zh: zhPlugin,
  ja: jaPlugin,
  en: enPlugin,
  fallback: fallbackPlugin,
};

function resolvePlugin(language: string): LookupPlugin {
  const chain = resolvePluginLanguage(language);
  for (const candidate of chain) {
    const plugin = PLUGIN_MAP[candidate];
    if (plugin) {
      return plugin;
    }
  }
  return fallbackPlugin;
}

export type ResolveLookupPluginsOptions = {
  sourceLanguage: string;
  targetLanguage: string;
  mode: ContextLookupMode;
};

export type ResolvedLookupPlugins = {
  source: LookupPlugin;
  target: LookupPlugin;
};

export function resolveLookupPlugins(options: ResolveLookupPluginsOptions): ResolvedLookupPlugins {
  const { sourceLanguage, targetLanguage } = options;
  return {
    source: resolvePlugin(sourceLanguage),
    target: resolvePlugin(targetLanguage),
  };
}
