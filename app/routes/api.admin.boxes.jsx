import { authenticate } from "../shopify.server";
import { BoxCodeValidationError, listBoxes, createBox } from "../models/boxes.server";

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
    const box = await createBox(session.shop, body, admin);
    return Response.json(box, { status: 201 });
  } catch (error) {
    if (error instanceof BoxCodeValidationError || error?.name === "BoxCodeValidationError") {
      return Response.json({ error: error.message }, { status: 400 });
    }

    throw error;
  }
};
