"""Package domain models — PackageManifest and supporting types.

M2 extensions:
- HyperparameterDef.kind adds "numeric" for weight/threshold-style params.
- Numeric hyperparameters carry optional min/max/step for range validation in UI.

M3 extensions:
- AlgorithmDef.tick_seconds: optional package-declared evaluation cadence (int | None).
  When set, the tick engine prefers it over the scenario's (engine wiring is a later task).
- AlgorithmDef.error_mode: "blocking" (default) or "non_blocking" — whether algorithm
  errors pause the run. The run_manager wiring is a later task.

Feature 009 (signal-tier redesign):
- AlgorithmDef.type narrowed to Literal["python_module"] — the built-in
  "declarative_rule" and "weighted_score" algorithm types have been retired.
  "python_module" is the only supported package algorithm type.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator, model_validator


class AlgorithmDef(BaseModel):
    """Algorithm specification embedded in a package manifest.

    type is "python_module" — the only supported algorithm type for
    locally-trusted Python packages (declarative_rule and weighted_score
    were retired in feature 009).
    tick_seconds overrides the scenario cadence when set (engine wiring: later task).
    error_mode controls whether algorithm errors pause the run (run_manager wiring: later task).
    """

    type: Literal["python_module"]
    entrypoint: str
    tick_seconds: int | None = None
    error_mode: Literal["blocking", "non_blocking"] = "blocking"


class ParameterDef(BaseModel):
    """A setup-time parameter definition."""

    key: str
    label: dict[str, str]
    kind: Literal["band", "bool"]
    band_values: list[str] | None = None
    default: str | bool

    @model_validator(mode="after")
    def _default_in_band_values(self) -> ParameterDef:
        if self.kind == "band":
            if not self.band_values:
                raise ValueError(f"band_values required when kind='band' (key={self.key!r})")
            if self.default not in self.band_values:
                raise ValueError(
                    f"default {self.default!r} not in band_values {self.band_values} "
                    f"(key={self.key!r})"
                )
        return self


class HyperparameterDef(BaseModel):
    """A tuning hyperparameter definition.

    M1: kind ∈ band | bool.
    M2: kind also accepts "numeric" for category weights and thresholds
        (suggest/recommend/urgent, minimum_risk_for_rest_bonus, etc.).
        Numeric params carry optional min/max/step for UI range hints.
    """

    key: str
    label: dict[str, str]
    kind: Literal["band", "bool", "numeric"]
    band_values: list[str] | None = None
    default: Any  # str (band), bool, or float (numeric)
    min: float | None = None
    max: float | None = None
    step: float | None = None

    @model_validator(mode="after")
    def _default_in_band_values(self) -> HyperparameterDef:
        if self.kind == "band":
            if not self.band_values:
                raise ValueError(f"band_values required when kind='band' (key={self.key!r})")
            if self.default not in self.band_values:
                raise ValueError(
                    f"default {self.default!r} not in band_values {self.band_values} "
                    f"(key={self.key!r})"
                )
        return self


class FeatureDef(BaseModel):
    """An input feature consumed by the algorithm."""

    key: str
    band_values: list[str]


class TriggerCategoryDef(BaseModel):
    """A trigger category (e.g. rest_required with priority 1)."""

    id: str
    priority: int


class ProposalDef(BaseModel):
    """A proposal definition surfaced to the driver."""

    id: str
    message: dict[str, str]
    options: list[str]


class FireControlRule(BaseModel):
    """Fire-control configuration for a package."""

    threshold_source: str
    actionability_guard: str


class PackageManifest(BaseModel):
    """Top-level package manifest — validated on load; never partially loaded."""

    id: str
    version: str
    label: dict[str, str]
    compatible_scenario_types: list[str]
    algorithm: AlgorithmDef
    parameters: list[ParameterDef]
    features: list[FeatureDef]
    hyperparameters: list[HyperparameterDef]
    trigger_categories: list[TriggerCategoryDef]
    rules: list[dict]
    fire_control: FireControlRule
    proposals: list[ProposalDef]
    feedback_schema: list[dict] = []
    evidence_metrics: list[str] = []

    @field_validator("compatible_scenario_types")
    @classmethod
    def _non_empty_compat_types(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("compatible_scenario_types must not be empty")
        return v
