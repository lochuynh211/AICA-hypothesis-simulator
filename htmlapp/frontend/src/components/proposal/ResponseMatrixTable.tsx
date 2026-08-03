/**
 * ResponseMatrixTable — dedicated editor for the response-coefficient
 * PARAMETERS (`service_response_profiles`, `road_response_profiles`), shaped
 * `{ service: { rowKey: { coefficient, provenance?, source_reference? } } }`.
 *
 * Renders the mockup's `response_matrix` grammar (ui-mockup.html §"② SERVICE"):
 * a pivot with rows = feature/road keys, columns = services, and an editable
 * `coefficient` in each cell. The real data is kept intact — editing a cell
 * updates ONLY that cell's `coefficient` and preserves its `provenance` /
 * `source_reference` (surfaced on hover via the cell `title`). Nothing is
 * flattened away or made read-only.
 */
import type { UiLanguage } from '../../i18n/t'
import { t } from '../../i18n/t'
import { mtxTableStyle, mtxThStyle, mtxTdStyle, mtxRowLabelStyle, mtxCornerStyle, mtxInputStyle } from './matrixStyles'
import { fieldName, isKnownOption, optionLabel, serviceLabel } from '../../lib/review/reviewVocabulary'

type Cell = { coefficient?: number; provenance?: string; source_reference?: string }
type Profiles = Record<string, Record<string, Cell>>

export type ResponseMatrixTableProps = {
  /** `{ service: { rowKey: { coefficient, provenance?, ... } } }`. */
  value: Profiles
  /** Receives the FULL updated profiles object (caller stores it as a param override). */
  onChange: (next: Profiles) => void
  /** Label for the top-left corner cell, e.g. "feature ＼ service". */
  cornerLabel?: string
  /** Optional — defaults to English so an un-migrated caller keeps compiling;
   * a caller that owns a `lang` from `useLanguage()`/the store should pass it
   * through so the service/feature headers switch with the rest of the UI. */
  lang?: UiLanguage
}

/** `road_response_profiles` rows are ROAD-TYPE context values (`highway`,
 * `mountain_road`, ...), not feature ids — try the feature-id table first
 * (covers `service_response_profiles`' rows), then the road_type value
 * vocabulary, before falling back to "unnamed". */
function rowLabel(row: string, lang: UiLanguage): string {
  if (isKnownOption('road_type', row)) return t(optionLabel('road_type', row), lang)
  return t(fieldName(row), lang)
}

/**
 * The citation shown after the provenance word, in the reader's language.
 *
 * `source_reference` is free-form English authored per cell in the package
 * manifest — 220 cells, but only these 49 distinct sentences. Translating them
 * HERE rather than in the manifest keeps the package data (which pytest
 * validates and which an algorithm author owns) untouched, and mirrors how
 * `ReviewColumn` already localises the other fixed English literals that reach
 * this UI from outside the frontend.
 *
 * Service ids are replaced by their specification names in BOTH languages: the
 * citation explains where a coefficient came from, and it should name services
 * the way the rest of the screen does.
 *
 * An unrecognised citation (a newly authored cell) falls through to its own
 * English text rather than being dropped — an untranslated fact still beats a
 * missing one — so a new coefficient is visibly un-localised rather than
 * silently unexplained.
 */
const CITATIONS: Record<string, { ja: string; en: string }> = {
  'Slides 66-67 (novelty/service-recency direct feature)':
    { ja: 'スライド66〜67（未使用機能の特徴量そのもの）', en: 'Slides 66–67 (the unused-feature novelty feature itself)' },
  'Slides 66-67 (overall usage direct feature)':
    { ja: 'スライド66〜67（全体的な利用頻度の特徴量そのもの）', en: 'Slides 66–67 (the overall-usage feature itself)' },
  'Slides 66-67 (scene-specific usage direct feature)':
    { ja: 'スライド66〜67（場面別の好み傾向の特徴量そのもの）', en: 'Slides 66–67 (the scene-specific usage feature itself)' },
  'Slide 67 acceptance-rate row': { ja: 'スライド67「提案受諾率」の行', en: 'Slide 67, the proposal-acceptance-rate row' },
  'Slide 67 recovery-rate row': { ja: 'スライド67「回復率」の行', en: 'Slide 67, the recovery-rate row' },
  'Slide 67 oshi row (oshi-mode content, mild - service definition magnitude)':
    { ja: 'スライド67「推し情報」の行（推しモード向けコンテンツ。強さはサービス定義に準拠し弱め）',
      en: 'Slide 67, the favourite-artist row (favourite-artist-mode content; magnitude kept mild per the service definition)' },
  'Environment reset by the stopped/post-rest snapshot':
    { ja: '停車中・休憩後のスナップショットで走行環境がリセットされるため', en: 'The environment is reset by the stopped / post-rest snapshot' },
  'Slide 67 does not address road type for post-rest services':
    { ja: 'スライド67は休憩後サービスの道路種別に言及していない', en: 'Slide 67 does not address road type for post-rest services' },
  "Slide 67 does not address road type for post-rest services; road is forced 'parking' by the stopped/post-rest snapshot":
    { ja: 'スライド67は休憩後サービスの道路種別に言及していない。停車中・休憩後のスナップショットでは道路が「駐車場」に固定される',
      en: 'Slide 67 does not address road type for post-rest services; the stopped / post-rest snapshot forces the road to “parking”' },
  'Slide 67 does not address road type for post-rest services; the expected post-rest road value':
    { ja: 'スライド67は休憩後サービスの道路種別に言及していない。これは休憩後に想定される道路の値',
      en: 'Slide 67 does not address road type for post-rest services; this is the expected post-rest road value' },
  'Slide 67 driver row (drowsiness/fatigue -> humming/call-response/quiz/ranking)':
    { ja: 'スライド67「現在のドライバーの状態」の行（眠気・疲労度 → 鼻歌カラオケ／合いの手練習／クイズ／ランキング作成）',
      en: 'Slide 67, the driver-state row (drowsiness/fatigue → humming karaoke, call-and-response practice, quiz, ranking creation)' },
  'Slide 67 driver row (music_playlist not named)':
    { ja: 'スライド67「現在のドライバーの状態」の行（プレイリスト再生は挙げられていない）',
      en: 'Slide 67, the driver-state row (playlist playback is not named)' },
  'Slide 67 driver row (radio_style not named on any driver-state/environment row)':
    { ja: 'スライド67では、ラジオ風再生はドライバー状態・走行環境のいずれの行にも挙げられていない',
      en: 'Slide 67 does not name radio-style playback on any driver-state or environment row' },
  'Slide 67 environment row (congested -> activation services)':
    { ja: 'スライド67「走行環境」の行（渋滞 → 覚醒を促すサービス）', en: 'Slide 67, the environment row (congestion → activating services)' },
  'Slide 67 environment row (highway)': { ja: 'スライド67「走行環境」の行（高速道路）', en: 'Slide 67, the environment row (highway)' },
  'Slide 67 environment row (monotony -> activation services)':
    { ja: 'スライド67「走行環境」の行（単調な道 → 覚醒を促すサービス）', en: 'Slide 67, the environment row (monotony → activating services)' },
  'Slide 67 environment row (music_playlist not named for highway)':
    { ja: 'スライド67「走行環境」の行（高速道路にプレイリスト再生は挙げられていない）',
      en: 'Slide 67, the environment row (playlist playback is not named for highway)' },
  'Slide 67 environment row (music_playlist not named)':
    { ja: 'スライド67「走行環境」の行（プレイリスト再生は挙げられていない）', en: 'Slide 67, the environment row (playlist playback is not named)' },
  'Slide 67 environment row (night -> activation services)':
    { ja: 'スライド67「走行環境」の行（夜間 → 覚醒を促すサービス）', en: 'Slide 67, the environment row (night → activating services)' },
  'Slide 67 environment row (radio_style not named for highway)':
    { ja: 'スライド67「走行環境」の行（高速道路にラジオ風再生は挙げられていない）',
      en: 'Slide 67, the environment row (radio-style playback is not named for highway)' },
  'Slide 67 passenger row (child/group -> shared services)':
    { ja: 'スライド67「同乗者構成」の行（子供・複数人 → みんなで楽しめるサービス）',
      en: 'Slide 67, the passenger row (child or group → shared services)' },
  'Slide 67 passenger row (music_playlist not named)':
    { ja: 'スライド67「同乗者構成」の行（プレイリスト再生は挙げられていない）', en: 'Slide 67, the passenger row (playlist playback is not named)' },
  'Slide 67 passenger row (radio_style not named)':
    { ja: 'スライド67「同乗者構成」の行（ラジオ風再生は挙げられていない）', en: 'Slide 67, the passenger row (radio-style playback is not named)' },
  'Slide 67 route row (interaction games not named)':
    { ja: 'スライド67「特徴的なルート・目的地」の行（参加型のゲームは挙げられていない）',
      en: 'Slide 67, the route row (interactive games are not named)' },
  'Slide 67 route row (music recommendation + humming karaoke)':
    { ja: 'スライド67「特徴的なルート・目的地」の行（音楽レコメンド＋鼻歌カラオケ）',
      en: 'Slide 67, the route row (music recommendation and humming karaoke)' },
  'Slide 67 route row (music recommendation)':
    { ja: 'スライド67「特徴的なルート・目的地」の行（音楽レコメンド）', en: 'Slide 67, the route row (music recommendation)' },
  'Slide 67 route row (radio_style not named)':
    { ja: 'スライド67「特徴的なルート・目的地」の行（ラジオ風再生は挙げられていない）',
      en: 'Slide 67, the route row (radio-style playback is not named)' },
  'Slide 39/67 oshi row - radio_style is THE oshi service (strong response)':
    { ja: 'スライド39・67「推し情報」の行 — ラジオ風再生は推し向けの中心的サービス（強い応答）',
      en: 'Slides 39 and 67, the favourite-artist row — radio-style playback is the core favourite-artist service (strong response)' },
  'Slide 40 defines no oshi content for stretch_video; Slide 67 (1) oshi row omits it':
    { ja: 'スライド40はストレッチ動画の推し向けコンテンツを定義しておらず、スライド67①の「推し情報」の行にも挙げられていない',
      en: 'Slide 40 defines no favourite-artist content for stretch video, and the Slide 67 ① favourite-artist row omits it' },
  'Slide 40 participatory 合いの手 video; mild engagement while recovering':
    { ja: 'スライド40の参加型「合いの手練習」動画。休憩からの回復中の、軽い関与を想定',
      en: 'The participatory call-and-response video of Slide 40 — mild engagement while recovering' },
  'Slide 40 shared, group-friendly recovery activity':
    { ja: 'スライド40の、複数人で楽しめる回復向けアクティビティ', en: 'Slide 40, a shared group-friendly recovery activity' },
  'Slide 67 (1) column names no night response':
    { ja: 'スライド67①の列には夜間の応答が示されていない', en: 'The Slide 67 ① column names no night response' },
  'Slide 67 (1) driver row silent; light engagement while recovering':
    { ja: 'スライド67①の「現在のドライバーの状態」の行は言及なし。休憩からの回復中の、軽い関与を想定',
      en: 'The Slide 67 ① driver-state row is silent; light engagement while recovering' },
  'Slide 67 (1) driver row silent; stretch_video = physical recovery':
    { ja: 'スライド67①の「現在のドライバーの状態」の行は言及なし。ストレッチ動画は身体的な回復を担う',
      en: 'The Slide 67 ① driver-state row is silent; stretch video covers physical recovery' },
  'Slide 67 (1) names 合いの手 in no column; unnamed for destination':
    { ja: 'スライド67①はどの列にも合いの手練習を挙げていない（目的地についても言及なし）',
      en: 'Slide 67 ① names call-and-response practice in no column, including for destination' },
  'Slide 67 (1) names 合いの手 in no column; unnamed for oshi':
    { ja: 'スライド67①はどの列にも合いの手練習を挙げていない（推し情報についても言及なし）',
      en: 'Slide 67 ① names call-and-response practice in no column, including for the favourite artist' },
  'Slide 67 (1) names 合いの手 in no column; unnamed for route':
    { ja: 'スライド67①はどの列にも合いの手練習を挙げていない（ルートについても言及なし）',
      en: 'Slide 67 ① names call-and-response practice in no column, including for route' },
  'Slide 67 (1) oshi row -> live viewing, karaoke, oshi_reexperience':
    { ja: 'スライド67①「推し情報」の行 → ライブビューイング、カラオケ、推し追体験',
      en: 'Slide 67 ①, the favourite-artist row → live viewing, karaoke, favourite-artist re-experience' },
  'Slide 67 (1) oshi row -> oshi_reexperience':
    { ja: 'スライド67①「推し情報」の行 → 推し追体験', en: 'Slide 67 ①, the favourite-artist row → favourite-artist re-experience' },
  'Slide 67 (1) passenger row -> live viewing, karaoke':
    { ja: 'スライド67①「同乗者構成」の行 → ライブビューイング、カラオケ', en: 'Slide 67 ①, the passenger row → live viewing and karaoke' },
  'Slide 67 (1) passenger row omits oshi_reexperience':
    { ja: 'スライド67①「同乗者構成」の行に推し追体験は挙げられていない', en: 'The Slide 67 ① passenger row omits favourite-artist re-experience' },
  'Slide 67 (1) passenger row omits stretch_video':
    { ja: 'スライド67①「同乗者構成」の行にストレッチ動画は挙げられていない', en: 'The Slide 67 ① passenger row omits stretch video' },
  'Slide 67 (1) route row -> oshi_reexperience':
    { ja: 'スライド67①「特徴的なルート・目的地」の行 → 推し追体験', en: 'Slide 67 ①, the route row → favourite-artist re-experience' },
  'Slide 67 (1) route row names only oshi_reexperience':
    { ja: 'スライド67①「特徴的なルート・目的地」の行は推し追体験のみを挙げている',
      en: 'The Slide 67 ① route row names only favourite-artist re-experience' },
  'Demanding road makes high-interaction cognitive load unsafe':
    { ja: '負荷の高い道路では、操作の多いコンテンツは認知負荷が大きく安全でない',
      en: 'A demanding road makes the cognitive load of high-interaction content unsafe' },
  'Demanding road reduces interactive load; low-interaction audio mildly supported':
    { ja: '負荷の高い道路では操作を減らす必要があり、操作の少ない音声コンテンツがやや有利',
      en: 'A demanding road calls for less interaction, mildly favouring low-interaction audio' },
  'Demanding road reduces moderate-interaction suitability':
    { ja: '負荷の高い道路では、中程度の操作を要するコンテンツは適さなくなる',
      en: 'A demanding road reduces the suitability of moderate-interaction content' },
  'Driving/stopped permissibility is eligibility, not response':
    { ja: '走行中・停車中で使えるかどうかは適格性の判定であり、応答係数の対象ではない',
      en: 'Whether a service may run while driving or stopped is an eligibility question, not a response' },
  'Source does not distinguish local road':
    { ja: '出典は一般道を区別していない', en: 'The source does not distinguish local roads' },
}

function citationText(reference: string, lang: UiLanguage): string {
  const known = CITATIONS[reference]
  return known ? t(known, lang) : reference
}

/** Provenance is a closed enum recorded per response cell. */
const PROVENANCE_LABELS: Record<string, { ja: string; en: string }> = {
  cdc_su_explicit: { ja: '仕様書に明記', en: 'Explicit in the specification' },
  cdc_su_direct_candidate_feature: { ja: '仕様書の候補特徴量から算出', en: "From the specification's candidate feature" },
  neutral_source_silent: { ja: '中立（出典なし）', en: 'Neutral, no supporting source' },
  post_rest_hypothesis: { ja: '休憩後の想定に基づく仮説値', en: 'Hypothesis based on post-rest assumptions' },
  normalized_context_hypothesis: { ja: '状況の正規化に基づく仮説値', en: 'Hypothesis based on normalized context' },
}

function provenanceLabel(provenance: string, lang: UiLanguage): string {
  const known = PROVENANCE_LABELS[provenance]
  return known ? t(known, lang) : t({ ja: '出典不明', en: 'Unknown source' }, lang)
}

/** Union of inner row keys across all services (services are uniform in the
 * real manifest, but union keeps this robust to partially-specified profiles). */
function rowKeysOf(value: Profiles): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const service of Object.keys(value)) {
    for (const rk of Object.keys(value[service] ?? {})) {
      if (!seen.has(rk)) {
        seen.add(rk)
        ordered.push(rk)
      }
    }
  }
  return ordered
}

// The default is the APP's default language, not English. A caller that
// forgets the prop then degrades to the language the rest of the screen is
// already in, rather than dropping English headers into a Japanese panel —
// which is exactly the bug that reached the Combined screen's setup popups.
export default function ResponseMatrixTable({ value, onChange, cornerLabel = '', lang = 'ja' }: ResponseMatrixTableProps) {
  const services = Object.keys(value)
  const rows = rowKeysOf(value)

  function editCell(service: string, row: string, raw: string) {
    const n = Number(raw)
    const prev = value[service]?.[row] ?? {}
    // Immutable update — replace ONLY this cell's coefficient, keep everything else.
    onChange({
      ...value,
      [service]: {
        ...value[service],
        [row]: { ...prev, coefficient: Number.isNaN(n) ? prev.coefficient : n },
      },
    })
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={mtxTableStyle}>
        <thead>
          <tr>
            <th style={mtxCornerStyle}>{cornerLabel}</th>
            {services.map((s) => (
              <th key={s} style={mtxThStyle}>
                {t(serviceLabel(s), lang)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th scope="row" style={mtxRowLabelStyle}>
                {rowLabel(row, lang)}
              </th>
              {services.map((s) => {
                const cell = value[s]?.[row] ?? {}
                const title = cell.provenance
                  ? [provenanceLabel(cell.provenance, lang), cell.source_reference && citationText(cell.source_reference, lang)].filter(Boolean).join(' — ')
                  : ''
                return (
                  <td key={s} style={mtxTdStyle} title={title || undefined}>
                    <input
                      style={mtxInputStyle}
                      data-testid={`resp-cell-${s}-${row}`}
                      value={String(cell.coefficient ?? '')}
                      onChange={(e) => editCell(s, row, e.target.value)}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
