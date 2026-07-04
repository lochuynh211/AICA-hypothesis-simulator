import { useEffect, useState, type ChangeEvent } from 'react'
import { useRunStore } from '../../state/runStore'
import { getPackage } from '../../api/client'
import type { HyperparameterDef, PackageManifest, SetupValue } from '../../api/types'
import { t } from '../../i18n/t'
import PackageSelector from './PackageSelector'
import { formulaOutputLabel, formulaTokenLabel } from './signalLabels'
import {
  getFormulationTemplate,
  templateHyperparameterKeys,
  type ExplainedStep,
  type FormulaLine,
  type FormulaPart,
  type FormulationSection,
  type ThresholdRead,
} from './formulationTemplates'

/**
 * AlgorithmFormulationPanel (feature 009, FE3 + UX-FE1) — right editor panel
 * of the new setup screen (others/aica_setup_screen_uiux.md "Right panel —
 * Algorithm as formulation").
 *
 * Layout:
 *   1. PackageSelector — moved here from SignalsPanel (UX-FE1): the algorithm
 *      choice belongs next to its own formulation, not the scenario/signals
 *      editor. Rendered unconditionally at the top (before a package is even
 *      selected) so it doubles as the entry point for picking one.
 *   2. The selected package's algorithm as its own math: feature definitions,
 *      hyperparameters as inline editable `[coefficient]` fields inside the
 *      formula they belong to, and scores reading down to their fire
 *      thresholds — per-package structure comes from the static
 *      `formulationTemplates.ts` data file (§5 Hybrid / §6 NRI).
 *
 * Contract (no props — store-driven, matching every other setup/* editor):
 *   Reads: selectedPackageId, editedHyperparameters, highlightedSignalKey.
 *   Dispatches:
 *     - SET_HYPERPARAMETER — editing an inline coefficient. Always dispatched
 *       (with the manifest `default` attached) so the reducer can decide
 *       whether to store the override or remove a stale one when the value
 *       is reverted back to the default (see the FE4 fix in
 *       state/runStore.ts's SET_HYPERPARAMETER reducer case). This keeps
 *       `selectOverridesDiff`'s "N overrides" chip — and the verbatim
 *       `hyperparameter_overrides` payload useRunPreview sends — accurate.
 *     - SET_HIGHLIGHTED_SIGNAL — on hover AND click of a feature/signal name
 *       cross-link, so SignalsPanel can mirror the highlight.
 *   Fetches (own effect): getPackage(selectedPackageId) for the manifest.
 */
export default function AlgorithmFormulationPanel() {
  const { state, dispatch } = useRunStore()
  const { selectedPackageId, editedHyperparameters, highlightedSignalKey, uiLanguage } = state
  const [manifest, setManifest] = useState<PackageManifest | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!selectedPackageId) {
      setManifest(null)
      return
    }
    let cancelled = false
    getPackage(selectedPackageId)
      .then((pkg) => {
        if (!cancelled) setManifest(pkg)
      })
      .catch(() => {
        if (!cancelled) setManifest(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedPackageId])

  function highlight(key: string) {
    dispatch({ type: 'SET_HIGHLIGHTED_SIGNAL', key })
  }
  function unhighlight() {
    dispatch({ type: 'SET_HIGHLIGHTED_SIGNAL', key: null })
  }
  function toggleSection(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const defsByKey: Record<string, HyperparameterDef> = {}
  for (const def of manifest?.hyperparameters ?? []) defsByKey[def.key] = def

  const ctx: FormulaCtx = {
    defsByKey,
    editedHyperparameters,
    highlightedSignalKey,
    uiLanguage,
    dispatch,
    highlight,
    unhighlight,
  }

  const template = manifest ? getFormulationTemplate(manifest.id) : null

  return (
    <div data-testid="algorithm-formulation-panel">
      <PackageSelector />
      {!selectedPackageId || !manifest ? (
        <div style={{ fontSize: '0.85em', color: '#6b7280' }}>Select a package to view its formulation.</div>
      ) : template ? (
        <FormulationTemplateView
          template={template}
          manifest={manifest}
          ctx={ctx}
          collapsed={collapsed}
          onToggle={toggleSection}
        />
      ) : (
        <FallbackHyperparameterList manifest={manifest} ctx={ctx} />
      )}
    </div>
  )
}

// ── Rendering context threaded through every part/coef/link ────────────────

type FormulaCtx = {
  defsByKey: Record<string, HyperparameterDef>
  editedHyperparameters: Record<string, SetupValue>
  highlightedSignalKey: string | null
  uiLanguage: 'ja' | 'en'
  dispatch: ReturnType<typeof useRunStore>['dispatch']
  highlight: (key: string) => void
  unhighlight: () => void
}

// ── Template-driven view (Hybrid / NRI) ─────────────────────────────────────

function FormulationTemplateView({
  template,
  manifest,
  ctx,
  collapsed,
  onToggle,
}: {
  template: ReturnType<typeof getFormulationTemplate>
  manifest: PackageManifest
  ctx: FormulaCtx
  collapsed: Set<string>
  onToggle: (id: string) => void
}) {
  if (!template) return null

  // Safety net: any manifest hyperparameter the hand-authored template forgot
  // to reference is still shown (under "Other"), so nothing silently
  // disappears from the editable surface.
  const usedKeys = templateHyperparameterKeys(template)
  const leftover = (manifest.hyperparameters ?? []).filter((d) => !usedKeys.has(d.key))
  const sections: FormulationSection[] =
    leftover.length > 0
      ? [...template.sections, { id: 'other', title: 'Other', extraHyperparameters: leftover.map((d) => d.key) }]
      : template.sections

  return (
    <div data-testid="algorithm-formulation-template">
      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.id)
        return (
          <div
            key={section.id}
            data-testid={`formulation-section-${section.id}`}
            style={{ marginBottom: '10px', borderBottom: '1px solid #e5e7eb', paddingBottom: '6px' }}
          >
            <button
              type="button"
              data-testid={`formulation-section-toggle-${section.id}`}
              onClick={() => onToggle(section.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                padding: '2px 0',
                fontSize: '0.78em',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#374151',
              }}
            >
              <span>{isCollapsed ? '▸' : '▾'}</span>
              <span>{section.title}</span>
            </button>
            {!isCollapsed && (
              <div style={{ marginTop: '4px' }}>
                {(section.lines ?? []).map((line) => (
                  <FormulaLineView key={line.output} line={line} ctx={ctx} />
                ))}
                {(section.thresholdReads ?? []).map((read) => (
                  <ThresholdReadView key={read.scoreName} read={read} ctx={ctx} />
                ))}
                {(section.steps ?? []).map((step, i) => (
                  <StepView key={i} step={step} sectionId={section.id} index={i} ctx={ctx} />
                ))}
                {section.extraHyperparameters && section.extraHyperparameters.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
                    {section.extraHyperparameters.map((key) => (
                      <ExtraHyperparameterView key={key} keyName={key} ctx={ctx} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function FormulaLineView({ line, ctx }: { line: FormulaLine; ctx: FormulaCtx }) {
  // The output name IS a cross-link target: hovering it highlights this quantity
  // everywhere it's referenced, and the line highlights when any reference to it
  // is hovered — wiring the formulation to its own features (both directions).
  const highlighted = ctx.highlightedSignalKey === line.output
  const [binOpen, setBinOpen] = useState(false)
  return (
    <div
      data-testid={`formula-line-${line.output}`}
      data-highlighted={highlighted ? 'true' : 'false'}
      style={{
        fontFamily: 'monospace',
        fontSize: '0.82em',
        color: '#1f2937',
        margin: '3px 0',
        lineHeight: 1.6,
        borderRadius: '3px',
        background: highlighted ? '#eef2ff' : 'transparent',
      }}
    >
      <LinkSpan signalKey={line.output} text={formulaOutputLabel(line.output, ctx.uiLanguage)} ctx={ctx} bold />{' '}
      = {renderParts(line.parts, ctx)}
      {line.binInfo && (
        <span style={{ position: 'relative', display: 'inline-block', marginLeft: '4px' }}>
          <button
            type="button"
            data-testid={`formula-bin-info-${line.output}`}
            aria-label={`Bands for ${formulaOutputLabel(line.output, ctx.uiLanguage)}`}
            aria-expanded={binOpen}
            onClick={() => setBinOpen((o) => !o)}
            style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#6b7280', fontSize: '1em', lineHeight: 1, padding: 0, verticalAlign: 'middle' }}
          >
            ⓘ
          </button>
          {binOpen && (
            <div
              role="tooltip"
              data-testid={`formula-bin-bands-${line.output}`}
              style={{
                position: 'absolute',
                zIndex: 10,
                top: '100%',
                left: 0,
                marginTop: '4px',
                width: '210px',
                padding: '8px 10px',
                background: '#111827',
                color: '#f9fafb',
                fontSize: '0.85em',
                lineHeight: 1.5,
                borderRadius: '6px',
                boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
              }}
            >
              <div style={{ marginBottom: '4px', color: '#d1d5db' }}>{t(line.binInfo.input, ctx.uiLanguage)}</div>
              {line.binInfo.bands.map((b) => (
                <div key={b.when} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px' }}>
                  <span>{b.when}</span>
                  <span style={{ fontWeight: 700 }}>→ {b.value}</span>
                </div>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  )
}

function ThresholdReadView({ read, ctx }: { read: ThresholdRead; ctx: FormulaCtx }) {
  const scoreKey = read.scoreKey ?? read.scoreName
  return (
    <div
      data-testid={`formula-threshold-${read.scoreName}`}
      style={{ fontSize: '0.8em', color: '#4b5563', margin: '5px 0' }}
    >
      {/* Header names the exact score each threshold is compared against, and
          links to its definition line above. */}
      <div style={{ marginBottom: '3px' }}>
        <LinkSpan signalKey={scoreKey} text={formulaOutputLabel(scoreKey, ctx.uiLanguage)} ctx={ctx} bold />{' '}
        <span style={{ color: '#6b7280' }}>{t({ en: 'is compared to:', ja: 'を以下と比較:' }, ctx.uiLanguage)}</span>
      </div>
      {read.steps.map((step) => (
        <div
          key={step.coef}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', margin: '2px 0 2px 8px', flexWrap: 'wrap' }}
        >
          <span style={{ fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            ≥ <CoefField keyName={step.coef} ctx={ctx} /> →
          </span>
          <span style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: '0.9em', color: '#4b5563' }}>
            {step.label}
          </span>
          {step.meaning && <span style={{ color: '#6b7280' }}>— {t(step.meaning, ctx.uiLanguage)}</span>}
        </div>
      ))}
    </div>
  )
}

function StepView({
  step,
  sectionId,
  index,
  ctx,
}: {
  step: ExplainedStep
  sectionId: string
  index: number
  ctx: FormulaCtx
}) {
  return (
    <div
      data-testid={`formulation-step-${sectionId}-${index}`}
      style={{ margin: '5px 0', paddingLeft: '2px', borderLeft: '2px solid #e5e7eb', paddingBottom: '2px' }}
    >
      <div style={{ fontSize: '0.78em', color: '#374151', lineHeight: 1.45, paddingLeft: '6px' }}>
        {t(step.text, ctx.uiLanguage)}
      </div>
      {step.equation && (
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: '0.78em',
            color: '#1f2937',
            background: '#f3f4f6',
            borderRadius: '4px',
            padding: '3px 6px',
            margin: '3px 0 0 6px',
            display: 'inline-block',
          }}
        >
          {step.equation}
        </div>
      )}
      {step.checks && step.checks.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', margin: '3px 0 0 12px' }}>
          {step.checks.map((check, i) => (
            <div
              key={i}
              style={{ display: 'flex', alignItems: 'center', gap: '5px', flexWrap: 'wrap', fontSize: '0.74em', color: '#4b5563' }}
            >
              <span>{t(check.operand, ctx.uiLanguage)}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{check.op}</span>
              <CoefField keyName={check.coef} ctx={ctx} />
              <span style={{ color: '#9ca3af' }}>→</span>
              <span style={{ color: '#6b7280' }}>{t(check.outcome, ctx.uiLanguage)}</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', margin: '3px 0 0 6px' }}>
          {(step.coefs ?? []).map((key) => {
            const def = ctx.defsByKey[key]
            return (
              <span
                key={key}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.74em', color: '#6b7280' }}
              >
                <span>{def ? t(def.label, ctx.uiLanguage) : key}</span>
                <CoefField keyName={key} ctx={ctx} />
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ExtraHyperparameterView({ keyName, ctx }: { keyName: string; ctx: FormulaCtx }) {
  const def = ctx.defsByKey[keyName]
  return (
    <div style={{ fontSize: '0.78em', color: '#4b5563' }}>
      <div style={{ color: '#6b7280' }}>{def ? t(def.label, ctx.uiLanguage) : keyName}</div>
      <CoefField keyName={keyName} ctx={ctx} />
    </div>
  )
}

// ── Formula part rendering (text / coef / link) ─────────────────────────────

function renderParts(parts: FormulaPart[], ctx: FormulaCtx) {
  return parts.map((part, idx) => {
    if ('coef' in part) return <CoefField key={idx} keyName={part.coef} ctx={ctx} />
    if ('link' in part) {
      // Cross-link token. Display is the localized label of the quantity it
      // points at — a raw signal ('isNight', 'drowsiness') or a computed feature
      // ('env_load', 'driving_anomaly'), both bilingual via formulaTokenLabel.
      // `part.text` overrides the label-lookup KEY (not the literal text): a
      // registered alias localizes ('child_passenger' → "Child Passenger"); an
      // unregistered descriptor ('highway'/'monotonous') falls back to itself.
      const raw = part.text ?? part.link
      const label = formulaTokenLabel(raw, ctx.uiLanguage)
      return <LinkSpan key={idx} signalKey={part.link} text={label} ctx={ctx} />
    }
    return <span key={idx}>{part.text}</span>
  })
}

function CoefField({ keyName, ctx }: { keyName: string; ctx: FormulaCtx }) {
  const def = ctx.defsByKey[keyName]
  const edited = ctx.editedHyperparameters[keyName]
  const effectiveValue = def ? (edited !== undefined ? edited : def.default) : ''

  // Hooks are called unconditionally (before the `!def` early return below)
  // to satisfy the Rules of Hooks — this component is invoked via JSX
  // (<CoefField .../>), so React treats it as a proper component.
  const [display, setDisplay] = useState<string>(String(effectiveValue))
  useEffect(() => {
    setDisplay(String(effectiveValue))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveValue, keyName])

  if (!def) {
    // Manifest doesn't declare this key (template/manifest drift) — render
    // plainly rather than crash; see file header "don't crash" requirement.
    return <span data-testid={`coef-missing-${keyName}`}>[{keyName}]</span>
  }

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    setDisplay(raw)
    if (raw === '') return
    const num = Number(raw)
    if (Number.isNaN(num)) return
    // Always dispatch — pass the manifest default so the reducer can decide
    // whether to store the override or (when num equals the default, e.g. a
    // revert-to-default edit) remove any stale override for this key. See
    // the SET_HYPERPARAMETER reducer case in state/runStore.ts.
    ctx.dispatch({ type: 'SET_HYPERPARAMETER', key: keyName, value: num, default: Number(def!.default) })
  }

  return (
    <span style={{ whiteSpace: 'nowrap' }} title={`${t(def.label, ctx.uiLanguage)} (default ${def.default})`}>
      [
      <input
        data-testid={`coef-${keyName}`}
        aria-label={t(def.label, ctx.uiLanguage)}
        type="number"
        value={display}
        step={def.step}
        min={def.min}
        max={def.max}
        onChange={handleChange}
        style={{
          width: '58px',
          fontSize: '0.95em',
          textAlign: 'center',
          border: '1px solid #d1d5db',
          borderRadius: '3px',
        }}
      />
      ]
    </span>
  )
}

function LinkSpan({
  signalKey,
  text,
  ctx,
  bold = false,
}: {
  signalKey: string
  text: string
  ctx: FormulaCtx
  bold?: boolean
}) {
  const highlighted = ctx.highlightedSignalKey === signalKey
  return (
    <span
      data-testid={`formula-link-${signalKey}`}
      role="button"
      tabIndex={0}
      onMouseEnter={() => ctx.highlight(signalKey)}
      onMouseLeave={() => ctx.unhighlight()}
      onClick={() => ctx.highlight(signalKey)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') ctx.highlight(signalKey)
      }}
      style={{
        cursor: 'pointer',
        fontWeight: bold ? 700 : undefined,
        textDecoration: 'underline dotted',
        borderRadius: '3px',
        padding: '0 1px',
        color: highlighted ? '#4338ca' : '#1d4ed8',
        background: highlighted ? '#eef2ff' : 'transparent',
      }}
    >
      {text}
    </span>
  )
}

// ── Fallback: no authored template for this package ─────────────────────────

function FallbackHyperparameterList({ manifest, ctx }: { manifest: PackageManifest; ctx: FormulaCtx }) {
  const defs = manifest.hyperparameters ?? []
  if (defs.length === 0) {
    return (
      <div data-testid="algorithm-formulation-fallback" style={{ fontSize: '0.85em', color: '#6b7280' }}>
        No hyperparameters declared for this package.
      </div>
    )
  }
  return (
    <div data-testid="algorithm-formulation-fallback">
      <h3 style={{ fontSize: '0.75em', fontWeight: 600, color: '#666', margin: '4px 0' }}>Hyperparameters</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        {defs.map((def) => (
          <ExtraHyperparameterView key={def.key} keyName={def.key} ctx={ctx} />
        ))}
      </div>
    </div>
  )
}
