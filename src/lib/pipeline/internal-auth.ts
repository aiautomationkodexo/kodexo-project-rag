import "server-only";

import { timingSafeEqual } from "node:crypto";

/**
 * Guards /api/process and /api/finalize.
 *
 * Fails CLOSED when INTERNAL_SECRET is unset — an unset secret must not mean
 * "no check". Comparison is constant-time over equal-length buffers.
 */
export function isInternalRequest(request: Request): boolean {
  const provided = request.headers.get("x-internal");
  const expected = process.env.INTERNAL_SECRET;

  if (!expected || !provided) return false;

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}
