import { pinyin } from 'pinyin-pro';

const indexes = new Map<string, string[]>();
const compact = (value: string) => value.toLowerCase().replace(/[\s'’ü]/g, c => c === 'ü' ? 'v' : '');

// Cache transliteration so typing amounts or search terms does not rebuild it.
export function matchesSearch(text: string, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  let index = indexes.get(text);
  if (!index) {
    const syllables = pinyin(text, { toneType: 'none', type: 'array', nonZh: 'consecutive' });
    const initials = pinyin(text, { toneType: 'none', pattern: 'first', type: 'array', nonZh: 'consecutive' });
    index = [text.toLowerCase(), compact(syllables.join('')), compact(initials.join(''))];
    if (indexes.size >= 2000) indexes.delete(indexes.keys().next().value!);
    indexes.set(text, index);
  }
  return terms.every(term => index!.some((value, i) => value.includes(i ? compact(term) : term)));
}
