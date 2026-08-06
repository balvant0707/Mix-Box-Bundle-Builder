import { authenticate } from "../shopify.server";
import { BoxCodeValidationError, getBox, updateBox, deleteBox } from "../models/boxes.server";
import { saveSimpleBox, saveMultipleBox } from "../models/shop.server";

function buildPagePayload(body) {
  const pageConfig = body?.pageConfig || {};
  const source = { ...pageConfig, ...body };
  const payload = {
    title: source.title || source.boxName || source.displayTitle || null,
    description: source.description || source.boxSubtitle || null,
    status: source.status || "active",
  };

  if (source.productItems != null) payload.productItems = Number.parseInt(String(source.productItems), 10) || 3;
  if (source.buttonLabel != null) payload.buttonLabel = String(source.buttonLabel);
  if (source.bundlePriceType != null) payload.bundlePriceType = source.bundlePriceType;
  if (source.discountMode != null) payload.discountMode = source.discountMode;
  if (source.discountType != null) payload.discountType = source.discountType;
  if (source.discountValue != null) payload.discountValue = source.discountValue;
  if (source.buyQuantity != null) payload.buyQuantity = Number.parseInt(String(source.buyQuantity), 10) || 1;
  if (source.getQuantity != null) payload.getQuantity = Number.parseInt(String(source.getQuantity), 10) || 1;
  if (Array.isArray(source.quantityPacks)) payload.quantityPacks = source.quantityPacks;
  if (Array.isArray(source.selectedProductIds)) payload.selectedProductIds = source.selectedProductIds;
  if (Array.isArray(source.selectedCollectionIds)) payload.selectedCollectionIds = source.selectedCollectionIds;
  if (source.productConfiguration != null) payload.productConfiguration = source.productConfiguration;
  if (source.selectedGiftProductIds != null) payload.selectedGiftProductIds = source.selectedGiftProductIds;
  return payload;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const box = await getBox(parseInt(params.id), session.shop);
  if (!box) return Response.json({ error: "Not found" }, { status: 404 });
  return Response.json(box);
};

export const action = async ({ request, params }) => {
  const { session, admin } = await authenticate.admin(request);
  const id = parseInt(params.id);

  if (request.method === "DELETE") {
    await deleteBox(id, session.shop, admin);
    return Response.json({ success: true });
  }

  if (request.method === "PUT" || request.method === "PATCH") {
    const body = await request.json();
    try {
      const updated = await updateBox(id, session.shop, body, admin);
      const pagePayload = buildPagePayload(body);
      const persistedBox = Array.isArray(body?.pageConfig?.quantityPacks) && body.pageConfig.quantityPacks.length > 0
        ? await saveMultipleBox(session.shop, {
            id,
            comboBoxData: {
              boxName: updated?.boxName || body?.boxName,
              displayTitle: updated?.displayTitle || body?.displayTitle,
              isActive: updated?.isActive ?? true,
            },
            multipleBoxPageData: pagePayload,
          })
        : await saveSimpleBox(session.shop, {
            id,
            comboBoxData: {
              boxName: updated?.boxName || body?.boxName,
              displayTitle: updated?.displayTitle || body?.displayTitle,
              isActive: updated?.isActive ?? true,
            },
            simpleBoxPageData: pagePayload,
          });
      return Response.json(persistedBox || updated);
    } catch (error) {
      if (error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError") {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};
