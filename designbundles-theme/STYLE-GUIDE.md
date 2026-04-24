# Design Bundles — Brand Style Guide

> **Purpose:** This is the single source of truth for all Design Bundles visual styling. Every new app, feature, micro-site, or internal tool must follow the rules in this document so that everything we ship looks and feels like it belongs to the same brand.
>
> **How to use it:** Before writing any UI code, read the relevant sections below. Copy colour tokens, font stacks, and component patterns directly from here. If something isn't covered, add it — this is a living document.

---

## 1. Brand Identity

**Brand name:** Design Bundles
**Tone:** Warm, premium, approachable — creative marketplace energy with a refined, editorial feel.

### 1.1 Logo

We have two logo variants stored in the project root:

| Variant | File | Use when… |
|---------|------|-----------|
| Primary (Plum Wine) | `design-bundles-purple-logo.svg` | Light or neutral backgrounds |
| White | `white-db-logo.svg` | Dark backgrounds (plum-wine-800+, sage-gray-800+, or any dark overlay) |

**Logo rules:**

- Always maintain clear space around the logo equal to at least the height of the "D" in the wordmark.
- Never stretch, rotate, recolour, or add effects (drop-shadows, glows, outlines) to the logo.
- Minimum display width: 120 px on screen.
- When placing the logo on a photograph, use the white variant over a semi-transparent dark overlay to guarantee contrast.

---

## 2. Colour System

### 2.1 Palette Overview

Our palette is broken into **primary**, **secondary**, **neutral**, **semantic**, and **utility** groups.

#### Primary Colour — Plum Wine

Plum Wine is the heart of the brand. Use it for headlines, key UI elements, CTAs, and anywhere you want to say "this is Design Bundles."

| Token | Hex |
|-------|-----|
| plum-wine/50 | `#F4EFF3` |
| plum-wine/100 | `#EBDFE9` |
| plum-wine/200 | `#DCC5D6` |
| plum-wine/300 | `#C5A1BC` |
| plum-wine/400 | `#B183A4` |
| plum-wine/500 | `#996688` |
| plum-wine/600 | `#825471` |
| plum-wine/700 | `#6D475E` |
| plum-wine/800 | `#4A3241` |
| plum-wine/900 | `#36212E` |

#### Secondary Colours

These complement Plum Wine and are used for accents, illustrations, and supporting UI.

**Sage Gray**

| Token | Hex |
|-------|-----|
| sage-gray/50 | `#EBEDEC` |
| sage-gray/100 | `#D6DCD8` |
| sage-gray/200 | `#BBC4BE` |
| sage-gray/300 | `#8D9B92` |
| sage-gray/400 | `#6C7B72` |
| sage-gray/500 | `#56635B` |
| sage-gray/600 | `#464F49` |
| sage-gray/700 | `#3A413D` |
| sage-gray/800 | `#313633` |
| sage-gray/900 | `#181B19` |

**Dusty Rose**

| Token | Hex |
|-------|-----|
| dusty-rose/50 | `#F9EAEB` |
| dusty-rose/100 | `#F3D8DC` |
| dusty-rose/200 | `#E8B4BC` |
| dusty-rose/300 | `#DC909D` |
| dusty-rose/400 | `#CC677C` |

**Soft Linen**

| Token | Hex |
|-------|-----|
| soft-linen/50 | `#F4E9DC` |
| soft-linen/100 | `#EAD5BE` |
| soft-linen/200 | `#DCB795` |
| soft-linen/300 | `#CD946A` |
| soft-linen/400 | `#C3794C` |

#### Background Colours

| Token | Hex | Usage |
|-------|-----|-------|
| alabaster-white/50 | `#FAF7F2` | Highlighted sections, feature cards, callout areas |
| pearl-white/50 | `#FAFAF9` | Main site / app background |

#### Neutrals

| Token | Hex |
|-------|-----|
| neutral/50 | `#FAFAFA` |
| neutral/100 | `#F5F5F5` |
| neutral/200 | `#E5E5E5` |
| neutral/300 | `#D4D4D4` |
| neutral/400 | `#A3A3A3` |
| neutral/500 | `#737373` |
| neutral/600 | `#525252` |
| neutral/700 | `#404040` |
| neutral/800 | `#262626` |
| neutral/900 | `#171717` |

#### Semantic / Accent Colours

**Sunset Red** — errors, destructive actions, sale badges

| Token | Hex |
|-------|-----|
| sunset-red/50 | `#FFE1E2` |
| sunset-red/100 | `#FFC7C9` |
| sunset-red/200 | `#FFA0A3` |
| sunset-red/300 | `#FF5A5F` |
| sunset-red/400 | `#F83B41` |
| sunset-red/500 | `#E51D23` |
| sunset-red/600 | `#C11419` |
| sunset-red/700 | `#A01418` |
| sunset-red/800 | `#84181B` |
| sunset-red/900 | `#480709` |

**Royal Violet** — links, informational highlights, premium badges

| Token | Hex |
|-------|-----|
| royal-violet/50 | `#E1E2FE` |
| royal-violet/100 | `#C8CAFD` |
| royal-violet/200 | `#A7A7FA` |
| royal-violet/300 | `#8C84F5` |
| royal-violet/400 | `#7B68EE` |
| royal-violet/500 | `#6B4AE1` |
| royal-violet/600 | `#5D3BC7` |
| royal-violet/700 | `#4B33A0` |
| royal-violet/800 | `#40307F` |
| royal-violet/900 | `#261C4A` |

**Lemon Zest** — warnings, star ratings, promotional highlights

| Token | Hex |
|-------|-----|
| lemon-zest/50 | `#FCFFC2` |
| lemon-zest/100 | `#FEFF89` |
| lemon-zest/200 | `#FFFA62` |
| lemon-zest/300 | `#FDEC12` |
| lemon-zest/400 | `#ECD106` |
| lemon-zest/500 | `#CCA502` |
| lemon-zest/600 | `#A37605` |
| lemon-zest/700 | `#865C0D` |
| lemon-zest/800 | `#724B11` |
| lemon-zest/900 | `#432805` |

#### Alpha / Overlay Colours

Use these for overlays, scrims, and translucent effects.

**Alpha Black** (`#000000` at given opacity)

| Token | Opacity |
|-------|---------|
| alpha-black/50 | 5% |
| alpha-black/100 | 10% |
| alpha-black/200 | 20% |
| alpha-black/300 | 30% |
| alpha-black/400 | 40% |
| alpha-black/500 | 50% |
| alpha-black/600 | 60% |
| alpha-black/700 | 70% |
| alpha-black/800 | 80% |
| alpha-black/900 | 90% |

**Alpha White** (`#FFFFFF` at given opacity)

| Token | Opacity |
|-------|---------|
| alpha-white/50 | 5% |
| alpha-white/100 | 10% |
| alpha-white/200 | 20% |
| alpha-white/300 | 30% |
| alpha-white/400 | 40% |
| alpha-white/500 | 50% |
| alpha-white/600 | 60% |
| alpha-white/700 | 70% |
| alpha-white/800 | 80% |
| alpha-white/900 | 90% |

### 2.2 Colour Usage Rules

- **Text:** Use `plum-wine/900` (`#36212E`) for all headings and body text on light backgrounds. For text on dark backgrounds, use `pearl-white/50` or `#FFFFFF`.
- **Primary CTA buttons:** `plum-wine/700` background, white text. Hover state: `plum-wine/800`.
- **Backgrounds:** `pearl-white/50` for the main canvas; `alabaster-white/50` for highlighted sections, cards, and callout panels.
- **Borders & dividers:** `neutral/200` for light borders; `neutral/300` for slightly more prominent dividers.
- **Disabled states:** `neutral/300` background, `neutral/400` text.
- **Error states:** `sunset-red/500` for text, `sunset-red/50` for background tints.
- **Success states:** `sage-gray/500` for text/icons, `sage-gray/50` for background tints.
- **Warning states:** `lemon-zest/500` for text/icons, `lemon-zest/50` for background tints.

---

## 3. Typography

### 3.1 Font Families

| Role | Family | Source | Files |
|------|--------|--------|-------|
| Headings | **EB Garamond** | Google Fonts / local | `EB_Garamond/` folder (variable + static weights) |
| Body | **Figtree** | Google Fonts / local | `Figtree/` folder (variable + static weights) |

**CSS font stacks:**

```css
--font-heading: 'EB Garamond', Georgia, 'Times New Roman', serif;
--font-body: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
```

### 3.2 Loading Fonts Locally

Both font families ship as variable fonts. For new apps, prefer the variable font files for smaller bundle size:

```
EB_Garamond/EBGaramond-VariableFont_wght.ttf
EB_Garamond/EBGaramond-Italic-VariableFont_wght.ttf
Figtree/Figtree-VariableFont_wght.ttf
Figtree/Figtree-Italic-VariableFont_wght.ttf
```

Example `@font-face` declarations:

```css
@font-face {
  font-family: 'EB Garamond';
  src: url('./fonts/EBGaramond-VariableFont_wght.ttf') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: 'Figtree';
  src: url('./fonts/Figtree-VariableFont_wght.ttf') format('truetype');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
```

### 3.3 Type Scale

| Element | Family | Weight | Style | Size | Line Height | Colour | Tailwind equivalent |
|---------|--------|--------|-------|------|-------------|--------|---------------------|
| H1 (main heading) | EB Garamond | 400 | Regular | 56px | 1.15 | plum-wine/900 | `font-heading text-[56px] leading-tight font-normal` |
| H2 | EB Garamond | 400 | Regular | 40px | 1.2 | plum-wine/900 | `font-heading text-[40px] leading-snug font-normal` |
| H3 | EB Garamond | 400 | Regular | 32px | 1.25 | plum-wine/900 | `font-heading text-[32px] leading-snug font-normal` |
| H4 | EB Garamond | 400 | Regular | 24px | 1.3 | plum-wine/900 | `font-heading text-2xl leading-normal font-normal` |
| Body | Figtree | 400 | Regular | 16px | 1.6 | plum-wine/900 | `font-body text-base leading-relaxed font-normal` |
| Body small | Figtree | 400 | Regular | 14px | 1.5 | plum-wine/900 | `font-body text-sm leading-normal font-normal` |
| Caption | Figtree | 400 | Regular | 12px | 1.4 | neutral/500 | `font-body text-xs leading-snug font-normal text-neutral-500` |
| Button label | Figtree | 600 | SemiBold | 16px | 1 | inherit | `font-body text-base font-semibold` |
| Nav link | Figtree | 500 | Medium | 16px | 1 | plum-wine/900 | `font-body text-base font-medium` |

> **Note:** The H2–H4 and smaller sizes are suggested defaults. Adjust them per project if needed, but always keep EB Garamond for headings and Figtree for body.

---

## 4. Spacing & Layout

We follow the **Tailwind CSS default spacing scale** (4 px base unit). Key values used most often:

| Token | Value | Common use |
|-------|-------|------------|
| 1 | 4px | Tight inner gaps |
| 2 | 8px | Icon-to-text gaps, tight padding |
| 3 | 12px | Small padding |
| 4 | 16px | Standard padding, card inner padding |
| 6 | 24px | Section inner padding |
| 8 | 32px | Card gaps, larger padding |
| 12 | 48px | Section spacing |
| 16 | 64px | Major section breaks |
| 24 | 96px | Page-level vertical rhythm |

**Max content width:** `1280px` (`max-w-7xl` in Tailwind) — centred on the page.

---

## 5. Components

### 5.1 Buttons

All buttons use **fully rounded / pill** shape (`rounded-full` in Tailwind).

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| **Primary CTA** | `plum-wine/700` | `#FFFFFF` | none | bg → `plum-wine/800` |
| **Secondary** | transparent | `plum-wine/700` | 1px `plum-wine/700` | bg → `plum-wine/50` |
| **Ghost / Tertiary** | transparent | `plum-wine/700` | none | bg → `plum-wine/50` |
| **Destructive** | `sunset-red/500` | `#FFFFFF` | none | bg → `sunset-red/600` |
| **Disabled** | `neutral/200` | `neutral/400` | none | — (no hover) |

**Button sizing:**

| Size | Padding | Font size |
|------|---------|-----------|
| Small | `px-4 py-1.5` | 14px |
| Default | `px-6 py-2.5` | 16px |
| Large | `px-8 py-3.5` | 18px |

### 5.2 Cards

- Background: `alabaster-white/50` or `#FFFFFF`
- Border: `1px solid neutral/200`
- Border radius: `rounded-2xl` (16px)
- Shadow: `shadow-sm` (Tailwind default)
- Hover: lift with `shadow-md` + slight translate-y (`-translate-y-0.5`)
- Inner padding: `p-6`

### 5.3 Input Fields

- Background: `#FFFFFF`
- Border: `1px solid neutral/300`
- Border radius: `rounded-full` (pill)
- Padding: `px-5 py-3`
- Font: Figtree 400, 16px
- Focus: border becomes `plum-wine/500`, add `ring-2 ring-plum-wine/200`
- Error: border becomes `sunset-red/500`, add `ring-2 ring-sunset-red/100`

### 5.4 Badges & Tags

- Border radius: `rounded-full`
- Padding: `px-3 py-1`
- Font: Figtree 500, 12px
- Default: `plum-wine/50` bg, `plum-wine/700` text
- Sale: `sunset-red/50` bg, `sunset-red/700` text
- Premium: `royal-violet/50` bg, `royal-violet/700` text
- New: `lemon-zest/50` bg, `lemon-zest/700` text

### 5.5 Links

- Colour: `plum-wine/700`
- Underline on hover (no underline by default)
- Visited colour: `plum-wine/500`

---

## 6. Shadows

Following Tailwind defaults:

| Token | Value | Usage |
|-------|-------|-------|
| `shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Cards at rest, dropdowns |
| `shadow` | `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)` | Elevated cards |
| `shadow-md` | `0 4px 6px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06)` | Card hover, popovers |
| `shadow-lg` | `0 10px 15px rgba(0,0,0,0.1), 0 4px 6px rgba(0,0,0,0.05)` | Modals, overlays |

---

## 7. Iconography

- **Style:** Outlined, not filled. Use a consistent icon set (recommended: Lucide or Phosphor icons).
- **Size:** Default 20px (match body text), 24px for nav/toolbar.
- **Colour:** Inherit from text colour (`currentColor`).
- **Stroke width:** 1.5px–2px.

---

## 8. Border Radius Reference

| Element | Radius | Tailwind |
|---------|--------|----------|
| Buttons | Fully rounded | `rounded-full` |
| Input fields | Fully rounded | `rounded-full` |
| Cards | 16px | `rounded-2xl` |
| Badges / tags | Fully rounded | `rounded-full` |
| Modals | 16px | `rounded-2xl` |
| Avatars | Fully rounded (circle) | `rounded-full` |
| Tooltips | 8px | `rounded-lg` |

---

## 9. Tailwind Config Snippet

Drop this into your `tailwind.config.js` (or `tailwind.config.ts`) to register the Design Bundles tokens:

```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  theme: {
    extend: {
      fontFamily: {
        heading: ['"EB Garamond"', 'Georgia', '"Times New Roman"', 'serif'],
        body: ['Figtree', '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'sans-serif'],
      },
      colors: {
        'plum-wine': {
          50: '#F4EFF3',
          100: '#EBDFE9',
          200: '#DCC5D6',
          300: '#C5A1BC',
          400: '#B183A4',
          500: '#996688',
          600: '#825471',
          700: '#6D475E',
          800: '#4A3241',
          900: '#36212E',
        },
        'sage-gray': {
          50: '#EBEDEC',
          100: '#D6DCD8',
          200: '#BBC4BE',
          300: '#8D9B92',
          400: '#6C7B72',
          500: '#56635B',
          600: '#464F49',
          700: '#3A413D',
          800: '#313633',
          900: '#181B19',
        },
        'dusty-rose': {
          50: '#F9EAEB',
          100: '#F3D8DC',
          200: '#E8B4BC',
          300: '#DC909D',
          400: '#CC677C',
        },
        'soft-linen': {
          50: '#F4E9DC',
          100: '#EAD5BE',
          200: '#DCB795',
          300: '#CD946A',
          400: '#C3794C',
        },
        'alabaster-white': {
          50: '#FAF7F2',
        },
        'pearl-white': {
          50: '#FAFAF9',
        },
        'sunset-red': {
          50: '#FFE1E2',
          100: '#FFC7C9',
          200: '#FFA0A3',
          300: '#FF5A5F',
          400: '#F83B41',
          500: '#E51D23',
          600: '#C11419',
          700: '#A01418',
          800: '#84181B',
          900: '#480709',
        },
        'royal-violet': {
          50: '#E1E2FE',
          100: '#C8CAFD',
          200: '#A7A7FA',
          300: '#8C84F5',
          400: '#7B68EE',
          500: '#6B4AE1',
          600: '#5D3BC7',
          700: '#4B33A0',
          800: '#40307F',
          900: '#261C4A',
        },
        'lemon-zest': {
          50: '#FCFFC2',
          100: '#FEFF89',
          200: '#FFFA62',
          300: '#FDEC12',
          400: '#ECD106',
          500: '#CCA502',
          600: '#A37605',
          700: '#865C0D',
          800: '#724B11',
          900: '#432805',
        },
      },
    },
  },
};
```

### CSS Custom Properties (alternative)

If you're not using Tailwind, add these to your `:root`:

```css
:root {
  /* Fonts */
  --font-heading: 'EB Garamond', Georgia, 'Times New Roman', serif;
  --font-body: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

  /* Primary */
  --plum-wine-50: #F4EFF3;
  --plum-wine-100: #EBDFE9;
  --plum-wine-200: #DCC5D6;
  --plum-wine-300: #C5A1BC;
  --plum-wine-400: #B183A4;
  --plum-wine-500: #996688;
  --plum-wine-600: #825471;
  --plum-wine-700: #6D475E;
  --plum-wine-800: #4A3241;
  --plum-wine-900: #36212E;

  /* Backgrounds */
  --bg-main: #FAFAF9;           /* pearl-white/50 */
  --bg-highlight: #FAF7F2;      /* alabaster-white/50 */

  /* Text */
  --text-primary: #36212E;      /* plum-wine/900 */
  --text-secondary: #737373;    /* neutral/500 */
  --text-on-dark: #FAFAF9;      /* pearl-white/50 */
}
```

---

## 10. Quick Reference: "Cheat Sheet"

When building a new page or component, follow this checklist:

1. **Background** → `pearl-white/50` for the page, `alabaster-white/50` for highlighted sections.
2. **Headings** → EB Garamond, weight 400, `plum-wine/900`.
3. **Body text** → Figtree, weight 400, 16px, `plum-wine/900`.
4. **Primary button** → Pill shape, `plum-wine/700` fill, white text.
5. **Cards** → White or alabaster bg, `rounded-2xl`, `shadow-sm`, hover lifts to `shadow-md`.
6. **Inputs** → Pill shape, `neutral/300` border, plum-wine focus ring.
7. **Links** → `plum-wine/700`, underline on hover.
8. **Errors** → Sunset Red. **Warnings** → Lemon Zest. **Success** → Sage Gray.
9. **Icons** → Outlined, `currentColor`, 20px default.
10. **Spacing** → Tailwind defaults, 4px base unit.

---

## 11. File & Folder Structure Reference

```
designbundles-theme/
├── STYLE-GUIDE.md                          ← This file
├── design-bundles-purple-logo.svg          ← Primary logo (plum wine)
├── white-db-logo.svg                       ← White logo (for dark backgrounds)
├── EB_Garamond/
│   ├── EBGaramond-VariableFont_wght.ttf
│   ├── EBGaramond-Italic-VariableFont_wght.ttf
│   └── static/                             ← Individual weight .ttf files
└── Figtree/
    ├── Figtree-VariableFont_wght.ttf
    ├── Figtree-Italic-VariableFont_wght.ttf
    └── static/                             ← Individual weight .ttf files
```

---

## Changelog

| Date | Change | Author |
|------|--------|--------|
| 2026-03-19 | Initial style guide created | Alex |

---

*This is a living document. When you add new patterns, components, or rules, update the relevant section and log it in the changelog above.*
