import db from "../db.server";
import { authenticate } from "../shopify.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { session } = await authenticate.public.appProxy(request);
  const shop = session?.shop;

  if (!shop) {
    return new Response("Unauthorized", { status: 401, headers: CORS_HEADERS });
  }

  const boxId = parseInt(params.boxId);
  if (!boxId) {
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }

  const box = await db.comboBox.findFirst({
    where: { id: boxId, shop, deletedAt: null },
    select: { bannerImageData: true, bannerImageMimeType: true },
  });

  if (!box?.bannerImageData || !box?.bannerImageMimeType) {
    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }

  return new Response(box.bannerImageData, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": box.bannerImageMimeType,
      "Cache-Control": "public, max-age=86400",
    },
  });
};
