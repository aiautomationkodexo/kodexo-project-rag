import "server-only";

import nodemailer from "nodemailer";

import { serverEnv } from "@/lib/env";

/**
 * Hard caps on every phase of the SMTP conversation.
 *
 * This runs inside the pipeline's 800s budget, and an SMTP handshake has more
 * ways to hang than an HTTPS request — a stalled connection must not eat the
 * time a 50 MB extraction may still need. nodemailer defaults to no socket
 * timeout at all, so these are not redundant.
 */
const CONNECTION_TIMEOUT_MS = 5_000;
const GREETING_TIMEOUT_MS = 5_000;
const SOCKET_TIMEOUT_MS = 10_000;

export type Mail = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

/**
 * TOTAL: returns false, never throws, for any reason — unset config, bad
 * credentials, refused connection, timeout, DNS. Every caller is on a path
 * whose work has already committed and where mail is a courtesy.
 *
 * The transport is built PER CALL rather than at module scope, for the reason
 * documented in lib/supabase/admin.ts: a warm Vercel instance is shared across
 * invocations and a module-scope connection outlives the request that opened
 * it.
 */
export async function sendMail(mail: Mail): Promise<boolean> {
  const smtp = serverEnv.smtp;

  if (!smtp) {
    // Loud rather than silent. An unconfigured environment is a legitimate
    // state, but it must never look like a successful delivery.
    console.warn(
      `[email] SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASSWORD/EMAIL_FROM) ` +
        `— not sending "${mail.subject}"`,
    );
    return false;
  }

  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    // 465 is implicit TLS; 587 and 25 are STARTTLS, which nodemailer upgrades
    // to automatically when `secure` is false.
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
  });

  try {
    await transport.sendMail({
      from: smtp.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
    });
    return true;
  } catch (error) {
    console.error(`[email] send failed for "${mail.subject}":`, error);
    return false;
  } finally {
    // Don't hold the socket open past the invocation.
    transport.close();
  }
}
