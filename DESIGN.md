# DESIGN.md — Deltos

## Context (from discovery)

- Artifact type: landing page de producto self-hosted (PWA kanban).
- Positioning: playful/consumer, cálido, humano, cotidiano. La app como "el corcho de la cocina": la lista de la compra, la reforma, el viaje con amigos, lo de los colegas. NO corporate, NO técnico, NO SaaS genérico.
- Audience: parejas, familias, grupos de amigos y equipos pequeños que comparten tareas cotidianas y huyen de cuentas, nubes, suscripciones y complejidad. Primary action: instalar (o ver GitHub).
- Adjectives: cotidiano, cálido, vivo, cercano, con carácter, honesto.
- Visual word translations:
  - cotidiano → metáfora del corcho de cocina: post-its con cinta washi, textura de corcho, tarjetas ligeramente giradas.
  - cálido → fondo amaderado/corcho, off-white cálido, acento emerald de la app + amarillo post-it.
  - vivo → las capturas de la app "cuelgan" del corcho como notas; escenas de la vida real (compra, viaje, cole/trabajo) como narrativa.
  - cercano → tipografía con tacto (serif Fraunces + Space Grotesk), tono de persona, cero jerga.
  - con carácter → post-its girados, cinta washi, numeración a mano, composición no alineada al grid perfecto.
  - honesto → comparativa con "lado honesto", cero hype.
- Aesthetic essence (3 words): el corcho de cocina.
- Single-minded proposition: un tablero compartido, tan natural como pegar un post-it en la nevera, para las tareas de la vida real. En tu casa, sin nube.
- Archetype: Everyman (cercano) con toque Jester (divertido, desenfadado).
- References: admira los corchos reales de cocina, moodboards con washi tape, los post-its de Muji; evita el patrón SaaS genérico (cards sombreadas + pill + Inter), los gradientes índigo/violeta y el grid editorial perfecto de las landings de infraestructura.
- Mode: light + dark, ambos diseñados. Density: airy.
- Constraints: estática sin build (HTML+CSS+JS puro), i18n ES/EN, capturas reales de la app colgadas del corcho, comparativa honesta, SEO completo, cero em/en dashes. Tipografías vía Google Fonts (FOUT con swap). La metáfora del corcho domina: post-its con cinta, textura de corcho en CSS/SVG, composición intencionalmente "no perfecta".

## Aesthetic

- Direction: Corcho de cocina (bespoke, originado de los adjetivos, NO del catálogo). Una pared de corcho de la cocina con notas pegadas, post-its girados y la app como la nota principal.
- Defining trait: el fondo y la composición evocan un corcho de cocina: textura, notas con cinta washi ligeramente giradas, y las capturas reales de la app presentadas como notas colgadas. NO hay filas horizontales con regla (eso es EasyZFS), NO hay grid de tarjetas sombreadas (SaaS genérico).
- Signature move: la captura principal del tablero "cuelga" del corcho con cinta washi y una nota de puño y letra encima ("mueve una tarjeta y el resto lo ve"), y las escenas de la vida real (La compra / El viaje / El cole y el trabajo) son tarjetas-post-it que enlazan cada una con su captura real.

## Typography

- Display: Fraunces (Google Fonts, OFL). Serif variable, editorial cálida; usada en h1/h2 y palabras clave en italic. Es la voz "de andar por casa" con carácter.
- Body: Space Grotesk (Google Fonts, OFL). Heredada de la app para mantener identidad; limpia y legible.
- Nota manuscrita: Caveat (Google Fonts, OFL), usada SOLO en las notas/etiquetas del corcho (las cintas con mensaje) para el toque de puño y letra. NO en el body.
- Mono: JetBrains Mono (Google Fonts, OFL). Comandos, datos técnicos, versión.
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

- Strategy: apropiado al público (cálido, humano, cotidiano). Diferenciación: base corcho/ámbar cálido + emerald (marca de la app) + amarillo post-it como color de las notas. Evita el blanco puro y la banda índigo/violeta. Distribución 60 neutral / 30 brand / 10 accent.
- Palette light (OKLCH | hex):
  - bg: oklch(0.965 0.012 80) | #f6f1e8 (cáscara de huevo cálida)
  - surface: oklch(0.94 0.015 78) | #eee4d4
  - elevated: oklch(0.985 0.008 80) | #fbf7ef
  - fg: oklch(0.23 0.02 70) | #2a2118 (casi-negro cálido)
  - muted: oklch(0.51 0.025 70) | #6e6251
  - border: oklch(0.87 0.018 78) | #d8ccb8
  - cork: oklch(0.83 0.03 75) | #d6b98f (tono corcho claro, para el fondo del hero)
  - cork-dark: oklch(0.7 0.04 70) | #b18a5c
  - accent (emerald): oklch(0.52 0.13 162) | #0f8a62
  - accent-strong: oklch(0.44 0.12 162) | #0b6b4c
  - accent-soft: oklch(0.93 0.05 162) | #ddf3e9
  - accent-fg: oklch(0.99 0 0) | #ffffff
  - sticky (post-it): oklch(0.95 0.09 95) | #fbe9a0 (amarillo post-it)
  - sticky-2 (post-it azul): oklch(0.93 0.05 230) | #dbe8f6
  - sticky-3 (post-it rosa): oklch(0.93 0.06 10) | #f7dfe0
  - success / warning / error: oklch(0.55 0.13 162) | #0e9a6e / oklch(0.72 0.15 75) | #d97e1f / oklch(0.55 0.2 25) | #d33a2b
- Dark mode overrides (diseñado, no invertido):
  - bg: oklch(0.19 0.02 70) | #1b140c (casi-negro cálido, madera oscura)
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
  - sticky: oklch(0.8 0.1 90) | #b9a64e (post-it oscurecido)
  - sticky-2: oklch(0.75 0.05 230) | #7f93b0
  - sticky-3: oklch(0.8 0.06 10) | #b58385

## Spacing, radius, shadow

- Spacing base: 8px. Scale: 8/12/16/24/32/48/64/96.
- Radius: <= 2 values. 10px (post-its, tarjetas de escena) y 999px (chips de etiquetas). Nada de 0 "editorial duro" ni >16px en post-its.
- Shadow approach: sombra blanda y corta en los post-its (elevación de nota pegada, tipo `0 3px 8px rgba(42,33,24,0.18)`) más una sombra offset sutil en las capturas colgadas. Nada de borde+sombra apilados en el mismo elemento.

## Layout and composition

- Grid: fluido, NO 12-col estricto. El hero es un corcho a sangre (full-bleed) con post-its distribuidos de forma "natural"; las escenas van en filas de 2 (texto + captura) que se alternan; las notas features van en un tablero de 3 columnas de post-its.
- Spacing rhythm: tight dentro de cada post-it (12px), generoso entre secciones (padding 88px vertical).
- Signature layout move: el hero como corcho de cocina con la captura principal de la app "colgada" con cinta washi, post-its laterales con mensajes de puño y letra, y el comando de instalación como una nota más del corcho.
- Density: airy. Scanning: Z en hero, F en escenas.
- Responsive: mobile-first; breakpoints 720 / 1024 / 1200. En móvil el corcho apila los post-its y la captura.

## Components and states

- Button hierarchy: primary (emerald, filled) "Instalar"; secondary (outlined) GitHub; terciario enlaces de texto. States: hover (sombra offset emerald), active, focus-visible (outline 2px accent), disabled.
- Post-it (nota): caja con fondo sticky, borde redondeado 10px, sombra blanda, giro ligero (rotate -1.5 a 2deg), y una "cinta" superior simulada con washi (rectángulo semitransparente con degradado). States: hover endereza ligeramente y sube 2px.
- Chip/etiqueta: pill con borde, texto 0.82rem.
- Tables (comparativa): texto izquierda, símbolos mono centrados, columna propia resaltada en emerald.
- Overlays: lightbox de capturas, focus trap + Escape, aria-modal.
- Feedback: botón copiar con estado "Copiado".
- Focus ring: box-shadow 0 0 0 2px accent, offset 2px.

## Motion

- Duration scale: fast 150ms (hover post-it), normal 280ms (reveal), slow 420ms (hero).
- Easing: --ease-out: cubic-bezier(0.22, 1, 0.36, 1). No bounce.
- What animates: transform y opacity. reduced-motion: fades, contadores muestran valor final, reveal desactivado.
- Signature motion: los post-its del hero entran "pegándose" al corcho con un pequeño giro desde rotación aleatoria; el resto sobrio.

## Iconography

- Set: inline SVG propio, stroke 1.75, viewBox 24, caps/joins round. Los iconos de los features van dentro de los post-its.

## Imagery and illustration

- Mode: capturas reales de la app en modo demo colgadas del corcho (la principal en el hero, una por escena), ES/EN × light/dark → WebP 1440.
- Rules: banner demo oculto en captura, datos de ejemplo (proyectos Casa/Trabajo/Viaje/Huerto). Las capturas van enmarcadas como nota: cinta washi arriba + sombra.
- Avoid: stock, mockups, ilustración genérica, capturas alineadas en grid perfecto.
- Text-over-image contrast: el texto nunca se solapa con la captura; el corcho es el fondo, los post-its con texto van sobre el corcho pero la captura queda dentro de su propio marco.

## Dark mode (if in scope)

- Base bg: L 0.19 cálido (madera oscura). fg: L 0.95. elevation ramp: 0.19 / 0.24 / 0.27.
- Accent dark: emerald L 0.70. border: L 0.34.

## Accessibility

- Contrast: AA verificado en ambos temas (muted sobre bg en light debe ser >=4.5:1; texto sobre sticky debe ser casi-negro cálido para AA).
- Focus: visible, gestionado. Keyboard: lightbox 100% operable.
- Targets: >=24px, 44px preferido.
- Color independence: sí (símbolos de la comparativa con leyenda). Reduced motion: sí.

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
html[data-theme="dark"] { /* overrides dark */ }
```

- Adapter: plain CSS custom properties (estática sin build).

## Cards and surfaces

- Post-its: fondo sticky, radius 10px, sombra blanda, cinta washi arriba. Capturas: marco + cinta + sombra. Las escenas NO usan "card con borde hairline" (eso es EasyZFS/SaaS); usan el corcho como superficie.

## Slop audit

- Date: 5-Ago-2026 (rediseño) | Result: pass.
- Notes (rediseño tras feedback del usuario: "es un clon de EasyZFS"): se tira el esqueleto de EasyZFS (nav+hero con chips+strip de contadores+filas con regla+slider+codebox). Nueva dirección bespoke "Corcho de cocina": hero corcho con post-its y cinta, escenas de la vida real (compra/viaje/cole-trabajo) con captura por escena, features como post-its, comando de instalación integrado en el corcho. Sin em/en dashes. Sin grid perfecto, sin cards hairline, sin pill-everything, sin violeta/índigo. Dark diseñado.

## Changelog

- 5-Ago-2026: creación.
- 5-Ago-2026 (rediseño): tras el feedback del usuario, rediseño completo desde cero con dirección bespoke "Corcho de cocina" (hero corcho + escenas de la vida real + post-its + comando integrado), abandonando el esqueleto de EasyZFS. Capturas regeneradas (board, casa, viaje, trabajo, settings).
