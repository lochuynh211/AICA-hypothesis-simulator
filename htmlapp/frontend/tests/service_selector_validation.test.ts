import { describe, expect, it } from 'vitest'
import {
  evaluate,
  SelectorCatalogError,
  SelectorConfigError,
  SelectorRequestError,
} from '../src/data/packages/builtin/aica_transparent_service_selector_v1'
import type { SelectorInput } from '../src/data/packages/builtin/aica_transparent_service_selector_v1'
import { loadFixture } from '../src/engine/__fixtures__/parity'

/**
 * These tests verify the TS PORT'S OWN input-validation logic — that each
 * thrown error class (`SelectorRequestError` / `SelectorConfigError` /
 * `SelectorCatalogError`) actually fires, and fires on the same CONDITION
 * algorithm.py's own `raise` fires on. They are NOT parity tests: a raising
 * call can never be captured as a golden "success" case (see
 * `service_selector_port.test.ts`, which covers parity — byte-for-byte
 * replay of the 11 SUCCESS cases captured from the real Python evaluate()),
 * so nothing anywhere else in this suite exercises these ~15 throw sites at
 * all. Without this file, a throw site could be dead code, or fire on the
 * wrong predicate, and the whole suite would still pass green.
 *
 * Each `describe` block is grouped by which Python function/raise it maps
 * to (see the inline `algorithm.py:<line>` reference on every `it`) so a
 * reader can line the two up. `packages/aica_transparent_service_selector_v1/
 * algorithm.py` is read-only reference here, never edited.
 *
 * `baseContext()` starts from the captured golden's own `worked_example`
 * case (a real, fully-valid `SelectorInput`) and mutates ONE field per test
 * — reusing committed data rather than hand-rolling a fresh minimal context
 * per test, and keeping each test's diff from "valid" obvious at a glance.
 */

function baseContext(): SelectorInput {
  const { input } = loadFixture('service_selector')
  const worked = input.cases.find((c: { name: string }) => c.name === 'worked_example')
  // Deep clone: evaluate() doesn't mutate its input, but each test mutates
  // its own copy independently regardless.
  return JSON.parse(JSON.stringify(worked.context)) as SelectorInput
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

describe('aica_transparent_service_selector_v1 — input validation (TS-port logic, not parity)', () => {
  describe('SelectorRequestError — _validate_purpose_stage (algorithm.py:680-688)', () => {
    it('rejects an unknown trigger_purpose (algorithm.py:682)', () => {
      const ctx = baseContext()
      ;(ctx as any).trigger_purpose = 'not_a_real_purpose'
      expectThrows(() => evaluate(ctx), SelectorRequestError, /invalid trigger_purpose/)
    })

    it('rejects an unknown lifecycle_stage (algorithm.py:684)', () => {
      const ctx = baseContext()
      ;(ctx as any).lifecycle_stage = 'not_a_real_stage'
      expectThrows(() => evaluate(ctx), SelectorRequestError, /invalid lifecycle_stage/)
    })

    it('rejects a rest lifecycle_stage paired with a non-rest purpose (algorithm.py:685-686)', () => {
      const ctx = baseContext()
      // trigger_purpose stays inattentive_driving_prevention_recovery (not rest_recommended).
      ctx.lifecycle_stage = 'before_rest_until_stop'
      expectThrows(
        () => evaluate(ctx),
        SelectorRequestError,
        /only compatible with trigger_purpose 'rest_recommended'/,
      )
    })

    it('rejects active_driving_content paired with an incompatible purpose (algorithm.py:687-688)', () => {
      const ctx = baseContext()
      // lifecycle_stage stays active_driving_content; rest_recommended is not
      // one of the 3 ACTIVE_DRIVING_PURPOSES.
      ctx.trigger_purpose = 'rest_recommended'
      expectThrows(
        () => evaluate(ctx),
        SelectorRequestError,
        /lifecycle_stage 'active_driving_content' is not compatible with trigger_purpose/,
      )
    })
  })

  describe('SelectorRequestError — _validate_oshi_consistency (algorithm.py:691-693)', () => {
    it("rejects oshi_registered=false with oshi_mode='on' (algorithm.py:692-693)", () => {
      const ctx = baseContext()
      // worked_example ships oshi_registered=true, oshi_mode="on" — flip only
      // oshi_registered to reach the invalid combination.
      ;(ctx.feature_snapshot as any).preference.oshi_registered = false
      expectThrows(
        () => evaluate(ctx),
        SelectorRequestError,
        /oshi_registered=false and oshi_mode='on' is invalid input/,
      )
    })
  })

  describe('SelectorRequestError — resolve_scalar_evidence (algorithm.py:439-517)', () => {
    it('rejects an invalid categorical situation value (algorithm.py:468, traffic_state)', () => {
      const ctx = baseContext()
      ;(ctx.feature_snapshot as any).situation.traffic_state = 'not_a_real_state'
      expectThrows(
        () => evaluate(ctx),
        SelectorRequestError,
        /traffic_state must be 'normal' or 'congested'/,
      )
    })
  })

  describe('SelectorCatalogError — eligibility / stage-family loop (algorithm.py:746-750)', () => {
    it('rejects an eligible candidate outside allowed_service_ids (algorithm.py:748)', () => {
      const ctx = baseContext()
      ctx.allowed_service_ids = ['music_playlist']
      ctx.eligible_candidates = [{ candidate_id: 'humming_karaoke' }]
      expectThrows(
        () => evaluate(ctx),
        SelectorCatalogError,
        /eligible candidate 'humming_karaoke' is not in allowed_service_ids/,
      )
    })

    it("rejects a candidate outside the stage's frozen candidate family (algorithm.py:750)", () => {
      const ctx = baseContext()
      // music_playlist is a before_rest/active_driving service, not one of
      // after_rest_before_restart's 5 post-rest candidates.
      ctx.trigger_purpose = 'rest_recommended'
      ctx.lifecycle_stage = 'after_rest_before_restart'
      ctx.allowed_service_ids = ['music_playlist']
      ctx.eligible_candidates = [{ candidate_id: 'music_playlist' }]
      expectThrows(
        () => evaluate(ctx),
        SelectorCatalogError,
        /candidate 'music_playlist' is not a supported service for lifecycle_stage 'after_rest_before_restart'/,
      )
    })
  })

  describe('SelectorConfigError — resolve_weights / _normalize_siblings (algorithm.py:197-291)', () => {
    it("rejects a missing declared hyperparameter key (algorithm.py:197-200, _hp('hierarchy_weights'))", () => {
      const ctx = baseContext()
      delete (ctx.hyperparameters as any).hierarchy_weights
      expectThrows(() => evaluate(ctx), SelectorConfigError, /missing hyperparameter 'hierarchy_weights'/)
    })

    it('rejects a negative hierarchy share (algorithm.py:230-231)', () => {
      const ctx = baseContext()
      ;(ctx.hyperparameters as any).hierarchy_weights.Situation.share = -0.1
      expectThrows(() => evaluate(ctx), SelectorConfigError, /categories\[Situation\] is negative/)
    })
  })

  describe('SelectorConfigError — _apply_response_override (algorithm.py:645-672)', () => {
    it('rejects an out-of-range response_coefficient_overrides value (algorithm.py:664-667)', () => {
      const ctx = baseContext()
      ;(ctx.hyperparameters as any).response_coefficient_overrides = {
        music_playlist: { drowsiness_level: 1.5 },
      }
      expectThrows(
        () => evaluate(ctx),
        SelectorConfigError,
        /response_coefficient_overrides\['music_playlist'\]\['drowsiness_level'\] out of \[-1,1\]/,
      )
    })
  })

  describe('SelectorConfigError — resolve_response (algorithm.py:614-634)', () => {
    it('rejects a service_response_profiles table missing a candidate entry (algorithm.py:627-630)', () => {
      const ctx = baseContext()
      delete (ctx.parameters as any).service_response_profiles.music_playlist
      expectThrows(
        () => evaluate(ctx),
        SelectorConfigError,
        /service_response_profiles missing candidate 'music_playlist'/,
      )
    })
  })
})
