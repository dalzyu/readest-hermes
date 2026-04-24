import * as CFI from 'foliate-js/epubcfi.js';

import type { FoliateView } from '@/types/view';

import { getSegmentAtTime, getWordAtTime } from './AudioSyncService';
import {
  AudioSyncFollowMode,
  AudioSyncMap,
  AudioSyncPlaybackState,
  AudioSyncSegment,
  AudioSyncWord,
  BookAudioAsset,
} from './types';

export interface AudioSyncControllerOptions {
  asset: BookAudioAsset;
  map: AudioSyncMap | null;
  src: string;
  audio?: HTMLAudioElement;
  view?: FoliateView | null;
}

export interface AudioSyncStateSnapshot {
  mode: AudioSyncPlaybackState;
  currentTimeMs: number;
  durationMs: number;
  playbackRate: number;
  activeSegmentId: string | null;
  activeWordId: string | null;
  followMode: AudioSyncFollowMode;
}

export class AudioSyncController extends EventTarget {
  private audio: HTMLAudioElement;
  private activeSegmentId: string | null = null;
  private activeWordId: string | null = null;
  private currentTimeMs = 0;
  private mode: AudioSyncPlaybackState = 'idle';
  private followMode: AudioSyncFollowMode = 'audio';
  private view: FoliateView | null = null;

  readonly asset: BookAudioAsset;
  readonly map: AudioSyncMap | null;

  constructor({ asset, map, src, audio, view }: AudioSyncControllerOptions) {
    super();
    this.asset = asset;
    this.map = map;
    this.audio = audio ?? new Audio();
    this.audio.src = src;
    this.audio.preload = 'metadata';
    this.audio.addEventListener('play', this.handlePlay);
    this.audio.addEventListener('pause', this.handlePause);
    this.audio.addEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.addEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.audio.addEventListener('ended', this.handleEnded);
    this.audio.addEventListener('error', this.handleError);
    this.setView(view ?? null);
  }

  private get mediaOverlay() {
    return this.view?.mediaOverlay ?? null;
  }

  private getPlaybackTimeMs() {
    return this.mediaOverlay ? this.currentTimeMs : Math.round(this.audio.currentTime * 1000);
  }

  private updateActiveState(timeMs: number) {
    const segment = this.map ? getSegmentAtTime(this.map, timeMs) : null;
    const word = getWordAtTime(segment, timeMs);
    if (segment?.id !== this.activeSegmentId) {
      this.activeSegmentId = segment?.id ?? null;
      this.dispatchEvent(
        new CustomEvent<AudioSyncSegment | null>('segmentchange', { detail: segment }),
      );
    }
    if (word?.id !== this.activeWordId) {
      this.activeWordId = word?.id ?? null;
      this.dispatchEvent(new CustomEvent<AudioSyncWord | null>('wordchange', { detail: word }));
    }
    this.dispatchEvent(
      new CustomEvent<AudioSyncStateSnapshot>('timeupdate', {
        detail: this.getSnapshot(),
      }),
    );
  }

  private handleMediaOverlayHighlight = (event: Event) => {
    const detail = (event as CustomEvent<{ begin?: number }>).detail;
    this.currentTimeMs = Math.round((detail.begin ?? 0) * 1000);
    if (this.mode !== 'playing') {
      this.mode = 'playing';
      this.emitStateChange();
    }
    this.updateActiveState(this.currentTimeMs);
  };

  setView(view: FoliateView | null) {
    if (this.view?.mediaOverlay) {
      this.view.mediaOverlay.removeEventListener('highlight', this.handleMediaOverlayHighlight);
    }
    this.view = view;
    if (this.view?.mediaOverlay) {
      this.view.mediaOverlay.addEventListener('highlight', this.handleMediaOverlayHighlight);
      this.view.mediaOverlay.setRate(this.audio.playbackRate);
    }
  }

  private emitStateChange() {
    this.dispatchEvent(
      new CustomEvent<AudioSyncStateSnapshot>('statechange', { detail: this.getSnapshot() }),
    );
  }

  private handleLoadedMetadata = () => {
    this.mode = this.audio.paused ? 'paused' : 'idle';
    this.currentTimeMs = Math.round(this.audio.currentTime * 1000);
    this.emitStateChange();
  };

  private handlePlay = () => {
    this.mode = 'playing';
    this.emitStateChange();
  };

  private handlePause = () => {
    if (this.mode !== 'error') {
      this.mode = 'paused';
    }
    this.emitStateChange();
  };

  private handleEnded = () => {
    this.activeSegmentId = null;
    this.activeWordId = null;
    this.currentTimeMs = 0;
    this.mode = 'idle';
    this.emitStateChange();
  };

  private handleError = () => {
    this.mode = 'error';
    this.emitStateChange();
  };

  private handleTimeUpdate = () => {
    this.currentTimeMs = Math.round(this.audio.currentTime * 1000);
    this.updateActiveState(this.currentTimeMs);
  };

  getSnapshot(): AudioSyncStateSnapshot {
    return {
      mode: this.mode,
      currentTimeMs: this.getPlaybackTimeMs(),
      durationMs: this.audio.duration
        ? Math.round(this.audio.duration * 1000)
        : this.asset.durationMs || 0,
      playbackRate: this.audio.playbackRate,
      activeSegmentId: this.activeSegmentId,
      activeWordId: this.activeWordId,
      followMode: this.followMode,
    };
  }

  getActiveSegment(): AudioSyncSegment | null {
    if (!this.map) {
      return null;
    }
    return getSegmentAtTime(this.map, this.getPlaybackTimeMs());
  }

  getActiveWord(segment = this.getActiveSegment()): AudioSyncWord | null {
    return getWordAtTime(segment, this.getPlaybackTimeMs());
  }

  setFollowMode(mode: AudioSyncFollowMode) {
    this.followMode = mode;
    this.emitStateChange();
  }

  setRate(rate: number) {
    this.audio.playbackRate = rate;
    this.mediaOverlay?.setRate(rate);
    this.emitStateChange();
  }

  async play() {
    if (this.mediaOverlay) {
      const shouldResume = this.mode === 'paused' && this.activeSegmentId;
      this.mode = 'loading';
      this.emitStateChange();
      if (shouldResume) {
        this.mediaOverlay.resume();
      } else if (this.currentTimeMs > 0) {
        this.seekToMs(this.currentTimeMs);
      } else if (this.view?.startMediaOverlay) {
        await this.view.startMediaOverlay();
      } else {
        await this.mediaOverlay.start(0);
      }
      this.mode = 'playing';
      this.emitStateChange();
      return;
    }
    this.mode = 'loading';
    this.emitStateChange();
    await this.audio.play();
  }

  pause() {
    if (this.mediaOverlay) {
      this.mediaOverlay.pause();
      this.mode = 'paused';
      this.emitStateChange();
      return;
    }
    this.audio.pause();
  }

  stop() {
    if (this.mediaOverlay) {
      this.mediaOverlay.stop();
      this.activeSegmentId = null;
      this.activeWordId = null;
      this.currentTimeMs = 0;
      this.mode = 'idle';
      this.emitStateChange();
      return;
    }
    this.audio.pause();
    this.audio.currentTime = 0;
    this.activeSegmentId = null;
    this.activeWordId = null;
    this.mode = 'idle';
    this.emitStateChange();
  }

  seekToMs(timeMs: number) {
    if (this.mediaOverlay && this.map && this.view) {
      const segment = getSegmentAtTime(this.map, timeMs);
      if (!segment) {
        return;
      }
      const navigation = this.view.resolveNavigation(segment.cfiStart);
      const targetSeconds = Math.max(0, timeMs) / 1000;
      this.currentTimeMs = Math.max(0, timeMs);
      void this.mediaOverlay.start(
        navigation.index,
        (item) => targetSeconds >= item.begin && targetSeconds < item.end,
      );
      this.updateActiveState(this.currentTimeMs);
      return;
    }
    this.audio.currentTime = Math.max(0, timeMs) / 1000;
    this.handleTimeUpdate();
  }

  seekToCfi(cfi: string): boolean {
    const word = this.findWordForCfi(cfi);
    if (word) {
      this.seekToMs(word.audioStartMs);
      return true;
    }
    const segment = this.findSegmentForCfi(cfi);
    if (!segment) {
      return false;
    }
    this.seekToMs(segment.audioStartMs);
    return true;
  }

  findWordForCfi(cfi: string): AudioSyncWord | null {
    if (!this.map) {
      return null;
    }

    for (const segment of this.map.segments) {
      for (const word of segment.words || []) {
        try {
          if (CFI.compare(cfi, word.cfiStart) >= 0 && CFI.compare(cfi, word.cfiEnd) <= 0) {
            return word;
          }
        } catch {
          // CFI.compare throws for malformed CFIs; skip and continue iteration
        }
      }
    }

    return null;
  }

  findSegmentForCfi(cfi: string): AudioSyncSegment | null {
    if (!this.map) {
      return null;
    }

    for (const segment of this.map.segments) {
      try {
        if (CFI.compare(cfi, segment.cfiStart) >= 0 && CFI.compare(cfi, segment.cfiEnd) <= 0) {
          return segment;
        }
      } catch {
        // CFI.compare throws for malformed CFIs; skip and continue iteration
      }
    }

    return null;
  }

  dispose() {
    this.mediaOverlay?.stop();
    this.setView(null);
    this.audio.pause();
    this.audio.removeEventListener('play', this.handlePlay);
    this.audio.removeEventListener('pause', this.handlePause);
    this.audio.removeEventListener('timeupdate', this.handleTimeUpdate);
    this.audio.removeEventListener('loadedmetadata', this.handleLoadedMetadata);
    this.audio.removeEventListener('ended', this.handleEnded);
    this.audio.removeEventListener('error', this.handleError);
  }
}
