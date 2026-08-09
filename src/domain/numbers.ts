const UNITS: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
  dezassete: 17, dezessete: 17, dezoito: 18, dezenove: 19,
};

const TENS: Record<string, number> = {
  vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
  sessenta: 60, setenta: 70, oitenta: 80, noventa: 90,
};

const HUNDREDS: Record<string, number> = {
  cem: 100, cento: 100, duzentos: 200, duzentas: 200, trezentos: 300, trezentas: 300,
  quatrocentos: 400, quatrocentas: 400, quinhentos: 500, quinhentas: 500,
  seiscentos: 600, seiscentas: 600, setecentos: 700, setecentas: 700,
  oitocentos: 800, oitocentas: 800, novecentos: 900, novecentas: 900,
};

export function normalizeSpeech(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9+\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parsePortugueseNumber(value: string): number | null {
  const normalized = normalizeSpeech(value);
  const digit = normalized.match(/(?:^|\s)(-?\d+)(?:\s|$)/);
  if (digit) {
    const parsed = Number(digit[1]);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }

  const tokens = normalized.split(" ").filter((token) => token !== "e" && token !== "pontos" && token !== "ponto");
  const negative = tokens[0] === "menos" || tokens[0] === "negativo";
  const numberTokens = negative ? tokens.slice(1) : tokens;
  let total = 0;
  let group = 0;
  let found = false;

  for (const token of numberTokens) {
    if (token in UNITS) {
      group += UNITS[token];
      found = true;
    } else if (token in TENS) {
      group += TENS[token];
      found = true;
    } else if (token in HUNDREDS) {
      group += HUNDREDS[token];
      found = true;
    } else if (token === "mil") {
      total += (group || 1) * 1000;
      group = 0;
      found = true;
    } else if (found) {
      break;
    }
  }

  if (!found) return null;
  const result = total + group;
  return negative ? -result : result;
}
