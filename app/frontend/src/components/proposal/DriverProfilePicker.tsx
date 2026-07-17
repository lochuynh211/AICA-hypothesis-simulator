/**
 * DriverProfilePicker (P3 T026; reworked per owner feedback 2026-07-17 —
 * no separate Load button, selecting a profile AUTOLOADS it immediately, and
 * this picker now renders FIRST in the "Preference & history" section so the
 * driver's values are visibly filled before the individual fields below) —
 * list built-in + user driver profiles, load one into `world.driver_profile`,
 * save the CURRENT driver profile as a new named (user) profile, and delete a
 * user profile (built-ins are not deletable — the backend returns 409,
 * surfaced here as an inline error).
 */
import { useEffect, useRef, useState } from 'react'
import { t } from '../../i18n/t'
import { useProposalStore } from '../../state/proposalStore'
import { listProfiles, getProfile, saveProfile, deleteProfile } from '../../api/proposalClient'

const LABELS = {
  profile: { ja: 'プロファイル', en: 'Profile' },
  delete: { ja: '削除', en: 'Delete' },
  saveAs: { ja: '現在の内容を名前を付けて保存', en: 'Save current as named profile' },
  labelJa: { ja: 'ラベル（日本語）', en: 'Label (Japanese)' },
  labelEn: { ja: 'ラベル（英語）', en: 'Label (English)' },
  save: { ja: '保存', en: 'Save' },
  builtin: { ja: '（組み込み）', en: '(built-in)' },
}

export default function DriverProfilePicker() {
  const { state, dispatch } = useProposalStore()
  const { uiLanguage: lang } = state
  // LOCAL selection state (not bound directly to `state.selectedProfileId`):
  // the dropdown must reflect exactly what the user picked, immediately —
  // binding it straight to the store would snap it back to whatever
  // profile_id `getProfile`'s response names, if that ever differs from what
  // was requested (a real risk here, since a caller could mock a fixed
  // response regardless of which id was asked for).
  const [selected, setSelected] = useState('')
  const [labelJa, setLabelJa] = useState('')
  const [labelEn, setLabelEn] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Tracks the `selectedProfileId` THIS component most recently pushed into
  // the store (or `null` if it never has, or most recently cleared it) —
  // lets the reflect-effect below tell "the store changed because I just
  // dispatched it" (already mirrored via `setSelected` above — a no-op here)
  // apart from "the store changed because something ELSE loaded a world"
  // (e.g. a preset's atomic LOAD_PRESET, which clears this to `null`) — the
  // latter must always be reflected, even after the user already picked a
  // profile here (feature 018 — PresetPicker must be able to override).
  //
  // IMPORTANT: `handleDelete` below deliberately sets this ref to `null`
  // itself (alongside its own `CLEAR_SELECTED_PROFILE` dispatch) — NOT to
  // the newly-selected "first remaining profile" it optimistically shows in
  // the dropdown — because that reselect is a local UI convenience only; it
  // does not dispatch LOAD_PROFILE, so the store's concept of a loaded
  // profile really is `null` after a delete, and the ref must say so too, or
  // the reflect-effect would wrongly treat its own clear as an external
  // change and stomp the optimistic local selection back to empty.
  const lastDispatchedProfileId = useRef<string | null>(null)

  function refreshProfiles() {
    return listProfiles().then((resp) => {
      dispatch({ type: 'SET_PROFILES', profiles: resp.profiles })
      return resp.profiles
    })
  }

  useEffect(() => {
    let cancelled = false
    refreshProfiles().catch((e) => {
      if (!cancelled) setError(e instanceof Error ? e.message : String(e))
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reflect a profile selection loaded from OUTSIDE this component (a future
  // auto-init path, or a preset's atomic LOAD_PRESET clearing it to null) —
  // always, not only into an empty selection, so a later external load
  // correctly overrides an earlier direct choice too.
  useEffect(() => {
    if (state.selectedProfileId !== lastDispatchedProfileId.current) {
      setSelected(state.selectedProfileId ?? '')
      lastDispatchedProfileId.current = state.selectedProfileId
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.selectedProfileId])

  const selectedSummary = state.profiles.find((p) => p.profile_id === selected)

  async function handleSelect(profileId: string) {
    if (!profileId) return
    setSelected(profileId)
    setBusy(true)
    setError(null)
    try {
      const record = await getProfile(profileId)
      lastDispatchedProfileId.current = record.profile_id
      dispatch({ type: 'LOAD_PROFILE', profileId: record.profile_id, profile: record.profile })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleSave() {
    if (!labelJa.trim() && !labelEn.trim()) return
    setBusy(true)
    setError(null)
    try {
      const record = await saveProfile(
        { ja: labelJa.trim() || labelEn.trim(), en: labelEn.trim() || labelJa.trim() },
        state.world.driver_profile,
      )
      await refreshProfiles()
      setSelected(record.profile_id)
      lastDispatchedProfileId.current = record.profile_id
      dispatch({ type: 'LOAD_PROFILE', profileId: record.profile_id, profile: record.profile })
      setLabelJa('')
      setLabelEn('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete() {
    if (!selected || selectedSummary?.builtin) return
    setBusy(true)
    setError(null)
    try {
      await deleteProfile(selected)
      const profiles = await refreshProfiles()
      setSelected(profiles[0]?.profile_id ?? '')
      if (state.selectedProfileId === selected) {
        lastDispatchedProfileId.current = null
        dispatch({ type: 'CLEAR_SELECTED_PROFILE' })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '6px 8px', alignItems: 'center' }}>
        <label style={{ fontSize: '0.82em', color: '#4b5563', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {t(LABELS.profile, lang)}
          <select
            data-testid="profile-picker-select"
            value={selected}
            onChange={(e) => handleSelect(e.target.value)}
          >
            <option value="" disabled>
              —
            </option>
            {state.profiles.map((p) => (
              <option key={p.profile_id} value={p.profile_id}>
                {t(p.label, lang)}
                {p.builtin ? ` ${t(LABELS.builtin, lang)}` : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          data-testid="profile-picker-delete"
          // Deliberately NOT gated on `busy`: `busy` tracks the background
          // autoload of the SELECTED profile's fields, which is independent
          // of deleting whatever is currently selected in the dropdown.
          disabled={!selected || selectedSummary?.builtin}
          onClick={handleDelete}
        >
          {t(LABELS.delete, lang)}
        </button>
      </div>

      <div style={{ fontSize: '0.78em', color: '#6b7280', margin: '6px 0 2px' }}>{t(LABELS.saveAs, lang)}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px 8px' }}>
        <input
          data-testid="profile-picker-label-ja"
          placeholder={t(LABELS.labelJa, lang)}
          value={labelJa}
          onChange={(e) => setLabelJa(e.target.value)}
        />
        <input
          data-testid="profile-picker-label-en"
          placeholder={t(LABELS.labelEn, lang)}
          value={labelEn}
          onChange={(e) => setLabelEn(e.target.value)}
        />
        <button
          type="button"
          data-testid="profile-picker-save"
          disabled={busy || (!labelJa.trim() && !labelEn.trim())}
          onClick={handleSave}
        >
          {t(LABELS.save, lang)}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ fontSize: '0.76em', color: '#dc2626', margin: '4px 0 0' }}>
          {error}
        </p>
      )}
    </div>
  )
}
