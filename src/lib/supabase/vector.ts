/**
 * pgvector encoding for supabase-js.
 *
 * `supabase gen types` emits `vector` columns and RPC parameters as `string`,
 * because PostgREST serialises them as '[0.1,0.2,…]' on read.
 *
 * VERIFIED EMPIRICALLY against a local stack: PostgREST accepts BOTH a JSON
 * array and a JSON string for vector columns and for RPC arguments — both
 * round-trip correctly. So the widely-repeated "never JSON.stringify an
 * embedding" warning does not apply here; either encoding works.
 *
 * We follow the generated types (string) so no cast is needed at any call site,
 * and funnel every conversion through this one function so the decision is
 * documented in exactly one place.
 */
export function toVector(embedding: number[]): string {
  return JSON.stringify(embedding);
}

export function toVectorOrNull(embedding: number[] | null | undefined): string | null {
  return embedding ? toVector(embedding) : null;
}
