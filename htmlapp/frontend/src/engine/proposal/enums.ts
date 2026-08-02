/**
 * Proposal-domain enum vocabularies — single TS source of truth, mirroring
 * `aica_api.models.proposal.enums` (`ServiceId`, `OshiMode`, `AgeBand`,
 * `Gender`).
 *
 * WHY (C2 follow-up wave, item 2): `ServiceId`'s 14 members were hand-copied
 * at four separate call sites (`eligibility.ts` as a type, `world_validation.ts`
 * as an array, `stores.ts` and `journey.ts` each as their own `Set`);
 * `OshiMode`/`AgeBand`/`Gender` at two (`stores.ts`, `world_validation.ts`).
 * They happened to be identical, but feature 025 deleting `oshi_id` from
 * the Python enums proves this drift is real, not hypothetical — a future
 * Python-side enum change has four (or two) places to remember to update in
 * this port, silently, with no compiler error if one is missed. Declaring
 * each list ONCE here and deriving every site's needed shape (`type` /
 * readonly array / `Set`) from that one declaration makes that class of
 * drift impossible rather than merely disciplined-against.
 *
 * Not a codegen step — this is a plain hand-maintained module, same as
 * every other enum table in this port (e.g. `world_validation.ts`'s
 * `TRIGGER_PURPOSE`/`LIFECYCLE_STAGE`/etc., which are out of THIS scope
 * since they are not currently duplicated anywhere else).
 */

// ---------------------------------------------------------------------------
// ServiceId — 14 catalog service identifiers (spec §7.1-7.2).
// ---------------------------------------------------------------------------

export const SERVICE_ID_VALUES = [
  'music_playlist',
  'humming_karaoke',
  'call_response_driving',
  'quiz',
  'ranking_creation',
  'radio_style',
  'conversation_audio',
  'live_viewing',
  'stretch_video',
  'full_karaoke',
  'call_response_stopped',
  'oshi_reexperience',
  'relaxation_multisensory',
  'linked_video_recommendation',
] as const

export type ServiceId = (typeof SERVICE_ID_VALUES)[number]

export const SERVICE_ID_SET: ReadonlySet<string> = new Set(SERVICE_ID_VALUES)

// ---------------------------------------------------------------------------
// DriverProfile's other closed vocabularies duplicated across modules.
// ---------------------------------------------------------------------------

export const OSHI_MODE_VALUES = ['on', 'off'] as const
export type OshiMode = (typeof OSHI_MODE_VALUES)[number]
export const OSHI_MODE_SET: ReadonlySet<string> = new Set(OSHI_MODE_VALUES)

export const AGE_BAND_VALUES = ['teens', '20s', '30s', '40s', '50s', '60plus'] as const
export type AgeBand = (typeof AGE_BAND_VALUES)[number]
export const AGE_BAND_SET: ReadonlySet<string> = new Set(AGE_BAND_VALUES)

export const GENDER_VALUES = ['male', 'female', 'non_binary', 'unspecified'] as const
export type Gender = (typeof GENDER_VALUES)[number]
export const GENDER_SET: ReadonlySet<string> = new Set(GENDER_VALUES)
