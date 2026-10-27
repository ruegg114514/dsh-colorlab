# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.12] — 2026-10-27

### Fixed

- **Late-loading plugin stylesheets never triggered a rescan.** The popover
  class scan only ran inside `syncGlassSheet` / `syncCardSheet`, which fire on
  **settings changes**. A plugin whose CSS is lazy-injected — the team roster
  panel loads its stylesheet only when the roster tab is first opened — never
  caused a rescan, so its class could never enter the glass sheet. A
  MutationObserver on the document tree (300ms coalesced, the pattern the
  LaTeX sheet already uses) now drives `refreshPopoverClasses()`, and a
  changed result rebuilds the sheet.

- **contract.test misreported a duplicate loader entry.** The YAML `insert:`
  block parser never exited the block when a top-level `- id:` entry followed
  it — its exit condition excluded lines starting with `- `, which is exactly
  how every top-level entry begins. The plugin's own config-override row was
  then misread as an insert row, making normal user settings look like a
  duplicate mount.

### Note

The reported "team panel has no glass" is **not** a selector failure: the
panel carries `role="dialog"`, which the glass sheet matches unconditionally.
With this profile's settings (surface density 0, float increment 0) the
computed overlay alpha is 0.22 — nearly transparent by construction. The fix
is the panel-density independent tier, not a new selector.

## [1.1.11] — 2026-10-27

### Fixed

- **The agent-team hover panel was still transparent — v1.1.10 had fixed the
  wrong element.** `jIHOOq_frame` is the subagent read-only input card; the
  panel in the screenshot is the team roster panel (
  `.EBLgjq_panel` from the experimental agent-team plugin). Its host CSS has
  `position:fixed` + radius + shadow but **no background at all** — the fill
  lives on each member row. The class-name criterion (contains preview/float)
  cannot see it.

  A second detection criterion was added: any class whose rule declares
  `position:fixed` + `border-radius` + `box-shadow` (and is not a full-window
  inset overlay) is a floating panel. Scanned against the whole host: 13
  classes match, all genuinely floating, zero false positives.

- **The detection never actually found the late panels (the real "still
  broken").** Two timing traps stacked on top of the wrong target:
  1. scanning stopped permanently once *any* results existed — but the team
     panel's stylesheet arrives later than startup (experimental plugin), so
     it was always missed;
  2. the old skip-guard required a non-empty result, so every startup
     `applyNow` (every 250ms) burned scan budget while finding nothing — the
     60-attempt budget was exhausted before the plugin's sheet even existed.

  `refreshPopoverClasses()` replaces both call sites: it skips only when the
  stylesheet **count is unchanged** (no budget burn on idle polls), rescans
  and **merges** when the count changes (late sheets join, HMR sheet swaps
  keep old results), and the budget moved 60 → 400 (the host injects ~200
  sheets during startup alone).

- **Switching wallpaper paths still flashed the gradient first (regression
  from v1.1.10's fix).** While a new wallpaper is loading, the paint now
  keeps the current picture instead of falling back to gradient; the fetch
  completion repaints.

### Tests

Behavioral tests drive the real timing scenarios (late sheet arrival, 450
idle polls, 250 startup injections, sheet replacement) against an injected
document, with `resetPopoverScan()` isolating module state. Mutation-tested:
the old guard, the 60 budget, and overwrite-instead-of-merge each turn
assertions red. (The first version of these tests only checked that functions
exist — every mutation passed green.)

## [1.1.10] — 2026-10-24

### Fixed

- **After a restart, the conversation failed to auto-load until you clicked
  into another session and back.** The input-card seat lift was *throttled*
  (fire 250ms after a DOM change regardless of what else is happening). During
  streaming or auto-load, React commits run back to back, so the lift landed
  mid-render: React then removed a subtree while believing the seat was still
  inside it, hit a NotFoundError, and the error boundary unmounted the whole
  conversation. The lift is now a real debounce — every DOM change pushes the
  timer back and it only fires once the tree has been quiet for 600ms.

- **The subagent hover card was fully transparent instead of glass.**
  `[class*="_frame"]{background:transparent}` — meant for the layout frame —
  also matched ten other `_frame` classes in the host, including the
  subagent read-only card, the document preview frame and the browser panel,
  all of which paint their own background. The rule now additionally requires
  `[style*="grid-template-columns"]`, which only the layout frame carries.
  The title-strip `::before` rule got the same qualifier (it used to add a
  40px gradient strip inside those cards too).

- **Switching the background to gradient needed two clicks.** The wallpaper
  paint branch only checked `status === 'ready'`, which was still true from
  the previous mode when the first click ran — so the first click repainted
  the old wallpaper and only the second reached the gradient. The check now
  requires the current mode to actually be wallpaper. The bleed layer (the
  blurred fill image, wallpaper-only) is also torn down on every non-wallpaper
  paint.

### Tests

Seven new assertions plus four updated ones. Mutation-tested: reverting each
fix turns 4 / 2 / 3 assertions red respectively.

## [1.1.9] — 2026-10-24

### Fixed

- **Cards grew "boxes inside boxes"**: the deliverable-file and plan cards
  showed outlined, shadowed strips across their title row, description row and
  even the grid container around the cards.

  The card glass rule matched with `[class*="flL80G_file"]` — a substring
  match. CSS Modules give every inner element of the same component a shared
  prefix (`flL80G_fileBody`, `flL80G_fileName`, `flL80G_fileIcon`;
  `KuQXFq_cardTitle`, `cardOpen`, and even `KuQXFq_cards` — the grid
  container), so the haze, border and shadow landed on each of those rows too.

  Fixed by switching the six card prefixes to `[class~="…"]` (whole-word
  class match). `bubble` deliberately keeps `*=`: message bubbles carry
  per-package hashes in their token (`cJsG2q_bubble`, `v1fjQa_bubble`) that
  must not be hard-coded, and no `bubbleXxx` inner elements exist in the host.

  This is the third instance of the same class of mistake (the popover haze
  selector had the identical problem in v1.1.7): substring matching is unsafe
  against CSS Modules naming because inner elements share the owner's prefix.
  Wherever the exact token is known, use `~=`.

### Tests

13 assertions: each of the six prefixes verified to use `~=` and not `*`;
`bubble` verified to keep `*=`. Mutation (reverting to `*=`) turns all 13 red.

## [1.1.8] — 2026-10-24

### Added

- **Background brightness now applies to wallpaper mode too.** It was
  gradient-only before.

  The two sources need different implementations but share one meaning:

  | Source | Implementation | 50 = as-is | Extremes |
  |---|---|---|---|
  | Gradient | `mixTowards()` shifts the generated base colour | middle | 0 pure black / 100 pure white (deliberate; the ambience layer fades with it) |
  | Wallpaper | CSS `brightness()`, on the same filter chain as blur and saturate | 1.0 | 0 full black / 100 doubles |

  Wallpaper stops at doubling rather than pure white — pure white would erase the
  photo's detail, whereas gradient reaching pure white is intentional.

  Contour mode is unaffected: its line colour comes straight from the accent
  colour, so brightness would only distort it, same reasoning as `saturate`.

  The settings row is now shared by both sources instead of being gated on
  gradient alone.

### Tests

Four new assertions on the filter chain and conversion formula, plus one on the
settings guard covering both sources. Mutation-tested: making brightness a no-op
turns 3 assertions red; restricting the settings row back to gradient turns 2 red.

## [1.1.7] — 2026-10-24

### Changed

- **Nested haze reduced from a third to an eighth.** v1.1.6 gave code blocks
  `haze / 3`, which combined to 10.5% — visibly denser than the 8% single-layer
  baseline. It is now `haze / 8`, combining to 8.9%, which matches the
  surrounding surfaces.

  | Divisor | Child | Combined | |
  |---|---|---|---|
  | 1 | 8.00% | 15.36% | two full layers — the original bug |
  | 3 | 2.67% | 10.45% | v1.1.6 — still too dense |
  | **8** | **1.00%** | **8.92%** | **matches the baseline** |

  The earlier two attempts each had an unclear target: v1.1.5 optimised for
  "don't stack too thick" and landed on zero, leaving that surface with no haze
  at all; v1.1.6 optimised for "the haze should be visible" and overshot. The
  right target is **combined density close to the single-layer baseline** — the
  child only needs enough to avoid reading as absent.

  The test now bounds it from both sides: `0.005 ≤ haze < 0.02`. Below the
  lower bound it is effectively invisible; above the upper bound the combined
  value exceeds 9.8% and reads denser than everything else.

## [1.1.6] — 2026-10-24

### Fixed

- **Code blocks lost their frosted haze entirely.** v1.1.5 removed the haze
  from nested surfaces to stop it stacking — but removing it is not the same as
  reducing it.

  The haze is a white overlay, so two layers combine as `1-(1-a)(1-b)`:

  | Parent | Child | Combined | Look |
  |---|---|---|---|
  | 8% | 8% | 15.4% | too heavy (the original bug) |
  | 8% | **0%** | 8% | **child does not whiten at all — haze is gone** |
  | 8% | 2.7% | 10.2% | matches the surrounding surfaces |

  The reason zero does not work: a code block paints its own fairly opaque
  surface, which covers the parent's haze. Without a layer of its own, that
  surface genuinely has no haze.

  Nested surfaces now get a third of the configured value. A third rather than
  half because a code block's own fill is one tier more opaque than a card's, so
  the haze carries less visual weight on it — full value reads too white, zero
  reads as absent.

### Note

The name `glassSurfaceFlat` is now slightly misleading, since the surface it
produces is no longer flat. It was kept to avoid touching every call site; the
comment above it states what it actually produces.

## [1.1.5] — 2026-10-24

### Fixed

- **Code blocks looked noticeably whiter and duller than other glass
  surfaces.** The frosted haze is a translucent white gradient defined on the
  shared `glassSurface` constant, which every glass surface used — including
  nested ones. A code block sits inside a card or column, so the haze stacked:
  `1 - (1-0.08)² ≈ 15.4%`, nearly double the configured value.

  Split into two constants by nesting level:

  | Constant | Haze | Used by |
  |---|---|---|
  | `glassSurface` | yes | outermost surfaces — columns, cards, dialogs, popovers, composer |
  | `glassSurfaceFlat` | no | nested surfaces — code blocks, `pre`, inline code |

  Both keep the `box-shadow` and `border`; those draw on the element's own
  edges and do not accumulate brightness, so stacking them is harmless.

  Lowering the global haze value would have been the wrong fix: it exists to
  give the outermost layer its material feel, and thinning it everywhere would
  make single-layer surfaces too flat.

### Note

Detecting this needed the generated stylesheet rather than the source: the
duplication only appears once you list which selectors end up carrying the
haze gradient.

## [1.1.4] — 2026-10-24

### Fixed

- **The turn-preview popover had no blur again.** A one-line wiring bug
  introduced in v1.1.3.

  `buildGlassSheet` gained a sixth parameter for the detected popover class
  names, but **the real call site never passed it**. The edit had been applied
  to an identically-worded string in the module's export block rather than to
  the function that actually builds the stylesheet. The rule-generation logic
  was correct and its unit tests passed — the rule simply never received any
  class names at runtime, so it was never emitted.

  All call sites now pass the parameter, and a test asserts that every runtime
  call site includes it — mutation-tested by removing the argument, which turns
  the assertion red.

- **Detection now also runs inside `syncGlassSheet`, not only `syncCardSheet`.**
  `syncCardSheet` runs early in startup, when the host may not have injected
  all of its stylesheets yet; detection would return nothing and there was no
  second attempt. `syncGlassSheet` now retries (bounded at 60 attempts, after
  which the result is cached), so a late-arriving stylesheet still gets picked
  up.

- The status object now exposes `popovers` — the number of popover classes
  detected. `0` means detection has not succeeded yet, which makes this class
  of failure visible instead of silent.

### Note

This is the fourth release in a row touching the same feature, and each time
the failure was different:

| Version | What broke |
|---|---|
| v1.1.1 | selector too narrow — missed `xpvNua_preview` |
| v1.1.2 | selector too broad — hit JSON-tree colouring, diff went solid |
| v1.1.3 | detection correct, but the call site never passed the result |
| v1.1.4 | wiring fixed; detection also retries and is observable |

The recurring pattern: **the unit-tested piece kept passing while the
integration point silently dropped the data.** The test added here asserts the
call-site wiring directly, not just the builder's behaviour.

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
