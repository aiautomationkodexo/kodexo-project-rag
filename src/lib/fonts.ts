import { Manrope, Anton, JetBrains_Mono, Outfit, Unbounded } from "next/font/google";

/**
 * Visual Identity v1.0 §Type specifies five roles. Four are on Google Fonts;
 * the heading face is commercial and is not.
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

// ── STATEMENT ──────────────────────────────────────────────────────────────
// SOT `--font-display-statement`: Unbounded 900, H1 only.
//
// This is the identity's loudest typographic signal and the reason a Kodexo
// page does not look like stock Tailwind. It is deliberately scoped to H1 —
// Unbounded is a wide, high-personality display face and setting h2/h3 in it
// would make every heading shout at the same volume, which is exactly the
// flatness this redesign set out to fix.
//
// SOT names 'Parafina Black' as the first choice with Unbounded following;
// Parafina is commercial and absent, and Unbounded is the shipped fallback in
// the token file itself, so it is what we load.
export const statement = Unbounded({
  subsets: ["latin"],
  variable: "--font-statement-src",
  display: "swap",
});

// ── HEADING ────────────────────────────────────────────────────────────────
// SOT `--font-heading`: 'Bernabeu', 'Outfit', system-ui.
//
// Bernabeu is commercial, ships as six static OTFs, and is not in this repo.
// Outfit is the SOT's OWN named fallback — which is the important change from
// the previous substitute (Archivo, which appears nowhere in the identity and
// was chosen here by eye). The stand-in is now specified rather than improvised.
//
// Outfit is a geometric sans with a true 900, so the 900-section-heading /
// 700-subhead relationship DESIGN.md relies on survives the substitution.
//
// TO SWAP IN THE REAL FONT: replace this one export. Nothing else changes.
// next/font/local throws at build time on a missing file, so the swap seam has
// to be a module boundary, not a path that resolves later.
//
//   import localFont from "next/font/local";
//   export const heading = localFont({
//     variable: "--font-heading-src",
//     display: "swap",
//     // Keeps the SOT's named fallback as the permanent degradation path.
//     fallback: ["Outfit", "ui-sans-serif", "system-ui", "sans-serif"],
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
// METRIC CAVEAT: both substitutes are wider than Bernabeu at 900 with -0.02em
// tracking. Never build a layout that depends on display text fitting on one
// line (DESIGN.md's CoverArt title uses `nowrap` — do not port that). Every
// heading must wrap gracefully so swapping in real Bernabeu changes nothing
// but the glyphs.
export const heading = Outfit({
  subsets: ["latin"],
  variable: "--font-heading-src",
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
  statement.variable,
  heading.variable,
  body.variable,
  hyper.variable,
  mono.variable,
].join(" ");
