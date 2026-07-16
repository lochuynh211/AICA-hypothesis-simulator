/**
 * proposalClient — skeleton typed client for the `/api/proposal/*` endpoints
 * (P1 T004).
 *
 * Follows `api/client.ts` conventions: a thin `apiFetch` wrapper over the
 * platform `fetch`, relative paths (no absolute host — the Vite dev-server
 * proxy and the production container both serve the API same-origin), and
 * throws on a non-OK response. Endpoint methods and response types are added
 * in later tasks (T020+) once the backend router (T018) exists; this module
 * only establishes the base-URL convention so those additions are additive.
 */

/** Base path for every Proposal Simulator endpoint. */
export const PROPOSAL_API_BASE = '/api/proposal'

// ── Internal helper (mirrors api/client.ts's apiFetch) ──────────────────────

async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${PROPOSAL_API_BASE}${path}`, init)
  if (!response.ok) {
    throw new Error(`Proposal API error: ${response.status}`)
  }
  return response.json() as Promise<T>
}

// Re-exported for future endpoint methods added in later tasks; referencing
// it here (as a no-op type-only usage) keeps the linter from flagging an
// unused import while the skeleton has no endpoints yet.
export type ProposalApiFetch = typeof apiFetch
