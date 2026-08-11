import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "pt-BR";

export const LOCALE_STORAGE_KEY = "score-tracker:locale";
export const SUPPORTED_LOCALES: Locale[] = ["en", "pt-BR"];

export type Messages = typeof englishMessages;

const englishMessages = {
  meta: {
    title: "Scoreboard",
    description: "A voice-first score tracker for game night.",
  },
  common: {
    language: "Language",
    theme: "Theme",
    system: "System",
    light: "Light",
    dark: "Dark",
    english: "English",
    portuguese: "Português",
    close: "Close",
    back: "Back",
    home: "Home",
    cancel: "Cancel",
    confirm: "Confirm",
    add: "Add",
    edit: "Edit",
    delete: "Delete",
    manual: "Manual",
    byVoice: "By voice",
  },
  voiceModel: {
    download: "Download offline voice",
    downloading: "Downloading offline voice model",
    preparing: "Preparing offline voice recognition…",
    initializing: "Starting the offline voice engine…",
    ready: "Offline voice recognition ready",
    readyShort: "Voice ready offline",
    sessionReady: "Voice ready for this session",
    transcribing: "Transcribing on this device…",
    error: "The offline voice model could not be loaded.",
    retry: "Try download again",
    size: "One download for English and Portuguese (about 80 MB).",
  },
  home: {
    tagline: "Your game-night scoreboard",
    newGame: "New game",
    newGameSubtitle: "Add players by voice",
    savedOnDevice: "Saved on this device",
    history: "History",
    firstGame: "Your first game starts here",
    emptyDescription: "Games and every round are saved automatically on this device.",
    storageError: "Scoreboard could not save on this device. Check browser storage and permissions.",
    inProgress: "In progress",
    finishedNoRounds: "Finished without rounds",
    winner: (name: string, total: number) => `${name} won with ${total}`,
    gameSummary: (players: number, rounds: number) => `${players} ${players === 1 ? "player" : "players"} · ${rounds} ${rounds === 1 ? "round" : "rounds"}`,
    deleteGameConfirm: "Delete this game and all of its rounds? This cannot be undone.",
    deleteGameLabel: (date: string) => `Delete game from ${date}`,
    todayAt: (time: string) => `Today, ${time}`,
  },
  setup: {
    newGame: "New game",
    whoIsPlaying: "Who is playing?",
    registerByVoice: "Add players by voice",
    voiceDescription: "Press and hold while saying the players' names.",
    tellPlayers: "Hold to say players",
    endConversation: "Release to send",
    namesHint: "Hold the button and say all names",
    tapToContinue: "Hold the button to speak another command.",
    conversationEnded: "Conversation ended",
    voiceUnavailable: "Voice is unavailable; use the fields below.",
    voiceUnavailableLong: "Voice is unavailable in this browser. Add the players below.",
    manualReview: "Manual review",
    players: "Players",
    playerNameLabel: (number: number) => `Player ${number} name`,
    removePlayerLabel: (number: number) => `Remove player ${number}`,
    namePlaceholder: "Name",
    addPlayer: "Add player",
    startGame: "Start game",
    needTwoUnique: "Enter at least two different names.",
    playersSpeech: (names: string[]) => `${names.length} players. ${names.join(". ")}. Say confirm, repeat, add, remove, or correct a name.`,
    setupCancelled: "Player setup cancelled.",
    needTwoPlayersSpeech: "I need at least two players. Say all names again.",
    duplicateNamesSpeech: "There are duplicate names. Correct them before confirming.",
    playersConfirmed: "Players confirmed. Let’s start.",
    noPlayersYet: "I still do not have the player names. Say all names.",
    unknownWithNames: "I did not understand. Say confirm, repeat, add, remove, or correct.",
    sayAllNames: "Say all player names.",
    microphonePermission: "Allow microphone access for this site.",
    permissionSpeechError: (code: string) => `Microphone access was denied. Check this site's microphone permission. Diagnostic: ${code}.`,
    couldNotHear: "I could not hear you. Try again or type the names.",
    noSpeechError: "No speech was detected. Speak after Listening appears, then try again. Diagnostic: no-speech.",
    audioCaptureError: "The microphone could not start. Check its permission, then hold the button again. Diagnostic: audio-capture.",
    networkSpeechError: "The iOS speech service could not connect. Check the connection and try again. Diagnostic: network.",
    interruptedSpeechError: "The microphone was interrupted. Hold the button again to reconnect.",
    languageSpeechError: "Speech recognition is not available for the selected language on this device. Diagnostic: language-not-supported.",
    unknownSpeechError: (code: string) => `Speech recognition failed. Nothing was changed. Diagnostic: ${code}.`,
    startingMicrophone: "Starting microphone…",
    listening: "Listening…",
  },
  game: {
    active: "Game in progress",
    finalResult: "Final result",
    keepScreenAwakeOff: "Allow the screen to turn off",
    keepScreenAwakeOn: "Keep the screen awake",
    screenOn: "Screen on",
    screenOff: "Screen off",
    ranking: "Ranking",
    rounds: "Rounds",
    players: "Players",
    roundCount: (count: number) => `${count} ${count === 1 ? "round" : "rounds"}`,
    currentRanking: "Current ranking",
    leading: "In the lead",
    noRounds: "No rounds yet",
    noRoundsDescription: "Use the microphone to enter the first scores.",
    editRoundLabel: (number: number) => `Edit round ${number}`,
    deleteRoundLabel: (number: number) => `Delete round ${number}`,
    deleteRoundConfirm: (number: number) => `Delete round ${number}? The ranking will be recalculated.`,
    playersNote: "Renaming keeps the history. A new player starts with zero in earlier rounds.",
    playerNameLabel: (name: string) => `${name} name`,
    removePlayerLabel: (name: string) => `Remove ${name}`,
    removePlayerConfirm: (name: string) => `Remove ${name}? This player's scores will be deleted from the game.`,
    newPlayer: "New player",
    addPlayer: "Add",
    shareResult: "Share result",
    stopEditing: "Stop editing",
    editResult: "Edit result",
    talkToScoreboard: "Hold to talk",
    sayNamesAndScores: "Hold while saying names and scores",
    voiceUnavailable: "Voice unavailable in this browser",
    startVoice: "Hold to talk",
    stopVoice: "Release",
    type: "Type",
    navigation: "Game navigation",
    finish: "Finish",
    finishConfirm: "Finish the game and lock the result?",
    addRound: "Add round",
    editRound: "Edit round",
    manualEntry: "Manual entry",
    confirmRound: "Confirm round",
    toggleScoreSign: (name: string) => `Toggle sign for ${name}'s score`,
    resultCopied: "Result copied",
    shareFailed: "Could not share the result",
    commandHelpTitle: "Try saying",
    commandHelp: "“Alex 10, Sam 7” · “ranking” · “repeat last round” · “undo last round” · “finish game”",
    commandHint: "Scores · ranking · repeat · undo",
  },
  voice: {
    phase: {
      idle: "Ready to listen",
      starting: "Starting microphone",
      listening: "Listening",
      parsing: "Checking",
      speakingReview: "Speaking",
      awaitingDecision: "Waiting for confirmation",
      applying: "Saving",
      speakingRanking: "Reading ranking",
      error: "Voice needs attention",
    },
    idleMessage: "Tap and say scores or a command",
    startingMicrophone: "Starting microphone…",
    listening: "Listening…",
    listeningAgain: "Listening again…",
    didNotHear: "I did not hear you. Please repeat.",
    unavailable: "Voice is unavailable here. Use manual entry.",
    microphonePermission: "Allow microphone access for this site.",
    microphonePermissionDiagnostic: (code: string) => `Allow microphone access for this site. Diagnostic: ${code}.`,
    unavailableBrowser: "Voice is unavailable in this browser. You can still type the round.",
    failedSafely: "Voice could not continue. Nothing was changed; try again.",
    failedSafelyDiagnostic: (code: string) => `Voice could not continue. Nothing was changed. Diagnostic: ${code}.`,
    microphoneInterrupted: "Microphone interrupted. Hold again to reconnect.",
    pcmStalled: "The microphone opened, but no audio reached the app. Hold again to reconnect.",
    noVoice: "The microphone is on, but no voice is reaching the app.",
    scoreListSeparator: ". ",
    roundReady: "Scores are ready. Say confirm, repeat, correct, or cancel.",
    tapToContinue: "Tap Start, then say confirm, repeat, correct, or cancel.",
    tapToConfirmAction: "Tap Start, then say confirm or cancel.",
    review: (scoreList: string, omitted: string) => `I understood. ${scoreList}.${omitted} Say confirm, repeat, correct, or cancel.`,
    omittedOne: (names: string) => ` ${names} was not mentioned and was set to zero.`,
    omittedMany: (names: string) => ` ${names} were not mentioned and were set to zero.`,
    round: (number: number, scores: string) => `Round ${number}. ${scores}.`,
    operationCancelled: "Operation cancelled.",
    confirmUndo: "Undo the last round. Confirm?",
    confirmFinish: "Finish the game. Confirm?",
    confirmOrCancel: "Say confirm or cancel.",
    lastRoundUndone: "Last round undone.",
    gameFinished: "Game finished.",
    roundSaved: "Round saved.",
    roundCancelled: "Round cancelled. No scores were saved.",
    pendingRound: "A round is waiting for confirmation. Say confirm, repeat, correct, or cancel.",
    unknownPending: "I did not understand. Say confirm, repeat, correct, or cancel.",
    roundMissing: "That round does not exist.",
    nothingToUndo: "There is no round to undo yet.",
    unknownGeneral: "I did not understand. Say player names and scores, or ask for the ranking.",
    duplicatePlayer: "A player was mentioned more than once.",
    missingScore: (name: string) => `I did not understand ${name}'s score.`,
    noPlayers: "There are no players yet.",
    ranking: "Ranking",
    point: "point",
    points: "points",
  },
  share: {
    title: "Game result",
    heading: "Game result",
    roundsPlayed: (count: number) => `${count} ${count === 1 ? "round played" : "rounds played"}`,
  },
};

const portugueseMessages: Messages = {
  meta: { title: "Placar", description: "Um placar de jogos operado principalmente por voz." },
  common: { language: "Idioma", theme: "Tema", system: "Sistema", light: "Claro", dark: "Escuro", english: "English", portuguese: "Português", close: "Fechar", back: "Voltar", home: "Início", cancel: "Cancelar", confirm: "Confirmar", add: "Adicionar", edit: "Editar", delete: "Excluir", manual: "Manual", byVoice: "Por voz" },
  voiceModel: {
    download: "Baixar voz offline",
    downloading: "Baixando modelo de voz offline",
    preparing: "Preparando reconhecimento de voz offline…",
    initializing: "Iniciando o mecanismo de voz offline…",
    ready: "Reconhecimento de voz offline pronto",
    readyShort: "Voz pronta offline",
    sessionReady: "Voz pronta nesta sessão",
    transcribing: "Transcrevendo neste aparelho…",
    error: "Não foi possível carregar o modelo de voz offline.",
    retry: "Tentar baixar novamente",
    size: "Um único download para inglês e português (cerca de 80 MB).",
  },
  home: {
    tagline: "Seu placar de mesa", newGame: "Novo jogo", newGameSubtitle: "Cadastre os jogadores por voz", savedOnDevice: "Salvo neste aparelho", history: "Histórico",
    firstGame: "Sua primeira partida começa aqui", emptyDescription: "Os jogos e todas as rodadas ficam salvos automaticamente neste aparelho.",
    storageError: "Não foi possível salvar neste aparelho. Verifique o espaço e as permissões do navegador.", inProgress: "Em andamento", finishedNoRounds: "Finalizado sem rodadas",
    winner: (name, total) => `${name} venceu com ${total}`,
    gameSummary: (players, rounds) => `${players} ${players === 1 ? "jogador" : "jogadores"} · ${rounds} ${rounds === 1 ? "rodada" : "rodadas"}`,
    deleteGameConfirm: "Excluir este jogo e todas as suas rodadas? Essa ação não pode ser desfeita.", deleteGameLabel: (date) => `Excluir jogo de ${date}`, todayAt: (time) => `Hoje, ${time}`,
  },
  setup: {
    newGame: "Novo jogo", whoIsPlaying: "Quem vai jogar?", registerByVoice: "Cadastre por voz", voiceDescription: "Pressione e segure enquanto fala os nomes dos jogadores.",
    tellPlayers: "Segure para dizer", endConversation: "Solte para enviar", namesHint: "Segure o botão e diga todos os nomes", tapToContinue: "Segure o botão para falar outro comando.", conversationEnded: "Conversa encerrada",
    voiceUnavailable: "Voz indisponível; use os campos abaixo.", voiceUnavailableLong: "A voz não está disponível neste navegador. Cadastre os jogadores abaixo.",
    manualReview: "Conferência manual", players: "Jogadores", playerNameLabel: (number) => `Nome do jogador ${number}`, removePlayerLabel: (number) => `Remover jogador ${number}`,
    namePlaceholder: "Nome", addPlayer: "Adicionar jogador", startGame: "Começar jogo", needTwoUnique: "Informe pelo menos dois nomes diferentes.",
    playersSpeech: (names) => `${names.length} jogadores. ${names.join(". ")}. Diga confirmar, repetir, adicionar, remover ou corrigir um nome.`, setupCancelled: "Cadastro cancelado.",
    needTwoPlayersSpeech: "Preciso de pelo menos dois jogadores. Diga os nomes novamente.", duplicateNamesSpeech: "Existem nomes repetidos. Corrija antes de confirmar.",
    playersConfirmed: "Jogadores confirmados. Vamos começar.", noPlayersYet: "Ainda não entendi os jogadores. Diga todos os nomes.",
    unknownWithNames: "Não entendi. Diga confirmar, repetir, adicionar, remover ou corrigir.", sayAllNames: "Diga todos os nomes dos jogadores.",
    microphonePermission: "Permita o uso do microfone para este site.",
    permissionSpeechError: (code) => `O acesso ao microfone foi recusado. Verifique a permissão de microfone deste site. Diagnóstico: ${code}.`, couldNotHear: "Não consegui ouvir. Você pode tentar novamente ou digitar os nomes.",
    noSpeechError: "Nenhuma fala foi detectada. Fale depois que aparecer Ouvindo e tente novamente. Diagnóstico: no-speech.",
    audioCaptureError: "Não foi possível iniciar o microfone. Verifique a permissão e segure o botão novamente. Diagnóstico: audio-capture.",
    networkSpeechError: "O serviço de voz do iOS não conseguiu se conectar. Verifique a conexão e tente novamente. Diagnóstico: network.",
    interruptedSpeechError: "O microfone foi interrompido. Segure o botão novamente para reconectar.",
    languageSpeechError: "O reconhecimento de voz não está disponível neste aparelho para o idioma selecionado. Diagnóstico: language-not-supported.",
    unknownSpeechError: (code) => `O reconhecimento de voz falhou. Nada foi alterado. Diagnóstico: ${code}.`, startingMicrophone: "Ligando o microfone…", listening: "Ouvindo…",
  },
  game: {
    active: "Jogo em andamento", finalResult: "Resultado final", keepScreenAwakeOff: "Permitir que a tela apague", keepScreenAwakeOn: "Manter a tela ligada", screenOn: "Tela ligada", screenOff: "Tela desligada",
    ranking: "Ranking", rounds: "Rodadas", players: "Jogadores", roundCount: (count) => `${count} ${count === 1 ? "rodada" : "rodadas"}`, currentRanking: "Ranking atual", leading: "Na liderança",
    noRounds: "Nenhuma rodada ainda", noRoundsDescription: "Use o microfone para lançar os primeiros pontos.", editRoundLabel: (number) => `Editar rodada ${number}`,
    deleteRoundLabel: (number) => `Excluir rodada ${number}`, deleteRoundConfirm: (number) => `Excluir a rodada ${number}? O ranking será recalculado.`,
    playersNote: "Renomear preserva o histórico. Um jogador novo começa com zero nas rodadas anteriores.", playerNameLabel: (name) => `Nome de ${name}`,
    removePlayerLabel: (name) => `Remover ${name}`, removePlayerConfirm: (name) => `Remover ${name}? As pontuações desse jogador serão excluídas desta partida.`,
    newPlayer: "Novo jogador", addPlayer: "Adicionar", shareResult: "Compartilhar resultado", stopEditing: "Encerrar edição", editResult: "Editar resultado",
    talkToScoreboard: "Segure para falar", sayNamesAndScores: "Segure enquanto diz nomes e pontos", voiceUnavailable: "Voz indisponível neste navegador", startVoice: "Segure para falar", stopVoice: "Solte", type: "Digitar",
    navigation: "Navegação do jogo", finish: "Finalizar", finishConfirm: "Finalizar o jogo e congelar o resultado?", addRound: "Adicionar rodada", editRound: "Editar rodada",
    manualEntry: "Entrada manual", confirmRound: "Confirmar rodada", toggleScoreSign: (name) => `Alternar o sinal da pontuação de ${name}`, resultCopied: "Resultado copiado", shareFailed: "Não foi possível compartilhar",
    commandHelpTitle: "Experimente dizer", commandHelp: "“Alex 10, Sam 7” · “ranking” · “repetir última rodada” · “desfazer última rodada” · “finalizar jogo”", commandHint: "Pontos · ranking · repetir · desfazer",
  },
  voice: {
    phase: { idle: "Pronto para ouvir", starting: "Ligando o microfone", listening: "Ouvindo", parsing: "Conferindo", speakingReview: "Falando", awaitingDecision: "Aguardando confirmação", applying: "Salvando", speakingRanking: "Lendo ranking", error: "A voz precisa de atenção" },
    idleMessage: "Toque e fale os pontos ou um comando", startingMicrophone: "Ligando o microfone…", listening: "Ouvindo…", listeningAgain: "Ouvindo novamente…", didNotHear: "Não ouvi. Pode repetir?",
    unavailable: "A voz não está disponível aqui. Use a entrada manual.", microphonePermission: "Permita o uso do microfone para este site.",
    microphonePermissionDiagnostic: (code) => `Permita o uso do microfone para este site. Diagnóstico: ${code}.`,
    unavailableBrowser: "A voz não está disponível neste navegador. Você ainda pode digitar a rodada.", failedSafely: "Não consegui continuar por voz. Nada foi alterado; tente novamente.",
    failedSafelyDiagnostic: (code) => `Não consegui continuar por voz. Nada foi alterado. Diagnóstico: ${code}.`,
    microphoneInterrupted: "O microfone foi interrompido. Segure novamente para reconectar.",
    pcmStalled: "O microfone abriu, mas nenhum áudio chegou ao app. Segure novamente para reconectar.",
    noVoice: "O microfone está ligado, mas nenhuma voz está chegando ao app.",
    scoreListSeparator: ". ", roundReady: "Pontuações prontas. Diga confirmar, repetir, corrigir ou cancelar.", tapToContinue: "Toque em Iniciar e diga confirmar, repetir, corrigir ou cancelar.", tapToConfirmAction: "Toque em Iniciar e diga confirmar ou cancelar.", review: (scoreList, omitted) => `Entendi. ${scoreList}.${omitted} Diga confirmar, repetir, corrigir ou cancelar.`,
    omittedOne: (names) => ` ${names} não foi mencionado e ficou com zero.`, omittedMany: (names) => ` ${names} não foram mencionados e ficaram com zero.`,
    round: (number, scores) => `Rodada ${number}. ${scores}.`, operationCancelled: "Operação cancelada.", confirmUndo: "Desfazer a última rodada. Confirmar?",
    confirmFinish: "Finalizar o jogo. Confirmar?", confirmOrCancel: "Diga confirmar ou cancelar.", lastRoundUndone: "Última rodada desfeita.", gameFinished: "Jogo finalizado.",
    roundSaved: "Rodada salva.", roundCancelled: "Rodada cancelada. Nenhum valor foi salvo.", pendingRound: "Existe uma rodada aguardando confirmação. Diga confirmar, repetir, corrigir ou cancelar.",
    unknownPending: "Não entendi. Diga confirmar, repetir, corrigir ou cancelar.", roundMissing: "Essa rodada não existe.", nothingToUndo: "Ainda não há rodada para desfazer.",
    unknownGeneral: "Não entendi. Fale os nomes e os pontos, ou peça o ranking.", duplicatePlayer: "Um jogador foi mencionado mais de uma vez.", missingScore: (name) => `Não entendi o valor de ${name}.`,
    noPlayers: "Ainda não há jogadores.", ranking: "Ranking", point: "ponto", points: "pontos",
  },
  share: { title: "Resultado da partida", heading: "Resultado da partida", roundsPlayed: (count) => `${count} ${count === 1 ? "rodada jogada" : "rodadas jogadas"}` },
};

const MESSAGE_SETS: Record<Locale, Messages> = { en: englishMessages, "pt-BR": portugueseMessages };

export function getMessages(locale: Locale): Messages {
  return MESSAGE_SETS[locale] ?? englishMessages;
}

export function detectInitialLocale(languages: readonly string[] = [...navigator.languages, navigator.language]): Locale {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    // The app still works when a browser blocks local storage.
  }
  if (SUPPORTED_LOCALES.includes(stored as Locale)) return stored as Locale;
  return languages.some((language) => language.toLocaleLowerCase().startsWith("pt")) ? "pt-BR" : "en";
}

type I18nValue = {
  locale: Locale;
  messages: Messages;
  setLocale: (locale: Locale) => void;
};

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);
  const messages = getMessages(locale);

  const setLocale = useCallback((nextLocale: Locale) => {
    setLocaleState(nextLocale);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
    } catch {
      // Keep the in-memory choice for this session when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = messages.meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", messages.meta.description);
  }, [locale, messages]);

  const value = useMemo(() => ({ locale, messages, setLocale }), [locale, messages, setLocale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used within I18nProvider");
  return value;
}
