"""Standalone launcher for the AICA Hypothesis Simulator.

Wraps the existing FastAPI app with static file serving and opens the
browser. Used as the PyInstaller entry point. Does NOT modify the
existing source — it imports and extends at runtime.
"""

import os
import sys
import webbrowser
import threading
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse


def get_base_path() -> Path:
    """Resolve the base path for bundled resources.

    When frozen by PyInstaller, resources are unpacked to sys._MEIPASS.
    Otherwise, use the repo root (parent of build/).
    """
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parent.parent


def get_data_path() -> Path:
    """Resolve writable data path for runs/.

    When frozen, writes go next to the exe so users can find them.
    In development, use the repo root.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).parent
    return Path(__file__).resolve().parent.parent


def create_app() -> FastAPI:
    """Create the combined app: existing API + static frontend."""
    base = get_base_path()
    data = get_data_path()

    # Set environment variables so the existing config.py resolves paths correctly
    os.environ.setdefault("AICA_PACKAGES_DIR", str(base / "packages"))
    os.environ.setdefault("AICA_SCENARIOS_DIR", str(base / "scenarios"))
    os.environ.setdefault("AICA_RUNS_DIR", str(data / "runs"))

    # Ensure runs directory exists
    (data / "runs").mkdir(parents=True, exist_ok=True)

    # Import the existing FastAPI app AFTER setting env vars.
    # The existing app already has all /api/* routes registered.
    from aica_api.main import app as api_app

    # Add static frontend serving to the existing app
    static_dir = base / "frontend_dist"
    if static_dir.exists():
        # Serve Vite assets directory
        assets_dir = static_dir / "assets"
        if assets_dir.exists():
            api_app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        # SPA catch-all: serve index.html for non-API, non-asset routes
        @api_app.get("/{path:path}")
        async def serve_frontend(request: Request, path: str):
            file_path = static_dir / path
            if file_path.is_file():
                return FileResponse(file_path)
            return FileResponse(static_dir / "index.html")

    return api_app


def open_browser(port: int):
    """Open the default browser after a short delay."""
    import time
    time.sleep(1.5)
    webbrowser.open(f"http://localhost:{port}")


def main():
    port = int(os.environ.get("AICA_PORT", "8137"))

    print(f"Starting AICA Hypothesis Simulator on http://localhost:{port}")
    print("Press Ctrl+C to stop.")

    # Open browser in background thread
    thread = threading.Thread(target=open_browser, args=(port,), daemon=True)
    thread.start()

    app = create_app()
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\nERROR: {e}")
        import traceback
        traceback.print_exc()
        input("\nPress Enter to close...")
        sys.exit(1)
