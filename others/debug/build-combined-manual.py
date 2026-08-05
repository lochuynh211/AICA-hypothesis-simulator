# others/debug/build-combined-manual.py
# Assembles the self-contained JA combined-screen manual by inlining the C-02
# screenshots as base64 data URIs into an HTML template that mirrors the two
# existing manuals' CSS/structure. NOT shipped; debug/build tool only.
#
#   python others/debug/build-combined-manual.py
#
# SECURITY: no Google Maps key is read or written here. The screenshots were
# captured at runtime with a BYO key; the key never enters this file or output.
import base64
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SHOTS = os.path.join(ROOT, "others", "debug", "combined-shots")
OUT = os.path.join(ROOT, "docs", "manual", "aica-simulator-combined-manual-ja.html")


def data_uri(name):
    with open(os.path.join(SHOTS, name), "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    return "data:image/png;base64," + b64


def fig(num, name, caption, tag="図", narrow=False, cls=""):
    """Render a <figure> with an inlined image."""
    uri = data_uri(name)
    klass = " ".join(x for x in [("narrow" if narrow else ""), cls] if x)
    klass_attr = f' class="{klass}"' if klass else ""
    return (
        f'<figure{klass_attr}>'
        f'<img alt="{caption}" src="{uri}">'
        f'<figcaption><span class="tag">{tag}{num}</span> {caption}</figcaption>'
        f"</figure>"
    )


HEAD = """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AICA 仮説シミュレーター 操作マニュアル（統合画面・通しレビュー編）</title>
<style>
:root{
  --ink:#1f2937; --muted:#6b7280; --line:#e5e7eb; --bg:#ffffff; --soft:#f8fafc;
  --brand:#0891b2; --brand-dark:#0e7490; --accent:#4f46e5;
  --warn-bg:#fffbeb; --warn-line:#f59e0b; --warn-ink:#92400e;
  --use-bg:#ecfeff; --use-line:#0891b2; --maxw:940px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{
  margin:0; color:var(--ink); background:var(--soft);
  font-family:"Hiragino Kaku Gothic ProN","Hiragino Sans","Noto Sans JP","Yu Gothic",Meiryo,system-ui,sans-serif;
  line-height:1.75; font-size:16px;
}
.layout{display:flex; align-items:flex-start; max-width:1240px; margin:0 auto; background:var(--bg); box-shadow:0 0 0 1px var(--line);}
nav.sidebar{
  position:sticky; top:0; align-self:flex-start; flex:none; width:264px; height:100vh; overflow-y:auto;
  padding:26px 14px 40px 22px; border-right:1px solid var(--line); background:var(--soft); font-size:.86rem;
}
nav.sidebar .brand{font-weight:800; font-size:.95rem; letter-spacing:.02em; color:var(--brand-dark); margin-bottom:2px}
nav.sidebar .brand small{display:block; font-weight:600; color:var(--muted); font-size:.78rem; letter-spacing:0}
nav.sidebar ol{counter-reset:navc; list-style:none; margin:16px 0 0; padding:0}
nav.sidebar li{margin:0}
nav.sidebar a{display:block; padding:5px 8px; border-radius:7px; color:var(--ink); text-decoration:none;}
nav.sidebar a::before{counter-increment:navc; content:counter(navc) ". "; color:var(--brand); font-variant-numeric:tabular-nums; font-weight:700}
nav.sidebar a:hover{background:#e0f2fe}
nav.sidebar a.practice{color:var(--brand-dark); font-weight:700}
nav.sidebar a.appendix::before{content:"付 "; }
.wrap{flex:1; min-width:0; background:var(--bg); padding:0 clamp(16px,3.5vw,48px) 80px;}
header.cover{
  background:linear-gradient(135deg,#083344,#4f46e5); color:#fff;
  margin:0 calc(-1 * clamp(16px,4vw,48px)); padding:48px clamp(16px,4vw,48px) 40px;
}
header.cover .kicker{letter-spacing:.14em; text-transform:uppercase; color:#a5f3fc; font-size:.78rem; font-weight:700}
header.cover h1{margin:.3em 0 .3em; font-size:clamp(1.6rem,3.4vw,2.3rem); line-height:1.3}
header.cover p{margin:.2em 0 0; color:#e0e7ff; max-width:var(--maxw)}
header.cover .badges{margin-top:18px; display:flex; flex-wrap:wrap; gap:8px}
header.cover .badges span{background:rgba(255,255,255,.12); border:1px solid rgba(255,255,255,.22); padding:4px 12px; border-radius:999px; font-size:.78rem}
p.lead{font-size:1.05rem; color:#334155; margin:1.6em 0 0; max-width:var(--maxw)}
.toc{margin:22px 0 0; padding:16px 20px; background:var(--soft); border:1px solid var(--line); border-radius:12px}
.toc b{display:block; font-size:.82rem; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); margin-bottom:8px}
.toc ol{margin:0; padding-left:1.3em; columns:2; column-gap:28px}
.toc a{color:var(--brand-dark); text-decoration:none}
.toc a:hover{text-decoration:underline}
h2{font-size:1.35rem; margin:2.4em 0 .2em; padding-top:.5em; border-top:2px solid var(--ink); scroll-margin-top:16px;}
h2 .num{color:var(--brand); font-variant-numeric:tabular-nums; margin-right:.4em}
h2 .num.ap{color:var(--accent)}
h3{font-size:1.08rem; margin:1.7em 0 .2em; color:var(--brand-dark); scroll-margin-top:16px}
h4{font-size:.98rem; margin:1.3em 0 .1em; color:var(--ink)}
p{margin:.6em 0}
figure{margin:20px 0}
figure img{
  display:block; width:100%; height:auto; border:1px solid var(--line); border-radius:10px;
  box-shadow:0 6px 22px -12px rgba(15,23,42,.4); background:#fff; cursor:zoom-in; transition:filter .12s
}
figure img:hover{filter:brightness(1.02)}
figure.narrow img{max-width:560px; margin:0 auto}
figcaption{margin-top:8px; font-size:.82rem; color:var(--muted); text-align:center}
figcaption .tag{display:inline-block; background:#e0f2fe; color:#0e7490; font-weight:700; padding:1px 8px; border-radius:6px; margin-right:6px}
.scroll{overflow-x:auto; margin:16px 0}
table{border-collapse:collapse; width:100%; font-size:.9rem}
th,td{border:1px solid var(--line); padding:8px 11px; text-align:left; vertical-align:top}
th{background:#f1f5f9; font-weight:700; white-space:nowrap}
tbody tr:nth-child(even){background:#fbfdff}
.callout{border:1px solid var(--line); border-left-width:5px; border-radius:8px; padding:12px 16px; margin:18px 0}
.callout .h{font-weight:700; margin-bottom:2px}
.callout.use{background:var(--use-bg); border-left-color:var(--use-line)}
.callout.use .h{color:var(--brand-dark)}
.callout.note{background:var(--warn-bg); border-left-color:var(--warn-line)}
.callout.note .h{color:var(--warn-ink)}
.steps{counter-reset:s; list-style:none; margin:18px 0; padding:0}
.steps>li{position:relative; padding:2px 0 14px 42px}
.steps>li::before{
  counter-increment:s; content:counter(s); position:absolute; left:0; top:0;
  width:28px; height:28px; border-radius:50%; background:var(--brand); color:#fff;
  display:flex; align-items:center; justify-content:center; font-weight:700; font-size:.9rem
}
.steps>li:not(:last-child)::after{content:""; position:absolute; left:13px; top:30px; bottom:2px; width:2px; background:var(--line)}
.steps>li b{color:var(--ink)}
.pill{display:inline-block; padding:1px 8px; border-radius:999px; font-size:.78rem; font-weight:700; border:1px solid}
.pill.lock{background:#fef9c3; border-color:#eab308; color:#854d0e}
.pill.new{background:#dcfce7; border-color:#22c55e; color:#166534}
.two{display:grid; grid-template-columns:1fr 1fr; gap:18px}
.two figure{margin:0}
hr.soft{border:0; border-top:1px solid var(--line); margin:2.4em 0}
kbd{background:#f1f5f9; border:1px solid #cbd5e1; border-bottom-width:2px; border-radius:5px; padding:1px 6px; font-size:.82rem; font-family:inherit}
footer{margin-top:3em; padding-top:1.4em; border-top:1px solid var(--line); color:var(--muted); font-size:.86rem}
.lightbox{position:fixed; inset:0; z-index:1000; display:none; align-items:center; justify-content:center; background:rgba(8,20,30,.93); padding:24px; cursor:zoom-out;}
.lightbox.open{display:flex}
.lightbox img{max-width:96vw; max-height:92vh; border-radius:8px; box-shadow:0 20px 60px -10px rgba(0,0,0,.6)}
.lb-close{position:fixed; top:14px; right:22px; color:#fff; font-size:32px; line-height:1; cursor:pointer; opacity:.85}
.lb-close:hover{opacity:1}
.lb-hint{position:fixed; bottom:16px; left:0; right:0; text-align:center; color:#cbd5e1; font-size:.82rem}
@media(max-width:900px){
  nav.sidebar{display:none}
  .layout{display:block}
  .two{grid-template-columns:1fr}
  .toc ol{columns:1}
}
</style>
</head>
<body>
<div class="layout">
<nav class="sidebar">
  <div class="brand">AICA 仮説シミュレーター<small>統合画面・通しレビュー編</small></div>
  <ol>
    <li><a href="#s1">画面の全体像とワークフロー</a></li>
    <li><a href="#s2">テストケースの選び方</a></li>
    <li><a href="#s3">左パネル — ケースとセットアップ</a></li>
    <li><a href="#s4">中央パネル — 再生・地図・提案</a></li>
    <li><a href="#s5">右パネル — レビュー3タブ</a></li>
    <li><a href="#s6" class="practice">【実践】通しでレビューする</a></li>
    <li><a href="#sA" class="appendix">アルゴリズムの変更点</a></li>
    <li><a href="#sB" class="appendix">リカバリーのやさしい解説</a></li>
  </ol>
</nav>
<div class="wrap">
"""

FOOT = """
<footer>
  <p>AICA 仮説シミュレーター 操作マニュアル（統合画面・通しレビュー編）。画面は日本語表示・題材テストケース <b>C-02 夜間高速道路・眠気の高まり</b> の実キャプチャです。地図は実際の Google マップ表示です。各図はクリックで拡大できます。</p>
</footer>

</div><!-- /.wrap -->
</div><!-- /.layout -->

<!-- Click-to-zoom lightbox: click any figure image to view it enlarged. -->
<div class="lightbox" id="lightbox" aria-hidden="true" role="dialog" aria-label="拡大画像">
  <span class="lb-close" aria-label="閉じる">&times;</span>
  <img alt="">
  <div class="lb-hint">画像・背景クリック、または Esc キーで閉じる</div>
</div>
<script>
(function(){
  var lb = document.getElementById('lightbox');
  var lbImg = lb.querySelector('img');
  function open(src, alt){ lbImg.src = src; lbImg.alt = alt || ''; lb.classList.add('open'); lb.setAttribute('aria-hidden','false'); }
  function close(){ lb.classList.remove('open'); lb.setAttribute('aria-hidden','true'); lbImg.removeAttribute('src'); }
  var imgs = document.querySelectorAll('figure img');
  for (var i=0;i<imgs.length;i++){
    imgs[i].addEventListener('click', function(){ open(this.currentSrc || this.src, this.alt); });
  }
  lb.addEventListener('click', close);
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' || e.key === 'Esc') close(); });
})();
</script>
</body>
</html>
"""


def build():
    parts = [HEAD]

    # ── Cover ──────────────────────────────────────────────────────────
    parts.append("""
<header class="cover">
  <div class="kicker">AICA Hypothesis Simulator &middot; Combined Screen</div>
  <h1>統合（Combined）画面 操作マニュアル<br>― 1つのケースを「発火 → サービス → コンテンツ」まで通しでレビューする ―</h1>
  <p>このマニュアルは、AICA 仮説シミュレーターの「統合（Combined）」画面の使い方を、画面のスクリーンショットと一緒に、はじめての方にもわかるように説明します。題材は <b>C-02 夜間高速道路・眠気の高まり</b> です。</p>
  <div class="badges">
    <span>対象：レビュー担当者・企画・非エンジニア</span>
    <span>題材：C-02 夜間高速・眠気</span>
    <span>画面：統合（Combined）</span>
    <span>図はクリックで拡大</span>
  </div>
</header>

<p class="lead">「統合」画面は、<b>1件のテストケースを選ぶだけ</b>で、AICA が「いつ声をかけるか（発火）」「何を提案するか（サービス）」「どの曲・コンテンツを選ぶか（コンテンツ）」という一連の流れを、<b>1つの画面で通して</b>確認できる画面です。本書はその画面を、実際に C-02 を走らせながら順番に読んでいきます。</p>

<div class="toc">
  <b>目次</b>
  <ol>
    <li><a href="#s1">画面の全体像とワークフロー</a></li>
    <li><a href="#s2">テストケースの選び方</a></li>
    <li><a href="#s3">左パネル — ケースとセットアップ</a></li>
    <li><a href="#s4">中央パネル — 再生・地図・提案の流れ</a></li>
    <li><a href="#s5">右パネル — レビュー（発火判定・サービス・コンテンツ）</a></li>
    <li><a href="#s6">【実践】C-02 を通しでレビューする</a></li>
    <li><a href="#sA">付録A：アルゴリズムの変更点</a></li>
    <li><a href="#sB">付録B：リカバリー（回復）のやさしい解説</a></li>
  </ol>
</div>
""")

    # ── S1 全体像 ───────────────────────────────────────────────────────
    parts.append("""
<h2 id="s1"><span class="num">1</span>画面の全体像とワークフロー</h2>
<p>まず画面ぜんたいを見てみましょう。上のメニューで <b>統合</b> を選ぶと、この 3 つのパネルが横に並んだ画面になります。</p>
""")
    parts.append(fig(1, "01-c02-overview.png",
                     "統合画面の全体。左＝ケース選択とセットアップ／中央＝地図と再生／右＝レビュー3タブ。地図は実際の Google マップ（東京→大阪）です。"))
    parts.append("""
<p>画面は左から右へ、レビューの流れと同じ順番に並んでいます。</p>
<div class="scroll"><table>
  <thead><tr><th>パネル</th><th>役割</th><th>ここで何をする？</th></tr></thead>
  <tbody>
    <tr><td><b>左パネル</b></td><td>テストケースの選択と、走らせる条件のセットアップ</td><td>「どんな状況のドライバーを試すか」を決める</td></tr>
    <tr><td><b>中央パネル</b></td><td>地図・再生コントロール・提案の表示</td><td>時間を進めて、AICA が声をかける瞬間を見る</td></tr>
    <tr><td><b>右パネル</b></td><td>レビュー（発火判定・サービス・コンテンツの3タブ）</td><td>「なぜそう判断したか」を読む・記録する</td></tr>
  </tbody>
</table></div>

<div class="callout use">
  <div class="h">💡 統合画面のいちばんの利点</div>
  <div>これまで別々の画面で見ていた「発火の判定」「サービス提案」「コンテンツ（曲）選び」を、<b>1件のケースで、途中で画面を移動せずに</b>最後まで確認できます。レビューの手戻りが減ります。</div>
</div>

<h3>ライブ と 実行履歴</h3>
<p>画面の上部には <b>ライブ</b> と <b>実行履歴</b> の切り替えがあります。ふだんのレビューは <b>ライブ</b>（その場で走らせて見る）を使います。<b>実行履歴</b> は、過去に記録した走行を後から読み返すための読み取り専用ビューです。</p>
""")

    # ── S2 ケース選択 ───────────────────────────────────────────────────
    parts.append("""
<h2 id="s2"><span class="num">2</span>テストケースの選び方</h2>
<p>統合画面では、まず <b>テストケース</b>（試す状況のセット）を1つ選びます。本書では <b>C-02 夜間高速道路・眠気の高まり</b> を使います。選ぶと、ケースの内容が「ケースカード」に表示されます。</p>
""")
    parts.append(fig(2, "02b-case-card.png",
                     "C-02 のケースカード。注目点・ドライバー・目的・嗜好・制約・前提が、レビュー前に一目で読めます。", narrow=True))
    parts.append("""
<p>ケースカードは、そのケースが「何を試したいのか」を短くまとめたものです。次の観点で読むと、あとのレビューがぐっと分かりやすくなります。</p>
<div class="scroll"><table>
  <thead><tr><th>見出し</th><th>読み方</th></tr></thead>
  <tbody>
    <tr><td><b>注目点</b></td><td>このケースで特に見てほしいポイント（例：夜間に眠気がどう高まるか）。</td></tr>
    <tr><td><b>ドライバー</b></td><td>運転者の設定（年齢層・運転の慣れなど）。</td></tr>
    <tr><td><b>目的 / 嗜好</b></td><td>移動の目的や、好きな音楽・アーティストなどの好み。</td></tr>
    <tr><td><b>制約 / 前提</b></td><td>時間帯・同乗者・天候など、結果を左右する条件。</td></tr>
  </tbody>
</table></div>
<div class="callout use">
  <div class="h">💡 まずケースカードを読む</div>
  <div>いきなり再生を押す前に、ケースカードの<b>注目点</b>を1行読んでおくと、「AICA が何を見て・いつ声をかけたか」の答え合わせがしやすくなります。</div>
</div>
""")

    # ── S3 左パネル ─────────────────────────────────────────────────────
    parts.append("""
<h2 id="s3"><span class="num">3</span>左パネル — ケースとセットアップ</h2>
<p>左パネルは上から、ケースカード → <b>このケースが固定する条件</b> → セットアップ（A・B・C の3群）の順に並びます。</p>
""")
    parts.append(fig(3, "02-left-panel.png",
                     "左パネル全体。ケースカードの下に、セットアップ項目が並びます。", narrow=True))
    parts.append(fig(4, "02c-case-fixed.png",
                     "「このケースが固定する条件」。C-02 では 夜間 ON・初期眠気が高め・東京→大阪・トリガーは NRI などが固定されています。", narrow=True))
    parts.append("""
<div class="callout note">
  <div class="h">⚠ 「固定」された条件は変えられません</div>
  <div>ケースが固定する条件（例：夜間 ON）は、そのケースの前提そのものなので変更できません <span class="pill lock">固定</span>。ここを変えたい場合は別のケースを選びます。固定されていない項目だけが調整できます。</div>
</div>

<h3>A・B・C の3つのセットアップ群</h3>
<div class="scroll"><table>
  <thead><tr><th>群</th><th>名前</th><th>意味（かんたんに）</th></tr></thead>
  <tbody>
    <tr><td><b>A</b></td><td>固定条件</td><td>夜間・慣れた道・子供同乗・天候リスクなど、走行ぜんたいの前提。</td></tr>
    <tr><td><b>B</b></td><td>道路種別ごとのライブ速度</td><td>高速・一般道など、道路の種類ごとの走行スピード。</td></tr>
    <tr><td><b>C</b></td><td>シミュレートされたドライバー状態</td><td>出発時の <b>初期眠気レベル</b> や <b>初期疲労度</b> など、運転者の状態。</td></tr>
  </tbody>
</table></div>

<p>各セットアップは、鉛筆アイコン（編集）を押すとポップアップで詳しく設定できます。ポップアップ内の <b>▸ 詳細設定</b> を開くと、さらに細かい項目が現れます。</p>
""")
    parts.append(fig(5, "A1-situation-detailed.png",
                     "状況の編集ポップアップ（詳細設定を開いた状態）。A・B・C の各条件をここで調整します。"))
    parts.append("""
<div class="callout use">
  <div class="h">💡 渋滞・山道をルート上に描ける</div>
  <div>詳細設定の中の「ルート条件ペインター」で、<b>渋滞区間</b>や<b>山道区間</b>を距離（km）で指定してルート上に描けます。渋滞や山道があると眠気・疲労やトリガーの効き方がどう変わるかを試せます（詳しくは付録A）。</div>
</div>
""")
    parts.append(fig(6, "A1b-route-painter.png",
                     "ルート条件ペインター。山道区間・渋滞区間を km レンジで指定し、渋滞時の速度も設定できます。", narrow=True))
    parts.append("""
<div class="callout note">
  <div class="h">⚠ ティック時間は最初に決める</div>
  <div>「ティック時間」（シミュレーションの時間の刻み）は、<b>走らせ始めると変更できません</b> <span class="pill lock">固定</span>。粒度を変えたいときは、走らせる前に設定しておきます。</div>
</div>
""")

    # ── S4 中央パネル ───────────────────────────────────────────────────
    parts.append("""
<h2 id="s4"><span class="num">4</span>中央パネル — 再生・地図・提案の流れ</h2>
<p>中央パネルは、時間を進めながら AICA の動きを見るところです。実際の Google マップの上を車が進み、条件がそろうと AICA が画面に提案を出します。</p>
""")
    parts.append(fig(7, "03-center-panel.png",
                     "中央パネル。上部に再生コントロール、その下に地図、下にクイックビュー（状態スコアの推移）。", narrow=True))
    parts.append("""
<h3>再生コントロール</h3>
<div class="scroll"><table>
  <thead><tr><th>ボタン</th><th>はたらき</th></tr></thead>
  <tbody>
    <tr><td><b>再生 / 一時停止</b></td><td>時間を自動で進める／止める。</td></tr>
    <tr><td><b>ステップ</b></td><td>1ティックずつ、少しだけ進める（要所をていねいに見るとき）。</td></tr>
    <tr><td><b>リセット</b></td><td>最初の状態に戻す。</td></tr>
    <tr><td><b>速度（1× / 4× など）</b></td><td>再生スピード。発火点まで早送りしたいときは 4× が便利。</td></tr>
  </tbody>
</table></div>
""")
    parts.append(fig(8, "03b-map-surface.png",
                     "地図（実 Google マップ）。東京→大阪のルートと、車の現在地・休憩候補などが表示されます。"))
    parts.append("""
<h3>クイックビュー（状態スコアの推移）</h3>
<p>地図の下の帯グラフが「クイックビュー」です。走行にそって<b>状態スコアがどう動くか</b>を先読みで示します。C-02 では NRI という指標の曲線が表示され、しきい値（線）を超えたところで提案が出ます。</p>
""")
    parts.append(fig(9, "03c-quickview-nri.png",
                     "クイックビュー（NRI）。スコアがまず低い方のしきい値（単調性）を、さらに上がって休憩（安全）のしきい値を超えます。", narrow=True))
    parts.append("""
<h3>発火したときのガイド付き表示</h3>
<p>条件がそろって AICA が声をかけると、地図の上に<b>ガイド付きのオーバーレイ</b>が現れ、「休憩の提案 → サービス → コンテンツ」の順に案内します。</p>
""")
    parts.append(fig(10, "05-proposal-fired-full.png",
                     "提案が発火した瞬間の全体。中央にガイド付きオーバーレイ（例：鼻歌カラオケ）、右にレビューが更新されます。"))
    parts.append(fig(11, "05b-center-at-fire.png",
                     "発火時の中央パネル。地図上に提案の内容と、受諾・却下などの選択が表示されます。", narrow=True))

    # ── S5 右パネル ─────────────────────────────────────────────────────
    parts.append("""
<h2 id="s5"><span class="num">5</span>右パネル — レビュー（発火判定・サービス・コンテンツ）</h2>
<p>右パネルは、AICA の判断の「なぜ」を読むところです。上に <b>発火判定 / サービス / コンテンツ</b> の3つのタブがあります。</p>
""")
    parts.append(fig(12, "04-review-column.png",
                     "レビュー列。「選ばれた理由」のスコアと、「何が決め手だったか」の寄与（プラス／マイナス）が読めます。", narrow=True))
    parts.append("""
<div class="scroll"><table>
  <thead><tr><th>タブ</th><th>読むもの</th></tr></thead>
  <tbody>
    <tr><td><b>発火判定</b></td><td>「いつ・なぜ声をかけたか（かけなかったか）」。スコアがどのしきい値を超えたか。</td></tr>
    <tr><td><b>サービス</b></td><td>提案した休憩・サービスの内容と、その根拠。</td></tr>
    <tr><td><b>コンテンツ</b></td><td>選ばれた曲・コンテンツと、その選定理由（好み・推しなど）。</td></tr>
  </tbody>
</table></div>

<h3>「選ばれた理由」と「何が決め手だったか」</h3>
<p>各タブには、判断の<b>合計スコア</b>と、それを押し上げた／押し下げた要素の<b>寄与の棒グラフ</b>が並びます。プラスの棒は「提案を後押しした要素」、マイナスの棒は「ブレーキになった要素」です。</p>
""")
    parts.append(fig(13, "05d-review-at-fire.png",
                     "発火時のレビュー。しきい値（例：60点）を合計スコアが超えており、寄与の内訳が確認できます。", narrow=True))
    parts.append("""
<div class="callout use">
  <div class="h">💡 数値ではなく「帯」で判断している</div>
  <div>AICA は「眠気 0.73」のような生の数値でそのまま判断せず、いったん「高い／中／低い」といった<b>帯（バンド）</b>に直してから判断します。だからレビューでも、細かい小数ではなく<b>どの帯に入ったか</b>を見るのがコツです。</div>
</div>
""")

    # ── S6 実践 ─────────────────────────────────────────────────────────
    parts.append("""
<h2 id="s6"><span class="num">6</span>【実践】C-02 を通しでレビューする</h2>
<p>ここまでの各パネルを、実際の操作順にひとつながりでたどります。この手順どおりに押していけば、1件のレビューが完了します。</p>
<ol class="steps">
  <li><b>C-02 を選ぶ</b>：左パネルのケース選択で「C-02 夜間高速道路・眠気の高まり」を選び、ケースカードの<b>注目点</b>を読む。</li>
  <li><b>条件を確認する</b>：「このケースが固定する条件」（夜間 ON・初期眠気が高め・東京→大阪・NRI）を確認。必要なら固定されていない項目だけ調整する。</li>
  <li><b>4× で再生する</b>：中央の再生を押し、速度 4× で発火点まで進める。クイックビューの曲線がしきい値に近づくのを見る。</li>
  <li><b>発火をとらえる</b>：AICA が休憩を提案してガイド付きオーバーレイが出たら、右の<b>発火判定</b>タブで「どのスコアがどのしきい値を超えて出たか」を確認する。</li>
  <li><b>休憩を受諾する</b>：提案された休憩地点を選んで受諾する。地図上でルートが休憩地点へ向かう。</li>
  <li><b>サービスとコンテンツを見る</b>：右の<b>サービス</b>・<b>コンテンツ</b>タブで、提案された内容と選定理由（好み・推し）を読む。</li>
  <li><b>回復を見る</b>：受諾後の再生で、状態スコアが下がる（回復する）様子をクイックビューで確認する（詳しくは付録B）。</li>
  <li><b>記録する</b>：気づいた点（提案タイミングが適切か 等）をフィードバックとして記録して完了。</li>
</ol>
<div class="callout use">
  <div class="h">💡 迷ったらこの順番</div>
  <div><b>① 選ぶ → ② 条件確認 → ③ 4×で発火まで → ④ 発火の理由を読む → ⑤ 受諾 → ⑥ サービス/コンテンツ → ⑦ 回復 → ⑧ 記録</b>。この 8 ステップが 1 件のレビューです。</div>
</div>
""")

    # ── Appendix A ──────────────────────────────────────────────────────
    parts.append("""
<h2 id="sA"><span class="num ap">A</span>付録A：アルゴリズムの変更点</h2>
<p>ここでは、最近の「AICA の判断のしかた」の変更点を、専門用語をできるだけ避けて説明します。変更は大きく<b>トリガー（いつ声をかけるか）</b>と<b>コンテンツ（何を流すか）</b>の2つに分かれます。</p>

<h3 id="sA1">A-1　トリガー（発火判定）の変更</h3>

<h4>① 単調（たいくつ）トリガーが、安全トリガーより先に出る</h4>
<p>C-02 で使う NRI は、1本のスコアを<b>2つのしきい値</b>で見分けます。<b>「単調性（たいくつ）」のしきい値の方が低く</b>、<b>「休憩（安全）」のしきい値の方が高い</b>ので、走行中のスコアはまず低い方（単調性）に届き、さらに上がってから高い方（休憩）に届きます。つまり、たいくつ向けの声かけが安全向けより<b>先に</b>出やすくなっています。</p>
""")
    parts.append(fig("A1", "03c-quickview-nri.png",
                     "スコアはまず低い方の線（単調性）を超え、さらに上がって高い方の線（休憩・安全）を超えます。だから単調トリガーが先。", narrow=True))
    parts.append("""
<div class="callout note">
  <div class="h">⚠ 同じ瞬間に両方に当てはまったら</div>
  <div>もし同じティックで単調性と休憩の両方に当てはまった場合は、<b>休憩（安全）を優先</b>して1件だけ出します。安全がいちばん大事、というルールです。</div>
</div>

<h4>② 30分以内に同じ提案を重ねて出さない</h4>
<p>もう一つのトリガーである<b>「透明ハイブリッド・トリガー」</b>には、直近30分の提案数の上限と、種類ごとの「クールダウン（間を空ける）」があります。これにより、同じ提案が短時間に何度も出て<b>うるさくなるのを防ぎ</b>ます。</p>
<div class="callout note">
  <div class="h">⚠ 正直な注記</div>
  <div>この「30分以内の重複を出さない」しくみは<b>ハイブリッド・トリガー</b>の機能です。C-02 で使う <b>NRI にはこのクールダウン／30分上限はありません</b>。トリガーの種類によってふるまいが違う点にご注意ください。</div>
</div>

<h4>③ 渋滞・山道をシナリオ設定で再現できる</h4>
<p>セットアップの「ルート条件ペインター」で、<b>渋滞区間・山道区間を距離（km）で指定</b>してルート上に描けます（渋滞時の速度も設定可）。渋滞・山道があると眠気や疲労、そしてトリガーの効き方がどう変わるかを検証できます。</p>
""")
    parts.append(fig("A2", "A1b-route-painter.png",
                     "山道区間・渋滞区間を km レンジで描画。渋滞時の速度も指定できます。", narrow=True))

    parts.append("""
<h3 id="sA2">A-2　コンテンツ提案の変更</h3>
<h4>推し（oshi）アーティストを複数登録でき、それぞれに「お気に入り度」を持てる</h4>
<p>以前は「推し1名の完全一致」でしたが、いまは <span class="pill new">新</span> <b>複数の推しアーティストを登録</b>でき、各アーティストに<b>お気に入り度（熱狂度：0〜1）</b>を設定できます。曲のスコアは、その曲に関わる推しのうち<b>いちばんお気に入り度の高いもの</b>で決まります（合計ではなく<b>最大</b>）。これがコンテンツ提案のスコアに反映されます。</p>
""")
    parts.append(fig("A3", "A2b-oshi-multi.png",
                     "推しアーティストの複数登録。各行にお気に入り度（熱狂度）のスライダー・削除・「アーティストを追加」があります。", narrow=True))
    parts.append(fig("A4", "A3-content-trace.png",
                     "コンテンツ提案の特徴量トレース。推しとの一致（affinity）などがスコアにどう効いたかを確認できます。"))
    parts.append("""
<div class="callout use">
  <div class="h">💡 なぜ「最大」なのか</div>
  <div>複数の推しが1曲に関わることがあります。合計にすると「たくさん登録した人ほど何でも高得点」になってしまうので、<b>いちばん強い推しのお気に入り度</b>だけを採用します。これで「本当に刺さる1人」が素直にスコアに出ます。</div>
</div>
""")

    # ── Appendix B ──────────────────────────────────────────────────────
    parts.append("""
<h2 id="sB"><span class="num ap">B</span>付録B：リカバリー（回復）のやさしい解説</h2>
<p>「リカバリー（回復）」とは、ドライバーが提案を<b>受諾したあとに、眠気やたいくつのスコアが下がるしくみ</b>のことです。トリガーの種類によって下げ方が少し違います。</p>

<h3 id="sB1">B-1　単調（たいくつ）トリガーのリカバリー（かんたん）</h3>
<p>ドライバーが提案を<b>受諾すると、単調（たいくつ）のスコアを、あらかじめ設定した点数ぶん、その場で下げます</b>。運転は止めません（曲やコンテンツで気分転換するイメージ）。下がったスコアは、走り続けるとまた少しずつ溜まっていきます。</p>

<h3 id="sB2">B-2　安全トリガーのリカバリー（休憩を伴う）</h3>
<p>安全（休憩）の提案を受諾したときは、少し丁寧なしくみになります。</p>
<ol class="steps">
  <li><b>受諾した瞬間から、休憩地点に着くまでの間、眠気・疲労・渋滞の蓄積などを「フリーズ（凍結）」します。</b> ＝ 休憩を決めたのに、着く前に状態が急に悪化するのを防ぎます。</li>
  <li><b>休憩地点で休んだあと、眠気・疲労を、あらかじめ設定した点数ぶん、その場で下げます</b>（これが回復）。</li>
</ol>
<p>この「休憩に着くまで高止まり → 休憩後にストンと下がる」という動きは、クイックビューの曲線で見るといちばんよく分かります。</p>
""")
    parts.append(fig("B1", "07b-quickview-recovery.png",
                     "リカバリーの様子。受諾後は高止まり（フリーズ）し、休憩地点＋休憩後サービスでスコアがストンと下がる、を繰り返します。", narrow=True))
    parts.append(fig("B2", "07-recovery-progress-full.png",
                     "受諾後に休憩地点へ向かって進み、休憩を挟んでスコアが回復していく全体の様子。"))
    parts.append("""
<div class="callout use">
  <div class="h">💡 ハイブリッドと NRI で内部は違う、でも見た目は同じ</div>
  <div>ハイブリッドと NRI では下げ方の内部処理が違いますが、<b>見た目の結果（休憩まで高止まり → 休憩後に下がる）は同じ</b>です。まずはこの「山が下がる形」を覚えれば十分です。</div>
</div>

<h3 id="sB3">B-3　これは「プロトタイプ版の簡易リカバリー」です — 将来の改良案</h3>
<p>いまのリカバリーは、<b>受諾したら固定の点数を一括で引く</b>という簡易版です。プロトタイプとしては分かりやすい一方、現実の体感とはまだ差があります。将来は、たとえば次のように、もっと自然にできると考えています。</p>
<ol class="steps">
  <li><b>休んだ時間に比例して回復する</b>：仮眠10分より30分の方が眠気が大きく下がる、というように、休憩の長さで回復量が変わる。</li>
  <li><b>活動の種類で回復が変わる</b>：ストレッチ・仮眠・カラオケなど、活動ごとに「眠気に効く／疲労に効く」を変える。</li>
  <li><b>回復にも「立ち上がり」を持たせる</b>：仮眠の直後は少しぼんやり（睡眠慣性）してから効いてくる、というように、一瞬で全快しない曲線にする。</li>
  <li><b>運転再開後のリバウンド</b>：休憩の効果は永久ではなく、走り続けるとまたゆっくり戻る（一部は実装済み。より自然な曲線に）。</li>
</ol>
<div class="callout note">
  <div class="h">⚠ 位置づけ</div>
  <div>付録Bのリカバリーは<b>仕組みを分かりやすく見せるためのプロトタイプ</b>です。上の改良案は「今後こう良くできる」という方向性で、現時点の実装そのものではありません。</div>
</div>
""")

    parts.append(FOOT)
    return "".join(parts)


if __name__ == "__main__":
    html = build()
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print("wrote", OUT, f"({len(html):,} bytes)")
