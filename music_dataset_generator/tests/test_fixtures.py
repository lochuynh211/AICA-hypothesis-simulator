"""T014 — recorded raw-response fixtures.

Validates that all hand-authored fixtures in tests/fixtures/cache/ match the
expected Soundcharts SongResponse3 shape (docs/master/p2-soundcharts-grounded-data-generation-design.md §1.1 and §7).

Required fields:
- name (str)
- isrc.value (str), isrc.countryCode (str), isrc.countryName (str)
- duration (int/float, in seconds)
- explicit (bool)
- releaseDate (str, YYYY-MM-DD or YYYY)
- languageCode (str)
- genres list with at least: root (str), sub list
- artists list with at least: uuid (str), name (str)
- audio block with all 12 P6-scored fields:
  acousticness, danceability, energy, instrumentalness, key,
  liveness, loudness, mode, speechiness, tempo, timeSignature, valence

FIREWALL: fixtures must NOT contain score/rank/label/target fields.
"""
import json
import pytest
from pathlib import Path


FIXTURE_CACHE_DIR = Path(__file__).parent / "fixtures" / "cache"

REQUIRED_AUDIO_FIELDS = {
    "acousticness", "danceability", "energy", "instrumentalness",
    "key", "liveness", "loudness", "mode", "speechiness",
    "tempo", "timeSignature", "valence",
}

FORBIDDEN_FIXTURE_KEYS = {"score", "rank", "label", "target", "item_fit", "recommended",
                           "best_for_world", "target_rank"}


def get_fixture_files():
    """Return all .json fixture files (excluding README.md)."""
    files = sorted(FIXTURE_CACHE_DIR.glob("*.json"))
    return [(f.stem, f) for f in files]


@pytest.fixture(params=get_fixture_files(), ids=[stem for stem, _ in get_fixture_files()])
def fixture_record(request):
    """Parametrize over all fixture JSON files."""
    isrc_stem, path = request.param
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    return isrc_stem, data


class TestFixtureShape:
    """T014: each fixture has the required Soundcharts SongResponse3 shape."""

    def test_name_present(self, fixture_record):
        _, record = fixture_record
        assert "name" in record, "fixture must have 'name'"
        assert isinstance(record["name"], str)
        assert record["name"]

    def test_isrc_present_and_structured(self, fixture_record):
        isrc_stem, record = fixture_record
        assert "isrc" in record, "fixture must have 'isrc'"
        isrc = record["isrc"]
        assert "value" in isrc, "isrc must have 'value'"
        assert isinstance(isrc["value"], str)
        assert "countryCode" in isrc
        assert "countryName" in isrc

    def test_isrc_value_matches_filename(self, fixture_record):
        isrc_stem, record = fixture_record
        assert record["isrc"]["value"] == isrc_stem, (
            f"isrc.value '{record['isrc']['value']}' must match filename '{isrc_stem}'"
        )

    def test_duration_present_and_positive(self, fixture_record):
        _, record = fixture_record
        assert "duration" in record, "fixture must have 'duration' (seconds)"
        assert record["duration"] > 0, "duration must be positive"

    def test_explicit_present_and_bool(self, fixture_record):
        _, record = fixture_record
        assert "explicit" in record
        assert isinstance(record["explicit"], bool)

    def test_release_date_present(self, fixture_record):
        _, record = fixture_record
        assert "releaseDate" in record
        assert isinstance(record["releaseDate"], str)
        assert record["releaseDate"]

    def test_language_code_present(self, fixture_record):
        _, record = fixture_record
        assert "languageCode" in record
        assert isinstance(record["languageCode"], str)
        assert record["languageCode"] in ("ja", "en", "ko", "zh", "fr", "de", "es", "pt", "other")

    def test_genres_present_and_structured(self, fixture_record):
        _, record = fixture_record
        assert "genres" in record, "fixture must have 'genres'"
        genres = record["genres"]
        assert isinstance(genres, list)
        assert len(genres) > 0, "genres must not be empty"
        for g in genres:
            assert "root" in g, "genre must have 'root'"
            assert "sub" in g, "genre must have 'sub'"
            assert isinstance(g["sub"], list)

    def test_artists_present_and_structured(self, fixture_record):
        _, record = fixture_record
        assert "artists" in record
        artists = record["artists"]
        assert isinstance(artists, list)
        assert len(artists) > 0, "artists must not be empty"
        for a in artists:
            assert "uuid" in a, "artist must have 'uuid'"
            assert "name" in a, "artist must have 'name'"

    def test_audio_block_present(self, fixture_record):
        _, record = fixture_record
        assert "audio" in record, "fixture must have 'audio' block"

    def test_audio_has_all_12_fields(self, fixture_record):
        _, record = fixture_record
        audio = record["audio"]
        missing = REQUIRED_AUDIO_FIELDS - audio.keys()
        assert not missing, f"audio block missing fields: {sorted(missing)}"

    def test_audio_numeric_ranges(self, fixture_record):
        _, record = fixture_record
        audio = record["audio"]
        for field in ("acousticness", "danceability", "energy", "instrumentalness",
                      "liveness", "speechiness", "valence"):
            val = audio[field]
            assert 0.0 <= val <= 1.0, f"audio.{field}={val} must be in [0,1]"
        assert isinstance(audio["key"], (int,)) and audio["key"] in range(-1, 12), (
            f"audio.key={audio['key']} must be in -1..11"
        )
        assert audio["mode"] in (0, 1), f"audio.mode={audio['mode']} must be 0 or 1"
        assert audio["tempo"] > 0, f"audio.tempo={audio['tempo']} must be positive"
        assert audio["timeSignature"] in (3, 4, 5, 6, 7), (
            f"audio.timeSignature={audio['timeSignature']} must be 3..7"
        )


class TestFixtureFirewall:
    """T014: fixtures carry NO score/label/target fields (firewall)."""

    def test_no_forbidden_keys(self, fixture_record):
        _, record = fixture_record
        self._check_no_forbidden(record, FORBIDDEN_FIXTURE_KEYS, path="root")

    def _check_no_forbidden(self, obj, forbidden, path):
        if isinstance(obj, dict):
            for k, v in obj.items():
                assert k not in forbidden, (
                    f"Firewall: fixture contains forbidden key '{k}' at {path}"
                )
                self._check_no_forbidden(v, forbidden, f"{path}.{k}")
        elif isinstance(obj, list):
            for i, item in enumerate(obj):
                self._check_no_forbidden(item, forbidden, f"{path}[{i}]")


class TestFixtureSetCoverage:
    """T014: the fixture set covers the intended scenario diversity."""

    def _load_all(self):
        records = []
        for path in sorted(FIXTURE_CACHE_DIR.glob("*.json")):
            with open(path, encoding="utf-8") as fh:
                records.append(json.load(fh))
        return records

    def test_at_least_8_fixtures(self):
        records = self._load_all()
        assert len(records) >= 8, f"Need >=8 fixtures to cover cells; got {len(records)}"

    def test_ja_primary_language(self):
        records = self._load_all()
        ja_count = sum(1 for r in records if r.get("languageCode") == "ja")
        assert ja_count >= 6, f"Need >=6 JA fixtures; got {ja_count}"

    def test_en_secondary_language(self):
        records = self._load_all()
        en_count = sum(1 for r in records if r.get("languageCode") == "en")
        assert en_count >= 2, f"Need >=2 EN fixtures; got {en_count}"

    def test_at_least_one_explicit(self):
        records = self._load_all()
        explicit_count = sum(1 for r in records if r.get("explicit") is True)
        assert explicit_count >= 1, "Need at least 1 explicit fixture"

    def test_high_energy_present(self):
        records = self._load_all()
        high_energy = [r for r in records if r.get("audio", {}).get("energy", 0) >= 0.70]
        assert len(high_energy) >= 2, "Need at least 2 high-energy fixtures (energy>=0.70)"

    def test_low_energy_present(self):
        records = self._load_all()
        low_energy = [r for r in records if r.get("audio", {}).get("energy", 1) <= 0.35]
        assert len(low_energy) >= 1, "Need at least 1 low-energy fixture (energy<=0.35)"

    def test_key_minus_one_present(self):
        """At least one fixture has key=-1 (undetected key fixture)."""
        records = self._load_all()
        key_neg = [r for r in records if r.get("audio", {}).get("key") == -1]
        assert len(key_neg) >= 1, "Need at least 1 fixture with key=-1"

    def test_high_acousticness_present(self):
        records = self._load_all()
        acoustic = [r for r in records if r.get("audio", {}).get("acousticness", 0) >= 0.60]
        assert len(acoustic) >= 1, "Need at least 1 acoustic fixture (acousticness>=0.60)"

    def test_low_acousticness_present(self):
        records = self._load_all()
        electric = [r for r in records if r.get("audio", {}).get("acousticness", 1) <= 0.10]
        assert len(electric) >= 2, "Need at least 2 electric fixtures (acousticness<=0.10)"

    def test_lineage_file_exists(self):
        lineage_path = FIXTURE_CACHE_DIR.parent / "lineage.json"
        assert lineage_path.exists(), "lineage.json must exist"

    def test_expected_dir_exists(self):
        expected_path = FIXTURE_CACHE_DIR.parent / "expected"
        assert expected_path.is_dir(), "expected/ directory must exist"
