import { randomUUID } from "node:crypto";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { markShopUninstalled } from "../models/shop.server";
import { sendMail } from "../utils/mailer.server";
import { uninstalledEmailHtml } from "../emails/app-uninstalled";
import { ownerUninstallNotifyHtml } from "../emails/owner-notify";

export const loader = () => new Response(null, { status: 405 });

export const action = async ({ request }) => {
  const { shop, topic } = await authenticate.webhook(request);
  const appBaseUrl = String(process.env.SHOPIFY_APP_URL || new URL(request.url).origin || "")
    .trim()
    .replace(/\/+$/, "");

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const shopRecord = await db.shop.findUnique({
      where: { shop },
      select: { email: true, contactEmail: true, ownerName: true, name: true, plan: true, country: true },
    });

    console.log("[uninstall] shopRecord:", {
      found: !!shopRecord,
      email: shopRecord?.email,
      contactEmail: shopRecord?.contactEmail,
      ownerEmail: process.env.APP_OWNER_EMAIL,
    });

    let feedbackToken = null;
    try {
      const feedbackTokenValue = randomUUID().replace(/-/g, "");
      await db.$executeRawUnsafe(
        `INSERT INTO uninstallfeedback (shop, ownerName, email, contactEmail, feedbackText, feedbackToken, feedbackSubmittedAt, uninstalledAt) VALUES (?, ?, ?, ?, ?, ?, NULL, NOW(3))`,
        shop,
        shopRecord?.ownerName || null,
        shopRecord?.email || null,
        shopRecord?.contactEmail || null,
        null,
        feedbackTokenValue,
      );
      feedbackToken = feedbackTokenValue;
    } catch (error) {
      console.error("[uninstall webhook] failed to create uninstallfeedback row", error);
    }

    await markShopUninstalled(shop);
    await db.session.deleteMany({ where: { shop } });

    const emailData = {
      ownerName: shopRecord?.ownerName,
      shopName: shopRecord?.name,
      shopDomain: shop,
      email: shopRecord?.contactEmail || shopRecord?.email,
      plan: shopRecord?.plan,
      country: shopRecord?.country,
      feedbackUrl: feedbackToken
        ? `${appBaseUrl}/feedback/uninstall?token=${encodeURIComponent(feedbackToken)}`
        : null,
    };

    const mailJobs = [];
    if (emailData.email) {
      mailJobs.push(
        sendMail(
          emailData.email,
          "We're sad to see you go - MixBox Box & Bundle Builder",
          uninstalledEmailHtml(emailData),
        ).catch((err) => console.error("[uninstall webhook] merchant email failed", err)),
      );
    }

    if (process.env.APP_OWNER_EMAIL) {
      mailJobs.push(
        sendMail(
          process.env.APP_OWNER_EMAIL,
          `App Uninstalled: ${shopRecord?.name || shop}`,
          ownerUninstallNotifyHtml(emailData),
        ).catch((err) => console.error("[uninstall webhook] owner notification failed", err)),
      );
    }

    Promise.all(mailJobs).catch((err) => {
      console.error("[uninstall webhook] email dispatch failed", err);
    });
  } catch (error) {
    console.error("[uninstall webhook] post-auth processing failed", { shop, error });
  }

  return new Response(null, { status: 200 });
};
