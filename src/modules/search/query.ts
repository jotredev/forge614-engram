// Natural-language query planning for the level-11 hybrid search: filler words are dropped,
// the remaining terms are OR-ed, terms of four or more letters match by prefix in the word
// index and terms of three or more letters match anywhere in the trigram index.
const STOPWORDS = new Set([
  "a","al","algo","ante","antes","aqui","asi","cada","como","con","contra","cual","cuales","cuando","de","del","desde","donde",
  "el","ella","ellas","ellos","en","entre","era","eres","es","esa","esas","ese","eso","esos","esta","estaba","estan","estas",
  "este","esto","estos","fue","fueron","ha","han","hay","la","las","le","les","lo","los","mas","me","mi","mis","muy","nos",
  "nosotros","o","otra","otras","otro","otros","para","pero","por","porque","pues","que","quien","se","sea","ser","si","sin",
  "sobre","son","su","sus","te","ti","tu","tus","u","un","una","unas","uno","unos","y","ya","yo",
  "an","and","are","as","at","be","been","but","by","can","did","do","does","for","from","had","has","have","how","i","if",
  "in","into","is","it","its","me","my","of","on","or","our","so","that","the","their","them","then","there","these","they",
  "this","to","was","we","were","what","when","where","which","who","why","will","with","you","your",
]);

/** At most this many terms are sent to the indexes; the rest of a long text is ignored. */
export const MAX_QUERY_TERMS = 16;
/** A result must contain at least this many query terms (or all of them when the query has fewer). */
export const MIN_MATCHED_TERMS = 2;
/** Reciprocal rank fusion constant: a result scores 1/(RRF_K + rank) in each index that returns it. */
export const RRF_K = 60;
/** Candidates read from each index before fusion. */
export const HYBRID_CANDIDATES = 50;

export interface QueryPlan { terms: string[]; words: string | null; trigram: string | null }

function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function tokens(text: string): string[] {
  return fold(text).match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Distinct folded words of a text without filler words; when every word is filler, all of them. */
export function termsOf(text: string): string[] {
  const all = [...new Set(tokens(text))];
  const meaningful = all.filter(term => !STOPWORDS.has(term));
  return meaningful.length > 0 ? meaningful : all;
}

export function buildQuery(text: string): QueryPlan {
  const terms = termsOf(text).slice(0, MAX_QUERY_TERMS);
  const quote = (term: string) => `"${term}"`;
  const words = terms.length === 0 ? null : terms.map(term => Array.from(term).length >= 4 ? `${quote(term)}*` : quote(term)).join(" OR ");
  // The trigram index keeps accents: search each term as folded and as written.
  const written = (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(word => terms.includes(fold(word)));
  const long = [...new Set([...terms, ...written])].filter(term => Array.from(term).length >= 3);
  return { terms, words, trigram: long.length === 0 ? null : long.map(quote).join(" OR ") };
}

/** How many query terms a text contains: by substring for three or more letters, as a whole word otherwise. */
export function matchedTerms(terms: readonly string[], text: string): number {
  const folded = fold(text), words = new Set(tokens(text));
  return terms.filter(term => Array.from(term).length >= 3 ? folded.includes(term) : words.has(term)).length;
}

/** At most this many similar memories are returned after a save. */
export const SIMILAR_LIMIT = 3;
/** Minimum share of distinct words two memories must have in common to be reported as similar. */
export const SIMILAR_MIN_SCORE = 0.25;

/** Jaccard similarity of two term sets, rounded to two decimals. */
export function similarity(left: readonly string[], right: readonly string[]): number {
  const a = new Set(left), b = new Set(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const term of a) if (b.has(term)) shared += 1;
  return Math.round(shared / (a.size + b.size - shared) * 100) / 100;
}
