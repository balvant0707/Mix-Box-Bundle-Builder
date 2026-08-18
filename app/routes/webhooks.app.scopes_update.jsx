import { authenticate } from "../shopify.server";
import { updateShopScope } from "../models/shop.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    const currentScopes = payload?.current;
    await updateShopScope(shop, currentScopes);
  } catch (error) {
    console.error("[webhooks.app.scopes_update] post-auth processing failed", { shop, error });
  }

  return new Response(null, { status: 200 });
};
