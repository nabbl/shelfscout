/** Catalog ISO 639-2 codes and the corresponding acquisition language codes. */
export const readingLanguages = [
  { code: 'en', label: 'English', catalog: ['eng'] },
  { code: 'de', label: 'German', catalog: ['ger', 'deu'] },
  { code: 'fr', label: 'French', catalog: ['fre', 'fra'] },
  { code: 'es', label: 'Spanish', catalog: ['spa'] },
  { code: 'it', label: 'Italian', catalog: ['ita'] },
  { code: 'nl', label: 'Dutch', catalog: ['dut', 'nld'] },
  { code: 'pt', label: 'Portuguese', catalog: ['por'] },
  { code: 'sv', label: 'Swedish', catalog: ['swe'] },
  { code: 'no', label: 'Norwegian', catalog: ['nor', 'nob', 'nno'] },
  { code: 'da', label: 'Danish', catalog: ['dan'] },
  { code: 'fi', label: 'Finnish', catalog: ['fin'] },
  { code: 'pl', label: 'Polish', catalog: ['pol'] },
  { code: 'cs', label: 'Czech', catalog: ['cze', 'ces'] },
  { code: 'el', label: 'Greek', catalog: ['gre', 'ell'] },
  { code: 'ru', label: 'Russian', catalog: ['rus'] },
  { code: 'uk', label: 'Ukrainian', catalog: ['ukr'] },
  { code: 'tr', label: 'Turkish', catalog: ['tur'] },
  { code: 'ar', label: 'Arabic', catalog: ['ara'] },
  { code: 'he', label: 'Hebrew', catalog: ['heb'] },
  { code: 'hi', label: 'Hindi', catalog: ['hin'] },
  { code: 'ja', label: 'Japanese', catalog: ['jpn'] },
  { code: 'zh', label: 'Chinese', catalog: ['chi', 'zho'] },
  { code: 'ko', label: 'Korean', catalog: ['kor'] },
] as const;
export type ReadingLanguage = typeof readingLanguages[number]['code'];
const aliases: Record<string, string> = { deutsch: 'de', nb: 'no', nn: 'no' };
for (const language of readingLanguages) {
  aliases[language.label.toLowerCase()] = language.code;
  for (const code of language.catalog) aliases[code] = language.code;
}
export function languageCode(value: unknown): string {
  const raw = typeof value === 'string' ? value.normalize('NFKC').trim().toLowerCase() : '';
  const tag = /^([a-z]{2,3})(?:[-_][a-z0-9]{2,8})+$/.exec(raw);
  const code = tag?.[1] || raw.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return aliases[code] || code;
}
export function preferredBookLanguage(book: { language?: string; languages?: string[] }, preferred: readonly string[]): string | null {
  const available = new Set((book.languages?.length ? book.languages : [book.language]).map(languageCode));
  return preferred.map(languageCode).find(code => available.has(code)) || null;
}
export function languageQuery(query: string, preferred: readonly string[]) {
  const codes = readingLanguages.filter(language => preferred.includes(language.code)).flatMap(language => [...language.catalog]);
  return `(${query}) AND language:(${codes.join(' OR ')})`;
}
