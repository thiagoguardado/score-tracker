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
- local Whisper Tiny speech recognition running in a Web Worker with no transcription API calls;
- progressive local transcription while the push-to-talk button is held;
- installable PWA with offline access to voice, the manual app, and saved data after the initial model download;
- Screen Wake Lock during active games when supported.
- monochrome, text-only interface with no decorative images or in-app icons.
- system, light, and dark themes with a persistent manual preference.

No persistent action is applied until it is confirmed. Short push-to-talk recordings exist only in memory while they are transcribed and are never persisted or uploaded.

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

## Offline voice recognition

The app uses `getUserMedia`, `MediaRecorder`, Transformers.js, and the multilingual `onnx-community/whisper-tiny` model. It does not use `SpeechRecognition`, Siri, or a transcription API. The same microphone stream feeds both the volume meter and recording, avoiding competing iOS audio capture APIs.

The first visit to a voice screen downloads the quantized model weights and the local WASM engine (about 70 MB combined). The UI reports download progress. Transformers.js keeps the model in the browser cache, while the service worker precaches the app and WASM runtime. Later sessions can transcribe offline unless the browser evicts site storage.

Whisper Tiny is multilingual, so English and Portuguese share one model download. The selected app language is passed to every local transcription request and changes immediately when the language selector changes.

The required device flow is:

1. wait until offline voice recognition is ready;
2. press and hold the voice button;
3. say player names, scores, or a command while partial text appears;
4. release to produce the final transcript;
5. review the recognized values and press `Confirm`;
6. listen to the complete ranking.

## Data

Games are stored in `localStorage` under `score-tracker:state:v1`. Language and theme preferences are stored separately under `score-tracker:locale` and `score-tracker:theme`. Data is not synchronized between devices or separate browser storage contexts. Clearing site data removes the game history and preferences.

## Deployment

The workflow at `.github/workflows/pages.yml` tests, builds, and deploys `dist` to GitHub Pages after every push to `main`.
