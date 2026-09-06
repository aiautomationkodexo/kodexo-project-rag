import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

// `next lint` was removed in Next 16 and `next build` no longer lints, so this
// is a plain ESLint flat config run via `npm run lint`.
//
// eslint-config-next ships native flat-config arrays in v16 — do NOT wrap these
// in FlatCompat, which throws "Converting circular structure to JSON".
const eslintConfig = [
  { ignores: [".next/**", "node_modules/**", "supabase/**", "next-env.d.ts"] },
  ...nextCoreWebVitals,
  ...nextTypeScript,
];

export default eslintConfig;
