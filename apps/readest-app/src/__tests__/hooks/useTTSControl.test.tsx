import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Dependency mocks (must be set up before importing the hook) ---

vi.mock('@/context/EnvContext', () => ({
  useEnv: () => ({
    appService: { isIOSApp: false, isMobile: false },
    envConfig: {},
  }),
}));

vi.mock('@/context/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

vi.mock('@/store/themeStore', () => ({
  useThemeStore: () => ({ isDarkMode: false }),
}));

const mockView = {
  book: { primaryLanguage: 'en', sections: [{ id: 0 }] },
  renderer: {
    getContents: () => [{ index: 0, doc: document as unknown as Document }],
    scrollToAnchor: vi.fn(),
    primaryIndex: 0,
    scrolled: false,
    nextSection: vi.fn(),
    start: 0,
    end: 0,
    sideProp: 'height',
    goTo: vi.fn(),
  },
  resolveCFI: vi.fn().mockReturnValue({ index: 0, anchor: () => new Range() }),
  getCFI: vi.fn().mockReturnValue('cfi'),
  deselect: vi.fn(),
  resolveNavigation: vi.fn(),
  history: { back: vi.fn(), forward: vi.fn() },
  tts: {
    from: vi.fn().mockReturnValue('<speak>hello</speak>'),
    start: vi.fn().mockReturnValue('<speak>hello</speak>'),
    getLastRange: vi.fn().mockReturnValue(null),
    highlight: vi.fn(),
  },
};

const mockProgress = {
  location: { start: { cfi: '' }, end: { cfi: '' } },
  index: 0,
  range: null,
  sectionLabel: '',
};

const mockViewSettings = {
  ttsLocation: null as string | null,
  ttsRate: 1,
  ttsHighlightOptions: { style: 'highlight', color: '#ffff00' },
  isEink: false,
  showTTSBar: false,
  ttsMediaMetadata: 'sentence',
  translationEnabled: false,
  ttsReadAloudText: 'source',
};

const mockBookData = {
  isFixedLayout: false,
  book: { primaryLanguage: 'en', title: 'T', author: 'A', coverImageUrl: '' },
};

vi.mock('@/store/readerStore', () => {
  const store = {
    hoveredBookKey: null,
    getView: () => mockView,
    getProgress: () => mockProgress,
    getViewSettings: () => mockViewSettings,
    setViewSettings: vi.fn(),
    setTTSEnabled: vi.fn(),
  };
  const useReaderStore = () => store;
  useReaderStore.getState = () => store;
  return { useReaderStore };
});

vi.mock('@/store/bookDataStore', () => ({
  useBookDataStore: () => ({
    getBookData: () => mockBookData,
  }),
}));

vi.mock('@/store/proofreadStore', () => ({
  useProofreadStore: () => ({
    getMergedRules: () => [],
  }),
}));

vi.mock('@/services/transformers/proofread', () => ({
  proofreadTransformer: {
    transform: vi.fn(async (ctx: { content: string }) => ctx.content),
  },
}));

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => (s: string) => s,
}));

// Track TTSController instantiations — this is the assertion target.
const ttsControllerInstances: unknown[] = [];
// Gate init() calls so that handleTTSSpeak stays suspended inside an `await`.
// This is the exact point where a second concurrent invocation would otherwise
// race ahead and construct a second TTSController. The test releases all
// pending resolvers once both dispatches have had a chance to interleave.
const pendingInitResolvers: Array<() => void> = [];
const pendingOneTimeCallbacks: Array<() => void> = [];

vi.mock('@/services/tts', () => ({
  TTSController: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, {
      init: vi.fn().mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            pendingInitResolvers.push(() => resolve());
          }),
      ),
      initViewTTS: vi.fn().mockResolvedValue(undefined),
      updateHighlightOptions: vi.fn(),
      setLang: vi.fn(),
      setRate: vi.fn(),
      setVoice: vi.fn(),
      setTargetLang: vi.fn(),
      speak: vi.fn().mockImplementation((...args: unknown[]) => {
        const [, oneTime, callback] = args as [
          string,
          boolean | undefined,
          (() => void) | undefined,
        ];
        if (oneTime && callback) {
          pendingOneTimeCallbacks.push(callback);
        }
      }),
      pause: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this['state'] = 'paused';
        return Promise.resolve(undefined);
      }),
      resume: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this['state'] = 'playing';
        return Promise.resolve(undefined);
      }),
      start: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this['state'] = 'playing';
        return Promise.resolve(undefined);
      }),
      stop: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this['state'] = 'stopped';
        return Promise.resolve(undefined);
      }),
      shutdown: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this['state'] = 'stopped';
        return Promise.resolve(undefined);
      }),
      forward: vi.fn().mockResolvedValue(undefined),
      backward: vi.fn().mockResolvedValue(undefined),
      getVoices: vi.fn().mockResolvedValue([]),
      getVoiceId: vi.fn().mockReturnValue(''),
      state: 'idle',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    ttsControllerInstances.push(this);
  }),
}));

vi.mock('@/libs/mediaSession', () => ({
  TauriMediaSession: class {},
}));

vi.mock('@/utils/ssml', () => ({
  genSSMLRaw: vi.fn((s: string) => `<speak>${s}</speak>`),
  parseSSMLLang: vi.fn(() => 'en'),
}));

vi.mock('@/utils/throttle', () => ({
  throttle: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
}));

vi.mock('@/utils/cfi', () => ({
  isCfiInLocation: () => false,
}));

vi.mock('@/utils/misc', () => ({
  getLocale: () => 'en',
}));

vi.mock('@/utils/ttsMetadata', () => ({
  buildTTSMediaMetadata: () => ({
    shouldUpdate: false,
    title: '',
    artist: '',
    album: '',
  }),
}));

vi.mock('@/utils/bridge', () => ({
  invokeUseBackgroundAudio: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/ttsTime', () => ({
  estimateTTSTime: () => ({
    chapterRemainingSec: 0,
    bookRemainingSec: 0,
    finishAtTimestamp: 0,
  }),
}));

vi.mock('@/app/reader/hooks/useTTSMediaSession', () => ({
  useTTSMediaSession: () => ({
    mediaSessionRef: { current: null },
    unblockAudio: vi.fn(),
    releaseUnblockAudio: vi.fn(),
    initMediaSession: vi.fn().mockResolvedValue(undefined),
    deinitMediaSession: vi.fn().mockResolvedValue(undefined),
  }),
}));

// Imports must come AFTER vi.mock calls so they pick up the mocked modules.
import { useTTSControl } from '@/app/reader/hooks/useTTSControl';
import { eventDispatcher } from '@/utils/event';

type MockTtsController = Record<string, unknown> & {
  stop: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  state: string;
};

const Harness = () => {
  useTTSControl({ bookKey: 'book-1' });
  return null;
};

const flushMicrotasks = async (iterations = 10) => {
  for (let i = 0; i < iterations; i++) await Promise.resolve();
};

const startAmbientSpeech = async (): Promise<MockTtsController> => {
  const ambientDispatch = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
  await flushMicrotasks();
  expect(ttsControllerInstances.length).toBe(1);
  while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
  await ambientDispatch;

  const ambientController = ttsControllerInstances[0] as MockTtsController;
  ambientController.state = 'playing';
  return ambientController;
};

const startPopupSpeech = async (text = 'popup text'): Promise<MockTtsController> => {
  const popupDispatch = eventDispatcher.dispatch('tts-popup-speak', {
    bookKey: 'book-1',
    text,
    lang: 'en',
  });
  await flushMicrotasks();
  expect(ttsControllerInstances.length).toBe(2);
  while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
  await popupDispatch;

  const popupController = ttsControllerInstances[1] as MockTtsController;
  expect(popupController.speak).toHaveBeenCalledTimes(1);
  return popupController;
};

describe('useTTSControl concurrent tts-speak events', () => {
  beforeEach(() => {
    ttsControllerInstances.length = 0;
    pendingInitResolvers.length = 0;
    pendingOneTimeCallbacks.length = 0;
  });

  afterEach(() => {
    cleanup();
  });

  it('creates only one TTSController when two tts-speak events fire back-to-back', async () => {
    render(<Harness />);

    await act(async () => {
      // Kick off both dispatches without awaiting — this models rapid clicks
      // where the second click arrives while the first is still inside its
      // initial awaits (initMediaSession / backgroundAudio / init()).
      const p1 = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });
      const p2 = eventDispatcher.dispatch('tts-speak', { bookKey: 'book-1' });

      // Let both invocations drain microtasks and reach their gated await.
      // Without the single-flight guard in handleTTSSpeak, both invocations
      // would construct a TTSController here and both would be queued in
      // pendingInitResolvers.
      for (let i = 0; i < 10; i++) await Promise.resolve();

      // The assertion that matters: exactly one controller was constructed.
      expect(ttsControllerInstances.length).toBe(1);

      // Release any pending init() promises so the dispatch chain can unwind
      // cleanly (otherwise the act() would never settle).
      while (pendingInitResolvers.length > 0) pendingInitResolvers.shift()!();
      await Promise.all([p1, p2]);
    });
  });

  it('restores ambient book TTS after popup speech finishes', async () => {
    render(<Harness />);

    let ambientController!: MockTtsController;
    await act(async () => {
      ambientController = await startAmbientSpeech();
    });

    let popupController!: MockTtsController;
    await act(async () => {
      popupController = await startPopupSpeech();
    });

    expect(ambientController.stop).toHaveBeenCalledTimes(1);

    const popupSpeakCallback = pendingOneTimeCallbacks.shift();
    expect(popupSpeakCallback).toBeDefined();

    await act(async () => {
      popupSpeakCallback?.();
      await flushMicrotasks(5);
    });

    expect(popupController.shutdown).toHaveBeenCalledTimes(1);
    expect(ambientController.start).toHaveBeenCalledTimes(1);
    expect(ambientController.shutdown).not.toHaveBeenCalled();
  });

  it('stopping popup speech resumes ambient TTS without double-restoring', async () => {
    render(<Harness />);

    let ambientController!: MockTtsController;
    await act(async () => {
      ambientController = await startAmbientSpeech();
    });

    let popupController!: MockTtsController;
    await act(async () => {
      popupController = await startPopupSpeech();
    });

    expect(ambientController.stop).toHaveBeenCalledTimes(1);

    await act(async () => {
      await eventDispatcher.dispatch('tts-popup-stop', { bookKey: 'book-1' });
      await flushMicrotasks(5);
    });

    expect(popupController.shutdown).toHaveBeenCalledTimes(1);
    expect(ambientController.stop).toHaveBeenCalledTimes(1);

    const staleCallback = pendingOneTimeCallbacks.shift();
    expect(staleCallback).toBeDefined();

    await act(async () => {
      staleCallback?.();
      await flushMicrotasks(5);
    });

    expect(ambientController.start).toHaveBeenCalledTimes(1);
    expect(ambientController.shutdown).not.toHaveBeenCalled();
  });
});
