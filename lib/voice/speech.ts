/**
 * Web Speech API wrappers — STT (SpeechRecognition) + TTS (SpeechSynthesis).
 *
 * Why Web Speech: free, browser-native, zero infra. Quality is good in
 * Chrome/Edge. Caveats: not in Firefox; Safari has SpeechRecognition behind
 * a webkit prefix.
 *
 * STT usage:
 *   const r = createRecognizer({ onPartial, onFinal });
 *   r.start();   // begin transcribing
 *   r.stop();    // stop and emit a final result
 *
 * TTS usage:
 *   await speak('Hello there.');   // resolves when speaking is done
 *   cancelSpeak();                 // interrupt
 */

/* ============================================================ STT */

type Recognizer = {
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type RecognizerOptions = {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (err: unknown) => void;
  lang?: string;
};

/** Returns true if the browser exposes SpeechRecognition. */
export function isSpeechRecognitionSupported(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(
    window.SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: unknown })
      .webkitSpeechRecognition
  );
}

export function createRecognizer(opts: RecognizerOptions = {}): Recognizer {
  if (typeof window === 'undefined') throw new Error('SSR-only context');
  const Ctor =
    window.SpeechRecognition ||
    (
      window as unknown as {
        webkitSpeechRecognition: new () => SpeechRecognition;
      }
    ).webkitSpeechRecognition;
  if (!Ctor) {
    throw new Error('SpeechRecognition not supported in this browser');
  }

  const r = new Ctor();
  r.lang = opts.lang ?? 'en-US';
  r.continuous = true;
  r.interimResults = true;
  r.maxAlternatives = 1;

  let partial = '';

  r.onresult = (ev: SpeechRecognitionEvent) => {
    let finalText = '';
    let interimText = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const res = ev.results[i];
      const t = res[0].transcript;
      if (res.isFinal) finalText += t;
      else interimText += t;
    }
    if (interimText) {
      partial = interimText;
      opts.onPartial?.(interimText);
    }
    if (finalText) {
      opts.onFinal?.(finalText.trim());
    }
  };

  r.onerror = (ev: SpeechRecognitionErrorEvent) => {
    opts.onError?.(ev.error || ev);
  };

  return {
    start: () => r.start(),
    stop: () => r.stop(),
    abort: () => r.abort(),
  };
}

/* ============================================================ TTS */

let cachedVoice: SpeechSynthesisVoice | null = null;

function pickVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined') return null;
  if (cachedVoice) return cachedVoice;
  const voices = window.speechSynthesis.getVoices();
  // Prefer high-quality English voices
  const preferred =
    voices.find((v) => /Google US English/i.test(v.name)) ||
    voices.find((v) => /Samantha|Karen|Daniel/i.test(v.name)) ||
    voices.find((v) => v.lang === 'en-US') ||
    voices[0] ||
    null;
  cachedVoice = preferred;
  return preferred;
}

export function speak(text: string): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      resolve();
      return;
    }
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.0;
    u.pitch = 1.0;
    u.volume = 1.0;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function cancelSpeak(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

/* ============================================================ Type shims
   The DOM lib types for SpeechRecognition aren't in the stable TS dom lib.
   Declare a minimal shim so this file compiles cleanly. */

declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
  }
  interface SpeechRecognition extends EventTarget {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    maxAlternatives: number;
    onresult: ((this: SpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
    onerror:
      | ((this: SpeechRecognition, ev: SpeechRecognitionErrorEvent) => void)
      | null;
    onend: ((this: SpeechRecognition, ev: Event) => void) | null;
    start(): void;
    stop(): void;
    abort(): void;
  }
  interface SpeechRecognitionEvent extends Event {
    resultIndex: number;
    results: SpeechRecognitionResultList;
  }
  interface SpeechRecognitionErrorEvent extends Event {
    error: string;
  }
  interface SpeechRecognitionResultList {
    readonly length: number;
    [index: number]: SpeechRecognitionResult;
  }
  interface SpeechRecognitionResult {
    readonly length: number;
    readonly isFinal: boolean;
    [index: number]: SpeechRecognitionAlternative;
  }
  interface SpeechRecognitionAlternative {
    readonly transcript: string;
    readonly confidence: number;
  }
}
export {};
