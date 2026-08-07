# DESIGN.md — Deltos

## Context (from discovery)

- Artifact type: landing page for a self-hosted product (kanban PWA).
- Positioning: playful/consumer, warm, human, everyday. The app as "the kitchen cork board": the shopping list, the renovation, the trip with friends, the colleagues stuff. NOT corporate, NOT technical, NOT generic SaaS.
- Audience: couples, families, groups of friends and small teams that share everyday tasks and flee accounts, clouds, subscriptions and complexity. Primary action: install (or view GitHub).
- Adjectives: everyday, warm, lively, close, with character, honest.
- Visual word translations:
  - everyday → kitchen cork-board metaphor: post-its with washi tape, cork texture, slightly rotated cards.
  - warm → wood/cork background, warm off-white, app emerald accent + post-it yellow.
  - lively → app screenshots "hang" from the cork like notes; real-life scenes (shopping, trip, school/work) as narrative.
  - close → tactile typography (serif Fraunces + Space Grotesk), human tone, zero jargon.
  - with character → rotated post-its, washi tape, hand-drawn numbering, composition not aligned to a perfect grid.
  - honest → honest-side comparison, zero hype.
- Aesthetic essence (3 words): the kitchen cork board.
- Single-minded proposition: a shared board, as natural as pinning a post-it to the fridge, for real-life tasks. In your home, without the cloud.
- Archetype: Everyman (close) with a Jester touch (fun, lighthearted).
- References: admires real kitchen cork boards, washi-tape moodboards, Muji post-its; avoids the generic SaaS pattern (shaded cards + pill + Inter), indigo/violet gradients and the perfect editorial grid of infrastructure landings.
- Mode: light + dark, both designed. Density: airy.
- Constraints: static without build (pure HTML+CSS+JS), i18n ES/EN, real app screenshots hanging from the cork, honest comparison, full SEO, zero em/en dashes. Fonts via Google Fonts (FOUT with swap). The cork metaphor dominates: post-its with tape, cork texture in CSS/SVG, intentionally "not perfect" composition.

## Aesthetic

- Direction: Kitchen cork board (bespoke, originated from the adjectives, NOT from a catalogue). A kitchen cork wall with pinned notes, rotated post-its and the app as the main note.
- Defining trait: the background and composition evoke a kitchen cork board: texture, notes with slightly rotated washi tape, and the real app screenshots presented as pinned notes. There are NO horizontal rows with rules (that is EasyZFS), NO shaded-card grid (generic SaaS).
- Signature move: the main board screenshot "hangs" from the cork with washi tape and a handwritten note above ("move a card and the rest sees it"), and the real-life scenes (The shopping / The trip / School and work) are post-it cards that each link to its real screenshot.

## Typography

- Display: Fraunces (Google Fonts, OFL). Variable editorial serif, warm; used in h1/h2 and italic keywords. It is the "at home" voice with character.
- Body: Space Grotesk (Google Fonts, OFL). Inherited from the app to keep identity; clean and legible.
- Handwritten note: Caveat (Google Fonts, OFL), used ONLY in the cork notes/tags (the tapes with a message) for the handwritten touch. NOT in the body.
- Mono: JetBrains Mono (Google Fonts, OFL). Commands, technical data, version.
- Scale: ratio 1.333 (Perfect fourth), base 16px.
  - display: clamp(2.4rem, 5.5vw, 4rem) / 1.08, tracking -0.02em
  - h1: clamp(1.9rem, 3.8vw, 2.8rem) / 1.12
  - h2: clamp(1.4rem, 2.8vw, 2rem) / 1.2
  - h3: 1.1rem / 1.4
  - lead: 1.1rem / 1.65
  - body: 1rem / 1.7
  - small/caption: 0.875rem / 1.5
- Weights: Fraunces 400/500/600 + italic; Space Grotesk 400/500/700; Caveat 500/600; JetBrains Mono 400/600. Measure: 60-72ch.

## Color

- Strategy: appropriate to the audience (warm, human, everyday). Differentiation: warm cork/amber base + emerald (the app brand) + post-it yellow as the note color. Avoids pure white and the indigo/violet band. Distribution 60 neutral / 30 brand / 10 accent.
- Light palette (OKLCH | hex):
  - bg: oklch(0.965 0.012 80) | #f6f1e8 (warm eggshell)
  - surface: oklch(0.94 0.015 78) | #eee4d4
  - elevated: oklch(0.985 0.008 80) | #fbf7ef
  - fg: oklch(0.23 0.02 70) | #2a2118 (warm near-black)
  - muted: oklch(0.51 0.025 70) | #6e6251
  - border: oklch(0.87 0.018 78) | #d8ccb8
  - cork: oklch(0.83 0.03 75) | #d6b98f (light cork tone, for the hero background)
  - cork-dark: oklch(0.7 0.04 70) | #b18a5c
  - accent (emerald): oklch(0.52 0.13 162) | #0f8a62
  - accent-strong: oklch(0.44 0.12 162) | #0b6b4c
  - accent-soft: oklch(0.93 0.05 162) | #ddf3e9
  - accent-fg: oklch(0.99 0 0) | #ffffff
  - sticky (post-it): oklch(0.95 0.09 95) | #fbe9a0 (post-it yellow)
  - sticky-2 (blue post-it): oklch(0.93 0.05 230) | #dbe8f6
  - sticky-3 (pink post-it): oklch(0.93 0.06 10) | #f7dfe0
  - success / warning / error: oklch(0.55 0.13 162) | #0e9a6e / oklch(0.72 0.15 75) | #d97e1f / oklch(0.55 0.2 25) | #d33a2b
- Dark mode overrides (designed, not inverted):
  - bg: oklch(0.19 0.02 70) | #1b140c (warm near-black, dark wood)
  - surface: oklch(0.24 0.02 70) | #23190f
  - elevated: oklch(0.27 0.02 70) | #2c2116
  - fg: oklch(0.95 0.01 80) | #f5ecdd (off-white)
  - muted: oklch(0.68 0.025 70) | #a99a80
  - border: oklch(0.34 0.02 70) | #423324
  - cork: oklch(0.3 0.03 60) | #33230f
  - cork-dark: oklch(0.38 0.04 60) | #4a3418
  - accent: oklch(0.7 0.13 162) | #3ecf9e
  - accent-strong: oklch(0.7 0.13 162) | #3ecf9e
  - accent-soft: oklch(0.28 0.05 162) | #0e3a2c
  - accent-fg: oklch(0.15 0.02 70) | #12100c
  - sticky: oklch(0.8 0.1 90) | #b9a64e (darkened post-it)
  - sticky-2: oklch(0.75 0.05 230) | #7f93b0
  - sticky-3: oklch(0.8 0.06 10) | #b58385

## Spacing, radius, shadow

- Spacing base: 8px. Scale: 8/12/16/24/32/48/64/96.
- Radius: <= 2 values. 10px (post-its, scene cards) and 999px (label chips). No hard "editorial" 0 nor >16px on post-its.
- Shadow approach: soft, short shadow on post-its (pinned-note elevation, like `0 3px 8px rgba(42,33,24,0.18)`) plus a subtle offset shadow on the hanging screenshots. No border+shadow stacked on the same element.

## Layout and composition

- Grid: fluid, NOT strict 12-col. The hero is a full-bleed cork with post-its distributed "naturally"; scenes go in rows of 2 (text + screenshot) that alternate; feature notes go on a 3-column post-it board.
- Spacing rhythm: tight inside each post-it (12px), generous between sections (88px vertical padding).
- Signature layout move: the hero as a kitchen cork with the main app screenshot "hanging" with washi tape, side post-its with handwritten messages, and the install command as one more cork note.
- Density: airy. Scanning: Z in hero, F in scenes.
- Responsive: mobile-first; breakpoints 720 / 1024 / 1200. On mobile the cork stacks the post-its and the screenshot.

## Components and states

- Button hierarchy: primary (emerald, filled) "Install"; secondary (outlined) GitHub; tertiary text links. States: hover (offset emerald shadow), active, focus-visible (outline 2px accent), disabled.
- Post-it (note): box with sticky background, 10px rounded border, soft shadow, slight rotation (rotate -1.5 to 2deg), and a simulated top "tape" with washi (semitransparent rectangle with gradient). States: hover straightens slightly and rises 2px.
- Chip/label: pill with border, 0.82rem text.
- Tables (comparison): text left, mono symbols centered, own column highlighted in emerald.
- Overlays: screenshot lightbox, focus trap + Escape, aria-modal.
- Feedback: copy button with "Copied" state.
- Focus ring: box-shadow 0 0 0 2px accent, offset 2px.

## Motion

- Duration scale: fast 150ms (post-it hover), normal 280ms (reveal), slow 420ms (hero).
- Easing: --ease-out: cubic-bezier(0.22, 1, 0.36, 1). No bounce.
- What animates: transform and opacity. reduced-motion: fades, counters show the final value, reveal disabled.
- Signature motion: the hero post-its enter "sticking" to the cork with a small rotation from a random angle; the rest stays sober.

## Iconography

- Set: own inline SVG, stroke 1.75, viewBox 24, caps/joins round. The feature icons go inside the post-its.

## Imagery and illustration

- Mode: real app screenshots in demo mode hanging from the cork (the main one in the hero, one per scene), ES/EN × light/dark → WebP 1440.
- Rules: demo banner hidden in the screenshot, example data (Casa/Trabajo/Viaje/Huerto projects). Screenshots are framed as notes: washi tape on top + shadow.
- Avoid: stock, mockups, generic illustration, screenshots aligned in a perfect grid.
- Text-over-image contrast: text never overlaps the screenshot; the cork is the background, the post-its with text go over the cork but the screenshot stays inside its own frame.

## Dark mode (if in scope)

- Base bg: warm L 0.19 (dark wood). fg: L 0.95. elevation ramp: 0.19 / 0.24 / 0.27.
- Dark accent: emerald L 0.70. border: L 0.34.

## Accessibility

- Contrast: AA verified in both themes (muted over bg in light must be >=4.5:1; text over sticky must be warm near-black for AA).
- Focus: visible, managed. Keyboard: lightbox fully operable.
- Targets: >=24px, 44px preferred.
- Color independence: yes (comparison symbols with legend). Reduced motion: yes.

## Tokens (source of truth)

```css
:root {
  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'Space Grotesk', system-ui, sans-serif;
  --font-hand: 'Caveat', cursive;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --bg: #f6f1e8; --surface: #eee4d4; --elevated: #fbf7ef;
  --fg: #2a2118; --muted: #6e6251; --border: #d8ccb8;
  --cork: #d6b98f; --cork-dark: #b18a5c;
  --accent: #0f8a62; --accent-strong: #0b6b4c; --accent-soft: #ddf3e9; --accent-fg: #ffffff;
  --sticky: #fbe9a0; --sticky-2: #dbe8f6; --sticky-3: #f7dfe0;
  --radius: 10px;
  --shadow-note: 0 3px 8px rgba(42,33,24,0.18);
  --shadow-shot: 0 6px 18px rgba(42,33,24,0.22);
  --space: 8px;
  --ease-out: cubic-bezier(0.22,1,0.36,1);
}
html[data-theme="dark"] { /* dark overrides */ }
```

- Adapter: plain CSS custom properties (static without build).

## Cards and surfaces

- Post-its: sticky background, radius 10px, soft shadow, washi tape on top. Screenshots: frame + tape + shadow. Scenes do NOT use a "hairline border card" (that is EasyZFS/SaaS); they use the cork as the surface.

## Slop audit

- Date: 5-Aug-2026 (redesign) | Result: pass.
- Notes (redesign after user feedback: "it is a clone of EasyZFS"): the EasyZFS skeleton was dropped (nav+hero with chips+counter strip+rows with rules+slider+codebox). New bespoke direction "Kitchen cork board": cork hero with post-its and tape, real-life scenes (shopping/trip/school-work) with a screenshot per scene, features as post-its, install command integrated in the cork. No em/en dashes. No perfect grid, no hairline cards, no pill-everything, no violet/indigo. Dark designed.

## Changelog

- 5-Aug-2026: creation.
- 5-Aug-2026 (redesign): after user feedback, full redesign from scratch with the bespoke "Kitchen cork board" direction (cork hero + real-life scenes + post-its + integrated command), abandoning the EasyZFS skeleton. Screenshots regenerated (board, house, trip, work, settings).
