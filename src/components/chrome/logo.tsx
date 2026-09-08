import Image from "next/image";

/**
 * The Kodexo Labs lockup, served from `public/` rather than hotlinked.
 *
 * WHY IT IS VENDORED. The source is kodexolabs.com/img/logo-light.webp. Loading
 * it remotely would need a `remotePatterns` entry, put a third-party request in
 * front of every authed page, and leave the shell's identity slot blank
 * whenever that host is slow. It is 1.6 KB; copying it costs nothing.
 *
 * WHY `-light` IS THE RIGHT FILE FOR A LIGHT UI. The name reads backwards: the
 * asset is two-tone BLACK wordmark plus the red mark, on transparency, so it is
 * the lockup FOR light grounds. Verified by decoding it — the ink clusters at
 * rgb(0,0,0) and rgb(224,64,64), not at white. On the rail's n50 that lands as
 * intended; the day a dark theme arrives this component is the one seam that
 * has to grow a second source.
 *
 * WHY THE RED IS NOT A RATION BREACH. DESIGN.md counts the wordmark's red as
 * chrome — one global instance, not charged to any view. This replaces the
 * middot with the real mark and inherits the same exemption; it does not add a
 * second red run to a page.
 *
 * INTRINSIC SIZE IS 374x60. Both numbers are passed so Next reserves the box
 * and the row never reflows once the image decodes; `height` then drives the
 * rendered size and width follows from the ratio.
 *
 * `unoptimized` IS DELIBERATE, AND IT IS A CORRECTNESS FIX RATHER THAN A TUNING
 * ONE. The optimizer picks its output format from the request's Accept header:
 * with `image/webp` it emits webp, but with `image/*` or no Accept at all it
 * falls back to JPEG — which has no alpha channel, so the transparent ground
 * flattens to opaque black and the lockup renders as a black box on the n50
 * rail. Current browsers all advertise webp and would be fine; anything that
 * does not (a proxy, a preview fetcher, an older client) would not. Verified by
 * requesting /_next/image with each header. Re-encoding a 1.6 KB two-tone mark
 * saves nothing worth that risk, so the original bytes are served as-is.
 */
export function Logo({
  height = 26,
  priority = false,
  className = "",
}: {
  height?: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/kodexo-logo.webp"
      alt="Kodexo Labs"
      width={374}
      height={60}
      priority={priority}
      unoptimized
      className={`w-auto ${className}`}
      style={{ height }}
    />
  );
}
