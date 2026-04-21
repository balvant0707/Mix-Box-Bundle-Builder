/**
 * subscription.server.js
 * Route-protection middleware for plan-gated features.
 *
 * Usage inside any loader:
 *
 *   import { requirePlan, requirePaidPlan } from "../middleware/subscription.server";
 *
 *   export const loader = async ({ request }) => {
 *     const { session } = await authenticate.admin(request);
 *     await requirePlan(session.shop, "BASIC");   // throws redirect if below BASIC
 *     // ... rest of loader
 *   };
 */

import { redirect } from "react-router";
import { getSubscription, hasPlanAccess, PLAN_KEYS } from "../models/subscription.server.js";

/** Base path for the pricing/upgrade page */
const PRICING_PATH = "/app/pricing";

/**
 * Ordered lowest → highest.
 * Must match the plan keys in models/subscription.server.js
 */
const PLAN_HIERARCHY = PLAN_KEYS; // ["FREE", "BASIC", "ADVANCE", "PLUS"]

/**
 * Throws a redirect to the pricing page when the shop's plan is below `minPlanKey`.
 *
 * @param {string} shop       - The shop domain
 * @param {string} minPlanKey - Minimum required plan key ("BASIC" | "ADVANCE" | "PLUS")
 * @param {string} [pricingPath]
 */
export async function requirePlan(shop, minPlanKey, pricingPath = PRICING_PATH) {
  const minIndex = PLAN_HIERARCHY.indexOf(minPlanKey);
  if (minIndex === -1) throw new Error(`Unknown plan key: ${minPlanKey}`);

  const sub = await getSubscription(shop);
  const currentKey = sub?.plan ?? "FREE";
  const currentIndex = PLAN_HIERARCHY.indexOf(currentKey === "PRO" ? "PLUS" : currentKey);

  if (currentIndex < minIndex) {
    throw redirect(`${pricingPath}?required=${minPlanKey}&shop=${shop}`);
  }

  return currentKey;
}

/**
 * Convenience: require any paid plan (BASIC or above).
 */
export async function requirePaidPlan(shop, pricingPath = PRICING_PATH) {
  return requirePlan(shop, "BASIC", pricingPath);
}

/**
 * Non-throwing version — returns { allowed, currentKey, requiredKey }.
 */
export async function checkPlan(shop, minPlanKey) {
  const minIndex = PLAN_HIERARCHY.indexOf(minPlanKey);
  const sub = await getSubscription(shop);
  const currentKey = sub?.plan ?? "FREE";
  const currentIndex = PLAN_HIERARCHY.indexOf(currentKey === "PRO" ? "PLUS" : currentKey);
  return {
    allowed:     currentIndex >= minIndex,
    currentKey,
    requiredKey: minPlanKey,
  };
}

/**
 * Returns true if the shop has any active plan (including free).
 */
export async function checkActivePlan(shop) {
  const sub = await getSubscription(shop);
  return hasPlanAccess(sub);
}
