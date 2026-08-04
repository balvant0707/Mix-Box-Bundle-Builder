import { authenticate } from "../shopify.server";
import { BoxCodeValidationError, getBox, updateBox, deleteBox } from "../models/boxes.server";

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
      return Response.json(updated);
    } catch (error) {
      if (error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError") {
        return Response.json({ error: error.message }, { status: 400 });
      }

      throw error;
    }
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
};
