# Contract: maps_client (stdlib-urllib Directions + Places)

`services/maps_client.py` — the **only** module that touches the BYO key and the Google
APIs. Pure I/O at the edge; everything above it works on its returned plain dicts.

## Functions
- `directions(key, start, end) -> list[RawRoute]` — calls Google Directions for the
  start/end (free-text addresses; Directions geocodes them). Returns up to 3 raw route
  alternatives (legs, steps, distance/duration, encoded polyline, road hints). Raises
  `MapsError(error_type, message)` on transport/HTTP/quota/invalid-key failure.
- `places_rest_stops(key, polyline, context) -> list[RawPlace]` — finds rest POIs near the
  route, biased by `context` (highway → service/parking area; else convenience store).
  Returns raw POIs (location, distance-along-route, type). Raises `MapsError` on failure;
  an empty result is NOT an error (it means "none found").

## Key handling
- `key` is a parameter only; never stored on the module, never logged. Error messages MUST
  NOT include the key or full request URL with the key.

## Errors
`MapsError(error_type ∈ {"directions_failure","places_failure","invalid_key","quota"},
message)`. Callers map: directions failure → analyze error (retry + local fallback);
places failure → degraded-data rest fallback (see route_analysis).

## Testing (offline)
- Injectable transport (e.g. a `_urlopen` seam or a fetcher callable) so tests feed
  **recorded Google JSON fixtures** — **no live network in any test**.
- Fixtures cover: 1–3 alternatives; a route with service-area POIs (highway); a route with
  convenience-store POIs; an empty Places result; a Directions failure; a Places failure;
  an invalid-key failure.
- A test asserts the key never appears in any raised error message or constructed log line.
