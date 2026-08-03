/**
 * HierarchyWeightsTable — dedicated editor for the `hierarchy_weights`
 * hyperparameter, shaped:
 *
 *   { Category: { share, subgroups: { Subgroup: { share, leaves: { Leaf: { share } } } } } }
 *
 * Renders the mockup's `hierarchy_weights` grammar (ui-mockup.html §6.1) as ONE
 * clean grouped table — Category / share / Subgroup / share / Leaf / share —
 * with `rowspan` grouping. Unlike the mockup (which turns leaves into read-only
 * text and shows only the subgroup share), EVERY share at all three levels is a
 * live editable input: the real, fully-editable data in the mockup's layout.
 */
import { t } from '../../i18n/t'
import type { UiLanguage } from '../../i18n/t'
import { mtxTableStyle, mtxThStyle, mtxTdStyle, mtxRowLabelStyle, mtxInputStyle } from './matrixStyles'
import { fieldName, nodeLabel } from '../../lib/review/reviewVocabulary'

type Leaf = { share?: number }
type Subgroup = { share?: number; leaves?: Record<string, Leaf> }
type Category = { share?: number; subgroups?: Record<string, Subgroup> }
type Hierarchy = Record<string, Category>

const LABELS = {
  category: { ja: 'カテゴリ', en: 'category' },
  share: { ja: '割合', en: 'share' },
  subgroup: { ja: 'サブグループ', en: 'subgroup' },
  leaf: { ja: 'リーフ', en: 'leaf' },
}

export type HierarchyWeightsTableProps = {
  value: Hierarchy
  onChange: (next: Hierarchy) => void
  lang?: UiLanguage
}

function num(raw: string, prev: number | undefined): number | undefined {
  const n = Number(raw)
  return Number.isNaN(n) ? prev : n
}

// The default is the APP's default language, not English. A caller that
// forgets the prop then degrades to the language the rest of the screen is
// already in, rather than dropping English headers into a Japanese panel —
// which is exactly the bug that reached the Combined screen's setup popups.
export default function HierarchyWeightsTable({ value, onChange, lang = 'ja' }: HierarchyWeightsTableProps) {
  function setCategoryShare(cat: string, raw: string) {
    onChange({ ...value, [cat]: { ...value[cat], share: num(raw, value[cat]?.share) } })
  }
  function setSubgroupShare(cat: string, sub: string, raw: string) {
    const subgroups = value[cat]?.subgroups ?? {}
    onChange({
      ...value,
      [cat]: {
        ...value[cat],
        subgroups: { ...subgroups, [sub]: { ...subgroups[sub], share: num(raw, subgroups[sub]?.share) } },
      },
    })
  }
  function setLeafShare(cat: string, sub: string, leaf: string, raw: string) {
    const subgroups = value[cat]?.subgroups ?? {}
    const leaves = subgroups[sub]?.leaves ?? {}
    onChange({
      ...value,
      [cat]: {
        ...value[cat],
        subgroups: {
          ...subgroups,
          [sub]: {
            ...subgroups[sub],
            leaves: { ...leaves, [leaf]: { ...leaves[leaf], share: num(raw, leaves[leaf]?.share) } },
          },
        },
      },
    })
  }

  const shareInput = (v: number | undefined, onEdit: (raw: string) => void, testid: string) => (
    <input style={mtxInputStyle} data-testid={testid} value={String(v ?? '')} onChange={(e) => onEdit(e.target.value)} />
  )

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={mtxTableStyle}>
        <thead>
          <tr>
            <th style={mtxThStyle}>{t(LABELS.category, lang)}</th>
            <th style={mtxThStyle}>{t(LABELS.share, lang)}</th>
            <th style={mtxThStyle}>{t(LABELS.subgroup, lang)}</th>
            <th style={mtxThStyle}>{t(LABELS.share, lang)}</th>
            <th style={mtxThStyle}>{t(LABELS.leaf, lang)}</th>
            <th style={mtxThStyle}>{t(LABELS.share, lang)}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(value).map(([cat, catVal]) => {
            const subgroups = catVal.subgroups ?? {}
            // Total rows this category spans = sum of each subgroup's leaf count (min 1).
            const catRowSpan = Object.values(subgroups).reduce(
              (acc, sg) => acc + Math.max(1, Object.keys(sg.leaves ?? {}).length),
              0,
            )
            let catCellEmitted = false
            return Object.entries(subgroups).map(([sub, subVal]) => {
              const leafEntries = Object.entries(subVal.leaves ?? {})
              const subRowSpan = Math.max(1, leafEntries.length)
              const rowsForSub = leafEntries.length > 0 ? leafEntries : [['—', {} as Leaf] as [string, Leaf]]
              let subCellEmitted = false
              return rowsForSub.map(([leaf, leafVal]) => {
                const cells = []
                if (!catCellEmitted) {
                  catCellEmitted = true
                  cells.push(
                    <th key="cat" scope="row" rowSpan={catRowSpan} style={mtxRowLabelStyle}>
                      {t(nodeLabel(cat), lang)}
                    </th>,
                    <td key="catshare" rowSpan={catRowSpan} style={mtxTdStyle}>
                      {shareInput(catVal.share, (raw) => setCategoryShare(cat, raw), `hw-cat-${cat}`)}
                    </td>,
                  )
                }
                if (!subCellEmitted) {
                  subCellEmitted = true
                  cells.push(
                    <th key="sub" scope="row" rowSpan={subRowSpan} style={mtxRowLabelStyle}>
                      {t(nodeLabel(sub), lang)}
                    </th>,
                    <td key="subshare" rowSpan={subRowSpan} style={mtxTdStyle}>
                      {shareInput(subVal.share, (raw) => setSubgroupShare(cat, sub, raw), `hw-sub-${sub}`)}
                    </td>,
                  )
                }
                cells.push(
                  <td key="leaf" style={{ ...mtxTdStyle, textAlign: 'left' }}>
                    {leaf === '—' ? leaf : t(fieldName(leaf), lang)}
                  </td>,
                  <td key="leafshare" style={mtxTdStyle}>
                    {leaf === '—'
                      ? '—'
                      : shareInput(leafVal.share, (raw) => setLeafShare(cat, sub, leaf, raw), `hw-leaf-${leaf}`)}
                  </td>,
                )
                return <tr key={`${cat}/${sub}/${leaf}`}>{cells}</tr>
              })
            })
          })}
        </tbody>
      </table>
    </div>
  )
}
