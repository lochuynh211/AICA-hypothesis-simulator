"""Pure, offline HTML renderer for the semantic Combined experience catalog."""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from html import escape
import hashlib
import json
import re
from typing import Any


_STATUSES = (
    "MATCH",
    "PARTIAL_MATCH",
    "MISMATCH",
    "NOT_EVALUATED",
    "UNVERIFIABLE",
    "EXECUTION_ERROR",
    "EXPECTED_LIMITATION",
)

_VERDICT_COPY = {
    "MATCH": "Appropriate for this hypothesis",
    "PARTIAL_MATCH": "Partly appropriate; review details",
    "MISMATCH": "Not appropriate for this hypothesis",
    "NOT_EVALUATED": "Not evaluated",
    "UNVERIFIABLE": "Not verifiable from recorded evidence",
    "EXECUTION_ERROR": "Execution error",
    "EXPECTED_LIMITATION": "Expected frozen-package limitation",
}

_AUDIT_KEYS = (
    "request_sha256",
    "canonical_request_sha256",
    "response_sha256",
    "normalized_response_sha256",
    "http_status",
    "request",
    "request_snapshot",
    "canonical_request",
    "response",
    "response_evidence",
    "normalized_response",
    "provenance",
    "package_ids",
)

_RAW_KEYS = {
    "raw",
    "raw_body",
    "raw_payload",
    "raw_request",
    "raw_response",
    "request_body",
    "response_body",
}

_EXTERNAL_URL_RE = re.compile(r"https?://[^\s<>'\"\\]*", flags=re.IGNORECASE)
_EXTERNAL_URL_REDACTION = "[external URL redacted]"
_AUDIT_SECTION_CHAR_BUDGET = 16_384
_AUDIT_PREVIEW_VALUE_BUDGET = 8_000
_AUDIT_INLINE_STRING_LIMIT = 1_024


def _redact_external_urls(value: str) -> str:
    return _EXTERNAL_URL_RE.sub(_EXTERNAL_URL_REDACTION, value)


def _redact_value(value: Any) -> Any:
    if isinstance(value, str):
        return _redact_external_urls(value)
    if isinstance(value, Mapping):
        return {
            _redact_external_urls(str(key)): _redact_value(item)
            for key, item in value.items()
        }
    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        return [_redact_value(item) for item in value]
    return value


def _mapping(value: Any) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _sequence(value: Any) -> list[Any]:
    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        return list(value)
    return []


def _first(*values: Any) -> Any:
    for value in values:
        if value is not None:
            return value
    return None


def _get(value: Any, *path: str) -> Any:
    current = value
    for part in path:
        current = _mapping(current).get(part)
        if current is None:
            return None
    return current


def _text(value: Any) -> str:
    """Return recorded human text, retaining both authored languages."""
    if value is None:
        return ""
    if isinstance(value, Mapping):
        en = value.get("en")
        ja = value.get("ja")
        parts = [
            _display(item, missing="") for item in (en, ja) if item not in (None, "")
        ]
        if parts:
            return " / ".join(dict.fromkeys(parts))
        return _display(value)
    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        return "; ".join(filter(None, (_text(item) for item in value)))
    return _display(value, missing="")


def _display(value: Any, *, missing: str = "Not recorded") -> str:
    if value is None:
        return missing
    if isinstance(value, str):
        return _redact_external_urls(value)
    if isinstance(value, (Mapping, list, tuple)):
        return json.dumps(
            _redact_value(value),
            ensure_ascii=False,
            sort_keys=True,
            default=lambda item: _redact_external_urls(str(item)),
        )
    if isinstance(value, bool):
        return "true" if value else "false"
    return _redact_external_urls(str(value))


def _cell(value: Any, *, missing: str = "Not recorded") -> str:
    return escape(_display(value, missing=missing), quote=True)


def _escape_dynamic(value: Any, *, quote: bool = True) -> str:
    return escape(_display(value, missing=""), quote=quote)


def _slug(value: Any) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", str(value or "").lower()).strip("-")
    return slug or "record"


def _flatten_rows(
    value: Any, prefix: str = "", *, depth: int = 0
) -> list[tuple[str, Any]]:
    if depth > 8:
        return [(prefix, "[nested value omitted]")]
    if isinstance(value, Mapping):
        if not value:
            return [(prefix, {})] if prefix else []
        rows: list[tuple[str, Any]] = []
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if isinstance(item, Mapping):
                rows.extend(_flatten_rows(item, path, depth=depth + 1))
            else:
                rows.append((path, item))
        return rows
    return [(prefix or "value", value)]


def _table(
    headers: Sequence[str],
    rows: Sequence[Sequence[Any]],
    *,
    empty: str,
    css_class: str = "",
) -> str:
    if not rows:
        return f'<p class="empty">{escape(empty)}</p>'
    class_attribute = f' class="{escape(css_class, quote=True)}"' if css_class else ""
    head = "".join(f"<th scope=\"col\">{escape(header)}</th>" for header in headers)
    body = "".join(
        "<tr>" + "".join(f"<td>{_cell(value)}</td>" for value in row) + "</tr>"
        for row in rows
    )
    return (
        f"<div class=\"table-scroll\"><table{class_attribute}>"
        f"<thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>"
    )


def _case_result_index(suite: Mapping[str, Any]) -> dict[str, Mapping[str, Any]]:
    index: dict[str, Mapping[str, Any]] = {}
    for value in _sequence(suite.get("case_results")):
        result = _mapping(value)
        for key in ("case_id", "display_id"):
            identifier = result.get(key)
            if identifier not in (None, ""):
                index[str(identifier)] = result
    return index


def _find_result(
    case: Mapping[str, Any], index: Mapping[str, Mapping[str, Any]]
) -> Mapping[str, Any]:
    for key in ("case_id", "display_id"):
        identifier = case.get(key)
        if identifier not in (None, "") and str(identifier) in index:
            return index[str(identifier)]
    return {}


def _profile_for_case(
    catalog: Mapping[str, Any], case: Mapping[str, Any]
) -> tuple[str, Mapping[str, Any]]:
    persona = _mapping(case.get("persona"))
    reference = _first(
        persona.get("profile_ref"),
        _get(case, "journey", "profile_ref"),
        case.get("profile_ref"),
    )
    direct = _first(case.get("profile"), _get(case, "journey", "profile"))
    if isinstance(direct, Mapping):
        return _display(reference, missing=""), direct
    for value in _sequence(catalog.get("profiles")):
        profile = _mapping(value)
        identifier = _first(profile.get("profile_id"), profile.get("id"))
        if reference is not None and identifier == reference:
            return str(reference), _mapping(profile.get("profile")) or profile
    return _display(reference, missing=""), {}


def _first_mapping(*values: Any) -> Mapping[str, Any]:
    for value in values:
        if isinstance(value, Mapping) and value:
            return value
    return {}


def _resolved_input_facts(
    result: Mapping[str, Any],
) -> tuple[Mapping[str, Any], Mapping[str, Any]]:
    """Read runner-enriched facts without requiring one orchestration wrapper."""
    actual = _mapping(result.get("actual"))
    audit = _mapping(result.get("audit"))
    facts = _first_mapping(
        result.get("resolved_inputs"),
        result.get("input_facts"),
        result.get("resolved_facts"),
        actual.get("resolved_inputs"),
        actual.get("input_facts"),
        audit.get("resolved_inputs"),
        audit.get("input_facts"),
    )
    scenario = _first_mapping(
        result.get("resolved_scenario"),
        result.get("scenario_snapshot"),
        facts.get("scenario"),
        facts.get("resolved_scenario"),
        facts.get("scenario_snapshot"),
        actual.get("resolved_scenario"),
        audit.get("resolved_scenario"),
        audit.get("scenario_snapshot"),
    )
    profile = _first_mapping(
        result.get("resolved_profile"),
        result.get("profile_snapshot"),
        facts.get("profile"),
        facts.get("resolved_profile"),
        facts.get("profile_snapshot"),
        actual.get("resolved_profile"),
        audit.get("resolved_profile"),
        audit.get("profile_snapshot"),
    )

    request = _first_mapping(
        result.get("request"),
        result.get("request_snapshot"),
        audit.get("request"),
        audit.get("request_snapshot"),
    )
    if not scenario and request:
        scenario = _first_mapping(
            request.get("scenario"),
            request.get("resolved_scenario"),
            request.get("scenario_snapshot"),
        )
        if not scenario:
            scenario = {
                key: request[key]
                for key in (
                    "scenario_id",
                    "initial_state",
                    "context_overrides",
                    "tick_seconds",
                    "run_seed",
                )
                if key in request
            }
    if not profile and request:
        world = _mapping(request.get("world"))
        profile = _first_mapping(
            request.get("profile"),
            request.get("resolved_profile"),
            request.get("profile_snapshot"),
            world.get("driver_profile"),
        )
    return scenario, profile


def _package_ids(
    catalog: Mapping[str, Any], suite: Mapping[str, Any]
) -> list[tuple[str, str]]:
    candidates = [
        _get(suite, "provenance", "package_ids"),
        suite.get("package_ids"),
        _get(suite, "summary", "package_ids"),
    ]
    packages: dict[str, str] = {}
    for candidate in candidates:
        for stage, value in _mapping(candidate).items():
            package_id = (
                _first(value.get("package_id"), value.get("id"))
                if isinstance(value, Mapping)
                else value
            )
            if package_id not in (None, ""):
                packages[str(stage)] = str(package_id)
    for value in _sequence(catalog.get("cases")):
        defaults = _mapping(_mapping(value).get("algorithm_defaults"))
        for stage, package_id in defaults.items():
            if package_id not in (None, ""):
                packages.setdefault(str(stage), str(package_id))
    ordered = [
        (stage, packages.pop(stage))
        for stage in ("trigger", "service", "content")
        if stage in packages
    ]
    ordered.extend(sorted(packages.items()))
    return ordered


def _verdict_counts(suite: Mapping[str, Any]) -> dict[str, int]:
    recorded = _mapping(_get(suite, "summary", "verdict_counts"))
    observed = Counter(
        str(result.get("verdict"))
        for result in map(_mapping, _sequence(suite.get("case_results")))
        if result.get("verdict") not in (None, "")
    )
    counts: dict[str, int] = {}
    for status in _STATUSES:
        value = recorded.get(status, observed.get(status, 0))
        try:
            counts[status] = int(value)
        except (TypeError, ValueError):
            counts[status] = observed.get(status, 0)
    for status, value in recorded.items():
        if str(status) not in counts:
            try:
                counts[str(status)] = int(value)
            except (TypeError, ValueError):
                continue
    return counts


def _group_counts(
    catalog: Mapping[str, Any], suite: Mapping[str, Any]
) -> dict[str, int]:
    recorded = _mapping(_get(suite, "summary", "group_counts"))
    if recorded:
        result: dict[str, int] = {}
        for key, value in recorded.items():
            try:
                result[str(key)] = int(value)
            except (TypeError, ValueError):
                continue
        return result
    return dict(
        Counter(
            str(case.get("group"))
            for case in map(_mapping, _sequence(catalog.get("cases")))
            if case.get("group") not in (None, "")
        )
    )


def _overview(catalog: Mapping[str, Any], suite: Mapping[str, Any]) -> str:
    counts = _verdict_counts(suite)
    count_cards = "".join(
        (
            f'<li class="count-card status-{_slug(status)}">'
            f"<span>{_escape_dynamic(status.replace('_', ' ').title())}</span>"
            f"<strong>{count}</strong></li>"
        )
        for status, count in counts.items()
    )
    group_rows = [
        (group.replace("_", " ").title(), count)
        for group, count in sorted(_group_counts(catalog, suite).items())
    ]
    package_rows = [
        (stage.replace("_", " ").title(), package_id)
        for stage, package_id in _package_ids(catalog, suite)
    ]
    summary = _mapping(suite.get("summary"))
    total = _first(summary.get("total_cases"), len(_sequence(catalog.get("cases"))))
    metadata_rows = [
        ("Catalog", catalog.get("catalog_id")),
        ("Catalog version", catalog.get("catalog_version")),
        ("Case schema version", catalog.get("case_schema_version")),
        ("Reference time", catalog.get("reference_time")),
        ("Evaluator version", suite.get("evaluator_version")),
        ("Generated at", _first(suite.get("generated_at"), suite.get("execution_timestamp"))),
        ("Cases", total),
    ]
    metadata_rows = [row for row in metadata_rows if row[1] not in (None, "")]

    findings_value = _first(
        suite.get("findings"),
        suite.get("key_findings"),
        summary.get("findings"),
        summary.get("key_findings"),
    )
    finding_items: list[str] = []
    for value in _sequence(findings_value):
        if isinstance(value, Mapping):
            title = _first(value.get("title"), value.get("finding"), value.get("name"))
            explanation = _first(
                value.get("explanation"), value.get("message"), value.get("detail")
            )
            case_ids = _sequence(value.get("case_ids"))
            pieces = []
            if title not in (None, ""):
                pieces.append(f"<strong>{escape(_text(title))}</strong>")
            if explanation not in (None, ""):
                pieces.append(escape(_text(explanation)))
            if case_ids:
                pieces.append(
                    f"<small>Cases: {_escape_dynamic(', '.join(map(str, case_ids)))}</small>"
                )
            finding_items.append("<li>" + " ".join(pieces) + "</li>")
        elif value not in (None, ""):
            finding_items.append(f"<li>{escape(_text(value))}</li>")
    findings = (
        "<ul class=\"findings\">" + "".join(finding_items) + "</ul>"
        if finding_items
        else '<p class="empty">No suite-level findings recorded.</p>'
    )

    return f"""
    <section class="overview" aria-labelledby="overview-heading">
      <h2 id="overview-heading">Overview</h2>
      <p>This report covers moving-vehicle rest and monotony hypotheses, the
      immediate service proposal, and content only when the selected service
      supports it. Rest-place and post-rest behavior are out of scope.</p>
      <p class="caveat">Verdicts describe fit against authored simulator
      hypotheses. They are not medical validation, road-safety certification,
      or evidence of physical-world causality.</p>
      {_table(("Field", "Recorded value"), metadata_rows, empty="No report metadata recorded.")}
      <h3>Frozen algorithm packages</h3>
      {_table(("Stage", "Package ID"), package_rows, empty="No package IDs recorded.")}
      <h3>Verdict distribution</h3>
      <ul class="count-grid">{count_cards}</ul>
      <h3>Coverage by group</h3>
      {_table(("Group", "Cases"), group_rows, empty="No group coverage recorded.")}
      <h3>Key findings</h3>
      {findings}
    </section>
    """


def _filters(catalog: Mapping[str, Any]) -> str:
    cases = [_mapping(value) for value in _sequence(catalog.get("cases"))]
    groups = sorted(
        {str(case.get("group")) for case in cases if case.get("group") not in (None, "")}
    )
    triggers = sorted(
        {
            str(_get(case, "expectations", "trigger", "outcome"))
            for case in cases
            if _get(case, "expectations", "trigger", "outcome") not in (None, "")
        }
    )
    roles = sorted(
        {
            str(_get(case, "contrast", "role"))
            for case in cases
            if _get(case, "contrast", "role") not in (None, "")
        }
    )

    def options(values: Sequence[str]) -> str:
        return "".join(
            f'<option value="{_escape_dynamic(value, quote=True)}">'
            f"{_escape_dynamic(value.replace('_', ' ').title())}</option>"
            for value in values
        )

    return f"""
    <section class="filters" aria-label="Case filters">
      <label for="filter-group">Group
        <select id="filter-group" aria-label="Filter by group">
          <option value="">All groups</option>{options(groups)}
        </select>
      </label>
      <label for="filter-trigger">Expected trigger
        <select id="filter-trigger" aria-label="Filter by expected trigger">
          <option value="">All trigger expectations</option>{options(triggers)}
        </select>
      </label>
      <label for="filter-verdict">Verdict
        <select id="filter-verdict" aria-label="Filter by verdict">
          <option value="">All verdicts</option>{options(_STATUSES)}
        </select>
      </label>
      <label for="filter-role">Contrast role
        <select id="filter-role" aria-label="Filter by contrast role">
          <option value="">All contrast roles</option>{options(roles)}
        </select>
      </label>
      <button id="filter-reset" type="button">Reset filters</button>
      <p id="visible-count" class="visible-count" aria-live="polite"></p>
    </section>
    """


def _summary_value_for_fire(selected: Any, actual: Mapping[str, Any]) -> str:
    if isinstance(selected, Mapping):
        category = _display(selected.get("category"), missing="Category not recorded")
        time_min = selected.get("time_min")
        if time_min is not None:
            return f"{category} at {_display(time_min)} min"
        return category
    if actual.get("fire_count") == 0 or actual.get("fires") == []:
        return "No in-scope fire"
    return "No selected fire recorded"


def _setup_section(case: Mapping[str, Any]) -> str:
    persona = _mapping(case.get("persona"))
    journey = _mapping(case.get("journey"))
    real_world = _mapping(case.get("real_world"))
    rows: list[tuple[str, Any]] = []
    for label, value in (
        ("Persona", persona.get("name")),
        ("Persona narrative", persona.get("narrative")),
        ("Journey", journey.get("narrative")),
        ("Why this case matters", case.get("purpose")),
        ("Case summary", case.get("brief")),
    ):
        if value not in (None, ""):
            rows.append((label, _text(value)))
    for key, value in real_world.items():
        if value not in (None, "", [], {}):
            rows.append((str(key).replace("_", " ").title(), _text(value)))
    watch = _sequence(case.get("what_to_watch"))
    if watch:
        rows.append(("What to watch", "; ".join(_text(value) for value in watch)))
    return (
        "<section><h4>Full real-world setup</h4>"
        + _table(
            ("Story element", "Authored setup"),
            rows,
            empty="No real-world setup recorded.",
        )
        + "</section>"
    )


def _input_section(
    catalog: Mapping[str, Any],
    case: Mapping[str, Any],
    result: Mapping[str, Any],
) -> str:
    journey = _mapping(case.get("journey"))
    scenario = _mapping(journey.get("scenario"))
    scenario_rows = _flatten_rows(scenario)
    profile_ref, profile = _profile_for_case(catalog, case)
    profile_rows = _flatten_rows(profile)
    if profile_ref:
        profile_rows.insert(0, ("profile_ref", profile_ref))
    journey_rows: list[tuple[str, Any]] = []
    for key in (
        "scenario_ref",
        "route_preset_ref",
        "seed",
        "tick_seconds",
        "fixed_overrides",
        "automatic_path",
    ):
        if key in journey:
            journey_rows.extend(_flatten_rows(journey[key], f"journey.{key}"))
    resolved_scenario, resolved_profile = _resolved_input_facts(result)
    resolved_scenario_rows = _flatten_rows(
        resolved_scenario, "resolved_scenario"
    )
    resolved_profile_rows = _flatten_rows(resolved_profile, "resolved_profile")
    return (
        "<section><h4>Exact relevant inputs</h4>"
        "<h5>Compiled journey references and pins</h5>"
        + _table(
            ("Input path", "Recorded value"),
            journey_rows,
            empty="No compiled journey references or pins recorded.",
        )
        + "<h5>Inline authored scenario recipe</h5>"
        + _table(
            ("Input path", "Recorded value"),
            scenario_rows,
            empty="No scenario inputs recorded.",
        )
        + "<h5>Catalog driver profile and history</h5>"
        + _table(
            ("Input path", "Recorded value"),
            profile_rows,
            empty="No profile values recorded.",
        )
        + "<h5>Runner-resolved scenario facts</h5>"
        + _table(
            ("Input path", "Recorded value"),
            resolved_scenario_rows,
            empty="No runner-resolved scenario facts recorded.",
        )
        + "<h5>Runner-resolved profile facts</h5>"
        + _table(
            ("Input path", "Recorded value"),
            resolved_profile_rows,
            empty="No runner-resolved profile facts recorded.",
        )
        + "</section>"
    )


def _expectation_section(case: Mapping[str, Any]) -> str:
    expectations = _mapping(case.get("expectations"))
    rows = _flatten_rows(expectations)
    rationale = _text(_get(case, "hypothesis", "rationale"))
    rationale_html = (
        f"<p><strong>Rationale:</strong> {escape(rationale)}</p>"
        if rationale
        else '<p class="empty">No rationale recorded.</p>'
    )
    return (
        "<section><h4>Expected behavior and rationale</h4>"
        + rationale_html
        + _table(
            ("Expectation", "Authored value"),
            rows,
            empty="No expectations recorded.",
        )
        + "</section>"
    )


def _timeline_section(actual: Mapping[str, Any]) -> str:
    fires = [_mapping(value) for value in _sequence(actual.get("fires"))]
    selected = _mapping(actual.get("selected_fire"))
    if not fires and selected:
        fires = [selected]
    rows = [
        (
            fire.get("category"),
            fire.get("occurrence"),
            fire.get("tick"),
            fire.get("time_min"),
            fire.get("strength"),
            fire.get("score"),
        )
        for fire in fires
    ]
    if not rows and (actual.get("fire_count") == 0 or actual.get("fires") == []):
        empty = "No in-scope fire was recorded."
    else:
        empty = "No fire timeline recorded."
    return (
        "<section><h4>Actual fire timeline</h4>"
        + _table(
            ("Category", "Occurrence", "Tick", "Time (min)", "Strength", "Score"),
            rows,
            empty=empty,
        )
        + "</section>"
    )


def _checks_section(result: Mapping[str, Any]) -> str:
    rows = []
    for value in _sequence(result.get("checks")):
        check = _mapping(value)
        rows.append(
            (
                check.get("check_id"),
                check.get("stage"),
                check.get("expected"),
                check.get("actual"),
                check.get("status"),
                check.get("explanation"),
                check.get("evidence_path"),
            )
        )
    return (
        "<section><h4>Expected vs actual</h4>"
        + _table(
            (
                "Check",
                "Stage",
                "Expected",
                "Actual",
                "Status",
                "Explanation",
                "Evidence path",
            ),
            rows,
            empty="No evaluator checks recorded.",
        )
        + "</section>"
    )


def _trigger_section(actual: Mapping[str, Any]) -> str:
    selected = _mapping(actual.get("selected_fire"))
    chain = _mapping(
        _get(selected, "feature_contributions", str(selected.get("category")))
    )
    rows_value = _first(selected.get("rows"), chain.get("rows"))
    gates_value = _first(selected.get("gates"), chain.get("gates"))
    contribution_rows = []
    for value in _sequence(rows_value):
        row = _mapping(value)
        contribution_rows.append(
            (
                row.get("feature_id"),
                _first(row.get("value"), row.get("feature_value")),
                row.get("band"),
                row.get("weight"),
                row.get("contribution"),
            )
        )
    gate_rows = []
    for value in _sequence(gates_value):
        gate = _mapping(value)
        gate_rows.append(
            (
                _first(gate.get("gate_id"), gate.get("feature_id"), gate.get("name")),
                _first(gate.get("passed"), gate.get("is_open"), gate.get("value")),
                _first(gate.get("explanation"), gate.get("reason")),
            )
        )
    score = _first(selected.get("score"), chain.get("score"))
    score_html = (
        f"<p><strong>Selected trigger score:</strong> {_cell(score)}</p>"
        if score is not None
        else ""
    )
    return (
        "<section><h4>Trigger contributions and gates</h4>"
        + score_html
        + _table(
            ("Feature", "Value", "Band", "Weight", "Contribution"),
            contribution_rows,
            empty="No trigger contribution rows recorded.",
        )
        + "<h5>Gates</h5>"
        + _table(
            ("Gate", "Observed state", "Explanation"),
            gate_rows,
            empty="No trigger gates recorded.",
        )
        + "</section>"
    )


def _strongest_evidence(
    candidate: Mapping[str, Any], *, positive: bool
) -> str:
    rows = [_mapping(value) for value in _sequence(candidate.get("feature_contributions"))]
    eligible = []
    for row in rows:
        contribution = row.get("contribution")
        if isinstance(contribution, (int, float)) and (
            contribution > 0 if positive else contribution < 0
        ):
            eligible.append(row)
    if eligible:
        strongest = (
            max(eligible, key=lambda row: float(row["contribution"]))
            if positive
            else min(eligible, key=lambda row: float(row["contribution"]))
        )
        feature = _first(strongest.get("feature_id"), "Feature not recorded")
        value = _first(strongest.get("feature_value"), strongest.get("value"))
        parts = [str(feature)]
        if value is not None:
            parts.append(f"value={_display(value)}")
        parts.append(f"contribution={_display(strongest.get('contribution'))}")
        return "; ".join(parts)
    ids_key = "supporting_feature_ids" if positive else "opposing_feature_ids"
    ids = _sequence(candidate.get(ids_key))
    return ", ".join(map(str, ids)) if ids else "Not recorded"


def _service_section(actual: Mapping[str, Any]) -> str:
    service_value = actual.get("service")
    if not isinstance(service_value, Mapping):
        return (
            "<section><h4>Ranked services and evidence</h4>"
            '<p class="empty">No service result recorded.</p></section>'
        )
    service = _mapping(service_value)
    candidates = [_mapping(value) for value in _sequence(service.get("ranked_candidates"))]
    candidates.sort(
        key=lambda value: (
            value.get("rank") if isinstance(value.get("rank"), (int, float)) else 10**9
        )
    )
    rows = [
        (
            candidate.get("rank"),
            _first(
                candidate.get("candidate_id"),
                candidate.get("service_id"),
                candidate.get("id"),
            ),
            candidate.get("score"),
            _strongest_evidence(candidate, positive=True),
            _strongest_evidence(candidate, positive=False),
        )
        for candidate in candidates[:3]
    ]
    error = _mapping(service.get("error"))
    error_html = (
        "<p class=\"error\"><strong>Service error:</strong> "
        + escape(_text(_first(error.get("message"), error.get("category"))))
        + "</p>"
        if error
        else ""
    )
    insufficiency_html = (
        '<p class="limitation"><strong>Ranked-service insufficiency:</strong> '
        f"Only {len(candidates)} of 3 ranked services were recorded.</p>"
        if len(candidates) < 3
        else ""
    )
    return (
        "<section><h4>Ranked services and evidence</h4>"
        + error_html
        + insufficiency_html
        + _table(
            ("Rank", "Service", "Score", "Strongest support", "Strongest opposition"),
            rows,
            empty="No ranked service candidates recorded.",
        )
        + "</section>"
    )


def _names(value: Any) -> str:
    names = []
    for item in _sequence(value):
        if isinstance(item, Mapping):
            recorded = _first(item.get("name"), item.get("title"), item.get("id"))
            if recorded not in (None, ""):
                names.append(str(recorded))
        elif item not in (None, ""):
            names.append(str(item))
    if names:
        return ", ".join(names)
    return _text(value)


def _content_section(actual: Mapping[str, Any]) -> str:
    content_value = actual.get("content")
    if not isinstance(content_value, Mapping):
        return (
            "<section><h4>Content plan</h4>"
            '<p class="empty">No content result recorded.</p></section>'
        )
    content = _mapping(content_value)
    items = [_mapping(value) for value in _sequence(content.get("ordered_items"))]
    rows = []
    for item in items[:5]:
        metadata = _mapping(
            _first(item.get("catalog_metadata"), item.get("track"), item.get("metadata"))
        )
        traits = _mapping(
            _first(item.get("trait_values"), item.get("audio_features"))
        )
        metadata_traits = _mapping(
            _first(metadata.get("trait_values"), metadata.get("audio_features"))
        )
        rows.append(
            (
                _first(item.get("position"), item.get("rank")),
                _first(item.get("item_id"), item.get("track_id"), item.get("id")),
                _first(item.get("title"), metadata.get("title")),
                _names(
                    _first(
                        item.get("artist_names"),
                        item.get("artists"),
                        item.get("artist_ids"),
                        metadata.get("artist_names"),
                        metadata.get("artists"),
                        metadata.get("artist_ids"),
                    )
                ),
                _names(
                    _first(
                        item.get("genres"),
                        item.get("realized_genres"),
                        item.get("genre"),
                        metadata.get("genres"),
                        metadata.get("realized_genres"),
                        metadata.get("genre"),
                    )
                ),
                _first(traits.get("arousal"), metadata_traits.get("arousal")),
                _first(traits.get("valence"), metadata_traits.get("valence")),
                _first(item.get("item_fit"), item.get("score")),
            )
        )
    stage = _first(
        content.get("stage_outcome"),
        content.get("expected_stage_outcome"),
        content.get("decision_type"),
    )
    error = _mapping(content.get("error"))
    limitation_parts = []
    if stage not in (None, "", "complete_plan"):
        limitation_parts.append(f"Stage outcome: {_display(stage)}.")
    if error:
        category = error.get("category")
        message = error.get("message")
        if category not in (None, ""):
            limitation_parts.append(f"Category: {_display(category)}.")
        if message not in (None, ""):
            limitation_parts.append(_display(message))
    limitation = (
        '<p class="limitation"><strong>Content limitation/error:</strong> '
        + escape(" ".join(limitation_parts))
        + "</p>"
        if limitation_parts
        else ""
    )
    insufficiency = (
        '<p class="limitation"><strong>Complete-plan insufficiency:</strong> '
        f"Only {len(items)} of 5 content items were recorded for a complete plan."
        "</p>"
        if stage == "complete_plan" and len(items) < 5
        else ""
    )
    return (
        "<section><h4>Content plan</h4>"
        + limitation
        + insufficiency
        + _table(
            (
                "Position",
                "Track ID",
                "Catalog title",
                "Artist",
                "Genre",
                "Arousal",
                "Valence",
                "Fit",
            ),
            rows,
            empty="No content items recorded.",
        )
        + "</section>"
    )


def _contrast_section(
    case: Mapping[str, Any],
    result: Mapping[str, Any],
    case_targets: Mapping[str, str],
) -> str:
    contrast = _mapping(case.get("contrast"))
    delta = _mapping(result.get("contrast_delta"))
    with_case_id = _first(contrast.get("with_case_id"), delta.get("with_case_id"))
    target = (
        case_targets.get(str(with_case_id))
        if with_case_id not in (None, "")
        else None
    )
    link = (
        f'<p><strong>Paired case:</strong> <a href="#{_escape_dynamic(target, quote=True)}">'
        f"{_escape_dynamic(with_case_id)}</a></p>"
        if target
        else ""
    )
    metadata_rows = [
        (key, _text(value) if isinstance(value, Mapping) else value)
        for key, value in contrast.items()
        if value not in (None, "", [], {})
    ]
    delta_rows = [
        (key, value) for key, value in delta.items() if value is not None
    ]
    return (
        "<section><h4>Contrast and observed delta</h4>"
        + link
        + _table(
            ("Contrast field", "Authored value"),
            metadata_rows,
            empty="No contrast metadata recorded.",
        )
        + "<h5>Observed delta</h5>"
        + _table(
            ("Metric", "Recorded delta"),
            delta_rows,
            empty="No contrast delta recorded.",
        )
        + "</section>"
    )


def _update_structural_hash(digest: Any, value: Any) -> None:
    """Hash a JSON-like value without serializing a large subtree in memory."""
    if isinstance(value, Mapping):
        digest.update(b"{")
        for key in sorted(value, key=lambda item: str(item)):
            _update_structural_hash(digest, str(key))
            _update_structural_hash(digest, value[key])
        digest.update(b"}")
        return
    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        digest.update(b"[")
        for item in value:
            _update_structural_hash(digest, item)
        digest.update(b"]")
        return
    if isinstance(value, str):
        digest.update(b"s")
        for start in range(0, len(value), 8_192):
            digest.update(value[start : start + 8_192].encode("utf-8"))
        return
    if isinstance(value, (bytes, bytearray)):
        digest.update(b"b")
        for start in range(0, len(value), 8_192):
            digest.update(value[start : start + 8_192])
        return
    digest.update(type(value).__name__.encode("ascii", errors="replace"))
    digest.update(
        json.dumps(value, ensure_ascii=False, sort_keys=True, default=str).encode(
            "utf-8"
        )
    )


def _structural_sha256(value: Any) -> str:
    digest = hashlib.sha256()
    _update_structural_hash(digest, value)
    return digest.hexdigest()


def _omission_marker(value: Any) -> dict[str, Any]:
    marker: dict[str, Any] = {
        "_omitted": True,
        "_sha256": _structural_sha256(value),
        "_type": type(value).__name__,
    }
    if isinstance(value, (Mapping, Sequence)) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        marker["_item_count"] = len(value)
    elif isinstance(value, (str, bytes, bytearray)):
        marker["_character_count"] = len(value)
    return marker


def _audit_preview(value: Any, state: dict[str, Any], *, depth: int = 0) -> Any:
    """Create one globally budgeted audit view without copying large strings."""
    if depth >= 7 or state["remaining"] < 256:
        state["truncated"] = True
        marker = _omission_marker(value)
        state["remaining"] -= len(json.dumps(marker, ensure_ascii=False))
        return marker

    if isinstance(value, str):
        safe = _redact_external_urls(value)
        if len(value) > _AUDIT_INLINE_STRING_LIMIT:
            state["truncated"] = True
            marker = _omission_marker(value)
            state["remaining"] -= len(json.dumps(marker, ensure_ascii=False))
            return marker
        cost = len(json.dumps(safe, ensure_ascii=False))
        if cost > state["remaining"]:
            state["truncated"] = True
            marker = _omission_marker(value)
            state["remaining"] -= len(json.dumps(marker, ensure_ascii=False))
            return marker
        state["remaining"] -= cost
        return safe

    if isinstance(value, Mapping):
        preview: dict[str, Any] = {}
        state["remaining"] -= 2
        items = list(value.items())
        for index, (key, item) in enumerate(items):
            normalized_key = str(key)
            lowered = normalized_key.lower()
            if lowered in _RAW_KEYS or lowered.startswith("raw_"):
                state["truncated"] = True
                preview[_redact_external_urls(normalized_key)] = _omission_marker(item)
                continue
            safe_key = _redact_external_urls(normalized_key)
            key_cost = len(json.dumps(safe_key, ensure_ascii=False)) + 2
            if state["remaining"] < key_cost + 256:
                state["truncated"] = True
                preview["_omitted_entry_count"] = len(items) - index
                break
            state["remaining"] -= key_cost
            preview[safe_key] = _audit_preview(item, state, depth=depth + 1)
        return preview

    if isinstance(value, Sequence) and not isinstance(
        value, (str, bytes, bytearray)
    ):
        preview_items = []
        state["remaining"] -= 2
        for index, item in enumerate(value):
            if state["remaining"] < 256:
                state["truncated"] = True
                preview_items.append(
                    {"_omitted_item_count": len(value) - index}
                )
                break
            preview_items.append(_audit_preview(item, state, depth=depth + 1))
        return preview_items

    safe = _redact_value(value)
    encoded = json.dumps(safe, ensure_ascii=False, sort_keys=True, default=str)
    if len(encoded) > state["remaining"]:
        state["truncated"] = True
        marker = _omission_marker(value)
        state["remaining"] -= len(json.dumps(marker, ensure_ascii=False))
        return marker
    state["remaining"] -= len(encoded)
    return safe


def _audit_summary(audit: Mapping[str, Any], payload_sha256: str) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key, value in audit.items():
        if key in {"request", "request_snapshot", "response", "normalized_response"}:
            summary[key] = _omission_marker(value)
        elif not isinstance(value, (Mapping, list, tuple)):
            summary[key] = _redact_value(value)
    summary["_audit_truncated"] = True
    summary["_omitted_payload_sha256"] = payload_sha256
    summary["_audit_section_character_budget"] = _AUDIT_SECTION_CHAR_BUDGET
    return summary


def _minimal_audit_summary(
    audit: Mapping[str, Any], payload_sha256: str
) -> dict[str, Any]:
    summary: dict[str, Any] = {}
    for key in ("request", "request_snapshot", "response", "normalized_response"):
        if key in audit:
            summary[key] = _omission_marker(audit[key])
    summary["_audit_truncated"] = True
    summary["_omitted_payload_sha256"] = payload_sha256
    summary["_audit_section_character_budget"] = _AUDIT_SECTION_CHAR_BUDGET
    return summary


def _audit_section(result: Mapping[str, Any]) -> str:
    recorded = _mapping(result.get("audit"))
    audit = {
        key: recorded[key]
        for key in _AUDIT_KEYS
        if key in recorded and recorded[key] is not None
    }
    for key in _AUDIT_KEYS:
        if key not in audit and key in result and result[key] is not None:
            audit[key] = result[key]
    if not audit:
        actual = _mapping(result.get("actual"))
        normalized = {
            key: actual[key]
            for key in ("fire_count", "fires", "selected_fire", "service", "content")
            if key in actual
        }
        if normalized:
            audit["normalized_evidence"] = normalized
        checks = _sequence(result.get("checks"))
        if checks:
            audit["evaluator_checks"] = checks
    payload_sha256 = _structural_sha256(audit)
    state = {
        "remaining": _AUDIT_PREVIEW_VALUE_BUDGET,
        "truncated": False,
    }
    preview = _audit_preview(audit, state)
    if state["truncated"]:
        preview["_audit_truncated"] = True
        preview["_omitted_payload_sha256"] = payload_sha256
        preview["_audit_section_character_budget"] = _AUDIT_SECTION_CHAR_BUDGET
    payload = json.dumps(
        preview, ensure_ascii=False, indent=2, sort_keys=True, default=str
    )
    section = (
        "<section><h4>Audit evidence</h4>"
        "<details><summary>Bounded request/response audit JSON</summary>"
        f"<pre>{escape(_redact_external_urls(payload), quote=False)}</pre>"
        "</details></section>"
    )
    if len(section) > _AUDIT_SECTION_CHAR_BUDGET:
        payload = json.dumps(
            _audit_summary(audit, payload_sha256),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            default=str,
        )
        section = (
            "<section><h4>Audit evidence</h4>"
            "<details><summary>Bounded request/response audit JSON</summary>"
            f"<pre>{escape(_redact_external_urls(payload), quote=False)}</pre>"
            "</details></section>"
        )
    if len(section) > _AUDIT_SECTION_CHAR_BUDGET:
        payload = json.dumps(
            _minimal_audit_summary(audit, payload_sha256),
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
            default=str,
        )
        section = (
            "<section><h4>Audit evidence</h4>"
            "<details><summary>Bounded request/response audit JSON</summary>"
            f"<pre>{escape(_redact_external_urls(payload), quote=False)}</pre>"
            "</details></section>"
        )
    return section


def _adjudication_section(result: Mapping[str, Any]) -> str:
    verdict = _display(result.get("verdict"), missing="No evaluator verdict recorded")
    customer_copy = _VERDICT_COPY.get(str(result.get("verdict")), verdict)
    explanation = _first(
        result.get("verdict_explanation"),
        result.get("adjudication"),
        result.get("explanation"),
    )
    caveat = _first(
        result.get("caveat"),
        "Simulator verdicts are hypothesis assessments, not road-safety certification.",
    )
    explanation_html = (
        f"<p>{escape(_text(explanation))}</p>"
        if explanation not in (None, "")
        else '<p class="empty">No case-level adjudication explanation recorded.</p>'
    )
    return (
        "<section><h4>Data-scientist verdict and caveat</h4>"
        f"<p class=\"verdict-copy\"><strong>{_escape_dynamic(customer_copy)}</strong> "
        f"<span>({_cell(verdict)})</span></p>"
        + explanation_html
        + f'<p class="caveat">{escape(_text(caveat))}</p></section>'
    )


def _case_detail(
    catalog: Mapping[str, Any],
    case: Mapping[str, Any],
    result: Mapping[str, Any],
    index: int,
    case_targets: Mapping[str, str],
) -> str:
    display_id = _first(case.get("display_id"), result.get("display_id"), case.get("case_id"))
    title = _text(case.get("title"))
    group = _display(case.get("group"), missing="")
    expected_trigger = _display(
        _get(case, "expectations", "trigger", "outcome"), missing=""
    )
    role = _display(_get(case, "contrast", "role"), missing="")
    verdict = _display(result.get("verdict"), missing="")
    actual = _mapping(result.get("actual"))
    selected = actual.get("selected_fire")
    service = _mapping(actual.get("service"))
    content = _mapping(actual.get("content"))
    rank_1 = _first(service.get("rank_1_id"), service.get("rank_1_service_id"))
    returned_count = _first(
        content.get("returned_count"),
        len(_sequence(content.get("ordered_items")))
        if "ordered_items" in content
        else None,
    )
    content_summary = _first(
        content.get("stage_outcome"),
        content.get("decision_type"),
        f"{returned_count} recorded item(s)" if returned_count is not None else None,
    )
    element_id = f"case-{index:03d}-{_slug(display_id)}"
    heading = " — ".join(part for part in (_display(display_id, missing=""), title) if part)
    if not heading:
        heading = "Case detail"
    story = _first(case.get("brief"), _get(case, "real_world", "trip_reason"))
    expected = _first(
        _get(case, "real_world", "expected_aica_behavior"),
        _get(case, "expectations", "trigger", "outcome"),
    )
    verdict_copy = _VERDICT_COPY.get(str(result.get("verdict")), verdict)

    return f"""
    <section class="case-detail"
      id="{escape(element_id, quote=True)}"
      data-group="{_escape_dynamic(group, quote=True)}"
      data-expected-trigger="{_escape_dynamic(expected_trigger, quote=True)}"
      data-verdict="{_escape_dynamic(verdict, quote=True)}"
      data-contrast-role="{_escape_dynamic(role, quote=True)}">
      <header class="case-header">
        <p class="eyebrow">{_cell(group, missing="Group not recorded")} ·
          {_cell(role, missing="No contrast role")}</p>
        <h3>{_escape_dynamic(heading)}</h3>
        <p>{escape(_text(story)) if story not in (None, "") else "No case summary recorded."}</p>
        <dl class="case-facts">
          <div><dt>Expected behavior</dt><dd>{_cell(_text(expected))}</dd></div>
          <div><dt>Actual first trigger</dt><dd>{_escape_dynamic(_summary_value_for_fire(selected, actual))}</dd></div>
          <div><dt>Actual rank-1 service</dt><dd>{_cell(rank_1)}</dd></div>
          <div><dt>Actual content</dt><dd>{_cell(content_summary)}</dd></div>
          <div><dt>Overall verdict</dt><dd>{_escape_dynamic(verdict_copy or "No evaluator verdict recorded")}</dd></div>
        </dl>
      </header>
      <div class="case-body">
        {_setup_section(case)}
        {_input_section(catalog, case, result)}
        {_expectation_section(case)}
        {_timeline_section(actual)}
        {_checks_section(result)}
        {_trigger_section(actual)}
        {_service_section(actual)}
        {_content_section(actual)}
        {_contrast_section(case, result, case_targets)}
        {_adjudication_section(result)}
        {_audit_section(result)}
      </div>
    </section>
    """


_CSS = """
:root{color-scheme:light;--ink:#18232b;--muted:#5b6972;--line:#d8e0e5;
--paper:#fff;--wash:#f3f6f7;--accent:#075985;--match:#166534;
--partial:#92400e;--mismatch:#991b1b;--limit:#5b21b6}
*{box-sizing:border-box}body{margin:0;background:var(--wash);color:var(--ink);
font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
line-height:1.5}main{width:min(1500px,calc(100% - 2rem));margin:0 auto 4rem}
.masthead{padding:3rem max(1rem,calc((100% - 1468px)/2));background:#123244;
color:#fff}.masthead h1{max-width:24ch;margin:.15rem 0;font-size:clamp(2rem,5vw,4rem);
line-height:1.05}.masthead p{max-width:75ch}.overview,.filters,.case-detail{
background:var(--paper);border:1px solid var(--line);border-radius:.75rem;
box-shadow:0 3px 14px #0f172a12}.overview{margin:2rem 0;padding:1.5rem}
.caveat,.limitation,.error{border-left:.3rem solid #c27b16;padding:.65rem .8rem;
background:#fffbeb}.count-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(11rem,1fr));
gap:.75rem;padding:0;list-style:none}.count-card{display:flex;justify-content:space-between;
gap:1rem;border:1px solid var(--line);border-radius:.5rem;padding:.8rem}
.count-card strong{font-size:1.35rem}.filters{position:sticky;top:.5rem;z-index:2;
display:flex;flex-wrap:wrap;align-items:end;gap:.8rem;margin:1rem 0;padding:1rem}
.filters label{display:grid;gap:.2rem;font-size:.85rem;font-weight:700}
select,button{min-height:2.5rem;border:1px solid #82909a;border-radius:.35rem;
background:#fff;color:var(--ink);padding:.4rem .6rem;font:inherit}
button{cursor:pointer;font-weight:700}.visible-count{margin:.5rem 0 .5rem auto;font-weight:700}
.case-detail{margin:1rem 0;overflow:hidden}.case-detail[hidden]{display:none}
.case-header{padding:1.4rem;background:linear-gradient(110deg,#eef7fa,#fff)}
.case-header h3{margin:.2rem 0;font-size:1.5rem}.eyebrow{color:var(--accent);
font-size:.82rem;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
.case-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:.7rem}
.case-facts div{border-left:.2rem solid #8fb9ca;padding:.4rem .65rem}
dt{font-size:.78rem;font-weight:800;text-transform:uppercase;color:var(--muted)}
dd{margin:.15rem 0}.case-body{display:grid;gap:1rem;padding:1.2rem}
.case-body section{border-top:1px solid var(--line);padding-top:.5rem}
h2,h3,h4,h5{line-height:1.2}h4{font-size:1.2rem;margin-bottom:.5rem}
h5{margin:1rem 0 .4rem}.table-scroll{overflow-x:auto}table{width:100%;
border-collapse:collapse;font-size:.9rem}th,td{padding:.55rem .6rem;border:1px solid var(--line);
text-align:left;vertical-align:top}th{background:#eaf0f3}td{overflow-wrap:anywhere}
.empty{color:var(--muted);font-style:italic}.findings li{margin:.45rem 0}
.findings small{display:block;color:var(--muted)}.verdict-copy{font-size:1.08rem}
details{border:1px solid var(--line);border-radius:.4rem;padding:.65rem}
summary{cursor:pointer;font-weight:700}pre{max-height:28rem;overflow:auto;margin:.7rem 0 0;
padding:.8rem;background:#101b22;color:#e6edf1;border-radius:.35rem;font-size:.78rem}
.status-match{border-color:#86b895}.status-partial-match{border-color:#d5a652}
.status-mismatch,.status-execution-error{border-color:#dc8c8c}
.status-expected-limitation{border-color:#a999d5}
@media(max-width:700px){main{width:min(100% - 1rem,1500px)}.masthead{padding:2rem 1rem}
.filters{position:static}.filters label,.filters select{width:100%}.visible-count{margin-left:0}
th,td{min-width:8rem}}
@media print{body{background:#fff}.masthead{background:#fff;color:#000;padding:1rem 0}
main{width:100%}.filters{display:none}.overview,.case-detail{box-shadow:none;break-inside:avoid}
details>pre{display:block;max-height:none}}
"""


_SCRIPT = """
(() => {
  const controls = {
    group: document.getElementById('filter-group'),
    expectedTrigger: document.getElementById('filter-trigger'),
    verdict: document.getElementById('filter-verdict'),
    contrastRole: document.getElementById('filter-role')
  };
  const cases = [...document.querySelectorAll('.case-detail')];
  const visibleCount = document.getElementById('visible-count');
  const apply = () => {
    let visible = 0;
    for (const item of cases) {
      const shown = Object.entries(controls).every(([key, control]) =>
        !control.value || item.dataset[key] === control.value
      );
      item.hidden = !shown;
      if (shown) visible += 1;
    }
    visibleCount.textContent = `${visible} of ${cases.length} cases shown`;
  };
  Object.values(controls).forEach(control => control.addEventListener('change', apply));
  document.getElementById('filter-reset').addEventListener('click', () => {
    Object.values(controls).forEach(control => { control.value = ''; });
    apply();
  });
  apply();
})();
"""


def render_report(catalog: Mapping[str, Any], suite: Mapping[str, Any]) -> str:
    """Render catalog hypotheses and evaluated facts as one offline HTML document.

    The function performs no I/O and does not mutate either input. Optional
    result detail is displayed only when recorded; absent evidence is labeled
    explicitly rather than backfilled with plausible-looking values.
    """
    catalog_view = _mapping(catalog)
    suite_view = _mapping(suite)
    cases = [_mapping(value) for value in _sequence(catalog_view.get("cases"))]
    result_index = _case_result_index(suite_view)
    case_targets: dict[str, str] = {}
    for index, case in enumerate(cases, start=1):
        display_id = _first(case.get("display_id"), case.get("case_id"))
        target = f"case-{index:03d}-{_slug(display_id)}"
        for key in ("display_id", "case_id"):
            identifier = case.get(key)
            if identifier not in (None, ""):
                case_targets[str(identifier)] = target
    details = "".join(
        _case_detail(
            catalog_view,
            case,
            _find_result(case, result_index),
            index,
            case_targets,
        )
        for index, case in enumerate(cases, start=1)
    )
    title = "Semantic Combined Experience — Customer Hypothesis Report"
    return (
        "<!doctype html>\n"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(title)}</title><style>{_CSS}</style></head><body>"
        f'<header class="masthead"><p>Frozen-algorithm evidence review</p>'
        f"<h1>{escape(title)}</h1>"
        "<p>Real-world journey hypotheses, observed trigger behavior, immediate "
        "service ranking, content evidence, and transparent adjudication.</p></header>"
        f"<main>{_overview(catalog_view, suite_view)}{_filters(catalog_view)}"
        f'<section aria-label="Catalog cases">{details}</section></main>'
        f"<script>{_SCRIPT}</script></body></html>\n"
    )
