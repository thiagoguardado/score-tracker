# Placar

PWA mobile-first para acompanhar pontuações de jogos usando voz como entrada principal. Não usa backend, banco de dados ou serviços de IA.

## O que já funciona

- cadastro de jogadores por voz, com confirmação falada;
- lançamento, repetição, correção e confirmação de uma rodada em uma única conversa;
- comandos falados para ranking, leitura de rodadas, desfazer e finalizar;
- entrada e edição manual completa como alternativa;
- múltiplos jogos salvos no aparelho;
- ranking recalculado a partir das rodadas, incluindo empates;
- compartilhamento nativo ou cópia do resultado;
- instalação como PWA e funcionamento manual offline;
- tela mantida ligada durante jogos ativos, quando suportado.

## Desenvolvimento

Requer Node.js 22 ou mais recente.

```bash
npm install
npm run dev
```

Validação:

```bash
npm test
npm run build
npm run test:e2e
```

## Voz no iPhone

Use Safari com a Siri habilitada e permita o microfone quando solicitado. A API de reconhecimento de fala é controlada pelo navegador; por isso, a entrada manual permanece disponível em todas as etapas.

O cenário obrigatório no aparelho é:

1. tocar uma vez no microfone;
2. dizer nomes e valores;
3. ouvir a conferência;
4. dizer `repetir` ou uma correção;
5. dizer `confirmar`;
6. ouvir o ranking completo.

O app e os jogos funcionam offline, mas o reconhecimento de fala pode depender dos recursos disponibilizados pelo sistema.

## Dados

Os jogos são salvos em `localStorage` sob a chave `score-tracker:state:v1`. Eles não são sincronizados entre aparelhos ou entre contextos de armazenamento separados do navegador. Limpar os dados do Safari remove o histórico.

## Publicação

O workflow em `.github/workflows/pages.yml` testa, compila e publica o conteúdo de `dist` no GitHub Pages após cada push em `main`.
