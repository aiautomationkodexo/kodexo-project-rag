import { Manrope, Anton, JetBrains_Mono, Archivo } from "next/font/google";

/**
 * DESIGN.md §2.1 specifies four families. Three are on Google Fonts; the
 * display face is not.
 *
 * The CSS variables all end in `-src`. globals.css maps them into the Tailwind
 * `--font-*` namespace via `@theme inline` — without the suffix you'd get a
 * self-referential `--font-display: var(--font-display)`.
 *
 * `weight` is deliberately omitted for the three variable fonts. Passing a
 * weight array makes next/font download static instances (six separate files
 * for Archivo) and loses the intermediate weights. Anton is static 400-only and
 * must declare its weight.
 */

// ── DISPLAY ────────────────────────────────────────────────────────────────
// DESIGN.md specifies Bernabeu: commercial, six static OTFs, not in this repo.
// Archivo is the stand-in — variable 100–900 with a real Black (non-negotiable,
// since the role is 900 section headings and 700 subheads), and a tight
// grotesque with closed apertures that reads "engineered" per design principle 5.
//
// TO SWAP IN THE REAL FONT: replace this one export. Nothing else changes.
// next/font/local throws at build time on a missing file, so the swap seam has
// to be a module boundary, not a path that resolves later.
//
//   import localFont from "next/font/local";
//   export const display = localFont({
//     variable: "--font-display-src",
//     display: "swap",
//     // Keeps the substitute as the permanent degradation path.
//     fallback: ["Archivo", "ui-sans-serif", "system-ui", "sans-serif"],
//     src: [
//       { path: "./fonts/Bernabeu-Regular.otf",   weight: "400", style: "normal" },
//       { path: "./fonts/Bernabeu-Medium.otf",    weight: "500", style: "normal" },
//       { path: "./fonts/Bernabeu-SemiBold.otf",  weight: "600", style: "normal" },
//       { path: "./fonts/Bernabeu-Bold.otf",      weight: "700", style: "normal" },
//       { path: "./fonts/Bernabeu-ExtraBold.otf", weight: "800", style: "normal" },
//       { path: "./fonts/Bernabeu-Black.otf",     weight: "900", style: "normal" },
//     ],
//   });
//
// Font files belong in `src/lib/fonts/`, never `public/` — next/font
// fingerprints and immutable-caches them, and a licensed commercial OTF should
// not be a directly-listable static asset.
//
// METRIC CAVEAT: the substitute is wider than a display grotesque at 900 with
// -0.02em tracking. Never build a layout that depends on display text fitting
// on one line (DESIGN.md's CoverArt title uses `nowrap` — do not port that).
// Every heading must wrap gracefully so swapping in real Bernabeu changes
// nothing but the glyphs.
export const display = Archivo({
  subsets: ["latin"],
  variable: "--font-display-src",
  display: "swap",
});

// ── BODY ───────────────────────────────────────────────────────────────────
// All body text (400), emphasis (700), labels (700 uppercase).
export const body = Manrope({
  subsets: ["latin"],
  variable: "--font-body-src",
  display: "swap",
});

// ── HYPER ──────────────────────────────────────────────────────────────────
// Cover titles ONLY (DESIGN.md §2.4). In this app that is exactly one surface:
// /login, which is the app's cover. If that ever changes, delete this family
// rather than leaving an unused font loaded.
export const hyper = Anton({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-hyper-src",
  display: "swap",
});

// ── MONO ───────────────────────────────────────────────────────────────────
// "Code. Rare by design." In-app its only use is source filenames on search
// results, which are code-adjacent.
export const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-src",
  display: "swap",
});

/** Convenience for the root layout. */
export const fontVariables = [
  display.variable,
  body.variable,
  hyper.variable,
  mono.variable,
].join(" ");
