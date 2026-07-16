/**
 * fieldEditors (P3 T026) — small generic, REAL editable controls used by
 * WorldPanel for the driver-profile "Preference & history" fields that used
 * to be read-only `JSON.stringify(...)` dumps: string lists, string/number
 * keyed maps, nested (two-level) maps, and timestamped item lists.
 *
 * Every editor is controlled (value + onChange) and pure/presentational —
 * WorldPanel owns all store dispatches; these components never touch
 * `proposalStore` directly.
 */
import { useState } from 'react'

const rowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '6px',
  padding: '3px 0',
  fontSize: '0.8em',
}

const addRowStyle: React.CSSProperties = { ...rowStyle, marginTop: '2px' }

const smallInputStyle: React.CSSProperties = { fontSize: '0.95em', padding: '2px 4px', minWidth: '0' }

const removeButtonStyle: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#dc2626',
  cursor: 'pointer',
  fontWeight: 700,
  padding: '0 4px',
}

// ── TextListEditor — list<string> (route_tags, hobby_interest_tags, ...) ───

export function TextListEditor({
  value,
  onChange,
  testId,
}: {
  value: string[]
  onChange: (next: string[]) => void
  testId: string
}) {
  const [draft, setDraft] = useState('')
  return (
    <div data-testid={testId}>
      {value.map((item, idx) => (
        <div key={`${item}-${idx}`} style={rowStyle} data-testid={`${testId}-row-${idx}`}>
          <span style={{ flex: 1 }}>{item}</span>
          <button
            type="button"
            data-testid={`${testId}-remove-${idx}`}
            style={removeButtonStyle}
            onClick={() => onChange(value.filter((_, i) => i !== idx))}
          >
            ×
          </button>
        </div>
      ))}
      <div style={addRowStyle}>
        <input
          data-testid={`${testId}-draft`}
          style={{ ...smallInputStyle, flex: 1 }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
        <button
          type="button"
          data-testid={`${testId}-add`}
          disabled={!draft.trim()}
          onClick={() => {
            if (!draft.trim()) return
            onChange([...value, draft.trim()])
            setDraft('')
          }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ── RecordEditor — Record<string, string|number> (usage-level / rate maps) ─

type RecordEditorProps = {
  value: Record<string, string | number>
  onChange: (next: Record<string, string | number>) => void
  testId: string
  /** If provided, the key is chosen from a fixed <select> (e.g. ServiceId);
   * otherwise the key is a free-text input (e.g. a track/content-tag id). */
  keyOptions?: string[]
  /** 'enum' renders a <select> of `valueOptions` for the value; 'number'
   * renders a numeric input. */
  valueKind: 'enum' | 'number'
  valueOptions?: string[]
}

export function RecordEditor({ value, onChange, testId, keyOptions, valueKind, valueOptions }: RecordEditorProps) {
  const entries = Object.entries(value)
  const [draftKey, setDraftKey] = useState(keyOptions?.[0] ?? '')
  const [draftValue, setDraftValue] = useState<string>(valueOptions?.[0] ?? '0')

  function removeKey(key: string) {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }

  function updateValue(key: string, raw: string) {
    onChange({ ...value, [key]: valueKind === 'number' ? Number(raw) : raw })
  }

  return (
    <div data-testid={testId}>
      {entries.map(([key, val]) => (
        <div key={key} style={rowStyle} data-testid={`${testId}-row-${key}`}>
          <code style={{ flex: 1 }}>{key}</code>
          {valueKind === 'enum' ? (
            <select
              data-testid={`${testId}-value-${key}`}
              value={String(val)}
              onChange={(e) => updateValue(key, e.target.value)}
            >
              {(valueOptions ?? []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          ) : (
            <input
              data-testid={`${testId}-value-${key}`}
              type="number"
              style={smallInputStyle}
              value={Number(val)}
              onChange={(e) => updateValue(key, e.target.value)}
            />
          )}
          <button
            type="button"
            data-testid={`${testId}-remove-${key}`}
            style={removeButtonStyle}
            onClick={() => removeKey(key)}
          >
            ×
          </button>
        </div>
      ))}
      <div style={addRowStyle}>
        {keyOptions ? (
          <select
            data-testid={`${testId}-draft-key`}
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
          >
            {keyOptions.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-testid={`${testId}-draft-key`}
            style={{ ...smallInputStyle, flex: 1 }}
            value={draftKey}
            onChange={(e) => setDraftKey(e.target.value)}
            placeholder="id"
          />
        )}
        {valueKind === 'enum' ? (
          <select
            data-testid={`${testId}-draft-value`}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
          >
            {(valueOptions ?? []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-testid={`${testId}-draft-value`}
            type="number"
            style={smallInputStyle}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
          />
        )}
        <button
          type="button"
          data-testid={`${testId}-add`}
          disabled={!draftKey.trim()}
          onClick={() => {
            if (!draftKey.trim()) return
            onChange({ ...value, [draftKey.trim()]: valueKind === 'number' ? Number(draftValue) : draftValue })
            if (!keyOptions) setDraftKey('')
          }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ── NestedRecordEditor — Record<scene, Record<key, value>> ─────────────────
// (scene_service_usage_level / scene_content_tag_usage_level)

export function NestedRecordEditor({
  value,
  onChange,
  testId,
  innerKeyOptions,
  innerValueOptions,
}: {
  value: Record<string, Record<string, string>>
  onChange: (next: Record<string, Record<string, string>>) => void
  testId: string
  innerKeyOptions?: string[]
  innerValueOptions: string[]
}) {
  const [draftScene, setDraftScene] = useState('')
  const scenes = Object.keys(value)

  function addScene() {
    if (!draftScene.trim() || value[draftScene.trim()]) return
    onChange({ ...value, [draftScene.trim()]: {} })
    setDraftScene('')
  }

  function removeScene(scene: string) {
    const next = { ...value }
    delete next[scene]
    onChange(next)
  }

  return (
    <div data-testid={testId}>
      {scenes.map((scene) => (
        <div
          key={scene}
          data-testid={`${testId}-scene-${scene}`}
          style={{ border: '1px dashed #d1d5db', borderRadius: '6px', padding: '4px 6px', margin: '3px 0' }}
        >
          <div style={{ ...rowStyle, fontWeight: 700 }}>
            <span style={{ flex: 1 }}>{scene}</span>
            <button
              type="button"
              data-testid={`${testId}-scene-${scene}-remove`}
              style={removeButtonStyle}
              onClick={() => removeScene(scene)}
            >
              ×
            </button>
          </div>
          <RecordEditor
            testId={`${testId}-scene-${scene}-map`}
            value={value[scene]}
            keyOptions={innerKeyOptions}
            valueKind="enum"
            valueOptions={innerValueOptions}
            onChange={(inner) => onChange({ ...value, [scene]: inner as Record<string, string> })}
          />
        </div>
      ))}
      <div style={addRowStyle}>
        <input
          data-testid={`${testId}-draft-scene`}
          style={{ ...smallInputStyle, flex: 1 }}
          value={draftScene}
          onChange={(e) => setDraftScene(e.target.value)}
          placeholder="scene"
        />
        <button type="button" data-testid={`${testId}-add-scene`} disabled={!draftScene.trim()} onClick={addScene}>
          +
        </button>
      </div>
    </div>
  )
}

// ── ItemListEditor — list of {[idField]: string, [tsField]: string} ────────

export function ItemListEditor<T extends Record<string, string>>({
  value,
  onChange,
  testId,
  idField,
  tsField,
  idPlaceholder = 'track_id',
}: {
  value: T[]
  onChange: (next: T[]) => void
  testId: string
  idField: keyof T & string
  tsField: keyof T & string
  idPlaceholder?: string
}) {
  const [draftId, setDraftId] = useState('')
  const [draftTs, setDraftTs] = useState('')

  return (
    <div data-testid={testId}>
      {value.map((item, idx) => (
        <div key={idx} style={rowStyle} data-testid={`${testId}-row-${idx}`}>
          <code style={{ flex: 1 }}>{item[idField]}</code>
          <span style={{ color: '#6b7280' }}>{item[tsField]}</span>
          <button
            type="button"
            data-testid={`${testId}-remove-${idx}`}
            style={removeButtonStyle}
            onClick={() => onChange(value.filter((_, i) => i !== idx))}
          >
            ×
          </button>
        </div>
      ))}
      <div style={addRowStyle}>
        <input
          data-testid={`${testId}-draft-id`}
          style={{ ...smallInputStyle, flex: 1 }}
          value={draftId}
          onChange={(e) => setDraftId(e.target.value)}
          placeholder={idPlaceholder}
        />
        <input
          data-testid={`${testId}-draft-ts`}
          style={{ ...smallInputStyle, flex: 1 }}
          value={draftTs}
          onChange={(e) => setDraftTs(e.target.value)}
          placeholder="ISO timestamp"
        />
        <button
          type="button"
          data-testid={`${testId}-add`}
          disabled={!draftId.trim() || !draftTs.trim()}
          onClick={() => {
            if (!draftId.trim() || !draftTs.trim()) return
            onChange([...value, { [idField]: draftId.trim(), [tsField]: draftTs.trim() } as unknown as T])
            setDraftId('')
            setDraftTs('')
          }}
        >
          +
        </button>
      </div>
    </div>
  )
}

// ── GenreUsageTable — fixed 12-genre × UsageLevel select table ──────────────

const USAGE_LEVELS = ['never', 'low', 'med', 'high'] as const

export function GenreUsageTable({
  genres,
  value,
  onChange,
  testId,
}: {
  genres: string[]
  value: Partial<Record<string, string>>
  onChange: (genre: string, level: string) => void
  testId: string
}) {
  return (
    <div data-testid={testId}>
      {genres.map((genre) => (
        <div key={genre} style={rowStyle}>
          <code style={{ flex: 1 }}>{genre}</code>
          <select
            data-testid={`${testId}-${genre}`}
            value={value[genre] ?? 'never'}
            onChange={(e) => onChange(genre, e.target.value)}
          >
            {USAGE_LEVELS.map((lvl) => (
              <option key={lvl} value={lvl}>
                {lvl}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  )
}
