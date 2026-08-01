/**
 * Proposal worker-RPC handlers — the four `proposal.*` ops this task wires.
 *
 * Each mirrors one endpoint in `routers/proposal.py`. Store methods
 * (`../../proposal/stores.ts`) return `null` on a miss, mirroring the Python
 * REGISTRY layer; the not-found -> thrown-error translation below mirrors
 * the Python ROUTER layer (`HTTPException(404, ...)`), matching how
 * `routers/proposal.py` itself splits the two concerns.
 */
import {
  presetStore,
  datasetCatalogRegistry,
  proposalPackageRegistry,
  type PresetDoc,
  type PresetSummary,
  type ProposalPackageSummary,
  type ProposalPackageSlot,
  type ProposalPackageError,
  type DatasetProvenanceView,
} from '../../proposal/stores'

// ---------------------------------------------------------------------------
// proposal.presets.list — GET /api/proposal/presets
// ---------------------------------------------------------------------------

export async function proposalPresetsList(): Promise<{ presets: PresetSummary[] }> {
  return { presets: presetStore.listSummaries() }
}

// ---------------------------------------------------------------------------
// proposal.presets.get — GET /api/proposal/presets/{preset_id}
// ---------------------------------------------------------------------------

export async function proposalPresetsGet(params: { presetId: string }): Promise<PresetDoc> {
  const preset = presetStore.get(params.presetId)
  if (preset === null) {
    // Mirrors routers/proposal.py#get_preset: HTTPException(404, detail=f"preset not found: {preset_id}")
    throw new Error(`preset not found: ${params.presetId}`)
  }
  return preset
}

// ---------------------------------------------------------------------------
// proposal.packages.list — GET /api/proposal/packages
// ---------------------------------------------------------------------------

export async function proposalPackagesList(): Promise<{
  slots: ProposalPackageSlot[]
  packages: ProposalPackageSummary[]
  errors: ProposalPackageError[]
}> {
  // Mirrors routers/proposal.py#get_packages: the HIDDEN filter is the
  // router's job, not the registry's — proposalPackageRegistry.listSummaries()
  // itself returns every loaded package (hidden or not).
  const { packages, errors } = proposalPackageRegistry.listSummaries()
  return {
    slots: proposalPackageRegistry.listSlots(),
    packages: packages.filter((p) => !p.hidden),
    errors,
  }
}

// ---------------------------------------------------------------------------
// proposal.catalog.get — GET /api/proposal/datasets/{dataset_id}/catalog
// ---------------------------------------------------------------------------

export async function proposalCatalogGet(params: {
  datasetId: string
  offset?: number
  limit?: number
}): Promise<{ provenance: DatasetProvenanceView; total: number; songs: unknown[] }> {
  const offset = params.offset ?? 0
  const catalog = datasetCatalogRegistry.getCatalog(params.datasetId)
  if (catalog === null) {
    // Mirrors routers/proposal.py#get_dataset_catalog: HTTPException(404, detail=f"Unknown dataset_id: {dataset_id!r}")
    throw new Error(`Unknown dataset_id: '${params.datasetId}'`)
  }
  const provenance = datasetCatalogRegistry.getProvenance(params.datasetId)
  // A loaded catalog always has provenance (both come from the same
  // registry entry — mirrors the Python `assert provenance is not None`).
  if (provenance === null) throw new Error(`invariant violated: catalog loaded with no provenance for '${params.datasetId}'`)

  const end = params.limit == null ? undefined : offset + params.limit
  const songs = catalog.slice(offset, end)
  return { provenance, total: catalog.length, songs }
}
