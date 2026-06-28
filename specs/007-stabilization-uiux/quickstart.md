# Quickstart: M6 V1 Stabilization & UI/UX Polish

## Start
```bash
docker compose up        # api :8137, frontend :5180
```
Open `http://localhost:5180`.

## Run UC-01 end-to-end (the V1 loop)
1. **Setup screen**: pick a package + scenario; optionally tune parameters/hyperparameters; optionally
   edit the **behavior profiles** (driver/vehicle/speed — "reset to scenario default" restores them);
   optionally enter a **Maps** key + start/end and pick a route (else the local route is used).
2. **Start Run** → switches to the **Review screen** (the 3-panel layout); the playback **animates**
   through the run; inspect the decision trace + proposal; record **feedback**.
3. Switch the **language** (JA/EN) any time from the header — all labels follow.
4. **New run / Setup** returns to the Setup screen; **Restart** re-runs the same configuration.
5. **Runs screen**: browse past runs (from `runs/`); open one to review its **evidence** — the
   structured timeline, a **visual replay** (scrub the recorded ticks, read-only), and **export**
   (copy/download JSON or Markdown).

## Backend-only (curl)
```bash
B=http://localhost:8137
# profile override on a run-plan:
# POST /api/run-plans { package_id, scenario_id, profiles: { speed_profile: {...} }, ... }
curl -s "$B/api/runs/<run_id>/evidence?ui_language=ja" | head
curl -s "$B/api/runs/<run_id>/evidence.md"           # markdown evidence
curl -s "$B/api/runs"                                 # run list
```

## Verify no Maps key persisted
No `runs/*.json` and no browser localStorage/sessionStorage ever contains the key (an explicit check).

## Tests
```bash
cd app/api && uv run pytest    # profile-override threading, evidence ui_language + markdown, key-not-persisted, UC-01 integration
cd app/frontend && npm test    # three-view shell, language toggle, profile editor, run list, visual replay, markdown copy/download
```

## Not in M6 (V1)
Run comparison, expert-override mode, accounts/auth/multi-user/cloud, a router/i18n/Markdown library,
persisting the language or Maps key to disk.
