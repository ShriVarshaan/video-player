const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'mt', 'prof', 'gen', 'col', 'lt', 'sgt', 'capt', 'no', 'etc'])

// The first sentence of a synopsis. A full stop after a title (Dr.), an initial
// (J.) or a dotted acronym (U.S.) doesn't end the sentence.
export function firstSentence(text: string): string {
  const end = /[.!?](?=\s|$)/g
  for (let m = end.exec(text); m; m = end.exec(text)) {
    if (m[0] === '.') {
      const word = /(\S+)$/.exec(text.slice(0, m.index))?.[1] ?? ''
      if (ABBREVIATIONS.has(word.toLowerCase()) || /^\p{L}$/u.test(word) || /^(\p{L}\.)+\p{L}$/u.test(word)) continue
    }
    return text.slice(0, m.index + 1)
  }
  return text
}
