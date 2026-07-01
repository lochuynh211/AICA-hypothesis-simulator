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
import glob
from pathlib import Path

repo_root = Path(os.getcwd())
build_dir = repo_root / "build"
api_dir = repo_root / "app" / "api"

block_cipher = None

# Auto-discover all aica_api modules so the spec never needs manual updates
def collect_submodules(package_dir, package_name):
    """Walk the package tree and return all importable module paths."""
    modules = []
    for py_file in sorted(Path(package_dir).rglob("*.py")):
        rel = py_file.relative_to(package_dir)
        parts = list(rel.with_suffix("").parts)
        if parts[-1] == "__init__":
            parts = parts[:-1]
        if parts:
            modules.append(".".join(parts))
    return modules

aica_modules = collect_submodules(api_dir, "aica_api")

a = Analysis(
    [str(build_dir / "launcher.py")],
    pathex=[str(api_dir)],
    binaries=[],
    datas=[
        # Frontend build output
        (str(repo_root / "app" / "frontend" / "dist"), "frontend_dist"),
        # Algorithm packages
        (str(repo_root / "packages"), "packages"),
        # Scenario definitions
        (str(repo_root / "scenarios"), "scenarios"),
    ],
    hiddenimports=aica_modules + [
        # Uvicorn (dynamic internal imports)
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
