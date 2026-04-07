const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "been",
  "being",
  "by",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "section",
  "should",
  "show",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "title",
  "to",
  "us",
  "was",
  "we",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your",
  "about",
  "explain",
  "describe",
  "overview",
  "information",
  "info",
  "wikipedia",
]);

function stemToken(token: string) {
  if (token.length > 6 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 7 && token.endsWith("ing")) {
    return token.slice(0, -3);
  }

  if (token.length > 6 && token.endsWith("ed")) {
    return token.slice(0, -2);
  }

  if (token.length > 5 && token.endsWith("es")) {
    return token.slice(0, -2);
  }

  if (token.length > 4 && token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return token;
}

export function normalizeSearchToken(raw: string) {
  const lower = raw.toLowerCase().replace(/^'+|'+$/g, "");
  if (!lower) {
    return null;
  }

  const stemmed = stemToken(lower);
  if (stemmed.length < 2) {
    return null;
  }

  if (/^\d+$/.test(stemmed) && stemmed.length < 4) {
    return null;
  }

  if (STOPWORDS.has(stemmed)) {
    return null;
  }

  return stemmed;
}

export function extractSearchTokens(text: string) {
  const rawTokens = text.match(/[a-z0-9']+/gi) ?? [];
  return rawTokens.flatMap((token) => {
    const normalized = normalizeSearchToken(token);
    return normalized ? [normalized] : [];
  });
}

export function extractSearchBigrams(tokens: string[]) {
  const bigrams: string[] = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (!current || !next) {
      continue;
    }
    bigrams.push(`${current}_${next}`);
  }
  return bigrams;
}

function collectUniqueTokens(tokens: string[]) {
  return Array.from(new Set(tokens));
}

export function buildSearchFeatureWeights(text: string) {
  const tokens = extractSearchTokens(text);
  const tokenCounts = new Map<string, number>();
  for (const token of tokens) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }

  const weights = new Map<string, number>();
  for (const [token, count] of tokenCounts) {
    const weight = (1 + Math.log1p(count)) * (token.length >= 8 ? 1.15 : 1);
    weights.set(`t:${token}`, weight);
  }

  const bigrams = extractSearchBigrams(tokens);
  const bigramCounts = new Map<string, number>();
  for (const bigram of bigrams) {
    bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
  }

  for (const [bigram, count] of bigramCounts) {
    weights.set(`b:${bigram}`, 1.35 + Math.log1p(count));
  }

  return {
    tokens,
    weights,
  };
}

export type SearchRelevance = {
  lexicalScore: number;
  coverage: number;
  titleCoverage: number;
  bigramCoverage: number;
  matchedTerms: string[];
  matchedTitleTerms: string[];
  hasLexicalMatch: boolean;
};

export function scoreSearchRelevance(
  query: string,
  text: string,
  metadata?: Record<string, unknown>
): SearchRelevance {
  const queryTokens = collectUniqueTokens(extractSearchTokens(query));
  if (queryTokens.length === 0) {
    return {
      lexicalScore: 0,
      coverage: 0,
      titleCoverage: 0,
      bigramCoverage: 0,
      matchedTerms: [],
      matchedTitleTerms: [],
      hasLexicalMatch: false,
    };
  }

  const textTokens = collectUniqueTokens(extractSearchTokens(text));
  const titleTokens =
    typeof metadata?.title === "string"
      ? collectUniqueTokens(extractSearchTokens(metadata.title))
      : [];

  const titleTokenSet = new Set(titleTokens);
  const combinedTokenSet = new Set([...textTokens, ...titleTokens]);

  const matchedTerms = queryTokens.filter((token) => combinedTokenSet.has(token));
  const matchedTitleTerms = queryTokens.filter((token) => titleTokenSet.has(token));

  const queryBigrams = collectUniqueTokens(extractSearchBigrams(queryTokens));
  const textBigrams = new Set(extractSearchBigrams(textTokens));
  const titleBigrams = new Set(extractSearchBigrams(titleTokens));
  const matchedBigrams = queryBigrams.filter(
    (bigram) => textBigrams.has(bigram) || titleBigrams.has(bigram)
  );

  const coverage = matchedTerms.length / queryTokens.length;
  const titleCoverage = matchedTitleTerms.length / queryTokens.length;
  const bigramCoverage =
    queryBigrams.length > 0 ? matchedBigrams.length / queryBigrams.length : 0;

  const lexicalScore = Number(
    Math.min(1, coverage * 0.72 + titleCoverage * 0.18 + bigramCoverage * 0.1).toFixed(4)
  );

  return {
    lexicalScore,
    coverage,
    titleCoverage,
    bigramCoverage,
    matchedTerms,
    matchedTitleTerms,
    hasLexicalMatch: matchedTerms.length > 0,
  };
}
