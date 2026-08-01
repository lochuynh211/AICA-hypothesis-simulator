import { describe, expect, it } from 'vitest'
import {
  evaluate,
  ContentCatalogError,
  ContentConfigError,
  ContentMissingKeyError,
} from '../src/data/packages/builtin/aica_transparent_content_selector_v1'
import type { ContentSelectorInput } from '../src/data/packages/builtin/aica_transparent_content_selector_v1'
import { loadFixture } from '../src/engine/__fixtures__/parity'

/**
 * These tests verify the TS PORT'S OWN error-handling logic — NOT parity
 * (see `content_selector_port.test.ts` for parity, byte-for-byte replay of
 * the 17 SUCCESS cases captured from the real Python `evaluate()`).
 *
 * `aica_transparent_content_selector_v1` has a THREE-tier error model (see
 * the port's own module doc for the full explanation):
 *   1. `ContentConfigError` / `ContentCatalogError` — mirror algorithm.py's
 *      own `_ConfigError`/`_CatalogError`. CAUGHT internally by `evaluate()`,
 *      producing a structured `decision_type` ("invalid_configuration" /
 *      "invalid_catalog") — most of these ARE already golden-exercised (see
 *      the port's report for the per-branch table); the one exception is the
 *      `_audio_components` "not finite" branch, which cannot be expressed in
 *      standard JSON (no `Infinity`/`NaN` literal) and so can never appear in
 *      a captured golden — covered directly below instead.
 *   2. `ContentMissingKeyError` — mirrors a bare, UNCAUGHT Python `KeyError`
 *      from any of the ~30 bare `hp["..."]` (or nested `b["..."]`/
 *      `crm["..."]`/`curves["..."]`/`maps["..."]`) dict-index sites this
 *      port enumerated while porting (see the module doc and the task
 *      report). A raising call can never appear in a golden "success" case,
 *      so nothing else in this suite exercises these sites AT ALL — without
 *      this file, a `req()` call site could be dead code, or silently return
 *      `undefined` instead of throwing, and the whole suite would still be
 *      green. Deliberately NOT exhaustive over every one of the ~30 sites
 *      (matching the service-selector validation file's own precedent) — one
 *      test per DISTINCT reachability shape (unconditionally required vs.
 *      gated behind a specific leaf/service/extension being active).
 *
 * `baseContext()` / `hummingContext()` start from two of the captured
 * golden's own cases (real, fully-valid `ContentSelectorInput`s) and mutate
 * ONE thing per test — reusing committed data rather than hand-rolling a
 * fresh minimal context per test.
 */

function baseContext(): ContentSelectorInput {
  const { input } = loadFixture('content_selector')
  const c = input.cases.find((c: { name: string }) => c.name === 'baseline_complete_plan')
  return JSON.parse(JSON.stringify(c.context)) as ContentSelectorInput
}

/** humming_karaoke + genre_affinity_v1 ON — needed for lighting_lookup / genre_affinity_maps / fixed_humming_segment_sec sites, none of which `baseContext()` (music_playlist, extension off) ever reaches. */
function hummingGenreContext(): ContentSelectorInput {
  const { input } = loadFixture('content_selector')
  const c = input.cases.find((c: { name: string }) => c.name === 'humming_genre_oshi_on')
  return JSON.parse(JSON.stringify(c.context)) as ContentSelectorInput
}

function expectThrows(fn: () => unknown, ctor: new (...args: never[]) => Error, messagePattern: RegExp): void {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown, 'expected evaluate() to throw').toBeInstanceOf(ctor)
  expect((thrown as Error).message).toMatch(messagePattern)
}

describe('aica_transparent_content_selector_v1 — error-path logic (TS-port logic, not parity)', () => {
  describe('ContentMissingKeyError — resolve_weights (algorithm.py:131-166)', () => {
    it('rejects a missing hierarchy_weights hyperparameter (algorithm.py:132)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).hierarchy_weights
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'hierarchy_weights'/)
    })

    it('rejects a missing content_category_weights hyperparameter (algorithm.py:131)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).content_category_weights
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'content_category_weights'/)
    })

    it('rejects a missing purpose_multipliers hyperparameter (algorithm.py:133)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).purpose_multipliers
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'purpose_multipliers'/)
    })

    it('a ContentMissingKeyError from resolve_weights is NOT caught into invalid_configuration (three-tier model)', () => {
      // Contrast with `invalid_configuration_zero_denominator` (a REAL
      // _ConfigError, golden-captured, decision_type "invalid_configuration"):
      // a missing hyperparameter KEY is a different, uncaught failure mode —
      // evaluate() must throw, never return a graceful result.
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).hierarchy_weights
      expect(() => evaluate(ctx)).toThrow(ContentMissingKeyError)
      expect(() => evaluate(ctx)).not.toThrow(ContentConfigError)
    })
  })

  describe('ContentMissingKeyError — derive_traits / _audio_components (algorithm.py:82-106)', () => {
    it('rejects a missing trait_composition_matrix hyperparameter (algorithm.py:104)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).trait_composition_matrix
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'trait_composition_matrix'/)
    })

    it('rejects a missing norm_bounds hyperparameter (algorithm.py:105)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).norm_bounds
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'norm_bounds'/)
    })

    it('rejects a norm_bounds table missing a required sub-key (algorithm.py:82, loudness_min)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).norm_bounds.loudness_min
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'loudness_min' in norm_bounds/)
    })
  })

  describe('ContentMissingKeyError — _feature_e_a (algorithm.py:251-425)', () => {
    it('rejects a missing context_response_matrix hyperparameter (algorithm.py:251)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).context_response_matrix
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'context_response_matrix'/)
    })

    it("rejects context_response_matrix missing the 'drowsiness' entry (algorithm.py:261, always scored by default)", () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).context_response_matrix.drowsiness
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'drowsiness' in context_response_matrix/)
    })

    it('rejects a missing history_curves hyperparameter (algorithm.py:252)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).history_curves
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'history_curves'/)
    })

    it("rejects history_curves missing the 'played' curve (algorithm.py:400, 'played' is scored by default)", () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).history_curves.played
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'played' in history_curves/)
    })

    it("rejects a missing directional_hypothesis when a directional leaf is active (algorithm.py:212, 'fatigue' is directional=True and scored by default)", () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).directional_hypothesis
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'directional_hypothesis'/)
    })

    it('rejects a missing age_era_affinity hyperparameter when the age leaf has both a band and an era (algorithm.py:389)', () => {
      const ctx = baseContext()
      // baseline_complete_plan's preference.age_band="30s" and every smoke-
      // catalog song has album.release_date set, so band && era is truthy
      // for every candidate.
      delete (ctx.hyperparameters as any).age_era_affinity
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'age_era_affinity'/)
    })

    it('does NOT touch age_era_affinity when preference.age_band is absent (band && era gate false) — sanity check for the gated-access pattern', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).age_era_affinity
      delete (ctx.feature_snapshot as any).preference.age_band
      // Must NOT throw now — the age leaf's age_era_affinity read is gated
      // behind `band && era`, and band is now absent.
      expect(() => evaluate(ctx)).not.toThrow()
    })

    it('rejects a missing genre_affinity_maps hyperparameter when genre_affinity_v1 is enabled (algorithm.py:305)', () => {
      const ctx = hummingGenreContext()
      delete (ctx.hyperparameters as any).genre_affinity_maps
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'genre_affinity_maps'/)
    })
  })

  describe('ContentMissingKeyError — eligibility_reasons (algorithm.py:507, always reached)', () => {
    it('rejects a missing skip_exclusion_window_sec hyperparameter', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).skip_exclusion_window_sec
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'skip_exclusion_window_sec'/)
    })
  })

  describe('ContentMissingKeyError — evaluate() success-path tail (algorithm.py:764, 821-822, 899-902)', () => {
    it('rejects a missing plan_item_count hyperparameter (algorithm.py:764, success path only)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).plan_item_count
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'plan_item_count'/)
    })

    it('rejects a missing fixed_humming_segment_sec hyperparameter for humming_karaoke (algorithm.py:821-822)', () => {
      const ctx = hummingGenreContext()
      delete (ctx.hyperparameters as any).fixed_humming_segment_sec
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'fixed_humming_segment_sec'/)
    })

    it('rejects a missing lighting_lookup hyperparameter for a lighting-compatible service (algorithm.py:606, humming_karaoke)', () => {
      const ctx = hummingGenreContext()
      delete (ctx.hyperparameters as any).lighting_lookup
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'lighting_lookup'/)
    })

    it('does NOT touch lighting_lookup for a non-lighting-compatible service (music_playlist) — sanity check for the gated-access pattern', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).lighting_lookup
      expect(() => evaluate(ctx)).not.toThrow()
    })

    it('rejects a missing formula_version hyperparameter (algorithm.py:734/900, every scored leaf reads it)', () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).formula_version
      expectThrows(() => evaluate(ctx), ContentMissingKeyError, /missing required key 'formula_version'/)
    })
  })

  describe('ContentCatalogError — _audio_components "not finite" (algorithm.py:79-80, NOT golden-capturable: no Infinity/NaN in standard JSON)', () => {
    it('surfaces a non-finite audio feature as decision_type "invalid_catalog" (caught, not thrown)', () => {
      const ctx = baseContext()
      const cat = (ctx.feature_snapshot as any).catalog
      const firstId = Object.keys(cat)[0]
      cat[firstId].spotify_audio_features.energy = Infinity
      const result = evaluate(ctx)
      expect(result.decision_type).toBe('invalid_catalog')
      expect((result.algorithm_provenance as any).error_reason).toMatch(/not finite/)
    })

    it('a raw ContentCatalogError instance carries the "not finite" message (constructed directly, not via evaluate())', () => {
      // Confirms the error CLASS itself (not just evaluate()'s catch wiring).
      const err = new ContentCatalogError("audio_features 'energy' not finite")
      expect(err).toBeInstanceOf(ContentCatalogError)
      expect(err.message).toMatch(/not finite/)
    })
  })
})
