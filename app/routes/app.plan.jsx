import { redirect as rrRedirect, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { withEmbeddedAppParamsFromRequest } from "../utils/embedded-app";

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const redirectPath = `/app/pricing${url.search || ""}`;
  return rrRedirect(withEmbeddedAppParamsFromRequest(redirectPath, request));
};

export const action = async ({ request }) => {
  const url = new URL(request.url);
  const redirectPath = `/app/pricing${url.search || ""}`;
  return rrRedirect(withEmbeddedAppParamsFromRequest(redirectPath, request));
};

export default function PlanPage() {
  return null;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => boundary.headers(headersArgs);
