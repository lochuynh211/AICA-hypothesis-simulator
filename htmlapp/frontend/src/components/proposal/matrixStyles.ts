/**
 * Shared matrix/table styles mirroring ui-mockup.html `table.mtx` — used by
 * HyperparamMatrix (generic renderer) and the dedicated per-hyperparameter
 * table editors (ResponseMatrixTable, HierarchyWeightsTable) so every matrix
 * in the Service-proposal panel reads as one consistent grid.
 */
import type { CSSProperties } from 'react'

export const mtxTableStyle: CSSProperties = {
  borderCollapse: 'collapse',
  width: '100%',
  fontSize: '0.76em',
  margin: '4px 0',
}

export const mtxThStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  padding: '3px 6px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  background: '#f1f5f9',
  fontWeight: 700,
  color: '#4b5563',
}

export const mtxTdStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  padding: '3px 6px',
  textAlign: 'center',
  whiteSpace: 'nowrap',
}

/** First-column row label (and top-left corner) — left-aligned, tinted. */
export const mtxRowLabelStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  padding: '3px 6px',
  textAlign: 'left',
  whiteSpace: 'nowrap',
  background: '#f8fafc',
  fontWeight: 600,
  color: '#4b5563',
}

export const mtxCornerStyle: CSSProperties = {
  border: '1px solid #e5e7eb',
  padding: '3px 6px',
  background: '#f8fafc',
}

export const mtxInputStyle: CSSProperties = {
  width: '52px',
  textAlign: 'center',
  padding: '1px 3px',
  border: '1px solid transparent',
  background: 'transparent',
  borderRadius: '4px',
}

export const nestedBlockStyle: CSSProperties = {
  margin: '4px 0 4px 2px',
  paddingLeft: '8px',
  borderLeft: '2px solid #e5e7eb',
}

export const nestedLabelStyle: CSSProperties = {
  fontSize: '0.72em',
  fontWeight: 700,
  color: '#4b5563',
  margin: '2px 0',
}
