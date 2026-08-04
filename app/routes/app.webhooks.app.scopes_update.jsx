import { authenticate } from "../shopify.server";
import { updateShopScope } from "../models/shop.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const currentScopes = payload.current;

  await updateShopScope(shop, currentScopes);

  return new Response();
};
