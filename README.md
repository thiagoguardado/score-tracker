# Scoreboard

A mobile-first, voice-first PWA for keeping score during game night. It has no backend, database, remote AI service, analytics, or persistent audio storage.

The app is English-first and currently includes Brazilian Portuguese. On first use it follows the browser language, falls back to English, and remembers a manual language choice across sessions. Voice recognition, spoken feedback, and commands always follow the selected app language.

## Features

- add and review players with push-to-talk voice input;
- enter, repeat, and correct a round by voice, then confirm it with one button;
- voice commands for ranking, saved rounds, undo, and finishing a game;
- complete manual entry and editing as a fallback;
- multiple games stored on the device;
- rankings recalculated from rounds, including shared positions for ties;
- native result sharing with clipboard fallback;
- on-device speech recognition via the platform Web Speech API (no model download, no transcription API calls);
- push-to-talk with interim transcript while the button is held;
- installable PWA with offline access to the manual app and saved data;
- Screen Wake Lock during active games when supported.
- monochrome, text-only interface with no decorative images or in-app icons.
- system, light, and dark themes with a persistent manual preference.

No persistent action is applied until it is confirmed. Short voice turns exist only in memory while they are recognized and are never persisted or uploaded.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev
```

Validation:

```bash
npm test
npm run build
npm run test:e2e
```

## Voice commands

English examples:

- `Alex ten, Sam seven`
- `repeat`
- `correct Sam to nine`
- `confirm`
- `ranking`
- `repeat round three`
- `undo last round`
- `finish game`

Portuguese examples:

- `Alex dez, Sam sete`
- `repetir`
- `corrigir Sam para nove`
- `confirmar`
- `ranking`
- `repetir a rodada três`
- `desfazer a última rodada`
- `finalizar jogo`

## Voice recognition (native — iOS PWA hardened)

The app uses the platform `SpeechRecognition` / `webkitSpeechRecognition` and `speechSynthesis` directly — no `AudioWorklet`, `MediaRecorder`, Transformers.js, Whisper model, or transcription API. The previous offline Whisper path was removed for speed/quality, but the iPhone failure (“1st tap works with orange dot, 2nd tap shows Dynamic Island mic but no orange dot and `no-speech`/`aborted`”) persists on stable iOS because of **WebKit bug 317741** (“Speech recognition microphone source should keep its audio session active while capturing”, fixed in STP 248 2026-06-26, not yet in stable iOS 18/26).

Architecture that correctly works around the bug (verified against WICG/web-speech-api#96 and SO 79991991):

- **Persistent AVAudioSession keeper** — a silent `AudioContext` (`OscillatorNode` → `GainNode(0.0001)` → `destination`) plus a looping silent `<audio>` (`data:audio/wav` 44 bytes, `volume=0.001`, `playsinline`) started on the first user gesture and resumed on `visibilitychange`. This is the same keeper the former `AudioWorklet` pipeline used; without it the session deactivates between turns and the 2nd `start()` becomes a phantom session (mic icon but no orange dot).
- **One-time `getUserMedia({audio:true})` priming on iOS only** — right before the first `start()`, await `getUserMedia` then immediately `track.stop()` (120 ms). Only once; doing it on every retry adds churn. On non-iOS/jsdom it is skipped so `npm test` stays green.
- **One fresh `SpeechRecognition` per user gesture, never reused** — `pointerDown` (gesture) → warm keeper → `recognition.start()` inside the same gesture chain; `pointerUp`/`pointerCancel`/`lostPointerCapture` → `recognition.stop()`. `interimResults=true` streams partial text while held.
- **Phantom-session detection** — if `onaudiostart` never fires within 1.8 s after `onstart`, the session is the bug’s phantom (Dynamic Island mic without orange dot); it is aborted as `phantom-audio-start` and retried. Without this the app would hang 10 s until `timed-out`.
- **Settle window after TTS** — `speak()` records `lastSpeakEndAt`; `listenOnce()` on iOS waits up to 900 ms after `speechSynthesis.onend` before the next `start()`. iOS needs this for the audio session to be re-acquired; the old code used only 150 ms.
- **Full teardown with grace timers** — `stop()`/`abort()` + `750 ms` + `250 ms` fallback so the next `start()` never collides with a still-releasing session.
- **Escalating auto-retry (iOS only)** — phantom or `network` failures are retried up to 4 times with delays `[0, 350, 1000, 2100] ms` (SO 79991991). Permission/user-cancel errors (`not-allowed`, `aborted`) are never retried. Real `no-speech` (with `onaudiostart`) is surfaced as `noVoice` instead of retried.
- **Serial single-turn loop** — each press yields exactly one transcript; the UI requires a new tap (`waitingForTap` / `tapToContinue`), respecting the iOS gesture rule.
- **Speech output** — `speak()` cancels any active recognition, calls `speechSynthesis.cancel()`, keeps the keeper running, and resolves 150 ms after `onend`/`onerror`.

The selected app language (`en-US` / `pt-BR`) is passed as `recognition.lang` and as `utterance.lang` for synthesis. Player names are supplied as `maxAlternatives=5` hints (`preferredPhrases`) and re-ranked locally (`preferredTranscript()` in `src/speech.ts:115`) for better name/number accuracy.

The required device flow is:

1. tap and hold the voice button (a user gesture);
2. say player names, scores, or a command while interim text appears;
3. release to produce the final transcript;
4. review the recognized values and press `Confirm`;
5. listen to the spoken ranking.

## Data

Games are stored in `localStorage` under `score-tracker:state:v1`. Language and theme preferences are stored separately under `score-tracker:locale` and `score-tracker:theme`. Data is not synchronized between devices or separate browser storage contexts. Clearing site data removes the game history and preferences.

## Deployment

The workflow at `.github/workflows/pages.yml` tests, builds, and deploys `dist` to GitHub Pages after every push to `main`.
