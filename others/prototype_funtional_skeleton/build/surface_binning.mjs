// surface_binning.mjs — tier-A boundary-binning + structural-signature (TP-001 v5)
//
// NEW in v5 (REQ-INT-013 / DIFF-014, networked surface target). Two pure,
// side-effect-free computations that the networked map surface depends on; both
// are unit-tested (G3 = tested is shipped) and inlined byte-for-byte into the
// artifact, so the behavior the artifact relies on is the behavior tested under
// `node --test`, not untested app-layer script (G7).
//
//   1. boundaryBin(rawRoute) — the surface→input boundary. Maps the live route's
//      REAL quantities (travel-time seconds, remaining-to-destination seconds,
//      rest-spot reachability distance metres) into the existing QUALITATIVE
//      ordinal bands the §5 trigger already tests (continuous_driving_time,
//      destination_eta, rest_spot_eta). This runs BEFORE the engine, so no
//      concrete numeric ever reaches the decision logic — Constitution
//      Principle III is preserved on the networked surface. The output is a small
//      object of ordinal band values only (never a number, never raw geometry,
//      never a key).
//
//   2. structuralSignature(state) — the persist-vs-rerender decision for the
//      reparented map div. The signature is a stable string of the STRUCTURAL
//      fields of the regenerated scenario (the proposal stage, the result type,
//      the selected option, the recovery / selection flags, the selection
//      outcome, the active course). It is STABLE across a playback tick (pos /
//      time advancing) — pos is deliberately NOT part of the signature — so the
//      cockpit (and the embedded map) re-renders ONLY when the structure changes,
//      not on every animation frame, which is what keeps the map from
//      disappearing on Play. The decision is therefore a tested computation, not
//      an app-layer one.
//
// boundaryBin(rawRoute)       -> { continuous_driving_time, destination_eta, rest_spot_eta }
// structuralSignature(state)  -> string (stable across a playback tick)

// --- 1. boundary-binning: live route metres / seconds -> ordinal bands ---------

// Travel time (seconds) -> continuous_driving_time band. Short under 30 min,
// moderate under 90 min, long beyond. Qualitative bands, not committed thresholds.
export function binDriveTime(sec) {
  if (sec == null) return 'short';
  if (sec < 1800) return 'short';
  if (sec < 5400) return 'moderate';
  return 'long';
}

// Remaining-to-destination (seconds) -> destination_eta band.
export function binDestEta(sec) {
  if (sec == null) return 'medium';
  if (sec < 1200) return 'close';
  if (sec < 3600) return 'medium';
  return 'far';
}

// Rest-spot reachability (metres to the nearest targeted rest spot, or null when
// none was found) -> rest_spot_eta band. A reachable nearby spot is near; a far
// spot is far; no spot found is none.
export function binRestEta(metres) {
  if (metres == null) return 'none';
  if (metres <= 20000) return 'near';
  return 'far';
}

// The whole surface→input boundary. rawRoute carries ONLY the live numeric
// quantities the surface measured; this returns ONLY ordinal bands. No number,
// no raw geometry, no key crosses out of here into the engine.
//
// rawRoute = { travel_time_sec, remaining_to_destination_sec, rest_spot_metres }
export function boundaryBin(rawRoute) {
  const r = rawRoute || {};
  return {
    continuous_driving_time: binDriveTime(r.travel_time_sec),
    destination_eta: binDestEta(r.remaining_to_destination_sec),
    rest_spot_eta: binRestEta(r.rest_spot_metres)
  };
}

// --- 2. structural-signature: persist-vs-rerender for the reparented map div ----

// The structural fields of the regenerated scenario. Anything that changes the
// COCKPIT STRUCTURE (which panel/overlay is shown, the branch, the chosen option,
// the recovery / selection flags, the active route) belongs here; the per-frame
// playback position (pos / time) deliberately does NOT, so a playback tick yields
// the SAME signature and the map is not torn down and reparented every frame.
export function structuralSignature(state) {
  const s = state || {};
  return [
    s.proposalNum,            // which on-route event's overlay is showing (null / 1 / 2 / 3)
    s.resultType,             // the trigger result type (branch selector)
    s.selectedOption,         // the chosen recovery/consent option
    s.recoveryActive,         // UC-01 stopped-recovery sequence showing?
    s.recoveryReleased,       // recovery played out (car departed)?
    s.recoveryCursor,         // which recovery beat is playing
    s.selectionConsumed,      // held-for-selection stop released?
    s.selectionOutcome,       // rest_option | postpone | null
    s.courseId                // active course / route id
  ].join('|');
}
