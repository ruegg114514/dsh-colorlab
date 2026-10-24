# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.3] — 2026-10-24

### Fixed

- **Diff regions turned solid, and the popover text gained dark boxes around
  it.** A regression from v1.1.2.

  v1.1.2 widened the popover selector to `[class*="preview"]` so it would
  cover both class naming formats. But the host has **eight** class names
  containing "preview", and only two of them are popovers — the rest are
  JSON-tree syntax colouring (`_preview_1alm6_221` and friends), which live
  inside diff regions and only declare `color`. Painting them as surfaces put
  a dark box under every JSON value.

  The selector is gone; popovers are now found at runtime instead. A new
  `detectPopoverClasses()` scans the stylesheets and accepts a class only if
  **both** conditions hold: the name matches a popover naming pattern, and the
  rule declares a `background`. A popover has to paint its own surface; an
  inner text block does not. That criterion follows the host implementation
  rather than a class-name list, so a new `previewXxx` class in a future host
  build cannot silently break it again.

  The generated rule now targets exact class names:
  `html[data-dsh-glass] ._preview_38jqx_52` rather than a substring match.
  The `contain` override uses the same detected names.

### Note

Three iterations, each fixing the previous one's failure mode:

| Version | Selector | Outcome |
|---|---|---|
| v1.1.1 | `[class*="_preview_"]` | missed `xpvNua_preview` (no leading underscore) |
| v1.1.2 | `[class*="preview"]` | matched JSON-tree colouring, diff went solid |
| v1.1.3 | runtime detection + exact names | both cases covered |

Substring matching on class names was the wrong tool: too narrow and it misses,
too broad and it hits unrelated elements. The fix was to write the definition of
"is a popover" as an executable condition instead of enumerating names.

## [1.1.2] — 2026-10-24

### Fixed

- **The turn-preview popover still was not blurred.** v1.1.1 injected the right
  rule but it had no effect on this one popover, for two independent reasons:

  1. **Class name format.** The rule matched `[class*="_preview_"]`, which only
     covers CSS Modules hashed names like `_preview_38jqx_52`. The turn
     navigator's popover is `xpvNua_preview` — module name, then element name,
     no leading underscore — so the selector never matched it.
  2. **`contain: layout` blocked the backdrop sampling.** Its parent nav has
     `contain: layout`, which establishes a new containing block and confines
     `backdrop-filter` sampling to that box — and the box is only 28px wide,
     so the blur had nothing to sample. Verified with a side-by-side test page:
     the same markup blurs without `contain`, and does not with it.

  The selector now uses `[class*="preview"]` to cover both naming formats
  (excluding the plugin's own `dmt-` classes), and a new rule clears `contain`
  on any ancestor that directly contains a popover, via `:has()`. The hashed
  class name cannot be hard-coded since it changes on every build.

### Note

v1.1.1 was verified by checking that the CSS rule reached the page — it did.
That turned out not to be sufficient: `contain` makes `backdrop-filter` fail
silently while `background-color` still applies, so the popover looked
"translucent but not frosted" and the injection check passed.

## [1.1.1] — 2026-10-24

### Fixed

- **Hover popovers were not glassed at all.** The file-change diff popover and
  the conversation-history popover — both `position:fixed` elements with no
  `role` attribute — fell outside the `[role="dialog"]` / `[role="menu"]`
  rules, so they rendered as flat opaque boxes over live text. The only code
  that touched them lived behind the *Solid floats* switch (off by default),
  and it pinned them fully opaque rather than glassing them.

  They now follow the glass in two layers: by default they get the same
  delta-alpha compositing and blur as dialogs and menus (with a slightly
  higher +0.03 readability compensation, since these are transient and you
  read them immediately); turning on *Solid floats* still pins them opaque,
  and its rule wins by source order.

  The HoverCard bubble has the same problem in a different shape — its
  background is the hard-coded `--dsw-hovercard-bg: #2C2C2E`, which no token
  override can reach. It is now overridden at the variable itself with a
  translucent glass value, resolved through runtime class detection so the
  hashed class name keeps working across builds.

## [1.1.0] — 2026-10-24

Background ground is now a compositor of its own, the settings page has been
rebuilt around five groups, and a whole class of "controls that did nothing"
is gone.

### Added

- **Background ground modes** — `glow`, `bands` or `blend`:
  - *Glow*: 2–6 light sources, each with its own colour, strength and X/Y
    position, plus overall density (0–100%) and spread (40–140%).
  - *Bands*: 2–6 colour strips, each with its own colour, a cutting angle
    anywhere from 0° to 360°, and an edge-softness slider (0 = hard cut).
  - *Blend*: bands underneath, glow on top.
- **Free-form band angle** — the cut angle is a 0–360° slider instead of four
  presets (165°/135°/90°/0°). Out-of-range values wrap rather than snap back.
- **`preview-ground.html`** — a standalone preview workbench for the background
  ground. No build step; open it in a browser and tune the CSS before touching
  the plugin.
- **Screenshots** for the gradient ground and the contour background, in both
  README languages.

### Changed

- **Glow density ceiling raised from 70% to 100%.** At 70% the lights still
  read as faint; 100% lets a source's centre go fully opaque if you want it.
- **Gradient mode no longer applies the wallpaper post-processing.** The veil
  (31% darkening), `blur(16px)`, `saturate(120%)` and `scale(1.08)` were all
  designed for photo wallpapers — on a generated gradient they ate roughly a
  third of the glow. Contour mode already skipped them; gradient now does too.
  Wallpaper mode is unchanged.
- **Settings page reorganized from 11 groups down to 5:**
  - *Theme* — enable switch
  - *Glass interface* — master switch + background source, permanently visible;
    everything else folds into **Common settings** and **Current background only**
  - *Hand-drawn shapes* — switch
  - *Colour* — syntax palette, prose roles, process rows, accent, interface
    surfaces, 9 prose slots, 18-slot palette
  - *Presets* — save / list
- **"Current background only" renders just the selected source's parameters.**
  Pick gradient and the wallpaper crop controls disappear entirely (they return
  `null`, not `display:none`), and vice versa for contour.
- **All colour controls collected into one group.** They used to be scattered
  across *Theme*, *Process rows* and *Custom palette*.
- **Light-source rows use a two-line layout** (colour + strength on the first
  line, X/Y on the second) so the sliders stop overflowing the panel.

### Removed

Settings that existed but did nothing meaningful:

- **Apply scope** (dark / light / both) — Mariana is a dark theme; the light
  variant is a same-hue brightening, and the three options barely differed.
- **Background variant** (standard / deep / dim) — the three base shades were
  indistinguishable and overlapped with *Surface density*.
- **Accent presets** (teal / orange / blue) — fully covered by the custom
  accent picker, which can pick any colour.
- **Prose brightness** (three steps) — only affected dark appearance and did
  nothing in light, an invisible behaviour not worth a row.
- **Three preview blocks** — prose preview, process-row preview, card preview.
  The real interface already shows the effect; duplicating the structure was
  maintenance cost and visual noise.

Also removed as dead code:

- `glassGlow` — superseded by `glassGroundMode`, zero consumers left.
- `glassAmbientAccent`, `OPTIONS.glassAmbientAccent`, `AMBIENT_ACCENTS` — the
  ambient palette table stopped being read once ground colours became
  user-picked.
- `OPTIONS.glassBandDir` — the four-preset enum, replaced by the slider.
- `previewVars` and the three CSS classes that only served the preview blocks.

### Fixed

- **Wallpaper local-path input and fit dropdown had gone missing.** A
  regression from earlier refactors: the `glassWallpaperPath` field and its
  read path were intact, so nothing errored — you just could not fill it in.
  The link row's hint still said "takes priority over the local path above",
  pointing at a row that no longer existed.
- **Light-source sliders overflowed the panel.** `.dmt-slider` is a fixed
  132px and `.dmt-sliderRow` is `flex:none`, so three sliders plus a colour
  swatch could not fit on one line.
- **Band-mode glow still looked like a hard cut.** The glow branch was
  accidentally including the band layer, so "glow" mode rendered as strips.
  Glow now emits only `radial-gradient`; bands emit only `linear-gradient`;
  both directions are locked by tests.
- **Gradient glow looked much weaker than the preview.** The CSS was
  byte-identical; the difference was the veil and filter layers above.

### Tests

- ~50 new assertions across `glass.test.mjs`, `page.test.mjs` and
  `host.test.mjs`, covering ground modes, per-element colours, angle
  normalisation, settings grouping and control-to-field bindings.
- Mutation testing used throughout: every new assertion was verified to go red
  when the behaviour it guards is broken. Three false-green assertions were
  caught and rewritten this way — the most instructive being a guard check
  that only tested "the string appears in the file", which passed even after
  the guard was replaced with `true`.

---

## [1.0.0] — 2026-10-19

First public release.

### Added

- Mariana (Sublime Text) palette as the default preset.
- Colour engine: 18 adjustable colour slots, 9 Markdown prose roles, saved
  presets, live WCAG contrast hints, light/dark modes.
- Glass interface: wallpaper / generated gradient / procedural contour
  background, delta-alpha tier compositing, per-region density overrides,
  wallpaper fit and crop, text guard halo, auto tone.
- Hand-drawn shape mode.
- Process-row highlighting with per-kind colours.
- Settings panel with live preview and draft-then-apply for palette edits.
