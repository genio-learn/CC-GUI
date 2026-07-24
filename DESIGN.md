---
name: CC-GUI
description: A themeable native shell for managing many Claude coding sessions — one semantic token contract, worn by nineteen editor themes.
colors:
  # Canonical reference values are Catppuccin Mocha (the default/fallback dark
  # theme). These are NOT a fixed palette — they are the 21-token semantic
  # contract every theme fills. Keys are the project's own token names.
  bg-base: "#1e1e2e"
  bg-elevated: "#191926"
  bg-inset: "#11111b"
  border: "#343650"
  border-strong: "#4a4c68"
  surface2: "#5c5f78"
  text: "#e4e8fb"
  text-muted: "#b7bedd"
  text-dim: "#8a90ad"
  overlay1: "#7f849c"
  subtext1: "#bac2de"
  accent: "#8fb8ff"
  success: "#a9e6a4"
  danger: "#f58fab"
  warning: "#f6dd9c"
  attention: "#fab387"
  info: "#cba6f7"
  cyan: "#8fe0ee"
  accent-tool: "#b4befe"
  attn-blocked: "#eba0ac"
  tag-cool: "#94e2d5"
typography:
  display:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  title:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "normal"
  body:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
    letterSpacing: "normal"
  label:
    fontFamily: "IBM Plex Sans, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.05em"
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: "normal"
rounded:
  sm: "7px"
  md: "10px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "14px"
components:
  button-secondary:
    backgroundColor: "{colors.border}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "5px 12px"
  button-danger:
    backgroundColor: "{colors.border}"
    textColor: "{colors.danger}"
    rounded: "{rounded.sm}"
    padding: "5px 12px"
  input-field:
    backgroundColor: "{colors.bg-inset}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "5px 10px"
  status-chip:
    backgroundColor: "{colors.chip-faint-bg}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
    padding: "2px 8px"
  session-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "9px"
    padding: "6px 10px"
  tab-active:
    backgroundColor: "{colors.bg-base}"
    textColor: "{colors.text}"
    padding: "0 8px 0 16px"
---

# Design System: CC-GUI

## Overview

**Creative North Star: "The Working Shell"**

CC-GUI is the shell a developer sits inside all day to run agentic coding. Its
job is to keep many Claude sessions manageable without getting in the way, and
to multiply the work happening inside them — the review screen lets you comment
on a diff and apply feedback in-place instead of round-tripping through GitHub
PRs; the palette and file explorer keep hands on the keyboard. The interface is
a quiet frame around session content and the one signal that matters most:
*what needs you, and what's in progress.* Oversight of everything at once is
secondary — the frame should recede, not demand to be watched.

The system's defining move is that it has **no fixed palette**. The visual
identity is a **21-token semantic contract** (backgrounds, borders, text ramp,
accent, and a set of functional signal colors) that any of nineteen built-in
editor themes — Catppuccin, Tokyo Night, Gruvbox, Nord, Dracula, Everforest,
and more — plus user-authored JSON themes can fill. The same contract themes
three surfaces in lockstep: the CSS chrome, the xterm terminal palette, and the
Shiki diff highlighter. So the "brand" is not a color; it is the *structure* —
the spacing rhythm, the mono-for-data discipline, the tonal layering, the
restraint — that stays constant while the developer swaps the skin to match
their editor. Reference values throughout this document are Catppuccin Mocha,
the default dark theme.

The feel is **refined and restrained**: tight 0.12s transitions, small radii,
1px hairline borders, and semantic state color used sparingly against a calm
neutral ground. Depth is gently layered — surfaces lift a little — but depth is
never allowed to become a feature. Nothing here is decorative for its own sake.

**Key Characteristics:**
- Themeable by contract, not by palette — 21 semantic tokens, 19+ skins, 3 surfaces.
- Keyboard-first, dense, native-desktop chrome; no page scroll, fixed shell.
- Semantic state color carries the signal; neutral chrome carries everything else.
- Mono type is reserved for machine data (diffs, counts, ids, shortcuts).
- Quiet by default; motion and shadow serve legibility, not expression.

## Colors

A calm neutral ground with a single interactive accent and a disciplined set of
functional signal colors. Because every value is a token, describe *roles* — the
hexes below are the Mocha reference and will differ under every other theme.

### Primary
- **Interactive Accent** (`{colors.accent}`, #8fb8ff in Mocha): the one
  interactive/identity hue. Selection left-borders, active tab top-border, focus
  rings, primary affordances, the titlebar mark gradient. Used sparingly — it is
  the signal, not the wallpaper.

### Secondary — Functional signal palette
These encode session and diff state, never mood. They map to session lifecycle
in lockstep across the accent bar, the state pill, and the liveness dot.
- **Success / Running** (`{colors.success}`): a session actively running; merge affordances.
- **Warning / Needs-you** (`{colors.warning}`): finished, waiting, or transient — the "N waiting on you" attention tone.
- **Idle** (`{colors.cyan}`): idle sessions.
- **Danger** (`{colors.danger}`): destructive actions, close/kill, diff deletions.
- **Attention** (`{colors.attention}`) / **Blocked** (`{colors.attn-blocked}`): escalated attention states.
- **Info / Tool** (`{colors.info}`, `{colors.accent-tool}`): tool activity, stack tint, secondary highlight.

### Tertiary — Project identity
- **Project palette** (`{colors.tag-cool}` and the eight `--proj-N` hues):
  a per-project color **hashed from `project_id`** and exposed as `var(--proj-color)`.
  Drives the project dot and the left border of stacked session rows so projects
  stay visually distinct without a hand-picked hue.

### Neutral
- **Backgrounds** — `{colors.bg-base}` (app ground), `{colors.bg-elevated}`
  (titlebar, sidebar, tabs, popovers), `{colors.bg-inset}` (wells, inputs,
  terminal frame, pills). Three tonal steps do most of the depth work.
- **Borders** — `{colors.border}` (hairline dividers), `{colors.border-strong}`
  (emphasis, input strokes, active row), `{colors.surface2}` (raised control fills).
- **Text ramp** — `{colors.text}` (primary) → `{colors.subtext1}` → `{colors.text-muted}`
  → `{colors.text-dim}` → `{colors.overlay1}` (from body copy down to placeholder/disabled).

### Named Rules
**The Token Contract Rule.** There are exactly 21 semantic color tokens. Every
theme — built-in or user — must fill all of them, and every consumer references
`var(--token)`, never a raw hex. A raw hex in a component is a bug: it won't
reskin.

**The Reskinnable Tint Rule.** Derived tints (row hover, selection wash, chip
fills, scrim) are built with `color-mix(in srgb, var(--token) N%, transparent)`,
never a hardcoded `rgba()`. Tints must follow the theme like everything else.

**The State-Color Lockstep Rule.** A session's state color is defined once
(`.state-*` → `--state-color`) and reused by the accent bar, the state pill, and
the dot. running→success, finished/waiting/transient→warning, idle→cyan,
stopped/hibernated→text-dim. They never drift apart.

## Typography

**UI Font:** IBM Plex Sans (self-hosted; falls back to system sans)
**Data / Mono Font:** IBM Plex Mono (self-hosted)
**Terminal Font:** MesloLGS NF Embedded (bundled, ships Nerd-Font glyphs so the
Claude Code status line renders; registered under a distinct family name so it
can't shadow the user's installed copy)

**Character:** IBM Plex is a precise, slightly technical humanist pairing — the
Sans reads as calm modern chrome, the Mono as instrument readout. The two faces
divide the interface cleanly between "words for people" and "data from machines."

### Hierarchy
- **Display** (700, 34px, 1.1, -0.02em): the first-run onboarding hero only.
- **Title** (600, 15px, 1.2): dialog titles, section headings.
- **Body** (400/500, 13px, ~1.4): session rows, menu items, palette rows, most chrome. 500 for emphasis, 600 for the attached/active session title.
- **Label** (600, 11px, uppercase, 0.05em): palette group headers, section field labels, the ESC key hint — small structural signposts.
- **Mono** (400, 11–12px): diff gutters, unread/waiting counters, badges, stack names, `Cmd+K` shortcut glyphs, status pills.

### Named Rules
**The Mono-for-Data Rule.** IBM Plex Mono is reserved for machine-generated or
machine-addressable data: diffs, counts, ids, branch/stack names, keyboard
shortcuts, and pills. Human-authored prose, labels, and chrome are always IBM
Plex Sans. The terminal keeps its own MesloLGS NF stack.

## Layout

A **fixed native-desktop shell**, not a scrolling document. `body` is
`overflow: hidden` and flex-column: a 46px titlebar on top, then a flex `#app`
row filling the rest. The main area shows exactly one view at a time — the
sidebar + terminal pane, the **board** (a full-width session grid with a filter
bar), the **review** diff, or the **detail** pane — mutually exclusive (board
mode hides the others). Within the terminal pane, up to four panes can be split
by dragging a tab into a corner.

Density is high and deliberate: 6–10px row padding, 2–14px gaps, a small fixed
rhythm rather than a generous editorial scale. Overlays are fixed-width and
centered (command palette 480px, ~12vh from top). The layout is **desktop-only**
— it does not reflow to mobile widths; it targets a real window.

## Elevation & Depth

Depth is **gently layered, never a feature.** The primary device is tonal: the
three background steps (`bg-base` / `bg-elevated` / `bg-inset`) plus 1px borders
establish nearly all hierarchy at rest. On top of that, surfaces are allowed a
soft ambient lift so the interface reads as layered rather than papery — but the
shadow stays quiet enough that you notice the structure, not the shadow.

### Shadow Vocabulary
- **Raised** (`--shadow-raised`, `0 8px 24px rgba(0,0,0,0.28)`): context menus, popovers, the command palette box, raised cards.
- **Terminal** (`--shadow-terminal`, `0 8px 30px rgba(0,0,0,0.25)`): the rounded terminal frame floating over the pane.
- **Popover** (`--shadow-popover`, `0 20px 50px rgba(0,0,0,0.5)`): anchored popovers like the theme picker.
- **Dialog** (`--shadow-dialog`, `0 28px 70px rgba(0,0,0,0.6)`): modal dialogs — the deepest lift, for the topmost layer.

### Named Rules
**The Depth-Serves-Legibility Rule.** Shadow scales with how far a surface
floats above the app (menu < terminal < popover < dialog) — it communicates
layer order, nothing more. If a shadow is doing decoration rather than
separating a floating layer, remove it.

## Shapes

Softly rounded and small-scale. The radius scale is `--radius-1` 7px (chips,
small buttons), `--radius-2` 10px (cards, inputs, composer), `--radius-3` 12px
(panels, wells, palette, context menu); session rows sit at 9px; status chips
and attention pills are fully rounded (`999px`). Borders are 1px hairlines by
default. Two recurring silhouettes carry meaning: a **2px accent left border**
marks a selected session row, and a **2px project-color left border** marks
stacked children — a thin colored spine down the left edge rather than an
indent. The titlebar mark is the one gradient in the system (accent→info).

## Components

### Buttons
- **Shape:** 7px radius (`--radius-1`), 1px border.
- **Secondary (default dialog action):** `border` fill, `border-strong` stroke, `text`, `5px 12px` padding; hover lifts the stroke to `text-dim`.
- **Danger:** same shell, `danger` text + stroke — destructive confirmation.
- **Titlebar / icon buttons:** transparent, `border` stroke, `text-dim`; hover brightens text and strengthens the border. 32px tall.
- **Segmented controls** (view mode, theme mode): inset track, active segment fills with `border` (or `accent` for theme mode) — no sliding thumb.

### Chips / Status pills
- **Style:** fully-rounded (`999px`), mono, 11–12px, `2px 8px`. Faint tint (`chip-faint-bg`) by default.
- **State:** the "N waiting on you" attention pill is warning-toned (12% warning fill, 35% warning border) and hidden entirely at zero — a summary, never a control.

### Session row (signature)
- **Shape:** 9px radius, `6px 10px` padding, transparent at rest.
- **States:** hover → 5%-text wash; **selected** → 12%-accent wash + 2px accent left border; **active/attached** → `border-strong` fill and a 600-weight title. Each row carries a leading liveness **dot** whose color follows the State-Color Lockstep Rule.
- **Stacks:** a cascade stack is a bordered group with a faint `info` tint; children indent minimally and wear a project-color left spine.

### Inputs / Fields
- **Style:** `bg-inset` fill, `border-strong` stroke, 8–10px radius, mono or sans by context.
- **Focus:** border shifts to `accent` plus a 3px accent glow ring (`0 0 0 3px` of 22%-accent) — the one consistent focus treatment. Row/tab focus instead uses a 2px accent outline at `-2px` offset.

### Terminal tabs
- **Style:** 44px strip on `bg-elevated`; tabs are `text-muted`, right-divided by hairlines. **Active** tab fills with `bg-base` and gains a 2px accent top-border (reserved as transparent on inactive tabs so switching never shifts layout). Dead sessions render dim + italic. Close (`✕`) hovers to `danger`; a pinned `+` opens a new terminal. Tabs reorder by drag with an inset accent insertion marker.

### Command palette (signature)
- **Overlay:** blurred scrim (`--scrim`, 3px backdrop-blur) with a 480px `bg-elevated` box at 12vh, `--radius-3`, `--shadow-raised`, entering with a 0.13s `overlay-in` fade.
- **Header:** inset bar with a `Cmd+K` glyph, borderless input, and an uppercase ESC hint chip.
- **Rows:** grouped under uppercase `text-dim` labels; a tinted rounded-square icon (tone reuses the status-chip color names) leads each command; the selected/hover row fills with `border`.

### Context menu
- `bg-elevated`, `border-strong` stroke, `--radius-3`, `--shadow-raised`, 12px; items are 7px-radius rows with a wide gap between label and shortcut, hovering to a `border` fill.

## Do's and Don'ts

### Do:
- **Do** reference semantic tokens (`var(--accent)`, `var(--bg-inset)`) for every color — all 21 exist in every theme.
- **Do** build tints and scrims with `color-mix()` off a token so they reskin.
- **Do** use IBM Plex Mono for machine data (diffs, counts, ids, shortcuts) and IBM Plex Sans for everything human.
- **Do** keep transitions fast and small (0.12s ease; 0.13s for overlay entrance) and radii on the 7/10/12 + pill scale.
- **Do** reserve the accent for interaction, selection, and focus — treat it as a scarce signal.
- **Do** scale shadow to a surface's float height (menu < terminal < popover < dialog) and no further.

### Don't:
- **Don't** hardcode a hex or an `rgba()` in a component — it breaks theming.
- **Don't** let depth become decorative: no ambient shadow on flat resting chrome beyond a quiet lift, no gradients except the titlebar mark.
- **Don't** hand-pick a project color — projects hash to `--proj-N`; consume `var(--proj-color)`.
- **Don't** break the State-Color Lockstep — a session's dot, pill, and bar share one `--state-color`.
- **Don't** design for mobile reflow or a scrolling page; this is a fixed desktop window with `overflow: hidden`.
- **Don't** add chrome that competes with session content for attention — the shell recedes.
