import { AudioAssetFormat, AudioSyncMapVersion, AudioSyncPackageVersion } from './types';

export const AUDIO_SYNC_DIRNAME = 'audio';
export const AUDIO_ASSET_FILENAME = 'asset.json';
export const AUDIO_CHAPTERS_FILENAME = 'chapters.json';
export const AUDIO_SYNC_MAP_FILENAME = 'sync-map.v2.json';
export const AUDIO_SYNC_LEGACY_MAP_FILENAME = 'sync-map.v1.json';
export const AUDIO_ALIGNMENT_REPORT_FILENAME = 'alignment-report.json';
export const AUDIO_SYNC_EPUB3_DIRNAME = 'epub3-sync';
export const AUDIO_SYNC_EPUB3_VERSION: AudioSyncPackageVersion = 1;
export const AUDIO_SYNC_EPUB3_FILENAME = 'synced.epub';
export const AUDIO_SYNC_PACKAGE_PROVENANCE_FILENAME = 'provenance.json';
export const AUDIO_SYNC_MAP_VERSION: AudioSyncMapVersion = 2;
export const AUDIO_SYNC_DEFAULT_PLAYBACK_RATE = 1;
export const SUPPORTED_AUDIOBOOK_EXTS: AudioAssetFormat[] = ['m4b', 'm4a', 'mp3'];
export const AUDIOBOOK_ACCEPT_FORMATS = SUPPORTED_AUDIOBOOK_EXTS.map((ext) => `.${ext}`).join(', ');
