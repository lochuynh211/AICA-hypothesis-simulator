# AICA Transparent Service-Proposal Algorithm

Status: approved CDC-SU baseline V1 design (deterministic normalized hierarchical weighted response)
Scope: transparent selector that ranks AICA **services**; concrete-content selection is a separate algorithm
Last updated: 2026-07-15

---

## 1. Related documents

- [AICA proposal simulator specification](./aica_proposal_simulator_specification.md)
- [AICA transparent content-proposal algorithm](./aica_transparent_content_proposal_algorithm.md)
- [AICA synthetic Spotify-compatible music data and generation specification](./aica_synthetic_music_data_and_generation_specification.md)
- Primary source: `others/CDC-SU_specplan.md` — Slides 38–40 (service definitions), 64–66 (two-decision flow), **67** (the service-priority matrix — the sole response-coefficient source). Slides 68–73 (including 70) define the **content** selector's inputs and are **not** used for service ranking.

---

# Part I — Overview

## 2. Overview

### 2.1 Purpose

After the trigger engine has established a **proposal opportunity** (a purpose and
a lifecycle stage), this algorithm ranks the eligible **services** — which service
to propose, in what order. It returns up to three ranked services, each shown with
its selection score and complete feature-level arithmetic.

The canonical output `service_fit` is a signed normalized value in `[-1,+1]`. It is
**not** a probability of acceptance, a measured recovery effect, or a safety
certification.

### 2.2 Selected design in one paragraph

Every feature contributes the same way: an **evidence** value `e_i` (how strongly
the current world calls for something) times a **response coefficient** `a_i(c)`
(how well *this candidate service* answers it). Evidence is read once from the
world snapshot; the response coefficient is a **hand-authored property of the
candidate service ID**, derived from Slide 67 and the service definitions
(Slides 38–40). Each feature's signed response `r_i = e_i·a_i` is scaled by that
feature's normalized hierarchical weight and summed into `service_fit`. Absolute
safety lives in hard eligibility (before scoring); relative suitability lives in
visible, editable weights and coefficients.

### 2.3 Relationship to the content selector

| Concern | Service selector (this doc) | Content selector |
|---|---|---|
| Decision | Which service to propose | Which concrete items to place in it |
| Candidate | A service | A Spotify-compatible Track (or mode/genre) |
| Response `a_i` | **Hand-authored** per service ID | **Computed** from item audio traits / exact-ID metadata |
| Output | Ranked services + lifecycle | Ordered item plan |
| Source | Slides 66–67 (service priority) | Slides 68–73 (content inputs) |

The two decisions are deliberately separate (Slides 64–66). Service fit must never
include concrete catalog-item scores produced by the later content selector, and
must never consume another package's score.

### 2.4 Decision boundary

**Control inputs** (constrain evaluation, never scored): `trigger_purpose`,
`lifecycle_stage`, `allowed_service_ids`, `eligible_candidates`,
`excluded_candidates`, catalog/parameter/hyperparameter versions.

**Scored evidence:** only the **17 CDC-SU baseline service features** (§5.3).

**Non-scoring controls** (must never enter `service_fit`): candidate UI page or
display position; a previous selector ranking; another package's score; LLM
output; quick- vs interactive-mode; run identifier or random seed; proposal screen
state; motion/capability/readiness eligibility; and the additional-simulator
features this package disables (§5.6).

The trigger **purpose** is supplied, not inferred — the algorithm must not
reconstruct it from drowsiness, route tags, passenger state, or a scenario name:

| Trigger purpose | Meaning |
|---|---|
| `rest_recommended` ① | A rest-support journey is active |
| `inattentive_driving_prevention_recovery` ② | Driving content should prevent inattentive driving / support recovery |
| `route_music` ③ | Route- or destination-relevant content is being proposed |
| `child_passenger_experience` ④ | Child-compatible shared content is being proposed |

The **lifecycle stage** selects the applicable service family (it is not a scoring
feature). Per the versioned Slides 64–65 constraint matrix:

| Purpose | Lifecycle stage | Default candidate family |
|---|---|---|
| `rest_recommended` | `before_rest_until_stop` | the six **driving** services |
| `rest_recommended` | `during_rest_stopped` | the five **during-rest** actions |
| `rest_recommended` | `after_rest_before_restart` | the five **post-rest** services |
| ②/③/④ | `active_driving_content` | the six **driving** services |

Per Slides 38 and 40 the stopped 合いの手練習 (call-and-response) **is** a post-rest
candidate (`call_response_stopped`, §5.2.4). The Slide 64 flow diagram omits it, but
this design follows the service-definition slides and includes it — giving five
post-rest candidates.

---

# Part II — The scoring model

## 3. Core mathematical model

### 3.1 The symbol chain (one rule for every feature)

Every one of the 17 baseline features follows the **same** five steps. Only the way
`a_i` is produced differs (§4), and §5 gives the per-feature wiring.

| Step | Symbol | Serialized name | Meaning | Range |
|---|---|---|---|---|
| 1 | `x_i` | `raw_value` | world snapshot or candidate-map entry | field-specific |
| 2 | `e_i(c)` | `normalized_evidence` | how strongly the context calls for something | `[0,1]` or signed `[-1,+1]` |
| 3 | `a_i(c)` | `response_coefficient` | how well candidate `c` answers feature `i` (§4) | `[-1,+1]` |
| 4 | `r_i(c)` | `normalized_feature_response` | `clamp(e_i · a_i, -1, +1)` | `[-1,+1]` |
| 5 | `w_i` | `effective_weight` | this feature's normalized importance (§6) | `[0,1]`, `Σ = 1` |
| — | `k_i(c)` | `feature_contribution` | `w_i · r_i(c)` | `[-w_i,+w_i]` |
| — | `F(c)` | `service_fit` | `clamp( Σ_i k_i(c), -1, +1 )` — the score shown | `[-1,+1]` |

`service_fit` is a comparative hypothesis score — **not** a probability, acceptance
rate, or safety assurance. Situation / Preference / History subtotals are
explanatory views of the same contributions; they are never additional sort keys
and never counted twice.

### 3.2 Why every score stays in range (no hidden clamps)

- Each response coefficient satisfies `|a_i| ≤ 1` (by definition of the response
  scale, §4.1). With `e_i` bounded to `[-1,+1]`, `r_i ∈ [-1,+1]`.
- Weights are non-negative and sum to one, so `Σ k_i ∈ [-1,+1]`.

The `clamp` on `service_fit` therefore only guards floating-point drift; it must
never conceal an out-of-range intermediate value caused by invalid input or an
implementation error.

### 3.3 What "effective weight" means

A feature's weight is built in multiplicative steps, then normalized so the active
set sums to one:

```text
base_weight_i        = category_weight × subgroup_weight × leaf_weight            (§6.1)
raw_weight_i(p)      = base_weight_i × purpose_multiplier[p][subgroup(i)]         (§6.2)
w_i(p)               = raw_weight_i(p) / Σ_j raw_weight_j(p)
```

- `base_weight` — the feature's share of the whole tree.
- `purpose_multiplier` — a per-trigger-purpose nudge on a whole subgroup.
- the final divide is the only reason the numbers look uneven — it just rescales
  the surviving features so they sum to one.

Lifecycle stage does **not** select another weight set: stage already controls the
candidate family, and a candidate's response profile is a stable property of its ID
(§4.3).

### 3.4 Numeric rules

IEEE-754 binary64; reject NaN/±inf and non-numeric configurable values; fixed
17-feature contract order for evaluation and for summing siblings/contributions;
full-precision ranking, rounding only for display; `−0` serialized as `+0`; exact
`service_fit` ties broken by ascending `candidate_id`; canonical export sorts keys
lexicographically; cross-runtime tolerance `1e-12`. Canonical byte equality is
required only when replaying through the same package/runtime and exporter.

---

## 4. Candidate response coefficients — how the response is set

### 4.1 The response scale (real values, not codes)

The response coefficient answers one question:

> When this evidence is present, does this candidate service respond
> appropriately, remain neutral, or conflict with it?

It is **not** learned from driver data. Default coefficients are drawn from a
coarse five-value anchor set — but the parameter record and every table below store
the **number directly**, never a class code:

| Anchor | Coefficient | Meaning |
|---|---:|---|
| strongly opposes | **−1.0** | material mismatch among otherwise eligible candidates |
| opposes | **−0.5** | relative mismatch |
| neutral | **0.0** | no justified influence — the default when the source is silent |
| supports | **+0.5** | useful response |
| strongly supports | **+1.0** | explicitly preferred or strongly capable |

Neutral `0.0` is the default when the source does not justify a direction. "Not
listed as preferred" must **not** become negative. Customers may enter any
continuous value in `[-1,+1]`; the UI labels it a configured hypothesis (§12).

### 4.2 Provenance — every coefficient carries its source

Each response cell stores one provenance label so a reviewer can see whether a
number is sourced or assumed:

| Label | Meaning |
|---|---|
| `cdc_su_explicit` | Directly stated by Slide 67 |
| `service_definition` | Derived from the Slide 38–40 service behavior |
| `normalized_context_hypothesis` | Required for normalized simulator values (e.g. mountain road) |
| `rest_action_hypothesis` | Expert default — Slide 67 gives no during-rest action matrix |
| `post_rest_hypothesis` | Expert default beyond Slide 67's purpose-① row |
| `cdc_su_direct_candidate_feature` | Direct `+1.0` history/usage feature (Slides 66–67) |
| `neutral_source_silent` | Kept neutral because no direction is justified |

Customer edits retain the original provenance and add `customer_override` with the
changed value.

### 4.3 How a coefficient is chosen — the three derivation rules

1. **One profile per candidate ID.** A service's response to a feature is a stable
   property of that service. It does **not** change with purpose or stage — purpose
   changes only *weights* (via multipliers, §6.2), and stage only selects which
   family is eligible. This is why the before-rest ① and active-driving ②–④ driving
   services share **one** matrix (§5.2) instead of two.
2. **Direction from Slide 67, magnitude from strength of source.** A service Slide 67
   explicitly names as preferred for a feature gets `+1.0`; a service that is
   plausibly capable but unnamed gets a mild `+0.5`; an unnamed/irrelevant service
   gets `0.0`. Only normalized-context safety reasoning (mountain road) introduces
   negatives.
3. **Silence is neutral, not negative.** Where Slide 67 lists no preferred service
   for a feature (e.g. the purpose-① driver/environment column is `ー`), the
   coefficient is `0.0` with `neutral_source_silent`, unless a labeled hypothesis
   justifies otherwise.

---

## 5. Feature compatibility — the complete wiring

This is the heart of the algorithm: for **every** baseline feature, what world
input it reads, how that becomes evidence, and which candidate response applies.

### 5.1 Evidence and response, one rule

```text
r_i(c) = clamp( e_i(c) · a_i(c), -1, +1 )
```

Direction lives in the coefficient sign × the evidence sign. Two evidence shapes
exist, both subsets of the normalized scoring domain:

- **one-directional** `e ∈ [0,1]` — `0` means *no active evidence* (absence), not
  evidence against the service. Used by drowsiness, fatigue, monotony, traffic,
  night, route, destination, child, group, oshi-registered, recency.
- **two-directional** `e ∈ [-1,+1]` — `0` is neutral, `±1` are opposed poles. Used
  by oshi-mode, overall/scene usage, acceptance, recovery.

For categorical **road type**, the category directly selects a signed response with
`e_road = 1`, so `r_road(c) = a_road(c)` (no intensity multiplier).

### 5.2 The candidate response matrices (real coefficients)

Three matrices, one per lifecycle family. Every cell is the **numeric coefficient**
`a_i(c)`; the reason column explains the row. Environment features reset by the
stopped snapshot (§8) are marked `—` (evidence is 0 there regardless).

**5.2.1 Driving services** — `before_rest_until_stop` ① and `active_driving_content` ②③④.

| Candidate | Drowsy | Fatigue | Congested | Night | Monotony | Route | Dest | Child | Group | Oshi-reg | Oshi-mode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `music_playlist` | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | **+1.0** | **+1.0** | 0.0 | 0.0 | +0.5 | +0.5 |
| `humming_karaoke` | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | +0.5 | +0.5 |
| `call_response_driving` | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | 0.0 | 0.0 | **+1.0** | **+1.0** | +0.5 | +0.5 |
| `quiz` | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | 0.0 | 0.0 | **+1.0** | **+1.0** | +0.5 | +0.5 |
| `ranking_creation` | **+1.0** | **+1.0** | **+1.0** | **+1.0** | **+1.0** | 0.0 | 0.0 | **+1.0** | **+1.0** | +0.5 | +0.5 |
| `radio_style` | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | **+1.0** | **+1.0** |

Reasons and provenance:
- **Drowsy/fatigue/congested/night/monotony → humming, call-response, quiz, ranking = `+1.0`** (`cdc_su_explicit`): Slide 67's driver-state + driving-environment rows name exactly these four as the ②–④ preferred content ("漫然運転リスク… 覚醒・眠気抑制"). `music_playlist` and `radio_style` are **not** named → `0.0`.
- **Route/destination → `music_playlist`, `humming_karaoke` = `+1.0`** (`cdc_su_explicit`): Slide 67's route row names 音楽レコメンド + 鼻歌カラオケ. The interaction games (call-response/quiz/ranking) are not named → `0.0`.
- **Child/group → humming, call-response, quiz, ranking = `+1.0`** (`cdc_su_explicit`): Slide 67 passenger row (②–④). `music_playlist` = `0.0` (not named).
- **Oshi → the five non-radio driving services = `+0.5`, `radio_style` = `+1.0`** (`cdc_su_explicit` direction; magnitude from the service definitions): Slide 67 ②–④ oshi → "推しモードコンテンツ". Slide 39 defines `radio_style` as *the* oshi service — it replays summarized latest oshi information — so it responds **strongly** `+1.0`; the other five services can host an oshi-aware recipe under oshi mode but are not oshi-defined, so their magnitude is mild `+0.5`. Because oshi-mode evidence is signed, mode-`off` becomes a matching penalty (e.g. `−1.0` for radio, `−0.5` for the others).
- **`radio_style` = `0.0` on every non-oshi feature** (`neutral_source_silent`): Slide 67 names radio in none of the driver-state, environment, route, or passenger rows. Radio's oshi availability is *additionally* gated by **eligibility** (Slide 39: radio appears only when new oshi information exists since last use) — that gate is complementary to, not a substitute for, its oshi ranking response above.

**Why the four activation services share `+1.0` on drowsiness / fatigue /
environment.** Slide 67 places 眠気 (drowsiness) and 疲労度 (fatigue) in a *single*
row and names 鼻歌カラオケ, 合いの手, クイズ, ランキング together for the combined goal
("身体的活動による覚醒 or 知的負荷による眠気抑制"), with no ranking among them and no
drowsy-vs-fatigue split. At the *service* level they are therefore equally preferred,
and a uniform coefficient is the source-faithful choice — inventing per-service or
per-signal differences would be an unsourced hypothesis. The four are **not** left
indistinguishable overall: they already separate on route/destination (only
`music_playlist`/`humming_karaoke`), on mountain road (interaction load, §5.2.2), and
on the per-candidate preference/history features. The finer distinction — energize a
drowsy driver, soothe a fatigued one — belongs to the **content** selector, where it
is expressed as the arousal/valence *song* response (drowsiness `+0.80·A_s`, fatigue
`−0.50·A_s`), not as a service choice.

Before-rest ① uses this same matrix (rule §4.3.1). Slide 67's purpose-① driver/
environment column is `ー`; keeping the driving responses reflects the Slide 38
intent to "support arousal/recovery until the driver reaches a rest stop," and the
purpose-① multipliers (§6.2) already de-emphasize environment relative to ②.

**5.2.2 Road type** (a categorical sub-response of driving environment):

| Candidate | Highway | Local | Mountain | Parking |
|---|---:|---:|---:|---:|
| `music_playlist` | 0.0 | 0.0 | +0.5 | 0.0 |
| `humming_karaoke` | **+1.0** | 0.0 | −0.5 | 0.0 |
| `call_response_driving` | **+1.0** | 0.0 | −0.5 | 0.0 |
| `quiz` | **+1.0** | 0.0 | **−1.0** | 0.0 |
| `ranking_creation` | **+1.0** | 0.0 | **−1.0** | 0.0 |
| `radio_style` | 0.0 | 0.0 | +0.5 | 0.0 |

- **Highway `+1.0`** for the four activation services (`cdc_su_explicit`, Slide 67 lists 高速道路 in the environment row). `music_playlist`/`radio_style` = `0.0`.
- **Mountain** (`normalized_context_hypothesis`): a demanding road, so interactive cognitive load is reduced — low-interaction audio (`music_playlist`, `radio_style`) mildly supported `+0.5`; moderate-interaction (`humming`, `call-response`) `−0.5`; high-interaction (`quiz`, `ranking`) `−1.0`. These are safety hypotheses, not explicit CDC-SU judgments, and never remove an eligible service — they only reorder it.
- **Local** neutral (source does not distinguish it). **Parking** neutral — driving/stopped permissibility belongs to eligibility.

**5.2.3 During-rest actions** — `during_rest_stopped`. Slide 67 gives no
during-rest action matrix, so every non-zero cell is `rest_action_hypothesis`.
Traffic, road, and monotony are reset by the stopped snapshot (`—`); route,
destination, and oshi are `0.0`.

| Candidate | Drowsy | Fatigue | Night | Child | Group |
|---|---:|---:|---:|---:|---:|
| `rest_duration_suggestion` | +0.5 | +0.5 | +0.5 | +0.5 | +0.5 |
| `rest_method_suggestion` | +0.5 | **+1.0** | +0.5 | **+1.0** | +0.5 |
| `seat_adjustment` | 0.0 | +0.5 | 0.0 | +0.5 | +0.5 |
| `nap_guidance` | **+1.0** | **+1.0** | **+1.0** | 0.0 | 0.0 |
| `rest_extension_check` | **+1.0** | **+1.0** | **+1.0** | 0.0 | 0.0 |

Night stays current and raises nap/rest suitability. `rest_extension_check` must
not be offered until the journey engine says it is applicable — that is eligibility,
not service fit.

**5.2.4 Post-rest services** — `after_rest_before_restart`. Environment is reset
(`—`); night `0.0`. Slide 67's purpose-① column supplies the passenger, oshi, and
route rows.

Five candidates (Slides 38, 40) — including the stopped `call_response_stopped`
(合いの手練習, video), which the Slide 64 flow omits but the service-definition slides
list (§2.4).

| Candidate | Drowsy | Fatigue | Route | Dest | Child | Group | Oshi-reg | Oshi-mode |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `live_viewing` | +0.5 | +0.5 | 0.0 | 0.0 | **+1.0** | **+1.0** | **+1.0** | **+1.0** |
| `stretch_video` | **+1.0** | **+1.0** | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| `full_karaoke` | +0.5 | +0.5 | 0.0 | 0.0 | **+1.0** | **+1.0** | **+1.0** | **+1.0** |
| `call_response_stopped` | +0.5 | +0.5 | 0.0 | 0.0 | +0.5 | +0.5 | 0.0 | 0.0 |
| `oshi_reexperience` | +0.5 | +0.5 | **+1.0** | **+1.0** | 0.0 | 0.0 | **+1.0** | **+1.0** |

- **Child/group → `live_viewing`, `full_karaoke` = `+1.0`** (`cdc_su_explicit`, Slide 67 ① passenger → ライブビューイング, カラオケ). `stretch_video`, `oshi_reexperience` = `0.0`.
- **Oshi → `live_viewing`, `full_karaoke`, `oshi_reexperience` = `+1.0`** (`cdc_su_explicit`, Slide 67 ① oshi row → ライブビューイング, カラオケ, 推し追体験). `stretch_video = 0.0` (Slide 40 defines no oshi content and Slide 67 ① oshi row omits it).
- **Route/destination → `oshi_reexperience` = `+1.0`** (`cdc_su_explicit`, Slide 67 ① route → 推し追体験). All other post-rest services `0.0` (Slide 67 ① route names only 推し追体験).
- **`call_response_stopped` child/group `+0.5`, drowsy/fatigue `+0.5`** (`post_rest_hypothesis`): Slide 67 ① names 合いの手 in none of its columns, but Slide 40 defines it as a participatory 合いの手 video with lighting cues — a shared, group-friendly recovery activity — so it carries a mild shared-activity + engagement response. Its route/destination and oshi responses stay `0.0` (unnamed in Slide 67 ①), which is what distinguishes it from `full_karaoke`.
- **Drowsy/fatigue** (`post_rest_hypothesis`, Slide 67 ① driver = `ー`): `stretch_video` `+1.0` (physical recovery); the rest mild `+0.5` (light engagement while recovering).

### 5.3 Complete baseline-feature contract

The 17 CDC-SU baseline service features, in contract order. For each: the world
input → evidence, and where the response coefficient comes from. All 17 are
scored; features that are *evaluated elsewhere or excluded* are listed separately
in §5.6.

**Situation**

| # | Feature | World input `x_i` → evidence `e_i` | Response `a_i(c)` | Source |
|---|---|---|---|---|
| 1 | Drowsiness level | `drowsiness_level [0,100]` → `(x/100)^γ` ∈ `[0,1]` | §5.2 matrix column | Slide 67 driver row |
| 2 | Fatigue level | `fatigue_level [0,100]` → `(x/100)^γ` ∈ `[0,1]` | §5.2 matrix | Slide 67 driver row |
| 3 | Traffic state | `normal→0`, `congested→1` | §5.2 matrix (Congested) | Slide 67 env row |
| 4 | Road type | categorical, `e=1` | §5.2.2 road matrix | Slide 67 env + normalized hypothesis |
| 5 | Day/night state | `day→0`, `night→1` | §5.2 matrix (Night) | Slide 67 env row |
| 6 | Road monotony | `monotony_level [0,100]` → `(x/100)^γ` | §5.2 matrix | Slide 67 env row |
| 7 | Route characteristics | `min(1, recognized_route_tags / saturation)` | §5.2 matrix (Route) | Slide 67 route row |
| 8 | Destination characteristics | `min(1, recognized_dest_tags / saturation)` | §5.2 matrix (Dest) | Slide 67 route row |
| 9 | Child present | `false→0`, `true→1` | §5.2 matrix (Child) | Slide 67 passenger row |
| 10 | Multiple passengers | `false→0`, `true→1` | §5.2 matrix (Group) | Slide 67 passenger row |

**Preference**

| # | Feature | World input → evidence | Response `a_i(c)` | Source |
|---|---|---|---|---|
| 11 | Oshi registered | `false→0`, `true→1` | §5.2 matrix (Oshi-reg) | Slide 67 oshi row |
| 12 | Oshi mode | `off→ −1`, `on→ +1` | §5.2 matrix (Oshi-mode) | Slide 67 oshi row |
| 13 | Service recency | `service_recency_state[c]`: `recent→0 / long_unused→.5 / never→1` | **`+1.0`** direct (§5.4) | Slide 66 未使用機能 |
| 14 | Overall service usage | `service_usage_level[c]`: `never −1 / low −.5 / medium +.25 / high +1` | **`+1.0`** direct | Slide 66 利用頻度 |
| 15 | Scene-specific service usage | mean of usage-normalized values over current scene IDs (§5.7) | **`+1.0`** direct | Slide 66 場面別好み |

**History**

| # | Feature | World input → evidence | Response `a_i(c)` | Source |
|---|---|---|---|---|
| 16 | Service-proposal acceptance rate | `acceptance_rate[c] [0,100]` → `2·rate/100 − 1` | **`+1.0`** direct | Slide 67 受諾率 row |
| 17 | Service recovery rate | `recovery_rate[c] [0,100]` → `2·rate/100 − 1` | **`+1.0`** direct | Slide 67 回復率 row |

### 5.4 Direct candidate-specific features

Features 13–17 read a **candidate-indexed** raw value whose sign already carries
the direction of evidence, so the response coefficient is fixed to **`+1.0`** for
every candidate (`cdc_su_direct_candidate_feature`, Slides 66–67). Recency is
one-directional (`+1.0` maps novelty to a bonus; recent use is neutral, never a
penalty), so novelty stays a weak influence. Usage, acceptance, and recovery are
two-directional. Because baseline-only mode has **no** confidence/sample-count
feature, sparse rates cannot be shrunk — the inputs are described as synthetic
configured rates, not reliable empirical estimates or clinical claims.

### 5.5 Why the content slides (68–73) are not used here

Slides 68–73 — including Slide 70 (具体コンテンツ選択材料対象) — define the **content**
selector's inputs: which features drive concrete mode/genre/item selection *within*
an already-chosen service. They are a different decision layer and play **no** role
in service ranking. Every response coefficient in §5.2 is derived from **Slide 67
alone**, with the service definitions in Slides 38–40 supplying magnitude. This
separation matters because the two layers genuinely diverge — at the content level
`humming_karaoke` does not consult route to pick songs, yet at the service level
Slide 67 lists humming as route-preferred — so borrowing a content-level ○/× into
service scoring would contradict Slide 67. The excluded content-level feature set is
enumerated in §5.6.

### 5.6 Features not used by the service selector

The "reason of not use" for everything the selector deliberately ignores. Two
groups: **content-level** features (they appear in Slides 68–70 but belong to the
*content* selector, not service ranking) and **additional-simulator** features
(disabled by the baseline package).

| Feature | Group | Reason not scored here |
|---|---|---|
| Driving/stopped state (走行状態) | content-level | Appears only in the content inputs (Slides 69–70), not the Slide 66 service-input set; at service level motion is a **platform eligibility** fact (screen-restricted services excluded before scoring), not a ranking feature |
| UPro info — age band / gender / hobbies | content-level | Introduced by Slide 68 for **content** genre/mode selection; not in the Slide 66 service-input set |
| Playback & operation history (skip / cancel) | content-level | Slide 69 content-input; used to exclude concrete items, not to rank services |
| Schedule (推しイベント等) | content-level | Slide 68/69 content-input; timing alone establishes no service-level affinity |
| Content-tag novelty / per-item recency | content-level | Item-granularity; the service-level "unused function" is captured by Service recency (#13) |
| Minutes until a rest spot | additional-simulator | Journey-engine timing; not a Slide 66/67 baseline feature |
| Currently active service | additional-simulator | Not a baseline feature; would leak run state into ranking |
| Recent rejection / confidence | additional-simulator | No baseline confidence feature exists (§5.4) |

None of these may enter `service_fit`. Excluded content-level features are the
content selector's responsibility; additional-simulator features are out of scope
for baseline-only V1.

### 5.7 Per-feature evidence normalization detail

- **Drowsiness / fatigue / monotony** — `e = (level/100)^γ`, `γ` initial `1.0`,
  recommended `0.50–3.00`, validation `0.25–4.00`. `γ<1` makes moderate values
  influential sooner; `γ>1` reserves influence for high values. Raw `0` is a valid
  low value, not missing.
- **Route / destination tags** — `e = min(1, recognized_unique_tags / saturation)`,
  `saturation` initial `2` (validation `1–10`). Unknown tags are ignored in the
  count and reported (§8). An empty or wholly unknown set is neutral.
- **Oshi mode** — `off→ −1`, `on→ +1`. Unlike absent registration (neutral), an
  explicit `off` **opposes** oshi-focused adaptation. `oshi_registered=false ∧
  oshi_mode=on` is invalid input.
- **Overall / scene usage** — ordinal map `never −1 / low −.5 / medium +.25 /
  high +1`. Scene IDs are derived from baseline situation features via the versioned
  `scene_taxonomy`: `traffic:congested`; `road:{highway,local,mountain,parking}`;
  `time:night`; `monotony:medium` (34–66) / `monotony:high` (67–100);
  `passenger:{child,group}`; one `route:<tag>` / `destination:<tag>` per recognized
  tag. Scene evidence is the mean of usage-normalized values over matching scenes
  with a candidate record; no matching record → evidence `0`, reported unavailable.
- **Acceptance / recovery** — `e = 2·rate/100 − 1` (so `0→−1`, `50→0`, `100→+1`).

---

## 6. Hierarchical weights

### 6.1 Categories, subgroups, leaves

| Category (share) | Subgroup (share) | Leaves (sibling share) |
|---|---|---|
| **Situation 0.80** | Driver state 0.50 | drowsiness 0.55, fatigue 0.45 |
| | Driving environment 0.35 | traffic 0.20, road 0.20, night 0.20, monotony 0.40 |
| | Route context 0.075 | route 0.55, destination 0.45 |
| | Passenger composition 0.075 | child 0.65, multiple 0.35 |
| **Preference 0.12** | Oshi preference 0.25 | oshi-registered 0.35, oshi-mode 0.65 |
| | Novelty 0.10 | service recency 1.00 |
| | Overall usage 0.25 | overall usage 1.00 |
| | Scene preference 0.40 | scene usage 1.00 |
| **History 0.08** | Proposal acceptance 0.25 | acceptance rate 1.00 |
| | Recovery 0.75 | recovery rate 1.00 |

Situation dominates because current driver/road context is the safety-relevant
signal; Preference personalizes without dominating; History is useful but
synthetic and unvalidated, with recovery emphasized over acceptance. Top-level and
sibling values are **ratios** — customers may enter any non-negative numbers; the
evaluator normalizes siblings, so they need not sum to one (a sibling group of all
zeros is invalid).

**Flattened base weights** (before purpose multipliers; sum to 1):

| Feature | Base weight | Feature | Base weight |
|---|---:|---|---:|
| Drowsiness | 0.220000 | Oshi registered | 0.010500 |
| Fatigue | 0.180000 | Oshi mode | 0.019500 |
| Traffic | 0.056000 | Service recency | 0.012000 |
| Road type | 0.056000 | Overall usage | 0.030000 |
| Night | 0.056000 | Scene usage | 0.048000 |
| Monotony | 0.112000 | Proposal acceptance | 0.020000 |
| Route tags | 0.033000 | Recovery | 0.060000 |
| Destination tags | 0.027000 | | |
| Child present | 0.039000 | | |
| Multiple passengers | 0.021000 | | |

### 6.2 Purpose multipliers (applied per subgroup before normalization)

The same six driving candidates serve purposes ②–④; a single global profile would
make route and child purposes indistinguishable from inattentive-driving
prevention. A small subgroup-level multiplier table keeps one understandable
hierarchy instead of duplicating all 17 weights per purpose.

| Subgroup | Rest ① | Inattentive ② | Route ③ | Child ④ |
|---|---:|---:|---:|---:|
| Driver state | 1.40 | 1.50 | 1.20 | 1.20 |
| Driving environment | 1.10 | 1.40 | 1.00 | 1.00 |
| Route context | 1.00 | 0.75 | 2.00 | 0.75 |
| Passenger composition | 1.00 | 0.85 | 0.80 | 2.00 |
| Oshi preference | 1.00 | 0.80 | 1.10 | 0.75 |
| Novelty | 0.80 | 0.80 | 0.80 | 0.80 |
| Overall usage | 0.90 | 0.90 | 0.90 | 1.00 |
| Scene preference | 1.00 | 1.10 | 1.10 | 1.20 |
| Proposal acceptance | 1.00 | 1.00 | 1.00 | 1.00 |
| Recovery | 1.30 | 1.25 | 1.00 | 1.00 |

`1` leaves importance unchanged; `>1` emphasizes; `<1` de-emphasizes; `0` disables
ranking influence but not the evidence trace. **Resulting normalized weights** (the
implementation computes these — they are not independently editable):

| Feature | Rest ① | Inattentive ② | Route ③ | Child ④ |
|---|---:|---:|---:|---:|
| Drowsiness | .256538 | .254551 | .233546 | .234729 |
| Fatigue | .209895 | .208269 | .191083 | .192051 |
| Traffic | .051308 | .060475 | .049540 | .049791 |
| Road type | .051308 | .060475 | .049540 | .049791 |
| Night | .051308 | .060475 | .049540 | .049791 |
| Monotony | .102615 | .120950 | .099080 | .099582 |
| Route tags | .027486 | .019091 | .058386 | .022006 |
| Destination tags | .022489 | .015620 | .047771 | .018005 |
| Child present | .032484 | .025571 | .027601 | .069352 |
| Multiple passengers | .017491 | .013769 | .014862 | .037343 |
| Oshi registered | .008746 | .006479 | .010218 | .007002 |
| Oshi mode | .016242 | .012033 | .018976 | .013003 |
| Service recency | .007996 | .007405 | .008493 | .008536 |
| Overall usage | .022489 | .020827 | .023885 | .026674 |
| Scene usage | .039980 | .040728 | .046709 | .051214 |
| Proposal acceptance | .016658 | .015427 | .017693 | .017783 |
| Recovery | .064968 | .057853 | .053079 | .053348 |

### 6.3 Normalization

After `base × purpose`, divide every leaf by the sum of all leaves so `Σ w_i = 1`.
A zero or non-finite denominator is invalid.

### 6.4 Continuous default dominance invariant

This design uses no ranking bands or minimum-fit threshold, but the default
configuration must still prove that a material high-priority advantage cannot be
overturned by all lower-priority evidence. Define the safety-response set and its complement:

```text
D = Driver State + Driving Environment + Recovery ;   L = every remaining feature
W_D = Σ_{i∈D} w_i ;   W_L = 1 − W_D
P(c) = Σ_{i∈D} w_i·r_i(c) / W_D          Q(c) = Σ_{i∈L} w_i·r_i(c) / W_L      (both in [-1,+1])

service_fit(A) − service_fit(B) = W_D·(P(A)−P(B)) + W_L·(Q(A)−Q(B))
```

The worst lower-priority reversal is `Q(A)−Q(B) = −2`. With the package's
`material_safety_gap = 1.00`, a non-reversal guarantee holds when
`W_D · 1.00 > 2 · W_L`:

| Purpose | W_D | W_L | Required gap `2·W_L/W_D` | Default 1.00 passes |
|---|---:|---:|---:|---|
| Rest ① | .787939 | .212061 | .538266 | yes |
| Inattentive ② | .823048 | .176952 | .429991 | yes |
| Route ③ | .725407 | .274593 | .757073 | yes |
| Child ④ | .729083 | .270917 | .743171 | yes |

The guarantee is continuous — it alters no score and creates no ordering threshold.
It says only that when A's normalized driver-state-plus-environment-plus-recovery
response exceeds B's by at least `1.00`, even the most adverse remaining evidence
cannot rank B above A. `1.00` is an explicit expert definition of "material," not an
empirical boundary. After every customer edit the resolver recomputes it and
records `default_dominance_preserved` or `dominance_not_guaranteed` (with the
required gap) — it never silently alters weights or ranks. Built-in profiles must
pass; a release cannot ship a failing built-in profile without an explicit
versioned decision.

A separate **non-blocking configuration warning** fires when the combined effective
share of Driver State + Driving Environment + Recovery falls below
`safety_share_warning_floor = 0.40`. With initial profiles that share is `.788` ①,
`.823` ②, `.725` ③, `.729` ④. The warning is a reviewer signal, not a penalty.

---

# Part III — Eligibility and data handling

## 7. Hard eligibility

Eligibility runs **before** scoring and cannot be reversed by any score or weight.
The platform/orchestrator constructs:

```text
candidates = catalog services
           ∩ purpose/stage allowed services (Slides 64–65 matrix)
           ∩ motion / capability / readiness eligibility
```

Examples of hard exclusion: screen-dependent full karaoke while driving; a
stopped-only stretch video while driving; an oshi-specific action (e.g.
`radio_style`, `oshi_reexperience`) without its required catalog entity; disabled or
unavailable content; `rest_extension_check` before the journey engine says it is
applicable. Motion is **not** a ranking feature — it is a platform eligibility fact,
because the baseline package is restricted to ranking features. Excluded services
receive no `service_fit` and are reported with platform reason codes; the algorithm
may not reinstate them.

## 8. Missing, unknown, and invalid data

- **Missing** (absent scalar field or candidate-map entry) → `e=0`, `r=0`,
  `k=0`, weight retained, status `missing_neutral`. Absence never redistributes
  weight and never invents positive or negative evidence.
- **Present raw `0`** on a `[0,100]` feature is a valid low value, not missing.
- **Unknown tag** (syntactically valid, not in the taxonomy) → does not contribute
  to recognized-tag count; reported in `unused_available_features`.
- **Stopped snapshot** — every lifecycle transition creates a fresh snapshot:
  before-rest/active use current driving values; `during_rest_stopped` sets traffic
  `normal`, road `parking`, monotony `0` (drowsiness/fatigue/day-night stay
  current); `after_rest_before_restart` uses explicit post-rest drowsiness/fatigue
  with the same stopped environment. Route/destination and passenger composition
  remain current trip facts. The selector must not implicitly retain pre-stop
  congestion, road, or monotony.
- **Invalid** (wrong type, out-of-range number, unsupported enum, contradictory
  oshi state, non-finite configurable, all-zero sibling group, zero active-weight
  denominator) → **blocks** the evaluation with a typed error; never silently
  coerced to neutral.

---

# Part IV — Producing the ranking

## 9. Evaluation pipeline

1. **Validate the opportunity** — contract/package versions; purpose; compatible
   lifecycle stage; feature types/ranges; oshi consistency; hierarchy/multiplier
   values; response-profile completeness for every eligible candidate. Any failure
   is a blocking error, never a fabricated ranking.
2. **Confirm candidate constraints** — every platform-eligible candidate belongs to
   the frozen allowed-service row; copy platform exclusions through unchanged.
3. **Resolve effective weights once** — normalize siblings, multiply down the
   hierarchy to 17 base weights, apply purpose multipliers, renormalize; record
   base, multiplier, raw, and final values (§6).
4. **Build evidence** — normalize scalar/contextual features once; normalize
   candidate-indexed features inside the candidate loop.
5. **Score each eligible candidate** — for every feature `r_i = clamp(e_i·a_i)`
   (road type uses `e=1`, `r=a_road`); `k_i = w_i·r_i`;
   `service_fit = clamp(Σ k_i, -1, +1)`; assert the unclamped sum is in range within
   tolerance.
6. **Build subtotals** — `situation_fit`, `preference_fit`, `history_fit` reconstruct
   the unclamped sum; explanatory only, never rescaled, never a sort key.
7. **Rank** — sort by `(service_fit desc, candidate_id asc)` at full precision;
   return the first three (or all if fewer).
8. **No-proposal** — return `no_proposal` only when the eligible list is empty. A low
   or negative `service_fit` never suppresses a proposal — the upstream trigger
   already established the opportunity.

## 10. Worked example

**Opportunity** `inattentive_driving_prevention_recovery` / `active_driving_content`;
candidate `humming_karaoke`. **Snapshot** drowsiness 80, fatigue 60, congested,
highway, night, monotony 75, two recognized route tags, one destination tag, child
present, multiple passengers, oshi registered + mode on, service recency
long_unused, overall usage high, scene usage high, acceptance 75, recovery 70.

Using the inattentive② effective weights (§6.2) and the `humming_karaoke` responses
(§5.2, all activation `+1.0`, oshi `+0.5`, direct features `+1.0`):

| Feature | `e` | `a` | `r` | `w` | `k = w·r` |
|---|---:|---:|---:|---:|---:|
| Drowsiness | .80 | +1.0 | .80 | .254551 | +.203641 |
| Fatigue | .60 | +1.0 | .60 | .208269 | +.124961 |
| Traffic (congested) | 1.00 | +1.0 | 1.00 | .060475 | +.060475 |
| Road (highway) | 1.00 | +1.0 | 1.00 | .060475 | +.060475 |
| Night | 1.00 | +1.0 | 1.00 | .060475 | +.060475 |
| Monotony | .75 | +1.0 | .75 | .120950 | +.090713 |
| Route | 1.00 | +1.0 | 1.00 | .019091 | +.019091 |
| Destination | .50 | +1.0 | .50 | .015620 | +.007810 |
| Child | 1.00 | +1.0 | 1.00 | .025571 | +.025571 |
| Group | 1.00 | +1.0 | 1.00 | .013769 | +.013769 |
| Oshi registered | 1.00 | +0.5 | .50 | .006479 | +.003240 |
| Oshi mode | +1.00 | +0.5 | .50 | .012033 | +.006017 |
| Service recency | .50 | +1.0 | .50 | .007405 | +.003703 |
| Overall usage | 1.00 | +1.0 | 1.00 | .020827 | +.020827 |
| Scene usage | 1.00 | +1.0 | 1.00 | .040728 | +.040728 |
| Acceptance | .50 | +1.0 | .50 | .015427 | +.007714 |
| Recovery | .40 | +1.0 | .40 | .057853 | +.023141 |
| **service_fit** | | | | | **+0.772349** |

`humming_karaoke` scores **≈ +0.772** (display `+0.772`). For `music_playlist` in the
same snapshot, the driver/environment activation responses are all `0.0`, so it
gains only route/destination (`+.019091`, `+.007810`), the mild oshi responses, and
the direct usage/history contributions — totalling **≈ +0.132**. Humming therefore
ranks well above playlist here. Switch the purpose to `route_music` and the
route/destination weights rise via the multiplier profile, narrowing the gap on the
same raw snapshot and response profiles — a different, fully explained order.

## 11. Contrast behavior

Each contrast freezes catalog, purpose, config, and seed and changes one field,
asserting the expected reorder:

1–6. low↔high **drowsiness / fatigue / monotony**, and **normal↔congested /
highway↔mountain / day↔night** — activation vs calm order shifts among driving
services. 7. child absent↔present. 8. oshi mode off↔on — oshi-responsive candidates
move. 9. recent↔long-unused service recency. 10. low↔high overall usage.
11. low↔high recovery rate. 12. `route_music` vs `inattentive` purpose on the same
snapshot — route/destination weight shift reorders music vs humming. 13. mountain
vs highway — interaction-heavy services (quiz/ranking) drop on mountain.

Every eligible candidate is always ranked (never suppressed by a low score); a hard
exclusion is never reinstated.

---

# Part V — Engineering contract

## 12. Parameters and hyperparameters

A **parameter** defines model structure/mappings/semantics (versioned with the
package); a **hyperparameter** is a customer-editable scalar that tunes the
hypothesis without code. Both are evidence-visible; changing either creates a new
decision configuration.

**Structural parameters:** `service_response_profiles` (§5.2), `road_response_profiles`
(§5.2.2), `response_anchor_map` (`-1,-.5,0,.5,1`), `usage_ordinal_map`
(`-1,-.5,.25,1`), `recency_ordinal_map` (`0,.5,1`), `scene_taxonomy` (§5.7),
`missing_policy` (`neutral_and_disclose`), `top_k` (3), `tie_breaker`
(`candidate_id` ascending), `material_safety_gap` (1.00).

**Numeric hyperparameters (frozen per run, in evidence):** all §6.1 hierarchy weights
(as ratios); §6.2 purpose multipliers (range `0–5`, recommended `0.5–3`, step `0.05`,
all-zero rejected); `γ_drowsiness` / `γ_fatigue` / `γ_monotony` (`1.0`, validation
`0.25–4.0`); `route_tag_saturation` / `destination_tag_saturation` (`2`, `1–10`);
`monotony_medium_min` (34) `< monotony_high_min` (67); `safety_share_warning_floor`
(0.40); and any continuous response-coefficient overrides (finite, in `[-1,+1]` —
out-of-range/NaN/inf are invalid, not clamped). Response classes should be edited in
an advanced matrix, separate from weights: a weight asks *"how important is this
evidence?"*, a response asks *"how does this service answer it?"*. Configuration is
validated **before** scoring; the resolved normalized values are recorded beside the
customer-entered ones.

## 13. Result and error categories

| Result | Meaning |
|---|---|
| `ranked_candidates` | up to three eligible services in `service_fit` order |
| `no_proposal` | the eligible candidate list is empty |
| `invalid_request` | purpose, stage, or purpose/stage pair invalid |
| `invalid_catalog` | a candidate outside the frozen allowed-service row |
| `invalid_configuration` | weights, multipliers, response profiles, or versions invalid |

Typed errors carry evidence and never trigger an undeclared fallback service or a
fabricated ranking.

## 14. Explainability contract

**Per candidate × feature row:** `feature_id`, `source_reference`, `raw_value`,
`normalization_function` + parameters, `normalized_evidence`, `response_class`/
coefficient, `response_provenance` (source / hypothesis / customer override),
`normalized_feature_response`, `hierarchy_path`, `base_weight`, `purpose_multiplier`,
`effective_weight`, `feature_contribution`, `status` (used / neutral / zero-weight /
missing / invalid).

**Per candidate:** `service_fit ∈ [-1,+1]`; Situation/Preference/History subtotals;
strongest supporting and opposing contributions; neutral and zero-weight features;
missing/unknown inputs; response provenance; configuration versions.

**Per ranking / adjacent pair:** `service_fit(A) − service_fit(B)` and the
feature-contribution differences responsible for the gap, so "why A above B?" is
answerable without reading the implementation.

**Reproducibility:** persist the immutable input snapshot, candidate/exclusion
lists, parameters + hyperparameters, resolved effective weights, response-profile
versions, full-precision contributions + `service_fit`, and the tie-break result.
Identical inputs + versions reproduce a semantically identical result (`1e-12`);
same-runtime canonical replay is byte-equivalent. The output extends the common
selector contract; structured evidence is authoritative and localized prose must
introduce no reason absent from the arithmetic. This deterministic stateless
selector always returns `uncertainty=null` and `next_package_runtime_state={}`.

## 15. Implementation components

`InputValidator` · `WeightResolver` (hierarchical normalization + purpose
multipliers) · `FeatureNormalizer` (all 17 evidence functions) · `SceneResolver`
(versioned scene IDs + aggregation) · `ResponseResolver` (candidate + road profiles)
· `CandidateScorer` (`k = w·r`, subtotals) · `Ranker` (full-precision order +
tie-break) · `EvidenceBuilder` (complete trace). The selector must not call the
content selector or consume another package's score. Keep validation, weight
resolution, normalization, response resolution, scoring, ranking, and evidence
independently testable.

## 16. Required tests

**Math:** effective weights sum to 1 for every default purpose; every `e`, `a`, `r`
in `[-1,+1]`; `k = w·r ∈ [-w,+w]`; unclamped `service_fit` = ordered sum of
contributions; all-neutral world → `0` for every candidate; §10 reproduces
`+0.772349` within tolerance; scaling all sibling weights by a constant changes
nothing; every built-in profile satisfies `W_D·1.00 > 2·W_L`; an adversarial pair
with dominant-gap `1.00` and maximally reversed lower-priority responses keeps the
higher-safety candidate first; an invariant-violating customer profile stays
evaluable but emits `dominance_not_guaranteed` + required gap.

**Features:** boundary `0`/`100` for drowsiness/fatigue/monotony; `γ` at validation
bounds; every enum/ordinal map; empty/duplicate/recognized/unknown route/destination
tags; every scene predicate + multi-scene mean; oshi invalid-state rejection; missing
candidate history → neutral disclosed; acceptance/recovery `0/50/100 → −1/0/+1`.

**Response matrix:** Slide-67-preferred driving services get `+1.0` activation;
route supports music + humming; passengers support the named shared services;
mountain road opposes high-interaction candidates; `radio_style` responds only to
oshi (strongly) and is neutral on every other feature; oshi mode off yields opposing
evidence for oshi-responsive candidates; direct
features always use `+1.0`; every eligible candidate × feature cell has a
coefficient, provenance label, source reference/null, and rationale; non-finite or
out-of-`[-1,+1]` coefficients are rejected.

**Eligibility / ranking:** no excluded candidate scored; no candidate outside the
purpose/stage row accepted; empty eligibility → `no_proposal`; low/negative fit
still ranked; screen restrictions stay outside scoring; rank uses full precision;
exact ties resolve by `candidate_id`; all 17 rows present per scored candidate;
subtotals reconcile to `service_fit` within tolerance; overrides + source
provenance both present.

**Hypothesis review:** algorithm tests establish conformance, not efficacy. Before a
built-in profile version is accepted, reviewers run a versioned scenario corpus
(rest before/during/after stop; inattentive per-factor; route no/one/saturated
tags; child/group combinations) with required ordering constraints — not invented
"correct probabilities" — expected dominant reasons, expected invariant status,
allowed fit tolerance, and product/UX/safety sign-offs. Any built-in rank change
updates a fixture only with written rationale; fit drift above `1e-12` with
unchanged package/runtime is a failure.

## 17. Acceptance criteria

1. Only the 17 baseline features influence ranking; purpose/stage/eligibility/
   catalog remain non-scoring controls.
2. Every eligible candidate gets one deterministic `service_fit ∈ [-1,+1]`, and every
   intermediate is reproducible from displayed arithmetic.
3. Every feature follows `r_i = clamp(e_i·a_i)`; response coefficients are shown as
   real numbers with a reason and provenance, not class codes.
4. One response profile per candidate ID; purpose changes only weights.
5. Default weights and coefficients follow the Slide-67 service-priority and
   safety-first intent; every built-in profile passes the §6.4 invariant.
6. Every response coefficient derives from Slide 67 (magnitude from Slides 38–40);
   the content slides 68–73 (including 70) play no role in service scoring.
7. Features not used are listed with an explicit reason (§5.6).
8. Bounds hold by construction: `|a_i| ≤ 1`, `Σ w_i = 1`.
9. Hard eligibility, motion, and screen policy are deterministic and cannot be
   reversed by score; no eligible candidate is suppressed for a low/negative fit.
10. Identical frozen inputs and versions reproduce the same ranking; output never
    describes `service_fit` as acceptance probability, recovery probability, or
    safety certification.

## 18. Cross-document impact

`radio_style` responds strongly to oshi (§5.2.1) **and** is additionally
eligibility-gated: the eligibility layer and world generator must expose a "new oshi
information available" flag (Slide 39) that gates whether radio appears as a
candidate at all, complementing — not replacing — its oshi ranking response. The
content/service boundary (§5.5–§5.6) fixes which features belong to the
[content-proposal algorithm](./aica_transparent_content_proposal_algorithm.md): it
owns UPro age/gender/hobbies, playback/operation history, schedule, and item-level
novelty (Slides 68–73), and its genre-pending (`🔧`) features cover the
route/destination/child/hobbies relations excluded here.

## 19. Deferred improvements

A probabilistic uncertainty-ranking package is deferred: a future independent
package may sample configured ranges around weights and response coefficients and
report an expected fit, a fit interval, and probability of ranking first — describing
rank stability under configured uncertainty, **not** user acceptance or recovery
probability. It must receive the same neutral baseline snapshot and must not consume
this deterministic package's score or runtime state. Also deferred: per-service oshi
member/group graphs and confidence-weighted sparse history.
