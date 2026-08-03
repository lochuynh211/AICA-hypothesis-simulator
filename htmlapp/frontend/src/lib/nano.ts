/**
 * nano.ts (feature 019) — thin, defensive wrapper over Chrome's built-in
 * on-device Prompt API ("Gemini Nano").
 *
 * The API is experimental and its surface has shifted across Chrome releases,
 * so everything here is feature-detected and guarded: on any non-Chrome
 * environment (including the jsdom test runner), `nanoAvailable()` returns
 * false and `runNano()` throws — callers fall back to the deterministic
 * template. The model runs entirely in the user's browser; nothing here talks
 * to the backend.
 *
 * Two API generations are supported:
 *   - newer: a global `LanguageModel` with `.availability()` / `.create()`
 *   - older: `window.ai.languageModel` with `.capabilities()` / `.create()`
 */

export type NanoMessage = { role: string; content: string }

type NanoSession = { prompt: (input: string) => Promise<string>; destroy?: () => void }

/* eslint-disable @typescript-eslint/no-explicit-any */

function getLanguageModel(): any | null {
  const g = globalThis as any
  if (g?.LanguageModel && typeof g.LanguageModel.create === 'function') return g.LanguageModel
  if (g?.ai?.languageModel && typeof g.ai.languageModel.create === 'function') return g.ai.languageModel
  return null
}

/** True when an on-device model is present (or downloadable) and usable. */
export async function nanoAvailable(): Promise<boolean> {
  const lm = getLanguageModel()
  if (!lm) return false
  try {
    if (typeof lm.availability === 'function') {
      const a = await lm.availability()
      return a === 'available' || a === 'readily' || a === 'downloadable' || a === 'downloading'
    }
    if (typeof lm.capabilities === 'function') {
      const c = await lm.capabilities()
      return c?.available === 'readily' || c?.available === 'after-download'
    }
    return true // create() exists but no probe — assume usable
  } catch {
    return false
  }
}

function splitSystemUser(messages: NanoMessage[]): { system?: string; user: string } {
  const system = messages.find((m) => m.role === 'system')?.content
  const user = messages
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n\n')
  return { system, user }
}

/**
 * Run the grounded prompt through the on-device model and return the raw text.
 * Throws if no model is available. Uses greedy decoding (temperature 0, topK 1)
 * for stable, reproducible output.
 */
export async function runNano(messages: NanoMessage[]): Promise<string> {
  const lm = getLanguageModel()
  if (!lm) throw new Error('nano_unavailable')
  const { system, user } = splitSystemUser(messages)

  let session: NanoSession
  try {
    const opts: any = { temperature: 0, topK: 1 }
    if (system) opts.initialPrompts = [{ role: 'system', content: system }]
    session = await lm.create(opts)
  } catch {
    // Older builds reject unknown options — retry with the legacy shape.
    session = await lm.create(system ? { systemPrompt: system } : {})
  }

  try {
    const out = await session.prompt(user)
    return typeof out === 'string' ? out : String(out ?? '')
  } finally {
    try {
      session.destroy?.()
    } catch {
      /* ignore */
    }
  }
}
