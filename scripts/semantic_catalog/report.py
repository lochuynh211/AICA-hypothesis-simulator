"""Self-contained customer HTML report for the semantic Combined catalog.

Design goals (owner review, 2026-07-29):

* Lead with what AICA actually DID, drawn the way the Combined screen draws it:
  an inline SVG of the real quickview run -- rest and monotony score against the
  firing threshold, road segments, and a marker at every proposal.
* Then the two things a reviewer wants to read: the ranked services and the
  content plan, each with a plain-language explanation of WHY.
* Push setup, parameters, raw inputs and audit JSON into collapsed ``<details>``
  so they never compete with the result.

Pure renderer: consumes the authored catalog plus the evaluated suite and returns
one string. No network, no CDN, no external asset.
"""

from __future__ import annotations

import html
import json
from collections.abc import Mapping, Sequence
from typing import Any

REPORT_VERSION = "2.0.0"

_VERDICT_WORDING = {
    "MATCH": "Appropriate for this hypothesis",
    "PARTIAL_MATCH": "Partly appropriate; review details",
    "MISMATCH": "Not appropriate for this hypothesis",
    "UNVERIFIABLE": "The run completed but the evidence cannot confirm this",
    "NOT_EVALUATED": "Not evaluated: the expected upstream event did not occur",
    "EXECUTION_ERROR": "The run failed before a verdict could be formed",
    "EXPECTED_LIMITATION": "A predicted limitation of the frozen packages",
}

_GROUP_LABEL = {
    "rest": "Rest behaviour",
    "monotony": "Monotony behaviour",
    "environment": "Environment and conflicts",
    "service": "Service personalisation",
    "content": "Content personalisation",
    "integrated": "Integrated CDC-SU journeys",
}

_STAGE_LABEL = {
    "trigger": "Trigger",
    "service": "Service",
    "content": "Content",
    "execution": "Execution",
}


# --------------------------------------------------------------------------- #
# helpers
# --------------------------------------------------------------------------- #
def _e(value: Any) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def _m(value: Any) -> dict:
    return dict(value) if isinstance(value, Mapping) else {}


def _s(value: Any) -> list:
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes)):
        return list(value)
    return []


def _num(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _en(value: Any, fallback: str = "") -> str:
    if isinstance(value, Mapping):
        return str(value.get("en") or value.get("ja") or fallback)
    if isinstance(value, str):
        return value
    return fallback


def _ja(value: Any) -> str:
    return str(_m(value).get("ja") or "")


def _fmt(value: Any, digits: int = 3) -> str:
    number = _num(value)
    return "—" if number is None else f"{number:.{digits}f}"


def _rationale_en(rows: Any) -> str:
    """English side of the frozen packages' bilingual rationale sentences."""
    out: list[str] = []
    for row in _s(rows):
        if not isinstance(row, str):
            continue
        text = row.split(" / ")[-1] if " / " in row else row
        if any(ord(ch) > 0x3000 for ch in text):
            continue
        out.append(text.strip())
    return " ".join(out)


# --------------------------------------------------------------------------- #
# the run picture
# --------------------------------------------------------------------------- #
def _run_chart(
    evidence: Mapping[str, Any],
    fires: Sequence[Mapping[str, Any]],
    case_id: str,
) -> str:
    """Inline SVG of the real quickview run -- the picture a reviewer reads first."""
    rest = [v for v in _s(evidence.get("rest_score_series")) if _num(v) is not None]
    mono = [v for v in _s(evidence.get("monotony_score_series")) if _num(v) is not None]
    if not rest and not mono:
        return '<p class="muted">No per-tick trajectory was recorded for this run.</p>'

    count = max(len(rest), len(mono))
    tick_min = _num(evidence.get("tick_minutes")) or 3.0
    end_min = _num(evidence.get("journey_end_min")) or (count * tick_min)
    threshold = _num(evidence.get("threshold"))
    mono_threshold = _num(evidence.get("monotony_threshold"))

    width, height = 720, 240
    pad_l, pad_r, pad_t, pad_b = 46, 16, 14, 34
    plot_w, plot_h = width - pad_l - pad_r, height - pad_t - pad_b

    def x_of(index: int) -> float:
        return pad_l + plot_w * (index / max(1, count - 1))

    def x_min(minutes: float) -> float:
        return pad_l + plot_w * ((minutes / end_min) if end_min else 0.0)

    def y_of(value: float) -> float:
        return pad_t + plot_h * (1 - min(value, 1.0))

    def polyline(series: list) -> str:
        if not series:
            return ""
        points = " ".join(
            f"{x_of(i):.1f},{y_of(float(v)):.1f}" for i, v in enumerate(series)
        )
        return f'<polyline points="{points}" fill="none" stroke-width="2.5" />'

    parts = [
        f'<svg viewBox="0 0 {width} {height}" class="runchart" role="img" '
        f'aria-label="Trigger score across the {_e(case_id)} journey">'
    ]

    seg_class = {
        "highway": "seg-hw",
        "normal_road": "seg-nr",
        "mountain_road": "seg-mt",
        "traffic_jam": "seg-jam",
        "rest": "seg-rest",
        "start": "seg-nr",
    }
    for segment in _s(evidence.get("segments")):
        segment = _m(segment)
        start, stop = _num(segment.get("from_min")), _num(segment.get("to_min"))
        if start is None or stop is None or not end_min:
            continue
        parts.append(
            f'<rect class="{seg_class.get(str(segment.get("type")), "seg-nr")}" '
            f'x="{x_min(start):.1f}" y="{height - pad_b + 6:.1f}" '
            f'width="{max(1.0, x_min(stop) - x_min(start)):.1f}" height="9" rx="2">'
            f'<title>{_e(segment.get("type"))} {start:.0f}-{stop:.0f} min</title></rect>'
        )

    for fraction in (0.0, 0.25, 0.5, 0.75, 1.0):
        y = y_of(fraction)
        parts.append(
            f'<line class="grid" x1="{pad_l}" y1="{y:.1f}" x2="{width - pad_r}" y2="{y:.1f}" />'
        )
        parts.append(
            f'<text class="ax" x="{pad_l - 8}" y="{y + 3.5:.1f}" '
            f'text-anchor="end">{fraction:.2f}</text>'
        )

    if threshold is not None:
        y = y_of(threshold)
        parts.append(
            f'<line class="thr" x1="{pad_l}" y1="{y:.1f}" x2="{width - pad_r}" y2="{y:.1f}" />'
        )
        parts.append(
            f'<text class="thrlab" x="{width - pad_r}" y="{y - 5:.1f}" text-anchor="end">'
            f"firing threshold {threshold:.2f}</text>"
        )
    if (
        mono_threshold is not None
        and threshold is not None
        and abs(mono_threshold - threshold) > 1e-9
    ):
        parts.append(
            f'<line class="thr thr-mono" x1="{pad_l}" y1="{y_of(mono_threshold):.1f}" '
            f'x2="{width - pad_r}" y2="{y_of(mono_threshold):.1f}" />'
        )

    if rest:
        parts.append(f'<g class="line-rest">{polyline(rest)}</g>')
    if mono:
        parts.append(f'<g class="line-mono">{polyline(mono)}</g>')

    for fire in fires:
        fire = _m(fire)
        minutes = _num(fire.get("time_min"))
        if minutes is None or not end_min:
            continue
        x = x_min(minutes)
        cls = "fire-rest" if fire.get("category") == "rest_required" else "fire-mono"
        parts.append(
            f'<line class="firemark {cls}" x1="{x:.1f}" y1="{pad_t}" '
            f'x2="{x:.1f}" y2="{height - pad_b}" />'
        )
        parts.append(
            f'<circle class="firedot {cls}" cx="{x:.1f}" cy="{pad_t + 6}" r="5">'
            f'<title>{_e(fire.get("category"))} proposal at {minutes:.0f} min</title></circle>'
        )

    for fraction, anchor in ((0.0, "start"), (0.5, "middle"), (1.0, "end")):
        parts.append(
            f'<text class="ax" x="{pad_l + plot_w * fraction:.1f}" '
            f'y="{height - pad_b + 26:.1f}" text-anchor="{anchor}">'
            f"{end_min * fraction:.0f} min</text>"
        )
    parts.append("</svg>")

    legend = (
        '<div class="legend">'
        '<span><i class="sw sw-rest"></i>rest score</span>'
        '<span><i class="sw sw-mono"></i>monotony score</span>'
        '<span><i class="sw sw-thr"></i>firing threshold</span>'
        '<span><i class="sw sw-fire"></i>proposal raised</span>'
        "</div>"
    )
    return "".join(parts) + legend


# --------------------------------------------------------------------------- #
# service + content detail
# --------------------------------------------------------------------------- #
def _service_block(service: Mapping[str, Any]) -> str:
    rows = _s(service.get("ranked_candidates"))
    if not rows:
        error = service.get("error")
        if error:
            return (
                '<p class="err">The service stage recorded an error: '
                f"<code>{_e(json.dumps(error, ensure_ascii=False))}</code></p>"
            )
        return '<p class="muted">No service proposal was attached to this fire.</p>'

    out = [
        '<table class="tbl svc"><thead><tr>'
        "<th>#</th><th>Service AICA offered</th><th>Score</th>"
        "<th>Situation</th><th>Preference</th><th>History</th>"
        "<th>Why this score</th></tr></thead><tbody>"
    ]
    for row in rows:
        row = _m(row)
        support = _m(row.get("strongest_support"))
        oppose = _m(row.get("strongest_oppose"))
        chips = []
        if support.get("feature_id"):
            chips.append(
                f'<span class="pos">&#9650; {_e(support.get("feature_id"))} '
                f'{_fmt(support.get("contribution"), 4)}</span>'
            )
        if oppose.get("feature_id"):
            chips.append(
                f'<span class="neg">&#9660; {_e(oppose.get("feature_id"))} '
                f'{_fmt(oppose.get("contribution"), 4)}</span>'
            )
        out.append(
            f'<tr class="{"rank1" if row.get("rank") == 1 else ""}">'
            f'<td>{_e(row.get("rank"))}</td>'
            f'<td><strong>{_e(row.get("candidate_id"))}</strong></td>'
            f'<td class="num">{_fmt(row.get("score"), 4)}</td>'
            f'<td class="num">{_fmt(row.get("situation_fit"))}</td>'
            f'<td class="num">{_fmt(row.get("preference_fit"))}</td>'
            f'<td class="num">{_fmt(row.get("history_fit"))}</td>'
            f'<td class="why">{_e(_rationale_en(row.get("rationale")) or "-")}'
            f'<div class="chips">{"".join(chips)}</div></td></tr>'
        )
    out.append("</tbody></table>")
    return "".join(out)


def _content_block(content: Mapping[str, Any], tracks: Mapping[str, Any]) -> str:
    error = content.get("error")
    if error:
        return (
            '<p class="err">The content stage recorded a limitation or error: '
            f"<code>{_e(json.dumps(error, ensure_ascii=False))}</code></p>"
        )
    items = _s(content.get("ordered_items"))
    if not items:
        return (
            '<p class="muted">No content plan was produced (stage outcome: '
            f'<code>{_e(content.get("stage_outcome"))}</code>).</p>'
        )

    out = [
        '<table class="tbl cnt"><thead><tr>'
        "<th>#</th><th>Track</th><th>Artist</th><th>Genre</th>"
        "<th>Arousal</th><th>Valence</th><th>Fit</th>"
        "<th>Why this track</th></tr></thead><tbody>"
    ]
    for item in items:
        item = _m(item)
        track = _m(tracks.get(item.get("item_id")))
        traits = _m(item.get("trait_values"))
        support = _m(item.get("strongest_support"))
        chip = (
            f'<span class="pos">&#9650; {_e(support.get("feature_id"))} '
            f'{_fmt(support.get("contribution"), 4)}</span>'
            if support.get("feature_id")
            else ""
        )
        artists = ", ".join(str(a) for a in _s(track.get("artist_names"))[:2]) or "-"
        genres = ", ".join(str(g) for g in _s(track.get("realized_genres"))[:3]) or "-"
        out.append(
            "<tr>"
            f'<td>{_e(item.get("position"))}</td>'
            f'<td><strong>{_e(track.get("title") or item.get("item_id"))}</strong>'
            f'<div class="tid">{_e(item.get("item_id"))}</div></td>'
            f"<td>{_e(artists)}</td><td>{_e(genres)}</td>"
            f'<td class="num">{_fmt(traits.get("arousal"), 2)}</td>'
            f'<td class="num">{_fmt(traits.get("valence"), 2)}</td>'
            f'<td class="num">{_fmt(item.get("item_fit"), 4)}</td>'
            f'<td class="why">{_e(_rationale_en(item.get("rationale")) or "-")}'
            f'<div class="chips">{chip}</div></td></tr>'
        )
    out.append("</tbody></table>")

    excluded = _s(content.get("excluded_track_ids"))
    if excluded:
        names = ", ".join(
            str(_m(tracks.get(track_id)).get("title") or track_id)
            for track_id in excluded[:8]
        )
        out.append(f'<p class="muted">Excluded by the selector: {_e(names)}</p>')
    return "".join(out)


# --------------------------------------------------------------------------- #
# case section
# --------------------------------------------------------------------------- #
def _checks_table(checks: Sequence[Mapping[str, Any]]) -> str:
    out = [
        '<table class="tbl chk"><thead><tr><th>Stage</th><th>Check</th>'
        "<th>Expected</th><th>Actual</th><th>Result</th><th>What this means</th>"
        "</tr></thead><tbody>"
    ]
    for check in checks:
        check = _m(check)
        status = str(check.get("status") or "")
        out.append(
            f'<tr class="st-{_e(status)}">'
            f'<td>{_e(_STAGE_LABEL.get(str(check.get("stage")), check.get("stage")))}</td>'
            f'<td><code>{_e(check.get("check_id"))}</code></td>'
            f'<td>{_e(json.dumps(check.get("expected"), ensure_ascii=False))}</td>'
            f'<td>{_e(json.dumps(check.get("actual"), ensure_ascii=False))}</td>'
            f'<td><span class="pill p-{_e(status)}">'
            f'{_e(status.replace("_", " ").title())}</span></td>'
            f'<td>{_e(check.get("explanation"))}</td></tr>'
        )
    out.append("</tbody></table>")
    return "".join(out)


def _kv_table(mapping: Mapping[str, Any]) -> str:
    rows = []
    for key in sorted(mapping):
        value = mapping[key]
        text = (
            json.dumps(value, ensure_ascii=False)
            if isinstance(value, (dict, list))
            else str(value)
        )
        rows.append(f"<tr><td><code>{_e(key)}</code></td><td>{_e(text)}</td></tr>")
    return f'<table class="tbl kv"><tbody>{"".join(rows)}</tbody></table>'


def _setup_details(case: Mapping[str, Any]) -> str:
    """Everything a reviewer only needs on demand -- collapsed by default."""
    scenario = _m(_m(case.get("journey")).get("scenario"))
    persona = _m(case.get("persona"))
    profile = {
        "profile_ref": persona.get("profile_ref"),
        "profile_ref_version": persona.get("profile_ref_version"),
        "persona_id": persona.get("persona_id"),
    }
    expectations = json.dumps(_m(case.get("expectations")), ensure_ascii=False, indent=2)
    return (
        '<details class="setup">'
        "<summary>Setup, parameters and authored expectations</summary>"
        '<div class="setup-grid">'
        f"<section><h5>Journey and scenario inputs</h5>{_kv_table(scenario)}</section>"
        f"<section><h5>Driver profile reference</h5>{_kv_table(profile)}</section>"
        f"<section><h5>Authored expectations</h5><pre>{_e(expectations)}</pre></section>"
        "</div></details>"
    )


def _audit_json(evaluation: Mapping[str, Any]) -> str:
    """Bounded audit dump.

    The per-tick trajectories and per-candidate feature vectors are already drawn
    and tabulated above; repeating them verbatim in every case made the page
    several megabytes. They are replaced by a pointer to the machine-readable
    results file, which keeps the full evidence.
    """
    trimmed = json.loads(json.dumps(evaluation, ensure_ascii=False))
    actual = trimmed.get("actual")
    if isinstance(actual, dict):
        evidence = actual.get("trigger_evidence")
        if isinstance(evidence, dict):
            for key in ("rest_score_series", "monotony_score_series"):
                series = evidence.get(key)
                if isinstance(series, list):
                    evidence[key] = f"<{len(series)} values; see the results JSON>"
        for stage in ("service", "content"):
            block = actual.get(stage)
            if not isinstance(block, dict):
                continue
            for row_key in ("ranked_candidates", "ordered_items"):
                for row in block.get(row_key) or []:
                    if isinstance(row, dict) and "feature_contributions" in row:
                        row["feature_contributions"] = (
                            f"<{len(row['feature_contributions'])} features; "
                            "see the results JSON>"
                        )
        actual.pop("track_index", None)
    return json.dumps(trimmed, ensure_ascii=False, indent=2)


def _case_section(case: Mapping[str, Any], evaluation: Mapping[str, Any]) -> str:
    display_id = str(case.get("display_id") or "")
    verdict = str(evaluation.get("verdict") or "")
    actual = _m(evaluation.get("actual"))
    evidence = _m(actual.get("trigger_evidence"))
    fires = [_m(f) for f in _s(actual.get("fires"))]
    service = _m(actual.get("service"))
    content = _m(actual.get("content"))
    tracks = _m(actual.get("track_index"))
    real = _m(case.get("real_world"))
    contrast = _m(case.get("contrast"))
    delta = _m(evaluation.get("contrast_delta"))

    first = fires[0] if fires else {}
    headline = (
        f'{_e(first.get("category"))} at {_fmt(first.get("time_min"), 0)} min'
        if fires
        else "AICA stayed quiet"
    )

    delta_html = ""
    if delta:
        moved = {
            key: value
            for key, value in _m(delta.get("service_score_deltas")).items()
            if abs(_num(value) or 0) > 1e-9
        }
        rows = "".join(
            f'<tr><td>{_e(k)}</td><td class="num">{_fmt(v, 5)}</td></tr>'
            for k, v in sorted(moved.items(), key=lambda kv: -abs(_num(kv[1]) or 0))
        ) or (
            '<tr><td colspan="2" class="muted">'
            "No service score moved between this pair.</td></tr>"
        )
        delta_html = (
            f'<section class="block"><h4>Contrast with {_e(delta.get("with_case_id"))}</h4>'
            f'<p>{_e(_en(contrast.get("expected_delta")))}</p>'
            '<table class="tbl kv"><thead><tr><th>Service</th>'
            "<th>Score change vs paired case</th></tr></thead>"
            f"<tbody>{rows}</tbody></table></section>"
        )

    trigger_outcome = _m(_m(case.get("expectations")).get("trigger")).get("outcome")
    story = " ".join(
        _en(real.get(key))
        for key in ("before_trip", "trip_reason", "state_at_departure", "journey_evolution")
    )
    return (
        f'<article class="case" id="case-{_e(display_id)}" '
        f'data-group="{_e(case.get("group"))}" data-verdict="{_e(verdict)}" '
        f'data-trigger="{_e(trigger_outcome)}" '
        f'data-role="{_e(contrast.get("role") or "standalone")}">'
        '<header class="case-head">'
        f'<div class="case-id">{_e(display_id)}</div>'
        f'<h3>{_e(_en(case.get("title")))}</h3>'
        f'<span class="pill p-{_e(verdict)}">'
        f"{_e(_VERDICT_WORDING.get(verdict, verdict))}</span>"
        f'<p class="ja">{_e(_ja(case.get("title")))}</p>'
        "</header>"
        f'<p class="story">{_e(story)}</p>'
        '<div class="atagl">'
        f"<div><span>What AICA did</span><strong>{headline}</strong></div>"
        f"<div><span>Service offered</span>"
        f'<strong>{_e(service.get("rank_1_id") or "-")}</strong></div>'
        f"<div><span>Content plan</span>"
        f'<strong>{_e(len(_s(content.get("ordered_items"))))} tracks</strong></div>'
        f"<div><span>Peak score</span>"
        f'<strong>{_fmt(evidence.get("peak_score"))} / '
        f'{_fmt(evidence.get("threshold"), 2)}</strong></div>'
        "</div>"
        '<section class="block"><h4>The actual run</h4>'
        '<p class="hint">Live quickview trajectory: every tick AICA evaluated, against the '
        "firing threshold. Vertical markers are the moments a proposal was raised.</p>"
        f"{_run_chart(evidence, fires, display_id)}</section>"
        f'<section class="block"><h4>Services AICA ranked</h4>'
        f"{_service_block(service)}</section>"
        f'<section class="block"><h4>Content AICA planned</h4>'
        f"{_content_block(content, tracks)}</section>"
        f"{delta_html}"
        f'<section class="block"><h4>Expected versus actual</h4>'
        f'{_checks_table(_s(evaluation.get("checks")))}</section>'
        f"{_setup_details(case)}"
        '<details class="audit"><summary>Raw evaluated record for this case</summary>'
        f"<pre>{_e(_audit_json(evaluation))}</pre>"
        "</details></article>"
    )


# --------------------------------------------------------------------------- #
# document
# --------------------------------------------------------------------------- #
_CSS = """
:root{--bg:#fbfbfd;--fg:#16181d;--mut:#666e7a;--line:#e2e5ea;--card:#fff;
--ok:#1a7f45;--part:#9a6400;--bad:#b3261e;--rest:#c2410c;--mono:#1d4ed8;--accent:#0f172a}
@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--fg:#e8eaee;--mut:#9aa3ae;--line:#272b33;
--card:#161920;--ok:#4ade80;--part:#fbbf24;--bad:#f87171;--rest:#fb923c;--mono:#60a5fa;
--accent:#e8eaee}}
:root[data-theme=dark]{--bg:#0f1115;--fg:#e8eaee;--mut:#9aa3ae;--line:#272b33;--card:#161920;
--ok:#4ade80;--part:#fbbf24;--bad:#f87171;--rest:#fb923c;--mono:#60a5fa;--accent:#e8eaee}
:root[data-theme=light]{--bg:#fbfbfd;--fg:#16181d;--mut:#666e7a;--line:#e2e5ea;--card:#fff;
--ok:#1a7f45;--part:#9a6400;--bad:#b3261e;--rest:#c2410c;--mono:#1d4ed8;--accent:#0f172a}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 -apple-system,
BlinkMacSystemFont,"Segoe UI",Roboto,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif}
.wrap{max-width:1120px;margin:0 auto;padding:32px 20px 96px}
h1{font-size:30px;margin:0 0 6px;letter-spacing:-.02em}
h2{font-size:21px;margin:44px 0 14px;letter-spacing:-.01em}
h3{font-size:19px;margin:0;letter-spacing:-.01em}
h4{font-size:14px;text-transform:uppercase;letter-spacing:.07em;color:var(--mut);margin:0 0 10px}
h5{font-size:13px;margin:0 0 6px;color:var(--mut)}
.sub{color:var(--mut);margin:0 0 22px}
.muted{color:var(--mut)}.err{color:var(--bad)}
.hint{color:var(--mut);font-size:13.5px;margin:0 0 10px}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px}
.card b{display:block;font-size:26px;line-height:1.2}
.card span{color:var(--mut);font-size:12.5px}
.case{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px;
margin:18px 0}
.case-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:6px}
.case-id{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--accent);
color:var(--bg);padding:5px 8px;border-radius:6px}
.case-head h3{flex:1 1 320px}
.ja{color:var(--mut);font-size:13px;margin:0;width:100%}
.story{margin:8px 0 16px}
.atagl{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin:0 0 20px}
.atagl div{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:10px 12px}
.atagl span{display:block;color:var(--mut);font-size:12px}
.atagl strong{font-size:15px}
.block{margin:22px 0}
.pill{font-size:12px;font-weight:600;padding:5px 10px;border-radius:999px;white-space:nowrap}
.p-MATCH{background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok)}
.p-PARTIAL_MATCH{background:color-mix(in srgb,var(--part) 18%,transparent);color:var(--part)}
.p-MISMATCH{background:color-mix(in srgb,var(--bad) 15%,transparent);color:var(--bad)}
.p-UNVERIFIABLE,.p-NOT_EVALUATED,.p-EXECUTION_ERROR,.p-EXPECTED_LIMITATION{
background:color-mix(in srgb,var(--mut) 16%,transparent);color:var(--mut)}
.tbl{width:100%;border-collapse:collapse;font-size:13.5px;display:block;overflow-x:auto}
.tbl th,.tbl td{border-bottom:1px solid var(--line);padding:8px 10px;text-align:left;
vertical-align:top}
.tbl th{color:var(--mut);font-weight:600;font-size:12px;text-transform:uppercase;
letter-spacing:.05em;white-space:nowrap}
.tbl .num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.svc tr.rank1{background:color-mix(in srgb,var(--ok) 7%,transparent)}
.why{min-width:230px}
.tid{font:11px/1.4 ui-monospace,Menlo,monospace;color:var(--mut)}
.chips{margin-top:4px;display:flex;gap:8px;flex-wrap:wrap}
.pos{color:var(--ok);font-size:12px}.neg{color:var(--bad);font-size:12px}
.chk tr.st-MISMATCH{background:color-mix(in srgb,var(--bad) 8%,transparent)}
.chk tr.st-PARTIAL_MATCH{background:color-mix(in srgb,var(--part) 9%,transparent)}
.runchart{width:100%;height:auto;display:block;background:var(--bg);border:1px solid var(--line);
border-radius:10px}
.grid{stroke:var(--line);stroke-width:1}
.ax{fill:var(--mut);font-size:10.5px}
.thr{stroke:var(--bad);stroke-width:1.6;stroke-dasharray:6 4}
.thr-mono{stroke:var(--mono);opacity:.55}
.thrlab{fill:var(--bad);font-size:10.5px}
.line-rest polyline{stroke:var(--rest)}
.line-mono polyline{stroke:var(--mono);stroke-dasharray:4 3}
.firemark{stroke-width:1.4;opacity:.5}
.fire-rest{stroke:var(--rest)}.fire-mono{stroke:var(--mono)}
.firedot.fire-rest{fill:var(--rest)}.firedot.fire-mono{fill:var(--mono)}
.seg-hw{fill:var(--mono);opacity:.35}.seg-nr{fill:var(--mut);opacity:.3}
.seg-mt{fill:var(--rest);opacity:.4}.seg-jam{fill:var(--bad);opacity:.35}
.seg-rest{fill:var(--ok);opacity:.5}
.legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--mut);font-size:12px;margin-top:8px}
.sw{display:inline-block;width:14px;height:3px;border-radius:2px;margin-right:5px;
vertical-align:middle}
.sw-rest{background:var(--rest)}.sw-mono{background:var(--mono)}
.sw-thr{background:var(--bad)}.sw-fire{background:var(--rest);height:10px;width:3px}
details{margin:14px 0;border:1px solid var(--line);border-radius:10px;background:var(--bg)}
details>summary{cursor:pointer;padding:11px 14px;font-size:13px;font-weight:600;color:var(--mut)}
details[open]>summary{border-bottom:1px solid var(--line)}
details>*:not(summary){padding:0 14px 14px}
.setup-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;
padding-top:12px}
pre{overflow-x:auto;font:11.5px/1.55 ui-monospace,Menlo,monospace;background:var(--card);
border:1px solid var(--line);border-radius:8px;padding:12px;max-height:420px}
code{font:12px ui-monospace,Menlo,monospace}
.filters{display:flex;gap:12px;flex-wrap:wrap;position:sticky;top:0;z-index:5;background:var(--bg);
padding:12px 0;border-bottom:1px solid var(--line);margin-bottom:8px}
.filters label{font-size:12px;color:var(--mut);display:flex;flex-direction:column;gap:4px}
.filters select{font:13px inherit;padding:6px 8px;border-radius:8px;border:1px solid var(--line);
background:var(--card);color:var(--fg)}
.findings li{margin-bottom:8px}
.note{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--part);
border-radius:10px;padding:14px 16px;margin:18px 0}
"""

_JS = """
(function(){
  var keys=['group','verdict','trigger','role'];
  var sels=keys.map(function(k){return document.getElementById('f-'+k);});
  var cases=Array.prototype.slice.call(document.querySelectorAll('article.case'));
  function apply(){
    var want={};
    sels.forEach(function(s){ if(s&&s.value){ want[s.dataset.key]=s.value; } });
    var shown=0;
    cases.forEach(function(el){
      var ok=Object.keys(want).every(function(k){ return el.dataset[k]===want[k]; });
      el.hidden=!ok; if(ok){shown++;}
    });
    var c=document.getElementById('shown-count');
    if(c){ c.textContent=shown+' of '+cases.length+' cases shown'; }
  }
  sels.forEach(function(s){ if(s){ s.addEventListener('change',apply); } });
  apply();
})();
"""


def _select(key: str, label: str, values: Sequence[str], pretty=None) -> str:
    options = '<option value="">All</option>' + "".join(
        f'<option value="{_e(v)}">{_e(pretty(v) if pretty else v)}</option>' for v in values
    )
    return (
        f"<label>{_e(label)}"
        f'<select id="f-{_e(key)}" data-key="{_e(key)}" '
        f'aria-label="Filter by {_e(label.lower())}">{options}</select></label>'
    )


def render_report(catalog: Mapping[str, Any], suite: Mapping[str, Any]) -> str:
    """Render the whole catalog and its evaluated results as one offline page."""
    cases = [_m(c) for c in _s(catalog.get("cases"))]
    evaluations = {
        str(_m(e).get("display_id")): _m(e) for e in _s(suite.get("case_results"))
    }
    counts = _m(_m(suite.get("summary")).get("verdict_counts"))
    findings = _s(suite.get("findings"))

    order = {
        "rest": 0,
        "monotony": 1,
        "environment": 2,
        "service": 3,
        "content": 4,
        "integrated": 5,
    }
    cases.sort(key=lambda c: (order.get(str(c.get("group")), 9), str(c.get("display_id"))))

    cards = "".join(
        f'<div class="card"><b>{_e(counts.get(key, 0))}</b>'
        f"<span>{_e(_VERDICT_WORDING.get(key, key))}</span></div>"
        for key in ("MATCH", "PARTIAL_MATCH", "MISMATCH", "UNVERIFIABLE", "EXECUTION_ERROR")
        if counts.get(key)
    )

    filters = (
        '<div class="filters">'
        + _select(
            "group",
            "Group",
            sorted({str(c.get("group")) for c in cases}),
            lambda v: _GROUP_LABEL.get(v, v),
        )
        + _select(
            "verdict",
            "Verdict",
            ["MATCH", "PARTIAL_MATCH", "MISMATCH", "UNVERIFIABLE"],
            lambda v: _VERDICT_WORDING.get(v, v),
        )
        + _select("trigger", "Expected trigger", ["rest_required", "monotony_prevention", "none"])
        + _select("role", "Contrast role", ["baseline", "variant", "standalone"])
        + '<span class="muted" id="shown-count" style="align-self:flex-end"></span></div>'
    )

    findings_html = ""
    if findings:
        items = "".join(
            f"<li>{_e(_en(f) if isinstance(f, Mapping) else f)}</li>" for f in findings[:24]
        )
        findings_html = (
            f'<section><h2>What the runs showed</h2><ul class="findings">{items}</ul></section>'
        )

    sections: list[str] = []
    current: str | None = None
    for case in cases:
        group = str(case.get("group"))
        if group != current:
            current = group
            sections.append(f"<h2>{_e(_GROUP_LABEL.get(group, group))}</h2>")
        sections.append(
            _case_section(case, evaluations.get(str(case.get("display_id")), {}))
        )

    return (
        "<!doctype html>\n"
        '<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>AICA Combined - semantic test case report</title>"
        f"<style>{_CSS}</style></head><body><div class=\"wrap\">"
        "<h1>AICA Combined - semantic test case report</h1>"
        f'<p class="sub">{_e(len(cases))} real-world cases run through the frozen trigger, '
        "service and content packages on the Combined screen. Catalog "
        f'{_e(catalog.get("catalog_version"))} &middot; report renderer {_e(REPORT_VERSION)}.</p>'
        f'<div class="cards">{cards}</div>'
        '<div class="note"><strong>How to read this.</strong> Each case opens with the run AICA '
        "actually performed, then the services it ranked and the content it planned, each with "
        "the reason behind the score. Setup values, authored expectations and raw records sit in "
        "collapsed panels underneath. These verdicts express fitness against an authored "
        "simulator hypothesis - they are not a safety certification, a medical judgement, or a "
        "claim about the physical world.</div>"
        f"{findings_html}{filters}{''.join(sections)}"
        f"</div><script>{_JS}</script></body></html>\n"
    )


__all__ = ["render_report", "REPORT_VERSION"]
