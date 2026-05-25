import nodemailer from "nodemailer";
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dir = dirname(fileURLToPath(import.meta.url));

// Try multiple candidate paths so it works locally, on Vercel, and in any build output layout
const LOGO_CANDIDATES = [
  resolve(__dir, "../../public/images/mix-bundle.jpg"), // local dev
  resolve(process.cwd(), "public/images/mix-bundle.jpg"), // Vercel / build root
];
const LOGO_PATH = LOGO_CANDIDATES.find(existsSync) ?? LOGO_CANDIDATES[0];

let _logoBuffer = null;
function getLogoBuffer() {
  if (_logoBuffer) return _logoBuffer;
  try {
    _logoBuffer = readFileSync(LOGO_PATH);
  } catch {
    console.warn("[mailer] logo file not found at", LOGO_PATH);
    _logoBuffer = null;
  }
  return _logoBuffer;
}

// CID used in HTML as <img src="cid:mixbox-logo">
export const LOGO_CID = "mixbox-logo";

let _transporter = null;

function getEnv(name) {
  return String(process.env[name] || "").trim();
}

function isSecure() {
  const val = getEnv("SMTP_SECURE").toLowerCase();
  const port = parseInt(getEnv("SMTP_PORT") || "587");
  return val === "true" || val === "ssl" || val === "yes" || val === "1" || port === 465;
}

function getSmtpPass(host) {
  const pass = getEnv("SMTP_PASS");
  const normalizedHost = String(host || "").toLowerCase();

  // Google displays app passwords in groups with spaces. SMTP auth expects the
  // actual 16-character token, so normalize common copy/paste formatting.
  if (normalizedHost.includes("gmail.com") || normalizedHost.includes("googlemail.com")) {
    return pass.replace(/\s+/g, "");
  }

  return pass;
}

function isPlaceholder(value) {
  return /^(your-|example|test|changeme|password$|app-password$)/i.test(String(value || "").trim());
}

function getSmtpConfig() {
  const host = getEnv("SMTP_HOST");
  const user = getEnv("SMTP_USER");
  const pass = getSmtpPass(host);
  const secure = isSecure();
  const port = parseInt(getEnv("SMTP_PORT") || (secure ? "465" : "587"));

  return { host, user, pass, port, secure };
}

function getTransporter() {
  if (_transporter) return _transporter;

  const { host, user, pass, port, secure } = getSmtpConfig();

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
    tls: { rejectUnauthorized: false },
  });

  return _transporter;
}

/**
 * Send an email with the MixBox logo embedded as an inline CID attachment.
 * @param {string} to
 * @param {string} subject
 * @param {string} html  - Use <img src="cid:mixbox-logo"> for the logo
 */
export async function sendMail(to, subject, html) {
  if (!to) {
    console.warn("[mailer] no recipient address — skipping email:", subject);
    return;
  }
  const smtp = getSmtpConfig();
  if (!smtp.host || !smtp.user || !smtp.pass) {
    console.warn("[mailer] SMTP not configured — skipping email to", to);
    return;
  }

  if (isPlaceholder(smtp.user) || isPlaceholder(smtp.pass)) {
    console.error("[mailer] SMTP credentials still look like placeholder values; update SMTP_USER and SMTP_PASS.");
    return;
  }

  const fromAddress = smtp.user;
  const from = `"${process.env.MAIL_FROM_NAME || "MixBox – Box & Bundle Builder"}" <${fromAddress}>`;
  const replyTo =
    process.env.MAIL_FROM_ADDRESS && process.env.MAIL_FROM_ADDRESS !== fromAddress
      ? process.env.MAIL_FROM_ADDRESS
      : undefined;

  // Inline logo attachment — embedded so it shows regardless of email client image blocking
  const attachments = [];
  const logoBuffer = getLogoBuffer();
  if (logoBuffer) {
    attachments.push({
      filename: "logo.jpg",
      content: logoBuffer,
      cid: LOGO_CID,
      contentType: "image/jpeg",
      contentDisposition: "inline",
    });
  }

  try {
    const info = await getTransporter().sendMail({ from, to, subject, html, replyTo, attachments });
    console.info("[mailer] sent", { to, subject, messageId: info.messageId, response: info.response, accepted: info.accepted, rejected: info.rejected });
  } catch (err) {
    const message = String(err?.message || "");
    const isAuthError = err?.code === "EAUTH" || /535|Username and Password not accepted|BadCredentials/i.test(message);
    const gmailHint = /gmail\.com|googlemail\.com/i.test(smtp.host)
      ? " For Gmail, enable 2-Step Verification and use a 16-character App Password as SMTP_PASS, not the normal Google account password."
      : "";
    console.error("[mailer] failed", {
      to,
      subject,
      error: message,
      code: err?.code,
      hint: isAuthError
        ? `SMTP authentication failed. Check SMTP_HOST, SMTP_USER, and SMTP_PASS in the deployed environment.${gmailHint}`
        : undefined,
    });
    _transporter = null;
  }
}
