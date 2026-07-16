/**
 * CatalogView (P3 T026) — read-only song list behind a disclosure.
 *
 * READ-ONLY: renders `track.name`/`artists` for reference only; there is no
 * edit/import affordance here or anywhere in the World panel (constraint:
 * "Catalog is READ-ONLY in the UI").
 */
import { t, type UiLanguage } from '../../i18n/t'
import type { CatalogSongSummary } from '../../api/proposalClient'

const LABELS = {
  summary: { ja: 'カタログを見る（読み取り専用）', en: 'View catalog (read-only)' },
}

export default function CatalogView({
  songs,
  total,
  lang,
}: {
  songs: CatalogSongSummary[]
  total: number
  lang: UiLanguage
}) {
  return (
    <details data-testid="catalog-view" style={{ margin: '4px 0' }}>
      <summary style={{ cursor: 'pointer', fontSize: '0.78em', color: '#4b5563' }}>
        {t(LABELS.summary, lang)} ({total})
      </summary>
      <ul style={{ margin: '4px 0', paddingLeft: '18px', fontSize: '0.78em', color: '#6b7280', maxHeight: '160px', overflowY: 'auto' }}>
        {songs.map((song) => (
          <li key={song.spotify_track.id} data-testid={`catalog-song-${song.spotify_track.id}`}>
            <code>{song.spotify_track.id}</code> — {song.spotify_track.name}
            {song.spotify_track.artists && song.spotify_track.artists.length > 0
              ? ` (${song.spotify_track.artists.map((a) => a.name).join(', ')})`
              : ''}
          </li>
        ))}
      </ul>
    </details>
  )
}
