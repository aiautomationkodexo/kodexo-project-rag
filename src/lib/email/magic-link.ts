import "server-only";

import { escapeHtml } from "./html";
import { sendMail } from "./send";

/**
 * Must match Supabase's OTP expiry (Authentication → Providers → Email, and
 * `[auth.email] otp_expiry` in config.toml, both 900s). The token's real
 * lifetime is GoTrue's; this string only describes it, so if the dashboard
 * value is ever changed this and src/app/login/page.tsx must change with it.
 */
const EXPIRY_TEXT = "15 minutes";

export async function sendMagicLinkEmail(params: {
  to: string;
  name: string | null;
  url: string;
}): Promise<boolean> {
  const greeting = params.name ? `Hi ${params.name},` : "Hi,";

  return sendMail({
    to: params.to,
    subject: "Sign in to the Portfolio Knowledge Base",
    text:
      `${greeting}\n\n` +
      `Use this link to sign in:\n\n${params.url}\n\n` +
      `It expires in ${EXPIRY_TEXT} and can be used once.\n` +
      `If you didn't request it, you can ignore this email.\n`,
    html:
      `<p>${escapeHtml(greeting)}</p>` +
      `<p><a href="${params.url}">Sign in to the Portfolio Knowledge Base</a></p>` +
      `<p>It expires in ${EXPIRY_TEXT} and can be used once. ` +
      `If you didn't request it, you can ignore this email.</p>`,
  });
}
