/**
 * useCatalogLoader — loads a dataset's song catalog into the (nearest
 * ancestor) scoped `proposalStore`'s `state.catalog`, and returns the
 * dataset's provenance for display.
 *
 * Extracted OUT of `WorldPanel` (S5b bug fix) rather than left inline: before
 * this extraction `SET_CATALOG` was dispatched from exactly ONE call site —
 * `WorldPanel`'s own mount effect. The Combined Simulator's setup panel
 * (`MergedSetupPanel`) reuses `PreferenceHistorySection` verbatim (it reads
 * `state.catalog` for its oshi-artist rows) but never mounts `WorldPanel`, so
 * on the Combined screen's SCOPED proposal store `state.catalog` stayed at
 * its initial `[]` forever and the artist picker had nothing to offer — a
 * customer-reported bug. Pulling the loading effect into its own hook lets it
 * travel with whichever component needs the catalog, so it is not
 * re-forgotten the next time a catalog-consuming section is reused somewhere
 * `WorldPanel` itself is not mounted.
 *
 * `useProposalStore()` resolves to whichever `ProposalStoreProvider` is
 * nearest in the tree, so calling this hook from inside a SCOPED provider
 * (e.g. the Combined screen's) dispatches into that scoped store, not the
 * app-level one — no store reference needs to be threaded through.
 */
import { useEffect, useState } from 'react'
import { useProposalStore } from '../../state/proposalStore'
import { getCatalog, type DatasetProvenance } from '../../api/proposalClient'

/** Loads `datasetId`'s catalog (re-fetching whenever it changes) and returns
 * its provenance, or `null` before the first successful load / on failure. */
export function useCatalogLoader(datasetId: string | null | undefined): DatasetProvenance | null {
  const { dispatch } = useProposalStore()
  const [datasetProvenance, setDatasetProvenance] = useState<DatasetProvenance | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!datasetId) return
    getCatalog(datasetId)
      .then((resp) => {
        if (cancelled) return
        dispatch({ type: 'SET_CATALOG', catalog: resp.songs, total: resp.total })
        setDatasetProvenance(resp.provenance)
      })
      .catch(() => {
        if (!cancelled) setDatasetProvenance(null)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetId])

  return datasetProvenance
}
