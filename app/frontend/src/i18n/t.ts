/**
 * t() — lightweight bilingual label resolver (M6 T004).
 *
 * NO i18n library — just a pure function over the {ja, en} objects that the
 * backend emits for localizable content (package labels, proposal messages,
 * feedback field labels, decision explanations).
 *
 * Rules:
 *   - null / undefined          → ''
 *   - plain string              → returned as-is
 *   - { ja, en } object         → label[lang], falling back to the other if empty
 *   - array of the above items  → each item resolved then joined with ' '
 */

export type UiLanguage = 'ja' | 'en'

/** A bilingual string pair as serialised by the backend. */
export type BilingualLabel = { ja: string; en: string }

/** A single resolvable item: a plain string or a bilingual pair. */
export type LabelItem = string | BilingualLabel

/** The full set of types accepted by t(). */
export type LocalizedLabel = LabelItem | LabelItem[]

/**
 * Resolve a label to a single plain string in the requested language.
 *
 * @param label  A plain string, a `{ja,en}` object, an array of those, or null/undefined.
 * @param lang   The desired output language.
 * @returns      A plain string — never an object, never `[object Object]`.
 */
export function t(label: LocalizedLabel | null | undefined, lang: UiLanguage): string {
  if (label == null) return ''

  if (Array.isArray(label)) {
    return label.map((item) => t(item, lang)).join(' ')
  }

  if (typeof label === 'string') return label

  // BilingualLabel: prefer requested lang, fall back to other, fall back to ''
  const primary = label[lang]
  if (primary) return primary
  const other: UiLanguage = lang === 'ja' ? 'en' : 'ja'
  return label[other] ?? ''
}
