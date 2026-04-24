import { useCallback, useEffect, useRef } from 'react';

import { eventDispatcher } from '@/utils/event';

interface PopupOwnedTTSSpeakInput {
  text: string;
  lang?: string;
}

export function usePopupOwnedTTS(bookKey: string) {
  const startedOwnedSpeechRef = useRef(false);

  const speakOwnedText = useCallback(
    ({ text, lang }: PopupOwnedTTSSpeakInput) => {
      startedOwnedSpeechRef.current = true;
      eventDispatcher.dispatch('tts-popup-speak', {
        bookKey,
        text,
        oneTime: true,
        ...(lang ? { lang } : {}),
      });
    },
    [bookKey],
  );

  const stopOwnedSpeech = useCallback(() => {
    if (!startedOwnedSpeechRef.current) return;
    startedOwnedSpeechRef.current = false;
    eventDispatcher.dispatch('tts-popup-stop', { bookKey });
  }, [bookKey]);

  useEffect(() => stopOwnedSpeech, [stopOwnedSpeech]);

  return { speakOwnedText, stopOwnedSpeech };
}
