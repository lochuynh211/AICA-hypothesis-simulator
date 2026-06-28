# Quickstart: M5 Review Feedback & Evidence Completeness

## Start
```bash
docker compose up        # api :8137, frontend :5180
```
Open `http://localhost:5180`.

## Record feedback (UI)
1. Run a UC-01 scenario to a proposal.
2. In the review panel, open the **Feedback** form — it shows the V1 review labels (proposal
   timing, safety impression, intrusiveness, understandability, rest-spot suitability, content
   suitability, accept/reject reason, overall judgment) + a free-text comment, plus any
   package-defined extra fields.
3. Submit attached to that proposal (or to a decision / your action / the whole run at end).
4. The feedback is persisted in the run log; the decisions are unchanged.

## Review a persisted run (evidence timeline)
Open a finished run's evidence view: the recorded events (ticks + decision trace, proposals,
actions, **feedback**, errors) render in order as an expandable, read-only timeline — feedback
visually distinct from simulator facts. No algorithm is re-run.

## Export evidence
Copy or download the evidence JSON: `simulator_facts` (route snapshot, route facts, plan,
profiles, setup values, timeline, decisions, proposals, actions, errors) are clearly separated
from `human_review` (the review labels + free-text comments). It carries enough to reproduce the
run and never claims the simulator judged the algorithm.

## Backend-only (curl)
```bash
B=http://localhost:8137
# GET schema → POST feedback → GET evidence
curl -s $B/api/runs/<run_id>/feedback-schema
curl -s -X POST $B/api/runs/<run_id>/feedback -H 'content-type: application/json' \
  -d '{"target":{"scope":"run"},"labels":{"overall_judgment":"good_trigger"},"comment":"timely"}'
curl -s $B/api/runs/<run_id>/evidence    # {simulator_facts, human_review}
# Feedback also works on an older on-disk run (after a restart): load → append → re-persist.
```

## Tests
```bash
cd app/api && uv run pytest    # feedback schema, validation matrix, append (active + disk-backed),
                               # evidence export §14.2 separation
cd app/frontend && npm test    # feedback form by-type + submit; evidence timeline; copy/download
```

## Not in M5
Markdown export, visual scrubbable replay, feedback edit/delete, cross-run analytics, the
setup-change/comparison feedback scopes, creating expert-override events, auth, a UI language selector.
