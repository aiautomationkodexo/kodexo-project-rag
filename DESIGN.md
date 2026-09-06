# Kodexo Labs — Design System

**Source:** `Kodexo Labs Proposal.html` (Claude Design export, bundle namespace `KodexoLabsDesignSystem_aac98c`, bundle format 4).
**Upstream lock:** Visual Identity v1.0. Color values are declared "locked upstream — do not edit."
**Origin medium:** print-first (A4, 210 × 297 mm). All document sizes are authored in `pt`; §9 covers the web/Tailwind translation.

---

## 1. Brand identity

| Attribute | Value |
|---|---|
| Name | Kodexo Labs |
| Positioning line | AI Native Development Partner |
| Sub-brand rule | `KODEXO` + red middot `·` + `LABS`, 800 weight, `.2em` tracking |
| Kicker under wordmark | `AI ENGINEERING`, 600, `.24em` tracking, red, on a `2.5pt` red bottom rule |
| Mark | Red angular "L/K" bracket glyph (see `assets/back-cover.jpg`) |
| Address | 5900 Balcones Drive #18480, Austin, TX 78731 |
| Contact | contact@kodexolabs.com · +1 219 766 5259 · kodexolabs.com |
| Offices | Austin TX · New York · San Francisco · Chicago · London · Karachi |
| Link color | `#B22424` default, `#F54545` on hover |

### Design principles encoded in the system

1. **Red is rationed.** Tier 1 brand color is limited to **four uses per document**: the cover rule, the section numerals, one callout, and one diagram anchor. Everything else is neutral.
2. **All chrome comes from Tier 2 neutrals.** No hand-picked greys.
3. **Semantic colors are locked pairs** (bg + text). Never mix a background from one pair with text from another.
4. **One illustration hue per document.** Set `--ill` once at the top; every diagram inherits it.
5. **Near-zero radius.** `--radius-box: 2px`. The system reads as engineered, not soft.
6. **No shadows.** Page frames use `1px solid var(--n200)`, never `box-shadow`.
7. **Print integrity.** Every composite block carries `breakInside: 'avoid'`; every heading carries `breakAfter: 'avoid'`.

---

## 2. Typography

### 2.1 Families

| Token | Family | Format | Weights shipped | Role |
|---|---|---|---|---|
| `--display` | **Bernabeu** | OTF (static) | 400, 500, 600, 700, 800, 900 | Section headings (900), subheads (700), cover titles on art covers (900/800), sign-off name (700), phase names (700) |
| `--body` | **Manrope** | TTF | 400, 500, 600, 700, 800 | All body text (400), emphasis (700), labels (700 uppercase), running heads (800) |
| `--hyper` | **Anton** | TTF | 400 | Cover titles **only** — uppercase, `line-height: 1.02` |
| `--mono` | **JetBrains Mono** | TTF | 500 | Code. Rare by design. |

> Bernabeu ships as separate static OTFs per weight (in print pipelines each is its own installed family, e.g. `local("Bernabeu Black")`). The export unifies them under one `font-family` with `font-weight` descriptors for screen use.

```css
@font-face{font-family:"Bernabeu";src:url("Bernabeu-Regular.otf")  format("opentype");font-weight:400}
@font-face{font-family:"Bernabeu";src:url("Bernabeu-Medium.otf")   format("opentype");font-weight:500}
@font-face{font-family:"Bernabeu";src:url("Bernabeu-SemiBold.otf") format("opentype");font-weight:600}
@font-face{font-family:"Bernabeu";src:url("Bernabeu-Bold.otf")     format("opentype");font-weight:700}
@font-face{font-family:"Bernabeu";src:url("Bernabeu-ExtraBold.otf")format("opentype");font-weight:800}
@font-face{font-family:"Bernabeu";src:url("Bernabeu-Black.otf")    format("opentype");font-weight:900}
@font-face{font-family:"Anton";src:url("Anton-Regular.ttf") format("truetype");font-weight:400}
@font-face{font-family:"Manrope";src:url("Manrope-Regular.ttf")   format("truetype");font-weight:400}
@font-face{font-family:"Manrope";src:url("Manrope-Medium.ttf")    format("truetype");font-weight:500}
@font-face{font-family:"Manrope";src:url("Manrope-SemiBold.ttf")  format("truetype");font-weight:600}
@font-face{font-family:"Manrope";src:url("Manrope-Bold.ttf")      format("truetype");font-weight:700}
@font-face{font-family:"Manrope";src:url("Manrope-ExtraBold.ttf") format("truetype");font-weight:800}
@font-face{font-family:"JetBrains Mono";src:url("JetBrainsMono-Medium.ttf") format("truetype");font-weight:500}
```

### 2.2 Scale (document roles)

| Token | Value | px @96dpi | Applied to |
|---|---|---|---|
| `--fs-cover` | `40pt` | 53.3 | `TextCover` h1 (Anton, uppercase, lh 1.02, ls .005em) |
| `--fs-cover-art` | `24pt` | 32 | `CoverArt` title (Bernabeu 900, lh 1.12, ls −.02em) |
| `--fs-section` | `15pt` | 20 | `SectionHeading` h2 (Bernabeu 900, lh 1.2) |
| `--fs-subhead` | `11pt` | 14.7 | `SubHeading` h3, `PhaseBlock` name (Bernabeu 700) |
| `--fs-body` | `10.2pt` | 13.6 | Paragraphs, callout body, stack titles |
| `--fs-small` | `9pt` | 12 | Sign-off lines, phase items (9.2pt), list items (9.4pt) |
| `--fs-label` | `7.5pt` | 10 | All uppercase labels, table headers, running heads, page numbers |
| `--fs-mono` | `9pt` | 12 | Code |
| `--lh-body` | `1.55` | — | Body, lists, callouts, captions (1.5) |
| `--track-label` | `.1em` | — | Base label tracking |

### 2.3 Tracking values in use

| Context | Letter-spacing |
|---|---|
| Table header, base label token | `.1em` |
| `ComparePanel` label | `.13em` |
| `Callout` label, `CoverArt` `<dt>` | `.14em` |
| `TaggedPair` tag | `.15em` |
| Running head `KODEXO LABS` | `.16em` |
| Wordmark `KODEXO·LABS` | `.2em` |
| `AI ENGINEERING` kicker, `PROPOSAL` kicker | `.24em` |
| `CoverArt` version line | `.06em` |
| Cover h1 (Anton) | `.005em` |
| `CoverArt` title (Bernabeu 900) | `-.02em` |

### 2.4 Role rules (verbatim from source)

> `--hyper` cover titles only (400, uppercase, lh 1.02); `--display` sections 900 / subheads 700; `--body` text 400, emphasis 700, labels 700 uppercase .1em; `--mono` code 500, rare.

---

## 3. Color

Four tiers. The tier a color sits in determines how freely it may be used.

### Tier 1 — Brand (rationed: four uses per document)

| Token | Hex | Use |
|---|---|---|
| `--red` | `#F54545` | Section numerals, cover rule, brand-callout bar, diagram anchor, active page dot |
| `--red-deep` | `#B22424` | Brand-callout label, link default |
| `--red-tint` | `#FFE1E1` | Brand-callout background |
| `--black` | `#0A0A0F` | Primary text |
| `--white` | `#FFFFFF` | Page surface |

### Tier 2 — Neutrals (all chrome)

| Token | Hex | Primary use |
|---|---|---|
| `--n50` | `#FAFAFB` | — |
| `--n100` | `#F4F4F5` | Panel surface, viewer background, table total row |
| `--n200` | `#E4E4E7` | Hairline borders, table row rules, panel borders |
| `--n300` | `#D4D4D8` | Heading rule (`1.5pt`), inactive page dot |
| `--n400` | `#A1A1AA` | `NumberedStack` ordinal numerals |
| `--n500` | `#71717A` | Secondary text, captions, sub-descriptions, footer meta |
| `--n600` | `#52525B` | Viewer chrome label |
| `--n700` | `#3F3F46` | Label text, `Callout` default label |
| `--n800` | `#27272A` | Emphasis border, `Callout` default bar, `PhaseBlock` first border |
| `--n900` | `#18181B` | Dark band, table header fill, `TaggedPair` primary tag |
| `--n950` | `#09090B` | — |

### Tier 3 — Semantic (locked pairs, never hand-picked)

| Pair | Background | Text |
|---|---|---|
| Success | `--success-bg` `#DCFCE7` | `--success-text` `#166534` |
| Warning | `--warning-bg` `#FEF3C7` | `--warning-text` `#92400E` |
| Error | `--error-bg` `#FEE2E2` | `--error-text` `#991B1B` |
| Info | `--info-bg` `#DBEAFE` | `--info-text` `#1E40AF` |

### Tier 4 — Illustration (one hue per document — set `--ill` once)

| Token | Hex | Domain |
|---|---|---|
| `--ill-blue` | `#4A7DFF` | AI, data, cloud, engineering |
| `--ill-green` | `#5F8F73` | Trust, compliance, security, team |
| `--ill-amber` | `#E6A600` | Healthcare, alerts, urgency |
| `--ill-purple` | `#7657E8` | SaaS, product strategy, creative |
| `--ill` | `var(--ill-blue)` | Active hue for this document |

### Semantic aliases

```css
--text-body: var(--black);      --text-secondary: var(--n500);   --text-label: var(--n700);
--surface-page: var(--white);   --surface-panel: var(--n100);    --surface-band: var(--n900);
--border-hairline: var(--n200); --border-rule: var(--n300);      --border-emphasis: var(--n800);
```

---

## 4. Space, rhythm, geometry

```css
:root{
  --space-section: 26pt;   /* between sections */
  --space-h2-below: 12pt;  /* h2: zero space above */
  --space-h3-above: 20pt;  --space-h3-below: 7pt;
  --space-h4-above: 15pt;  --space-h4-below: 5pt;
  --space-para: 9pt;
  --page-margin-top: 26mm; --page-margin-x: 18mm; --page-margin-bottom: 20mm;
  --radius-box: 2px;
  --bar-callout: 3pt;      /* Callout left bar */
  --rule-heading: 1.5pt;   /* SectionHeading underline */
}
```

**Page geometry (A4).** `210mm × 297mm`, `padding: 26mm 18mm 20mm`, `box-sizing: border-box`, `overflow: hidden`.

**Running furniture** (absolutely positioned inside `ContentPage`, all `7.5pt`):

| Slot | Position | Style |
|---|---|---|
| `KODEXO LABS` | `top 9mm / left 18mm` | 800, `.16em`, `--black` |
| Document title | `top 9mm / right 18mm` | 400, `--n500` |
| `Confidential` | `bottom 8mm / left 18mm` | 400, `--n500` |
| `Page N of T` | `bottom 8mm / right 18mm` | 400, `--n500` |

**Rules of thumb observed across components**

- Block margins: `8pt–12pt` top, `12pt–14pt` bottom.
- Cell/box padding: `11pt 13pt` for panels, `6pt 8pt` for table cells.
- List indent: `paddingLeft: 13pt`; item gap `4pt`, last item `0`.
- Borders: `1px solid var(--n200)` hairline; `1.5pt` for emphasis rules; `2.5pt` for the brand cover rule; `3pt` for the callout bar.

---

## 5. Component library

13 components in namespace `KodexoLabsDesignSystem_aac98c`. Source paths are the upstream layout.

| Component | Source path |
|---|---|
| `Callout` | `components/callouts/Callout.jsx` |
| `CoverArt` | `components/cover/CoverArt.jsx` |
| `Plate` | `components/cover/Plate.jsx` |
| `TextCover` | `components/cover/TextCover.jsx` |
| `DocFigure` | `components/figures/DocFigure.jsx` |
| `SectionHeading` | `components/headings/SectionHeading.jsx` |
| `SignOff` | `components/headings/SignOff.jsx` |
| `SubHeading` | `components/headings/SubHeading.jsx` |
| `ComparePanel` | `components/panels/ComparePanel.jsx` |
| `TaggedPair` | `components/panels/TaggedPair.jsx` |
| `NumberedStack` | `components/stacks/NumberedStack.jsx` |
| `PhaseBlock` | `components/stacks/PhaseBlock.jsx` |
| `DocTable` | `components/tables/DocTable.jsx` |

---

### 5.1 `SectionHeading`

`{ n, children }` — numbered `h2`, red numeral, hairline rule beneath.

```
fontFamily: var(--display) · 900 · 15pt · lh 1.2
margin: 0 0 10pt · paddingBottom: 5pt
borderBottom: 1.5pt solid var(--n300)
breakAfter: avoid · color: var(--black)
  └ span (numeral): color var(--red), marginRight 8pt
```

### 5.2 `SubHeading`

`{ sn, children }` — `h3` with an optional dotted section number (e.g. `4.1`).

```
fontFamily: var(--display) · 700 · 11pt
margin: 20pt 0 7pt · breakAfter: avoid
  └ span (sn): 700, black, marginRight 7pt
```

### 5.3 Paragraph (`P`, document-local primitive)

```
margin: 0 0 9pt · 10.2pt · lh 1.55 · var(--body) · var(--black)
```

### 5.4 `Callout`

`{ variant = 'default', label, children }` — left-barred emphasis block.

| variant | bar | background | label |
|---|---|---|---|
| `default` | `--n800` | `--n100` | `--n700` |
| `brand` | `--red` | `--red-tint` | `--red-deep` |
| `warn` | `--warning-text` | `--warning-bg` | `--warning-text` |
| `ok` | `--success-text` | `--success-bg` | `--success-text` |
| `err` | `--error-text` | `--error-bg` | `--error-text` |
| `info` | `--info-text` | `--info-bg` | `--info-text` |

```
borderLeft: 3pt solid <bar> · background: <bg>
padding: 11pt 14pt · margin: 12pt 0 · breakInside: avoid
body: var(--body) 10.2pt lh 1.55 var(--black)
label (h4): 700 · 7.5pt · .14em · uppercase · <label color> · margin 0 0 6pt
```

### 5.5 `DocTable`

`{ columns = [], rows = [], tight = true }`

- Row = an array of cells, **or** `{ cells, total: true }` for a highlighted totals row.
- Cell = a string, **or** `{ text, k?, money?, }`.
  - `k: true` → key column: 700 weight, fixed `width: 110pt`.
  - `money: true` → 700 weight, `white-space: nowrap`.

```
table: width 100% · margin 8pt 0 12pt · borderCollapse collapse
       9.4pt · var(--body) · var(--black) · breakInside: avoid when tight
th:    left · 700 · 7.5pt · .1em · uppercase
       background var(--n900) · color var(--white) · padding 6pt 8pt · no border · valign top
td:    padding 6pt 8pt · borderBottom 1px solid var(--n200) · valign top
       first cell paddingLeft 0 · last cell paddingRight 0
       total row → 700 + background var(--n100)
       last row (non-total) → borderBottom: none
```

### 5.6 `ComparePanel`

`{ left, right }` where each side is `{ label, items[] }` — a two-up gains/costs grid sharing one outer border.

```
grid 1fr 1fr · border 1px solid var(--n200) · margin 8pt 0 12pt · breakInside avoid
side:  padding 11pt 13pt · right side gets borderLeft 1px solid var(--n200)
label (h5): 700 · 7.5pt · .13em · uppercase · var(--n700) · margin 0 0 7pt
list:  paddingLeft 13pt · 9.4pt · lh 1.55 · item gap 4pt, last 0
```

### 5.7 `TaggedPair`

`{ primary, secondary }` where each is `{ tag, items[] }` — two separated boxes; the primary tag is inverted.

```
grid 1fr 1fr · gap 9pt · margin 10pt 0 12pt · breakInside avoid
box:   border 1px solid var(--n200) · padding 11pt 13pt
tag:   700 · 7pt · .15em · uppercase · padding 2.5pt 6pt · inline-block · mb 7pt
       primary   → background var(--n900), color var(--white)
       secondary → background var(--n200), color var(--black)
list:  paddingLeft 13pt · 9.4pt · lh 1.55 · item gap 4pt, last 0
```

Canonical use: `Deterministic` (primary) vs `Modelled` (secondary).

### 5.8 `NumberedStack`

`{ layers: [{ title, desc }] }` — stacked layer diagram with zero-padded ordinals; rows share borders (only the last keeps its bottom edge).

```
row:  grid 34pt 1fr · gap 10pt · border 1px solid var(--n200)
      borderBottom: none except last row · padding 8pt 11pt · breakInside avoid
num:  800 · 13pt · var(--n400) · lh 1.1 · String(i+1).padStart(2,'0')
title:700 · 10.2pt · var(--black)
desc: 9.4pt · lh 1.55 · var(--n500)
```

### 5.9 `PhaseBlock`

`{ name, items = [], first = false }` — the `first` phase gets a heavier border to mark the recommended starting point.

```
border: first ? 1.5pt solid var(--n800) : 1px solid var(--n200)
padding 11pt 13pt · marginBottom 9pt · breakInside avoid
name: var(--display) · 700 · 11pt · var(--black)
list: 9.2pt · var(--n500) · margin 8pt 0 0 · borderTop 1px solid var(--n200)
      paddingTop 8pt · paddingLeft 14pt · lh 1.55 · item gap 4pt
```

### 5.10 `DocFigure`

`{ number, caption, src, alt = '', children }` — renders `src` as a full-width image, otherwise wraps inline SVG children.

```
figure:     margin 12pt 0 14pt · breakInside avoid
img:        width 100% · display block
figcaption: 8.6pt · var(--n500) · marginTop 6pt · lh 1.5
            "Figure N. " prefix in 700 when `number` is given
```

### 5.11 `SignOff`

`{ name, lines = ['Kodexo Labs · 5900 Balcones Drive, Austin, TX 78731', 'contact@kodexolabs.com  |  +1 219 766 5259  |  kodexolabs.com'] }`

```
marginTop 26pt · borderTop 1px solid var(--n200) · paddingTop 14pt · breakInside avoid
name:  var(--display) · 700 · 12pt · var(--black)
lines: 9pt · var(--n500) · margin 2pt 0 0
```

### 5.12 `CoverArt`

`{ title, version = 'V 1.0 | August | 2026', client, art, scale = 1 }` — text block set over the full-bleed cover artwork. Every dimension multiplies by `scale`.

```
page:    210×297mm (×scale) · background url(art) center/cover no-repeat · overflow hidden
block:   absolute · left 43mm · top 76mm · width 141mm (all ×scale)
title:   var(--display) · 900 · 24pt · lh 1.12 · ls −.02em · nowrap · mb 3.5mm
version: var(--display) · 800 · 12pt · lh 1.2 · ls .06em · var(--n500) · nowrap · mb 9mm
dl:      width 66mm
  dt:    var(--body) · 700 · 7.5pt · .14em · uppercase · var(--n500) · mb 1mm   ("Prepared for")
  dd:    var(--body) · 600 · 10.5pt · var(--black)
```

### 5.13 `TextCover`

`{ kicker = 'PROPOSAL', title, sub, details = [], foot }` — the artwork-free cover. `details` is `[{ k, v }]`.

```
page:     210mm × min 297mm · var(--white) · padding 26mm 18mm 20mm
wordmark: 800 · 13pt · .2em → "KODEXO" + <em style="color:var(--red);font-style:normal">·</em> + "LABS"
rule:     borderBottom 2.5pt solid var(--red) · margin 6pt 0 0 · paddingBottom 3pt
          600 · 7.5pt · .24em · var(--red) → "AI ENGINEERING"
kicker:   600 · 8pt · .24em · var(--n500) · margin 78pt 0 8pt
h1:       var(--hyper) · 400 · 40pt · lh 1.02 · ls .005em · uppercase · margin 0 0 12pt
sub:      12pt · var(--n500) · lh 1.45 · maxWidth 400pt · margin 0 0 30pt
details:  table, borderCollapse collapse, width 100%
          td.k → padding 7pt 0 · borderBottom 1px solid var(--n200) · width 105pt · 700
          td.v → padding 7pt 0 · borderBottom 1px solid var(--n200) · valign top
foot:     marginTop 34pt · 9pt · var(--n500) · lh 1.6
          leading <b> "Kodexo Labs" → black, block, 9.5pt
```

### 5.14 `Plate`

`{ variant = 'trust' | 'back', assetBase, scale = 1 }` — full-bleed pre-rendered page.

```
img: 210×297mm (×scale) · objectFit cover · display block
alt: "Kodexo Labs credentials plate" | "Kodexo Labs contact plate"
```

---

## 6. Page architecture

### `ContentPage` — the interior page shell

`{ page, total = 7, docTitle, children }`

```
210mm × 297mm · box-sizing border-box · position relative
background: url(content-bg.jpg) center/cover no-repeat
padding: 26mm 18mm 20mm · overflow hidden
+ four absolutely-positioned furniture slots (§4)
```

### Canonical 7-page proposal sequence

| # | Page | Built from |
|---|---|---|
| 0 | Cover | `CoverArt` over `cover.jpg` |
| 1 | Trust plate | `Plate variant="trust"` |
| 2 | 1 · Executive summary | `SectionHeading` → `P`×3 → `DocTable` → `P` → `Callout variant="brand"` |
| 3 | 2 · Problem statement | `SectionHeading` → `P` → `DocTable` → `DocFigure` (inline SVG) → `P` |
| 4 | 3 · System overview | `SectionHeading` → `P` → `NumberedStack` → `Callout` |
| 5 | 4 · Build paths | `SectionHeading` → `P` → `SubHeading` → `ComparePanel` → `SubHeading` → `TaggedPair` → `PhaseBlock first` → `SignOff` |
| 6 | Back cover | `Plate variant="back"` |

### Document viewer chrome (`ProposalDocInner`)

- Background `var(--n100)`, column flex, centered.
- Page frame: `border 1px solid var(--n200)`, `background var(--white)`, `boxShadow: none`, `zoom: .82`, `marginBottom 24`.
- Nav: `←` / `→` buttons + a row of 10×10 square dots (`borderRadius 0`); active dot `var(--red)`, inactive `var(--n300)`.
- Button: `var(--body)` 700, 12px, `border 1px solid var(--n200)`, white, `padding 6px 14px`.
- Current page label: 12px `var(--n600)`, `minWidth 170`.
- Keyboard: `ArrowLeft` / `ArrowRight`. Position persisted in `localStorage` under `kx-doc-page`.

---

## 7. Diagram conventions

From `DocFigure` 1 (the "identity spine" figure) — the house style for schematic SVG:

| Element | Spec |
|---|---|
| Node box | `fill #FFFFFF`, `stroke #E4E4E7`, `stroke-width 1.5`, `rx 2` (matches `--radius-box`) |
| Node label | Manrope 600, `13px`, `fill #0A0A0F`, `text-anchor middle` |
| Broken / absent connection | `stroke #E4E4E7`, `stroke-width 2`, `stroke-dasharray "4 7"` |
| The one emphasized path | `stroke #F54545`, `stroke-width 2.5`, `stroke-linecap round` |
| Anchor node on that path | `circle r=5`, `fill #F54545` |
| Diagram caption inside SVG | Manrope 700, `11px`, `fill #F54545`, `letter-spacing 1.5`, uppercase |
| Accessibility | `role="img"` + descriptive `aria-label` on every `<svg>` |
| Sizing | `viewBox` + `width: 100%`, `display: block` — never fixed px |

Rule expressed by the figure: **grey dashes state the problem, one red line states the answer.** Exactly one red path per figure.

---

## 8. Assets

Embedded in the export as base64 JPEGs (A4 at 1654 × 2339 px ≈ 200 dpi).

| Asset | Bundle id | Description |
|---|---|---|
| `cover.jpg` | `df127761…` | White field; red vertical bar down the left edge folding into a wide chevron/checkmark in layered red tints; `2026` in grey above `PROPOSAL` in `#F54545` (heavy grotesque, all caps); red dot-matrix blocks; italic "Prepared by Kodexo Labs" at the foot |
| `trust.jpg` | `4a138bf8…` | "Why Kodexo Labs" credentials plate — logo bar, capability chips, six stat tiles (51 products shipped · 94% client retention · $1M+ client savings · 60+ team members · Top 1% on Upwork · 25+ industries served), "How We Work" 2×2 icon cards, "Trusted By" logo row, "Why Teams Stay" table, "Recognized by" badges, office-city footer. Sections numbered `02`–`06` in red |
| `back-cover.jpg` | `688a986f…` | Centered red bracket mark + `kodexo labs` wordmark, red dot matrix, three contact tiles (location / phone / email), stacked red footer bands |
| `content-bg.jpg` | `f51140ec…` | Near-white A4 field with very low-contrast `--red-tint`-family sweeping curves. Decorative only — never place text against the darkest sweep |

**Numbered plate sections.** On the trust plate, section ordinals (`02`, `03`, …) are red, set to the left of a red vertical tick and a Bernabeu-black heading — the plate equivalent of `SectionHeading`.

---

## 9. Web translation (Next.js 15 + Tailwind v4)

The system is authored in `pt` for A4. For screen work in this repo, convert at **1pt = 1.3333px** and round to the nearest half-pixel.

| Role | Print | Web |
|---|---|---|
| Cover title | `40pt` | `53px` |
| Section heading | `15pt` | `20px` |
| Subhead | `11pt` | `15px` |
| Body | `10.2pt` | `13.5px` → round to `14px` |
| List / table body | `9.4pt` | `12.5px` |
| Caption | `8.6pt` | `11.5px` |
| Small | `9pt` | `12px` |
| Label | `7.5pt` | `10px` |
| Section gap | `26pt` | `35px` |
| Para gap | `9pt` | `12px` |
| Panel padding | `11pt 13pt` | `15px 17px` |
| Cell padding | `6pt 8pt` | `8px 11px` |

Drop into `src/app/globals.css` alongside `@import "tailwindcss"`:

```css
@theme {
  --color-red:        #F54545;
  --color-red-deep:   #B22424;
  --color-red-tint:   #FFE1E1;
  --color-ink:        #0A0A0F;
  --color-n50:  #FAFAFB;  --color-n100: #F4F4F5;  --color-n200: #E4E4E7;
  --color-n300: #D4D4D8;  --color-n400: #A1A1AA;  --color-n500: #71717A;
  --color-n600: #52525B;  --color-n700: #3F3F46;  --color-n800: #27272A;
  --color-n900: #18181B;  --color-n950: #09090B;

  --font-display: "Bernabeu", ui-sans-serif, system-ui, sans-serif;
  --font-body:    "Manrope", ui-sans-serif, system-ui, sans-serif;
  --font-hyper:   "Anton", "Bernabeu", sans-serif;
  --font-mono:    "JetBrains Mono", ui-monospace, monospace;

  --text-label:   10px;   --text-small:   12px;  --text-list:   12.5px;
  --text-body:    14px;   --text-subhead: 15px;  --text-section: 20px;
  --text-cover:   53px;

  --radius-box: 2px;
  --tracking-label: 0.1em;
}
```

### Adapting print rules to an application UI

- Keep the red ration. In an app, that means: one primary action per view, red section numerals, red active state — nothing else.
- `--radius-box: 2px` applies to buttons, inputs, cards and chips alike. No pills, no `rounded-lg`.
- Borders carry hierarchy, not shadows. `n200` hairline → `n300` rule → `n800` emphasis.
- Uppercase `7.5pt/.1em+` labels are the system's workhorse for column headers, field labels, and status chips.
- Dark table headers (`--n900` on `--white`) translate directly to data-grid headers.
- Empty and error states pull from Tier 3 locked pairs — never invent a shade.
- `--ill-blue` is the correct illustration hue for this project (AI / data / RAG).

### Dark mode

The export defines **no dark palette** — it is a print system on white. If a dark app surface is needed, invert through the neutral ramp (`n950` page → `n900` panel → `n800` hairline → `n300` body text → `white` headings) and keep `--red` at `#F54545`; do not darken the brand red, since `--red-deep` is reserved for link/label roles on light ground.

---

## 10. Ready-to-paste token block

The complete `:root` exactly as it ships in the export:

```css
:root{
  /* TIER 1 — brand. Rationed: four uses per document */
  --red:#F54545; --red-deep:#B22424; --red-tint:#FFE1E1;
  --black:#0A0A0F; --white:#FFFFFF;
  /* TIER 2 — neutrals. All chrome comes from here */
  --n50:#FAFAFB;--n100:#F4F4F5;--n200:#E4E4E7;--n300:#D4D4D8;--n400:#A1A1AA;
  --n500:#71717A;--n600:#52525B;--n700:#3F3F46;--n800:#27272A;--n900:#18181B;--n950:#09090B;
  /* TIER 3 — semantic. Locked pairs, never hand-picked */
  --success-bg:#DCFCE7; --success-text:#166534;
  --warning-bg:#FEF3C7; --warning-text:#92400E;
  --error-bg:#FEE2E2;   --error-text:#991B1B;
  --info-bg:#DBEAFE;    --info-text:#1E40AF;
  /* TIER 4 — illustration. ONE hue per document */
  --ill-blue:#4A7DFF; --ill-green:#5F8F73; --ill-amber:#E6A600; --ill-purple:#7657E8;
  --ill:var(--ill-blue);
  /* Aliases */
  --text-body:var(--black); --text-secondary:var(--n500); --text-label:var(--n700);
  --surface-page:var(--white); --surface-panel:var(--n100); --surface-band:var(--n900);
  --border-hairline:var(--n200); --border-rule:var(--n300); --border-emphasis:var(--n800);

  /* Type */
  --display:"Bernabeu",sans-serif;
  --body:"Manrope",sans-serif;
  --hyper:"Anton",sans-serif;
  --mono:"JetBrains Mono",monospace;
  --fs-cover:40pt; --fs-cover-art:24pt; --fs-section:15pt; --fs-subhead:11pt;
  --fs-body:10.2pt; --fs-small:9pt; --fs-label:7.5pt; --fs-mono:9pt;
  --lh-body:1.55; --track-label:.1em;

  /* Rhythm + geometry (A4 print) */
  --space-section:26pt;
  --space-h2-below:12pt;
  --space-h3-above:20pt; --space-h3-below:7pt;
  --space-h4-above:15pt; --space-h4-below:5pt;
  --space-para:9pt;
  --page-margin-top:26mm; --page-margin-x:18mm; --page-margin-bottom:20mm;
  --radius-box:2px; --bar-callout:3pt; --rule-heading:1.5pt;
}
```
