/**
 * ScalarTable — renders a list of scalar (numeric) hyperparameters as a
 * compact 2-column `parameter | value` table (mockup `table.mtx` styling),
 * instead of loose free-standing number boxes. Used for the "Input
 * preprocessing (γ / normalization)" group so it reads like the other matrix
 * tables in the panel.
 *
 * Each row's value is a live editable number input; `aria-label` carries the
 * localized parameter label so the field stays findable/accessible.
 */
import { t, type BilingualLabel, type UiLanguage } from '../../i18n/t'
import { mtxTableStyle, mtxThStyle, mtxTdStyle, mtxRowLabelStyle } from './matrixStyles'

export type ScalarField = {
  key: string
  label: BilingualLabel
  value: number | string
  min?: number
  max?: number
  step?: number
}

export type ScalarTableProps = {
  fields: ScalarField[]
  onChange: (key: string, value: number) => void
  lang: UiLanguage
  /** Header for the left (parameter) column. */
  parameterHeader?: string
  /** Header for the right (value) column. */
  valueHeader?: string
}

const cellInputStyle: React.CSSProperties = {
  width: '76px',
  textAlign: 'center',
  padding: '2px 4px',
  border: '1px solid #e5e7eb',
  background: '#fff',
  borderRadius: '4px',
}

export default function ScalarTable({
  fields,
  onChange,
  lang,
  parameterHeader = 'parameter',
  valueHeader = 'value',
}: ScalarTableProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={mtxTableStyle}>
        <thead>
          <tr>
            <th style={{ ...mtxThStyle, textAlign: 'left' }}>{parameterHeader}</th>
            <th style={mtxThStyle}>{valueHeader}</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => {
            const labelText = t(f.label, lang)
            return (
              <tr key={f.key}>
                <th scope="row" style={mtxRowLabelStyle}>
                  {labelText} <code style={{ color: '#9ca3af', fontWeight: 400 }}>{f.key}</code>
                </th>
                <td style={mtxTdStyle}>
                  <input
                    type="number"
                    aria-label={labelText}
                    data-testid={`scalar-${f.key}`}
                    style={cellInputStyle}
                    value={Number(f.value)}
                    min={f.min}
                    max={f.max}
                    step={f.step}
                    onChange={(e) => onChange(f.key, Number(e.target.value))}
                  />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
