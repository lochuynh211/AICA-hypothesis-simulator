# AICA Transparent Content-Proposal Algorithm

Status: approved Spotify-only V1 design (two-axis song-trait model)
Scope: baseline-feature transparent selector for concrete music content
Last updated: 2026-07-15

---

## 1. Related documents

- [AICA proposal simulator specification](./aica_proposal_simulator_specification.md)
- [AICA synthetic Spotify-compatible music data and generation specification](./aica_synthetic_music_data_and_generation_specification.md)
- [AICA transparent service-proposal algorithm](./aica_transparent_service_proposal_algorithm.md)
- [Spotify Track reference](https://developer.spotify.com/documentation/web-api/reference/get-track)
- [Spotify Audio Features reference](https://developer.spotify.com/documentation/web-api/reference/get-audio-features)

---

# Part I — Overview

## 2. Overview

### 2.1 Purpose

After the **service selector** has chosen one detailed *music* service, this
algorithm chooses the concrete **songs** to place inside it. It returns one
ordered plan of five songs by default, each shown with its selection score.

The three detailed music services it serves are `music_playlist`,
`humming_karaoke`, and `full_karaoke`.

Every song is scored from **only** Spotify-compatible metadata (Track + Audio
Features) plus exact Track/Artist-ID history. No lyric, chorus, vocal-range,
audience, genre, route, or LLM-enriched metadata is used or invented.

### 2.2 Selected design in one paragraph

Every scored feature contributes the same way: an **evidence** value `e_i` (how
strongly the current world calls for something) times a **response coefficient**
`a_i` (how well *this song* answers it). The novelty is only in how `a_i` is
computed for the six driver/environment features: each song is reduced to two
audio **traits** — how *energetic* it is (**arousal**) and how *bright* it is
(**valence**) — and the feature's response is how well those traits match the
context's demand. All other features (oshi, age, playback history, acceptance,
recovery) compute `a_i` directly from exact-ID metadata, exactly as before.

Why two audio axes instead of one "activation" number? A single scalar can only
order songs from calm to energetic; it cannot tell *calm-but-bright* from
*calm-but-dark*. A fatigued or stressed driver wants **calm and reassuring**
music, while a drowsy driver on a monotonous road wants **energetic** music. One
axis collapses these; two axes separate them.

### 2.3 Relationship to the service selector

| Concern | Service selector | Content selector (this doc) |
|---|---|---|
| Decision | Which service to propose | Which songs to place in it |
| Candidate | A service | A Spotify-compatible Track |
| Response `a_i` | **Hand-authored** per service | **Computed** from song audio traits / exact-ID metadata |
| Output | Ranked services + lifecycle | Ordered five-song plan |
| Safety | Service driving/stopped rules | Playability, explicit/child policy, skip policy, karaoke gates |

The content selector requires an accepted or active detailed service and never
re-opens the service decision:

```yaml
selected_service:
  selected_service_id: music_playlist | humming_karaoke | full_karaoke
  lifecycle_state: accepted | active
```

Missing, rejected, or unsupported → typed error (§13). It never substitutes a
different service.

### 2.4 Decision boundary

**Control inputs** (constrain evaluation, never scored): `selected_service`,
`trigger.purpose`, `trigger.stage`, time, market, motion state, frozen world
snapshot, frozen catalog, algorithm/parameter versions, `plan_item_count`
(default 5).

**Scored evidence:** only the features in the §5.3 contract with an active
weight mask.

**Non-scoring controls:** motion state, child explicit-content policy,
market/restrictions/playability, karaoke availability flags, skip-exclusion
window, item count, humming segment duration, lighting, transition policy.

---

# Part II — The scoring model

## 3. Core mathematical model

### 3.1 The symbol chain (one rule for every feature)

Every feature — audio, identity, or history — follows the **same** five steps.
Only the way `a_i` is produced differs, and §5 gives that per feature.

| Step | Symbol | Name | Meaning | Range |
|---|---|---|---|---|
| 1 | `x_i` | raw value | world snapshot or song field | field-specific |
| 2 | `e_i` | **evidence** | how strongly the context calls for something | `[0,1]` or signed `[-1,+1]` |
| 3 | `a_i(j)` | **response coefficient** | how well song `j` answers feature `i` (see §5) | `[-1,+1]` |
| 4 | `r_i(j)` | **feature_response** | `e_i · a_i(j)` | `[-1,+1]` |
| 5 | `w_i` | **effective weight** | this feature's normalized importance (§6) | `[0,1]`, `Σ = 1` |
| — | `k_i(j)` | contribution | `w_i · r_i(j)` | `[-w_i,+w_i]` |
| — | `F(j)` | **item_fit** | `clamp( Σ_i k_i(j), -1, +1 )` — the score shown | `[-1,+1]` |

`item_fit` is a comparative hypothesis score — **not** a probability, acceptance
rate, or safety assurance.

Only the **six driver/environment features** build `a_i` from the two song
traits (§4). Every other feature sets `a_i` directly (e.g. `+1`, or an exact-ID
match). So "traits" and "arousal/valence demand" are a property of the six
driver/environment features, not of the whole model.

### 3.2 Why every score stays in range (no hidden clamps)

- Each response coefficient satisfies `|a_i| ≤ 1` (for audio features because
  `|α_i| + β_i ≤ 1`; for the rest by definition). With `e_i` bounded, `r_i ∈
  [-1,+1]`.
- Weights are non-negative and sum to one, so `Σ k_i ∈ [-1,+1]`.

The `clamp` on `item_fit` therefore only guards floating-point drift.

### 3.3 What "effective weight" means

A feature's weight is built in three multiplicative steps, then normalized so the
active set sums to one:

```text
base_weight_i = category_weight × subgroup_weight × leaf_weight          (§6.1)
raw_weight_i  = base_weight_i × purpose_multiplier[purpose][subgroup] × mask_i
w_i           = raw_weight_i / Σ_j raw_weight_j
```

- `base_weight` — the feature's share of the whole tree.
- `purpose_multiplier` — a per-trigger-purpose nudge on a whole subgroup (§6.2).
- `mask` — `1` if scorable in Spotify-only V1, else `0` (unsupported relations
  contribute nothing but stay visible).
- the final divide is the only reason the numbers look uneven — it just rescales
  whatever survived so the active features sum to one.

### 3.4 Numeric rules

IEEE-754 binary64; fixed feature order; full-precision ranking, rounding only for
display; `−0` serialized as `+0`; exact score ties broken by ascending Track ID;
cross-runtime tolerance `1e-12`.

---

## 4. Song traits — how the audio response coefficient is built

### 4.1 The four traits and why they exist

Spotify audio fields carry no per-context meaning, but they do carry a few robust
*musical* qualities. We distill each song into four **traits** in `[0,1]`, each
with a specific job:

| Trait | Question | Used by |
|---|---|---|
| **arousal** | How energetic is the song? | ranking (all services) |
| **valence** | How bright/positive is the song? | ranking (all services) |
| **humming_ease** | How easy is it to hum along? | `humming_karaoke` only |
| **full_karaoke_ease** | How easy is it to sing the whole song? | `full_karaoke` only |

Arousal and valence are the two axes of the **circumplex model of affect**
(energy × pleasantness): together they place a song on a 2-D mood plane instead
of a 1-D loudness line. The two ease traits are singability proxies used only to
judge a song's fit for a karaoke *service* (§5.4), never to judge context.

### 4.2 Table 1 — Trait Composition Matrix

Each trait is a weighted blend of audio fields; weights within a trait sum to
`1`, so every trait output is in `[0,1]` by construction. `(inv)` = the field is
used inverted (`1 − field`) because a higher raw value means *less* of the trait.

| Audio field | arousal | valence | humming_ease | full_karaoke_ease |
|---|---:|---:|---:|---:|
| `energy` | 0.30 | — | — | — |
| `loudness` | 0.25 | — | — | — |
| `tempo` | 0.25 | — | 0.20 | 0.20 |
| `danceability` | 0.15 | — | 0.20 | 0.15 |
| `acousticness` | 0.05 `(inv)` | — | — | — |
| `valence` | — | 0.65 | — | — |
| `mode` | — | 0.35 | — | — |
| `instrumentalness` | — | — | 0.35 `(inv)` | 0.30 `(inv)` |
| `speechiness` | — | — | 0.25 `(inv)` | 0.20 `(inv)` |
| `duration_ms` | — | — | — | 0.15 |
| **sum** | **1.00** | **1.00** | **1.00** | **1.00** |

### 4.3 Per-audio-field detail (what it measures, why it loads where)

- **`energy`** `[0,1]` — Spotify's perceptual measure of intensity and activity
  (fast, loud, noisy). It *is* arousal, so it is arousal's largest term (0.30).
  It says nothing about mood or singability → 0 elsewhere.
- **`loudness`** dB `[-60,0]` — overall track loudness; louder tracks read as
  more aroused. Normalized to `[0,1]` and given 0.25 of arousal.
- **`tempo`** BPM — speed. Appears in **two** traits with **different**
  normalizations: `norm_tempo` (monotonic, faster = more aroused) → 0.25 of
  arousal; `tempo_ease` (centered, ~110 BPM easiest to sing) → 0.20 of both ease
  traits.
- **`danceability`** `[0,1]` — how suitable for dancing (beat strength, rhythm
  stability). A steady groove adds perceived energy (0.15 arousal) and makes a
  song easier to sing along to (0.20 humming / 0.15 full).
- **`acousticness`** `[0,1]` — confidence the track is acoustic. Acoustic tracks
  tend to be calmer, so it is a small **inverse** arousal signal (0.05).
- **`valence`** `[0,1]` — Spotify's musical positiveness (happy/cheerful vs
  sad/angry). The direct mood measure → 0.65 of valence.
- **`mode`** `{0,1}` — minor (0) vs major (1). Major reads brighter; a real but
  coarse mood cue → 0.35 of valence.
- **`instrumentalness`** `[0,1]` — likelihood of *no vocals*. You cannot hum or
  sing a purely instrumental track, so it is the largest **inverse** term in
  both ease traits (0.35 humming / 0.30 full).
- **`speechiness`** `[0,1]` — presence of spoken words (rap, talk). Very speechy
  tracks have no hummable melody → **inverse** via `speech_ease` (0.25 humming /
  0.20 full).
- **`duration_ms`** — track length. Only matters for **full** karaoke (a very
  long track is harder to sing end-to-end) → 0.15 via `duration_ease`; humming
  uses a fixed segment so length is irrelevant there. Also drives plan duration.

Retained but **never scored** in V1: `key`, `time_signature`, `liveness`
(no reliable V1 use), and all identity/URL fields.

### 4.4 Trait formulas

```text
norm_loudness = clamp((loudness + 60) / 60)        # -60 dB→0, 0 dB→1
norm_tempo    = clamp((tempo - 60) / 120)          # 60→0, 180→1  (monotonic)
tempo_ease    = 1 - clamp(|tempo - 110| / 90)      # centered: 110 BPM easiest
speech_ease   = 1 - clamp((speechiness - 0.33) / 0.33)
duration_ease = 1 - clamp((duration_ms - 180000) / 180000)
clamp(z)      = min(max(z, 0), 1)

arousal            = 0.30·energy + 0.25·norm_loudness + 0.25·norm_tempo
                   + 0.15·danceability + 0.05·(1 - acousticness)
valence            = 0.65·valence + 0.35·mode
humming_ease       = 0.35·(1 - instrumentalness) + 0.25·speech_ease
                   + 0.20·danceability + 0.20·tempo_ease
full_karaoke_ease  = 0.30·(1 - instrumentalness) + 0.20·speech_ease
                   + 0.20·tempo_ease + 0.15·duration_ease + 0.15·danceability
```

The table columns **are** the formula coefficients — matrix and formulas cannot
drift apart. The signed traits used in scoring are `A_s = 2·arousal − 1` and
`V_s = 2·valence − 1`.

---

## 5. Feature compatibility — the complete wiring

This is the heart of the algorithm: for **every** scored feature, what world
input it reads, what Spotify field it compares against, its evidence, and its
response coefficient. The audio-mood response (§5.1–5.2) covers just the six
driver/environment features in §5.3.

### 5.1 The response coefficient, and why arousal is two-sided but valence is one-sided

For the six driver/environment features, the song answers with its two signed
traits, weighted by the feature's **demand** — `α` on arousal, `β` on valence:

```text
a_i(song) = α_i · A_s(song) + β_i · V_s(song)
r_i(song) = e_i · a_i(song)
```

Direction lives entirely in the coefficient sign × the trait sign — never in the
evidence, which is a plain magnitude:

| demand `α` | song arousal | product | meaning |
|---|---|---|---|
| `+` wants active | active `+` | `+` | reward energetic song |
| `+` wants active | calm `−` | `−` | penalize calm song |
| `−` wants calm | calm `−` | `+` | reward calm song |
| `−` wants calm | active `+` | `−` | penalize energetic song |

`α ∈ [-1,+1]` (some contexts want energy, some want calm). `β ∈ [0,+1]` only — a
driver-support context never wants *dark* music, just more or less brightness:

| context stress `e` | bright song `V_s=+1` | dark song `V_s=-1` |
|---|---|---|
| low (`e→0`) | ≈0 neutral | ≈0 neutral |
| high (`e→1`) | `+β` reward bright | `−β` penalize dark |

### 5.2 Table 2 — Context Response Matrix (the six audio-mood demands)

Row-normalized: `|α| + β ≤ 1` (`= 1` for every non-neutral state), so
`|a_i| ≤ 1`. `⚠` marks a directional hypothesis (see §5.6).

| Feature | `α` (arousal) | `β` (valence) | reading |
|---|---:|---:|---|
| Drowsiness | **+0.80** | +0.20 | energize, slightly brighten |
| Fatigue ⚠ | **−0.50** | +0.50 | soothe **+** brighten |
| Monotony | **+0.90** | +0.10 | stimulate against boredom |
| Traffic ⚠ | **−0.40** | +0.60 | de-stress **+** brighten |
| Night ⚠ | **−0.50** | +0.50 | calm **+** warm |
| Road | highway **+1.00** / local `0` / mountain **−1.00** / parking `0` | 0.00 | match road load |

Drowsiness (`+`) and fatigue (`−`) pull in **opposite** arousal directions — the
separation a single activation scalar could never express.

### 5.3 Table 3 — Complete baseline-feature contract

The full content-proposal baseline feature set, using the exact
category / subcategory / feature names from parent specification **§9**. For each
feature: does V1 score it; if yes, its world input → evidence and the song
metadata → response coefficient; if no, the reason. Categorical features are
expanded to their enum values so the response for **each value** is explicit.
`r_i = e_i · a_i` throughout. `⚠` = directional hypothesis (§5.6). **`genre‡`** =
scored via the **`genre_affinity_v1`** data-contract extension (§5.7): mask `1`
when the extension is enabled, mask `0` (context-only — today's Spotify-only
behavior) when it is not. These six features implement CDC-SU slide 69's
genre-scored intent.

**Situation**

| Subcategory | Feature · value | Scored? | World input `x_i` → evidence `e_i` | Song metadata → response `a_i` | Reason if not scored |
|---|---|---|---|---|---|
| Current driver state | Drowsiness level | ✓ | `drowsiness_level` → `/100` | traits → `+0.80·A_s + 0.20·V_s` | — |
| Current driver state | Fatigue level ⚠ | ✓ | `fatigue_level` → `/100` | traits → `−0.50·A_s + 0.50·V_s` | — |
| Driving environment | Traffic state · `normal` | ✓ | `e = 0` | neutral → `0` | — |
| Driving environment | Traffic state · `congested` ⚠ | ✓ | `e = 1` | traits → `−0.40·A_s + 0.60·V_s` | — |
| Driving environment | Road type · `highway` | ✓ | `e = 1` | traits → `+1.00·A_s` | — |
| Driving environment | Road type · `local` | ✓ | `e = 1` | neutral → `0` | — |
| Driving environment | Road type · `mountain` | ✓ | `e = 1` | traits → `−1.00·A_s` | — |
| Driving environment | Road type · `parking` | ✓ | `e = 1` | neutral → `0` | motion handled by eligibility, not score |
| Driving environment | Day/night state · `day` | ✓ | `e = 0` | neutral → `0` | — |
| Driving environment | Day/night state · `night` ⚠ | ✓ | `e = 1` | traits → `−0.50·A_s + 0.50·V_s` | — |
| Driving environment | Road monotony | ✓ | `monotony_level` → `/100` | traits → `+0.90·A_s + 0.10·V_s` | — |
| Route and destination | Route characteristics ⚠ | ✓ `genre‡` | `route_tags` → recognized-tag intensity | `G_song` best-match on the `route→genre` map (§5.7) → `a ∈ [−1,+1]` | loose mapping; low-weight hypothesis |
| Route and destination | Destination characteristics ⚠ | ✓ `genre‡` | `destination_tags` → intensity | `G_song` best-match on the `destination→genre` map (§5.7) | loose mapping; low-weight hypothesis |
| Passenger composition | Child present | ✓ `genre‡` + ✓ elig. | `child_present` → `1 if true` | `G_song` best-match on the child-friendly genre map (§5.7) | also drives explicit eligibility (§7) |
| Passenger composition | Multiple passengers | ✗ | — | — | No group-appeal song field |
| Driving state | Driving/stopped · `driving` ⚠ | ✓ + elig. | `e = 1` | traits → `α_drive·A_s`, with `α_drive = −0.30` (mild calm to reduce load; versioned §5.6) | overlaps drowsiness/monotony; direction is a hypothesis |
| Driving state | Driving/stopped · `stopped` | ✓ + elig. | `e = 0` | neutral → `0` | also the full-karaoke eligibility gate (§7) |

*Added construct (not a §9 baseline feature):* **Song singability** — scored
under Situation for karaoke only. `selected_service.id` → `e = 1` karaoke / `0`
playlist; `humming_ease` or `full_karaoke_ease` → `a = 2·ease − 1` (§5.4).

**Preference**

| Subcategory | Feature · value | Scored? | World input `x_i` → evidence `e_i` | Song metadata → response `a_i` | Reason if not scored |
|---|---|---|---|---|---|
| Oshi information | Oshi registered | gate | part of the oshi gate | — | enables Oshi ID; not a standalone score |
| Oshi information | Oshi mode · `on`/`off` | gate | `off` forces oshi gate `= 0` | — | enables Oshi ID; not a standalone score |
| Oshi information | Oshi ID | ✓ | gate `1 if registered ∧ on ∧ oshi_id` | `spotify_track.artists[*].id` → `+1 if any id matches else 0` | — |
| Oshi information | Oshi type | ✗ | — | — | V1 does exact Artist identity only; no member/group/character graph |
| Oshi information | Oshi tags | ✗ | — | — | No song semantic tags |
| Unused function | Service recency | ✗ | — | — | Same value for every candidate in the selected service |
| Overall usage frequency | Service usage level | ✗ | — | — | Service-level; same across candidates |
| Scene-specific tendency | Scene/service usage level | ✗ | — | — | Service-level; same across candidates |
| UPro information | Age band | ✓ | `age_band` → `1 if band ∧ year` | `album.release_date` → era → `age_era_affinity[band][era]` | — |
| UPro information | Gender | ✗ | — | — | CDC-SU preserved at default transparent weight 0 |
| UPro information | Hobbies and interests | ✓ `genre‡` | `hobby_interest_tags` → matched-tag intensity | `G_song` best-match on the `hobby→genre` map (§5.7) | via `genre_affinity_v1` |
| Unused content | Catalog item recency | ✗ | — | — | Not in CDC-SU content inputs (slides 71–73 have no novelty/unused row) |
| Unused content | Content-tag recency | ✗ | — | — | Not in CDC-SU content inputs (slides 71–73) |
| Overall usage frequency | Content-tag usage level | ✓ `genre‡` | `e = 1` if `usage_by_genre` fixture present | `G_song` best-match on the `usage_by_genre` curve (§5.7) | Tier-2: needs per-genre usage fixture |
| Overall usage frequency | Catalog item usage level | ✓ | `catalog_item_usage_level[id]` → `never 0 / low −.5 / med +.25 / high +1` | `spotify_track.id` → `+1` | — |
| Scene-specific tendency | Scene/content-tag usage level | ✓ `genre‡` | `e = 1` if `scene_genre_usage` fixture present | `G_song` best-match on the `scene_genre_usage[scene]` curve (§5.7) | Tier-2: needs scene×genre fixture |
| Playback and user operations | Played items | ✓ | `played_items` → `≤30m −1 / today −.5 / ≤7d −.25 / else 0` | `spotify_track.id` → `+1` | — |
| Playback and user operations | Skipped items | ✓ + elig. | `skipped_items` → in window **exclude** (§7); older `−.5` | `spotify_track.id` → `+1` | — |
| Playback and user operations | Cancelled content plans | ✗ | — | — | Not in slide 71/72 playback-ops list (only played / skip / change) |
| Playback and user operations | Changed-from items | ✓ | `changed_from_items` → `−.75 in window` | `spotify_track.id` → `+1` | — |

**History**

| Subcategory | Feature · value | Scored? | World input `x_i` → evidence `e_i` | Song metadata → response `a_i` | Reason if not scored |
|---|---|---|---|---|---|
| Proposal result | Service proposal acceptance rate | ✗ | — | — | Service-level; same across all candidates |
| Recovery result | Service recovery rate | ✗ | — | — | Service-level; same across all candidates |
| Schedule | Scheduled event type | ✗ | — | — | No song event relation |
| Schedule | Scheduled event timing | ✗ | — | — | Timing alone cannot establish item affinity |
| Schedule | Scheduled event tags | ✗ | — | — | No song event tags |
| Proposal result | Content proposal acceptance rate | ✓ | `content_proposal_acceptance_rate[track_id]` → `2·rate/100 − 1` | `spotify_track.id` → `+1` | — |
| Recovery result | Content recovery rate | ✓ | `content_recovery_rate[track_id]` → `2·rate/100 − 1` | `spotify_track.id` → `+1` | — |

**Totals:** 38 §9 baseline features (Situation 11 · Preference 20 · History 7),
shown above with the categorical scored ones expanded to enum values. **15 are
scored in Spotify-only V1** (Situation 7 · Preference 6 · History 2); **6 more are
`genre‡`** (route, destination, child, hobbies, content-tag usage,
scene/content-tag usage), scored when the `genre_affinity_v1` extension is enabled
and context-only otherwise (§5.7) — so **21 scorable with the extension on**. Oshi
registered/mode are gates; the remaining 15 stay `context_only` (incl.
novelty/unused-content and cancelled plans, dropped per CDC-SU slides 71–73).
`Song singability` is an added construct. The 11 "Additional proposed" simulator
features in §9 are out of scope for baseline-only V1.

### 5.7 The `genre_affinity_v1` extension (CDC-SU slide 69)

Slide 69's "content judgment axis" column shows that route/destination,
passengers (child), UPro hobbies, usage-frequency, and scene preference were all
meant to be scored against a song's **genre**. Genre is not on the Spotify
**Track** object — but it *is* on the **Artist** object (`genres`, from
`GET /artists`). V1 keeps it out of the Spotify-only Track/Audio-Features contract
and instead defines it as one **opt-in, namespaced data-contract extension**,
`genre_affinity_v1` (music-data spec §21). When the extension is enabled the six
`genre‡` features above carry mask `1`; when it is not, they carry mask `0` and
behave exactly as `context_only` — today's Spotify-only behavior, unchanged. This
section is that extension's scoring design; the data side lives in the music-data
spec.

**Genre source and the song's genre set.** The extension supplies a namespaced
artist-genre lookup keyed by Artist ID (modeling `GET /artists`; it does **not**
overwrite the Spotify-compatible inline `track.artists[]`, per music-data §21).
A song's genre set is the union over its artists:

```text
G_song = ⋃ over a ∈ spotify_track.artists[*] of  artist_genres[a.id]
```

Genres come from a **fixed controlled vocabulary** (music-data §21):

```text
j-pop · j-rock · city pop · anime · vocaloid · enka ·
children's music · classical · jazz · ambient · electronic · japanese folk
```

They are **artist-level and coarse** by construction, so a song inherits its
artists' genres and no per-song genre precision is claimed.

**Coefficient (uniform across all six `genre‡` features).** Each feature defines a
signed target genre-weight vector `g_target` in `[−1,+1]` (context-derived for
Tier 1, history-derived for Tier 2). The song answers with its **best-matching
genre**:

```text
a_i(song) = clamp( max over g ∈ G_song of g_target[g],  −1, +1 )
r_i       = e_i · a_i
```

If no song genre appears in the table, `a_i = 0` (neutral). `max` rewards the
song's best available match; a genre the context mildly rejects (negative weight)
only bites when the song offers nothing better. This is a deliberately loose,
low-weight hypothesis — child *safety* is unaffected, still enforced by the
explicit-content eligibility gate (§7), not by this soft score.

**Tier 1 — static affinity maps.** `e_i` = the intensity with which the context
calls for a genre lean (recognized-tag count/strength, normalized to `[0,1]`;
`child_present → 1`). `g_target` is a designed `tag → {genre: weight}` table,
unioned and clamped over the active tags. Reference tables (the versioned
defaults; loose by design):

| Feature | `route_tags` / `destination_tags` / etc. → `g_target` |
|---|---|
| **Route** ⚠ | `coastal → {city pop:+.8, jazz:+.5, ambient:+.4, enka:−.3}` · `mountain → {japanese folk:+.7, enka:+.6, ambient:+.4, classical:+.3}` · `highway → {j-rock:+.7, electronic:+.6, j-pop:+.3}` · `urban → {city pop:+.6, j-pop:+.5, electronic:+.5}` |
| **Destination** ⚠ | `resort → {city pop:+.7, j-pop:+.5}` · `nature → {ambient:+.6, japanese folk:+.5, classical:+.4}` · `event → {j-rock:+.6, anime:+.4, vocaloid:+.4}` · `home → {jazz:+.3, j-pop:+.3}` |
| **Child** | `{anime:+1, children's music:+1, vocaloid:+.6, j-pop:+.3, j-rock:−.4}` |
| **Hobbies** | `anime-fan → {anime:+.9, vocaloid:+.8, j-pop:+.4}` · `fitness → {j-rock:+.7, electronic:+.6}` · `wellness → {ambient:+.7, jazz:+.6, classical:+.5}` · `idol/live → {j-pop:+.6, j-rock:+.5}` · `tradition → {enka:+.7, japanese folk:+.6, classical:+.4}` |

Route and destination carry the **⚠ loose-mapping** mark; their tree shares (§6.1)
are already small, so they act as low-weight nudges. The tag strings above are the
versioned reference vocabulary; a `route_tag`/`destination_tag`/`hobby` not present
in a feature's table simply contributes nothing to `g_target` (no error), so the
tables may stay partial.

**Tier 2 — genre-level history.** Requires new per-genre history fixtures in the
world (music-data §13): `usage_by_genre[genre]` and `scene_genre_usage[scene][genre]`,
each a level in `{never, low, med, high}`. These are converted to `g_target` by the
same curve the exact-item usage feature uses (§5.3): `never / absent → 0`,
`low → −.5`, `med → +.25`, `high → +1`. Then §5.7's best-match rule applies.

| Feature | `g_target[g]` | `e_i` |
|---|---|---|
| **Content-tag usage** | `curve( usage_by_genre[g] )` | `1` if the `usage_by_genre` fixture is present, else `0` |
| **Scene/genre usage** | `curve( scene_genre_usage[current_scene][g] )` | `1` if the `scene_genre_usage` fixture is present, else `0` |

**Weights, missing data, fallback.** Enabling the extension only flips these six
leaves' masks `0→1`; the tree shares in §6.1 are unchanged and normalization
redistributes automatically. A song with an empty `G_song` (no artist genres)
scores `a_i = 0` on every `genre‡` feature and is listed `missing_neutral` (no
weight redistribution, per §8). With the extension **absent**, all six stay mask
`0` — bit-identical to today's Spotify-only V1.

Driver-state/environment features are deliberately **not** genre-scored:
arousal/valence already render slide 69's "uptempo genre" intent more directly
than a coarse genre label would.

### 5.4 One matrix, not three

Because arousal and valence describe the *song*, not the service, they are
identical for all three services. Only the **Song singability** row swaps its
source — `humming_ease` for humming, `full_karaoke_ease` for full karaoke, masked
to `0` for playlist. A hard-to-hum song is therefore *penalized* for humming, not
merely un-bonused. That single swapping row is the only per-service difference,
which is why one matrix suffices instead of three.

### 5.6 The one open directional choice

Fatigue, Traffic, and Night (`⚠`) have an arousal sign that is a product
hypothesis. This spec adopts the **soothe/de-stress** direction. The alternative
**keep-alert** direction is a one-line sign flip on `α` for those three rows and
changes no other machinery. It is a versioned hyperparameter.

---

## 6. Hierarchical weights

### 6.1 Categories, subgroups, leaves, masks

Mask legend: **✓** scored · **✗** context-only · **`genre‡`** scored via the
`genre_affinity_v1` extension (mask `1` when enabled, else `0`; §5.7) · **⚠**
directional hypothesis.

| Category (share) | Subgroup (share) | Leaves (share) — mask |
|---|---|---|
| **Situation 0.55** | Driver state 0.35 | drowsiness 0.55 ✓, fatigue 0.45 ✓ |
| | Driving environment 0.30 | traffic 0.15 ✓, road 0.15 ✓, night 0.20 ✓, monotony 0.50 ✓ |
| | Driving state 0.05 | motion 1.00 ✓⚠ (driving→`α·A_s`, stopped→0) |
| | Song singability 0.13 | `service_ease` 1.00 — ✓ karaoke / ✗ playlist |
| | Route/destination 0.09 | route 0.5 `genre‡`⚠, destination 0.5 `genre‡`⚠ |
| | Passengers 0.08 | child 0.6 `genre‡`, multiple 0.4 ✗ |
| **Preference 0.30** | UPro/oshi 0.35 | oshi 0.60 ✓, age 0.10 ✓, hobbies 0.30 `genre‡`, gender 0.00 |
| | Novelty 0.10 | item recency 0.60 ✗, tag recency 0.40 ✗ *(whole subgroup dropped — slides 71–73)* |
| | Usage 0.35 | item usage 0.40 ✓, genre usage 0.30 `genre‡`, scene/genre 0.30 `genre‡` |
| | Operations 0.20 | played 0.25 ✓, skipped 0.35 ✓, changed 0.20 ✓, cancelled 0.20 ✗ |
| **History 0.15** | Schedule 0.30 | schedule 1.00 ✗ |
| | Content acceptance 0.30 | exact Track rate 1.00 ✓ |
| | Content recovery 0.40 | exact Track rate 1.00 ✓ |

`genre‡` leaves carry mask `0` in Spotify-only V1 — identical to ✗ — and switch to
mask `1` when the `genre_affinity_v1` extension is enabled (§5.7); the tree shares
above are unchanged either way, so enabling the extension only flips masks and
renormalizes. The Novelty subgroup is entirely unused and renormalizes away.

### 6.2 Purpose multipliers (applied per subgroup before normalization)

| Subgroup | Rest recommended | Inattentive/recovery | Route music | Child experience |
|---|---:|---:|---:|---:|
| Driver state | 1.50 | 1.50 | 0.90 | 0.90 |
| Driving environment | 1.25 | 1.40 | 0.80 | 0.80 |
| Song singability | 1.00 | 1.00 | 1.00 | 1.00 |
| UPro/oshi | 0.90 | 0.80 | 1.10 | 1.10 |
| Novelty | 0.60 | 0.60 | 1.00 | 0.80 |
| Usage | 0.80 | 0.75 | 1.10 | 1.00 |
| Operations | 1.00 | 1.00 | 1.00 | 1.00 |
| Content acceptance | 0.80 | 0.75 | 1.00 | 1.00 |
| Content recovery | 1.40 | 1.50 | 0.80 | 0.80 |

### 6.3 Normalization

After `base × purpose × mask`, divide every surviving leaf by the sum of all
surviving leaves so `Σ w_i = 1`. A zero or non-finite denominator is invalid.

---

# Part III — Eligibility and data handling

## 7. Hard eligibility

Eligibility runs **before** scoring and returns explicit reason codes. No score
can reinstate an excluded song. Eligibility reads these Spotify/simulator fields:

| Check | Song field | Rule |
|---|---|---|
| Schema/identity | Track ↔ Audio-Features `id`/`uri`/`duration_ms` | must agree |
| Playable | `spotify_track.is_playable` | must be `true` |
| Market | `spotify_track.available_markets` | must contain current market |
| Restriction | `spotify_track.restrictions` | must not block current context |
| Explicit/child | `spotify_track.explicit` | excluded if `true` under child policy |
| Recent skip | history skip window | excluded if skipped inside `skip_exclusion_window` |
| Duplicate | `spotify_track.id` | one Track per plan |
| Humming gate | `simulation_flags.humming_karaoke_available` | must be `1` for humming |
| Full-karaoke gate | `simulation_flags.full_karaoke_available` **and** `motion_state` | flag `1` **and** stopped |

Karaoke flags default to `1`, are gates only, and never add score. High
`instrumentalness` lowers the ease traits but is **not** an exclusion.

## 8. Missing, unknown, and invalid data

- **Missing scored field** → `e=0`, `a=0`, weight retained, listed
  `missing_neutral`. Absence never redistributes weight.
- **Present raw `0`** on a `[0,100]` feature is a valid low value, not missing.
- **Unsupported semantic** (route, tags, schedule, …) → `context_only`, mask `0`.
- **Missing audio field required by an active trait formula** → `invalid_catalog`,
  song excluded (V1 never imputes provider values).
- **Invalid** (NaN/inf, out-of-range field, identity mismatch, flag ∉ {0,1},
  unknown service, bad version, zero active-weight denominator) → reject/exclude;
  never silently coerce to neutral.

---

# Part IV — Producing the plan

## 9. Evaluation pipeline and plan construction

1. validate control inputs and lifecycle state;
2. load the frozen catalog and manifest; validate each song and cross-object
   identity;
3. apply common + service eligibility (§7);
4. derive the four traits per eligible song (§4.4);
5. resolve effective weights once (§6);
6. for each song, compute `r_i = e_i·a_i` for every feature (§5) and
   `item_fit = clamp(Σ w_i·r_i, -1, +1)`;
7. sort by `(item_fit desc, spotify_track.id asc)`;
8. take the first `plan_item_count`;
9. build presentation fields; persist plan + selected-item evidence.

```text
plan = first plan_item_count of eligible songs sorted by (item_fit desc, id asc)
```

No hidden diversity reranker, artist cap, shuffle, or LLM reorder. Fewer eligible
songs than the count → `insufficient_eligible_items`, never a silently shortened
plan. Each plan item shows order, title, artists, album/release (optional),
`item_fit`, and concise positive/negative reasons.

**Duration:** playlist and full karaoke sum `spotify_track.duration_ms`; humming
uses `plan_item_count × fixed_humming_segment_sec` (default 30 s), labeled
`simulated_fixed_segment`. **Lighting** (optional) may use `valence` as a
presentation cue only; it never changes score or order.

## 10. Worked example (redesigned block)

Isolates the six audio-mood features plus the ease leaf, using illustrative
normalized block weights `drowsiness .25, fatigue .20, monotony .20, traffic .12,
road .11, night .12`. The scored Preference/History features (§5.3) add on through
the same `Σ w_i·r_i`.

**Service** `humming_karaoke`; **world** drowsiness 80, fatigue 70, monotony 90,
traffic congested, road highway, night. **Song** `energy .842, tempo 118.2,
loudness -5.9, danceability .585, acousticness .002, valence .428, mode 1,
instrumentalness .007, speechiness .056, duration 237040`.

```text
arousal = 0.737 → A_s = +0.474 ;  valence = 0.628 → V_s = +0.256
humming_ease = 0.896 → service-ease response = +0.793
```

`r_i = e_i·(α·A_s + β·V_s)`:

| Feature | `e` | `α` | `β` | `r_i` | `w·r` |
|---|---:|---:|---:|---:|---:|
| Drowsiness | .80 | +.80 | +.20 | +0.344 | +0.086 |
| Fatigue | .70 | −.50 | +.50 | −0.076 | −0.015 |
| Monotony | .90 | +.90 | +.10 | +0.407 | +0.081 |
| Traffic | 1.0 | −.40 | +.60 | −0.036 | −0.004 |
| Road (hwy) | 1.0 | +1.0 | 0 | +0.474 | +0.052 |
| Night | 1.0 | −.50 | +.50 | −0.109 | −0.013 |
| **block sum** | | | | | **+0.187** |

The strong positives (drowsiness, monotony, highway) outweigh the calming pull of
congested/night because this world is dominated by high-arousal demand. Adding
the humming ease leaf (`+0.793`, its own weight) and the identity/history
contributions yields the final `item_fit`. In a low-drowsiness, congested, night
world the calming features dominate and a calm-bright song wins instead — the
same two songs reorder by context.

## 11. Contrast behavior

Each contrast freezes catalog, service, config, and seed and changes one world
field, asserting the expected reorder:

1–6. low↔high **drowsiness / fatigue / monotony**, and **normal↔congested /
highway↔mountain / day↔night** — calm/active order reverses.
7. child absent↔present with an explicit candidate — eligibility change.
8. oshi mode off↔on. 9. no play↔recent play. 10. low↔high item usage.
11. low↔high exact-item recovery. 12. driving↔stopped for full karaoke.
13. route A↔route B — **expected no rank change** (V1 manufactures no route-song
relation).

---

# Part V — Engineering contract

## 12. Parameters and hyperparameters

**Structural parameters:** `plan_item_count` (5), recipe registry, feature
contract order, age/era affinity table, exact-oshi rule, history precedence,
eligibility policy IDs, fixed humming segment, duration policy, lighting policy.

**Numeric hyperparameters (frozen per run, in evidence):** hierarchy weights
(§6.1); purpose multipliers (§6.2); **Trait Composition Matrix** (§4.2); **Context
Response Matrix** (§5.2, incl. the `⚠` sign choices); tempo/loudness bounds;
tempo-ease center/span; speech-ease and duration-ease bounds;
usage/novelty/operation mappings; lighting lookup. Editing any creates a new
parameter-set version.

## 13. Result and error categories

| Result | Meaning |
|---|---|
| `complete_plan` | exactly the configured number of songs |
| `invalid_request` | service lifecycle, purpose, stage, or count invalid |
| `unsupported_service` | no registered detailed recipe |
| `invalid_catalog` | catalog or song schema invalid |
| `no_proposal` | every candidate excluded |
| `insufficient_eligible_items` | fewer eligible songs than the plan count |
| `invalid_configuration` | weights, matrices, formulas, or versions invalid |
| `full_karaoke_requires_stopped` | full karaoke cannot run while moving |

Typed errors carry evidence and never trigger an undeclared fallback service.

## 14. Explainability contract

**Per selected song:** position, track ID, title, artists, `item_fit`, the four
trait values (and signed forms), and one row per scored feature with `e_i`, `a_i`
(and its α/β or exact-match provenance), `r_i`, base weight, purpose multiplier,
mask, effective weight, contribution, formula version.

**Per excluded song:** track ID + reason codes only.

**Per plan:** selected service + lifecycle; purpose + stage; plan count; catalog,
world, algorithm, schema, parameter hashes/versions; active vs context-only
feature lists; Trait Composition + Context Response matrix versions; normalized
effective weights; sort/tie-break rules; expected duration + basis; selected
Track IDs in order.

Identical inputs + versions reproduce a semantically identical plan (`1e-12`);
same-runtime canonical replay is byte-equivalent.

## 15. Implementation components

`ContentInputValidator` · `SpotifyFixtureValidator` · `RecipeRegistry` ·
`EligibilityEvaluator` · `TraitDeriver` (Table 1) · `ResponseCoefficientResolver`
(Table 3) · `ApplicabilityResolver` (masks) · `EffectiveWeightCalculator` ·
`FeatureResponseCalculator` (`r = e·a`) · `ItemScoreCalculator` ·
`DeterministicPlanBuilder` · `DurationPolicy` · `PresentationPolicy` ·
`EvidenceBuilder` · `ContrastRunner`. Keep validation, eligibility, trait
derivation, ranking, plan construction, and presentation independently testable.

## 16. Required tests

**Traits (§4):** each trait column sums to 1; every trait output in `[0,1]`;
`tempo` uses `norm_tempo` for arousal but `tempo_ease` for singability;
`key`/`time_signature`/`liveness` never affect score.

**Compatibility (§5):** every audio row has `|α|+β ≤ 1` and `|a_i| ≤ 1`; valence
coefficient never negative; oshi matches only exact `artists[*].id`; age uses
release year only; each direct row uses coefficient `+1`; `⚠` signs match the
configured choice.

**Weights (§6):** effective weights sum to 1; masked leaves contribute 0 and
renormalize; a purpose multiplier on a masked subgroup creates no active weight.

**Math:** `r_i = e_i·a_i` for all rows; contributions sum to `item_fit ∈
[-1,+1]`; §10 block reproduces `+0.187` within tolerance; all-neutral world →
block 0.

**Eligibility (§7):** playability/market/restriction/explicit-child/recent-skip;
karaoke flags 0 vs 1; full karaoke moving vs stopped; flags never change score.

**Determinism & contrast (§11):** same inputs/versions/seed → byte-equivalent;
each contrast changes only its field; route-only contrast causes no rank change.

## 17. Acceptance criteria

1. Songs scored only after one detailed music service is active; default output
   is one ordered five-song plan, each with its `item_fit`.
2. Every feature follows `r_i = e_i·a_i`; only the six audio-mood rows build `a_i`
   from traits, and Table 1 is exactly the trait formulas.
3. Audio response is `α·A_s + β·V_s` with Table 2 coefficients; arousal
   two-sided, valence one-sided; evidence `[0,1]`.
4. Traits are shared across all three services; only the `service_ease` leaf
   differs — one feature table, not three.
5. Scoring uses only Spotify-compatible fields and exact-ID history; oshi matches
   `artists[*].id`, age uses `album.release_date` — both explicit in §5.3.
6. Unsupported relations are visibly `context_only`, mask 0.
7. Bounds hold by construction: `|a_i| ≤ 1` and `Σ w_i = 1`.
8. Weights, matrices, curves, and sign choices are frozen and evidence-visible.
9. Hard eligibility, explicit-child, and full-karaoke stopped policy are
   deterministic and cannot be reversed by score.
10. Identical frozen inputs and versions reproduce the same plan.

## 18. Cross-document impact

This design **scores `valence`, `mode`, and `acousticness`**, which the current
[synthetic music data spec](./aica_synthetic_music_data_and_generation_specification.md)
lists as "retained, not scored." That spec's §5.2 scoring-role column and its
trade-off/coverage fixtures should be updated so the demonstration catalog
exercises bright/dark (`valence`, `mode`) and acoustic/electric (`acousticness`)
contrasts, not only energy/tempo. No change to the Spotify field contract itself
is required for these three.

Separately, the six **`genre‡` features** (§5.7) are scored through the opt-in
**`genre_affinity_v1`** extension, whose scoring design (vocabulary, affinity maps,
best-match coefficient, Tier-2 usage curves) is fixed in §5.7 and whose data side —
a namespaced artist-genre lookup plus the two Tier-2 per-genre history fixtures —
is specified in the [music-data spec](./aica_synthetic_music_data_and_generation_specification.md)
§21. The extension changes the frozen-catalog data contract and world fixtures, so
it is enabled per run; with it disabled, these six features are `context_only` and
this algorithm's Spotify-only V1 behavior is unchanged.

## 19. Deferred improvements

Licensed karaoke assets, lyrics/timing, chorus boundaries, vocal-range analysis,
richer credits, group-suitability metadata, event/schedule relations (route,
destination, child, and genre relations are now the `genre_affinity_v1` extension,
§5.7), an oshi member/group graph, a provider-independent replacement for the
deprecated Audio Features endpoint, learned/LLM ranking, confidence-weighted
sparse history, diversity constraints, and probabilistic acceptance/recovery
prediction. Each needs its own source and provenance review before it can affect
scoring.
