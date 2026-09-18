#!/bin/bash
# Wire up the Omarchy Web App Theme extension for the current user: the omarchy
# theme-set hook, the browser --load-extension flag, and — outside a packaged
# install — the native-messaging host manifests.
#
# Usage:
#   ./install.sh [--no-flags] [--uninstall]
#
#   --no-flags   Skip editing ~/.config/<browser>-flags.conf. Use this if you'd
#                rather load the extension by hand via Developer mode.
#   --uninstall  Reverse everything this script installs.
#
# No extension ID argument: extension/manifest.json pins the ID with a "key",
# so it's the same on every machine and is baked into the host manifest.
#
# This same script ships twice: as ./install.sh in a git checkout, and as
# /usr/bin/omarchy-webapp-theme-setup in the AUR package. It figures out which it
# is from its own path, so there's only ever one copy of this logic to maintain.

set -euo pipefail

SELF="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/$(basename -- "${BASH_SOURCE[0]}")"
SHARE_DIR="/usr/share/omarchy-webapp-theme"

REPO="$(dirname -- "$SELF")"

# Decide by what's actually next to us, not by our own filename — a checkout can
# be cloned to any directory, and the package may be installed at the same time.
if [[ -f "$REPO/native-host/omarchy-webapp-theme-host" ]]; then
  # Git checkout: everything lives beside this script, and we own the per-user
  # native-messaging manifests too since there's no package to place them.
  PACKAGED=0
  HOST_SCRIPT="$REPO/native-host/omarchy-webapp-theme-host"
  HOST_TEMPLATE="$REPO/native-host/com.omarchy.webapp_theme.json.template"
  HOOK_SCRIPT="$REPO/hooks/omarchy-webapp-theme"
  EXT_DIR="$REPO/extension"
elif [[ -d $SHARE_DIR ]]; then
  # Packaged: pacman owns the host binary and the system-wide manifests under
  # /etc, so all that's left for us is the per-user wiring.
  PACKAGED=1
  HOST_SCRIPT="/usr/bin/omarchy-webapp-theme-host"
  HOST_TEMPLATE=""
  HOOK_SCRIPT="$SHARE_DIR/hooks/omarchy-webapp-theme"
  EXT_DIR="$SHARE_DIR/extension"
else
  echo "Error: can't find the extension files (looked beside $SELF and in $SHARE_DIR)." >&2
  exit 1
fi

HOST_NAME="com.omarchy.webapp_theme"

# The pinned extension ID, read back from whichever manifest this mode has so
# it stays single-sourced rather than duplicated here. Purely cosmetic — it's
# only used in the closing message — so a missing file must not be fatal.
ext_id() {
  local src
  for src in "${HOST_TEMPLATE:-}" \
    "/etc/chromium/native-messaging-hosts/$HOST_NAME.json"; do
    [[ -n $src && -f $src ]] || continue
    grep -o 'chrome-extension://[a-p]*' "$src" | head -1 | sed 's|chrome-extension://||'
    return 0
  done
  printf 'the pinned ID'
}
MARKER="omarchy-webapp-theme"

HOOKS_DIR="$HOME/.config/omarchy/hooks"

DO_FLAGS=1
DO_UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
  --no-flags) DO_FLAGS=0 ;;
  --uninstall) DO_UNINSTALL=1 ;;
  -h | --help)
    sed -n '2,14p' "$0"
    exit 0
    ;;
  *)
    echo "Unknown argument: $1" >&2
    exit 2
    ;;
  esac
  shift
done

# Every Chromium-family profile root that supports native messaging. Mirrors
# omarchy's own bin/omarchy-install-chromium-copy-url — we write to all of them
# unconditionally so the host is registered whichever browser you end up using.
BROWSER_PROFILE_DIRS=(
  "$HOME/.config/chromium"
  "$HOME/.config/google-chrome"
  "$HOME/.config/google-chrome-beta"
  "$HOME/.config/google-chrome-unstable"
  "$HOME/.config/BraveSoftware/Brave-Browser"
  "$HOME/.config/BraveSoftware/Brave-Browser-Beta"
  "$HOME/.config/BraveSoftware/Brave-Browser-Nightly"
  # Brave Origin is a separate browser, not a Brave channel: its own package
  # (brave-origin-bin), binary, flags conf and profile root. Verified against the
  # stable binary, which stores under BraveSoftware/Brave-Origin and reads
  # system-wide hosts from /etc/chromium and /etc/opt/chrome; beta/nightly follow
  # the same -Beta/-Nightly suffix convention as Brave-Browser.
  "$HOME/.config/BraveSoftware/Brave-Origin"
  "$HOME/.config/BraveSoftware/Brave-Origin-Beta"
  "$HOME/.config/BraveSoftware/Brave-Origin-Nightly"
  "$HOME/.config/microsoft-edge"
  "$HOME/.config/microsoft-edge-dev"
  # Helium stores its profile under the Chromium product name net.imput.helium,
  # not the browser name; the flags conf keeps the browser name (see below).
  "$HOME/.config/net.imput.helium"
)

# Arch's browser launchers read ~/.config/<name>-flags.conf. The conf name doesn't
# map 1:1 onto profile dirs, so this is a separate list — the same one omarchy's
# yt-dlp migration uses (plus Brave Origin's beta/nightly channels), paired with
# the binaries that prove the browser exists.
#
# Detect by BINARY, not profile dir: omarchy's own chromium-extension installers
# mkdir every Chromium profile dir on every machine, so "the dir exists" would be
# true for browsers you've never installed and we'd litter confs for all of them.
#
# Helium (helium-browser-bin) is a Chromium fork wrapped by /usr/bin/helium-browser,
# whose wrapper reads ~/.config/helium-browser-flags.conf and execs the fork —
# so the conf name here is helium-browser while its profile dir is net.imput.helium.
FLAGS_TARGETS=(
  "chromium:chromium"
  "chrome:google-chrome-stable google-chrome"
  "google-chrome:google-chrome-stable google-chrome"
  "brave:brave brave-browser"
  "brave-beta:brave-beta brave-browser-beta"
  "brave-nightly:brave-nightly brave-browser-nightly"
  "brave-origin:brave-origin"
  "brave-origin-beta:brave-origin-beta"
  "brave-origin-nightly:brave-origin-nightly"
  "microsoft-edge-stable:microsoft-edge-stable microsoft-edge"
  "helium-browser:helium-browser"
)

browser_installed() {
  local bin
  for bin in $1; do
    command -v "$bin" >/dev/null 2>&1 && return 0
  done
  return 1
}

# ------------------------------------------------------------ host manifests --

install_host_manifests() {
  local manifest dir count=0
  manifest=$(sed "s|__HOST_PATH__|$HOST_SCRIPT|g" "$HOST_TEMPLATE")
  for dir in "${BROWSER_PROFILE_DIRS[@]}"; do
    mkdir -p "$dir/NativeMessagingHosts"
    printf '%s\n' "$manifest" >"$dir/NativeMessagingHosts/$HOST_NAME.json"
    count=$((count + 1))
  done
  echo "  native-messaging host registered in $count profile dir(s)"
}

remove_host_manifests() {
  local dir count=0
  for dir in "${BROWSER_PROFILE_DIRS[@]}"; do
    if [[ -f "$dir/NativeMessagingHosts/$HOST_NAME.json" ]]; then
      rm -f "$dir/NativeMessagingHosts/$HOST_NAME.json"
      count=$((count + 1))
    fi
  done
  echo "  removed $count host manifest(s)"
}

# --------------------------------------------------------------------- hook --

# Omarchy runs every script in hooks/theme-set.d/ on a theme switch (the .d form
# has been there since Omarchy 3.8, so it's always present on the Omarchy 4+ this
# targets). We symlink our hook in; it SIGUSR1s every running host so the
# extension repaints the instant you switch themes.
install_hook() {
  mkdir -p "$HOOKS_DIR/theme-set.d"
  ln -sfn "$HOOK_SCRIPT" "$HOOKS_DIR/theme-set.d/$MARKER"
  echo "  hook symlinked into hooks/theme-set.d/"
}

remove_hook() {
  local link="$HOOKS_DIR/theme-set.d/$MARKER"
  [[ -L $link || -f $link ]] || return 0

  # Only remove the hook WE installed. A git checkout and the package both use
  # this same marker name but point it at their own tree, so a clone's
  # --uninstall must not delete the symlink a packaged install owns (and vice
  # versa). Getting this wrong is silent and total: the host has no polling
  # fallback, so with no hook there is no SIGUSR1 and themes simply stop
  # updating, while --load-extension and the host manifest still look fine.
  if [[ -L $link ]]; then
    local have want
    have=$(readlink -f "$link" 2>/dev/null || true)
    want=$(readlink -f "$HOOK_SCRIPT" 2>/dev/null || true)
    if [[ -n $have && -n $want && $have != "$want" ]]; then
      echo "  kept hooks/theme-set.d/$MARKER (owned by another install: $have)"
      return 0
    fi
  fi

  rm -f "$link"
  echo "  removed hooks/theme-set.d/$MARKER"
}

# ------------------------------------------------------- legacy (pre-rename) --

# Through 0.2.x this project was "omarchy-slack-theme". Clean up any wiring the
# old name left behind so an upgrade doesn't strand a dead host manifest, hook
# symlink, or --load-extension entry pointing at the old package path.
OLD_HOST_NAME="com.omarchy.slack_theme"
OLD_MARKER="omarchy-slack-theme"
OLD_SHARE_EXT="/usr/share/omarchy-slack-theme/extension"

remove_legacy() {
  local dir entry name file cleaned=0
  for dir in "${BROWSER_PROFILE_DIRS[@]}"; do
    [[ -f "$dir/NativeMessagingHosts/$OLD_HOST_NAME.json" ]] || continue
    rm -f "$dir/NativeMessagingHosts/$OLD_HOST_NAME.json"
    cleaned=1
  done
  if [[ -L "$HOOKS_DIR/theme-set.d/$OLD_MARKER" || -f "$HOOKS_DIR/theme-set.d/$OLD_MARKER" ]]; then
    rm -f "$HOOKS_DIR/theme-set.d/$OLD_MARKER"
    cleaned=1
  fi
  for entry in "${FLAGS_TARGETS[@]}"; do
    name="${entry%%:*}"
    file="$HOME/.config/$name-flags.conf"
    [[ -f $file ]] || continue
    grep -qF "$OLD_SHARE_EXT" "$file" || continue
    sed -i --follow-symlinks \
      -e "s|^\(--load-extension=.*\),$OLD_SHARE_EXT\$|\1|" \
      -e "s|^\(--load-extension=.*\),$OLD_SHARE_EXT,|\1,|" \
      -e "s|^--load-extension=$OLD_SHARE_EXT,|--load-extension=|" \
      -e "\|^--load-extension=$OLD_SHARE_EXT\$|d" \
      "$file"
    [[ -s $file ]] || rm -f "$file"
    cleaned=1
  done
  ((cleaned)) && echo "  cleaned up old omarchy-slack-theme wiring"
  return 0
}

# ---------------------------------------------------------------- browser flags --

install_flags() {
  local entry name bins file count=0
  for entry in "${FLAGS_TARGETS[@]}"; do
    name="${entry%%:*}"
    bins="${entry#*:}"
    file="$HOME/.config/$name-flags.conf"
    # Only touch a conf that already exists, or one whose browser is installed.
    [[ -f $file ]] || browser_installed "$bins" || continue
    [[ -f $file ]] || : >"$file"

    grep -qF "$EXT_DIR" "$file" && continue
    if grep -q '^--load-extension=' "$file"; then
      sed -i --follow-symlinks "s|^--load-extension=\(.*\)\$|--load-extension=\1,$EXT_DIR|" "$file"
    else
      printf '%s\n' "--load-extension=$EXT_DIR" >>"$file"
    fi
    count=$((count + 1))
  done
  echo "  --load-extension added to $count browser flags file(s)"
}

remove_flags() {
  local entry name file count=0
  for entry in "${FLAGS_TARGETS[@]}"; do
    name="${entry%%:*}"
    file="$HOME/.config/$name-flags.conf"
    [[ -f $file ]] || continue
    grep -qF "$EXT_DIR" "$file" || continue
    # Drop our path from the comma list; delete the line if we were the only one.
    sed -i --follow-symlinks \
      -e "s|^\(--load-extension=.*\),$EXT_DIR\$|\1|" \
      -e "s|^\(--load-extension=.*\),$EXT_DIR,|\1,|" \
      -e "s|^--load-extension=$EXT_DIR,|--load-extension=|" \
      -e "\|^--load-extension=$EXT_DIR\$|d" \
      "$file"
    # If we created this conf and our line was all it held, don't leave an empty
    # file behind.
    [[ -s $file ]] || rm -f "$file"
    count=$((count + 1))
  done
  echo "  --load-extension removed from $count browser flags file(s)"
}

# --------------------------------------------------------------------- main --

if ((DO_UNINSTALL)); then
  echo "Uninstalling Omarchy Web App Theme..."
  ((PACKAGED)) || remove_host_manifests
  remove_hook
  remove_flags
  remove_legacy
  echo
  if ((PACKAGED)); then
    echo "Done. Fully restart your browser, then 'pacman -R omarchy-webapp-theme'"
    echo "to remove the package itself."
  else
    echo "Done. Fully restart your browser to finish."
  fi
  exit 0
fi

# Omarchy 4+ gate. The host reads ~/.local/state/omarchy/current/, which exists
# only on Omarchy 4+ (pre-4 kept it under ~/.config/omarchy/current). Without it
# the host would push a generic fallback instead of your theme and never update,
# so refuse up front rather than silently mis-theme.
if [[ ! -e "$HOME/.local/state/omarchy/current/theme" ]]; then
  echo "Error: this needs Omarchy 4+ — didn't find ~/.local/state/omarchy/current." >&2
  echo "Update Omarchy ('omarchy-update'), then re-run this setup." >&2
  echo "On older Omarchy, install the pre-0.3 release instead." >&2
  exit 1
fi

for f in "$HOST_SCRIPT" "$HOOK_SCRIPT" ${HOST_TEMPLATE:+"$HOST_TEMPLATE"}; do
  [[ -f $f ]] || {
    echo "Error: missing $f" >&2
    exit 1
  }
done
((PACKAGED)) || chmod +x "$HOST_SCRIPT" "$HOOK_SCRIPT" 2>/dev/null || true

echo "Setting up Omarchy Web App Theme..."
remove_legacy
if ((PACKAGED)); then
  echo "  native-messaging host: /etc/chromium/native-messaging-hosts (owned by the package)"
else
  install_host_manifests
fi
install_hook
if ((DO_FLAGS)); then
  install_flags
else
  echo "  skipped browser flags (--no-flags)"
fi

echo
echo "Done. Now:"
echo "  1. Fully quit your browser (pkill brave), don't just close the window."
if ((DO_FLAGS)); then
  echo "  2. If you previously loaded extension/ by hand via Developer mode,"
  echo "     remove it first — it and the --load-extension copy share the pinned"
  echo "     ID $(ext_id)"
  echo "     and only one of them will load."
else
  echo "  2. Load $EXT_DIR unpacked via Developer mode."
fi
echo "  3. Open app.slack.com (or web.whatsapp.com, github.com) and switch omarchy themes."
