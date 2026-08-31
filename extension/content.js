// Slack theme pack for the Omarchy web-app theming engine.
//
// Registers with the generic engine (omarchy-runtime.js, loaded before this)
// and owns everything Slack-specific: building the themed CSS, the inline
// re-paints that beat Slack's cascade, and the Color Mode automation. The
// color helpers (hexToRgb/shade/withAlpha/mix/relLuminance) and deriveSurfaces
// live in omarchy-colors.js / omarchy-surfaces.js and are shared in this
// content script's scope. The register() call is at the bottom of the file.
const STYLE_ID = "omarchy-slack-style";

// Clear any stale cached mode from earlier extension versions.
try { chrome.storage.local.remove("lastSlackMode"); } catch (_) {}

// The engine's apply() hook: paint Slack from the surfaces deriveSurfaces()
// produced. `dir` and the color helpers (shade/withAlpha) are used inline in
// the CSS template below, so pull them into scope alongside the surfaces.
function applySlackTheme(theme, s) {
  if (!theme || !theme.bg) return;
  const {
    fg, accent, dir, sidebarBg, chromeBg, railBg, navBg, sidebarFg, sidebarMuted,
    fgStrong, hoverBg, selectedBg, borderColor,
  } = s;

  const css = `
    :root, html, body {
      --omarchy-bg: ${theme.bg};
      --omarchy-fg: ${fg};
      --omarchy-fg-strong: ${fgStrong};
      --omarchy-accent: ${accent};
      --omarchy-rail-bg: ${railBg};
      --omarchy-sidebar-bg: ${sidebarBg};
      --omarchy-sidebar-fg: ${sidebarFg};
      --omarchy-nav-bg: ${navBg};
      --omarchy-hover-bg: ${hoverBg};
      --omarchy-selected-bg: ${selectedBg};
      --omarchy-border: ${borderColor};

      /* Slack's "rainbow" sidebar theme tokens — these actually drive the
         channel sidebar paint job in current Slack web. */
      --rainbow-canvas: ${sidebarBg} !important;
      --rainbow-canvas-2: ${railBg} !important;
      --rainbow-text: ${sidebarFg} !important;
      --rainbow-action: ${sidebarFg} !important;
      --rainbow-action-hover: ${hoverBg} !important;
      --rainbow-action-active: ${selectedBg} !important;
      --rainbow-action-active-text: ${sidebarFg} !important;
      --rainbow-mention-badge: ${accent} !important;
      --rainbow-mention-text: ${railBg} !important;

      /* ===== SK design tokens — TRIPLETS, not colors =====
         Slack holds these as bare "r, g, b" channel lists and composites at the
         point of use: color: rgba(var(--sk_primary_foreground), .7). We used to
         write hex here, which built rgba(#a9b1d6, .7) — invalid at
         computed-value time, so the declaration was dropped and color unwound
         through identically-broken ancestors to the UA default: white under
         color-scheme:dark, black under light. Message body text was never the
         theme's fg at all; it just happened to be legible on dark themes. Two
         verified counts, from auditing every consumer in Slack's stylesheets:
         --sk_primary_foreground is wrapped in rgb()/rgba() 690 times vs 38 bare,
         --sk_foreground_max 904 vs 2. Triplets it is. The few bare consumers
         (color: var(--sk_primary_foreground) on a popover header, an avatar
         initial) now inherit the correct themed color instead, which is right;
         the handful of bare background-color ones fall back to transparent,
         which reads acceptably on an already-themed surface.
         Use toTriplet() on everything here — a hex in this block is a silent
         regression, not a visible one. */
      --sk_primary_background: ${toTriplet(theme.bg)} !important;
      --sk_primary_foreground: ${toTriplet(fg)} !important;
      --sk_secondary_background: ${toTriplet(sidebarBg)} !important;
      --sk_highlight: ${toTriplet(accent)} !important;
      --sk_highlight_hover: ${toTriplet(accent)} !important;
      --sk_highlight_accent: ${toTriplet(accent)} !important;
      /* Inverted pair: ink on an accent/emphasis fill, so it's the background
         colour, and vice versa. Slack's dark values are literally its own
         bg/fg swapped. */
      --sk_inverted_foreground: ${toTriplet(theme.bg)} !important;
      --sk_inverted_background: ${toTriplet(fg)} !important;

      /* The emphasis ladder. Non-solid tokens are the raw ink — consumers supply
         the alpha, e.g. rgba(var(--sk_foreground_high), .5), so all of them are
         just fg. */
      --sk_foreground_max: ${toTriplet(fg)} !important;
      --sk_foreground_high: ${toTriplet(fg)} !important;
      --sk_foreground_mid: ${toTriplet(fg)} !important;
      --sk_foreground_low: ${toTriplet(fg)} !important;
      --sk_foreground_min: ${toTriplet(fg)} !important;
      --sk_foreground_soft: ${toTriplet(fg)} !important;

      /* ...and their _solid twins, which are the SAME ink already flattened onto
         the canvas, consumed at alpha 1. Slack bakes them against its own
         #1a1d21: its shipped values solve back to exactly that background at
         these alphas (171,171,173 = 70%, 129,131,133 = 50%, 53,55,59 = 13%),
         which is how the ladder below was recovered. Because they're opaque
         literals carrying a hardcoded background, leaving them alone paints
         Slack's canvas into our text — barely visible on a dark theme whose bg
         is near Slack's, and near-black-on-near-white on any light theme.
         Re-composite them against OUR bg instead. */
      --sk_foreground_max_solid: ${toTriplet(mix(theme.bg, fg, 0.7))} !important;
      --sk_foreground_high_solid: ${toTriplet(mix(theme.bg, fg, 0.5))} !important;
      --sk_foreground_mid_solid: ${toTriplet(mix(theme.bg, fg, 0.27))} !important;
      --sk_foreground_low_solid: ${toTriplet(mix(theme.bg, fg, 0.13))} !important;
      --sk_foreground_soft_solid: ${toTriplet(mix(theme.bg, fg, 0.05))} !important;
      --sk_foreground_min_solid: ${toTriplet(mix(theme.bg, fg, 0.04))} !important;

      /* ===== dt_color design tokens — REAL COLORS, not triplets =====
         Slack is mid-migration to a second token system, --dt_color-*, and it
         drives the surfaces the SK tokens no longer do: sender names read
         var(--dt_color-content-pry), links and @mention slugs read
         var(--dt_color-content-hgl-1). That's why a thread pane came out
         part-themed — body text obeyed us while names stayed Slack's #f8f8f8
         and mentions stayed Slack's #1264a3 cyan.
         Opposite format rule from the block above: these are consumed BARE
         (color: var(--dt_color-content-pry)), so they hold actual colors. A
         triplet here breaks them exactly the way hex broke the SK tokens.
         Format per token is a contract — verify, don't pattern-match.
         Only the foreground and outline families are mapped. The base- and
         surf- background tokens (--dt_color-base-pry alone is ~1100
         background-color declarations) are deliberately left to the explicit
         pane rules further down, which already own those surfaces; remapping
         both would double-tint them. */
      --dt_color-content-pry: ${fgStrong} !important;
      --dt_color-content-sec: ${fg} !important;
      --dt_color-content-ter: ${withAlpha(fg, 0.7)} !important;
      --dt_color-content-hgl-1: ${accent} !important;
      --dt_color-content-hgl-2: ${accent} !important;
      /* Ink for text sitting on an inverted/emphasis fill — that fill is the
         accent or the fg, so the readable ink there is the background. */
      --dt_color-content-inv-pry: ${theme.bg} !important;
      /* Focus ring + hairline. Slack ships otl-hgl-1 as its brand blue and
         otl-ter as an alpha-hex (#5e5d6021); keep the alpha shape. */
      --dt_color-otl-hgl-1: ${accent} !important;
      --dt_color-otl-ter: ${borderColor} !important;
      /* The one base- token that IS mapped, and deliberately: base-inv-hgl-2 is
         #007a5a — Slack's brand green — and it is the FILL of a confirm button
         rather than a page surface, so the base-/surf- reasoning above doesn't
         apply to it. It's also the shared source both halves of a split button
         read: the c-button--primary selector below catches the text half, but
         the caret half is an icon button that selector misses, so the caret came
         out brand green next to an accent-filled "Forward". Mapping the token
         fixes both halves at the source, and the other ~139 consumers with it. */
      --dt_color-base-inv-hgl-2: ${accent} !important;
      /* NOT mapped, on purpose: --dt_color-constants-white / -black are literal
         colors (icon fills, ink on brand buttons), and --dt_color-content-imp is
         the error red. Repointing literals inverts contrast — the same lesson the
         Outlook pack records for --white/--black. */
      --saf-0: ${theme.bg} !important;
      --saf-1: ${sidebarBg} !important;
      --saf-2: ${railBg} !important;
      --saf-100: ${sidebarBg} !important;

      /* Legacy sidebar tuple */
      --sidebar-background: ${sidebarBg} !important;
      --sidebar-text: ${sidebarFg} !important;
      --sidebar-text-hover: ${sidebarFg} !important;
      --sidebar-text-active: ${sidebarFg} !important;
      --sidebar-text-active-bg: ${selectedBg} !important;
      --sidebar-mention-badge: ${accent} !important;
      --sidebar-unread-count-bg: ${accent} !important;
      --sidebar-channel-text: ${sidebarFg} !important;
      --sidebar-channel-icon: ${sidebarMuted} !important;
      --sidebar-presence-online: ${accent} !important;
    }

    html, body { background-color: var(--omarchy-bg) !important; }

    /* ===== main / message area ===== */
    html body .p-client,
    html body .p-client_workspace,
    html body .p-client_workspace__layout,
    html body .p-workspace,
    html body [class*="p-workspace__primary_view"],
    html body [class*="primary_view_body"],
    html body [class*="primary_view_contents"],
    /* NOT the sidebar variant: p-view_contents--sidebar contains "view_contents"
       too, so it was taking the message-pane colour. That left the sidebar panel
       painted like the message pane while the search-filter strip inside it kept
       the real sidebar colour (directPaint sets that one inline), which showed up
       as a stray rectangle around the search box, ending where the channel list
       began. The sidebar block below owns that element. */
    html body [class*="view_contents"]:not([class*="--sidebar"]),
    html body [class*="tabbed_channel"],
    html body [class*="channel_tab_panel"],
    html body [class*="p-message_pane"],
    html body [class*="message_pane"],
    html body [class*="p-threads_view"],
    html body [class*="channel_info_pane"],
    html body .c-virtual_list__scroll_container,
    html body [class*="c-message_kit__background"],
    /* Undecorated full-pane div directly under the workspace wrapper: Slack
       leaves it on a hardcoded navy on every view (found by auditing painted
       area — see Dev / test workflow). */
    html body [class*="p-client_workspace_wrapper"] > div {
      background-color: var(--omarchy-bg) !important;
    }

    /* Editing a message: Slack washes the whole row in a hardcoded yellow
       (rgba(242,199,68,.2)), which fights every omarchy palette. Use a much
       fainter accent wash — enough to say "this row is being edited" without
       tinting the editor and its toolbar. A hover-strength wash (20% accent)
       reads as heavy here because it covers the whole edit box, not one row. */
    html body [class*="c-message_kit__background--editing"],
    html body [class*="message_kit__background--editing"] {
      background-color: ${withAlpha(accent, 0.07)} !important;
    }

    /* Inside the editing row, the editor chrome must not stack a second tint on
       top of that wash (the composer rules paint these with --omarchy-bg, which
       over the wash reads as a lighter panel). Keep them transparent so the row
       is one flat surface, and give the formatting toolbar a plain divider
       instead of its own filled strip. */
    html body [class*="--editing"] [class*="c-wysiwyg_container"],
    html body [class*="--editing"] [class*="c-texty_input"],
    html body [class*="--editing"] [class*="ql-container"],
    html body [class*="--editing"] [class*="ql-editor"] {
      background-color: transparent !important;
    }
    html body [class*="--editing"] [class*="c-wysiwyg_container__formatting"] {
      background-color: transparent !important;
      border-color: var(--omarchy-border) !important;
    }
    /* Toolbar buttons: readable icons on the wash, accent only on the active
       (toggled-on) formatting buttons. */
    html body [class*="--editing"] [class*="c-wysiwyg_container__formatting"] button,
    html body [class*="--editing"] [class*="c-texty_buttons"] button {
      color: ${withAlpha(fg, 0.75)} !important;
      background-color: transparent !important;
    }
    html body [class*="--editing"] [class*="c-wysiwyg_container__formatting"] button:hover,
    html body [class*="--editing"] [class*="c-texty_buttons"] button:hover {
      color: var(--omarchy-fg-strong) !important;
      background-color: var(--omarchy-hover-bg) !important;
    }

    /* ===== dropdown menus / overlays =====
       Menus (the More…, Admin, and every context menu) paint their own dark
       surface and never picked up our vars. They're the largest remaining
       unthemed area after the panes. ===== */
    html body [class*="c-menu__items"],
    html body [class*="c-menu--alternate"],
    html body [class*="p-more_menu"],
    html body [class*="c-menu_group"],
    html body [class*="p-team_switcher_menu"] {
      background-color: var(--omarchy-nav-bg) !important;
      border-color: var(--omarchy-border) !important;
    }

    /* Slack's brand-green primary buttons → the omarchy accent.
       The :not() is load-bearing. Without it this also painted DISABLED primary
       buttons at full accent, so a disabled button looked clickable — visible on
       the Forward dialog, where the greyed-out caret sat beside a confident
       accent-filled "Forward". Slack marks the state with c-button--disabled. */
    html body [class*="c-button--primary"]:not([class*="c-button--disabled"]) {
      background-color: var(--omarchy-accent) !important;
      border-color: var(--omarchy-accent) !important;
    }

    /* Disabled primary buttons, and the caret half of a split button, which is an
       icon button rather than a c-button--primary and so needs naming separately.
       Slack fills its disabled state from --dt_color-base-ter, a general
       tertiary surface with 479 uses that must not be remapped wholesale, so the
       two halves are matched here instead and given one themed muted fill. */
    html body [class*="c-button--primary"][class*="c-button--disabled"],
    html body [class*="schedule_send_button"][class*="c-button--disabled"] {
      background-color: ${withAlpha(fg, 0.12)} !important;
      border-color: transparent !important;
      color: ${withAlpha(fg, 0.38)} !important;
    }

    /* The "Today" tab's own pane wrapper (hashed class — match the stable
       prefix). It was the single largest unthemed surface left in the client. */
    html body [class*="todayWrapper"],
    html body [class*="p-autoclog__hook"] {
      background-color: var(--omarchy-bg) !important;
    }

    /* ===== left tab rail (workspace switcher + Home/DMs/...) ===== */
    html body [class*="tab_rail"],
    html body [class*="workspace_switcher"],
    html body [class*="nav_rail"],
    html body [class*="rail__nav"],
    html body [class*="p-ia4_tab_rail"],
    html body [class*="p-ia__nav"],
    html body nav[aria-label*="primary navigation" i],
    html body nav[aria-label*="workspace" i] {
      background-color: var(--omarchy-nav-bg) !important;
      border-color: var(--omarchy-border) !important;
    }

    /* ===== channel sidebar — paint container AND any direct child that draws its own bg ===== */
    html body [class*="channel_sidebar"],
    html body [class*="p-channel_sidebar"],
    html body [class*="p-ia4_channel_sidebar"],
    html body [class*="left_nav"],
    html body [class*="sidebar_list"],
    html body [data-qa="channel_sidebar"],
    html body [class*="p-ia__sidebar"],
    html body [class*="p-ia4__sidebar"],
    html body [class*="sidebar_layout"],
    html body [class*="view_contents--sidebar"],
    html body [class*="sidebar_text_filter_input_header"],
    html body [class*="rainbow"] {
      background-color: var(--omarchy-sidebar-bg) !important;
      color: var(--omarchy-fg) !important;
      border-color: var(--omarchy-border) !important;
    }

    /* sidebar headers / workspace menu — scoped to the channel sidebar only
       so we don't blow away the background of the Ctrl+K switcher, prefs
       dialog, or other modals that happen to contain "workspace" / "header"
       class fragments. */
    html body [class*="channel_sidebar"] [class*="sidebar_header"],
    html body [class*="channel_sidebar"] [class*="workspace_menu"],
    html body [class*="channel_sidebar"] [class*="workspace_header"],
    html body [class*="channel_sidebar"] [class*="channel_sidebar__static_list"],
    html body [class*="channel_sidebar"] [class*="channel_sidebar__list"],
    html body [class*="p-ia__sidebar"] [class*="sidebar_header"],
    html body [class*="p-ia4_channel_sidebar"] [class*="workspace_menu"] {
      background-color: transparent !important;
      color: var(--omarchy-fg) !important;
    }

    /* Defensive: stop transparency leaking into dialog/menu chrome from our
       variable overrides. Just sets an opaque background — interior styling
       is left to Slack's color mode (which we now auto-flip reliably). */
    html body [role="dialog"]:not([aria-label="Huddle"]),
    html body [role="menu"],
    html body [class*="ReactModal__Content"] {
      background-color: var(--omarchy-bg) !important;
    }

    /* ...except a tooltip, which Slack renders inside a ReactModal carrying
       role="dialog" — so the rule above matched it twice and painted an opaque
       theme-bg rectangle behind the bubble. The wrapper is ~8px taller than the
       tip, so it showed as a dark slab spilling out below the rounded corners
       (measured: wrapper 328→438, bubble 328→430). The tooltip paints its own
       surface; its wrapper must not paint anything. :has() takes the specificity
       of its argument, so this outranks the rule above without having to weaken
       it for real dialogs. */
    html body [role="dialog"]:has([class*="c-tooltip__tip"]),
    html body [class*="ReactModal__Content"]:has([class*="c-tooltip__tip"]) {
      background-color: transparent !important;
    }

    /* Make every container inside the channel sidebar transparent so the
       sidebar's solid bg color shows edge-to-edge top to bottom. Section
       containers (Unreads/Threads/…, Starred, DMs, Channels), per-item
       links, section headings, and virtual list wrappers all get
       transparent bg by default. The :not() chain skips any row in an
       interactive state — hover, --selected, --active, aria-selected,
       aria-current — so the pill rule below can paint over those. */
    html body [class*="channel_sidebar"] section,
    html body [class*="channel_sidebar"] [class*="section"]:not([class*="section_heading_text"]),
    html body [class*="channel_sidebar"] [class*="static_list"],
    html body [class*="channel_sidebar"] [class*="virtual_list"],
    html body [class*="channel_sidebar"] [class*="sidebar_link"]:not(:hover):not([class*="--selected"]):not([class*="--active"]):not([aria-selected="true"]):not([aria-current="true"]):not([aria-current="page"]),
    html body [class*="channel_sidebar"] [class*="c-link"]:not(:hover):not([class*="--selected"]):not([class*="--active"]):not([aria-selected="true"]):not([aria-current="true"]):not([aria-current="page"]),
    html body [class*="channel_sidebar"] [class*="channel_sidebar__channel"]:not(:hover):not([class*="--selected"]):not([class*="--active"]):not([aria-selected="true"]):not([aria-current="true"]),
    html body [class*="channel_sidebar"] [class*="static_list__item"]:not(:hover):not([class*="--selected"]):not([class*="--active"]):not([aria-selected="true"]):not([aria-current="true"]),
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__static_list_item"]:not(:hover):not([class*="--selected"]):not([class*="--active"]):not([aria-selected="true"]):not([aria-current="true"]),
    html body [class*="channel_sidebar"] [class*="section_heading"],
    html body [class*="channel_sidebar"] [class*="channel_sidebar__section_heading"],
    html body [class*="channel_sidebar"] ul,
    html body [class*="channel_sidebar"] li:not(:hover):not([class*="--selected"]):not([class*="--active"]):not([aria-selected="true"]):not([aria-current="true"]) {
      background-color: transparent !important;
    }

    /* Slack also paints some of these via CSS variables — nullify the
       backgrounds those resolve to so the sidebar bg shows through even
       on rules we haven't enumerated. */
    html body [class*="channel_sidebar"] {
      --c-link__bg: transparent !important;
      --p-channel_sidebar__static_list__background: transparent !important;
      --p-channel_sidebar__static_list__item__background: transparent !important;
      --p-channel_sidebar__section_heading__background: transparent !important;
    }

    /* hovered + selected channel rows — rounded pill highlight inset from
       the sidebar edges. Anchored on the two row-container classes Slack
       actually uses (p-channel_sidebar__channel for chats/DMs,
       p-channel_sidebar__link for top-level nav like Unreads/Huddles).
       We deliberately do NOT include c-link or generic sidebar_link in this
       rule — those are inner wrappers that also get :hover via bubbling, and
       painting them too stacks a second mis-aligned pill on top. */
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__channel"]:hover,
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__link"]:hover {
      background-color: var(--omarchy-hover-bg) !important;
      border-radius: 8px !important;
      margin: 0 8px !important;
    }
    /* Inner c-link sits on top of the row container — Slack paints its own
       hover bg on it, which would cover the parent's. Force the inner
       transparent so our parent hover bg is what shows. Scoped to inside a
       hovered row so we don't blow away c-link styling elsewhere. */
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__channel"]:hover [class*="c-link"],
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__link"]:hover [class*="c-link"] {
      background-color: transparent !important;
    }
    /* Slack paints a darker per-name highlight on the channel-name span
       inside the row on hover (visible on rows with "--unread" or other
       state modifiers). Force every descendant of a hovered row to
       transparent so only the outer pill bg shows. Badges keep their fill. */
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__channel"]:hover *:not([class*="badge"]):not([class*="mention"]):not([class*="unread_count"]):not([class*="c-mention"]),
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__link"]:hover *:not([class*="badge"]):not([class*="mention"]):not([class*="unread_count"]):not([class*="c-mention"]) {
      background-color: transparent !important;
    }
    /* Background + border-radius for the selected pill are painted inline by
       paintActiveRows() — only on the innermost selected element — so the
       row wrapper and its inner button don't stack two pills. CSS here just
       strips Slack's default outline / box-shadow / border on selected rows
       and forces our text color. Anchors are class-prefix-specific so we
       don't catch unrelated --active elements (e.g. c-presence--active on
       the avatar online-dot). */
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__channel--selected"],
    html body [class*="channel_sidebar"] [class*="p-channel_sidebar__channel--active"] {
      color: var(--omarchy-fg) !important;
      outline: none !important;
      box-shadow: none !important;
      border-color: transparent !important;
    }
    html body [class*="p-channel_sidebar__channel--selected"] *,
    html body [class*="p-channel_sidebar__channel--active"] * {
      color: var(--omarchy-fg) !important;
      background-color: transparent !important;
    }

    /* ===== top nav (the search bar row) ===== */
    html body [class*="top_nav"],
    html body [class*="p-ia4_top_nav"],
    html body [class*="p-ia__top_nav"],
    html body [class*="p-classic_nav"],
    html body [class*="p-view_header"]:not([class*="message_view_header"]),
    html body [class*="p-ia__view_header"] {
      background-color: var(--omarchy-nav-bg) !important;
      border-color: var(--omarchy-border) !important;
      color: var(--omarchy-fg) !important;
    }

    /* search input pill — transparent so the themed top-nav chrome shows
       through. Slack's default fills it with a contrasting surface color
       that reads as an unthemed white/grey rectangle against our chrome. */
    html body [class*="top_nav__search"],
    html body [class*="search_input"],
    html body [class*="p-top_nav__search_container"],
    html body [class*="p-top_nav__search"] {
      background-color: transparent !important;
      color: var(--omarchy-fg) !important;
      border-color: var(--omarchy-border) !important;
    }

    /* ===== channel header tab bar ("Messages / Add canvas / Files / +")
            AND its right-side action strip — Slack puts these in different
            class fragments, so we cast a wide net. Excludes the prefs dialog's
            tab menu, which uses the same c-tabs base class. Borders made
            transparent so the strip blends into the message pane instead of
            reading as a separate boxed region. ===== */
    html body [class*="p-message_pane_header"],
    html body [class*="p-message_pane__tab"],
    html body [class*="p-message_view_header"],
    html body [class*="p-view_header__title"],
    html body [class*="p-workspace__primary_view_header"],
    html body [class*="channel_tab_bar"],
    html body [class*="channel_tab_"],
    html body [class*="draggable_tabs"],
    html body [class*="p-tab_container"],
    html body [class*="p-view_header__tab"],
    html body [class*="p-view_header__actions"],
    html body [class*="p-view_header__buttons"],
    html body [class*="p-message_pane__actions"],
    html body [class*="p-message_pane_actions"],
    html body [class*="p-tab_container__action"],
    html body [class*="p-action_buttons"],
    html body [class*="c-tabs__tab_menu"]:not(.p-prefs_dialog__menu):not([data-qa="tabs_full_width_class"]),
    html body [class*="c-tabs"]:not([class*="prefs"]):not([data-qa="tabs_full_width_class"]) {
      background-color: var(--omarchy-bg) !important;
      color: var(--omarchy-fg) !important;
      border-color: transparent !important;
    }

    /* The wide [class*="c-tabs"] net above is for the channel-header tab strip,
       but the LEFT RAIL's buttons are c-tabs__* elements too, so their
       tab_content spans were picking up the message-pane bg. On dark themes
       that's invisible; on light ones it painted a cream pill behind every rail
       icon and label. The rail's own surface (plus its inline chromeBg paint)
       is already correct — the tabs inside it need no fill.
       Rail containers escape the c-tabs rule only because directPaint sets them
       inline, which is why this went unnoticed.
       The :not() pair is NOT decoration — the rule above carries two of them,
       so it scores (0,3,2); a plain two-attribute descendant selector loses to
       it even though it comes later. Matching its :not()s puts us at (0,4,2). */
    html body [class*="tab_rail"] [class*="c-tabs__tab"]:not([class*="prefs"]):not([data-qa="tabs_full_width_class"]),
    html body [class*="p-ia4_tab_rail"] [class*="c-tabs__tab"]:not([class*="prefs"]):not([data-qa="tabs_full_width_class"]),
    html body [class*="workspace_switcher"] [class*="c-tabs__tab"]:not([class*="prefs"]):not([data-qa="tabs_full_width_class"]) {
      background-color: transparent !important;
    }

    /* Rail tab labels and their keyboard-shortcut hints. The rail rule above
       matches these (their classes contain "tab_rail") and gives each an opaque
       fill, so the text sits in a hard-edged rectangle instead of on the rail —
       most obvious on the active tab, and it vanishes on hover, which is exactly
       what makes the resting state look wrong. They carry no surface of their
       own; let the rail show through. The active tab's icon outline is Slack's
       selected-tab affordance and is deliberately left alone. */
    html body [class*="tab_rail"] [class*="button__label"],
    html body [class*="tab_rail"] [class*="shortcut_hint"] {
      background-color: transparent !important;
    }

    /* ===== quick-switcher / search modal =====
       Slack hardcodes this whole surface: the pseudo-selected row at
       rgb(234,234,234), the keyboard-key chips at rgb(221,221,221), the footer
       at pure white, and the feedback link in Slack blue. None of it follows the
       theme, so on a light palette the modal reads as a grey card. ===== */
    html body [class*="c-search_autocomplete__footer"],
    html body [class*="c-search_modal__footer"] {
      background-color: var(--omarchy-sidebar-bg) !important;
      border-color: var(--omarchy-border) !important;
      color: var(--omarchy-fg) !important;
    }
    html body [class*="c-search_autocomplete__suggestion_item--pseudo-selected"],
    html body [class*="c-search_autocomplete__suggestion_item"][aria-selected="true"],
    html body [class*="c-search_autocomplete__suggestion_item"]:hover {
      background-color: var(--omarchy-hover-bg) !important;
    }
    html body [class*="c-keyboard_key"] {
      background-color: ${withAlpha(fg, 0.1)} !important;
      border-color: var(--omarchy-border) !important;
      color: var(--omarchy-fg) !important;
    }
    /* Slack-blue links → the theme accent. Scoped to the surfaces we repaint
       (the search modal and the workspace banners), so message-body links keep
       Slack's own link colour and stay distinguishable as user content. */
    html body [class*="c-search_modal"] [class*="c-link--button"],
    html body [class*="c-search_modal"] a,
    html body [class*="c-banner"] [class*="c-link"],
    html body [class*="c-banner"] a,
    html body [class*="p-ia__workspace_banner"] a,
    html body [class*="p-client__banners"] a {
      color: var(--omarchy-accent) !important;
    }

    /* The composer's context bar — "X has paused their notifications", editing
       context, and similar notices that sit above the input. Slack fills it with
       a hardcoded rgb(243,243,243), so on any themed composer it reads as an
       unthemed white strip. Use a faint wash of the theme foreground: still a
       distinct notice band, but in-palette. */
    html body [class*="p-context_bar"] {
      background-color: ${withAlpha(fg, 0.06)} !important;
      color: var(--omarchy-fg) !important;
      border-color: var(--omarchy-border) !important;
    }
    html body [class*="p-context_bar"] [class*="content"],
    html body [class*="p-context_bar"] span,
    html body [class*="p-context_bar"] strong {
      background-color: transparent !important;
      color: var(--omarchy-fg) !important;
    }

    /* Sidebar "Find a conversation…" filter input. Slack fills this with a
       hardcoded rgba(255,255,255,.9) plus a near-black hairline, so on a tinted
       sidebar it reads as a pale card floating over the list rather than an
       input. Give it the same treatment as the composer: a faint wash of the
       theme's own foreground, with our border. */
    html body [class*="c-filter_input"],
    html body [data-qa="sidebar-text-filter-input"] {
      background-color: ${withAlpha(fg, 0.06)} !important;
      border-color: var(--omarchy-border) !important;
      color: var(--omarchy-fg) !important;
    }
    html body [class*="c-filter_input"] input,
    html body [class*="c-filter_input"] [class*="icon"],
    html body [data-qa="sidebar-text-filter-input"] input {
      background-color: transparent !important;
      color: var(--omarchy-fg) !important;
    }

    /* Reaction chips. Slack fills them with its own near-black 6% wash and dark
       ink, and paints the "you reacted" state pale blue with blue text — none of
       it theme-aware, so on light themes they read as washed-out pills floating
       on the message. Derive all three from the theme instead.

       The __tip exclusion is load-bearing. The hover tooltip's internals are
       ALSO named c-reaction (c-reaction__tip, __tip--emoji_wrapper,
       __tip--emoji), so a bare [class*="c-reaction"] matched three nested
       elements inside it and stacked this wash three times over — the tooltip
       came out as a set of mismatched grey bands with the emoji sitting in the
       lightest one. Same over-broad-substring trap as view_contents and
       tab_rail: match the chip, not everything sharing its prefix. */
    html body [class*="c-reaction"]:not([class*="c-reaction_bar"]):not([class*="__tip"]) {
      background-color: ${withAlpha(fg, 0.07)} !important;
      color: var(--omarchy-fg) !important;
      border-color: var(--omarchy-border) !important;
    }
    html body [class*="c-reaction"][aria-pressed="true"],
    html body [class*="c-reaction--reacted"] {
      background-color: ${withAlpha(accent, 0.18)} !important;
      color: var(--omarchy-fg-strong) !important;
      border-color: ${withAlpha(accent, 0.45)} !important;
    }
    html body [class*="c-reaction__count"] {
      color: inherit !important;
    }

    /* ===== tooltips =====
       Slack builds every tooltip off ONE local variable: .c-tooltip__tip sets
       --background (to --dt_color-base-inv-pry, a neutral near-black), and both
       the bubble and its arrow — a real child element, .c-tooltip__tip__arrow,
       not a pseudo — read var(--background). So redefining that single variable
       on the tip re-colours the bubble and the arrow together, and none of the
       eight direction variants (--top, --bottom-left, …) need naming. */
    html body [class*="c-tooltip__tip"] {
      /* An elevated surface of its own, NOT --omarchy-nav-bg. A tooltip has to
         read as floating above whatever it covers, and nav-bg lands within a few
         points of the hovered message row (hover is a 20% accent wash over the
         page: rgb(45,54,80) against nav-bg's rgb(45,50,68) on tokyo-night), so
         the bubble dissolved into the row underneath it. Mixing toward the
         foreground instead lifts it clear on dark themes and darkens it on light
         ones, with no polarity special-casing.
         Text is fg-strong rather than fg: on the lifted surface plain fg
         measures 4.27:1, just under AA; fg-strong gives 5.98:1 dark and 6.89:1
         light. */
      --background: ${mix(theme.bg, fg, 0.3)} !important;
      color: var(--omarchy-fg-strong) !important;
      border-color: var(--omarchy-border) !important;
      /* Slack outlines the tip with filter: drop-shadow(0 0 1px
         var(--dt_color-otl-pry)), an unmapped #797c81 grey. A drop-shadow traces
         the element's ALPHA SILHOUETTE, so it rings the bubble AND the arrow —
         which reads as a pale rim spilling past the rounded corners rather than
         as a border. Re-point it at the theme hairline; the tooltip already
         separates from the page by sitting on the nav surface. */
      filter: drop-shadow(0 0 1px var(--omarchy-border)) !important;
    }

    /* The emoji preview inside a reaction tooltip is deliberately matted on
       WHITE by Slack (--dt_color-brand-core-white, and a literal #fff on the
       emoji-picker variant) so emoji look consistent on their light canvas. On a
       dark theme that is a white postage stamp punched into the tooltip. Emoji
       PNGs are transparent and read fine unmatted — the inline chips already
       prove it — so drop the plate rather than repointing the brand-white
       literal, which is a constant that other things rely on. */
    html body [class*="c-reaction__tip--emoji"] [class*="c-emoji__large"],
    html body [class*="c-reaction__tip--emoji"] [class*="c-emoji__larger"],
    html body [class*="c-emoji__emoji-tooltip"] [class*="c-emoji__large"],
    html body [class*="c-emoji__emoji-tooltip"] [class*="c-emoji__larger"] {
      background-color: transparent !important;
    }

    /* "Jump to first unread" / "N new messages" floating pill at the top of
       the message pane. Painted with the theme accent so it pops, with text
       in theme.bg for contrast against the saturated fill. */
    html body [class*="p-message_pane__unread_banner__msg"],
    html body [class*="p-message_pane__unread_banner"] button {
      background-color: var(--omarchy-accent) !important;
      color: var(--omarchy-bg) !important;
    }
    html body [class*="p-message_pane__unread_banner__msg"] *,
    html body [class*="p-message_pane__unread_banner"] button * {
      color: var(--omarchy-bg) !important;
      fill: currentColor !important;
    }

    /* (Removed the aggressive "transparent" rule for view_header / message_pane_header
       children — it was a workaround for the black-strip bug when Slack mode
       was out of sync with omarchy. With auto-flip reliable, Slack paints
       those children correctly and the rule was instead causing messages to
       bleed through the tab strip.) */

    /* ===== message hover ===== */
    html body [class*="c-message_kit__hover"]:hover,
    html body [class*="c-message_kit__background--hovered"] {
      background-color: var(--omarchy-hover-bg) !important;
    }

    /* Slack nests its own hover layer (c-message_kit__hover--hovered) inside the
       hovered row, so both selectors above match at once and the wash stacks
       (0.2 over 0.2 ≈ 0.36 — it reads muddy, not tinted). The outer row carries
       the wash; the inner layer must stay clear. */
    html body [class*="c-message_kit__background--hovered"] [class*="c-message_kit__hover"] {
      background-color: transparent !important;
    }

    /* The compact timestamp gutter is named p-message_pane_message__compact_timestamp,
       so the broad [class*="p-message_pane"] rule in the main-pane block above
       painted it an OPAQUE --omarchy-bg. On a hovered row that punched a
       bg-colored hole through the wash right where the time sits (the "cut out
       date"). It needs no fill of its own — the row behind it is already ours. */
    html body [class*="p-message_pane_message__compact_timestamp"],
    html body [class*="c-timestamp"] {
      background-color: transparent !important;
    }

    /* The floating message action toolbar (👍 ❤️ ✅ … New) and the emoji
       reaction picker popover. Slack's default background for these is a
       translucent token that goes see-through against our repainted message
       pane — force opaque. Uses a barely-off-bg shade so it reads as a subtle
       floating bar rather than a solid contrasting box. */
    html body [class*="c-message_actions__group"],
    html body [class*="c-reaction_picker"] {
      background-color: ${shade(theme.bg, dir * 0.05)} !important;
      border: 1px solid var(--omarchy-border) !important;
    }

    /* ===== floating pills in the message stream — paint the inner label
            AND the button it contains, so the date pill always covers the
            horizontal line and any message text behind it. Uses a neutral
            shade (not the accent-tinted navBg) so the pill stays unobtrusive
            in the message flow. ===== */
    html body [class*="new_messages_marker"],
    html body [class*="new_messages_pill"],
    html body [class*="unread_divider"] [class*="label"],
    html body [class*="unread_divider"] button {
      background-color: ${shade(theme.bg, dir * 0.05)} !important;
      color: var(--omarchy-fg) !important;
    }

    /* Day-divider label container — transparent so only the inner pill
       shows its own accent fill; the surrounding row stays flat. */
    html body [class*="c-message_list__day_divider__label"] {
      background-color: transparent !important;
    }

    /* Top-banner container that hosts the floating "Search messages…" pill.
       The container paints a solid rectangle behind the rounded pill, which
       reads as an unthemed dark box around it. Make the container
       transparent so just the pill shows. */
    html body [class*="p-message_pane__top_banners"] {
      background-color: transparent !important;
    }

    /* Slack applies a top-edge fade mask on the message list via
       c-scrollbar--fade so content fades out as it scrolls past the tab
       bar. Against our themed bg this reads as a transparent strip where
       messages bleed through. Kill the mask. */
    html body [class*="c-scrollbar--fade"],
    html body [class*="c-message_list"] {
      -webkit-mask-image: none !important;
      mask-image: none !important;
    }

    /* Horizontal date-separator line that runs behind the day-divider pill.
       Slack draws it with a contrasting color that reads as a dark stripe
       across our themed message pane (especially when the pill sticks at
       the top of the scroll area). Use a subtle theme border instead. The
       outer day_divider wrapper has its own thicker bg — flatten that too. */
    html body [class*="c-message_list__day_divider"]:not([class*="__label"]):not([class*="__line"]) {
      background-color: transparent !important;
    }
    html body [class*="c-message_list__day_divider__line"] {
      background-color: transparent !important;
      border-top-color: var(--omarchy-border) !important;
      border-bottom-color: var(--omarchy-border) !important;
    }

    /* "Today" / date-jump pill in the message list — paint with the theme
       accent (matching the tab-rail unread badges). Chained with day_divider
       ancestor so this rule's specificity beats the generic
       [class*="day_divider"] button rule above. */
    html body [class*="day_divider"] [class*="__label__pill"],
    html body button[class*="c-message_list__day_divider__label__pill"] {
      background-color: var(--omarchy-accent) !important;
      color: var(--omarchy-bg) !important;
    }
    html body [class*="day_divider"] [class*="__label__pill"] *,
    html body button[class*="c-message_list__day_divider__label__pill"] * {
      color: var(--omarchy-bg) !important;
      fill: currentColor !important;
    }

    /* ===== message composer / input area =====
       Outer wrappers blend with the message pane (same bg, no border) so the
       composer doesn't read as a separate filled rectangle. The inner editable
       area gets a soft tint + thin outline — that's the "input field" the user
       interacts with, matching Slack's default rounded-rectangle treatment. */
    html body [class*="p-message_pane_input"],
    html body [class*="p-workspace__input"],
    html body [class*="p-composer"],
    html body [class*="c-wysiwyg_container"],
    html body [class*="p-rich_text_input"],
    html body [class*="p-message_input_field"] {
      background-color: var(--omarchy-bg) !important;
      color: var(--omarchy-fg) !important;
      border-color: transparent !important;
    }

    html body [class*="p-message_input"],
    html body [class*="p-message_input__primary_container"],
    html body [class*="c-texty_input"],
    html body [class*="c-texty_input_unstyled"],
    html body [class*="texty_input_unstyled__container"],
    html body [class*="ql-toolbar"],
    html body [class*="ql-container"],
    html body [class*="ql-editor"],
    html body [class*="ql-placeholder"],
    html body [class*="texty_input_unstyled"],
    html body [data-qa="message_input"],
    html body [contenteditable="true"][data-qa*="message"],
    html body [contenteditable="true"][aria-label*="message" i] {
      background-color: transparent !important;
      color: var(--omarchy-fg) !important;
      border-color: var(--omarchy-border) !important;
    }

    /* Slack's "theme_light_bordered" modifier on the composer container
       paints a hard white box on light themes — make it transparent so the
       outer composer color shows. Scoped to texty_input/ql so we don't blow
       a hole through bordered headers/dividers elsewhere. */
    html body [class*="texty_input"][class*="theme_light_bordered"],
    html body [class*="texty_input"][class*="--theme_light"],
    html body [class*="texty_input"][class*="--bordered"],
    html body [class*="ql-container"][class*="theme_light_bordered"] {
      background-color: transparent !important;
      border-color: var(--omarchy-border) !important;
    }

    /* placeholder text */
    html body [contenteditable="true"][data-qa*="message"]::before,
    html body [class*="ql-editor"].ql-blank::before {
      color: ${withAlpha(fg, 0.5)} !important;
    }

    /* The empty <p><br></p> Quill inserts in the editor renders with its own
       background on some Slack builds — force transparent so it inherits the
       editor's "input field" shade instead of showing as a stripe. */
    html body [class*="ql-editor"] p,
    html body [contenteditable="true"][data-qa*="message"] p {
      background-color: transparent !important;
    }

    /* ===== DMs / Activity tab list items =====
       Slack paints these p-activity_ia4_page rows + the page container with
       their own dark surface + divider lines that don't match our themed
       pane. Paint the page itself with the sidebar bg so it reads like the
       Home sidebar, flatten the rows, and give hovered/selected rows our
       sidebar-style accent pill.

       Slack's redesigned Activity feed (activity_inbox / design_v3) renamed
       the row classes: the page-scoped p-activity_ia4_page__item* became
       hashed activity_row_content_container__*, the scroll area became
       p-view_sidebar--list--activity_inbox, and the per-sender avatar box
       became activity_row_content__sender_icon_container__*. Both naming
       schemes are matched below so the theme covers old and new builds. */
    html body [class*="p-activity_ia4_page"]:not([class*="__item"]):not([class*="__senders"]),
    html body [class*="p-view_sidebar--list--activity_inbox"],
    html body [class*="p-dms_page"],
    html body [class*="p-activity_page"],
    html body [class*="p-direct_messages"],
    html body [class*="c-virtual_list"][aria-label*="Direct messages" i],
    html body [class*="c-virtual_list"][aria-label*="Direct messages" i] [class*="c-scrollbar__hider"],
    html body [class*="c-virtual_list"][aria-label*="Direct messages" i] [class*="c-virtual_list__scroll_container"] {
      background-color: var(--omarchy-sidebar-bg) !important;
    }
    html body [class*="p-activity_ia4_page__item"],
    html body [class*="p-dms_channel"],
    html body [class*="p-activity_ia4_page__item_container"],
    html body [class*="activity_row_content_container"],
    html body [class*="activity_row_content__sender_icon_container"],
    html body [class*="activity_row_content__status_icon"] {
      background-color: transparent !important;
      border-color: transparent !important;
      box-shadow: none !important;
    }
    /* Row hover pill — matches the home sidebar's hover treatment. */
    html body [class*="p-activity_ia4_page__item_container"]:hover,
    html body [class*="p-activity_ia4_page__item"]:hover,
    html body [class*="activity_row_content_container"]:hover {
      background-color: var(--omarchy-hover-bg) !important;
      border-radius: 8px !important;
    }
    /* Kill the per-name inner highlight Slack paints on hover so only the
       outer row pill shows. Badges/mentions keep their own accent fill. */
    html body [class*="p-activity_ia4_page__item_container"]:hover *:not([class*="badge"]):not([class*="mention"]):not([class*="c-mention"]),
    html body [class*="p-activity_ia4_page__item"]:hover *:not([class*="badge"]):not([class*="mention"]):not([class*="c-mention"]),
    html body [class*="activity_row_content_container"]:hover *:not([class*="badge"]):not([class*="mention"]):not([class*="c-mention"]):not([class*="unread_indicator"]) {
      background-color: transparent !important;
    }
    /* Selected pill — strengthened with [data-qa] anchor so it beats any
       Slack rule painting the inner c-message_kit__message surface. The
       new build draws selection as a gray inset ring (box-shadow) instead
       of a fill; box-shadow:none above flattens it, this re-adds our pill. */
    html body [data-qa="dms_channel"] [class*="p-activity_ia4_page__item--selected"],
    html body [class*="p-activity_ia4_page__item--selected--dm"],
    html body [class*="p-activity_ia4_page__item--selected"],
    html body [class*="activity_row_content_container--selected"] {
      background-color: var(--omarchy-selected-bg) !important;
      border-radius: 8px !important;
    }
    html body [class*="p-activity_ia4_page__item"] *,
    html body [class*="p-dms_channel"] * {
      background-color: transparent !important;
    }
    html body [class*="p-activity_ia4_page"] *:not([class*="badge"]):not([class*="mention"]):not(svg):not(path),
    html body [class*="p-dms_channel"] *:not([class*="badge"]):not([class*="mention"]):not(svg):not(path) {
      color: var(--omarchy-fg) !important;
    }
    /* Activity feed header — kill the dark "splotches". Slack paints the
       tab content wells (c-tabs__tab_content + draggable_tabs containers)
       and the filter/search/sort buttons (p-refine_button / c-button) with
       its own dark surface tokens, which sit darker than our themed header
       and read as random dark rectangles behind the tab counts and icons.
       Flatten them so they inherit the header's sidebar bg. Scoped to the
       Activity header/filter bar so channel tabs elsewhere are untouched. */
    html body [class*="activity_layout_header"] [class*="draggable_tabs"],
    html body [class*="p-activity_ia4_page__tab_container"],
    html body [class*="p-activity_ia4_page__tab_container"] [class*="c-tabs__tab"],
    html body [class*="p-activity_ia4_page__filter_bar"] [class*="p-refine_button"],
    html body [class*="p-activity_ia4_page__filter_bar"] [class*="c-button"],
    /* extra anchors to out-specify the broad c-tabs -> --omarchy-bg rule
       above — covers both the tab content wells and the "+" add-tab button
       (both are c-tabs__tab elements). */
    html body [class*="activity_layout_header"] [class*="draggable_tabs"] [class*="c-tabs__tab"]:not([data-qa="tabs_full_width_class"]) {
      background-color: transparent !important;
    }
    /* Tab unread counts ("10" on All, "5" on Mentions): brand them as accent
       pills so they pop instead of reading as bare red numbers, matching the
       tab-rail/sidebar badge treatment. High enough specificity to beat the
       broad p-activity_ia4_page sidebar-bg rule. */
    html body [class*="activity_layout_header"] [class*="c-tabs__tab_content"] [class*="unread_badge"] {
      background-color: var(--omarchy-accent) !important;
      color: var(--omarchy-bg) !important;
      border-radius: 9999px !important;
      padding: 0 6px !important;
      min-width: 18px !important;
      text-align: center !important;
      opacity: 1 !important;
    }
    html body [class*="activity_layout_header"] [class*="c-tabs__tab_content"] [class*="unread_badge"] * {
      color: var(--omarchy-bg) !important;
      background-color: transparent !important;
    }

    /* ===== unread / notification badges =====
       Tab rail badges (the "14" on Activity, "16" on Later) and sidebar
       unread/mention badges. Slack ships them in a muted/translucent token
       by default — force the theme accent so they pop and stay branded
       with the omarchy theme color. Text inside the pill uses the theme bg
       so it contrasts with the saturated accent. */
    html body [class*="tab_rail"] [class*="badge"],
    html body [class*="tab_rail"] [class*="pill"],
    html body [class*="tab_rail"] [class*="unread_count"],
    html body [class*="tab_rail"] [class*="unread_indicator"],
    html body [class*="tab_rail"] [class*="mention_badge"],
    html body [class*="p-ia4_tab_rail"] [class*="badge"],
    html body [class*="p-ia4_tab_rail"] [class*="unread"],
    html body [class*="channel_sidebar"] [class*="mention_badge"],
    html body [class*="channel_sidebar"] [class*="unread_count"],
    html body [class*="channel_sidebar"] [class*="c-mention_badge"],
    html body [class*="c-mention_badge"],
    html body [class*="p-channel_sidebar__badge"] {
      background-color: var(--omarchy-accent) !important;
      color: var(--omarchy-bg) !important;
      opacity: 1 !important;
    }

    /* ===== text readability: force fg on anything inside our themed panels =====
       Slack's per-mode colors don't know we've repainted the bg, so labels go
       invisible on the opposite-luminance bg. Force them. */
    html body [class*="tab_rail"] *:not([class*="badge"]):not([class*="unread"]),
    html body [class*="workspace_switcher"] *:not([class*="badge"]),
    html body [class*="channel_sidebar"] [class*="channel_name"],
    html body [class*="channel_sidebar"] [class*="channel_text"],
    html body [class*="channel_sidebar"] [class*="text"],
    html body [class*="channel_sidebar"] [class*="title"],
    html body [class*="channel_sidebar"] [class*="link"],
    html body [class*="channel_sidebar"] span,
    html body [class*="channel_sidebar"] a,
    html body [class*="channel_sidebar"] button,
    html body [class*="sidebar_layout"] [class*="text"],
    html body [class*="sidebar_layout"] [class*="title"],
    html body [class*="top_nav"] *:not([class*="badge"]):not([class*="unread"]):not(svg):not(path),
    html body [class*="p-view_header"] [class*="title"],
    html body [class*="p-view_header"] [class*="text"] {
      color: var(--omarchy-fg) !important;
    }

    /* SVG icons in the sidebar/top bar: tint them with fg so they stay visible */
    html body [class*="tab_rail"] svg,
    html body [class*="channel_sidebar"] svg:not([class*="emoji"]):not([data-stringify-type]),
    html body [class*="top_nav"] svg:not([class*="emoji"]) {
      color: var(--omarchy-fg) !important;
      fill: currentColor;
    }

    /* ===== unread channel rows: push the name color past --omarchy-fg
       toward white (dark themes) or black (light themes) =====
       Slack already bolds unread rows; we additionally bump the color to
       --omarchy-fg-strong so unread reads as more prominent than read rows
       (which land on Slack's per-mode muted token or our fg). The --unread
       modifier sits on the row container (p-channel_sidebar__channel--unread
       or p-channel_sidebar__link--unread for the top-level Unreads item),
       and the bolded label sits in a descendant with class
       p-channel_sidebar__name. The "__name *" arm catches unclassed inner
       spans so the broad "[class*=channel_sidebar] span" force-fg rule above
       doesn't win on them via inheritance. */
    html body [class*="channel_sidebar"] [class*="--unread"] [class*="__name"],
    html body [class*="channel_sidebar"] [class*="--unread"] [class*="__name"] * {
      color: var(--omarchy-fg-strong) !important;
    }
  `;

  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head || document.documentElement).appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;

  // Slack sets sidebar theme variables on specific elements with high
  // specificity — beat them by writing the same names inline on documentElement
  // and body using setProperty(..., "important"). Inline-important wins.
  const inlineVars = {
    "--rainbow-canvas": sidebarBg,
    "--rainbow-canvas-2": navBg,
    "--rainbow-text": fg,
    "--rainbow-action": fg,
    "--rainbow-action-hover": hoverBg,
    "--rainbow-action-active": withAlpha(accent, 0.28),
    "--rainbow-action-active-text": fg,
    "--rainbow-mention-badge": accent,
    "--rainbow-mention-text": theme.bg,
    "--sidebar-background": sidebarBg,
    "--sidebar-text": fg,
    "--sidebar-text-active-bg": hoverBg,
    "--saf-0": theme.bg,
    "--saf-1": sidebarBg,
    "--saf-2": navBg,
    "--saf-100": sidebarBg,
  };
  for (const [k, v] of Object.entries(inlineVars)) {
    document.documentElement.style.setProperty(k, v, "important");
    if (document.body) document.body.style.setProperty(k, v, "important");
  }

  // Write inline-important background-color directly on the tab rail,
  // channel sidebar, and top-nav elements. Slack sets its own inline styles
  // on these on blur (reverting to default aubergine), which beats our
  // external !important CSS. Inline-important on the element itself wins
  // back the cascade.
  const directPaint = [
    [
      // The :not()s matter: these are substring matches, so "tab_rail" also hits
      // p-tab_rail__button__label and __shortcut_hint. Painting those inline
      // stamps an opaque rectangle behind each label — and because inline
      // !important outranks every stylesheet rule, no CSS override can undo it.
      // Only the rail's own surfaces belong here.
      '[class*="tab_rail"]:not([class*="button__label"]):not([class*="shortcut_hint"]), [class*="workspace_switcher"], [class*="nav_rail"], [class*="rail__nav"], [class*="p-ia4_tab_rail"], [class*="p-ia__nav"]',
      chromeBg,
    ],
    [
      // view_contents--sidebar is the sidebar PANEL — it has to be painted with
      // the sidebar colour here too, or the strips inside it that directPaint
      // does reach (the search-filter header) end up a different colour from the
      // panel they sit on.
      '[class*="channel_sidebar"], [class*="p-channel_sidebar"], [class*="p-ia4_channel_sidebar"], [class*="left_nav"], [class*="sidebar_list"], [class*="p-ia__sidebar"], [class*="p-ia4__sidebar"], [class*="sidebar_layout"], [class*="view_contents--sidebar"]',
      sidebarBg,
    ],
    [
      '[class*="top_nav"], [class*="p-ia4_top_nav"], [class*="p-ia__top_nav"], [class*="p-classic_nav"]',
      chromeBg,
    ],
  ];
  for (const [selector, color] of directPaint) {
    for (const el of document.querySelectorAll(selector)) {
      el.style.setProperty("background-color", color, "important");
    }
  }

  // Selected-row pill. Slack's React re-renders the active row after the
  // initial paint and stomps our --selected bg with an inline style — so we
  // paint inline ourselves to win that race. The mutation observer below
  // re-runs this on every relevant attribute change in the sidebar, so it
  // keeps winning even after Slack re-renders.
  paintActiveRows();
  paintTabStrips();
}

// Track elements we've painted so we can wipe their inline styles when the
// selection moves elsewhere — otherwise the old pill lingers on the
// previously-selected row after navigation.
const paintedRowEls = new Set();
const paintedDescendantEls = new Set();

function paintActiveRows() {
  // Always clear last paint first, even if no theme yet — keeps cleanup correct.
  for (const el of paintedRowEls) {
    el.style.removeProperty("background-color");
    el.style.removeProperty("border-radius");
  }
  paintedRowEls.clear();
  for (const el of paintedDescendantEls) {
    el.style.removeProperty("background-color");
  }
  paintedDescendantEls.clear();

  const cur = OmarchyTheme.current;
  if (!cur) return;
  const theme = cur.theme;
  const bgRgb = hexToRgb(theme.bg);
  if (!bgRgb) return;
  const isDark = relLuminance(bgRgb) < 0.5;
  const accent = theme.accent || (isDark ? "#7aa2f7" : "#1264a3");
  const pillBg = withAlpha(accent, 0.35);

  // Class-prefix-specific anchors so we don't accidentally paint pills on
  // avatar online-dots (c-presence--active) or top-level nav items
  // (p-channel_sidebar__link--page on Unreads/Huddles/etc — those keep
  // Slack's default treatment, no pill).
  const selector =
    '[class*="channel_sidebar"] [class*="p-channel_sidebar__channel--selected"], ' +
    '[class*="channel_sidebar"] [class*="p-channel_sidebar__channel--active"]';
  const matches = Array.from(document.querySelectorAll(selector));
  if (!matches.length) return;

  // Pick innermost matches only — when a row's wrapper and its inner
  // button are both marked selected, paint just the inner one. Otherwise
  // we get a faded outer pill AND a darker inner pill stacked.
  const innermost = matches.filter(
    (el) => !matches.some((other) => other !== el && el.contains(other))
  );

  for (const el of innermost) {
    el.style.setProperty("background-color", pillBg, "important");
    el.style.setProperty("border-radius", "8px", "important");
    paintedRowEls.add(el);

    // Clear inline bg on descendants of the painted row so Slack's per-text
    // background highlights don't show through the pill. Skip badge/mention
    // pills — those need to keep their own accent fill.
    for (const child of el.querySelectorAll("*")) {
      if (child.matches('[class*="badge"], [class*="mention"], [class*="unread_count"], [class*="pill"]')) continue;
      child.style.setProperty("background-color", "transparent", "important");
      paintedDescendantEls.add(child);
    }
  }
}

// Paint the Activity/Threads "All / VIP" tab strip inline. Slack paints the
// tab_menu (data-qa="tabs_full_width_class") and the tab_container with its own
// surface token inline-with-important, which beats even our high-specificity
// !important CSS (both our rules on tab_container lose the cascade) — so we
// override it inline on the element itself, the same trick we use to win back
// the rail/sidebar bg. The Activity feed and the Threads view use these same
// p-activity_ia4_page__tab_* classes, so this covers both. We deliberately
// scope to the p-activity_ia4_page__ prefix so the Preferences modal's
// tabs_full_width_class menu is untouched.
function paintTabStrips() {
  const cur = OmarchyTheme.current;
  if (!cur || !cur.theme.bg) return;
  const bg = cur.theme.bg;
  const els = document.querySelectorAll(
    '[class*="p-activity_ia4_page__tab_menu"], [class*="p-activity_ia4_page__tab_container"]'
  );
  for (const el of els) {
    el.style.setProperty("background-color", bg, "important");
  }
}

// Theme dispatch (live pushes + the initial fetch) is owned by the engine in
// omarchy-runtime.js; this pack reacts through its registered apply()/
// onColorMode() hooks. To force a fresh paint after Slack clobbers our inline
// vars, call OmarchyTheme.reapply() (bypasses the engine's de-dup guard) — e.g.
// when Slack reverts to its default rainbow tokens on blur, or its React layer
// stomps our inline style on body/html.

// Re-apply if Slack's SPA navigation tears down our <style> node.
const observer = new MutationObserver(() => {
  if (!document.getElementById(STYLE_ID)) {
    chrome.runtime.sendMessage({ type: "request-theme" }, (theme) => {
      if (theme) OmarchyTheme.apply(theme);
    });
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });

// Watch <html> and <body> inline-style attribute changes — if Slack rewrites
// the style attribute (which it does on focus/blur) and drops our --rainbow-*
// vars, re-apply immediately. Cheap check via the sentinel var.
const SENTINEL_VAR = "--rainbow-canvas";
const styleObserver = new MutationObserver(() => {
  if (!OmarchyTheme.current) return;
  const present = document.documentElement.style.getPropertyValue(SENTINEL_VAR);
  if (!present || !present.trim()) OmarchyTheme.reapply();
});
styleObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
if (document.body) {
  styleObserver.observe(document.body, { attributes: true, attributeFilter: ["style"] });
}

// Re-paint the active-row pill whenever Slack mutates class / aria /
// inline-style on sidebar rows. Coalesced via rAF so a burst of mutations
// during a React re-render only triggers one paint.
let activeRowsRaf = 0;
function schedulePaintActiveRows() {
  if (activeRowsRaf) return;
  activeRowsRaf = requestAnimationFrame(() => {
    activeRowsRaf = 0;
    // We disconnect the observer while painting, otherwise the paints would
    // mutate the watched subtree, schedule the next repaint, and loop endlessly.
    // disconnect() also empties the queue, so a flag would not be enough.
    activeRowsObserver.disconnect();
    try {
      paintActiveRows();
      paintTabStrips();
    } finally {
      observeActiveRows();
    }
  });
}
const activeRowsObserver = new MutationObserver(schedulePaintActiveRows);
function observeActiveRows() {
  activeRowsObserver.observe(document.body || document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "aria-selected", "aria-current", "style"],
    childList: true,
  });
}
observeActiveRows();

// (The initial theme fetch is done by the engine in omarchy-runtime.js.)

// ----------------------------------------------------------------------------
// Programmatic click of Slack's Preferences → Appearance → Light/Dark button.
// Slack doesn't expose a "Sync with OS" option in this build, so we open the
// preferences modal off-screen, click the right radio, and close it.
// ----------------------------------------------------------------------------

const AUTOMATION_HIDE_ID = "omarchy-automation-hide";
let automating = false;
let lastAppliedMode = null; // "Light" | "Dark" | null

// Color-mode flip deferred because the tab was hidden — see armVisibilityRetry.
let pendingColorMode = null; // boolean targetIsDark, or null
let visibilityRetryArmed = false;
let visibilityRetryTimer = null;

// Chromium throttles timers HARD in a hidden tab: a 1s setTimeout chain
// measured a 2s median and a 60.6s maximum gap (intensive throttling kicks in
// after ~5 minutes hidden, dropping the tab to roughly one wake per minute).
// Every waitFor() budget in this file is 300-3000ms, so in a background tab
// each one gets about ONE poll before its deadline passes and the whole flow
// stalls — with the Preferences modal left open and the radio never flipped.
// So don't drive Slack's UI while hidden: park the target and run it when the
// tab comes back. visibilitychange is an event, not a timer, so it is not
// throttled and fires the moment the user looks at Slack again.
function armVisibilityRetry(targetIsDark) {
  pendingColorMode = targetIsDark; // latest theme wins if several land while hidden
  if (visibilityRetryArmed) {
    // Already listening — but if the tab came back between the hidden check
    // and subscribe, that visibilitychange is gone. Kick now rather than
    // waiting for the user to hide and show Slack again.
    if (!document.hidden) onVisibilityRetry();
    return;
  }
  visibilityRetryArmed = true;
  document.addEventListener("visibilitychange", onVisibilityRetry);
  if (!document.hidden) onVisibilityRetry();
}

function onVisibilityRetry() {
  if (document.hidden) return;
  document.removeEventListener("visibilitychange", onVisibilityRetry);
  visibilityRetryArmed = false;
  if (visibilityRetryTimer != null) return;

  // Slack's React tree needs a beat after the tab wakes before it responds.
  visibilityRetryTimer = setTimeout(() => {
    visibilityRetryTimer = null;
    // Wait out the automating lock rather than dropping the retry on the floor
    // (the lock is held for 500ms after a run finishes). Timers are reliable
    // again now that we're visible.
    const run = () => {
      if (automating) {
        setTimeout(run, 300);
        return;
      }
      // Read pending at execution time, not at visibilitychange: a theme that
      // lands in the 400ms wake delay (or while we waited out the lock) should
      // win, and a live ensureSlackColorMode claim clears pending so we don't
      // undo it.
      const target = pendingColorMode;
      pendingColorMode = null;
      if (target === null) return;
      console.log("[omarchy] tab visible again; running deferred color-mode flip");
      ensureSlackColorMode(target).catch((e) =>
        console.warn("[omarchy] deferred color-mode automation failed:", e)
      );
    };
    run();
  }, 400);
}

function sleep(ms) {
  // Hidden-tab timers are throttled to ~1 wake/minute. Don't start one.
  if (document.hidden) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(predicate, timeout = 3000, interval = 50) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    // Fail fast: a hidden tab will not meet the deadline, and spinning here
    // holds the automating lock for however long Chromium sleeps us.
    if (document.hidden) return null;
    const result = predicate();
    if (result) return result;
    await sleep(interval);
  }
  return null;
}

function findByText(roots, text, tagFilter) {
  const want = text.trim().toLowerCase();
  for (const root of roots) {
    const candidates = root.querySelectorAll(tagFilter || "*");
    for (const el of candidates) {
      // Skip elements with children that have their own text — we want the
      // leaf with the exact label.
      if (el.children.length > 0 && el.textContent.trim().toLowerCase() !== want) continue;
      if (el.textContent.trim().toLowerCase() === want) return el;
    }
  }
  return null;
}

function dispatchClick(el) {
  const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
  try { el.dispatchEvent(new PointerEvent("pointerdown", opts)); } catch (_) {}
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  try { el.dispatchEvent(new PointerEvent("pointerup", opts)); } catch (_) {}
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
}

// Call React's onClick handler directly via the inject-script bridge.
// Use when dispatchClick doesn't trigger Slack's React handler (e.g. for
// elements where React attaches onClick to a <div>, not a native control).
function reactClick(el) {
  const marker = "omarchy-" + Math.random().toString(36).slice(2);
  el.setAttribute("data-omarchy-target", marker);
  document.dispatchEvent(
    new CustomEvent("omarchy:react-click", { detail: { marker } })
  );
  setTimeout(() => el.removeAttribute("data-omarchy-target"), 200);
}

function pressKey(opts) {
  const targets = [document, document.body, document.documentElement, window];
  for (const t of targets) {
    try { t.dispatchEvent(new KeyboardEvent("keydown", { ...opts, bubbles: true, cancelable: true })); } catch (_) {}
  }
  for (const t of targets) {
    try { t.dispatchEvent(new KeyboardEvent("keyup", { ...opts, bubbles: true, cancelable: true })); } catch (_) {}
  }
}

function installHideStyle() {
  if (document.getElementById(AUTOMATION_HIDE_ID)) return;
  const s = document.createElement("style");
  s.id = AUTOMATION_HIDE_ID;
  // visibility only — pointer-events:none would block synthetic clicks reaching buttons.
  s.textContent = `
    [role="dialog"],
    [class*="ReactModal__Overlay"],
    [class*="c-modal"],
    [class*="modal_overlay"],
    [class*="dialog_overlay"] {
      visibility: hidden !important;
    }
  `;
  (document.head || document.documentElement).appendChild(s);
}

function removeHideStyle() {
  const s = document.getElementById(AUTOMATION_HIDE_ID);
  if (s) s.remove();
}

function findPrefsDialog() {
  return (
    document.querySelector('[role="dialog"][aria-label="Preferences"]') ||
    document.querySelector('.p-prefs_dialog, [class*="p-prefs_dialog"]')
  );
}

function logDialogDetails(prefix) {
  const dialogs = document.querySelectorAll('[role="dialog"]');
  console.warn(prefix, "dialogs on page:", dialogs.length);
  dialogs.forEach((d, i) => {
    console.warn(
      `  [${i}]`,
      "aria-label=", JSON.stringify(d.getAttribute("aria-label")),
      "class=", (d.className || "").toString().slice(0, 100),
      "text=", JSON.stringify((d.innerText || "").slice(0, 150))
    );
  });
  const iframes = document.querySelectorAll("iframe");
  if (iframes.length) console.warn("[omarchy] iframes on page:", iframes.length);
}

async function ensureHomeTabActive() {
  // The workspace-actions menu only contains "Preferences" when the Home tab
  // is active — on DMs/Activity/Files/Later the menu has a different item
  // set and Preferences is absent. Always click Home before opening; if
  // we're already there the click is a cheap no-op. (Slack's "active tab"
  // marker varies, so we don't try to short-circuit on aria-selected.)
  const homeTab =
    document.querySelector('[data-qa="tab_rail_home_button"]') ||
    document.querySelector('button[aria-label="Home"][role="tab"]') ||
    document.querySelector('[class*="tab_rail"] button[aria-label="Home"]') ||
    document.querySelector('[class*="tab_rail"] [aria-label="Home"]') ||
    document.querySelector('[aria-label="Home"][class*="tab"]');
  if (!homeTab) {
    console.warn("[omarchy] Home tab button not found; menu may lack Preferences");
    return;
  }
  console.log("[omarchy] activating Home tab for menu access");
  dispatchClick(homeTab);
  try { homeTab.click(); } catch (_) {}
  // Wait for the sidebar to mount the workspace-actions button (it only
  // exists when Home is active — its appearance is our signal Home is up).
  await waitFor(
    () =>
      document.querySelector('[data-qa="workspace_actions_button"]') ||
      document.querySelector('[data-qa*="workspace_actions"]'),
    2000
  );
  await sleep(150);
}

async function openPreferencesDialog() {
  // Try keyboard once (cheap), then go straight to the menu path. Synthetic
  // Ctrl+, doesn't seem to land in Brave on Linux, so don't burn 15s retrying.
  console.log("[omarchy] opening preferences (Ctrl+,)");
  pressKey({ key: ",", code: "Comma", keyCode: 188, which: 188, ctrlKey: true });
  const kbModal = await waitFor(() => findPrefsDialog(), 1200);
  if (kbModal) {
    console.log("[omarchy] preferences opened via keyboard");
    return kbModal;
  }

  // The menu path requires the Home tab to be active.
  await ensureHomeTabActive();

  console.log("[omarchy] using workspace-actions menu");
  // Exact selector confirmed via DOM inspection: the "Pay Ready Actions"
  // button at the top of the channel sidebar.
  const wsBtn = await waitFor(
    () =>
      document.querySelector('[data-qa="workspace_actions_button"]') ||
      document.querySelector('[data-qa*="workspace_actions"]') ||
      document.querySelector('button[aria-label$=" Actions"]'),
    3000
  );

  if (!wsBtn) {
    console.warn("[omarchy] workspace-name menu button not found");
    return null;
  }
  console.log("[omarchy] clicking workspace-name button:", wsBtn.outerHTML.slice(0, 120));
  dispatchClick(wsBtn);

  // Wait for Slack's menu container to mount — it has data-qa="menu_items".
  const menu = await waitFor(
    () =>
      document.querySelector('[role="menu"][data-qa="menu_items"]') ||
      document.querySelector('.c-menu__items'),
    2500
  );
  if (!menu) {
    console.warn("[omarchy] workspace actions menu did not open");
    return null;
  }

  // Find the "Preferences" menu item inside that menu.
  const prefsItem = await waitFor(() => {
    const items = menu.querySelectorAll(
      '[role="menuitem"], button, [data-qa="menu_item_button"]'
    );
    for (const el of items) {
      if ((el.innerText || el.textContent || "").trim() === "Preferences") {
        return el;
      }
    }
    return null;
  }, 2000);

  if (!prefsItem) {
    console.warn("[omarchy] 'Preferences' menu item not found; closing menu");
    pressKey({ key: "Escape", code: "Escape", keyCode: 27, which: 27 });
    return null;
  }

  console.log("[omarchy] activating Preferences menu item:", prefsItem.outerHTML.slice(0, 140));

  // Slack's current build ignores a synthetic dispatchClick on these menu
  // items — only a native .click() (and sometimes Enter) actually opens the
  // dialog. So lead with click()/Enter and keep dispatchClick as a last
  // resort. Retry the whole activation a few times, re-finding the item fresh
  // each round: the menu occasionally re-renders and leaves us holding a
  // stale node, which showed up as an intermittent "could not open" failure.
  const findPrefsItem = () => {
    const items = menu.querySelectorAll(
      '[role="menuitem"], button, [data-qa="menu_item_button"]'
    );
    for (const el of items) {
      if ((el.innerText || el.textContent || "").trim() === "Preferences") return el;
    }
    return null;
  };

  let modal = null;
  for (let attempt = 0; attempt < 3 && !modal; attempt++) {
    const item = findPrefsItem() || prefsItem;
    if (!item || !item.isConnected) {
      console.log("[omarchy] Preferences menu item went stale before it opened prefs");
      break;
    }

    item.focus();
    try { item.click(); } catch (_) {}
    modal = await waitFor(() => findPrefsDialog(), 1200);
    if (modal) break;

    console.log("[omarchy] native click() didn't open prefs; trying Enter key");
    item.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    item.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    modal = await waitFor(() => findPrefsDialog(), 1200);
    if (modal) break;

    console.log("[omarchy] Enter didn't open prefs; trying dispatchClick");
    dispatchClick(item);
    modal = await waitFor(() => findPrefsDialog(), 1200);
  }

  console.log("[omarchy] preferences dialog opened via menu:", !!modal);
  if (!modal) {
    pressKey({ key: "Escape", code: "Escape", keyCode: 27, which: 27 });
  }
  return modal;
}

function isRendered(el) {
  // Note: we deliberately don't check visibility:hidden because our own
  // hide-style sets that on dialogs during automation.
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  if (getComputedStyle(el).display === "none") return false;
  return true;
}

function findElementByExactText(text) {
  // Search the entire document — Slack often portals modal content outside
  // [role="dialog"], so scoped queries miss everything.
  const lower = text.toLowerCase();
  const all = document.querySelectorAll(
    'button, a, [role="tab"], [role="menuitem"], [role="option"], [role="radio"], [role="button"], li, label, span, div'
  );
  let best = null;
  let bestScore = 0;
  for (const el of all) {
    const t = (el.innerText || el.textContent || "").trim();
    if (!t) continue;
    if (t.length > 60) continue;
    const tl = t.toLowerCase();
    if (tl !== lower && !tl.endsWith(lower)) continue;
    if (!isRendered(el)) continue;
    const score = tl === lower ? 100 : 70;
    if (score > bestScore) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

function findAppearanceTab() {
  const tabs = document.querySelectorAll(
    '.p-prefs_dialog__menu [role="tab"], [data-qa="tabs_full_width_class"] [role="tab"], [aria-label="Preferences"] [role="tab"]'
  );
  for (const t of tabs) {
    if ((t.innerText || t.textContent || "").trim() === "Appearance") return t;
  }
  return null;
}

async function clickAppearanceTab(_modal) {
  const tab = await waitFor(findAppearanceTab, 5000);
  if (!tab) {
    logDialogDetails("[omarchy] Appearance tab not found.");
    return false;
  }
  console.log("[omarchy] clicking Appearance tab");
  dispatchClick(tab);

  // Verify the tab actually activated — its class should include
  // c-tabs__tab--active when selected.
  const activated = await waitFor(() => {
    const t = findAppearanceTab();
    return t && /tab--active/.test((t.className || "").toString());
  }, 600);

  if (!activated) {
    console.log("[omarchy] dispatchClick didn't activate Appearance; using React handler");
    reactClick(tab);
    await sleep(200);
  }
  return true;
}

function findColorModeRadio(target) {
  // Anchor on the color-mode radio group by `name="color-mode"` and the
  // value ("light"/"dark"). This is precise: the Appearance pane now renders
  // ~50 theme-preset swatches that share the same hashed `themeRadio__...`
  // class on their <input>s, so matching on class alone is ambiguous.
  // Return the wrapper DIV (carries the `boxContainerSelected` marker class).
  const value = target.toLowerCase();
  const input =
    document.querySelector(
      `input[type="radio"][name="color-mode"][value="${value}"]`
    ) ||
    document.querySelector(`input[type="radio"][aria-label="${target}" i]`);
  if (input) {
    return input.closest('[class*="boxContainer"]') || input.parentElement;
  }

  // Fallback for older Slack builds: text-match the wrapper.
  const inputs = document.querySelectorAll('input[type="radio"][class*="themeRadio"]');
  for (const inp of inputs) {
    const wrapper = inp.closest('[class*="boxContainer"]');
    if (!wrapper) continue;
    if ((wrapper.innerText || wrapper.textContent || "").trim() === target) {
      return wrapper;
    }
  }
  return null;
}

function isRadioSelected(wrapperEl) {
  // Source of truth: the wrapper's `boxContainerSelected` modifier class —
  // that's what Slack toggles to mark the active color mode. The <input>'s
  // .checked property is NOT reliably set on these controlled radios (the
  // selected one carries no `checked` attribute), so fall back to it only
  // as a secondary signal.
  if (!wrapperEl) return false;
  if (/boxContainerSelected/.test(wrapperEl.className || "")) return true;
  const input = wrapperEl.querySelector('input[type="radio"]');
  return !!(input && input.checked);
}

async function clickColorModeButton(_modal, target) {
  // Wait for BOTH radios to be present — guards against checking state
  // before Slack has hydrated the Appearance pane.
  await waitFor(
    () => findColorModeRadio("Light") && findColorModeRadio("Dark"),
    3000
  );

  const btn = findColorModeRadio(target);
  if (!btn) {
    console.warn(`[omarchy] ${target} radio not found`);
    return false;
  }

  if (isRadioSelected(btn)) {
    console.log(`[omarchy] ${target} already selected`);
    return true;
  }

  const input = btn.querySelector('input[type="radio"]');

  // The toggle is two-phase: the FIRST interaction only focuses/primes the
  // control, and the SECOND one actually flips it — so whichever click method
  // ran first always logged "didn't take" while the second landed it,
  // regardless of method. Prime the control explicitly (focus + a native
  // input.click) so the primary dispatchClick below can land on the first try.
  if (input) {
    try { input.focus(); } catch (_) {}
    try { input.click(); } catch (_) {}
    if (await waitFor(() => isRadioSelected(findColorModeRadio(target)), 300)) return true;
  }

  // Primary: a synthetic pointer/mouse/click sequence on the wrapper. Slack's
  // current build responds to THIS but no longer toggles on a native
  // input.click() alone (that used to be the reliable path).
  console.log(`[omarchy] clicking ${target} radio (dispatchClick)`);
  dispatchClick(btn);
  if (await waitFor(() => isRadioSelected(findColorModeRadio(target)), 800)) return true;

  // Fallback: another native click on the actual <input>, in case the prime +
  // dispatchClick sequence above didn't land this time.
  if (input) {
    console.log(`[omarchy] dispatchClick didn't take; retrying native input.click for ${target}`);
    try { input.click(); } catch (_) {}
    if (await waitFor(() => isRadioSelected(findColorModeRadio(target)), 800)) return true;
  }

  console.log(`[omarchy] native click didn't take; using React handler for ${target}`);
  reactClick(input || btn);

  const reverified = await waitFor(
    () => isRadioSelected(findColorModeRadio(target)),
    1500
  );
  if (reverified) {
    console.log(`[omarchy] React click confirmed ${target}`);
    return true;
  }

  console.warn(`[omarchy] ${target} click did NOT register — Slack UI unchanged`);
  return false;
}

function findCloseButton() {
  return (
    document.querySelector(
      '[aria-label="Preferences"] [aria-label*="Close" i]'
    ) ||
    document.querySelector(
      '[aria-label="Preferences"] [data-qa*="close"]'
    ) ||
    document.querySelector(
      '.p-prefs_dialog [aria-label*="Close" i], .p-prefs_dialog [data-qa*="close"]'
    ) ||
    document.querySelector(
      '.p-prefs_dialog button[aria-label="Close"], .p-prefs_dialog__close'
    )
  );
}

async function closeDialog() {
  // Hidden tab: every wait below is throttled to roughly one poll a minute, so
  // verifying here would block the caller (and hold the automating lock) for
  // minutes. Fire both closers synchronously and leave it at that — the
  // deferred retry re-runs this whole flow once the tab is visible.
  if (document.hidden) {
    pressKey({ key: "Escape", code: "Escape", keyCode: 27, which: 27 });
    const btn = findCloseButton();
    if (btn) {
      dispatchClick(btn);
      try { btn.click(); } catch (_) {}
    }
    return;
  }

  // Try Escape first
  pressKey({ key: "Escape", code: "Escape", keyCode: 27, which: 27 });
  if (await waitFor(() => !findPrefsDialog(), 800)) return;

  // Escape didn't close it (likely a trusted-event issue) — click the X.
  const closeBtn = findCloseButton();

  if (closeBtn) {
    console.log("[omarchy] closing prefs via close button");
    dispatchClick(closeBtn);
    try { closeBtn.click(); } catch (_) {}
    if (await waitFor(() => !findPrefsDialog(), 1500)) return;
  }

  console.warn("[omarchy] could not close preferences dialog");
}

async function ensureSlackColorMode(targetIsDark) {
  const target = targetIsDark ? "Dark" : "Light";

  // A hidden tab can't be driven — its timers are throttled to ~1 wake/minute,
  // which strands the Preferences modal mid-flow. Park it for the next time
  // the tab is visible. The CSS repaint has already happened by now and needs
  // no timers, so the theme itself is correct either way; only Slack's own
  // Light/Dark preference waits.
  if (document.hidden) {
    console.log("[omarchy] tab hidden; deferring", target, "flip until visible");
    armVisibilityRetry(targetIsDark);
    return;
  }

  // Synchronous claim — set BEFORE any await so concurrent callers see it.
  if (automating) return;
  automating = true;
  // A live claim supersedes any deferred retry of a stale target.
  pendingColorMode = null;
  if (visibilityRetryTimer != null) {
    clearTimeout(visibilityRetryTimer);
    visibilityRetryTimer = null;
  }
  if (visibilityRetryArmed) {
    document.removeEventListener("visibilitychange", onVisibilityRetry);
    visibilityRetryArmed = false;
  }
  let succeeded = false;
  let hiddenDuringRun = document.hidden;
  const noteHidden = () => {
    if (document.hidden) hiddenDuringRun = true;
  };
  document.addEventListener("visibilitychange", noteHidden);

  // No cache check. The "Dark already selected" / "Light already selected"
  // detection inside clickColorModeButton (via `boxContainerSelected` class)
  // is the real source of truth — checking it requires opening prefs, but
  // that's cheap and avoids us getting out of sync with Slack.

  try {

    // Wait for Slack to be FULLY interactive — message composer + a real channel
    // row in the sidebar. Cheap placeholders like `[class*="p-ia"]` appear long
    // before Slack's keyboard handlers are attached.
    const ready = await waitFor(
      () => {
        const hasComposer = !!document.querySelector(
          '[data-qa="message_input"], [class*="p-message_input"], [data-message-input], [contenteditable="true"][data-qa*="message"]'
        );
        const hasChannelRow = !!document.querySelector(
          '[class*="channel_sidebar__channel"], [class*="p-channel_sidebar__channel"], [data-qa="channel_sidebar_name_"]'
        );
        return hasComposer || hasChannelRow;
      },
      60000
    );
    if (!ready) {
      console.warn("[omarchy] Slack UI never finished loading; skipping");
      return;
    }
    // One more beat after Slack mounts — handlers attach slightly after DOM appears.
    await sleep(500);

    console.log("[omarchy] flipping Slack to", target);
    installHideStyle();
    try {
      const modal = await openPreferencesDialog();
      if (!modal) {
        console.warn("[omarchy] could not open Preferences dialog");
        // "Not found" is not the same as "not open": the dialog may have
        // opened just after our deadline, or under markup findPrefsDialog()
        // no longer matches. This was the one early return that walked away
        // without closing, so it stranded the modal on screen.
        await closeDialog();
        return;
      }
      if (!(await clickAppearanceTab(modal))) {
        console.warn("[omarchy] could not click Appearance tab");
        await closeDialog();
        return;
      }
      await sleep(200);
      const clicked = await clickColorModeButton(modal, target);
      await sleep(150);
      // Always close the dialog — even if we couldn't verify the click, the
      // change may have applied, and leaving Preferences open is the most
      // visible failure mode.
      await closeDialog();
      if (!clicked) {
        console.warn("[omarchy] could not click", target, "button");
        return;
      }

      lastAppliedMode = target;
      chrome.storage.local.set({ lastSlackMode: target });
      succeeded = true;
      console.log("[omarchy] Slack color mode now", target);
    } finally {
      setTimeout(removeHideStyle, 300);
    }
  } finally {
    document.removeEventListener("visibilitychange", noteHidden);

    // Safety net: never leave Preferences on screen. Every failure path above
    // tries to close, but a tab that goes hidden MID-flight throttles the
    // remaining awaits, so the flow can unwind with the modal still up — the
    // most visible failure mode there is. (closeDialog() has its own hidden-tab
    // fast path, so this can't stall the unlock scheduled below.)
    if (findPrefsDialog()) {
      console.warn("[omarchy] preferences still open on exit; forcing close");
      await closeDialog();
    }

    // Re-arm if we failed because the tab went hidden at any point — not just
    // if it's still hidden now. A hide-then-return before this line used to
    // skip the retry and leave Slack on the wrong Color Mode. Don't overwrite
    // a newer target parked while we were in flight; fall back to the engine's
    // current polarity so we don't revive a stale in-flight argument.
    if (!succeeded && hiddenDuringRun) {
      const retry =
        pendingColorMode !== null
          ? pendingColorMode
          : (OmarchyTheme.current && OmarchyTheme.current.surfaces
              ? OmarchyTheme.current.surfaces.isDark
              : targetIsDark);
      armVisibilityRetry(retry);
    }

    // Close any leftover workspace menu — Slack's "close menu on item click"
    // handler doesn't fire reliably for synthetic clicks, so it stays open
    // after we click "Preferences". Skip the timed loop while hidden: those
    // sleeps would hold the automating lock the deferred retry is waiting on.
    if (!document.hidden) {
      for (let i = 0; i < 4; i++) {
        const lingering = document.querySelector('[role="menu"][data-qa="menu_items"]');
        if (!lingering) break;
        pressKey({ key: "Escape", code: "Escape", keyCode: 27, which: 27 });
        await sleep(150);
      }
    }

    // Hold the lock for a beat after we finish so any in-flight theme
    // applies don't stack a fresh attempt.
    setTimeout(() => {
      automating = false;
    }, 500);
  }
}

// Register this pack with the generic engine. The engine calls apply() on every
// theme change and onColorMode() only when the theme crosses light↔dark.
OmarchyTheme.register({
  id: "slack",
  apply: applySlackTheme,
  onColorMode: (isDark) =>
    ensureSlackColorMode(isDark).catch((e) =>
      console.warn("[omarchy] color-mode automation failed:", e)
    ),
});
