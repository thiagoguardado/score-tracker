# Scoreboard

A mobile-first, voice-first PWA for keeping score during game night. It has no backend, database, AI service, analytics, or audio storage.

The app is English-first and currently includes Brazilian Portuguese. On first use it follows the browser language, falls back to English, and remembers a manual language choice across sessions. Voice recognition, spoken feedback, and commands always follow the selected app language.

## Features

- add and review players through one continuous voice conversation;
- enter, repeat, correct, and confirm a round without another tap;
- voice commands for ranking, saved rounds, undo, and finishing a game;
- complete manual entry and editing as a fallback;
- multiple games stored on the device;
- rankings recalculated from rounds, including shared positions for ties;
- native result sharing with clipboard fallback;
- installable PWA with offline access to the manual app and saved data;
- Screen Wake Lock during active games when supported.
- monochrome, text-only interface with no decorative images or in-app icons.
- system, light, and dark themes with a persistent manual preference.

No persistent action is applied until it is confirmed. Audio is never recorded or stored.

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

## Voice on iPhone

Use Safari with Siri enabled and allow microphone access when requested. Speech recognition is provided by the browser and operating system, so manual entry remains available throughout the app.

The required device flow is:

1. tap the microphone once;
2. say player names and scores;
3. listen to the review;
4. say `repeat` or correct a value;
5. say `confirm`;
6. listen to the complete ranking.

The app and saved games work offline, but speech recognition may depend on system-provided services.

## Data

Games are stored in `localStorage` under `score-tracker:state:v1`. Language and theme preferences are stored separately under `score-tracker:locale` and `score-tracker:theme`. Data is not synchronized between devices or separate browser storage contexts. Clearing site data removes the game history and preferences.

## Deployment

The workflow at `.github/workflows/pages.yml` tests, builds, and deploys `dist` to GitHub Pages after every push to `main`.
