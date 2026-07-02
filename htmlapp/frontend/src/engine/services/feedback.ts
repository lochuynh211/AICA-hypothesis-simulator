/**
 * Feedback service — effective schema, categorical validation, and
 * append-only persistence for reviewer feedback.
 *
 * Ported from `app/api/aica_api/services/feedback.py` (behavior-of-record):
 *   - effectiveSchema(manifest) -> FieldDef[]
 *       V1 baseline (master §13.2, 9 fields) ∪ package extras; throws
 *       SchemaCollisionError on key collision or a malformed extra field.
 *   - validate(schema, body, runLog?) -> { ok: true } | { ok: false; errors }
 *       Validates labels (choice/text/scale) and the FeedbackTarget scope /
 *       event_ref. All label fields are optional; a completely empty
 *       payload is valid. Mirrors Python's validate(payload, schema, run_log)
 *       except `runLog` is optional here — omitting it is only safe for
 *       scope="run" targets (no event_ref to resolve), which is exactly the
 *       shape the TDD fixture's literal test exercises.
 *   - appendFeedback(runId, body) -> Promise<FeedbackEvent>
 *       Builds the FeedbackEvent and delegates to run_manager.appendFeedback
 *       (already ported in S4.2) rather than duplicating the append-only
 *       write path — that function appends via EvidenceRecorder into the
 *       `run_events` IndexedDB store, exactly like every other RunLogEvent
 *       (tick/action/algorithm_error), matching Python where a FeedbackEvent
 *       is just another entry in RunLog.events. Never updates/deletes a
 *       prior event.
 *
 * NON-ALGORITHMIC: this module never touches the adapter or the decision
 * path.
 */
import type {
  FeedbackEvent,
  FeedbackSubmitBody,
  FeedbackTarget,
  FieldDef,
  PackageManifest,
  RunLog,
  RunLogEvent,
  ValidationError,
} from '../../api/types'
import { appendFeedback as runManagerAppendFeedback } from '../run_manager'

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Raised when a package extra feedback_schema field key collides with a
 * V1 baseline key, or when an extra field is malformed. */
export class SchemaCollisionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SchemaCollisionError'
  }
}

// ---------------------------------------------------------------------------
// V1 baseline feedback schema (§13.2) — ported verbatim from
// app/api/aica_api/models/feedback.py's V1_FEEDBACK_SCHEMA. Key order and
// every string value (including the Japanese labels/options) must match
// byte-for-byte — this crosses the parity boundary.
// ---------------------------------------------------------------------------

export const V1_FEEDBACK_SCHEMA: FieldDef[] = [
  {
    key: 'proposal_timing',
    label: { ja: '提案タイミング', en: 'Proposal Timing' },
    type: 'choice',
    options: ['too_early', 'appropriate', 'too_late', 'unnecessary', 'missed_opportunity'],
    note: false,
    min: null,
    max: null,
  },
  {
    key: 'safety_impression',
    label: { ja: '安全性の印象', en: 'Safety Impression' },
    type: 'choice',
    options: ['safe', 'somewhat_risky', 'unsafe', 'unclear'],
    note: false,
    min: null,
    max: null,
  },
  {
    key: 'intrusiveness',
    label: { ja: '煩わしさ', en: 'Intrusiveness' },
    type: 'choice',
    options: ['not_intrusive', 'acceptable', 'intrusive', 'very_intrusive'],
    note: false,
    min: null,
    max: null,
  },
  {
    key: 'understandability',
    label: { ja: 'わかりやすさ', en: 'Understandability' },
    type: 'choice',
    options: ['clear', 'somewhat_clear', 'unclear'],
    note: false,
    min: null,
    max: null,
  },
  {
    key: 'rest_spot_suitability',
    label: { ja: '休憩場所の適切さ', en: 'Rest Spot Suitability' },
    type: 'choice',
    options: ['suitable', 'acceptable', 'unsuitable', 'no_suitable_rest_spot'],
    note: false,
    min: null,
    max: null,
  },
  {
    key: 'proposal_content_suitability',
    label: { ja: '提案内容の適切さ', en: 'Proposal Content Suitability' },
    type: 'choice',
    options: ['suitable', 'acceptable', 'unsuitable'],
    note: false,
    min: null,
    max: null,
  },
  {
    key: 'acceptance_reason',
    label: { ja: '承諾理由', en: 'Acceptance Reason' },
    type: 'choice',
    options: ['rest_needed', 'convenient_timing', 'trusted_suggestion', 'other'],
    note: true,
    min: null,
    max: null,
  },
  {
    key: 'rejection_reason',
    label: { ja: '拒否理由', en: 'Rejection Reason' },
    type: 'choice',
    options: ['not_tired', 'bad_timing', 'unsuitable_rest_spot', 'distrust', 'other'],
    note: true,
    min: null,
    max: null,
  },
  {
    key: 'overall_judgment',
    label: { ja: '総合評価', en: 'Overall Judgment' },
    type: 'choice',
    options: ['good_trigger', 'acceptable', 'poor_trigger'],
    note: false,
    min: null,
    max: null,
  },
]

// ---------------------------------------------------------------------------
// effectiveSchema
// ---------------------------------------------------------------------------

/** Parse one raw `manifest.feedback_schema` entry into a FieldDef, throwing
 * SchemaCollisionError (naming the package) when required fields are
 * missing/malformed — mirrors Python's `FieldDef(**raw)` Pydantic
 * validation being caught and re-raised as SchemaCollisionError. */
function parseFieldDef(raw: Record<string, unknown>, packageId: string): FieldDef {
  const key = raw['key']
  const type = raw['type']
  const label = raw['label']
  const isValidType = type === 'choice' || type === 'text' || type === 'scale'
  if (typeof key !== 'string' || !isValidType || typeof label !== 'object' || label === null) {
    throw new SchemaCollisionError(
      `Malformed feedback_schema field in package '${packageId}': ${JSON.stringify(raw)}`,
    )
  }
  return {
    key,
    label: label as { ja: string; en: string },
    type,
    options: (raw['options'] as string[] | null | undefined) ?? null,
    note: Boolean(raw['note'] ?? false),
    min: (raw['min'] as number | null | undefined) ?? null,
    max: (raw['max'] as number | null | undefined) ?? null,
  }
}

/**
 * Return the effective schema for a package: V1 baseline ∪ package extras.
 * The V1 baseline (9 fields) always comes first; package-declared extra
 * fields (`manifest.feedback_schema`) are appended in order.
 *
 * @throws SchemaCollisionError if any extra field's key collides with a V1
 *   key, or an extra field is malformed.
 */
export function effectiveSchema(manifest: PackageManifest): FieldDef[] {
  const v1Keys = new Set(V1_FEEDBACK_SCHEMA.map((fd) => fd.key))
  const extras: FieldDef[] = []

  for (const raw of manifest.feedback_schema ?? []) {
    const fd = parseFieldDef(raw as Record<string, unknown>, manifest.id)
    if (v1Keys.has(fd.key)) {
      throw new SchemaCollisionError(
        `Package extra feedback_schema key '${fd.key}' collides with a V1 baseline field; `
          + 'remove it from the package manifest.',
      )
    }
    extras.push(fd)
  }

  return [...V1_FEEDBACK_SCHEMA, ...extras]
}

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

/**
 * Validate a feedback submission body against the effective schema and
 * (optionally) the run log, for target scope/event_ref resolution.
 *
 * All label fields are optional — empty labels with only a comment is
 * valid, and a completely empty payload is valid.
 *
 * Label validation rules:
 * - Every key in labels must be present in the effective schema.
 * - choice field: value is a plain option string (must be in options), OR
 *   a dict `{choice, note}` when the field has note=true.
 * - text field: value must be a string.
 * - scale field: value must be numeric; must be within [min, max] if set.
 *
 * Target validation rules:
 * - scope="run": no event_ref required.
 * - scope="decision": event_ref must index a TickEvent in runLog.events.
 * - scope="proposal": event_ref must index a TickEvent with a fired
 *   proposal (fire_control.fired=true and proposal is not null).
 * - scope="action": event_ref must index an ActionEvent in runLog.events.
 *
 * `runLog` is optional: only scope="run" targets can be fully validated
 * without one (no event_ref to resolve). Every other scope requires a
 * `runLog` to resolve event_ref — omitting it degrades to "runLog has 0
 * events" for the out-of-range check, which is safe (never silently valid).
 */
export function validate(
  schema: FieldDef[],
  body: FeedbackSubmitBody,
  runLog?: RunLog,
): { ok: true } | { ok: false; errors: ValidationError[] } {
  const errors: ValidationError[] = []
  const schemaByKey = new Map(schema.map((fd) => [fd.key, fd]))
  const labels = body.labels ?? {}

  for (const [key, value] of Object.entries(labels)) {
    const fd = schemaByKey.get(key)
    if (!fd) {
      errors.push({
        field: `labels.${key}`,
        message: `Unknown label key '${key}'; not in the effective schema.`,
      })
      continue
    }
    validateLabelValue(fd, key, value, errors)
  }

  validateTarget(body.target, runLog, errors)

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/** Render a string list the way Python's `!r}` formats a `list[str]` —
 * single-quoted elements, comma-space separated (e.g. "['a', 'b']") — so
 * error messages embedding `fd.options` match Python byte-for-byte. */
function pyListRepr(values: string[]): string {
  return `[${values.map((v) => `'${v}'`).join(', ')}]`
}

/** Render a number the way Python formats a Pydantic `float` field (fd.min/
 * fd.max are declared `float | None` in the Python model, so an integral
 * value like 5 always prints as "5.0", never "5"). Only used for fd.min/
 * fd.max — the submitted label `value` keeps its own JS numeric repr,
 * matching Python where `value` is an unvalidated `Any` from the payload. */
function pyFloatRepr(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : `${n}`
}

function validateLabelValue(fd: FieldDef, key: string, value: unknown, errors: ValidationError[]): void {
  if (fd.type === 'choice') {
    validateChoiceValue(fd, key, value, errors)
  } else if (fd.type === 'text') {
    if (typeof value !== 'string') {
      errors.push({
        field: `labels.${key}`,
        message: `Text field '${key}' requires a string value; got '${typeof value}'.`,
      })
    }
  } else if (fd.type === 'scale') {
    validateScaleValue(fd, key, value, errors)
  }
}

function validateChoiceValue(fd: FieldDef, key: string, value: unknown, errors: ValidationError[]): void {
  if (typeof value === 'string') {
    if (fd.options && !fd.options.includes(value)) {
      errors.push({
        field: `labels.${key}`,
        message: `Value '${value}' is not a valid option for field '${key}'; expected one of ${pyListRepr(fd.options)}.`,
      })
    }
    return
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const dict = value as Record<string, unknown>
    if (!fd.note) {
      errors.push({
        field: `labels.${key}`,
        message: `Field '${key}' does not accept note-form dict values (note=false); provide a plain option string instead.`,
      })
      return
    }
    if (!('choice' in dict)) {
      errors.push({ field: `labels.${key}`, message: `${key}: object form requires a 'choice' key` })
      return
    }
    const choice = dict['choice']
    const note = dict['note']
    if (fd.options && !fd.options.includes(choice as string)) {
      errors.push({
        field: `labels.${key}.choice`,
        message: `Choice '${String(choice)}' is not a valid option for field '${key}'; expected one of ${pyListRepr(fd.options)}.`,
      })
    }
    if (note !== undefined && note !== null && typeof note !== 'string') {
      errors.push({
        field: `labels.${key}.note`,
        message: `Note value for field '${key}' must be a string; got '${typeof note}'.`,
      })
    }
    return
  }
  errors.push({
    field: `labels.${key}`,
    message: `Choice field '${key}' requires a string or a {choice, note} dict; got '${typeof value}'.`,
  })
}

function validateScaleValue(fd: FieldDef, key: string, value: unknown, errors: ValidationError[]): void {
  if (typeof value !== 'number') {
    errors.push({
      field: `labels.${key}`,
      message: `Scale field '${key}' requires a numeric value; got '${typeof value}'.`,
    })
    return
  }
  if (fd.min != null && value < fd.min) {
    errors.push({
      field: `labels.${key}`,
      message: `Scale value ${value} for field '${key}' is below minimum ${pyFloatRepr(fd.min)}.`,
    })
  }
  if (fd.max != null && value > fd.max) {
    errors.push({
      field: `labels.${key}`,
      message: `Scale value ${value} for field '${key}' exceeds maximum ${pyFloatRepr(fd.max)}.`,
    })
  }
}

function validateTarget(target: FeedbackTarget, runLog: RunLog | undefined, errors: ValidationError[]): void {
  const scope = target.scope

  if (scope === 'run') return

  const eventRef = target.event_ref ?? null
  if (eventRef === null) {
    errors.push({
      field: 'target.event_ref',
      message: `event_ref is required for scope='${scope}'; provide an index into the run log events list.`,
    })
    return
  }

  const events: RunLogEvent[] = runLog?.events ?? []
  const nEvents = events.length
  if (eventRef < 0 || eventRef >= nEvents) {
    errors.push({
      field: 'target.event_ref',
      message: `event_ref=${eventRef} is out of range; run log has ${nEvents} event(s) (valid indices: 0..${nEvents - 1}).`,
    })
    return
  }

  const event = events[eventRef]
  const actualKind = event.kind

  if (scope === 'decision') {
    if (actualKind !== 'tick') {
      errors.push({
        field: 'target.event_ref',
        message: `scope='decision' requires a TickEvent at event_ref=${eventRef}; found kind='${actualKind}'.`,
      })
    }
  } else if (scope === 'proposal') {
    if (actualKind !== 'tick') {
      errors.push({
        field: 'target.event_ref',
        message: `scope='proposal' requires a TickEvent at event_ref=${eventRef}; found kind='${actualKind}'.`,
      })
    } else {
      const dr = event.trace.decision_result
      if (!(dr.fire_control.fired && dr.proposal !== null)) {
        errors.push({
          field: 'target.event_ref',
          message:
            `scope='proposal' requires a TickEvent with a fired proposal at event_ref=${eventRef}; `
            + 'the decision at this tick did not fire a proposal (fire_control.fired=false or proposal=null).',
        })
      }
    }
  } else if (scope === 'action') {
    if (actualKind !== 'action') {
      errors.push({
        field: 'target.event_ref',
        message: `scope='action' requires an ActionEvent at event_ref=${eventRef}; found kind='${actualKind}'.`,
      })
    }
  }
}

// ---------------------------------------------------------------------------
// appendFeedback
// ---------------------------------------------------------------------------

/**
 * Build a FeedbackEvent from a submission body and append it to the run's
 * evidence log via run_manager.appendFeedback (append-only; NEVER touches a
 * prior event, the adapter, or the tick engine).
 *
 * @throws RunNotFoundError (from run_manager) if runId is not in the active
 *   registry.
 */
export async function appendFeedback(runId: string, body: FeedbackSubmitBody): Promise<FeedbackEvent> {
  const event: FeedbackEvent = {
    kind: 'feedback',
    target: body.target,
    labels: body.labels ?? {},
    comment: body.comment ?? null,
  }
  await runManagerAppendFeedback(runId, event)
  return event
}
