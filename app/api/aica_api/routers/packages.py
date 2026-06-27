"""Package registry router — /api/packages."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from aica_api.config import settings
from aica_api.services.package_registry import PackageRegistry

router = APIRouter()


def _get_registry() -> PackageRegistry:
    """Instantiate a PackageRegistry from the configured packages directory."""
    return PackageRegistry(settings.packages_dir)


@router.get("/api/packages")
def list_packages() -> dict:
    """Return all loaded package summaries plus any load errors."""
    reg = _get_registry()
    errors = [
        {"source": e.get("package_dir", ""), "message": e.get("error", "")}
        for e in reg.list_errors()
    ]
    return {"packages": reg.list_summaries(), "errors": errors}


@router.get("/api/packages/{package_id}")
def get_package(package_id: str):
    """Return the full PackageManifest for a package, or 404."""
    reg = _get_registry()
    pkg = reg.get(package_id)
    if pkg is None:
        raise HTTPException(
            status_code=404,
            detail=f"Package {package_id!r} not found or invalid",
        )
    return pkg
