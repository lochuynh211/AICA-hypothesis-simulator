// firePosition.mjs — derived on-route marker placement (TP-001 v5)
//
// Pure, side-effect-free placement of the on-route firing markers ①②③ as a
// route fraction in [0, 1]. This is the derived presentation rule of the
// data / interface models (draft §5.4): the *result type* decides whether ①
// appears, and where ① lands is driven by how soon the trigger fires (earlier
// when the risk is higher / fires sooner — i.e. higher sensitivity or a
// stronger/long-drive band) and the course speed band; events ②③ sit at and
// just before the course's flagged rest-facility segment (UC-01 only). No
// concrete distances or speeds — only qualitative ordinal bands and the course's
// own segment fractions. No I/O, no globals.
//
// Carried forward byte-for-byte from v4 (and v3/v2/v1): the v5 navigation-surface
// swap (REQ-INT-013 / DIFF-014) is render / template-side and does not change this
// module. On the networked map surface the firing marker is placed on the real
// route at the same derived fraction; the placement math is byte-identical.
//
// firePosition(eventNum, result, course) -> number in [0, 1]
//
//  - result: { result_type, rule_id, reason_inputs, input_state?, earliness? }
//            earliness (0..1) is an optional caller-supplied "fires-sooner"
//            reading; when absent it is derived from the result type band.
//  - course: a BUILD-DATA course object with .segments[] carrying .is_rest_facility
//            and .at (0..1) and a qualitative .speed_band.

const SPEED_PUSH = { low: 0.0, medium: 0.06, high: 0.12 };

function restFraction(course) {
  const segs = (course && course.segments) || [];
  const rest = segs.find(s => s.is_rest_facility);
  if (rest && typeof rest.at === 'number') return rest.at;
  // Fallback: middle of the route if no flagged rest facility.
  return 0.5;
}

// Map a result type to a default earliness in [0,1] (1 = fires as soon as
// possible, nearest home; 0 = fires latest). Higher-risk results fire sooner.
function defaultEarliness(resultType) {
  switch (resultType) {
    case 'SEVERE_INTERVENTION': return 0.9;
    case 'REST_PROPOSAL': return 0.65;
    case 'NO_PRACTICAL_ACTION_FALLBACK': return 0.6;
    case 'SOFT_WARNING': return 0.45;
    default: return 0.0; // NO_TRIGGER — no marker; caller should not place ①
  }
}

export function firePosition(eventNum, result, course) {
  const restAt = restFraction(course);
  const speedPush = SPEED_PUSH[(course && course.speed_band)] || 0;

  if (eventNum === 1) {
    // ① lands before the rest facility; earlier (toward home, smaller fraction)
    // as the result fires sooner / risk is higher; a higher speed band pushes it
    // a little later down the route.
    const earliness = (result && typeof result.earliness === 'number')
      ? result.earliness
      : defaultEarliness(result && result.result_type);
    // earliness 1 -> nearest home (small fraction); 0 -> just before rest.
    const lo = 0.12;                 // closest ① ever lands to home
    const hi = Math.max(lo + 0.02, restAt - 0.05); // latest ① before the rest seg
    const frac = hi - (hi - lo) * earliness + speedPush;
    return Math.min(hi, Math.max(lo, frac));
  }

  if (eventNum === 2) {
    // ② rest-spot imminent — just before the rest facility.
    return Math.max(0, restAt - 0.08);
  }

  // ③ rest-spot arrival — at the rest facility.
  return restAt;
}
