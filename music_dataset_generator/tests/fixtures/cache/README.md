# Fixture Cache — Hand-Authored Soundcharts Response Stand-ins

These are **hand-authored** fixtures that simulate real Soundcharts
`/api/v2.25/song/by-isrc/{isrc}` response payloads.

They are **not real Soundcharts data**. They are structurally realistic
representations based on the documented `SongResponse3` shape (§1.1 and §7 of
`docs/master/p2-soundcharts-grounded-data-generation-design.md`), created to:

1. Exercise the S3 binner/selector without a live Soundcharts connection.
2. Provide coverage of several primary grid cells (energy × tempo × profile).
3. Include contrast pairs (bright/dark, acoustic/electric, easy-hum/hard-hum).
4. Include JA-primary and EN-secondary songs, plus explicit examples.
5. Include a negative-fixture candidate.

**Replacement:** When a real Soundcharts harvest is run (production loop),
these hand-authored stand-ins should be superseded or augmented by real
recorded payloads. The file naming convention (`{isrc}.json`) matches the
production cache key format.

## Files

| File | Description |
|------|-------------|
| `JPXX01900123.json` | JA high-energy/high-tempo, balanced-vocal (cell HI) |
| `JPXX01900124.json` | JA low-energy/low-tempo, balanced-vocal (calm contrast, cell LO) |
| `JPXX02000201.json` | JA medium-energy/medium-tempo, danceable-vocal |
| `JPXX01800301.json` | JA high-energy/high-tempo, bright/high-valence (bright contrast) |
| `JPXX01800302.json` | JA medium-energy/medium-tempo, dark/low-valence (dark contrast) |
| `JPXX02100401.json` | JA medium-energy/low-tempo, acoustic-leaning (acoustic contrast) |
| `JPXX02100402.json` | JA medium-energy/low-tempo, electric-leaning (electric contrast) |
| `JPXX02200501.json` | JA speech-forward (high speechiness) |
| `JPXX02200502.json` | JA instrumental-leaning (high instrumentalness) |
| `USAT22003425.json` | EN high-energy/high-tempo, balanced-vocal |
| `GBUM71900001.json` | EN low-energy/medium-tempo, balanced-vocal, explicit |

The `lineage.json` and `expected/` directory are placeholders for future
lineage tracking and expected-output comparison tests.
