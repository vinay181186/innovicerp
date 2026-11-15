// Speak (ADR-293): the browser's own speech recognition (Chrome / Edge), Indian
// English. Recognised words are handed to `onText` to append to the question box —
// they are never sent by themselves; the person checks them first.

import { useCallback, useEffect, useRef, useState } from 'react';

// The Web Speech API is not in TypeScript's DOM lib; only what is used here.
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const SPEECH_UNSUPPORTED = 'Speak works in Chrome and Edge only. Please type here.';
export const SPEECH_BLOCKED =
  'Microphone is blocked. Allow it from the lock icon in the address bar, or type instead.';

export interface SpeechInput {
  listening: boolean;
  /** Words heard so far that are not final yet (shown, not yet in the box). */
  interim: string;
  /** Why Speak cannot work right now, in plain words. */
  problem: string | null;
  start: () => void;
  stop: () => void;
  clearProblem: () => void;
}

export function useSpeechInput(onText: (text: string) => void): SpeechInput {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const recRef = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stop = useCallback(() => {
    recRef.current?.stop();
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setProblem(SPEECH_UNSUPPORTED);
      return;
    }
    if (recRef.current) return;
    setProblem(null);
    const rec = new Ctor();
    rec.lang = 'en-IN';
    rec.interimResults = true;
    rec.continuous = true;
    rec.onresult = (e) => {
      let pending = '';
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r) continue;
        const words = r[0].transcript.trim();
        if (r.isFinal) {
          if (words) onTextRef.current(words);
        } else pending += `${words} `;
      }
      setInterim(pending.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed')
        setProblem(SPEECH_BLOCKED);
    };
    rec.onend = () => {
      recRef.current = null;
      setListening(false);
      setInterim('');
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      setProblem(SPEECH_UNSUPPORTED);
    }
  }, []);

  // Closing the panel stops the microphone.
  useEffect(
    () => () => {
      const rec = recRef.current;
      if (!rec) return;
      rec.onresult = null;
      rec.onend = null;
      rec.onerror = null;
      rec.abort();
      recRef.current = null;
    },
    [],
  );

  const clearProblem = useCallback(() => setProblem(null), []);
  return { listening, interim, problem, start, stop, clearProblem };
}
