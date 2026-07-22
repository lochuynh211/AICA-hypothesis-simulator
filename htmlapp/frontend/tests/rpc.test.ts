import { describe, it, expect } from 'vitest'
import { unwrap, serializeError } from '../src/api/rpc'
import { MapsError, FeedbackValidationError } from '../src/api/types'

describe('rpc envelope', () => {
  it('unwrap returns result on ok', () => {
    expect(unwrap({ ok: true, result: 42 })).toBe(42)
  })

  it('unwrap rethrows a plain Error preserving name+message', () => {
    expect(() => unwrap({ ok: false, error: { type: 'RunNotFoundError', message: 'no run x' } }))
      .toThrowError('no run x')
  })

  it('serialize→unwrap round-trips a MapsError with its body', () => {
    const original = new MapsError({ error_type: 'quota', message: 'over limit', suggestion: 'retry' })
    const wire = serializeError(original)
    expect(wire.type).toBe('MapsError')
    let caught: unknown
    try { unwrap({ ok: false, error: wire }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(MapsError)
    expect((caught as MapsError).body.suggestion).toBe('retry')
  })

  it('serialize→unwrap round-trips a FeedbackValidationError with its list', () => {
    const original = new FeedbackValidationError({ validation_errors: [{ field: 'x', message: 'bad' }] })
    let caught: unknown
    try { unwrap({ ok: false, error: serializeError(original) }) } catch (e) { caught = e }
    expect(caught).toBeInstanceOf(FeedbackValidationError)
    expect((caught as FeedbackValidationError).validationErrors[0].field).toBe('x')
  })
})
