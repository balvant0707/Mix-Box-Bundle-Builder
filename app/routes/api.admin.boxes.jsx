import { authenticate } from "../shopify.server";
import { BoxCodeValidationError, listBoxes, createBox } from "../models/boxes.server";
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

export const loader = async ({ request }) => {
  const { session, admin } = await authenticate.admin(request);
  const boxes = await listBoxes(session.shop);
  return Response.json(boxes);
};

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const { session, admin } = await authenticate.admin(request);
  const body = await request.json();
  try {
    // The frontend sends configuration in `pageConfig`, but `createBox` expects a flat object.
    // We merge the nested and top-level properties to create the expected structure.
    const dataForCreate = {
      ...body.pageConfig,
      ...body,
    };
    delete dataForCreate.pageConfig;

    const box = await createBox(session.shop, dataForCreate, admin);
    const pagePayload = buildPagePayload(dataForCreate);
    const boxId = box?.id;
    const persistedBox = Array.isArray(dataForCreate.quantityPacks) && dataForCreate.quantityPacks.length > 0
      ? await saveMultipleBox(session.shop, {
          id: boxId,
          comboBoxData: {
            boxName: box?.boxName || dataForCreate.boxName,
            displayTitle: box?.displayTitle || dataForCreate.displayTitle,
            isActive: box?.isActive ?? true,
          },
          multipleBoxPageData: pagePayload,
        })
      : await saveSimpleBox(session.shop, {
          id: boxId,
          comboBoxData: {
            boxName: box?.boxName || dataForCreate.boxName,
            displayTitle: box?.displayTitle || dataForCreate.displayTitle,
            isActive: box?.isActive ?? true,
          },
          simpleBoxPageData: pagePayload,
        });
    return Response.json(persistedBox || box, { status: 201 });
  } catch (error) {
    if (error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError") {
      return Response.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
};
