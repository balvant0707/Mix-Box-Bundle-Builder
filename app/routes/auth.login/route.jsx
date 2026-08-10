import { useState } from "react";
import { Form, redirect, useActionData, useLoaderData } from "react-router";
import { AppProvider as PolarisAppProvider } from "@shopify/polaris";
import {
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  InlineStack,
  Page,
  Text,
  TextField,
} from "@shopify/polaris";
import enTranslations from "@shopify/polaris/locales/en.json";
import "@shopify/polaris/build/esm/styles.css";
import { login } from "../../shopify.server";
import { loginErrorMessage } from "./error.server";

function getShopFromAdminReferer(request) {
  const referer = request.headers.get("referer") || "";
  if (!referer) return "";

  try {
    const refererUrl = new URL(referer);
    if (refererUrl.hostname !== "admin.shopify.com") return "";
    const match = refererUrl.pathname.match(/\/store\/([^/]+)/i);
    const storeHandle = match?.[1] ? decodeURIComponent(match[1]).trim() : "";
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(storeHandle)) return "";
    return `${storeHandle.toLowerCase()}.myshopify.com`;
  } catch {
    return "";
  }
}

export const loader = async ({ request }) => {
  const url = new URL(request.url);
  if (!url.searchParams.get("shop")) {
    const refererShop = getShopFromAdminReferer(request);
    if (refererShop) {
      throw redirect(`/auth?shop=${encodeURIComponent(refererShop)}`);
    }
  }

  const errors = loginErrorMessage(await login(request));

  return {
    errors,
    shop: url.searchParams.get("shop") || "",
  };
};

export const action = async ({ request }) => {
  const errors = loginErrorMessage(await login(request));

  return {
    errors,
  };
};

export default function Auth() {
  const loaderData = useLoaderData();
  const actionData = useActionData();
  const [shop, setShop] = useState(loaderData.shop || "");
  const { errors } = actionData || loaderData;

  return (
    <PolarisAppProvider i18n={enTranslations}>
      <Page narrowWidth title="MixBox - Box & Bundle Builder">
        <Card>
          <Form method="post">
            <BlockStack gap="400">
              <BlockStack gap="100">
                <Text as="h1" variant="headingLg">
                  Open your MixBox dashboard
                </Text>
                <Text as="p" tone="subdued">
                  Enter your Shopify store domain to continue.
                </Text>
              </BlockStack>

              {errors.shop ? (
                <Banner tone="critical">
                  <p>{errors.shop}</p>
                </Banner>
              ) : null}

              <TextField
                name="shop"
                label="Shop domain"
                placeholder="example.myshopify.com"
                value={shop}
                onChange={setShop}
                autoComplete="on"
                error={errors.shop}
              />

              <InlineStack align="end">
                <Button submit variant="primary">
                  Log in
                </Button>
              </InlineStack>

              <Box borderBlockStartWidth="025" borderColor="border">
                <Text as="p" variant="bodySm" tone="subdued">
                  If you opened the app from Shopify admin, refresh the admin page and launch MixBox again.
                </Text>
              </Box>
            </BlockStack>
          </Form>
        </Card>
      </Page>
    </PolarisAppProvider>
  );
}

