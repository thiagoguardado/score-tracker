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

## Voice recognition (native)

The app uses the platform `SpeechRecognition` / `webkitSpeechRecognition` and `speechSynthesis` directly — no `getUserMedia`, `AudioWorklet`, `MediaRecorder`, Transformers.js, Whisper model, or transcription API. This keeps the mic session owned solely by the OS speech service, which is what fixes the iPhone failure mode where the orange dot never appeared and subsequent turns produced no audio.

Why it now reliably works on iPhone:

- no competing `getUserMedia` stream — the previous volume-meter stream stole the mic from the speech service on iOS; volume feedback is now synthetic and no secondary AudioContext is created;
- one fresh `SpeechRecognition` instance per user gesture, never reused — `start()` is called synchronously inside the `pointerDown` handler;
- full teardown with `stop()`/`abort()` grace timers (750 ms + 250 ms fallback) so the next `start()` never collides with a still-releasing session;
- push-to-talk gating: `pointerDown` → `recognition.start()`, `pointerUp`/`pointerCancel`/`lostPointerCapture` → `recognition.stop()`; interim results (`interimResults=true`) stream partial text while held;
- serial single-turn loop — each press yields exactly one transcript; the UI requires a new tap to capture again (`waitingForTap` / `tapToContinue`), respecting the iOS rule that each recognition must be tied to a user gesture;
- speech output cancels any active recognition and resumes afterwards with a short `speechSynthesis` grace period, avoiding audio-session contention.

The selected app language (`en-US` / `pt-BR`) is passed as `recognition.lang` and as `utterance.lang` for synthesis. Player names are supplied as `maxAlternatives` hints (`preferredPhrases`) and re-ranked locally for better name/number accuracy.

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
