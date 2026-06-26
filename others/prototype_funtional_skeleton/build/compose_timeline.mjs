// compose_timeline.mjs — role composeTimeline (TP-001 v5)
//
// Pure, side-effect-free assembly of a case's scenario beat arc. Given a case
// definition (which names its branch) and the payload beat catalog, it returns
// the ordered beat-id array for that case: the shared pre-trigger segment
// followed by the branch segment (no_fire | fire | fallback). It hardcodes no
// beat ids — every id comes from the passed-in beat catalog — and reads nothing
// from globals or I/O.
//
// v3 carry-forward (REQ-INT-005, still pure / BUILD-DATA-driven): for a "fire"
// branch whose beat_catalog declares a selection sub-branch (a `selection_beat`
// plus a `selection_sub_branches` map with `rest_option` / `postpone` beat-id
// lists), an optional third argument selects which sub-branch the realized arc
// follows after the selection beat. When the catalog declares no sub-branch
// (UC-02..04) the behavior is byte-equivalent to v2.
//
// v4 extension (REQ-INT-009/010/011/012, all pure / BUILD-DATA-driven):
//  - `motionStateFor(beatId, motionKeys)` threads each beat's MOVING | STOPPED
//    motion state from the payload `motion_state_keys` (held-for-selection stops
//    and the UC-01 rest-spot arrival stops are STOPPED; everything else is the
//    declared `default_motion`). It hardcodes no beat id.
//  - `regenerateTimeline(spec)` recomputes the WHOLE explore-mode timeline —
//    branch, included beats, and per-beat content + motion_state — from the
//    payload `flow_skeletons` (keyed by the trigger result type, the trigger
//    result acting as the branch selector) and the per-beat authored content,
//    so an explore-mode parameter edit that flips the trigger result yields a
//    different regenerated timeline (different branch / beats). Pure: same inputs
//    give the same regenerated timeline.
//
// v5 carry-forward (REQ-INT-013 / DIFF-014, networked surface target): this
// timeline-composition + motion / regeneration logic is byte-identical to v4. The
// networked map surface (the route / places data source) is thin glue that calls
// these tested modules; only the data source moves outside the deterministic
// boundary, never the algorithm.
//
// composeTimeline(caseDef, beatCatalog [, selectionOutcome]) -> [beatId, ...]
// motionStateFor(beatId, motionKeys)                          -> 'MOVING' | 'STOPPED'
// regenerateTimeline(spec)                                    -> { branch, beats: [...] }
//
// Branch semantics (behavior_rules.md / fixtures.md):
//  - "no_fire": the pre arc up to and including the case's no-fire terminal beat,
//    then no proposal branch.
//  - "fire":    the full pre arc, then the fire branch's realized arc (the
//    selectable-recovery proposal through return-to-drive). Beat-variant ids in
//    the fire list (alternate selection branches) are not part of the default
//    realized arc; the realized arc is the canonical chain excluding the
//    alternate "<base>B".."<base>E" sibling variants. When a selection sub-branch
//    is declared and an outcome is given, the post-selection beats follow that
//    outcome's declared beat-id list instead.
//  - "fallback": the pre arc up to and including the case's fallback terminal
//    beat (the acknowledgement beat), then no branch.

function indexOfTerminal(preArc, terminalId) {
  const i = preArc.indexOf(terminalId);
  return i === -1 ? preArc.length - 1 : i;
}

// From an ordered beat list, drop the alternate selection-branch sibling
// variants — beat ids that share a numeric stem with an earlier id but carry a
// later letter suffix (e.g. keep "...S010A", drop "...S010B".."...S010E").
function realizedArc(beatList) {
  const seenStems = new Set();
  const out = [];
  for (const id of beatList) {
    const m = /^(.*?)([A-Z])$/.exec(id); // trailing single-letter variant suffix
    if (m) {
      const stem = m[1];
      const letter = m[2];
      if (seenStems.has(stem)) {
        // An earlier variant of this stem is already in the arc; this is a
        // sibling alternate selection branch — not part of the realized arc.
        continue;
      }
      seenStems.add(stem);
      // Keep only the first variant of each stem (e.g. the "A" branch).
      if (letter === 'A') {
        out.push(id);
        continue;
      }
      // A lettered id whose stem was not yet seen and is not "A": keep it as the
      // canonical realized beat for that stem.
      out.push(id);
      continue;
    }
    out.push(id);
  }
  return out;
}

export function composeTimeline(caseDef, beatCatalog, selectionOutcome) {
  const branch = caseDef && caseDef.branch;
  const pre = Array.isArray(beatCatalog.pre) ? beatCatalog.pre.slice() : [];

  if (branch === 'no_fire') {
    const terminal = (beatCatalog.no_fire && beatCatalog.no_fire[beatCatalog.no_fire.length - 1]);
    const end = indexOfTerminal(pre, terminal);
    return pre.slice(0, end + 1);
  }

  if (branch === 'fallback') {
    const terminal = (beatCatalog.fallback && beatCatalog.fallback[beatCatalog.fallback.length - 1]);
    const end = indexOfTerminal(pre, terminal);
    // The fallback terminal is the AICA_PROPOSAL acknowledgement beat. If it is
    // not part of pre, append it explicitly so the fallback arc ends on it.
    if (pre.indexOf(terminal) === -1 && terminal) {
      return pre.concat([terminal]);
    }
    return pre.slice(0, end + 1);
  }

  if (branch === 'fire') {
    // REQ-INT-005 — selection sub-branch: when the catalog declares a
    // selection_beat and a selection_sub_branches map, the realized fire arc is
    // the proposal + selection beats up to and including the selection beat,
    // then the chosen outcome's declared post-selection beats. All beat ids come
    // from the catalog; no ids are hardcoded.
    const sub = beatCatalog.selection_sub_branches;
    const selBeat = beatCatalog.selection_beat;
    if (sub && selBeat) {
      const fire = Array.isArray(beatCatalog.fire) ? beatCatalog.fire : [];
      const selIdx = fire.indexOf(selBeat);
      // Lead = the fire beats up to and including the selection beat, with
      // alternate sibling variants dropped (none expected before the selection).
      const lead = realizedArc(selIdx === -1 ? fire : fire.slice(0, selIdx + 1));
      // Resolve the outcome's declared beat list; default to rest_option (the
      // canonical recovery path) when no explicit, recognized outcome is given.
      const key = (selectionOutcome === 'postpone' || selectionOutcome === 'rest_option')
        ? selectionOutcome
        : 'rest_option';
      const tail = realizedArc(Array.isArray(sub[key]) ? sub[key] : []);
      return pre.concat(lead, tail);
    }
    // No sub-branch declared (UC-02..04): byte-equivalent to v2.
    const fireArc = realizedArc(Array.isArray(beatCatalog.fire) ? beatCatalog.fire : []);
    return pre.concat(fireArc);
  }

  // Unknown branch: return the pre arc unchanged (total, deterministic).
  return pre;
}

// REQ-INT-009/010/012 — thread each beat's motion state through to the rendered
// timeline. STOPPED at every held-for-selection stop and (UC-01) at every
// rest-spot arrival/hold beat; MOVING (the declared default) everywhere else.
// No beat id is hardcoded — the stop sets come from the payload motion_state_keys.
export function motionStateFor(beatId, motionKeys) {
  const keys = motionKeys || {};
  const held = Array.isArray(keys.held_for_selection_stop) ? keys.held_for_selection_stop : [];
  const arrival = Array.isArray(keys.uc01_arrival_stop) ? keys.uc01_arrival_stop : [];
  if (held.indexOf(beatId) !== -1) return 'STOPPED';
  if (arrival.indexOf(beatId) !== -1) return 'STOPPED';
  return keys.default_motion || 'MOVING';
}

// REQ-INT-009/010 — PURE PRESENTATION LOGIC (tier A): the per-beat route layout.
// This is the behavior REQ-INT-010 describes (the car holds ON the rest spot
// through the whole recovery, not driving past it), kept in a tested module rather
// than the untested template app-layer so it is verified by node --test (see
// compose_timeline.test.mjs). restStopIdsFor returns the arrival/recovery STOPPED
// beats present in the arc, in order.
export function restStopIdsFor(arc, motionKeys) {
  const stop = (motionKeys && Array.isArray(motionKeys.uc01_arrival_stop)) ? motionKeys.uc01_arrival_stop : [];
  if (!stop.length) return [];
  const set = new Set(stop);
  return (Array.isArray(arc) ? arc : []).filter((id) => set.has(id));
}
// beatLayout(spec) -> [{ id, motion, pos }] for the whole arc (pos = route fraction
// in [0,1]). spec = { arc, motionKeys, preLen, fp1, restAt, restLayout }.
//  - restLayout=true (the UC-01 rest-spot stop-recover flow): the branch beats
//    split into APPROACH (spread across [fp1, restAt)), the STOPPED arrival/recovery
//    beats (ALL co-located AT restAt — the car holds here), and DEPART beats (across
//    (restAt, 1]). This is what stops the car ON the rest spot through dim/sleep →
//    chosen content instead of driving through them.
//  - otherwise: branch beats spread evenly across [fp1, 1] (the default, unchanged).
// Pure: same inputs -> same layout.
export function beatLayout(spec) {
  const s = spec || {};
  const arc = Array.isArray(s.arc) ? s.arc : [];
  const motionKeys = s.motionKeys || {};
  const preLen = Math.max(0, s.preLen | 0);
  const fp1 = (typeof s.fp1 === 'number') ? s.fp1 : 1;
  const restAt = (typeof s.restAt === 'number') ? s.restAt : null;
  const out = arc.map((id) => ({ id, motion: motionStateFor(id, motionKeys), pos: 0 }));
  for (let i = 0; i < out.length && i < preLen; i++) { out[i].pos = preLen ? (i / preLen) * fp1 : 0; }
  const branch = out.slice(preLen);
  if (!branch.length) return out;
  if (s.restLayout && restAt != null) {
    const stopSet = new Set(restStopIdsFor(arc, motionKeys));
    const first = branch.findIndex((b) => stopSet.has(b.id));
    let last = -1; for (let i = 0; i < branch.length; i++) { if (stopSet.has(branch[i].id)) last = i; }
    if (first !== -1) {
      const approach = branch.slice(0, first);
      const stop = branch.slice(first, last + 1);
      const depart = branch.slice(last + 1);
      approach.forEach((b, j) => { b.pos = fp1 + ((j + 1) / (approach.length + 1)) * (restAt - fp1); });
      stop.forEach((b) => { b.pos = restAt; });
      depart.forEach((b, m) => { b.pos = depart.length <= 1 ? Math.min(1, restAt + 0.02) : restAt + (m / (depart.length - 1)) * (1 - restAt); });
      return out;
    }
  }
  const restCount = branch.length;
  branch.forEach((b, k) => { b.pos = fp1 + (k / restCount) * (1 - fp1); });
  return out;
}

// REQ-INT-011 — recompute the WHOLE explore-mode timeline from the parameter
// groups. The trigger `result` (computed by evaluateTrigger from the live input
// state) is the branch selector: flowSkeletons[result.result_type] gives the
// branch and its included beat ids. For the UC-01 fire branch, a `postpone`
// selection outcome substitutes the skeleton's `postpone` beat list for the
// post-selection beats (no waypoint / no stop). Each included beat is dressed
// with its authored per-beat content (title, category, aica_message, system
// action, the per-beat states) keyed by id, and its motion_state from
// motionStateFor. When the authored case timeline does not carry a skeleton beat
// (e.g. a beat only present in another case), a minimal content stub keyed off
// the fragment library / beat id is produced so the regenerated timeline is
// always complete. Pure & deterministic.
//
// spec = {
//   result,              // { result_type, ... } from evaluateTrigger
//   flowSkeletons,       // payload flow_skeletons
//   beatById,            // { beatId -> authored beat object }
//   motionKeys,          // payload motion_state_keys
//   fragments,           // payload fragment_library
//   selectionOutcome,    // 'rest_option' | 'postpone' | null
//   params               // the live input state (context + hyperparameters): the
//                        //   presentation hyperparameters (assertiveness,
//                        //   content_safety_strictness, personalization_*) shape
//                        //   each beat's content per temporary_logic.md §1A pt 3.
// }
export function regenerateTimeline(spec) {
  const s = spec || {};
  const result = s.result || {};
  const skeletons = s.flowSkeletons || {};
  const beatById = s.beatById || {};
  const fragments = s.fragments || {};
  const rt = result.result_type;
  const sk = skeletons[rt];
  if (!sk) {
    return { branch: 'unknown', result_type: rt || null, beats: [] };
  }
  // The skeleton's beat list is the included-beat view for this result type.
  let ids = Array.isArray(sk.beats) ? sk.beats.slice() : [];
  // UC-01 postpone outcome: replace the post-selection tail with the skeleton's
  // declared postpone beats. The selection beat is the last held-for-selection
  // stop present in the skeleton; everything after it is the post-selection tail.
  if (s.selectionOutcome === 'postpone' && Array.isArray(sk.postpone) && sk.postpone.length) {
    const held = (s.motionKeys && s.motionKeys.held_for_selection_stop) || [];
    let cut = -1;
    for (let i = 0; i < ids.length; i++) { if (held.indexOf(ids[i]) !== -1) cut = i; }
    if (cut !== -1) {
      ids = ids.slice(0, cut + 1).concat(sk.postpone);
    }
  }
  const framing = (fragments.result_framing && fragments.result_framing[rt]) || '';
  // §1A pt 3 — the presentation hyperparameters qualitatively shape each beat's
  // content. These are deterministic look-ups into the fragment library keyed by
  // the live hyperparameter values, so changing assertiveness / content strictness
  // / personalization regenerates the per-beat information (not just the branch).
  const p = s.params || {};
  const tone = (fragments.assertiveness_tone && fragments.assertiveness_tone[p.assertiveness]) || '';
  const persoOn = p.personalization_available !== false;
  const persoNote = persoOn
    ? ((fragments.personalization_eagerness_note && fragments.personalization_eagerness_note[p.personalization_eagerness]) || '')
    : '';
  // Content mode: while moving, visual is held unless strictness is lenient; once
  // stopped, visual is allowed — so content_safety_strictness is a live dial.
  const contentModeFor = (motion) => {
    if (motion === 'STOPPED') return 'visual_allowed_after_stop';
    return (p.content_safety_strictness === 'lenient') ? 'visual_allowed_after_stop' : 'audio_only';
  };
  const beats = ids.map((id) => {
    const b = beatById[id] || {};
    const motion = motionStateFor(id, s.motionKeys);
    const motionNote = (fragments.motion_state_note && fragments.motion_state_note[motion]) || '';
    const cat = b.category || '';
    const speaks = cat === 'AICA_PROPOSAL' || cat === 'USER_SELECTION';
    const carriesContent = cat === 'RECOVERY' || cat === 'SYSTEM_ACTION';
    const extras = [];
    if (speaks && tone) extras.push(tone);
    if (speaks && persoNote) extras.push(persoNote);
    if (carriesContent) {
      const cm = (fragments.content_mode_note && fragments.content_mode_note[contentModeFor(motion)]) || '';
      if (cm) extras.push(cm);
    }
    const information = [b.description || framing, ...extras].filter(Boolean).join(' ');
    return {
      id,
      category: cat,
      title: b.title || id,
      motion_state: motion,
      aica_message: (b.aica_message != null ? b.aica_message : null),
      status: motionNote,
      information,
      user_options: (b.user_options != null ? b.user_options : null)
    };
  });
  return { branch: sk.branch || '', result_type: rt, beats };
}
