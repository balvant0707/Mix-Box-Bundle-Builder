import db from "../db.server";
import { authenticate } from "../shopify.server";
import { sendMail } from "../utils/mailer.server";

export const action = async ({ request }) => {
  const { payload, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const customerId = payload?.customer?.id
    ? String(payload.customer.id)
    : null;

  const orderIdsToRedact = Array.isArray(payload?.orders_to_redact)
    ? payload.orders_to_redact.map((o) => String(o.id))
    : [];

  if (!customerId && orderIdsToRedact.length === 0) {
    return new Response(null, { status: 200 });
  }

  const orClauses = [];
  if (customerId) orClauses.push({ shop, customerId });
  if (orderIdsToRedact.length > 0) orClauses.push({ shop, orderId: { in: orderIdsToRedact } });

  const orders = await db.bundleOrder.findMany({
    where: { OR: orClauses },
    select: {
      orderId:          true,
      boxId:            true,
      selectedProducts: true,
      bundlePrice:      true,
      giftMessage:      true,
      orderDate:        true,
      createdAt:        true,
    },
    orderBy: { orderDate: "desc" },
  });

  // Deliver data export to the merchant as required by GDPR / Shopify policy
  const shopRecord = await db.shop.findUnique({ where: { shop }, select: { email: true, name: true } });
  const merchantEmail = shopRecord?.email;

  if (merchantEmail) {
    const customerRef = customerId ? `Customer ID: ${customerId}` : "Unknown customer";
    const rows = orders.map((o) =>
      `<tr>
        <td style="padding:4px 8px;border:1px solid #ddd">${o.orderId ?? "—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${o.boxId ?? "—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${o.bundlePrice != null ? `$${o.bundlePrice}` : "—"}</td>
        <td style="padding:4px 8px;border:1px solid #ddd">${o.orderDate ? new Date(o.orderDate).toISOString().split("T")[0] : "—"}</td>
      </tr>`
    ).join("");

    const html = `
      <h2>Customer Data Export – MixBox</h2>
      <p>Shopify has forwarded a <strong>customers/data_request</strong> for your store <strong>${shop}</strong>.</p>
      <p><strong>${customerRef}</strong></p>
      <p>The following MixBox bundle order records were found:</p>
      ${orders.length === 0
        ? "<p><em>No records found for this customer in MixBox.</em></p>"
        : `<table style="border-collapse:collapse;font-size:14px">
            <thead>
              <tr>
                <th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Order ID</th>
                <th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Box ID</th>
                <th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Price</th>
                <th style="padding:4px 8px;border:1px solid #ddd;background:#f5f5f5">Date</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>`
      }
      <p style="color:#888;font-size:12px;margin-top:24px">
        This is a transactional message sent automatically by MixBox in response to a Shopify GDPR data request.
      </p>`;

    await sendMail(
      merchantEmail,
      `[MixBox] Customer Data Export Request – ${shop}`,
      html,
    ).catch((err) =>
      console.error("[gdpr.customers_data_request] failed to email merchant", err),
    );
  }

  console.info(
    "[gdpr.customers_data_request] customer data snapshot",
    JSON.stringify({ shop, customerId, orderIdsRequested: orderIdsToRedact, recordsFound: orders.length }),
  );

  return new Response(null, { status: 200 });
};
