# omarchy-webapp-theme

A tiny browser extension that makes web apps — **Slack, WhatsApp Web, GitHub,
Linear, Discord, Outlook, Notion, and HEY** — follow your [Omarchy](https://omarchy.org/)
theme: painting their surfaces with your terminal's palette and flipping their
Light/Dark mode whenever you switch omarchy themes, so they visually blend into
the rest of your desktop.

Built and tested on Brave on Arch Linux + Omarchy. Works on Brave Origin,
Chrome, Chromium, Edge, and Helium (helium-browser-bin) — the fork Omarchy's
web apps use by default.

> Known as `omarchy-slack-theme` through 0.2.x, back when Slack was the only
> pack.

## What it does

- **Main pane background** matches your terminal's background (read from the
  active theme's `alacritty.toml`).
- **Sidebar, top nav, channel header** are tinted to match your terminal
  color (a couple of shades off so they're visually distinct from the chat).
- **Slack's Light/Dark Color Mode** flips automatically when you switch
  themes — the extension opens Preferences → Appearance, picks the right
  radio, and closes the dialog (all hidden from view).
- **Pushes updates instantly** when you switch themes. A small
  native-messaging host hooks into omarchy's own `theme-set` event and pushes
  the new state to the extension the moment the theme lands.
- **Not just Slack**: the extension is a theme engine plus one small "pack" per
  site. WhatsApp Web (surfaces, bubbles, unread badges, and even default
  avatars recolored from your terminal palette), GitHub (Primer design tokens),
  Linear (sidebar + elevation ladder), Discord, Outlook Web (Fluent v9
  tokens), Notion (surfaces, body copy, and code-block syntax highlighting
  drawn from your terminal palette), and HEY (email + calendar in one pack) ship
  too — adding another site is one pack file + one manifest entry.

https://github.com/user-attachments/assets/5c67741e-c6df-4f48-8c1a-72eadcc805bb

## How it works

```
  omarchy-theme-set ──omarchy-hook theme-set──► hooks/omarchy-webapp-theme
                                                          │ SIGUSR1
                                                          ▼
┌──────────────┐   length-prefixed JSON   ┌────────────────────┐
│  native host │ ────────────────────────►│  Browser service   │
│  (bash)      │   push-only, never read  │  worker (MV3 bg)   │
│              │                          └────────┬───────────┘
└──────────────┘                                   │ chrome.tabs.sendMessage
   reads (Omarchy 4):                              ▼
   ~/.local/state/omarchy/current/  ┌────────────────────────────┐
     theme.name                     │  Content script on Slack   │
     theme/alacritty.toml           │  • injects themed CSS      │
     theme/colors.toml              │  • drives the Appearance   │
     theme/chromium.theme           │    radio via Preferences   │
                                    │    modal automation        │
                                    └────────────────────────────┘
```

The host is **push-only** — it never parses inbound messages. It emits once on
connect, then again whenever omarchy's `theme-set` hook signals it with SIGUSR1
(the hook `install.sh` symlinks into `hooks/theme-set.d/`). Omarchy 4+ only.

Slack's Color Mode is flipped by:

1. Clicking the workspace-actions button (`[data-qa="workspace_actions_button"]`)
2. Clicking the "Preferences" menu item
3. Clicking the Appearance tab in the prefs dialog
4. Calling React's `onChange` directly on the hidden `<input type="radio">`
   for Light/Dark, via a MAIN-world bridge script (Slack's React handler
   doesn't fire reliably for synthetic mouse events)
5. Closing the dialog via the X button
6. Dismissing any leftover open menus with Escape

Dark/Light is decided by **WCAG relative luminance** of the terminal
background — robust to themes that don't use the obvious day/night naming
(e.g. an Omarchy "day" theme that happens to use a dark palette).

## Requirements

- Brave, Brave Origin, Chrome, Chromium, Edge, or Helium — Manifest V3
- Bash + coreutils. No Python, no runtime dependencies.
- Linux + [Omarchy](https://omarchy.org/) **4+** — the host reads
  `~/.local/state/omarchy/current/` and is driven by the `theme-set.d` hook.
- An `alacritty.toml` in the active theme dir (the host falls back to
  `colors.toml` if that's missing)

## Install

### From the AUR

```sh
yay -S omarchy-webapp-theme
omarchy-webapp-theme-setup
```

The package registers the native-messaging host system-wide, so there's no
per-browser setup. `omarchy-webapp-theme-setup` does the two things a package
can't — installing the omarchy `theme-set` hook and adding `--load-extension` —
because both live under `$HOME`. It takes the same `--no-flags` and
`--uninstall` flags as `install.sh` below; they're the same script. (Upgrading
from `omarchy-slack-theme`? The setup cleans up the old name's wiring too.)

Then fully quit your browser and open any supported site — `app.slack.com`,
`web.whatsapp.com`, `github.com`, `linear.app`, `discord.com`,
`outlook.office.com`, `app.notion.com`, or `app.hey.com`.

Then see **[Per-site setup](#per-site-setup)** for the appearance setting a
few apps need, and for the extension options that turn theming off per site.

### From a git checkout

```sh
./install.sh
```

There's no extension ID to copy. `extension/manifest.json` pins the ID with a
`key`, so it's `egagnaecglnnmbbnpbbccgajinplhckp` on every machine, and
`install.sh` bakes it into the host manifest for you.

The script does three things:

1. Registers the native-messaging host in every Chromium-family profile dir
   (Chromium, Chrome ×3, Brave ×3, Brave Origin ×3, Edge ×2).
2. Symlinks the omarchy `theme-set` hook into `hooks/theme-set.d/` (your own
   hooks there are left alone).
3. Adds `--load-extension` to the flags files of the browsers you actually have
   installed, so the extension loads without Developer mode.

Then **fully quit your browser** (`pkill brave` — closing the window isn't
enough) and open a supported site.

> **Upgrading from a manual install?** Remove the copy you loaded via
> **Load unpacked** first. It shares the now-pinned ID with the
> `--load-extension` copy, and only one of the two will load.

Options:

| Flag | Effect |
| --- | --- |
| `--no-flags` | Skip the flags-file edits; load `extension/` by hand instead. |
| `--uninstall` | Reverse all three steps. |

## Per-site setup

Most packs follow your omarchy theme as soon as you open the site. A few apps
have their own Light/Dark setting, and while that's pinned they ignore the
extension — the palette changes, the polarity doesn't. Put those on "system":

| Site | Setting | Where |
| --- | --- | --- |
| WhatsApp Web | **System default** | Settings → Theme |
| GitHub | **Sync with system** | Settings → Appearance → Theme |
| Linear | **System preference** | `Ctrl+K` → "Change interface theme" (per-device) |
| Discord | **Sync with computer** (Discord's "Auto") | Settings → Appearance → Theme |
| Notion | **Use system setting** | Settings → My settings → Appearance |

Slack, Outlook, and HEY need nothing: Slack's Appearance radio is flipped
automatically, and Outlook/HEY already follow the system.

**To stop theming a site entirely**, right-click the extension's toolbar icon
and choose **Options**, or open `chrome://extensions` /
`brave://extensions` → the extension → **Details** → **Extension options**.
Uncheck any site you want left as it ships. All sites start enabled.

A few packs also leave things deliberately untouched:

- **Notion** — block colours (a red callout, blue text) are authoring choices,
  not chrome, so they keep their own hues.
- **GitHub** — only the app is themed. The marketing site (`/features/*`,
  `/pricing`, `/resources/*`, `/open-source`, and the signed-out homepage) is
  left as GitHub ships it: those pages mix dark and light heroes, so one
  terminal background would flatten them.
- **HEY** — one pack covers both email and Calendar. Received mail keeps its
  white sheet and dark ink on purpose: HEY renders the sender's HTML as
  authored rather than transforming it for dark mode.

## Verifying it works

Open DevTools on the Slack tab and filter the console by `omarchy`. A
successful theme switch looks like:

```
[omarchy] flipping Slack to Dark
[omarchy] opening preferences (Ctrl+,)
[omarchy] using workspace-actions menu
[omarchy] clicking workspace-name button: ...
[omarchy] activating Preferences menu item: ...
[omarchy] preferences dialog opened via menu: true
[omarchy] clicking Appearance tab
[omarchy] clicking Dark radio
[omarchy] dispatchClick didn't take; using React handler for Dark
[omarchy bridge] called onChange on INPUT c-input_radio themeRadio__IHvrr
[omarchy] React click confirmed Dark
[omarchy] closing prefs via close button
[omarchy] Slack color mode now Dark
```

## Customization

All visual rules live in `extension/content.js` inside the big template
string. Search for `===== main / message area =====`, `===== left tab rail`,
etc. — each block is annotated.

Common tweaks:

- **Sidebar shade**: change `dir * 0.04` (in the `sidebarBg` calculation in
  `extension/omarchy-surfaces.js`) to a bigger number for more contrast.
- **Selected channel highlight**: search for `withAlpha(accent, 0.35)` in
  `omarchy-surfaces.js` — that's the selected-row tint. Drop to 0.2 for subtler,
  raise for more punch.
- **Use day/night nomenclature instead of luminance**: replace the
  `relLuminance(...) < 0.5` check in `omarchy-surfaces.js` with `theme.is_night`.

After editing, reload the extension on `brave://extensions` and refresh the
Slack tab.

## Limitations / known gotchas

- **Slack rebrands its CSS classes occasionally.** The selectors anchor on
  `data-qa` attributes where possible (which are more stable), but expect
  occasional breakage when Slack ships a redesign. The console will say
  things like `'Preferences' menu item not found` — those messages tell you
  which selector died.
- **Synthetic `Ctrl+,` doesn't open Preferences** in some Brave builds (the
  React handler appears to check `event.isTrusted`). The menu-click path is
  the real workhorse; the keyboard attempt is best-effort.
- **Only one workspace at a time has been tested.** Multi-workspace setups
  should work since the selectors are workspace-agnostic, but PRs welcome.

## Repository layout

```
extension/
├── manifest.json                   # MV3 manifest; pins the extension ID via "key"
├── background.js                   # service worker; holds the native port
├── omarchy-colors.js               # engine: color helpers (linearized WCAG luminance)
├── omarchy-surfaces.js             # engine: deriveSurfaces() -- theme -> surfaces
├── omarchy-runtime.js              # engine: OmarchyTheme registry + theme dispatch
├── content.js                      # the Slack pack: injects CSS + drives prefs automation
├── whatsapp.js                     # the WhatsApp pack: declarative CSS-var table
├── github.js                       # the GitHub pack: Primer CSS-var table
├── linear.js                       # the Linear pack: semantic CSS-var table
├── discord.js                      # the Discord pack: declarative CSS-var table
├── outlook.js                      # the Outlook pack: Fluent v9 CSS-var table
├── notion.js                       # the Notion pack: --c-/--ca- tokens + Prism syntax
├── hey.js                          # the HEY pack (email + calendar): --rgb-/--color- tokens
└── inject-prefers-color-scheme.js  # MAIN-world: matchMedia polyfill + React-click bridge

native-host/
├── omarchy-webapp-theme-host       # bash; pushes length-prefixed JSON over stdio
└── com.omarchy.webapp_theme.json.template

hooks/
└── omarchy-webapp-theme            # theme-set hook; SIGUSRs every running host

install.sh                          # host manifests + hook + --load-extension wiring
```

## License

MIT — see [LICENSE](./LICENSE).
