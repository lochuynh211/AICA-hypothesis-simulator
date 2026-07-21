import { useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { listPackages } from '../../api/client'
import { t } from '../../i18n/t'
import ErrorNotice from '../common/ErrorNotice'

const LABELS = {
  failedToLoadPackages: { ja: 'サーバーからのパッケージの読み込みに失敗しました', en: 'Failed to load packages from server' },
  algorithmPackage: { ja: 'アルゴリズムパッケージ', en: 'Algorithm Package' },
  loading: { ja: '読み込み中…', en: 'Loading…' },
  selectPackage: { ja: 'パッケージを選択', en: 'Select package' },
  couldNotBeLoadedSuffix: { ja: '個のパッケージを読み込めませんでした', en: ' package(s) could not be loaded' },
}

export default function PackageSelector() {
  const { state, dispatch } = useRunStore()
  const { packages, selectedPackageId, packageErrors, uiLanguage } = state

  useEffect(() => {
    listPackages()
      .then(({ packages, errors }) =>
        dispatch({ type: 'LOAD_PACKAGES', packages, errors })
      )
      .catch(() =>
        dispatch({ type: 'SET_RUN_ERROR', message: t(LABELS.failedToLoadPackages, uiLanguage) })
      )
  }, [dispatch])

  return (
    <div style={{ marginBottom: '8px' }}>
      <label htmlFor="package-select" style={{ display: 'block', fontSize: '0.8em', color: '#666', marginBottom: '2px' }}>
        {t(LABELS.algorithmPackage, uiLanguage)}
      </label>
      <select
        id="package-select"
        value={selectedPackageId ?? ''}
        onChange={(e) => dispatch({ type: 'SELECT_PACKAGE', id: e.target.value })}
        disabled={packages.length === 0}
        style={{ width: '100%' }}
      >
        <option value="" disabled>
          {packages.length === 0 ? t(LABELS.loading, uiLanguage) : t(LABELS.selectPackage, uiLanguage)}
        </option>
        {packages.map((p) => (
          <option key={p.id} value={p.id}>
            {t(p.label, uiLanguage)} ({p.version})
          </option>
        ))}
      </select>
      {packageErrors.length > 0 && (
        <ErrorNotice testid="package-registry-errors" message={`${packageErrors.length}${t(LABELS.couldNotBeLoadedSuffix, uiLanguage)}`} />
      )}
    </div>
  )
}
