import { useEffect } from 'react'
import { useRunStore } from '../../state/runStore'
import { listScenarios } from '../../api/client'
import { t } from '../../i18n/t'
import ErrorNotice from '../common/ErrorNotice'

const LABELS = {
  failedToLoadScenarios: { ja: 'サーバーからのシナリオの読み込みに失敗しました', en: 'Failed to load scenarios from server' },
  scenario: { ja: 'シナリオ', en: 'Scenario' },
  loading: { ja: '読み込み中…', en: 'Loading…' },
  selectScenario: { ja: 'シナリオを選択', en: 'Select scenario' },
  couldNotBeLoadedSuffix: { ja: '個のシナリオを読み込めませんでした', en: ' scenario(s) could not be loaded' },
}

export default function ScenarioSelector() {
  const { state, dispatch } = useRunStore()
  const { scenarios, selectedScenarioId, scenarioErrors, packages, selectedPackageId, uiLanguage } = state

  useEffect(() => {
    listScenarios()
      .then(({ scenarios, errors }) =>
        dispatch({ type: 'LOAD_SCENARIOS', scenarios, errors })
      )
      .catch(() =>
        dispatch({ type: 'SET_RUN_ERROR', message: t(LABELS.failedToLoadScenarios, uiLanguage) })
      )
  }, [dispatch])

  // Compatibility filter: when a package is selected, show only scenarios whose
  // type is listed in the package's compatible_scenario_types.
  const selectedPackage = packages.find((p) => p.id === selectedPackageId) ?? null
  const filteredScenarios =
    selectedPackage != null
      ? scenarios.filter((s) => selectedPackage.compatible_scenario_types.includes(s.type))
      : scenarios

  return (
    <div style={{ marginBottom: '8px' }}>
      <label htmlFor="scenario-select" style={{ display: 'block', fontSize: '0.8em', color: '#666', marginBottom: '2px' }}>
        {t(LABELS.scenario, uiLanguage)}
      </label>
      <select
        id="scenario-select"
        value={selectedScenarioId ?? ''}
        onChange={(e) => dispatch({ type: 'SELECT_SCENARIO', id: e.target.value })}
        disabled={filteredScenarios.length === 0}
        style={{ width: '100%' }}
      >
        <option value="" disabled>
          {filteredScenarios.length === 0 ? t(LABELS.loading, uiLanguage) : t(LABELS.selectScenario, uiLanguage)}
        </option>
        {filteredScenarios.map((s) => (
          <option key={s.id} value={s.id}>
            {s.persona_label} — {s.review_focus}
          </option>
        ))}
      </select>
      {scenarioErrors.length > 0 && (
        <ErrorNotice testid="scenario-registry-errors" message={`${scenarioErrors.length}${t(LABELS.couldNotBeLoadedSuffix, uiLanguage)}`} />
      )}
    </div>
  )
}
