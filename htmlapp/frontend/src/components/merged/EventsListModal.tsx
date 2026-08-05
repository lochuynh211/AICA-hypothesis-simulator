/**
 * EventsListModal — the Combined screen's full projected-event list, shown in a
 * popup (the shared Modal primitive). QUICKVIEW-ONLY: a pure projection with no
 * reached-marker and no dependence on the live tick — the "which trigger is
 * current" concept lives on the panel's active-event line, not here.
 *
 * Trigger rows use the specification's own 提案分類 wording via `purposeLabel`
 * (the SAME table the 提案分類 strip and the map overlay read), so the popup
 * never invents a vocabulary the rest of the screen does not use.
 */
import Modal from './Modal'
import { useLanguage } from '../../state/language'
import { t } from '../../i18n/t'
import type { BilingualLabel } from '../../i18n/t'
import { formatDuration } from '../../lib/formatDuration'
import { purposeLabel } from '../../lib/review/reviewVocabulary'
import type { MergedTimingEvent } from '../../lib/merged/eventTimeline'

const LABELS = {
  title: { ja: 'すべてのイベント（予測）', en: 'All projected events' },
  arriveIn: { ja: '到着まで', en: 'arrive in' },
  restBegin: { ja: '休憩開始', en: 'Rest begins' },
  restRestart: { ja: '休憩から再開', en: 'Restart from rest' },
} satisfies Record<string, BilingualLabel>

/** Category/boundary label for one event — trigger rows resolve through the
 *  shared `purposeLabel` table (proposal-category wording); rest boundaries use
 *  the local begin/restart labels. */
function eventLabel(kind: MergedTimingEvent['kind']): BilingualLabel {
  switch (kind) {
    case 'monotony_trigger':
      return purposeLabel('inattentive_driving_prevention_recovery')
    case 'safety_trigger':
      return purposeLabel('rest_recommended')
    case 'rest_begin':
      return LABELS.restBegin
    case 'rest_restart':
      return LABELS.restRestart
  }
}

export default function EventsListModal({
  open,
  events,
  onClose,
}: {
  open: boolean
  events: MergedTimingEvent[]
  onClose: () => void
}): JSX.Element | null {
  const { lang } = useLanguage()
  return (
    <Modal open={open} title={t(LABELS.title, lang)} onClose={onClose}>
      <div
        data-testid="events-list-modal"
        style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}
      >
        {events.map((ev, i) => (
          <div
            key={i}
            data-testid={`events-list-row-${i}`}
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 10px',
              alignItems: 'baseline',
              padding: '6px 8px',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              fontSize: '0.85em',
            }}
          >
            <span style={{ fontWeight: 600 }}>{t(eventLabel(ev.kind), lang)}</span>
            <span style={{ color: '#1d4ed8', fontWeight: 600 }}>@ {formatDuration(ev.whenMin, lang)}</span>
            {ev.arriveInMin != null && (
              <span style={{ color: '#64748b' }}>
                · {t(LABELS.arriveIn, lang)} {formatDuration(ev.arriveInMin, lang)}
              </span>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
