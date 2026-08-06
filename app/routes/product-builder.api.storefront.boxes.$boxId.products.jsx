import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { resolveSelectableProducts } from "../models/boxes.server";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

export const loader = async ({ request, params }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  const url = new URL(request.url);
  const shop = url.searchParams.get("shop");

  if (!shop) {
    return Response.json({ error: "shop parameter required" }, { status: 400, headers: CORS_HEADERS });
  }

  const boxId = parseInt(params.boxId);
  if (isNaN(boxId)) {
    return Response.json({ error: "Invalid box ID" }, { status: 400, headers: CORS_HEADERS });
  }

  // Verify box belongs to shop and is active, and pull whichever page config
  // (Simple or Multiple box) actually drives its product selection.
  const box = await db.comboBox.findFirst({
    where: { id: boxId, shop, isActive: true, deletedAt: null },
    select: {
      id: true,
      simpleBoxPage: {
        select: { productConfiguration: true, selectedProductIdsJson: true, selectedCollectionIdsJson: true, hideOutOfStockProducts: true },
      },
      multipleBoxPage: {
        select: { productConfiguration: true, selectedProductIdsJson: true, selectedCollectionIdsJson: true, hideOutOfStockProducts: true },
      },
    },
  });

  if (!box) {
    return Response.json({ error: "Box not found" }, { status: 404, headers: CORS_HEADERS });
  }

  const pageConfig = box.simpleBoxPage || box.multipleBoxPage;
  if (!pageConfig) {
    return Response.json([], { headers: CORS_HEADERS });
  }

  function parseJsonArray(value) {
    if (!value) return [];
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  try {
    const { admin } = await unauthenticated.admin(shop);
    const publicProducts = await resolveSelectableProducts(admin, {
      productConfiguration: pageConfig.productConfiguration,
      selectedProductIds: parseJsonArray(pageConfig.selectedProductIdsJson),
      selectedCollectionIds: parseJsonArray(pageConfig.selectedCollectionIdsJson),
      hideOutOfStockProducts: !!pageConfig.hideOutOfStockProducts,
    });

    return Response.json(publicProducts, { headers: CORS_HEADERS });
  } catch (e) {
    console.error("[product-builder.api.storefront.boxes.$boxId.products] error:", e);
    return Response.json({ error: "Failed to load products" }, { status: 500, headers: CORS_HEADERS });
  }
};
