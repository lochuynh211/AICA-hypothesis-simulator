/**
 * Pure Markdown formatter for the §14.2 evidence report. Ported from
 * `app/api/aica_api/services/evidence_markdown.py` (`render_evidence_markdown`),
 * behavior-of-record — EXACT string output (byte-for-byte), including every
 * newline/heading/bullet, is the parity contract for this module.
 *
 * Design constraints (mirrors the Python docstring):
 *   - renderEvidenceMarkdown(report) -> string: takes the SAME object
 *     returned by buildEvidenceReport and formats it as human-readable
 *     Markdown.
 *   - Hand-rolled string building only — NO markdown/template library.
 *   - Facts vs Human-Review separation invariant preserved:
 *       ## Simulator Facts  — objective recorded facts; no feedback values.
 *       ## Human Review     — feedback labels + free-text comments only.
 *   - NEVER a verdict: the output presents facts and, separately, the
 *     human's recorded feedback. It never claims the algorithm was right or
 *     wrong.
 *   - Deterministic ordering: sections rendered in a fixed, documented order.
 *   - Profile overrides (driver_profile / vehicle_profile from the RunLog,
 *     set by the Profile Editor) appear under ## Simulator Facts as
 *     objective run setup.
 */
import type { EvidenceReport } from '../../api/types'

// ── Private helpers ─────────────────────────────────────────────────────────

/** Convert any value to a safe inline string for Markdown. Mirrors Python's
 * `_safe_str`: None -> "N/A", bool -> "true"/"false" (lowercase, Python's
 * `str(value).lower()`), number/string as-is, everything else -> compact
 * JSON (no pretty-printing in line context, matching
 * `json.dumps(value, ensure_ascii=False, separators=(",", ":"))`). */
function safeStr(value: unknown): string {
  if (value === null || value === undefined) return 'N/A'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** Render a single ``- **key**: value`` bullet line. */
function kv(key: string, value: unknown): string {
  return `- **${key}**: ${safeStr(value)}\n`
}

/** Render each k/v of a dict as bullet lines, with an optional indent prefix. */
function dictBullets(d: Record<string, unknown>, indent = ''): string[] {
  const lines: string[] = []
  for (const [k, v] of Object.entries(d)) {
    lines.push(`${indent}- ${k}: ${safeStr(v)}\n`)
  }
  return lines
}

// ── Hyperparameters: Python float-vs-int rendering ──────────────────────────
//
// `HyperparameterDef.default` is typed `Any` in Python
// (models/package.py:72, `# str (band), bool, or float (numeric)`) and flows
// through `dict[str, Any]`-typed fields all the way to
// `RunLog.initial_hyperparameters`/`current_hyperparameters` — nothing on
// that path coerces types, so whatever numeric type the JSON manifest
// literal parsed to (Python `int` for `3`, `float` for `20.0`) is exactly
// what `_safe_str`'s `str(value)` renders. JS's `JSON.parse` collapses both
// `3` and `20.0` to the same `number`, losing that distinction — a real
// byte-for-byte divergence for every numeric hyperparameter default written
// as a whole number in the manifest (`json.loads("20.0") == 20.0`, whose
// `str()` is `"20.0"`; `JSON.parse("20.0") === 20`, whose default JS
// rendering is `"20"`).
//
// `ParameterDef.default` is `str | bool` (models/package.py:44) — parameters
// are NEVER numeric, so this does not apply to the Parameters section.
//
// The bundled packages' manifests are NOT uniformly float: two numeric
// hyperparameter keys are genuinely declared as Python `int` literals (no
// decimal point) rather than `float` —
// `packages/nri_fatigue_score_v1/package.json`'s `max_proposals_per_30min`
// (3) and `persistence_ticks` (2), and
// `packages/aica_transparent_hybrid_trigger_v1/package.json`'s
// `max_proposals_per_30min` (3), `rest_persistence_ticks` (2), and
// `monotony_persistence_ticks` (3) — confirmed by reading the actual JSON
// literals in both manifests (not guessed). Blindly float-formatting every
// numeric hyperparameter would turn Python's `"3"`/`"2"` into `"3.0"`/
// `"2.0"`, introducing a NEW divergence. So — mirroring the
// `PROFILE_SUBMODEL_INT_FIELDS` pattern below — the known genuinely-`int`
// hyperparameter keys are hardcoded per package id here; every other
// numeric hyperparameter value renders as a Python float (`pyFloatStr`),
// matching the `HyperparameterDef` docstring's documented convention.
const HYPERPARAMETER_INT_KEYS: Record<string, Set<string>> = {
  nri_fatigue_score_v1: new Set(['max_proposals_per_30min', 'persistence_ticks']),
  aica_transparent_hybrid_trigger_v1: new Set([
    'max_proposals_per_30min',
    'rest_persistence_ticks',
    'monotony_persistence_ticks',
  ]),
}

/** Format a number the way Python's `str(float)` renders a whole-number
 * float — always keeps a `.0` suffix (`20` -> `"20.0"`); a non-integral
 * value uses its normal decimal form (`0.5` -> `"0.5"`), matching JS's
 * default shortest round-trip representation for the simple decimal
 * fractions the bundled manifests use. */
function pyFloatStr(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

/** Render each k/v of a hyperparameters dict as bullet lines. Every value
 * that is a JS `number` corresponds to a Python `HyperparameterDef.default`
 * of kind `numeric` — a Python `float` UNLESS its key is a known genuine
 * `int` for this package (see `HYPERPARAMETER_INT_KEYS`); band/string and
 * bool values are unaffected (rendered exactly as `dictBullets` would).
 * Scoped ONLY to the Hyperparameters sections — parameters, profiles,
 * route, timeline, etc. keep generic `dictBullets`/`safeStr` formatting. */
function hyperparameterBullets(d: Record<string, unknown>, packageId: string): string[] {
  const intKeys = HYPERPARAMETER_INT_KEYS[packageId] ?? new Set<string>()
  const lines: string[] = []
  for (const [k, v] of Object.entries(d)) {
    const vs = typeof v === 'number' && !intKeys.has(k) ? pyFloatStr(v) : safeStr(v)
    lines.push(`- ${k}: ${vs}\n`)
  }
  return lines
}

// ── Python float-vs-int JSON rendering (driver_profile / vehicle_profile) ───
//
// JSON has no int/float distinction, so a JS number parsed from
// `"short_rest_drowsiness_recovery": 20.0` is indistinguishable from `20`.
// Python's `_safe_str` re-serializes nested dict values with
// `json.dumps(...)`, which DOES preserve the origin Pydantic field's float
// type (e.g. `20.0`, never `20`) — a real byte-for-byte divergence risk for
// every numeric field in `app/api/aica_api/models/profile.py`'s
// DrowsinessModel/FatigueModel/AttentionModel/RecoveryModel (driver_profile)
// and SteeringInstabilityProfile/LaneDepartureProfile/PedalAbnormalityProfile/
// AdasWarningProfile (vehicle_profile) sub-models — EVERY field in those 8
// sub-models is declared `float` except the two explicitly listed below
// (`int`). This is hardcoded from that module's actual field declarations
// (not guessed), and scoped ONLY to these two known, fixed, closed-schema
// report sections — every other dict_bullets() call site (parameters,
// hyperparameters, speed_profile, profile_overrides) keeps generic
// `safeStr`/JSON.stringify formatting, matching Python's untyped
// `dict[str, Any]` fields there (no reliable float/int distinction exists to
// recover in that generic case either side of the port).
const PROFILE_SUBMODEL_INT_FIELDS: Record<string, Set<string>> = {
  drowsiness_model: new Set(),
  fatigue_model: new Set(),
  attention_model: new Set(),
  recovery_model: new Set(),
  steering_instability: new Set(),
  lane_departure: new Set(['count_when_threshold_exceeded']),
  pedal_abnormality: new Set(),
  adas_warning: new Set(),
}

/** Format a number the way Python's `json.dumps` renders a `float` field —
 * an integral value always keeps a `.0` (e.g. `20` -> `"20.0"`); a
 * non-integral value uses its normal decimal form (matches JS's default
 * shortest round-trip representation for the simple decimal fractions these
 * profile fields use, e.g. `0.25`, `0.05`). */
function pyFloatJson(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

/** Compact JSON-dump a driver_profile/vehicle_profile sub-model dict
 * (drowsiness_model, steering_instability, ...), rendering each numeric leaf
 * as a Python float (`.0` suffix when integral) unless its key is a known
 * `int` field for that sub-model (see PROFILE_SUBMODEL_INT_FIELDS). Matches
 * `json.dumps(value, ensure_ascii=False, separators=(",", ":"))`'s no-space
 * compact form for everything else (strings, bools, lists). */
function dumpProfileSubmodel(submodelKey: string, value: Record<string, unknown>): string {
  const intFields = PROFILE_SUBMODEL_INT_FIELDS[submodelKey] ?? new Set<string>()
  const parts: string[] = []
  for (const [k, v] of Object.entries(value)) {
    let vs: string
    if (typeof v === 'number') {
      vs = intFields.has(k) ? String(v) : pyFloatJson(v)
    } else {
      vs = JSON.stringify(v)
    }
    parts.push(`${JSON.stringify(k)}:${vs}`)
  }
  return `{${parts.join(',')}}`
}

/** Render each k/v of driver_profile/vehicle_profile as bullet lines, using
 * `dumpProfileSubmodel` for the known nested sub-model dict values (see
 * above) and generic `safeStr` for everything else (e.g. the top-level `id`
 * string field). */
function profileDictBullets(d: Record<string, unknown>): string[] {
  const lines: string[] = []
  for (const [k, v] of Object.entries(d)) {
    if (k in PROFILE_SUBMODEL_INT_FIELDS && v !== null && typeof v === 'object' && !Array.isArray(v)) {
      lines.push(`- ${k}: ${dumpProfileSubmodel(k, v as Record<string, unknown>)}\n`)
    } else {
      lines.push(`- ${k}: ${safeStr(v)}\n`)
    }
  }
  return lines
}

/** Format a value the way Python's `_safe_str` formats a known Pydantic
 * `float` field (e.g. `RouteFacts.total_route_distance_km`): null -> "N/A",
 * an integral value keeps a `.0` suffix, matching `pyFloatJson` above. */
function safeFloatStr(value: unknown): string {
  if (value === null || value === undefined) return 'N/A'
  if (typeof value === 'number') return pyFloatJson(value)
  return safeStr(value)
}

/** Render free-text as a Markdown blockquote, neutralizing embedded structure.
 *
 * Every line is prefixed with `> `, which prevents any embedded `## heading`,
 * list marker, code fence, or other Markdown structure from becoming real
 * document structure. An empty or null/undefined input renders as a single
 * `> (empty)` line. */
function asBlockquote(text: string | null | undefined): string {
  if (!text) return '> (empty)\n'
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n') + '\n'
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Render a §14.2 evidence report to a human-readable Markdown string.
 *
 * The caller passes the object returned by `buildEvidenceReport` — this
 * function only formats it; it never re-reads the run or recomputes
 * decisions.
 *
 * Section layout:
 *   # Evidence Report: {run_id}         <- title + top-level metadata
 *   ## Simulator Facts                   <- objective recorded facts
 *     ### Run Mode
 *     ### Route
 *     ### Parameters
 *     ### Hyperparameters
 *     ### Profiles        <- driver/vehicle profiles (U5 overrides stored here)
 *     ### Event Plan
 *     ### Timeline Highlights
 *     ### Algorithm Errors
 *   ## Human Review                      <- feedback only; never facts
 *     ### Feedback Labels
 *     ### Free-Text Comments
 *
 * Always contains both `## Simulator Facts` and `## Human Review` sections,
 * even when the run has no feedback.
 */
export function renderEvidenceMarkdown(report: EvidenceReport): string {
  const lines: string[] = []
  const r = report as unknown as Record<string, unknown>

  // ── Title + top-level metadata ──────────────────────────────────────────
  const runId = (r.run_id as string | undefined) ?? ''
  lines.push(`# Evidence Report: ${runId}\n\n`)

  lines.push(kv('Report ID', r.report_id))
  lines.push(kv('Run ID', runId))
  lines.push(kv('Timestamp', r.timestamp))
  lines.push(kv('UI Language', r.ui_language))
  lines.push(kv('Simulator Version', r.simulator_version))

  const pkg = (r.package as Record<string, unknown> | null | undefined) ?? {}
  lines.push(kv('Package', `${pkg.id ?? ''} v${pkg.version ?? ''}`))

  const sc = (r.scenario as Record<string, unknown> | null | undefined) ?? {}
  lines.push(kv('Scenario', `${sc.id ?? ''} v${sc.version ?? ''}`))

  lines.push('\n')

  // ── ## Simulator Facts ───────────────────────────────────────────────────
  // NOTE: feedback values are NEVER written below this heading.
  // All feedback appears exclusively under ## Human Review.
  lines.push('## Simulator Facts\n\n')

  const sf = (r.simulator_facts as Record<string, unknown> | null | undefined) ?? {}

  // ── Run mode / status ─────────────────────────────────────────────────────
  lines.push('### Run Mode\n\n')
  lines.push(kv('run_mode', sf.run_mode))
  lines.push(kv('evidence_status', sf.evidence_status))
  lines.push('\n')

  // ── Route ───────────────────────────────────────────────────────────────
  lines.push('### Route\n\n')
  const routeSnapshot = sf.route_snapshot
  if (routeSnapshot !== null && routeSnapshot !== undefined && typeof routeSnapshot === 'object' && !Array.isArray(routeSnapshot)) {
    const rs = routeSnapshot as Record<string, unknown>
    lines.push(kv('summary', rs.summary))
    lines.push(kv('start', rs.start_label))
    lines.push(kv('end', rs.end_label))
  } else {
    lines.push('- Local/deterministic route (no Maps snapshot)\n')
  }

  const routeFacts = sf.route_facts
  if (routeFacts !== null && routeFacts !== undefined && typeof routeFacts === 'object' && !Array.isArray(routeFacts)) {
    const rf = routeFacts as Record<string, unknown>
    lines.push(`- **total_route_distance_km**: ${safeFloatStr(rf.total_route_distance_km)}\n`)
    lines.push(kv('estimated_duration_seconds', rf.estimated_duration_seconds))
    lines.push(kv('route_source', rf.route_source))
  }
  lines.push('\n')

  // ── Parameters ─────────────────────────────────────────────────────────
  lines.push('### Parameters\n\n')
  const initialParams = (sf.initial_parameters as Record<string, unknown> | null | undefined) ?? {}
  if (initialParams && Object.keys(initialParams).length > 0) {
    lines.push('**Initial Parameters:**\n\n')
    lines.push(...dictBullets(initialParams))
  } else {
    lines.push('- (no parameters)\n')
  }

  const finalParams = sf.final_parameters
  if (finalParams !== null && finalParams !== undefined && typeof finalParams === 'object' && !Array.isArray(finalParams) && Object.keys(finalParams as object).length > 0) {
    lines.push('\n**Final Parameters (changed during run):**\n\n')
    lines.push(...dictBullets(finalParams as Record<string, unknown>))
  }
  lines.push('\n')

  // ── Hyperparameters ────────────────────────────────────────────────────
  lines.push('### Hyperparameters\n\n')
  const packageId = (pkg.id as string | undefined) ?? ''
  const initialHyper = (sf.initial_hyperparameters as Record<string, unknown> | null | undefined) ?? {}
  if (initialHyper && Object.keys(initialHyper).length > 0) {
    lines.push('**Initial Hyperparameters:**\n\n')
    lines.push(...hyperparameterBullets(initialHyper, packageId))
  } else {
    lines.push('- (no hyperparameters)\n')
  }

  const finalHyper = sf.final_hyperparameters
  if (finalHyper !== null && finalHyper !== undefined && typeof finalHyper === 'object' && !Array.isArray(finalHyper) && Object.keys(finalHyper as object).length > 0) {
    lines.push('\n**Final Hyperparameters (changed during run):**\n\n')
    lines.push(...hyperparameterBullets(finalHyper as Record<string, unknown>, packageId))
  }
  lines.push('\n')

  // ── Profiles (driver + vehicle + speed) — U5 profile overrides stored here ──
  lines.push('### Profiles\n\n')

  const driver = sf.driver_profile
  if (driver !== null && driver !== undefined && typeof driver === 'object' && !Array.isArray(driver) && Object.keys(driver as object).length > 0) {
    lines.push('**Driver Profile:**\n\n')
    lines.push(...profileDictBullets(driver as Record<string, unknown>))
  } else {
    lines.push('- driver_profile: not recorded (pre-M5 run)\n')
  }

  const vehicle = sf.vehicle_profile
  if (vehicle !== null && vehicle !== undefined && typeof vehicle === 'object' && !Array.isArray(vehicle) && Object.keys(vehicle as object).length > 0) {
    lines.push('\n**Vehicle Profile:**\n\n')
    lines.push(...profileDictBullets(vehicle as Record<string, unknown>))
  } else {
    lines.push('\n- vehicle_profile: not recorded (pre-M5 run)\n')
  }

  const speed = sf.speed_profile
  if (speed !== null && speed !== undefined && typeof speed === 'object' && !Array.isArray(speed) && Object.keys(speed as object).length > 0) {
    lines.push('\n**Speed Profile:**\n\n')
    lines.push(...dictBullets(speed as Record<string, unknown>))
  } else {
    lines.push('\n- speed_profile: not recorded (pre-M5 run)\n')
  }

  const overrides = sf.profile_overrides
  if (overrides !== null && overrides !== undefined && typeof overrides === 'object' && !Array.isArray(overrides) && Object.keys(overrides as object).length > 0) {
    lines.push('\n**Profile Overrides (fields overridden from defaults):**\n\n')
    lines.push(...dictBullets(overrides as Record<string, unknown>))
  } else {
    lines.push('\n- profile_overrides: no override applied\n')
  }
  lines.push('\n')

  // ── Event Plan ────────────────────────────────────────────────────────────
  lines.push('### Event Plan\n\n')
  const eventPlan = sf.event_plan
  let ticks: unknown[] = []
  if (eventPlan !== null && eventPlan !== undefined && typeof eventPlan === 'object' && !Array.isArray(eventPlan)) {
    ticks = ((eventPlan as Record<string, unknown>).ticks as unknown[] | null | undefined) ?? []
  }
  lines.push(kv('total_ticks', ticks.length))
  lines.push('\n')

  // ── Timeline Highlights ───────────────────────────────────────────────────
  // Only proposals fired + actions recorded; not the full decision trace.
  lines.push('### Timeline Highlights\n\n')

  const proposalEvents = (sf.proposal_events as unknown[] | null | undefined) ?? []
  if (proposalEvents.length > 0) {
    lines.push(`**Proposals fired (${proposalEvents.length}):**\n\n`)
    for (const pe of proposalEvents) {
      const p = pe as Record<string, unknown>
      const tickIdx = p.tick_index ?? '?'
      // Proposal id is nested in trace.decision_result.proposal.id
      const trace = (p.trace as Record<string, unknown> | null | undefined) ?? {}
      const dr = (trace.decision_result as Record<string, unknown> | null | undefined) ?? {}
      const proposal = (dr.proposal as Record<string, unknown> | null | undefined) ?? {}
      const propId = (proposal && typeof proposal === 'object' ? proposal.id : null) ?? 'unknown'
      lines.push(`- tick ${safeStr(tickIdx)}: proposal \`${safeStr(propId)}\` fired\n`)
    }
  } else {
    lines.push('- No proposals fired during this run.\n')
  }

  const actions = (sf.actions as unknown[] | null | undefined) ?? []
  if (actions.length > 0) {
    lines.push(`\n**Actions taken (${actions.length}):**\n\n`)
    for (const ae of actions) {
      const a = ae as Record<string, unknown>
      const tickIdx = a.tick_index ?? '?'
      const actionName = a.action ?? '?'
      const status = a.resulting_status ?? '?'
      lines.push(`- tick ${safeStr(tickIdx)}: \`${safeStr(actionName)}\` → ${safeStr(status)}\n`)
    }
  } else {
    lines.push('\n- No actions taken during this run.\n')
  }
  lines.push('\n')

  // ── Algorithm Errors ──────────────────────────────────────────────────────
  lines.push('### Algorithm Errors\n\n')
  const algErrors = (sf.algorithm_errors as unknown[] | null | undefined) ?? []
  if (algErrors.length > 0) {
    for (const err of algErrors) {
      const e = err as Record<string, unknown>
      const tickIdx = e.tick_index ?? '?'
      const errType = e.error_type ?? '?'
      const msg = (e.message as string | null | undefined) ?? ''
      // Render the user-supplied error message as a blockquote so embedded
      // Markdown structure (e.g. "## Human Review") is quoted text, not a heading.
      lines.push(`- tick ${safeStr(tickIdx)}: [${safeStr(errType)}]\n\n`)
      lines.push(asBlockquote(msg))
      lines.push('\n')
    }
  } else {
    lines.push('- No algorithm errors recorded.\n')
  }
  lines.push('\n')

  // ── ## Human Review ───────────────────────────────────────────────────────
  // This section contains ONLY human feedback values.
  // It NEVER repeats simulator facts; it NEVER claims a verdict.
  lines.push('## Human Review\n\n')

  const hr = (r.human_review as Record<string, unknown> | null | undefined) ?? {}
  const feedbackLabels = (hr.feedback_labels as unknown[] | null | undefined) ?? []
  const freeTextComments = (hr.free_text_comments as unknown[] | null | undefined) ?? []

  // ── Feedback Labels ────────────────────────────────────────────────────
  lines.push('### Feedback Labels\n\n')
  if (feedbackLabels.length > 0) {
    for (const entry of feedbackLabels) {
      const en = entry as Record<string, unknown>
      const target = (en.target as Record<string, unknown> | null | undefined) ?? {}
      const scope = target.scope ?? '?'
      const tickIdx = target.tick_index
      const eventRef = target.event_ref
      const labels = (en.labels as Record<string, unknown> | null | undefined) ?? {}

      const targetParts = [`scope=${safeStr(scope)}`]
      if (tickIdx !== null && tickIdx !== undefined) targetParts.push(`tick=${safeStr(tickIdx)}`)
      if (eventRef !== null && eventRef !== undefined) targetParts.push(`event_ref=${safeStr(eventRef)}`)
      const targetStr = targetParts.join(', ')

      lines.push(`- **${targetStr}**:\n`)
      for (const [labelKey, labelVal] of Object.entries(labels)) {
        lines.push(`  - ${labelKey}: ${safeStr(labelVal)}\n`)
      }
    }
  } else {
    lines.push('- (no feedback labels)\n')
  }
  lines.push('\n')

  // ── Free-Text Comments ────────────────────────────────────────────────────
  lines.push('### Free-Text Comments\n\n')
  if (freeTextComments.length > 0) {
    for (const entry of freeTextComments) {
      const en = entry as Record<string, unknown>
      const target = (en.target as Record<string, unknown> | null | undefined) ?? {}
      const scope = target.scope ?? '?'
      const tickIdx = target.tick_index
      const comment = (en.comment as string | null | undefined) ?? ''

      const targetParts = [`scope=${safeStr(scope)}`]
      if (tickIdx !== null && tickIdx !== undefined) targetParts.push(`tick=${safeStr(tickIdx)}`)
      const targetStr = targetParts.join(', ')

      // Render the reviewer-supplied comment as a blockquote so embedded
      // Markdown structure (e.g. "## Simulator Facts") is quoted text, not
      // a heading that could forge document structure.
      lines.push(`- **${targetStr}**:\n\n`)
      lines.push(asBlockquote(comment))
      lines.push('\n')
    }
  } else {
    lines.push('- (no free-text comments)\n')
  }
  lines.push('\n')

  return lines.join('')
}
