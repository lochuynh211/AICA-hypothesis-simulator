import { useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { listPackages } from '../../api/client'

export default function PackageSelector() {
  const { state, dispatch } = useRunStore()
  const { packages, selectedPackageId } = state

  useEffect(() => {
    listPackages()
      .then(({ packages }) => dispatch({ type: 'LOAD_PACKAGES', packages }))
      .catch(() => {})
  }, [dispatch])

  return (
    <div style={{ marginBottom: '8px' }}>
      <label htmlFor="package-select" style={{ display: 'block', fontSize: '0.8em', color: '#666', marginBottom: '2px' }}>
        Algorithm Package
      </label>
      <select
        id="package-select"
        value={selectedPackageId ?? ''}
        onChange={(e) => dispatch({ type: 'SELECT_PACKAGE', id: e.target.value })}
        disabled={packages.length === 0}
        style={{ width: '100%' }}
      >
        <option value="" disabled>
          {packages.length === 0 ? 'Loading…' : 'Select package'}
        </option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label.en} ({p.version})
          </option>
        ))}
      </select>
    </div>
  )
}
