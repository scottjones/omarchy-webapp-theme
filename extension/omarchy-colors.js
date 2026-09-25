// Omarchy web-app theming — shared color library (app-agnostic).
//
// App-agnostic helpers for turning an omarchy theme's hex values into the
// surfaces an app pack paints with. Loaded first in the content-script list so
// every later script (omarchy-surfaces.js, omarchy-runtime.js, and each app
// pack) shares these in the content script's isolated-world global scope.

// Chromium (111+) keeps a computed color in the space it was authored in:
// getComputedStyle() on a StyleX/lch() app returns "lch(6.2 6.6 282)", not
// rgb(). Anything that is not hex or rgb() is normalized to sRGB by painting
// it into a 1×1 canvas and reading the pixel back — exact for lch/oklch/
// color()/color-mix(), ~10µs a call, and memoized because a page has a few
// hundred distinct color strings. `a` is the resolved alpha; the hex and rgb()
// paths do not report one.
const cssColorCache = new Map();
let cssColorCtx = null;
function cssColorToRgb(value) {
  let hit = cssColorCache.get(value);
  if (hit !== undefined) return hit;
  if (!cssColorCtx) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    cssColorCtx = c.getContext("2d", { willReadFrequently: true });
  }
  const ctx = cssColorCtx;
  // An unparseable value leaves fillStyle at the sentinel.
  ctx.fillStyle = "#010203";
  ctx.fillStyle = value;
  if (ctx.fillStyle === "#010203") {
    hit = null;
  } else {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    hit = { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
  }
  cssColorCache.set(value, hit);
  return hit;
}

function hexToRgb(hex) {
  if (typeof hex !== "string" || !hex) return null;
  // Accept rgb(r, g, b) too — shade() emits that form, and we sometimes
  // chain shade() output back through mix()/withAlpha().
  if (hex.startsWith("rgb")) {
    const m = hex.match(/\d+/g);
    if (m && m.length >= 3) {
      return { r: +m[0], g: +m[1], b: +m[2] };
    }
    return null;
  }
  if (!hex.startsWith("#")) return cssColorToRgb(hex.trim());
  const h = hex.slice(1);
  if (h.length < 6) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

// WCAG relative luminance needs each channel linearized (gamma-decoded) first;
// weighting the raw sRGB bytes misclassifies mid-tone backgrounds (#808080 reads
// 0.502 raw vs 0.216 linearized). Every shipped omarchy theme lands the same
// either way — a custom mid-tone background need not.
function channelLuminance(byte) {
  const channel = byte / 255;
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function relLuminance({ r, g, b }) {
  return (
    0.2126 * channelLuminance(r) +
    0.7152 * channelLuminance(g) +
    0.0722 * channelLuminance(b)
  );
}

function shade(hex, delta) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + delta * 255)));
  return `rgb(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
}

function withAlpha(hex, alpha) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  return `rgba(${c.r}, ${c.g}, ${c.b}, ${alpha})`;
}

// WCAG contrast ratio between two colors. Both are composited/opaque by the
// time they get here — pass the surface a translucent ink will actually sit on,
// not the ink's rgba() string.
function contrastRatio(colorA, colorB) {
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  if (!a || !b) return 1;
  const la = relLuminance(a);
  const lb = relLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// Pick the lowest alpha at which `ink` over EVERY surface in `surfaces` clears
// `target` contrast. Muted text is a fixed fraction of the foreground in most
// theming systems, but a fixed fraction ignores how much contrast the theme's fg
// had to begin with: at the old flat 0.65, 5 of the 22 shipped omarchy themes put
// muted text below the WCAG AA 4.5:1 floor (rose-pine was worst at 3.00:1), and
// GitHub spends --fgColor-muted on real copy — issue metadata, mega-menu
// descriptions — not just incidental labels.
//
// Contrast is monotonic in alpha (compositing walks the colour from the surface
// toward the ink, and luminance is monotonic in the channels), so a rising scan
// finds the minimum. Returns 1 when even the opaque foreground can't reach the
// target — on a low-headroom theme that means muted lands on fg and the
// muted/primary distinction flattens, which is the accepted cost of the target.
function alphaForContrast(ink, surfaces, target, floorAlpha) {
  const floor = floorAlpha == null ? 0.65 : floorAlpha;
  const list = (Array.isArray(surfaces) ? surfaces : [surfaces]).filter(Boolean);
  if (!list.length) return floor;
  for (let a = floor; a < 1; a += 0.01) {
    const ok = list.every((surface) => contrastRatio(mix(surface, ink, a), surface) >= target);
    if (ok) return Math.round(a * 100) / 100;
  }
  return 1;
}

// Pick the ink for text/icons that ride on a SATURATED FILL (an accent button,
// a badge, a selected chip). The conventional answer is the page background —
// dark ink on a light accent, light ink on a dark one — and on most palettes
// that's both legible and the most theme-coherent choice. But it is only a
// convention, not a guarantee: an accent that sits in the MIDDLE of the range
// contrasts poorly with the page AND with the foreground. Measured across the 22
// shipped themes, three land there — rose-pine (accent #56949f on page #faf4ed:
// 3.14:1), miasma (#78824b: 3.86:1) and catppuccin-latte (#1e66f5: 4.34:1) — all
// under the AA 4.5:1 floor for the button LABELS this ink is spent on.
//
// So try the theme's own colors first, in the caller's order of preference, and
// only escalate to plain white/black when neither reads. Escalating costs some
// theme coherence on those three palettes; not escalating costs legibility on
// the one control the user is most likely to click. Returns the best candidate
// available when nothing clears the target, so the caller always gets a color.
function inkOn(fill, candidates, target) {
  const want = target == null ? 4.5 : target;
  const list = (Array.isArray(candidates) ? candidates : [candidates]).filter(Boolean);
  for (const ink of list) {
    if (contrastRatio(ink, fill) >= want) return ink;
  }
  const all = list.concat(["#ffffff", "#000000"]);
  let best = all[0];
  let bestRatio = -1;
  for (const ink of all) {
    const r = contrastRatio(ink, fill);
    if (r > bestRatio) {
      bestRatio = r;
      best = ink;
    }
  }
  return best;
}

// Emit "r, g, b" — a bare channel list, NOT a color. Some design systems (see
// Slack's --sk_* tokens) hold their palette as triplets and composite at the
// point of use: `color: rgba(var(--sk_primary_foreground), .7)`. Feeding a real
// color into one of those produces `rgba(#a9b1d6, .7)`, which is invalid at
// computed-value time — the declaration is dropped and an inherited property
// like `color` silently unwinds to the UA default (white under color-scheme:
// dark, black under light) instead of failing visibly. Always verify how a token
// is consumed before overriding it; the format is part of the contract.
function toTriplet(color) {
  const c = hexToRgb(color);
  if (!c) return color;
  return `${c.r}, ${c.g}, ${c.b}`;
}

function mix(hexA, hexB, t) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  if (!a || !b) return hexA;
  const r = Math.round(a.r * (1 - t) + b.r * t);
  const g = Math.round(a.g * (1 - t) + b.g * t);
  const bl = Math.round(a.b * (1 - t) + b.b * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

// ===== semantic status colors =============================================
//
// success / danger / attention / done are NOT decorative. GitHub paints a
// pending check amber and a passing one green, so getting the hue wrong doesn't
// look slightly off — it MISREPORTS STATE. Two traps, both hit in practice:
//
//  1. A SLOT'S NAME DOES NOT PROMISE ITS HUE. osaka-jade ships
//     yellow = #459451 (a green, hue 129) and matte-black ships
//     green = #FFC107 (an amber) alongside yellow = #b91c1c (a red). 14 of the
//     28 themes on a stock machine have at least one such slot. Reading
//     `pal.yellow` for "attention" painted GitHub's in-progress spinner green —
//     visually identical to "all checks passed".
//  2. SOME PALETTES HAVE NO SUCH COLOR AT ALL. `white` and `vantablack` are
//     monochrome by design; `lumon` is blue end to end. There is nothing honest
//     to pick, and a faked status color is worse than an unthemed one — the
//     site's own default at least still means what the site says it means.
//
// Strategy: try the conventionally-named slots first (ANSI color1/2/3/5 and
// their bright twins included — that numbering is itself a convention), accept
// one only when its hue actually matches the role AND it stays perceptually
// clear of the roles already assigned, otherwise search the rest of the palette,
// otherwise fall back to the site's default.
//
// Hue classification uses HSL (cheap, and it's the space these palettes are
// authored in) while the "is this actually a color" and "are two roles
// distinguishable" tests use CIELab, which is perceptual. That split matters:
// a near-black like #12140e scores 0.18 HSL *saturation* but has almost no Lab
// chroma, and it slipped through an early saturation-only gate as a "green".

// CIELab, reusing the same gamma decode as relLuminance so this agrees with the
// WCAG math elsewhere in this file. D65 white point.
function labOf(color) {
  const c = hexToRgb(color);
  if (!c) return null;
  const x = (channelLuminance(c.r) * 0.4124 + channelLuminance(c.g) * 0.3576 +
             channelLuminance(c.b) * 0.1805) / 0.95047;
  const y = channelLuminance(c.r) * 0.2126 + channelLuminance(c.g) * 0.7152 +
            channelLuminance(c.b) * 0.0722;
  const z = (channelLuminance(c.r) * 0.0193 + channelLuminance(c.g) * 0.1192 +
             channelLuminance(c.b) * 0.9505) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

// Lab chroma — distance from the neutral axis. Unlike HSL saturation this does
// not inflate at extreme lightness, so it's the honest "is this a color" test.
function chromaOf(color) {
  const lab = labOf(color);
  return lab ? Math.sqrt(lab.a * lab.a + lab.b * lab.b) : 0;
}

// CIE76. Crude next to CIEDE2000, but we only need a "clearly different color"
// threshold, and it's a handful of lines instead of forty.
function deltaE(colorA, colorB) {
  const a = labOf(colorA);
  const b = labOf(colorB);
  if (!a || !b) return 0;
  return Math.sqrt((a.L - b.L) ** 2 + (a.a - b.a) ** 2 + (a.b - b.b) ** 2);
}

// HSL hue in degrees, or null when the color is achromatic (hue is undefined
// for greys — that's the signal monochrome themes give us).
function hueOf(color) {
  const c = hexToRgb(color);
  if (!c) return null;
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d === 0) return null;
  let h;
  if (mx === r) h = ((g - b) / d + 6) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return h * 60;
}

function hueDistance(hue, target) {
  if (hue == null) return Infinity;
  const d = Math.abs(hue - target) % 360;
  return Math.min(d, 360 - d);
}

// target: the hue a role should read as. tolerance: how far a candidate may sit
// from it — wider for green because terminal "greens" skew olive (gruvbox 70°,
// everforest 83°) and narrower for amber, which turns into orange or lime fast.
// preferred: slots to try in order before searching, most conventional first.
const STATUS_ROLES = {
  danger:    { target: 2,   tolerance: 50, preferred: ["red", "bright_red", "color1", "color9"] },
  success:   { target: 105, tolerance: 55, preferred: ["green", "bright_green", "color2", "color10"] },
  attention: { target: 45,  tolerance: 40, preferred: ["yellow", "bright_yellow", "orange", "color3", "color11"] },
  done:      { target: 300, tolerance: 50, preferred: ["magenta", "bright_magenta", "color5", "color13"] },
};

// Slots that describe the UI's structure rather than its palette. Never status
// candidates — `background` being coincidentally green-ish must not make it the
// success color.
const STRUCTURAL_SLOTS = new Set([
  "background", "dark_background", "darker_background", "lighter_background",
  "foreground", "dark_foreground", "light_foreground", "bright_foreground",
  "selection", "selection_background", "selection_foreground", "muted",
  "accent", "cursor", "cursor_text", "border", "mode",
  "active_border_color", "inactive_border_color",
  "active_tab_background", "active_tab_foreground",
  "inactive_tab_background", "inactive_tab_foreground",
]);

// A named slot only has to be recognisably its own hue — the author calling it
// "red" is evidence of intent, so miasma's muted #685742 still earns danger. An
// unnamed candidate we picked ourselves has no such backing, so it must be
// unambiguously colorful and not near-black/near-white.
// Named slots used to need only chroma >= 8 on the theory that the author calling
// something "red" was evidence enough. It isn't: miasma's red is #685742, chroma
// 15.2 — a brown — and ethereal's green is #92a593, chroma 12.4, a desaturated
// sage. Both passed, and a brown "failed check" doesn't read as failed. A status
// colour has to be recognisably its own hue before intent counts for anything,
// so the floor is now high enough to demand an actual colour while still well
// under the level a deliberately muted palette can reach.
const NAMED_MIN_CHROMA = 20;
const SEARCHED_MIN_CHROMA = 25;
const SEARCHED_L_RANGE = [25, 90];
// Below this two roles read as "the same color" at a glance.
const ROLE_MIN_DELTA_E = 18;
// ...and dE alone isn't enough for THESE roles. Two oranges can sit 20 dE apart
// and still both read "orange": retro-82 resolved danger at hue 14 and attention
// at hue 22, eight degrees apart, so "failing" and "in progress" were the same
// colour to a glance even though the perceptual distance passed. Roles must also
// be separated around the hue wheel.
const ROLE_MIN_HUE_SEPARATION = 35;

function statusCandidateOk(color, role, taken, named) {
  const spec = STATUS_ROLES[role];
  if (!spec || !color) return false;
  if (hueDistance(hueOf(color), spec.target) > spec.tolerance) return false;
  if (chromaOf(color) < (named ? NAMED_MIN_CHROMA : SEARCHED_MIN_CHROMA)) return false;
  if (!named) {
    const L = labOf(color).L;
    if (L < SEARCHED_L_RANGE[0] || L > SEARCHED_L_RANGE[1]) return false;
  }
  const hue = hueOf(color);
  return taken.every((other) => {
    if (deltaE(color, other) < ROLE_MIN_DELTA_E) return false;
    // An achromatic neighbour can't be confused by hue, and hueDistance() would
    // read its null hue as 0 and measure from red.
    const otherHue = hueOf(other);
    if (otherHue == null) return true;
    return hueDistance(hue, otherHue) >= ROLE_MIN_HUE_SEPARATION;
  });
}

// Resolve one role. `taken` is the colors already assigned to other roles.
// Returns the site's `fallback` when the palette has nothing honest to offer.
function statusColor(palette, role, taken, fallback) {
  const spec = STATUS_ROLES[role];
  const pal = palette || {};
  const chosen = taken || [];
  if (!spec) return fallback;

  for (const slot of spec.preferred) {
    if (pal[slot] && statusCandidateOk(pal[slot], role, chosen, true)) return pal[slot];
  }

  let best = null;
  let bestScore = Infinity;
  for (const slot of Object.keys(pal)) {
    if (STRUCTURAL_SLOTS.has(slot)) continue;
    const color = pal[slot];
    if (!statusCandidateOk(color, role, chosen, false)) continue;
    // closest hue wins; chroma breaks ties toward the more vivid candidate
    const score = hueDistance(hueOf(color), spec.target) - chromaOf(color) / 10;
    if (score < bestScore) {
      best = color;
      bestScore = score;
    }
  }
  return best || fallback;
}

// The palette's most perceptually DISTANT real colour from `avoid`, for markers
// that must stand out rather than mean something. Status roles are the wrong tool
// there: they refuse to invent a hue that isn't present, which is right for
// "pending" or "failed" but leaves a marker with nothing at all on a palette that
// simply has no warm colour. spacex-terrafab is the case in point — every slot
// sits between hue 184 and 276, its "red" is #9c8ba9 (a violet) and its "yellow"
// is #c4f6ff (a cyan) — so attention and danger both correctly decline, yet
// #bcfbff still sits 50 dE from that theme's accent and reads unmistakably.
//
// Requires real chroma, and enough contrast against `surface` to be visible as a
// hairline. Returns null when nothing clears the distinctness floor, so callers
// keep their own last resort.
function highlightColor(palette, avoid, surface, minChroma) {
  const pal = palette || {};
  const floor = minChroma == null ? 18 : minChroma;
  let best = null;
  let bestScore = -Infinity;
  for (const slot of Object.keys(pal)) {
    if (STRUCTURAL_SLOTS.has(slot)) continue;
    const color = pal[slot];
    if (!color || chromaOf(color) < floor) continue;
    if (surface && contrastRatio(color, surface) < 3) continue;
    const d = deltaE(color, avoid);
    if (d > bestScore) {
      bestScore = d;
      best = color;
    }
  }
  return bestScore >= ROLE_MIN_DELTA_E ? best : null;
}

// Resolve all four together. Order is deliberate — danger and success are the
// two a user is most likely to act on, so they get first claim on the palette
// and later roles must stay clear of them rather than the other way round.
// `defaults` supplies the site's own shipped colors, keyed by role.
// Do two roles read as the same colour? Both tests matter: dE catches "these are
// the same shade", hue separation catches "these are both orange".
function statusRolesClash(a, b) {
  if (!a || !b) return false;
  if (deltaE(a, b) < ROLE_MIN_DELTA_E) return true;
  const ha = hueOf(a);
  const hb = hueOf(b);
  if (ha == null || hb == null) return false;
  return hueDistance(ha, hb) < ROLE_MIN_HUE_SEPARATION;
}

function statusPalette(palette, defaults) {
  const defs = defaults || {};
  const roles = ["danger", "success", "attention", "done"];
  const out = {};
  const taken = [];
  for (const role of roles) {
    const color = statusColor(palette, role, taken, defs[role]);
    if (color) taken.push(color);
    out[role] = color;
  }

  // Repair pass. statusColor() returns its fallback WITHOUT the distinctness
  // test — the palette had nothing to offer, so there was nothing to test — and
  // that can seat the site's amber right next to a themed red: miasma ended up
  // with danger #b36d43 (hue 23) beside the fallback attention #d29922 (hue 41),
  // 18 degrees apart, which is the same "can't tell failing from pending" problem
  // the hue rule exists to prevent.
  //
  // The site's own four are mutually distinct by construction (Primer's are all
  // >= 37 degrees apart), so whenever a fallback clashes with a themed sibling,
  // drop that sibling to ITS default too and re-check. Each step moves one role
  // to a default and never back, so this terminates.
  let changed = true;
  while (changed) {
    changed = false;
    for (const a of roles) {
      for (const b of roles) {
        if (a === b || !statusRolesClash(out[a], out[b])) continue;
        const aDefault = out[a] === defs[a];
        const bDefault = out[b] === defs[b];
        if (aDefault && !bDefault && defs[b]) {
          out[b] = defs[b];
          changed = true;
        } else if (bDefault && !aDefault && defs[a]) {
          out[a] = defs[a];
          changed = true;
        }
      }
    }
  }
  return out;
}
