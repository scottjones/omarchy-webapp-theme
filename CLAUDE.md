# CLAUDE.md

Guidance for working in this repo. Keep it short; update it when the architecture changes.

## What this is

A small **Manifest V3 browser extension** (Brave/Chrome/Chromium) that makes
web apps follow the current [Omarchy](https://omarchy.org/) theme. One
app-agnostic **engine** + one **pack per site**: Slack (`content.js`, the full
pack — repaints chrome/sidebar/message pane and auto-flips Slack's Light/Dark
Color Mode), WhatsApp Web (`whatsapp.js`, declarative), GitHub (`github.js`,
declarative Primer tokens), Linear (`linear.js`), Discord (`discord.js`),
Outlook Web (`outlook.js`, Fluent v9 tokens), Notion (`notion.js`,
`--c-`/`--ca-` tokens + a Prism syntax palette), and HEY email + calendar
(`hey.js`, one pack for both). A **bash
native-messaging host** reads the active Omarchy theme from
`~/.local/state/omarchy/current/` and pushes theme changes to the extension
the moment they land. **Requires Omarchy 4+.**

This is end-user desktop tooling, not a web service. There is no build step, no
package manager, and no test suite — it's plain JS plus a dependency-free bash
script.

## Layout

- `extension/` — the unpacked extension
  - `omarchy-colors.js` / `omarchy-surfaces.js` / `omarchy-runtime.js` — the
    app-agnostic engine (loaded before `content.js`, shares its scope): color
    helpers (`relLuminance` linearizes channels per WCAG, `contrastRatio`,
    `alphaForContrast`, `inkOn` for ink that rides on a saturated fill,
    `toTriplet` for triplet-valued design tokens),
    `deriveSurfaces()` (the theme→surfaces contract), and the `OmarchyTheme`
    registry that receives themes and dispatches to the registered pack.
    `sidebarMuted` is **contrast-targeted, not a fixed fraction of `fg`**: its
    alpha is solved per theme so muted copy clears 6:1 against the page bg
    (matching GitHub's own dark muted at 6.15:1). A flat 0.65 put 5 of the 22
    shipped themes below the AA 4.5:1 floor — rose-pine worst at 3.00:1 — and
    packs spend this level on real copy, not incidental labels. It stays an
    `rgba()` ink so it keeps adapting to the surface it lands on.
  - `content.js` — **the Slack pack**, and the bulk of the work. Builds the
    themed CSS from the derived surfaces and injects it; drives Slack's
    Preferences modal to flip Color Mode; registers via `OmarchyTheme.register()`.
    See "content.js structure" below.
  - `whatsapp.js` — **the WhatsApp pack** (declarative tier): just a `cssVars`
    table mapping WhatsApp's own CSS custom properties to the derived surfaces.
    Every name verified against the live WhatsApp DOM (2026-08-04); the chat
    list/header paint via the `--WDS-surface-*` semantic tokens, found by
    resolving every custom property at the element and matching the painted
    color. Requires WhatsApp's theme set to "System default".
  - `github.js` — **the GitHub pack** (mostly declarative): maps Primer semantic
    tokens (`--bgColor-*`, `--fgColor-*`, `--borderColor-*`, `--header-*`,
    `--control-*`, `--overlay-*`) to derived surfaces. Verified via Playwright
    against public github.com (2026-08-04). `onColorMode` pins
    `data-color-mode`; Appearance → "Sync with system" is the supported setup.
    Matches `github.com` and `gist.github.com`.
    Also maps the `--brand-color-*` family: **signed-out GitHub is a second
    design system**, and its header/mega-menu read
    `var(--brand-color-canvas-default, var(--bgColor-default))` — since GitHub
    defines the brand token, the Primer fallback never applies. Only the ~37
    primitives are mapped; the ~560 per-component `--brand-<Component>-*` tokens
    are build-time literals, not references to them.
    **Skips GitHub's marketing site** (`/features/*`, `/pricing`, `/resources/*`,
    `/open-source`, the signed-out homepage, …): those pages deliberately mix
    dark and light heroes, so one omarchy surface flattens them. Detected by
    GitHub's own routing — `<meta name="route-controller">` starting with
    `site_` — never a URL prefix list, which would rot as pages are added.
    Opting out is simply *not registering*; the engine holds and replays the
    theme while no pack exists, so such pages get zero side effects. The pack
    runs at `document_start`, so it waits on a MutationObserver for that meta
    rather than `DOMContentLoaded`, which would flash unthemed app pages.
    Its small `apply` hook exists for one thing: GitHub fills the header search
    icon from `--fgColor-onEmphasis`, which correctly resolves to the page
    background on dark themes — right for text on an accent fill, invisible
    here — so that selector is overridden instead of the token retuned.
  - `linear.js` — **the Linear pack**: semantic tokens (`--bg-*`, `--color-*`,
    `--focus-*`) plus a dynamic remap of Linear's hashed StyleX `--sx-*` slots,
    each classified by USAGE (which CSS property consumes it — background →
    surface, color/fill → text; grey-level guessing is under-determined and
    broke light mode) and re-stomped via a fast rAF paint path on re-renders.
    **Requires Linear's interface theme set to "System preference"** (Ctrl+K →
    "Change interface theme"; per-device, client-DB-backed — with a pinned
    Light/Dark theme Linear renders hardcoded lch() styles no override can
    reach). Matches `linear.app` and `*.linear.app`.
  - `outlook.js` — **the Outlook pack** (declarative tier): maps Fluent v9
    semantic tokens (`--colorNeutralBackground1..6` + Hover/Pressed/Selected,
    `--colorNeutralForeground1..4`, `--colorNeutralStroke*`, `--colorBrand*`)
    plus the legacy chrome set (`--neutralSecondarySurface`,
    `--headerBackground`, …) to derived surfaces. Verified against the live
    mailbox (2026-08-04). **Never remap `--white`/`--black`** — they're literal
    colors for icon fills and text on brand buttons; repointing them inverts
    contrast. Outlook follows the system light/dark on its own.
  - `notion.js` — **the Notion pack**: maps Notion's `--c-*` (opaque) and
    `--ca-*` (alpha wash) families, plus the two legacy `--cl-*` / `--cd-*` sets,
    to the derived surfaces. Verified against the live app (2026-08-18). Notion's
    names are abbreviated but regular — `Bac`/`Tex`/`Ico`/`Bor` x
    `Pri`/`Sec`/`Ter`/`Ele`/`Int`/`Str`/`Acc`/`Inv`/`Dis` — which is what makes a
    declarative table practical across ~1,300 tokens.
    Three measurements make this pack far simpler than it first looks:
    **(1)** Notion paints from INLINE styles that merely *consume* the tokens
    (`background: var(--c-bacPri)`), so the engine's inline-important redefinition
    of the property still wins — nothing has to beat an inline `background`.
    **(2)** A StyleX layer sits in between (`--x-umghl: var(--ca-bacIntTra)`), but
    unlike Linear's `--sx-*` slots these hold no literal colours: of 781 slot
    declarations on a loaded page, every colour-valued one resolves to a semantic
    token and the only literal is `transparent`. So no hash classification and no
    rAF repaint path.
    **(3)** Zero triplet consumption — `rgb(var(--x))` appears nowhere in Notion's
    CSS or its inline styles, so every token takes a real colour.
    Its `apply()` hook exists for the two things tokens cannot reach. First,
    Notion's **boot stylesheet**, which hardcodes `body{background:#191919}` plus
    the whole pre-hydration skeleton as literals — so `body` (and therefore the
    viewport canvas behind an overscroll) kept Notion's grey for the entire
    session, and every load flashed it. Second, **Prism syntax highlighting**,
    which ships as class-scoped literals in two mode-specific sets. The syntax
    palette is drawn from the theme's terminal colours — a terminal palette IS a
    syntax palette — with a chroma floor and a 3.5:1 contrast floor per role,
    falling back to `fg` so monochrome themes (`white`, `vantablack`) get
    uncoloured code rather than an invented rainbow.
    **Inline code** is handled separately, and deliberately NOT by remapping
    `--c-redTexSec`: that token is also what a user's genuinely red TEXT resolves
    to. Inline code is matched instead by the one thing unique to it — an
    attribute-substring match on Notion's monospace stack,
    `span[style*="SFMono-Regular"]`. Code BLOCK spans carry no inline
    font-family (the block sets it on a container), so they are unaffected.
    **Never remap** the nine chromatic block-colour families (`--c-blu*`,
    `--c-red*`, …): a red callout is an authoring choice, the same line
    `outlook.js` draws around a sender's design. The neutral `gra` family IS
    mapped — including its easily-missed **alpha arm** (`--ca-gra*Tra`), which
    paints the block drag-handle grips beside every paragraph. Scrims
    (`--ca-modUndBac`, `--ca-oveSmo`) stay dark by design.
    **Requires Notion's appearance set to "Use system setting"** (Settings → My
    settings → Appearance): Notion flips its `notion-dark-theme` body class from a
    `prefers-color-scheme` listener, which the MAIN-world shim drives. Matches
    `app.notion.com` (the live app host) plus `notion.so`, which now only
    redirects there.
  - `hey.js` — **the HEY pack**, covering HEY email AND HEY Calendar: they are one
    Rails app at `app.hey.com` sharing one token system, so one pack themes both.
    Verified live 2026-08-18. The friendliest target in this repo: **9 of 948
    elements carry a style attribute, only one is colour-valued, and there is not
    a single inline `!important`** — none of the inline-painting or observer
    machinery Slack and Outlook need.
    **TWO LAYERS WITH DIFFERENT FORMATS — the one real trap.** `--rgb-*` hold bare
    `r, g, b` TRIPLETS composited at the point of use (`rgba(var(--rgb-ink), .15)`,
    193 such consumptions) while `--color-*` hold REAL COLOURS, and 78% of the
    `--color-*` layer is *built from* the `--rgb-*` layer. Write `--rgb-*` through
    `toTriplet()`; feeding a colour in yields `rgba(#7aa2f7, .15)`, invalid at
    computed-value time. The pack sets BOTH layers explicitly anyway: ~19
    `--color-*` tokens are hardcoded literals deriving from nothing
    (`--color-bg--surface-solid: #f3f1ef`), and others are built per-mode from
    `--rgb-almost-black` / `--rgb-almost-white` rather than the `--rgb-ink` alias,
    so they'd keep HEY's purple-tinted greys.
    **Light/dark needs no automation and no user setting**, unlike Notion. HEY's
    own comment says it: `/* Hey World doesn't use JS, so we need to rely on CSS
    media queries */`. The app reads matchMedia in JS and stamps
    `data-color-scheme` on `<html>` — which the shim drives — and the
    `@media (prefers-color-scheme: dark)` arm is only a no-JS fallback, guarded by
    `:not([data-color-scheme="light"])`, so the reverse direction is safe too.
    **NEVER REMAP THE EMAIL PAPER FAMILY**: `--color-bg--message-content` (`#fff`,
    and notably IDENTICAL in light and dark) plus `--color-txt--on-message-content`
    and friends. Unlike Outlook, HEY does NOT transform received mail for dark
    mode — it renders the sender's HTML as authored on a white sheet, which is why
    it keeps that sheet white in both modes with permanently dark ink. Retinting
    it gives black text on a black background. (The body is in an iframe anyway,
    which `all_frames: false` keeps us out of.) Same for `--color-bg--note-opaque`
    (the sticky-note paper) and HEY's honestly-named `always` family
    (`--color-always-white`, `--color-always-black`, `--rgb-always-blue`) — better
    self-documentation than Outlook's misleading `--white`.
    Its small `apply()` hook exists for one thing tokens can't express: HEY pairs
    an ACCENT FILL with permanently-dark ink —
    `.btn--primary { background: var(--color-primary); color: var(--color-almost-black) }`
    — which works for HEY's light mint/amber brand but makes the label unreadable
    on a DARK accent (catppuccin-latte, lupine). It can't be fixed by remapping
    `--color-almost-black`, whose other consumers genuinely want "always dark" (the
    dark-mode sheet box-shadow, the calendar day dividers, the print stylesheet),
    so it's scoped by selector. HEY's class names are hand-written and stable, not
    hashed, so a class selector is honest here. Their declaration is a NORMAL one
    inside `@layer components` and an unlayered `!important` beats it; their few
    LAYERED `!important` rules (`.btn--reversed`, `.spinner__dot`) would outrank an
    unlayered one but resolve through tokens `cssVars` already themes. The hook
    also flips the button's leading glyph, which is the one tractable corner of the
    `--colorize-*` family — no filter solving needed, just a choice between the two
    values HEY ships (`none` / `invert(100%)`).
    **The entire `--colorize-*` family (30 tokens) is deliberately unmapped**:
    they are not colours but CSS `filter` chains that recolour monochrome icon
    assets. Hitting an arbitrary hex needs a numerical solver over five filter
    functions, and it isn't needed for correctness — HEY swaps the whole set by
    mode, so icons are already the right POLARITY, just not hue-matched.
    `--color-tertiary` gets a **theme-coherent** fallback rather than a status
    one: it's decorative (the calendar's Day/Week/Year switch and its
    `linear-gradient(135deg, var(--color-secondary), var(--color-tertiary))`), so
    where `statusPalette` rightly declines to invent a hue, importing HEY's purple
    made it the most off-theme thing on the page. It now falls through the magenta
    family → the palette colour farthest from every already-taken role → the
    accent. The distance scan is explicit because `highlightColor()` avoids only
    ONE colour and kept handing back the colour already used for `negative`.
  - `background.js` — MV3 service worker. Holds the native-messaging port,
    rebroadcasts pushed themes to matched tabs (the site list is derived from
    the manifest's content-script matches — adding a pack never touches this
    file), answers `request-fresh-theme`.
  - `inject-prefers-color-scheme.js` — runs in the page's MAIN world at
    `document_start`; a near-complete `matchMedia('(prefers-color-scheme)')`
    polyfill so Slack's "Sync with OS" appearance follows omarchy, plus the
    Slack-only `omarchy:react-click` bridge that drives the Preferences radio.
  - `manifest.json` — permissions + content-script registration. Carries a
    **`key`** that pins the extension ID to `egagnaecglnnmbbnpbbccgajinplhckp`
    on every machine, so the host manifest's `allowed_origins` can be hardcoded.
    Never regenerate it — the ID is baked into the host manifest template and
    into users' installed copies. The shim, engine and Slack entries set
    **`match_origin_as_fallback`**: Slack's huddle pop-out is a `window.open()`
    child that is never navigated (its navigation entry is `about:blank`, it has
    zero scripts of its own — the opener's React portals into it — and its URL
    is rewritten to `/client/…` with `replaceState`). Content scripts don't
    inject into `about:blank` without that flag, so the pop-out got no theme.
  - `icon-{16,32,48,128}.png` — the extension icon, wired into both `icons` and
    `action.default_icon`. Rasterized from `icon.svg`; don't hand-edit.
- `icon.svg` — source of truth for the icon (regen command is in its comment).
  Drawn from scratch, deliberately sharing nothing with the **Omarchy mark** —
  Omarchy's MIT license covers its code, not its branding, and reusing the logo
  would imply this is an official Omarchy project. Instead it follows the
  *convention* of omarchy's bundled chromium extensions (`copy-url`, `yt-dlp`):
  **monochrome `#9ECE6A` line art on a transparent ground**, no plate. Known
  trade-off, accepted for that consistency: `#9ECE6A` is 8.3:1 on dark browser
  chrome but 1.6:1 on light, so the icon is quiet on a light omarchy theme.
  Tuned for the 16px toolbar first: edges on multiples of 8 so they land on whole
  pixels at 1/8 scale, a title *strip* rather than dots (dots disappear entirely
  at that size), and a deliberately **wide** light→dark swatch ramp, because
  monochrome separates by value and value survives downscaling much worse than
  hue — a narrow ramp merged into one green block at 16px.
- `native-host/` — `omarchy-webapp-theme-host` (bash; emits length-prefixed JSON
  over stdio) + the native-messaging manifest template.
- `hooks/omarchy-webapp-theme` — omarchy `theme-set` hook. Signals SIGUSR1 to
  every running host via pidfiles in `$XDG_RUNTIME_DIR/omarchy-webapp-theme/`.
- `install.sh` — takes no extension ID. Refuses on pre-Omarchy-4 (no
  `~/.local/state/omarchy/current`). Otherwise writes host manifests to every
  Chromium-family profile dir, symlinks the hook into `hooks/theme-set.d/`, and
  adds `--load-extension` to the flags confs of installed browsers. `--no-flags`,
  `--uninstall`. **Brave Origin is a separate browser, not a Brave channel** —
  its own package (`brave-origin-bin`), binary, `brave-origin-flags.conf`, and
  `BraveSoftware/Brave-Origin` profile root; all three of its channels are in
  both lists. It reads system-wide hosts from `/etc/chromium` and
  `/etc/opt/chrome`, so a *packaged* install needs no per-user manifest there.

## Adding a site pack

The whole point of the engine/pack split. One extension, one pinned ID, one
host manifest — a new site needs **no new keys and no native-messaging changes**:

1. Create `extension/<site>.js` ending in `OmarchyTheme.register({ id: "<site>",
   ... })`. Start declarative: `cssVars(theme, s)` returning a map of the SITE'S
   OWN css custom properties → derived surfaces (see `whatsapp.js`). Only
   escalate to `apply()` + observers + `onColorMode()` if the site fights back
   (see `content.js` — Slack is the worst case).
2. In `manifest.json`: add the site's URL pattern to `host_permissions`, to the
   two shared entries (shim + engine), and add a new content-script entry
   loading just `<site>.js` for that pattern. Keep pack files flat in
   `extension/` — the AUR PKGBUILD installs with a flat `extension/*` glob.
3. Add the site's row to `SITES` in `extension/options.js` (the per-site
   enable/disable toggle; the `id` must match the register call — the engine
   gates on `chrome.storage.sync` `disabledSites[id]` and pends the theme until
   both the pack and the settings have arrived).
4. `background.js` and `install.sh` need nothing; the site list is derived from
   the manifest.
5. Verify against the live site (see Dev / test workflow). Read variable/class
   names off the live DOM — never guess.

The host's payload carries the stable named fields (`bg`, `fg`, `accent`,
`selection_bg`, `chrome`) plus `colors`: the theme's entire `colors.toml`
palette, for packs that want to map more than five values.

## Host design (why it looks like this)

The host is **push-only** — it never parses inbound messages, and `background.js`
never writes to the port. Reading Chromium's length-prefixed framing in bash
means blocking in `head -c4`, which a trap can't interrupt; going push-only
removes the need entirely. Consequences to preserve when editing:

- **Omarchy 4+ only.** The host reads `~/.local/state/omarchy/current/` and is
  driven entirely by SIGUSR1 from the theme-set hook — there is no polling
  fallback. `install.sh` symlinks the hook into `hooks/theme-set.d/` (the `.d`
  form has existed since Omarchy 3.8). Older Omarchy stays on the pre-0.3 release.
- The main loop `wait`s on the stdin watchdog; a SIGUSR1 interrupts the `wait`,
  the trap pushes the new theme, and the loop resumes. No `sleep` timers.
- The stdin watchdog **must** read via an explicit `<&3` dup. Bash gives every
  background job `/dev/null` as stdin, so a bare read loop EOFs instantly and
  kills the host right after its first push.

## content.js structure

1. **Engine** (`omarchy-colors.js` / `omarchy-surfaces.js` / `omarchy-runtime.js`,
   loaded before `content.js`) — color helpers (`hexToRgb`, `relLuminance`
   [linearized WCAG channels], `shade`, `withAlpha`, `mix`), `deriveSurfaces()`,
   and the `OmarchyTheme` registry. Dark vs. light is decided by **WCAG relative
   luminance** of the terminal bg (`< 0.5` = dark), *not* the day/night name.
   `content.js` is the Slack **pack**: it ends with `OmarchyTheme.register(...)`.
2. **`applySlackTheme(theme, s)`** (the pack's `apply` hook) — takes the surfaces
   `s` the engine derived (`sidebarBg`, `chromeBg`, `hoverBg`, `selectedBg`, …).
   **Destructure every field the CSS/`directPaint` uses — a missing one is a
   silent runtime ReferenceError** (this bit us with `chromeBg`). Then it builds
   one big CSS template string and injects it into a `<style id="omarchy-slack-style">`.
3. **Four token systems, three different rules.** Slack is mid-migration, so the
   same pane is painted by several families and each needs a different treatment:
   - `--sk_*` — held as bare **`r, g, b` triplets** and composited at the point of
     use (`rgba(var(--sk_primary_foreground), .7)`). Write triplets via
     `toTriplet()`.
   - `--sk_*_solid` — the same ink **pre-composited against Slack's own
     `#1a1d21`**, consumed at alpha 1. Opaque literals carrying a hardcoded
     background, so re-composite them against *our* bg:
     `toTriplet(mix(theme.bg, fg, α))`. The ladder is α = .7 / .5 / .27 / .13 /
     .05 / .04 for max / high / mid / low / soft / min (recovered by solving
     Slack's shipped values back against `#1a1d21`).
   - `--dt_color-*` — Slack's newer system, consumed **bare**, so these hold
     **real colors**. `content-pry/sec/ter` drive text (sender names are
     `content-pry`), `content-hgl-1` drives links and @mention slugs. Only the
     foreground and outline families are mapped; the `base-` / `surf-`
     backgrounds are left to the explicit pane rules, and `constants-white` /
     `constants-black` are literals — never repoint them *globally*. The one
     exception is scoped: the tooltip rule redefines `constants-black` (and the
     `content-inv-*` ink) **on `.c-tooltip__tip` itself**, because we replace
     Slack's near-black bubble with a lifted surface and the inverse family then
     describes a surface that is no longer there. Custom properties inherit, so
     that one declaration re-inks the label and the shortcut keycaps without
     naming any of Slack's hashed atomic classes.
   - `--dt_color-theme-*` — the **sidebar-theme family**, 61 tokens defined per
     `.sk-client-theme--*` class from the aubergine `plt` scale (in dark mode 0
     is darkest, 100 lightest). Consumed bare as real colors — hover/pressed
     variants too, via `linear-gradient(var(--x), var(--x))`. It owns what the
     pane rules don't: the whole **huddle chrome** (toolbar buttons are
     `surf-inv-pry`, the toggled-on chip `base-pry` + `content-ter` ink, the
     pop-out titlebar `base-inv-pry`), themed badges/banners (`base-imp`), the
     `--themeInverse`/`--themeGhost` button variants, sidebar tabs. Mapped in
     full by role: `base-*` solid fills (`base-pry` is the emphasis fill →
     accent), `surf-*` fg washes at Slack's own .25/.08/.18 alphas, `content-*`
     ink where `content-ter`/`content-imp`/`content-inv-imp` are ink ON the
     accent and take `inkOn()`, `hgl-1` → `selectedBg`. **The token block is
     also declared on `[class*="sk-client-theme--"]`**, not just the root: Slack
     scopes theme classes to subtrees (the docked huddle bar is
     `sk-client-theme--light-inverted-sidebar` in light mode) and its class rule
     redefines all 61 on that element, which beats anything inherited from body.
   `--dt_color-plt-*` are raw palette primitives (~336 of them, triplet-consumed);
   they're brand scales, not semantic slots, so they're deliberately unmapped.
4. **Inline-important overrides** — Slack sets its own high-specificity inline
   styles (CSS custom props like `--rainbow-*`, `--saf-*`, and direct
   `background-color` on the rail/sidebar/nav on blur). External `!important` CSS
   loses to inline styles, so we re-write the same vars + direct paints
   **inline with `setProperty(..., "important")`** to win the cascade. The
   rail/sidebar/nav paint lives in `paintChrome()` so the observer can re-run
   it after Slack's blur-time rewrite (throttled to 200ms with a trailing retry).
5. **`paintActiveRows()`** — paints the selected-channel pill inline because
   Slack's React re-render stomps our CSS; a MutationObserver re-runs it.
6. **MutationObservers** — re-inject the style if Slack removes it, keep active-row
   paint current, etc. **Invariant for anything the observer re-runs:** only
   write values that differ. `setProperty` with an unchanged value queues no
   `style` mutation record; a remove-then-set pair queues two, and the observer
   turns that into a repaint every frame (`paintActiveRows` used to do exactly
   this and ran at 60Hz whenever a channel was selected — diff the sets instead).
7. **Color-mode automation** — `ensureSlackColorMode(isDark)` opens
   Preferences → Appearance and toggles the radio via a MAIN-world React bridge
   (synthetic clicks don't fire Slack's handler reliably). It runs only in the
   main client: gated on `/client/` AND on the navigation entry not being
   `about:blank` — the huddle pop-out passes the URL check (see `manifest.json`
   above) but has no Preferences, and the flow used to hide every dialog and
   spend seconds firing synthetic clicks into it. The hide style it installs
   exempts the live huddle's `[aria-label^="Huddle"]` dialog (prefix: the label
   is "Huddle in <channel>" on current builds).
8. **Huddles** need almost no selectors — the chrome paints from the theme
   family above. What's left: the `.p-theme_background` backdrop (pop-out
   window, mini tile) goes flat with the sunroof rule; the video-tile backdrop is
   an `<img>` of Slack's `/img/huddles/gradient_NN.png`, hidden by **src
   substring** because the same class carries a user-chosen artist photo, which
   stays; and two chrome buttons Slack paints as literal white pills
   (`constants-white` / `brand-core-black`) get those tokens redefined on the
   button itself, the tooltip precedent. Overlays that are white-on-video
   (active-speaker pill, pin pill, tile actions) are left alone: legibility, not
   theme. Slack's "Leave" red and the in-huddle green stay semantic.

## How the CSS rules are written (important conventions)

- Selectors use **attribute-substring matches** like `[class*="p-activity_ia4_page"]`
  because Slack ships **hashed/minified class names** that change between builds.
  Never hard-code a full class name; match a stable substring prefix.
- Almost every rule needs `html body …` prefixes and `!important` to beat Slack's
  specificity. Follow the existing pattern.
- Rules are grouped into annotated `/* ===== section ===== */` blocks (main pane,
  tab rail, channel sidebar, top nav, message hover, DMs/Activity list, badges,
  text readability). Add new work to the matching block or a new annotated block.
- Theme-derived values come from CSS vars (`--omarchy-bg`, `--omarchy-fg`,
  `--omarchy-accent`, `--omarchy-sidebar-bg`, `--omarchy-hover-bg`,
  `--omarchy-selected-bg`, `--omarchy-fg-strong`). Use these rather than literals.
- The whole CSS block is a **JS template literal** (backtick-delimited string).
  Never put a backtick `` ` `` or `${` inside it — *including inside `/* */`
  comments*. They're live template-literal syntax even in a comment, so a stray
  backtick silently terminates the string and the entire content script fails to
  parse (symptom: `Uncaught SyntaxError` and **all** theming disappears).
- **Never write `*/` inside a CSS comment** in that literal either — most easily
  done by accident in prose, e.g. a glob pair like `base-*` / `surf-*` written as
  one token. It closes the comment early; the rest of the sentence parses as CSS
  garbage and the *intended* `*/` becomes a stray error token, whose recovery
  discards everything up to the next `;`. That silently eats **exactly one
  declaration** — the next one. `node --check` cannot see this (the JS is valid),
  and the symptom is maddening: one custom property simply missing from the CSSOM
  while its neighbours are fine. Diagnose by comparing `/*` and `*/` counts in the
  block, or check `[...rule.style]` for the property you expected.
- **A design token's FORMAT is part of its contract — verify it, never assume.**
  Some tokens hold real colors, others hold bare `r, g, b` triplets, and feeding
  the wrong kind in produces a value that is *invalid at computed-value time*: the
  declaration is dropped, and for an inherited property like `color` the cascade
  unwinds to the UA default — **white under `color-scheme: dark`, black under
  light**. So it fails as plausible-looking text in the wrong color rather than as
  something obviously broken, and the failure flips with theme polarity. Read how
  the site consumes a token before overriding it (`rgb(var(--x))` ⇒ triplet, bare
  `var(--x)` ⇒ color) — see the audit recipe in Dev / test workflow.
- Some surfaces (e.g. the rail/sidebar, and the Activity/Threads `All|VIP` tab
  strip — `p-activity_ia4_page__tab_menu` / `__tab_container`) are painted by
  Slack **inline with `!important`**, which beats even our high-specificity
  `!important` CSS. Those can't be fixed in the stylesheet — paint them inline
  via `setProperty(..., "important")` and re-run on the MutationObserver. See
  `paintTabStrips()` / `paintActiveRows()`.

## Dev / test workflow

There's no automated harness — changes are verified by hand against live Slack:

1. Edit files under `extension/`.
2. Reload the unpacked extension at `brave://extensions` (or Chrome equivalent).
3. Reload the Slack tab. Filter the DevTools console by `omarchy` to see logs.
4. To find selectors for a Slack UI element, **inspect the live DOM in DevTools**
   (Slack's class names are hashed, so you must read them off the running app —
   don't guess). The repo can't be inspected locally because the markup is Slack's.

Note: Brave normally runs **without** a remote-debugging port, so an automated
browser can't attach to the user's own logged-in session. But a **scratch
Chromium can be driven directly**, which beats asking the user to paste DOM:

```sh
chromium --user-data-dir=~/.cache/omarchy-slack-test-profile \
  --remote-debugging-port=9222 --load-extension=<repo>/extension \
  --disable-features=DisableLoadExtensionCommandLineSwitch --no-first-run \
  https://app.slack.com/          # log in once; the profile persists
```

Then `require("playwright-core").chromium.connectOverCDP("http://localhost:9222")`
and drive `ctx.pages()` / `ctx.serviceWorkers()`. Gotchas, all learned the hard way:

- Never `browser.close()` — it kills the externally launched window. `process.exit(0)`.
- `chrome.runtime.reload()` is unreliable for unpacked extensions; **restart
  chromium** to pick up edited files. Identify the browser process by `pgrep -x
  chromium` + profile path + *absence* of `--type=`; matching on the debug port
  also matches the launching shell and self-kills it.
- With no native host in that profile, the extension gets **no theme**, so it
  injects nothing. Get a real payload by running the host headlessly (below) and
  write it from the service worker with `chrome.storage.local.set({ theme })`:
  `background.js` answers `request-theme` from storage and re-pushes on
  `tabs.onUpdated`, so it survives every reload and restart. A one-off
  `chrome.tabs.sendMessage(tabId, {type:"omarchy-theme", theme})` applies it
  live to an open tab. The huddle pop-out has no `/huddle/` URL any more — it is
  an `about:blank` child at `/client/…` (see `manifest.json`); find it among
  `browser.pages()` by `document.querySelector('.p-huddle_window')`. Pop it out
  and back in by hand — the titlebar's "Change view" ignores synthetic clicks.
- Hot-test a CSS rule without a restart by editing
  `#omarchy-slack-style`'s `textContent` in the page (or appending a scratch
  `<style>`); only manifest and JS changes need the restart.
- **Screenshots hang** when the window is occluded (no frames are composited);
  `fromSurface: false` doesn't help. Assert on `getComputedStyle` instead — it's
  more precise than a screenshot anyway.
- **`getComputedStyle` cannot see through translucency.** Slack's blur state
  sets `opacity: .66` on `.p-tab_rail`, and what showed through was the
  100vw x 100vh `.p-theme_background` layer behind it (an aubergine
  radial+conic gradient). Every element under the cursor computed our brown, so
  three DOM probes came back clean. When the pixels disagree with the DOM,
  sample the compositor instead: `grim -g "<x>,<y> <w>x<h>" f.png` then
  `magick f.png -crop 1x1+<x>+<y> -depth 8 txt:-`, focused vs unfocused (switch
  focus with `hyprctl eval "hl.dispatch(hl.dsp.focus({ window = 'address:0x…' }))"`).
  A colour that shifts hue on blur is the page; one that only darkens is
  Hyprland's inactive opacity. Then walk `elementFromPoint(...).parentElement`
  reporting `opacity`/`backgroundImage`/`filter`/`mask` per ancestor.

To audit how a site consumes a design token (the thing that makes token bugs
diagnosable), walk the CSSOM in the page — Slack's stylesheets are same-origin
and fully readable. Count `rgb(var(--x))` vs bare `var(--x)` to get the required
format, and for a mystery color, list every rule declaring `color` that matches
the element or an ancestor. `[...rule.style]` reveals declarations that were
dropped at parse time.

**Slack's CSS is readable with no login at all**, which beats both guessing and
asking the user: `curl -sL https://app.slack.com/client` serves the signed-out
boot HTML, whose `a.slack-edge.com` stylesheets include the whole design system —
`modern.vendor.*.css` (the `c-` components: `.c-tooltip__tip`, `.c-keyboard_key`),
`rollup-style-plastic.*.css` (every `--dt_color-*` literal, light block then dark)
and `application.*.css` (the newer **atomic layer** — one hashed class per
declaration, e.g. a class whose whole body is
`background-color:var(--dt_color-constants-black)`). Grep those for the rule that
paints an element and for a token's shipped value. Two things this settles that
the running app hides: which *declaration* wins (a child's atomic class beats
colour inherited from our rule on the parent), and that the atomic layer is
token-driven — of its ~69 colour utilities only 6 hold literals, so an off-theme
colour there can be traced to a token and fixed by redefining that token on an
ancestor. The screenshot is still the input: sample the wrong pixel with
`magick ... txt:` and match it against the token literals.

The **native host and install.sh**, unlike the CSS, *are* testable headlessly —
do that rather than asking the user to click through a browser. Both honor
`$HOME` and `$XDG_RUNTIME_DIR`, so point them at a scratch dir:

```sh
# host: hold stdin open, or the watchdog exits immediately
( sleep 5 ) | HOME=/tmp/fake XDG_RUNTIME_DIR=/tmp/run ./native-host/omarchy-webapp-theme-host > out.bin
head -c4 out.bin | od -An -v -tu4 --endian=little   # must equal the JSON byte length

# install.sh: sandbox the whole thing
HOME=/tmp/fake ./install.sh && HOME=/tmp/fake ./install.sh --uninstall
```

Point `~/.local/state/omarchy/current/theme` at any dir under
`/usr/share/omarchy/themes/` to exercise a specific palette.

## Conventions

- Vanilla JS only (no framework, no bundler). Keep the heavy inline comments —
  they explain *why* a given hack beats Slack's cascade; preserve that context.
- Don't open PRs or push without confirming with the user.
