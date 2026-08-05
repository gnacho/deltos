# DESIGN.md — Deltos

## Context (from discovery)

- Artifact type: landing page de producto self-hosted (PWA kanban).
- Positioning: playful/consumer, cálido y cercano, editorial atrevido. NO corporate, NO técnica.
- Audience: parejas, familias, grupos de amigos y equipos pequeños que comparten tareas cotidianas (casa, viajes, cole, trabajo) y huyen de cuentas, nubes, suscripciones y complejidad. Primary action: instalar (o ver GitHub / demo).
- Adjectives: cercano, vivo, claro, sencillo, honesto, con carácter.
- Visual word translations:
  - cercano → serif humanista cálido en display, off-white cálido, no blanco puro.
  - vivo → acento emerald + un segundo acento ámbar usado en detalles; tablero en vivo como motivo.
  - claro → jerarquía tipográfica fuerte, reglas editoriales en vez de cajas sombreadas.
  - sencillo → pocas cajas, aire, comandos en mono.
  - honesto → comparativa con "lado honesto", cero hype.
- Aesthetic essence (3 words): vida, en tablero.
- Single-minded proposition: un tablero compartido para la vida de verdad (casa, familia, colegas), en vivo, sin nube ni suscripción.
- Archetype: Everyman (cercano) con toque Jester (divertido).
- References: admira el editorial tipográfico de las revistas de tapa dura (The Verge en modo editorial, revistas de diseño); evita el patrón SaaS genérico (cards sombreadas + pill + Inter) y los gradientes índigo/violeta.
- Mode: light + dark, ambos diseñados. Density: airy.
- Constraints: estática sin build (HTML+CSS+JS puro), i18n ES/EN, capturas reales de la app en slider, comparativa honesta, SEO completo, cero em/en dashes. Tipografías vía Google Fonts (FOUT con swap). Stack de la app heredado (Space Grotesk / JetBrains Mono / emerald) como puente de marca.

## Aesthetic

- Direction: Editorial atrevido (magazine). Serif display de alto contraste + sans humanista para cuerpo, reglas y divisores en vez de tarjetas sombreadas, numeración de secciones, aire generoso.
- Defining trait: las secciones se separan con reglas editoriales (líneas gruesas en acento) y números de índice en mono, no con cajas con sombra. Las tarjetas pierden la sombra difusa (borde XOR sombra).
- Signature move: el hero con la palabra "vida" (o "hoy") en Fraunces italic sobre el acento emerald, con una tarjeta real de la app como protagonista visual inmediata debajo; y la numeración editorial `01 / 02 / 03` en cada sección.

## Typography

- Display: Fraunces (Google Fonts, OFL). Serif variable, editorial, cálida; usada en h1/h2 y palabras clave en italic. Sirve el adjetivo "con carácter".
- Body: Space Grotesk (Google Fonts, OFL). Es la voz de la app: se hereda para mantener la identidad de marca. Geometric sans con personalidad.
- Mono: JetBrains Mono (Google Fonts, OFL). Comandos, números de sección, datos técnicos, versión.
- Scale: ratio 1.333 (Perfect fourth, editorial), base 16px.
  - display: clamp(2.6rem, 6vw, 4.6rem) / 1.05, tracking -0.02em
  - h1: clamp(2rem, 4vw, 3rem) / 1.1
  - h2: clamp(1.5rem, 3vw, 2.1rem) / 1.2
  - h3: 1.15rem / 1.4
  - lead: 1.15rem / 1.65
  - body: 1rem / 1.7
  - small/caption: 0.875rem / 1.5
- Weights: Fraunces 400/500/600 + italic; Space Grotesk 400/500/700; JetBrains Mono 400/600. Measure: 62-70ch en párrafos de sección.

## Color

- Strategy: apropiado al público (cálido, humano, no corporate). Diferenciación: evita la banda índigo/violeta y el blanco puro; base cálida + emerald (marca de la app) + ámbar como segundo acento para detalles editoriales. Distribución 60 neutral / 30 brand / 10 accent.
- Palette light (OKLCH | hex):
  - bg: oklch(0.97 0.008 85) | #f7f5f0 (off-white cálido)
  - surface: oklch(0.95 0.01 85) | #efece4
  - elevated: oklch(0.99 0.004 85) | #fcfbf8
  - fg: oklch(0.22 0.02 80) | #26221c (casi-negro cálido)
  - muted: oklch(0.5 0.02 80) | #6b6459
  - border: oklch(0.87 0.015 85) | #d9d3c6
  - accent (emerald): oklch(0.55 0.13 162) | #0e9a6e
  - accent-strong (hover/dark-text safe): oklch(0.45 0.12 162) | #0b7f5a
  - accent-soft: oklch(0.93 0.05 162) | #dcf2e8
  - accent-fg: oklch(0.99 0 0) | #ffffff
  - gold (2º acento, editorial): oklch(0.78 0.13 80) | #e0a63c
  - success / warning / error: oklch(0.55 0.13 162) | #0e9a6e / oklch(0.72 0.15 75) | #d97e1f / oklch(0.55 0.2 25) | #d33a2b
- Dark mode overrides (diseñado, no invertido):
  - bg: oklch(0.18 0.015 80) | #17150f (casi-negro cálido)
  - surface: oklch(0.22 0.015 80) | #211e17
  - elevated: oklch(0.25 0.015 80) | #2a261e
  - fg: oklch(0.95 0.01 85) | #f2ece0 (off-white)
  - muted: oklch(0.68 0.02 80) | #a79e8d
  - border: oklch(0.32 0.015 80) | #3a352b
  - accent: oklch(0.7 0.13 162) | #3ecf9e
  - accent-soft: oklch(0.28 0.05 162) | #0e3a2c
  - accent-fg: oklch(0.15 0.02 80) | #0d1410
  - gold: oklch(0.8 0.13 80) | #eeb657

## Spacing, radius, shadow

- Spacing base: 8px. Scale: 8/12/16/24/32/48/64/96.
- Radius: <= 2 values. 8px (controles, chips, miniaturas) y 0 (editorial: esquinas vivas en tarjetas de regla). El squircle de la marca no se replica en la landing.
- Shadow approach: defined edge. Reglas editoriales y bordes hairline; NINGUNA sombra difusa en tarjetas de contenido. Solo la elevación sutil del nav sticky y la tarjeta destacada del hero (una sombra corta y dura en acento oscuro, estilo editorial offset, usada una sola vez).

## Layout and composition

- Grid: 12-col editorial con contenedor max 1160px; secciones numeradas 01-06.
- Spacing rhythm: tight within groups (gaps 8-12px), generous between sections (padding 96px vertical).
- Signature layout move: la captura del tablero en vivo como primera "carta" visual justo bajo el hero (full-bleed contenido), y las funcionalidades como filas con regla inferior (no cards), heredando el patrón de EasyZFS que ya validó el usuario.
- Density: airy. Scanning: F en secciones de lectura, Z en hero.
- Responsive: mobile-first; breakpoints 720 / 1024 / 1200.

## Components and states

- Button hierarchy: primary (emerald, filled) para "Instalar"; secondary (outlined) para GitHub/Demo; tertiary (text) para enlaces de sección. States: hover (sombra offset emerald), active, focus-visible (outline 2px accent, offset 2px), disabled (muted).
- Inputs (lang select): label visible, surface bg, border hairline, focus ring accent.
- Tables (comparativa): texto izquierda, símbolos centrados en mono, separadores hairline; la columna propia resaltada en emerald (primera, no centrada).
- Overlays: lightbox de capturas, focus trap + Escape, aria-modal.
- Empty/loading/error: no aplica (landing estática) salvo el estado "Copiado" del botón de comando (feedback inline).
- Focus ring: box-shadow 0 0 0 2px accent, offset 2px, en todos los controles.

## Motion

- Duration scale: fast 150ms (hover, thumbs), normal 280ms (reveal), slow 420ms (hero).
- Easing: --ease-out: cubic-bezier(0.22, 1, 0.36, 1). No bounce, no elastic.
- What animates: transform y opacity solo. reduced-motion: fades swap, contadores muestran valor final, reveal desactivado.
- Signature motion: ninguno llamativo; el reveal editorial (fade+8px) al hacer scroll y los contadores de la demo strip.

## Iconography

- Set: inline SVG propio, stroke 1.75 (heredado de EasyZFS/app), viewBox 24, redondeo en caps/joins round. Coherente en todo el sitio.

## Imagery and illustration

- Mode: capturas reales de la app en modo demo (slider por menú), ES/EN × light/dark → WebP 1440.
- Rules: mismas que la app (tema por localStorage), banner demo oculto en captura, datos de ejemplo (proyectos Casa/Trabajo/Viaje/Huerto).
- Avoid: stock, mockups, ilustración genérica.
- Text-over-image contrast: las capturas van en su propia tarjeta; el texto nunca se solapa con la imagen.

## Dark mode (if in scope)

- Base bg: L 0.18 cálido. fg: L 0.95. elevation ramp: 0.18 / 0.22 / 0.25.
- Accent dark: emerald L 0.70 desaturado. border: L 0.32 (más claro que surface).

## Accessibility

- Contrast: AA verificado en ambos temas (el emerald en light sobre off-white debe ser >=4.5:1 en texto; usar accent-strong para texto pequeño si hace falta).
- Focus: visible, gestionado. Keyboard: slider y lightbox 100% operables.
- Targets: >=24px, 44px preferido (flechas slider, thumbs).
- Color independence: sí (los símbolos ✓/◐/✗/— de la comparativa llevan texto de leyenda). Reduced motion: sí.

## Tokens (source of truth)

```css
:root {
  --font-display: 'Fraunces', Georgia, serif;
  --font-body: 'Space Grotesk', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --bg: #f7f5f0; --surface: #efece4; --elevated: #fcfbf8;
  --fg: #26221c; --muted: #6b6459; --border: #d9d3c6;
  --accent: #0e9a6e; --accent-strong: #0b7f5a; --accent-soft: #dcf2e8; --accent-fg: #ffffff;
  --gold: #e0a63c;
  --radius: 8px; --radius-0: 0;
  --shadow-offset: 5px 5px 0 rgba(38,34,28,0.9);
  --space: 8px;
  --ease-out: cubic-bezier(0.22,1,0.36,1);
}
@media (prefers-color-scheme: dark) { :root { /* overrides dark */ } }
html[data-theme="dark"] { /* overrides dark, fuente de verdad al togglear */ }
```

- Adapter: plain CSS custom properties (estática sin build, patrón landing EasyZFS).

## Cards and surfaces

- Cards/surfaces: borde hairline O regla editorial, NUNCA ambos con sombra. Las funcionalidades usan filas con regla inferior (patrón validado en EasyZFS). La tarjeta destacada del hero es la única con sombra offset en acento.

## Slop audit

- Date: 5-Ago-2026 | Result: pass tras aplicar.
- Notes: sin Inter/Roboto/system como primaria (Fraunces + Space Grotesk heredada con intent claro); sin gradientes índigo/violeta (emerald + gold); sin cards sombreadas genéricas (reglas editoriales); sin pill-everything (eyebrow solo); sin "hero + 3 features + testimonial" como única estructura (hero editorial + slider + comparativa honesta + instalación + acerca funcional); sin em/en dashes en el copy; dark diseñado no invertido; focus visible; contadores con reduced-motion.

## Changelog

- 5-Ago-2026: creación. Landing nueva en `landing/` con las skills landing-page + frontend-design-deslop (dirección Editorial atrevido) + copywriting/product-positioning/product-messaging/icp-persona.
