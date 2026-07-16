"""Genre-affinity extension shape for the ``genre_affinity_v1`` contract.

:class:`GenreAffinityV1` is an **optional, off-by-default** sibling namespace
added to a ``feature_snapshot`` when the genre-affinity extension is enabled.
It must never introduce keys that overwrite the three core song namespaces
(``spotify_track``, ``spotify_audio_features``, ``simulation_flags``).

Module constant:
- :data:`GENRE_VOCABULARY` — the 12-term controlled vocabulary sourced from
  :class:`~aica_api.models.proposal.enums.GenreLiteral`.

Vocabulary membership is enforced by ``GenreLiteral`` typing. Extra fields are
forbidden (``extra="forbid"``). The no-overwrite guard is implemented via
``model_config = ConfigDict(extra="forbid")``: any attempt to instantiate
``GenreAffinityV1`` with a key named ``spotify_track``,
``spotify_audio_features``, or ``simulation_flags`` will raise a
``ValidationError`` because those names are not declared fields and ``extra``
keys are forbidden.

Authoritative sources:
- ``specs/010-content-contract-freeze/data-model.md`` §Genre extension.
- ``docs/superpowers/specs/2026-07-16-proposal-p0.5-design.md`` §6 genre section.
- ``specs/010-content-contract-freeze/contracts/README.md`` C4.
"""
from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from aica_api.models.proposal.enums import GenreLiteral, UsageLevel

# ---------------------------------------------------------------------------
# GENRE_VOCABULARY — the 12-term controlled vocabulary, sourced from GenreLiteral
# ---------------------------------------------------------------------------

GENRE_VOCABULARY: tuple[str, ...] = tuple(g.value for g in GenreLiteral)
"""The 12-term controlled vocabulary for genre affinity.

Values are the string representations of :class:`GenreLiteral` members:
``j-pop``, ``j-rock``, ``city pop``, ``anime``, ``vocaloid``, ``enka``,
``children's music``, ``classical``, ``jazz``, ``ambient``, ``electronic``,
``japanese folk``.
"""


# ---------------------------------------------------------------------------
# GenreAffinityV1 — the extension shape
# ---------------------------------------------------------------------------

class GenreAffinityV1(BaseModel):
    """Optional ``genre_affinity_v1`` extension shape.

    This model is a **sibling namespace** added alongside (never inside) the
    three core song namespaces when the genre-affinity extension is enabled.

    Fields
    ------
    artist_genres:
        Maps artist IDs to their genre list. Each genre must be a member of
        the 12-term vocabulary (enforced by ``GenreLiteral`` typing).
    usage_by_genre:
        Optional overall usage-level per genre (ordinal band from
        ``UsageLevel``). Absence means no genre usage data is available.
    scene_genre_usage:
        Optional per-scene usage-level per genre. Each scene key maps to a
        ``dict[GenreLiteral, UsageLevel]``. Absence means no scene-level data.

    No-overwrite guarantee
    ----------------------
    ``extra="forbid"`` ensures that any attempt to pass a key named
    ``spotify_track``, ``spotify_audio_features``, or ``simulation_flags``
    (the three core song namespaces) raises a ``ValidationError`` immediately,
    because those names are not declared fields and extra keys are disallowed.
    """

    model_config = ConfigDict(extra="forbid")

    artist_genres: dict[str, list[GenreLiteral]]
    usage_by_genre: dict[GenreLiteral, UsageLevel] | None = None
    scene_genre_usage: dict[str, dict[GenreLiteral, UsageLevel]] | None = None
