/**
 * useSongNames — `item_id → song name`, from the world's dataset catalog.
 *
 * Extracted from `MergedProposalPanel` so the content plan and the review
 * column resolve names the same way: two copies of this fetch could disagree
 * about which dataset they read, and a reviewer comparing two songs by name
 * would have no way to tell.
 *
 * An unavailable catalog yields an EMPTY map, never a partial or guessed one —
 * callers fall back to showing the raw id, which is honest, rather than a name
 * that might belong to a different dataset.
 */
import { useEffect, useState } from 'react'
import { getDatasetCatalog } from '../../api/proposalClient'

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

/** `Name (id)` when the catalog knows the song, the bare id when it does not. */
export function songDisplayName(itemId: string, songNames: Record<string, string>): string {
  const name = songNames[itemId]
  return name ? `${name} (${itemId})` : itemId
}
