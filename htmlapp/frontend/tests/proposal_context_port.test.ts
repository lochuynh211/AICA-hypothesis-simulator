import { describe, expect, it } from 'vitest'
import {
  buildServiceContext,
  buildContentContext,
  buildRealContentContext,
  catalogMapForDataset,
  genreAffinityArtistGenres,
  redactCatalogForEvidence,
  datasetIdForRun,
  resolveSongName,
  resolveSongArtist,
  resolveOshiArtist,
} from '../src/engine/proposal/orchestrator/context'
import type { ProposalRunLog } from '../src/engine/proposal/run_manager'
import { ensureRegistry } from '../src/data/registry'
import { loadFixture, expectParity } from '../src/engine/__fixtures__/parity'

/**
 * Conformance tests for `src/engine/proposal/orchestrator/context.ts` — the
 * port of the 10 context-builder/resolver helpers in `app/api/aica_api/
 * routers/proposal.py` (feature 026, htmlapp Combined export, slice C4a
 * Task 2).
 *
 * Fixture: `src/engine/__fixtures__/parity/proposal_context.json`, captured
 * by `scripts/gen/capture_all.py#_capture_proposal_context` — every case
 * calls the REAL Python private function directly, over REAL committed
 * catalog/seed/profile data wherever a branch is reachable that way.
 * Cases whose name ends `_SYNTHETIC` are disclosed as such in both the
 * fixture and here (real artist/track ids reused where possible; only the
 * specific field the case needs to isolate is hand-tweaked) — see
 * `context.ts`'s own module doc and the task report for the full
 * reachability discussion, including `_resolve_oshi_artist`'s six
 * collapsed-to-`null` code paths and the unreached bare-`except` guard.
 *
 * `_build_real_content_context`'s captured output has its (real, 300-song)
 * `feature_snapshot.catalog` replaced by a `{_song_count, _sample_track_id}`
 * projection (see the capture script's `_trim_catalog`) — full
 * catalog-map fidelity (content AND key order) is independently proven by
 * the `catalogMapForDataset` describe block below instead of re-embedding
 * 300 songs a second time.
 */

ensureRegistry()

const { output } = loadFixture('proposal_context')

const DATASET_ID = 'soundcharts-grounded-spotify-compatible-demonstration-seed-1042'

/** Mirrors the capture script's own `_trim_catalog` — see its doc comment
 * for why no sample song body is embedded (the documented raw-vs-
 * Song.model_dump divergence; song-content fidelity is proven separately by
 * the resolveSongName/resolveSongArtist/resolveOshiArtist cases instead). */
function trimCatalog(ctx: Record<string, unknown>): Record<string, unknown> {
  const fs = { ...(ctx.feature_snapshot as Record<string, unknown>) }
  const catalog = fs.catalog as Record<string, Record<string, unknown>>
  const firstId = Object.keys(catalog)[0]
  fs.catalog = { _song_count: Object.keys(catalog).length, _sample_track_id: firstId }
  return { ...ctx, feature_snapshot: fs }
}

describe('buildServiceContext (routers/proposal.py:194-235)', () => {
  output.build_service_context_cases.forEach((c: any) => {
    it(c.name, () => {
      const input = c.input
      const result = buildServiceContext({
        package: { contract_version: input.package_contract_version },
        opportunity: input.opportunity,
        worldSnapshot: input.world_snapshot,
        enabledFeatureExtensions: input.enabled_feature_extensions,
        parameters: input.parameters,
        hyperparameters: input.hyperparameters,
        eligibleServiceIds: input.eligible_service_ids,
        excludedCandidates: input.excluded_candidates,
      })
      expectParity(result, c.output, c.name)
    })
  })

  it('catalog_version defaults to "n/a" only when the key is ABSENT (not merely falsy)', () => {
    const missing = output.build_service_context_cases.find(
      (c: any) => c.name === 'catalog_version_key_absent_defaults_to_n_a',
    )
    expect(missing.output.catalog_version).toBe('n/a')
    expect('catalog_version' in missing.input.world_snapshot).toBe(false)
  })

  it('SYNTHETIC: catalog_version present but explicitly null stays null (mirrors dict.get(key, default) exactly, NOT `?? "n/a"`)', () => {
    const c = output.build_service_context_cases.find(
      (c: any) => c.name === 'catalog_version_key_present_but_null_stays_null_SYNTHETIC',
    )
    expect(c.synthetic).toBe(true)
    expect(c.output.catalog_version).toBeNull()
    expect('catalog_version' in c.input.world_snapshot).toBe(true)
    const result = buildServiceContext({
      package: { contract_version: c.input.package_contract_version },
      opportunity: c.input.opportunity,
      worldSnapshot: c.input.world_snapshot,
      enabledFeatureExtensions: c.input.enabled_feature_extensions,
      parameters: c.input.parameters,
      hyperparameters: c.input.hyperparameters,
      eligibleServiceIds: c.input.eligible_service_ids,
      excludedCandidates: c.input.excluded_candidates,
    })
    expect(result.catalog_version).toBeNull()
  })
})

describe('buildContentContext (routers/proposal.py:238-291, mock/legacy path)', () => {
  output.build_content_context_cases.forEach((c: any) => {
    it(c.name, () => {
      const input = c.input
      const result = buildContentContext({
        package: { contract_version: input.package_contract_version },
        runLog: input.run_log as unknown as ProposalRunLog,
        selectedServiceId: input.selected_service_id,
        contentParameters: input.content_parameters,
        contentHyperparameters: input.content_hyperparameters,
      })
      expectParity(result, c.output, c.name)
    })
  })

  it('package_runtime_state case is SYNTHETIC only for the catalog-shape case, not the evidence-loop case', () => {
    const catalogCase = output.build_content_context_cases.find((c: any) => c.name.endsWith('_SYNTHETIC'))
    expect(catalogCase.synthetic).toBe(true)
    const loopCase = output.build_content_context_cases.find(
      (c: any) => c.name === 'package_runtime_state_skips_wrong_step_and_falsy_empty_output',
    )
    expect(loopCase.synthetic).toBeUndefined()
    // Proves the Python-falsy empty-dict evidence entry was SKIPPED in favor
    // of the later real one — a naive `if (ev.output)` port would have
    // stopped at the empty dict and returned {} instead.
    expect(loopCase.output.package_runtime_state).toEqual({ cooldowns: { music_playlist: 2 } })
  })
})

describe('catalogMapForDataset (routers/proposal.py:294-305)', () => {
  const known = output.catalog_map_for_dataset_cases.find((c: any) => c.name === 'known_real_dataset')
  const unknown = output.catalog_map_for_dataset_cases.find((c: any) => c.name === 'unknown_dataset_id')

  it('known real dataset: song_count and ORDERED track_ids match Python exactly (hazard 4)', () => {
    const map = catalogMapForDataset(DATASET_ID)
    expect(map).not.toBeNull()
    const keys = Object.keys(map as Record<string, unknown>)
    expect(keys.length).toBe(known.output.song_count)
    expect(keys).toEqual(known.output.track_ids)
  })

  it('unknown dataset id returns null', () => {
    expect(unknown.output.is_null).toBe(true)
    expect(catalogMapForDataset('not-a-real-dataset-id')).toBeNull()
  })

  it('map values are the SAME raw entries datasetCatalogRegistry.getCatalog() returns (documented pre-existing divergence from Python\'s Song.model_dump — see context.ts module doc)', () => {
    const map = catalogMapForDataset(DATASET_ID) as Record<string, Record<string, unknown>>
    const firstId = known.output.track_ids[0]
    expect((map[firstId].spotify_track as any).id).toBe(firstId)
  })
})

describe('genreAffinityArtistGenres (routers/proposal.py:308-325)', () => {
  output.genre_affinity_artist_genres_cases.forEach((c: any) => {
    it(c.name, () => {
      const result = genreAffinityArtistGenres(c.input.dataset_id)
      expectParity(result, c.output, c.name)
    })
  })
})

describe('buildRealContentContext (routers/proposal.py:328-401)', () => {
  const successCases = output.build_real_content_context_cases.filter((c: any) => !c.raises)
  successCases.forEach((c: any) => {
    it(c.name, () => {
      const input = c.input
      const result = buildRealContentContext({
        package: { contract_version: input.package_contract_version },
        runLog: input.run_log as unknown as ProposalRunLog,
        selectedServiceId: input.selected_service_id,
        contentParameters: input.content_parameters,
        contentHyperparameters: input.content_hyperparameters,
      })
      expectParity(trimCatalog(result), c.output, c.name)
    })
  })

  it('genre extension ON merges artist_genres AFTER usage_by_genre/scene_genre_usage — exact key order (hazard 4)', () => {
    const c = output.build_real_content_context_cases.find(
      (c: any) => c.name === 'genre_extension_on_merges_artist_genres_and_picks_real_runtime_state',
    )
    const result = buildRealContentContext({
      package: { contract_version: c.input.package_contract_version },
      runLog: c.input.run_log as unknown as ProposalRunLog,
      selectedServiceId: c.input.selected_service_id,
      contentParameters: c.input.content_parameters,
      contentHyperparameters: c.input.content_hyperparameters,
    })
    const gav1 = result.feature_snapshot as any
    expect(Object.keys(gav1.genre_affinity_v1)).toEqual(['usage_by_genre', 'scene_genre_usage', 'artist_genres'])
    expect(Object.keys(c.output.feature_snapshot.genre_affinity_v1)).toEqual([
      'usage_by_genre', 'scene_genre_usage', 'artist_genres',
    ])
  })

  it('genre extension OFF never sets feature_snapshot.genre_affinity_v1', () => {
    const c = output.build_real_content_context_cases.find((c: any) => c.name === 'genre_extension_off')
    const result = buildRealContentContext({
      package: { contract_version: c.input.package_contract_version },
      runLog: c.input.run_log as unknown as ProposalRunLog,
      selectedServiceId: c.input.selected_service_id,
      contentParameters: c.input.content_parameters,
      contentHyperparameters: c.input.content_hyperparameters,
    })
    expect(result.enabled_feature_extensions).toEqual([])
    expect((result.feature_snapshot as any).genre_affinity_v1).toBeUndefined()
  })

  it('setup_snapshot === null throws (mirrors Python\'s assert, not an HTTPException)', () => {
    const c = output.build_real_content_context_cases.find((c: any) => c.name === 'setup_snapshot_none_raises')
    expect(c.raises).toBe(true)
    expect(() =>
      buildRealContentContext({
        package: { contract_version: c.input.package_contract_version },
        runLog: c.input.run_log as unknown as ProposalRunLog,
        selectedServiceId: c.input.selected_service_id,
        contentParameters: c.input.content_parameters,
        contentHyperparameters: c.input.content_hyperparameters,
      }),
    ).toThrow()
  })
})

describe('redactCatalogForEvidence (routers/proposal.py:404-430)', () => {
  it('real full catalog: redacted to {dataset_id, song_count}; ORIGINAL context is untouched (deep-copy proof)', () => {
    const c = output.redact_catalog_for_evidence_cases.find(
      (c: any) => c.name === 'real_full_catalog_redacted_original_untouched',
    )
    // The fixture's own `input.context` is pre-trimmed (see _trim_catalog in
    // the capture script) so it stays small — rebuild the REAL, untrimmed
    // 300-song context locally via buildRealContentContext (using the SAME
    // genre-on run_log Python built `real_ctx` from) instead of feeding the
    // trimmed 3-key stand-in into redactCatalogForEvidence, which would
    // redact THAT dict's own key count rather than the real catalog's.
    const genreOnCase = output.build_real_content_context_cases.find(
      (c: any) => c.name === 'genre_extension_on_merges_artist_genres_and_picks_real_runtime_state',
    )
    const ctx = buildRealContentContext({
      package: { contract_version: genreOnCase.input.package_contract_version },
      runLog: genreOnCase.input.run_log as unknown as ProposalRunLog,
      selectedServiceId: genreOnCase.input.selected_service_id,
      contentParameters: genreOnCase.input.content_parameters,
      contentHyperparameters: genreOnCase.input.content_hyperparameters,
    })
    const redacted = redactCatalogForEvidence(ctx, c.input.dataset_id)

    expect(redacted.feature_snapshot).not.toBe(ctx.feature_snapshot) // deep copy, not same object
    expect((redacted.feature_snapshot as any).catalog).toEqual(c.output.redacted_catalog_field)
    expect(c.output.redacted_catalog_field).toEqual({
      _redacted_catalog: { dataset_id: DATASET_ID, song_count: 300 },
    })

    // Deep-copy proof: the ORIGINAL ctx (passed to redactCatalogForEvidence)
    // still has its full, un-redacted 300-song catalog afterward.
    const catalogAfter = (ctx.feature_snapshot as any).catalog as Record<string, unknown>
    expect(Object.keys(catalogAfter).length).toBe(c.output.original_context_song_count_after_call)
    expect(Object.keys(catalogAfter).length).toBe(300)
  })

  it('isinstance(feature_snapshot, dict) guard: feature_snapshot present with no catalog key is a no-op (redacted === deep copy of input)', () => {
    const c = output.redact_catalog_for_evidence_cases.find(
      (c: any) => c.name === 'feature_snapshot_has_no_catalog_key_noop',
    )
    const result = redactCatalogForEvidence(c.input.context, c.input.dataset_id)
    expectParity(result, c.output, c.name)
  })

  it('SYNTHETIC: feature_snapshot key entirely absent -> no-op (isinstance(feature_snapshot, dict) False)', () => {
    const c = output.redact_catalog_for_evidence_cases.find(
      (c: any) => c.name === 'feature_snapshot_key_absent_noop_SYNTHETIC',
    )
    expect(c.synthetic).toBe(true)
    const result = redactCatalogForEvidence(c.input.context, c.input.dataset_id)
    expectParity(result, c.output, c.name)
  })

  it('SYNTHETIC: feature_snapshot present but not a dict -> no-op', () => {
    const c = output.redact_catalog_for_evidence_cases.find(
      (c: any) => c.name === 'feature_snapshot_not_a_dict_noop_SYNTHETIC',
    )
    expect(c.synthetic).toBe(true)
    const result = redactCatalogForEvidence(c.input.context, c.input.dataset_id)
    expectParity(result, c.output, c.name)
  })

  it('SYNTHETIC: catalog present but not a dict (a list) -> no-op on catalog', () => {
    const c = output.redact_catalog_for_evidence_cases.find(
      (c: any) => c.name === 'catalog_present_but_not_a_dict_noop_SYNTHETIC',
    )
    expect(c.synthetic).toBe(true)
    const result = redactCatalogForEvidence(c.input.context, c.input.dataset_id)
    expectParity(result, c.output, c.name)
  })
})

describe('datasetIdForRun (routers/proposal.py:1982-1996)', () => {
  output.dataset_id_for_run_cases.forEach((c: any) => {
    it(`${c.name}${c.synthetic ? ' (SYNTHETIC)' : ''}`, () => {
      const runLog = c.input.run_log as unknown as ProposalRunLog
      expect(datasetIdForRun(runLog)).toBe(c.output)
    })
  })
})

describe('resolveSongName (routers/proposal.py:1999-2015)', () => {
  output.resolve_song_name_cases.forEach((c: any) => {
    it(c.name, () => {
      const runLog = c.input.run_log as unknown as ProposalRunLog
      expect(resolveSongName(runLog, c.input.track_id)).toBe(c.output)
    })
  })
})

describe('resolveSongArtist (routers/proposal.py:2018-2034)', () => {
  output.resolve_song_artist_cases.forEach((c: any) => {
    it(c.name, () => {
      const runLog = c.input.run_log as unknown as ProposalRunLog
      expect(resolveSongArtist(runLog, c.input.track_id)).toBe(c.output)
    })
  })
})

describe('resolveOshiArtist (routers/proposal.py:2037-2065)', () => {
  output.resolve_oshi_artist_cases.forEach((c: any) => {
    it(`${c.name}${c.synthetic ? ' (SYNTHETIC)' : ''}`, () => {
      const runLog = c.input.run_log as unknown as ProposalRunLog
      expect(resolveOshiArtist(runLog)).toBe(c.output)
    })
  })

  it(
    'DISCLOSURE: guards 1 (world=None), 2+3-together (registered=False & mode=off), ' +
      'and the no-match fallthrough all collapse to the identical `null` output — ' +
      'these are NOT independently distinguishable from the golden output alone; see ' +
      'context.ts module doc for which real vs. synthetic inputs exercise each anyway',
    () => {
      const collapsedToNull = output.resolve_oshi_artist_cases.filter((c: any) => c.output === null)
      expect(collapsedToNull.length).toBeGreaterThanOrEqual(5)
      const distinctNames = new Set(collapsedToNull.map((c: any) => c.name))
      expect(distinctNames.size).toBe(collapsedToNull.length)
    },
  )

  it('guard 2+3 are NOT independently reachable from any committed profile (both false together only)', () => {
    const c = output.resolve_oshi_artist_cases.find(
      (c: any) => c.name === 'real_oshi_registered_false_and_mode_off_together',
    )
    expect(c.synthetic).toBeUndefined()
    expect(c.note).toMatch(/not independently exercised/i)
  })

  it('tie-break: two REAL artist ids at a SYNTHETIC equal enthusiasm -> first-in-list wins (mirrors Python max())', () => {
    const c = output.resolve_oshi_artist_cases.find((c: any) => c.name === 'tie_break_first_in_list_wins_SYNTHETIC')
    expect(c.synthetic).toBe(true)
    expect(c.output).toBe('HY')
    const runLog = c.input.run_log as unknown as ProposalRunLog
    expect(resolveOshiArtist(runLog)).toBe('HY')
  })
})
