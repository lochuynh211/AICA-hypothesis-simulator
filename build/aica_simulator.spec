# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for AICA Hypothesis Simulator.

Bundles:
  - Python runtime + FastAPI/Uvicorn
  - aica_api package (backend)
  - frontend_dist/ (built React SPA)
  - packages/ (algorithm packages)
  - scenarios/ (scenario definitions)

Run from repo root:
  pyinstaller build/aica_simulator.spec
"""

import os
from pathlib import Path

repo_root = Path(os.getcwd())
build_dir = repo_root / "build"

block_cipher = None

a = Analysis(
    [str(build_dir / "launcher.py")],
    pathex=[str(repo_root / "app" / "api")],
    binaries=[],
    datas=[
        # Frontend build output
        (str(repo_root / "app" / "frontend" / "dist"), "frontend_dist"),
        # Algorithm packages
        (str(repo_root / "packages"), "packages"),
        # Scenario definitions
        (str(repo_root / "scenarios"), "scenarios"),
    ],
    hiddenimports=[
        # Backend package — all modules
        "aica_api",
        "aica_api.main",
        "aica_api.config",
        "aica_api.algorithms",
        "aica_api.algorithms._errors",
        "aica_api.algorithms.adapter",
        "aica_api.algorithms.declarative_rule",
        "aica_api.algorithms.python_module",
        "aica_api.algorithms.weighted_score",
        "aica_api.models",
        "aica_api.models.decision",
        "aica_api.models.feedback",
        "aica_api.models.log",
        "aica_api.models.package",
        "aica_api.models.profile",
        "aica_api.models.run",
        "aica_api.models.scenario",
        "aica_api.routers",
        "aica_api.routers.packages",
        "aica_api.routers.routes",
        "aica_api.routers.run_plans",
        "aica_api.routers.runs",
        "aica_api.routers.scenarios",
        "aica_api.services",
        "aica_api.services.behavior",
        "aica_api.services.behavior.driver_model",
        "aica_api.services.behavior.vehicle_model",
        "aica_api.services.binning",
        "aica_api.services.event_plan",
        "aica_api.services.evidence",
        "aica_api.services.evidence_markdown",
        "aica_api.services.feedback",
        "aica_api.services.maps_client",
        "aica_api.services.package_registry",
        "aica_api.services.recovery",
        "aica_api.services.route_analysis",
        "aica_api.services.run_manager",
        "aica_api.services.run_plan",
        "aica_api.services.scenario_registry",
        "aica_api.services.tick_engine",
        "aica_api.storage",
        "aica_api.storage.evidence_recorder",
        "aica_api.storage.file_store",
        # Uvicorn
        "uvicorn",
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        # FastAPI / Starlette
        "fastapi",
        "starlette",
        "starlette.routing",
        "starlette.staticfiles",
        "starlette.responses",
        # Async runtime
        "anyio",
        "anyio._backends",
        "anyio._backends._asyncio",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "numpy", "pandas", "scipy", "matplotlib", "PIL", "tkinter",
        "sqlite3", "unittest",
        "lib2to3", "doctest", "pdb", "profile", "cProfile",
        "_tkinter", "tk", "tcl",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="aica-simulator",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name="aica-simulator",
)
