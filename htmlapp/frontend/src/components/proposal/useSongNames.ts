/**
 * useSongNames — `item_id → song name`, from the world's dataset catalog.
 *
 * Extracted from `MergedProposalPanel` so the content plan and the review
 * column resolve names the same way: two copies of this fetch could disagree
 * about which dataset they read, and a reviewer comparing two songs by name
 * would have no way to tell.
 *
 * An unavailable catalog yields an EMPTY map, never a partial or guessed one —
 * callers then say the song is unnamed, which is honest, rather than showing a
 * name that might belong to a different dataset.
 */
import { useEffect, useState } from 'react'
import { getDatasetCatalog } from '../../api/proposalClient'
import type { BilingualLabel } from '../../i18n/t'
import { t } from '../../i18n/t'

export function useSongNames(datasetId: string | null | undefined): Record<string, string> {
  const [songNames, setSongNames] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!datasetId) {
      setSongNames({})
      return
    }
    let cancelled = false
    getDatasetCatalog(datasetId)
      .then((resp) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const song of resp.songs) map[song.spotify_track.id] = song.spotify_track.name
        setSongNames(map)
      })
      .catch(() => {
        if (!cancelled) setSongNames({})
      })
    return () => {
      cancelled = true
    }
  }, [datasetId])

  return songNames
}

/** `item_id → "Artist A, Artist B"`, from the world's dataset catalog — the
 * artist companion to `useSongNames`. Same honest-empty-on-failure contract:
 * an unavailable catalog yields an EMPTY map, never a guessed one. A song with
 * no artists (or none recorded) simply has no entry, and callers render only
 * the song name for it. */
export function useSongArtists(datasetId: string | null | undefined): Record<string, string> {
  const [songArtists, setSongArtists] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!datasetId) {
      setSongArtists({})
      return
    }
    let cancelled = false
    getDatasetCatalog(datasetId)
      .then((resp) => {
        if (cancelled) return
        const map: Record<string, string> = {}
        for (const song of resp.songs) {
          const names = (song.spotify_track.artists ?? [])
            .map((a) => a.name)
            .filter((n) => n && n.trim())
          if (names.length > 0) map[song.spotify_track.id] = names.join(', ')
        }
        setSongArtists(map)
      })
      .catch(() => {
        if (!cancelled) setSongArtists({})
      })
    return () => {
      cancelled = true
    }
  }, [datasetId])

  return songArtists
}

/** What a song with no catalog entry is called on screen. The catalog track id
 *  is NOT a name — it is the key the evidence is stored under — so it stays out
 *  of the UI and lives only in `data-testid`. */
const UNNAMED_SONG: BilingualLabel = { ja: '名称未登録の楽曲', en: 'Unnamed track' }

/** The song's name, or a plain statement that the catalog does not name it. */
export function songDisplayName(
  itemId: string,
  songNames: Record<string, string>,
  lang: 'ja' | 'en' = 'ja',
): string {
  return songNames[itemId] ?? t(UNNAMED_SONG, lang)
}
