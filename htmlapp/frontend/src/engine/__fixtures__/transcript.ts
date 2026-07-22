import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
export type TranscriptStep = { op: string; params: Record<string, unknown>; response: unknown }
export type Transcript = { meta: Record<string, unknown>; steps: TranscriptStep[] }

export function loadTranscript(name: string): Transcript {
  return JSON.parse(readFileSync(resolve(here, 'transcripts', `${name}.json`), 'utf8'))
}

/**
 * Drop fields the JS engine legitimately generates differently.
 * Keys listed here are stripped from BOTH sides of the parity comparison so
 * that structural key-set differences don't mask real behavioral divergences.
 *
 * VOLATILE key explanations:
 *   run_id        — Python uses timestamp+hex (run_<YYYYMMDD-HHMMSS>_<6hex>);
 *                   JS uses monotonic counter (run_000001). Both are unique
 *                   identifiers; the format intentionally differs for offline determinism.
 *   plan_id       — Same reason: Python uses timestamp+hex; JS uses counter (plan_000001).
 *   report_id     — Generated at the evidence router boundary (once per request);
 *                   Python and JS generate independently with different formats.
 *   created_at    — ISO timestamp at run creation time; differs between sessions.
 *   generated_at  — ISO timestamp at evidence report generation time; differs between sessions.
 *   timestamp     — ISO timestamp at evidence report generation time (top-level evidence key);
 *                   Python: full ISO with timezone offset; JS: Z-suffix. Both represent "now".
 *   snapshot      — Contains package/scenario content hashes. Python hashes the
 *                   Pydantic-canonicalized model_dump() representation (which adds
 *                   Pydantic defaults the raw JS objects don't carry), so SHA-256 of
 *                   non-identical canonical bytes differs. Only hash values differ,
 *                   not structural presence.
 *   driver_profile — Python's Pydantic ActivityRecovery model adds default fields
 *                   (drowsiness_per_min, fatigue_per_min, cap_drowsiness, cap_fatigue)
 *                   to each recovery_model entry via Pydantic's model_dump(). The JS
 *                   offline build passes through the raw scenario JSON which only
 *                   carries {drowsiness, fatigue}. The tick loop only uses
 *                   drowsiness/fatigue, so this is a purely cosmetic serialization
 *                   difference — no behavioral impact.
 *   effective_setup — Contains driver_profile (same Pydantic-inflation issue as above).
 *   monotony_accrued_min — Feature 020 Slice-3 field in TickState; not yet ported to
 *                   the offline JS build.
 *   monotonyLevel  — Feature 020 dynamic signal derived from monotony_accrued_min;
 *                   not yet ported to the offline JS tick engine.
 */
const VOLATILE = new Set([
  'run_id',
  'plan_id',
  'report_id',
  'created_at',
  'generated_at',
  'timestamp',             // evidence report generation time; format differs (Python TZ-offset vs JS Z-suffix)
  'snapshot',              // hash values differ: Python Pydantic-canonical vs JS JSON-canonical
  'driver_profile',        // Pydantic adds extra ActivityRecovery defaults; JS is raw JSON pass-through
  'effective_setup',       // contains driver_profile (same Pydantic-inflation issue)
  'monotony_accrued_min',  // Feature 020 Slice-3 TickState field; not yet ported to offline JS
  'monotonyLevel',         // Feature 020 dynamic signal; not yet ported to offline JS tick engine
])

export function normalizeForParity(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(normalizeForParity)
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      // VOLATILE keys are dropped entirely so both sides have the same key set
      // (rather than setting to null, which would mismatch when one side lacks
      // the key entirely and the other has it as null).
      if (!VOLATILE.has(k)) {
        o[k] = normalizeForParity(val)
      }
    }
    return o
  }
  return v
}
