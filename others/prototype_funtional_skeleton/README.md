# TP-001 v5 · UC-01 — AICA Recovery-Proposal Course Simulator (real-map networked surface)

This is the built artifact for **Target-Prototype TP-001**, **use case UC-01**
(fatigue / drowsiness), **loop LOOP-005**, **prototype version v5**. It realizes
REQ-INT-013 (DIFF-014, superseding the previously rejected DIFF-004): the cockpit
navigation surface is now a **real embedded Google map — a networked surface
target**.

AICA (AI cockpit assistant) is the in-car assistant this simulator presents. After
this first use the short form **AICA** is used.

## How to open

Open `index.html` directly from the filesystem (`file://`) — no server is needed.
The artifact is **self-contained except for the one declared networked map
surface** (the navigation panel): it references no other external resource and
makes no other network request, and it opens and stays usable offline with that
map surface inert.

```
xdg-open index.html      # or just open index.html in a browser
```

## Networked surface — bring your own key (BYO-key gate)

The navigation panel is a **real embedded Google map** that draws the live route
between the case's named start and end places, lists rest spots along it, and
carries the car, the firing markers ①②③, and the on-map AICA proposal overlay on
that real map. Per the "Networked surface target" contract:

- **No Google Maps key is shipped, shown, defaulted, or persisted.** The map stays
  **inert until you enter your own key at runtime** in the map-control bar. Your key
  is your service and your billing; it is never stored and never included in the
  review export.
- A git-ignored `key.local.js` placeholder may set a dev key for local testing only;
  it is never committed and never contains a real key value in the repo.
- **G1 (offline re-render byte-determinism) and G5 (self-containment) are waived for
  this map surface only.** They are replaced by **snapshot-for-review** (each case's
  `route_snapshot` carries the boundary-binned ordinal route bands so a reviewer can
  reproduce the scenario offline without a live key) and the **BYO-key / no-secret
  rule** above. **G3 (tested = shipped), G7 (behavioral acceptance), and the
  qualitative-trigger discipline still hold** — all behavioral logic stays in the
  tested tier-A modules, and real route quantities are boundary-binned into ordinal
  bands before the trigger, so no concrete numeric reaches the decision logic.

## How to run the unit tests

The pure-logic tier-A modules are unit-tested (G3 = tested is shipped):

```
node --test domain_prototype/tym_aica/target_prototypes/TP-001/v5/uc01/build/tests/
```

This runs the trigger rule list, the timeline composition + motion / rest-spot
order, the boundary-binning + structural-signature checks, and the artifact
conformance checks against the rendered `index.html`.

## How to re-render

`index.html` is **generated, not hand-edited**. To regenerate it from the shared
template + this use case's `build/build_data.json` + the inlined tested modules:

```
node domain_prototype/tym_aica/target_prototypes/TP-001/v5/uc01/build/render.mjs
```

Re-rendering on unchanged inputs is byte-identical for the deterministic portion of
the artifact (the live map surface's pixels are not byte-deterministic — G1 waived
there only). Never edit `index.html` by hand: change the template, the
`build_data.json`, or a module and re-render.

## Generated-not-hand-edited

`index.html` is the deterministic two-tier render output: the shared template
(`target_prototypes/templates/aica_course_sim_template.html`) with the single
BUILD-DATA region replaced by this use case's payload and the tier-A module sources
inlined byte-for-byte. Do not hand-edit it.

## Temporary-behavior warning

This behavior model is temporary prototype behavior.
It is used to make the Target-Prototype executable.
It is not final AICA product specification.
