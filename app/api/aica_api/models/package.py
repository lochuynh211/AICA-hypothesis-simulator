"""Package domain models — PackageManifest and supporting types."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


class AlgorithmDef(BaseModel):
    """Algorithm specification embedded in a package manifest."""

    type: Literal["declarative_rule"]
    entrypoint: str


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
    """A tuning hyperparameter definition (same shape as ParameterDef)."""

    key: str
    label: dict[str, str]
    kind: Literal["band", "bool"]
    band_values: list[str] | None = None
    default: str | bool

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
