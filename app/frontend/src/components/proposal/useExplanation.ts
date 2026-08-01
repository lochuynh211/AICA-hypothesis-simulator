/**
 * useExplanation (feature 019) — on-demand LLM rationale for one candidate/item.
 *
 * Called once per candidate/item in the Service/Content panels. It stays idle
 * until `request()` fires (wired to the ReasonBreakdown `<details>` first open),
 * so generation is lazy — the reviewer only pays inference for reasons they
 * actually expand. Results are cached in a module-level map so re-expanding
 * (and component remounts within the session) never regenerate.
 *
 * Provider behavior:
 *   - 'off'     → no-op for service/content; the panel shows their OWN baked
 *                 `rationale` instead (no fetch at all). TRIGGER is the one
 *                 exception (feature 025, slice S11): it has no baked
 *                 rationale of its own — see `RankOneSummary`'s module
 *                 docstring — so `step === 'trigger'` still fetches when
 *                 'off', requesting the backend's deterministic `'template'`
 *                 provider (never an LLM) so that tab is never empty.
 *   - 'backend' → POST /explain (provider=backend); the backend runs Ollama and
 *                 returns the `[ja, en]` pair (or its template fallback).
 *   - 'browser' → POST /explain (provider=browser) to fetch the SAME prompt,
 *                 then run it through Chrome's Gemini Nano on-device and parse.
 *
 * Any failure resolves to `status:'error'`, so the panel falls back to the
 * deterministic template — a failed explanation never blocks the UI.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import {
  explain,
  explainInline,
  explainTrigger,
  type ExplainProvider,
  type ExplainStep,
  type ProposalRunLog,
} from '../../api/proposalClient'
import { nanoAvailable, runNano } from '../../lib/nano'

export type ExplanationProvider = 'off' | 'backend' | 'browser'

/** Resolved, render-ready explanation for one language. */
export type AiExplanation =
  | { status: 'loading' }
  | { status: 'ready'; text: string; model: string; fellBack: boolean }
  | { status: 'error' }

type CacheEntry =
  | { status: 'loading' }
  | { status: 'ready'; ja: string; en: string; model: string; fellBack: boolean }
  | { status: 'error' }

const cache = new Map<string, CacheEntry>()
/** Subscribers per cache key, so all hook instances sharing a key re-render together. */
const listeners = new Map<string, Set<() => void>>()

/** Bound the cache: run_id churns on every live-recompute edit, so without a
 * cap the map would grow for the life of the tab. Superseded runs' cards are
 * unmounted, so evicting the oldest entry is safe. */
const MAX_CACHE = 100

function cacheKey(runId: string, step: ExplainStep, targetId: string, provider: ExplanationProvider): string {
  return `${runId}|${step}|${targetId}|${provider}`
}

function setCache(key: string, entry: CacheEntry): void {
  cache.set(key, entry)
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value // Map preserves insertion order
    if (oldest !== undefined && oldest !== key) cache.delete(oldest)
  }
  listeners.get(key)?.forEach((fn) => fn())
}

/** Client-side mirror of the backend `strip_placeholder_artifacts` — removes
 * leftover format-example placeholder tokens ("(factor A)", "要因A") a weak
 * on-device model may copy literally, then tidies punctuation. */
const PLACEHOLDER_RE = /[（(「[]?\s*(?:\bfactors?\s+[ab]\b|要因[abＡＢ])\s*[)\]」）]?/gi
export function stripPlaceholders(text: string): string {
  if (!text) return text
  let out = text.replace(PLACEHOLDER_RE, '')
  out = out.replace(/[（(「[]\s*[)\]」）]/g, '')
  out = out.replace(/\s{2,}/g, ' ')
  out = out.replace(/\s+([.,!?;:。、！？)）])/g, '$1')
  out = out.replace(/^\s*(?:and|、|,)\s+/i, '').trim()
  out = out.replace(/\s*(?:and|、|,)\s*$/i, '').trim()
  return out.trim()
}

/** Client-side mirror of the backend `parse_bilingual` — for the Nano path. */
export function parseBilingual(text: string): [string, string] {
  const cleaned = (text || '').trim().replace(/^`+|`+$/g, '').trim()
  // Primary: "JA: <ja> ... EN: <en>" inline OR across lines (Nano sometimes
  // emits both on one line, which the line-by-line pass wouldn't split).
  const m = cleaned.match(/ja:\s*([\s\S]+?)\s*en:\s*([\s\S]+)/i)
  if (m) {
    const ja = m[1].trim().replace(/`+/g, '').trim()
    const en = m[2].trim().replace(/`+/g, '').trim()
    if (ja || en) return [ja || en, en || ja]
  }
  const lines = (text || '')
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim().replace(/^`+|`+$/g, '').trim())
    .filter((l) => l.length > 0)
  let ja: string | undefined
  let en: string | undefined
  const plain: string[] = []
  for (const ln of lines) {
    const low = ln.toLowerCase()
    if (low.startsWith('ja:')) ja = ln.slice(3).trim()
    else if (low.startsWith('en:')) en = ln.slice(3).trim()
    else plain.push(ln)
  }
  if (ja !== undefined || en !== undefined) return [ja || en || '', en || ja || '']
  if (plain.length >= 2) return [plain[0], plain[1]]
  if (plain.length === 1) return [plain[0], plain[0]]
  return ['', '']
}

// Mirror of backend explanation_builder.response_is_usable (keep EXAMPLE_* in
// sync with _EXAMPLE_JA/_EN). Rejects empty, verbatim-example-parrot,
// all-lines-echo-the-facts, and not-actually-Japanese output — so the Nano path
// falls back to the template on degenerate output, matching the backend Ollama
// path's honesty guarantee.
const EXAMPLE_JA = '「要因A」と「要因B」が最も強く働いたため、この選択に至りました。'
const EXAMPLE_EN = 'Factor A and factor B contributed the most, which is why this choice was made.'
/** Hiragana / katakana / CJK ideographs — mirror of the backend's
 *  `_JAPANESE_SCRIPT`. Asked for "Japanese, not English", small models reliably
 *  answer in KOREAN; Hangul passes every other check here, so without this the
 *  panel would show Korean under a 「日本語」 heading. */
const JAPANESE_SCRIPT = /[぀-ゟ゠-ヿ一-鿿]/
export function responseIsUsable(rationale: string[], messages: { role: string; content: string }[]): boolean {
  const ja = (rationale?.[0] ?? '').trim()
  if (ja && !JAPANESE_SCRIPT.test(ja)) return false
  const texts = rationale.map((t) => (t || '').trim()).filter(Boolean)
  if (!texts.length) return false
  if (texts.some((t) => t === EXAMPLE_JA || t === EXAMPLE_EN)) return false
  const userLines = new Set<string>()
  for (const m of messages || []) {
    if (m.role === 'user')
      for (const ln of m.content.split(/\r?\n/)) {
        const s = ln.trim().replace(/^-+/, '').trim()
        if (s) userLines.add(s)
      }
  }
  return texts.some((t) => !userLines.has(t) && !userLines.has(t.replace(/^-+/, '').trim()))
}

async function generate(
  runId: string,
  step: ExplainStep,
  targetId: string,
  provider: 'backend' | 'browser' | 'template',
  inlineProposal?: ProposalRunLog | null,
  fire?: Record<string, unknown> | null,
): Promise<CacheEntry> {
  // An ephemeral (never-persisted) proposal is explained INLINE via
  // /api/merged-runs/explain (feature 020); a persisted run uses the run-id
  // endpoint. TRIGGER (feature 025, slice S7) has no ProposalRunLog evidence
  // to key off at all — it always posts the fire back inline, via the THIRD
  // sibling endpoint (`explainTrigger`), regardless of `inlineProposal`.
  // Both return the identical ExplainResponse shape.
  //
  // `provider: 'template'` (feature 025, slice S11) is TRIGGER-ONLY — the
  // caller (`request()` below) never resolves it for service/content, so the
  // `as ExplainProvider` casts on their two branches are safe: those two
  // calls only ever actually receive 'backend'/'browser' at runtime.
  const call = (p: 'backend' | 'browser' | 'template') =>
    step === 'trigger'
      ? explainTrigger(fire ?? {}, { category: targetId, provider: p })
      : inlineProposal
        ? explainInline(inlineProposal, { step, targetId, provider: p as ExplainProvider })
        : explain(runId, { step, targetId, provider: p as ExplainProvider })
  if (provider === 'backend' || provider === 'template') {
    const res = await call(provider)
    const ja = res.rationale[0] ?? ''
    const en = res.rationale[1] ?? ja
    return { status: 'ready', ja, en, model: res.model, fellBack: res.fell_back }
  }
  // browser: fetch the prompt from the backend, run Nano locally, parse.
  const res = await call('browser')
  if (!(await nanoAvailable())) throw new Error('nano_unavailable')
  const raw = await runNano(res.prompt.messages)
  // Same honesty guard as the backend Ollama path: reject echo / example-parrot
  // output (checked on the PARSED text) so the panel falls back to the template
  // via 'error' rather than showing degenerate Nano text as a real explanation.
  const parsed = parseBilingual(raw)
  if (!responseIsUsable(parsed, res.prompt.messages)) throw new Error('nano_unusable')
  const [ja, en] = parsed.map(stripPlaceholders) as [string, string]
  if (!ja && !en) throw new Error('empty_nano_output')
  return { status: 'ready', ja, en, model: res.model, fellBack: false }
}

export function useExplanation(
  runId: string | undefined,
  step: ExplainStep,
  targetId: string,
  provider: ExplanationProvider,
  lang: 'ja' | 'en',
  inlineProposal?: ProposalRunLog | null,
  /** feature 025, slice S7 — the `MergedFirePoint`/`FirePoint`-shaped fire to
   * explain, for `step === 'trigger'` ONLY (mirrors `inlineProposal`'s role
   * for service/content: there is no run-id endpoint, so the caller posts the
   * evidence it already holds back inline). Untyped for the same isolation
   * reason `explainTrigger` itself is: this module lives under
   * `components/proposal/`, which never imports the trigger `api/types.ts`. */
  fire?: Record<string, unknown> | null,
): { ai: AiExplanation | null; request: () => void } {
  const [, forceRender] = useState(0)
  const requestedRef = useRef(false)
  // The ephemeral proposal to explain inline, if any. Held in a ref so `request`
  // stays stable (its identity churns each render) — the cache key is still the
  // stable runId, so this only affects HOW generate fetches, not caching.
  const inlineRef = useRef(inlineProposal)
  inlineRef.current = inlineProposal
  // Same idea, for the trigger branch's `fire` (see the param doc above).
  const fireRef = useRef(fire)
  fireRef.current = fire
  // Whether this logical slot (this candidate/item card) is currently expanded.
  // Persists ACROSS key changes (unlike requestedRef) so a live-recompute that
  // mints a new run_id, or a provider switch, can auto-regenerate rather than
  // silently reverting the shown explanation to the template.
  const expandedRef = useRef(false)

  const key = runId ? cacheKey(runId, step, targetId, provider) : ''

  // Subscribe to cache updates for this key so async completion re-renders us.
  useEffect(() => {
    if (!key) return
    const rerender = () => forceRender((n) => n + 1)
    let set = listeners.get(key)
    if (!set) {
      set = new Set()
      listeners.set(key, set)
    }
    set.add(rerender)
    return () => {
      set?.delete(rerender)
      if (set && set.size === 0) listeners.delete(key)
    }
  }, [key])

  const request = useCallback(() => {
    expandedRef.current = true // remember the slot is open (even when provider='off')
    if (!runId) return
    // 'off' is a no-op for service/content (their own baked `rationale`
    // covers it, no fetch needed) — but NOT for trigger (feature 025, slice
    // S11): it has no baked rationale, so it still fetches even when 'off',
    // just via the deterministic 'template' provider mapped below instead of
    // an LLM. See the module docstring's "Provider behavior" section.
    if (provider === 'off' && step !== 'trigger') return
    if (requestedRef.current || cache.has(key)) return // already generated / in flight
    requestedRef.current = true
    setCache(key, { status: 'loading' })
    const fetchProvider = provider === 'off' ? 'template' : provider
    generate(runId, step, targetId, fetchProvider, inlineRef.current, fireRef.current)
      .then((entry) => setCache(key, entry))
      .catch(() => setCache(key, { status: 'error' }))
  }, [runId, step, targetId, provider, key])

  // When the key changes (new run from a live-recompute edit, or a provider
  // switch): reset the per-key guard and, if this card is already expanded,
  // auto-(re)request so the shown explanation tracks the CURRENT decision.
  useEffect(() => {
    requestedRef.current = false
    if (expandedRef.current) request()
  }, [key, request])

  // Same 'off'-is-a-no-op-except-for-trigger split as `request()` above —
  // service/content read their `ai` as permanently `null` when 'off' (their
  // baked rationale is what renders instead); trigger's cache slot for 'off'
  // legitimately fills in below, with the fetched TEMPLATE sentence.
  if (!runId) return { ai: null, request }
  if (provider === 'off' && step !== 'trigger') return { ai: null, request }

  const entry = cache.get(key)
  let ai: AiExplanation | null = null
  if (entry?.status === 'loading') ai = { status: 'loading' }
  else if (entry?.status === 'error') ai = { status: 'error' }
  else if (entry?.status === 'ready') {
    ai = { status: 'ready', text: lang === 'ja' ? entry.ja : entry.en, model: entry.model, fellBack: entry.fellBack }
  }
  return { ai, request }
}

/** Test-only: clear the module cache between cases. */
export function __clearExplanationCache(): void {
  cache.clear()
  listeners.clear()
}
