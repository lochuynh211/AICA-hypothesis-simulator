/**
 * FeedbackForm (M5 T008) — Schema-driven reviewer feedback form.
 *
 * Fetches the effective schema for the current run on mount, then renders
 * one control per FieldDef:
 *   type="choice"        → <select> (single option)
 *   type="choice"+note   → <select> + optional <textarea> for a free-text note
 *   type="text"          → <textarea>
 *   type="scale"         → <input type="number" min/max>
 *
 * Always shows an additional free-text "Comment" textarea.
 *
 * The form carries the attach-point target passed in via props — it is NOT
 * derived or mutated inside this component.  All fields are optional.
 *
 * Submit → POST /api/runs/{id}/feedback via submitFeedback().
 * 201: shows a success message.
 * 400 (FeedbackValidationError): surfaces the structured field errors.
 */

import { useState, useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { getFeedbackSchema, submitFeedback } from '../../api/client'
import { FeedbackValidationError } from '../../api/types'
import type { FieldDef, FeedbackTarget, FeedbackSchema } from '../../api/types'
import { t } from '../../i18n/t'

type Props = {
  /** Attach-point: what this feedback is about. */
  target: FeedbackTarget
  /** Optional callback after successful submit. */
  onSuccess?: () => void
}

export default function FeedbackForm({ target, onSuccess }: Props) {
  const { state } = useRunStore()
  const runId = state.runState?.run_id ?? null
  const { uiLanguage } = state

  const [schema, setSchema] = useState<FeedbackSchema | null>(null)
  const [schemaError, setSchemaError] = useState<string | null>(null)

  // label values keyed by FieldDef.key; note values keyed by "<key>__note"
  const [labelValues, setLabelValues] = useState<Record<string, string>>({})
  const [comment, setComment] = useState('')

  const [submitting, setSubmitting] = useState(false)
  const [success, setSuccess] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [validationErrors, setValidationErrors] = useState<{ field: string; message: string }[]>([])

  // ── Fetch schema on mount (or when runId changes) ─────────────────────────
  useEffect(() => {
    if (!runId) return
    let cancelled = false

    getFeedbackSchema(runId)
      .then((s) => {
        if (!cancelled) setSchema(s)
      })
      .catch((e) => {
        if (!cancelled)
          setSchemaError(e instanceof Error ? e.message : 'Failed to load schema')
      })

    return () => {
      cancelled = true
    }
  }, [runId])

  // ── Build the labels payload ──────────────────────────────────────────────
  function buildLabels(): Record<string, unknown> {
    if (!schema) return {}
    const labels: Record<string, unknown> = {}
    for (const fd of schema.fields) {
      const raw = labelValues[fd.key]
      if (!raw) continue  // field not filled — all optional
      if (fd.type === 'choice' && fd.note) {
        const noteVal = labelValues[`${fd.key}__note`]
        if (noteVal) {
          labels[fd.key] = { choice: raw, note: noteVal }
        } else {
          labels[fd.key] = raw
        }
      } else if (fd.type === 'scale') {
        labels[fd.key] = parseFloat(raw)
      } else {
        labels[fd.key] = raw
      }
    }
    return labels
  }

  // ── Submit handler ────────────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!runId) return

    setSubmitting(true)
    setSubmitError(null)
    setValidationErrors([])
    setSuccess(false)

    const body = {
      target,
      labels: buildLabels(),
      comment: comment.trim() || null,
    }

    try {
      await submitFeedback(runId, body)
      setSuccess(true)
      if (onSuccess) onSuccess()
    } catch (err) {
      if (err instanceof FeedbackValidationError) {
        setValidationErrors(err.validationErrors)
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Submit failed')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render helpers ────────────────────────────────────────────────────────
  function renderField(fd: FieldDef) {
    const labelId = `fb-${fd.key}`
    const value = labelValues[fd.key] ?? ''

    function setValue(v: string) {
      setLabelValues((prev) => ({ ...prev, [fd.key]: v }))
    }

    return (
      <div key={fd.key} style={{ marginBottom: '10px' }}>
        <label
          htmlFor={labelId}
          style={{ display: 'block', fontSize: '0.8em', fontWeight: 600, marginBottom: '3px' }}
        >
          {t(fd.label, uiLanguage)}
        </label>

        {fd.type === 'choice' && (
          <>
            <select
              id={labelId}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="">— not selected —</option>
              {(fd.options ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            {fd.note && value && (
              <div style={{ marginTop: '4px' }}>
                <label
                  htmlFor={`${labelId}-note`}
                  style={{ display: 'block', fontSize: '0.75em', color: '#555' }}
                >
                  Note (optional)
                </label>
                <textarea
                  id={`${labelId}-note`}
                  rows={2}
                  value={labelValues[`${fd.key}__note`] ?? ''}
                  onChange={(e) =>
                    setLabelValues((prev) => ({ ...prev, [`${fd.key}__note`]: e.target.value }))
                  }
                  style={{ width: '100%', resize: 'vertical' }}
                />
              </div>
            )}
          </>
        )}

        {fd.type === 'text' && (
          <textarea
            id={labelId}
            rows={3}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: '100%', resize: 'vertical' }}
          />
        )}

        {fd.type === 'scale' && (
          <input
            id={labelId}
            type="number"
            min={fd.min ?? undefined}
            max={fd.max ?? undefined}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            style={{ width: '100%' }}
          />
        )}
      </div>
    )
  }

  // ── Guard: no active run ──────────────────────────────────────────────────
  if (!runId) {
    return (
      <div style={{ color: '#888', fontSize: '0.85em', padding: '8px' }}>
        No active run — feedback unavailable.
      </div>
    )
  }

  // ── Guard: schema error ───────────────────────────────────────────────────
  if (schemaError) {
    return (
      <div data-testid="feedback-schema-error" style={{ color: '#c00', padding: '8px' }}>
        Could not load feedback schema: {schemaError}
      </div>
    )
  }

  // ── Guard: schema loading ─────────────────────────────────────────────────
  if (!schema) {
    return (
      <div style={{ color: '#888', fontSize: '0.85em', padding: '8px' }}>
        Loading feedback form…
      </div>
    )
  }

  // ── Success view ──────────────────────────────────────────────────────────
  if (success) {
    return (
      <div
        data-testid="feedback-success"
        style={{ color: '#060', padding: '8px', fontSize: '0.9em' }}
      >
        Feedback submitted successfully.
      </div>
    )
  }

  // ── Form ──────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} style={{ fontSize: '0.85em' }}>
      {schema.fields.map(renderField)}

      {/* Always-present free-text comment */}
      <div style={{ marginBottom: '10px' }}>
        <label
          htmlFor="fb-comment"
          style={{ display: 'block', fontSize: '0.8em', fontWeight: 600, marginBottom: '3px' }}
        >
          Comment
        </label>
        <textarea
          id="fb-comment"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional free-text comment…"
          style={{ width: '100%', resize: 'vertical' }}
          aria-label="Comment"
        />
      </div>

      {/* Validation errors from 400 */}
      {validationErrors.length > 0 && (
        <div
          data-testid="feedback-validation-errors"
          role="alert"
          style={{ color: '#c00', marginBottom: '8px', fontSize: '0.8em' }}
        >
          <strong>Please fix the following errors:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: '16px' }}>
            {validationErrors.map((ve, i) => (
              <li key={i}>
                <code>{ve.field}</code>: {ve.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* General submit error */}
      {submitError && (
        <div
          data-testid="feedback-submit-error"
          role="alert"
          style={{ color: '#c00', marginBottom: '8px', fontSize: '0.8em' }}
        >
          {submitError}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: '4px 16px',
          cursor: submitting ? 'not-allowed' : 'pointer',
        }}
      >
        {submitting ? 'Submitting…' : 'Submit feedback'}
      </button>
    </form>
  )
}
