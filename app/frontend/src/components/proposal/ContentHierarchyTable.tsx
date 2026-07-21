/**
 * ContentHierarchyTable — dedicated editor for the CONTENT selector's
 * `hierarchy_weights`, shaped `{ Category: { subgroup: { share, leaves: {
 * leaf: { share, mask, feature_id } } } } }` (note: no category-level share and
 * no `subgroups` wrapper — this differs from the service hierarchy shape).
 *
 * Renders the mockup's grammar (ui-mockup.html §6.1, panel ③): one row per
 * `Category·subgroup` with an editable subgroup `share` and a compact
 * `leaves (share·mask)` text summary — instead of the generic renderer's deep
 * nested tables. Leaf detail stays visible (as text) but isn't individually
 * editable, matching the mockup.
 */
import { t } from '../../i18n/t'
import type { UiLanguage } from '../../i18n/t'
import { mtxTableStyle, mtxThStyle, mtxTdStyle, mtxRowLabelStyle } from './matrixStyles'

type Leaf = { share?: number; mask?: number; feature_id?: string }
type Subgroup = { share?: number; leaves?: Record<string, Leaf> }
type Category = Record<string, Subgroup>
type Hierarchy = Record<string, Category>

const LABELS = {
  subgroup: { ja: 'サブグループ', en: 'subgroup' },
  share: { ja: '割合', en: 'share' },
  leaves: { ja: 'リーフ (割合・マスク)', en: 'leaves (share·mask)' },
}

export type ContentHierarchyTableProps = {
  value: Hierarchy
  onChange: (next: Hierarchy) => void
  lang?: UiLanguage
}

function leavesText(sub: Subgroup): string {
  const leaves = sub.leaves ?? {}
  const parts = Object.entries(leaves).map(([leaf, lv]) => {
    const share = lv.share ?? 0
    return lv.mask === undefined ? `${leaf} ${share}` : `${leaf} ${share}·${lv.mask}`
  })
  return parts.join(' / ') || '—'
}

export default function ContentHierarchyTable({ value, onChange, lang = 'en' }: ContentHierarchyTableProps) {
  function setSubgroupShare(cat: string, sub: string, raw: string) {
    const n = Number(raw)
    const prev = value[cat]?.[sub] ?? {}
    onChange({
      ...value,
      [cat]: { ...value[cat], [sub]: { ...prev, share: Number.isNaN(n) ? prev.share : n } },
    })
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={mtxTableStyle}>
        <thead>
          <tr>
            <th style={{ ...mtxThStyle, textAlign: 'left' }}>{t(LABELS.subgroup, lang)}</th>
            <th style={mtxThStyle}>{t(LABELS.share, lang)}</th>
            <th style={{ ...mtxThStyle, textAlign: 'left' }}>{t(LABELS.leaves, lang)}</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(value).flatMap(([cat, subs]) =>
            Object.entries(subs).map(([sub, subVal]) => (
              <tr key={`${cat}/${sub}`}>
                <th scope="row" style={mtxRowLabelStyle}>
                  {cat}·{sub}
                </th>
                <td style={mtxTdStyle}>
                  <input
                    style={{ width: '56px', textAlign: 'center', padding: '2px 4px', border: '1px solid #e5e7eb', background: '#fff', borderRadius: '4px' }}
                    data-testid={`chw-share-${cat}-${sub}`}
                    value={String(subVal.share ?? '')}
                    onChange={(e) => setSubgroupShare(cat, sub, e.target.value)}
                  />
                </td>
                <td style={{ ...mtxTdStyle, textAlign: 'left', color: '#6b7280', whiteSpace: 'normal' }}>
                  {leavesText(subVal)}
                </td>
              </tr>
            )),
          )}
        </tbody>
      </table>
    </div>
  )
}
