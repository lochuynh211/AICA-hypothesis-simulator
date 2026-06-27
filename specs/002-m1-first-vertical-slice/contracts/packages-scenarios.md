# Contract: Package & Scenario registry endpoints

All JSON. No auth (local single-user).

## `GET /api/packages`
- **200** → `{ "packages": [PackageSummary], "errors": [RegistryError] }`
  - `PackageSummary`: `{ id, version, label{ja,en}, algorithm_type, compatible_scenario_types }`
  - `RegistryError`: `{ source: "<filename>", message }` — invalid manifests are
    reported here, **not** silently dropped (FR-002). They never appear in `packages`.

## `GET /api/packages/{package_id}`
- **200** → full `PackageManifest` (data-model).
- **404** → `{ detail }` if not found or invalid (invalid is not selectable).

## `GET /api/scenarios`
- **200** → `{ "scenarios": [ScenarioSummary], "errors": [RegistryError] }`
  - `ScenarioSummary`: `{ id, version, type, persona_label, review_focus }`

## `GET /api/scenarios/{scenario_id}`
- **200** → full `ScenarioDef`.
- **404** → invalid/not found.

## Contract tests
- Valid fixture package/scenario appear in the list with correct summary fields.
- An invalid manifest fixture appears in `errors` with a clear message and is absent
  from `packages`; `GET /{id}` for it is 404.
- Detail endpoints return the full validated model for the valid fixtures.
