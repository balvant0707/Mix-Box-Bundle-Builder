import { authenticate } from "../shopify.server";
import { resolveGiftForBox } from "../models/boxes.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const { session, admin } = await authenticate.public.appProxy(request);
  const shop = session?.shop;
  if (!shop || !admin) {
    return Response.json(
      { hasGift: false, error: "shop parameter required" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const boxId = parseInt(params.boxId, 10);
  if (isNaN(boxId)) {
    return Response.json(
      { hasGift: false, error: "Invalid box ID" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const url = new URL(request.url);
  const packKey = url.searchParams.get("packKey") || null;

  try {
    const gift = await resolveGiftForBox(shop, boxId, admin, packKey);
    return Response.json(gift, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("[api.storefront.boxes.$boxId.gift] error:", e);
    return Response.json(
      { hasGift: false, error: "Failed to resolve gift product" },
      { status: 500, headers: CORS_HEADERS },
    );
  }
};
