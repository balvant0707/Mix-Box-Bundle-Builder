import db from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = () => new Response(null, { status: 405 });

export const action = async ({ request }) => {
  const { topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const result = await db.$transaction(async (tx) => {
      const bundleOrdersDeleted = await tx.bundleOrder.deleteMany({
        where: { shop },
      });
      const comboBoxesDeleted = await tx.comboBox.deleteMany({ where: { shop } });
      const sessionsDeleted = await tx.session.deleteMany({ where: { shop } });
      const shopsDeleted = await tx.shop.deleteMany({ where: { shop } });

      return {
        bundleOrdersDeleted: bundleOrdersDeleted.count,
        comboBoxesDeleted: comboBoxesDeleted.count,
        sessionsDeleted: sessionsDeleted.count,
        shopsDeleted: shopsDeleted.count,
      };
    });

    console.info("[privacy.shop_redact] deleted records", { shop, ...result });
  } catch (error) {
    console.error("[privacy.shop_redact] post-auth processing failed", { shop, error });
  }

  return new Response(null, { status: 200 });
};
