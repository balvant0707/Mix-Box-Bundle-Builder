import { useLocation, useNavigate, useNavigation } from "react-router";
import {
  Badge,
  BlockStack,
  Button,
  Card,
  InlineGrid,
  InlineStack,
  Page,
  Text,
  Tooltip,
} from "@shopify/polaris";
import {ArrowLeftIcon} from "@shopify/polaris-icons";
import { withEmbeddedAppParams } from "../utils/embedded-app";

import "../styles/BundleTypesPage.css";

const BUNDLE_TYPES = [
  {
    id: "mix-match-single-product",
    title: "Mix & Match Bundle (Single Product)",
    description:
      "Create your perfect bundle by mixing different variants of a single product. Choose colors, sizes, and options to match your preferences.",
    image: "/images/mix-n-match-sp.jpg",
    buttonLabel: "Create Mix & Match Bundle",
    url: "/app/single",
    premium: true,
  },
  {
    id: "mix-match-multiple-products",
    title: "Mix & Match Bundle (Multi Products)",
    description:
      "Create your perfect bundle by mixing different variants of multiple products. Choose colors, sizes, and options to match your preferences.",
    image: "/images/mix-n-match-mp.jpg",
    buttonLabel: "Create Mix & Match Bundle",
    url: "/app/multiplebox",
    premium: true,
  },
];

function BundleTypeCard({bundle}) {
  const navigate = useNavigate();
  const navigation = useNavigation();
  const location = useLocation();

  const isLoading =
    navigation.state === "loading" &&
    navigation.location.pathname === bundle.url;

  const handleClick = () => {
    const target = withEmbeddedAppParams(bundle.url, location.search);
    navigate(target);
  };
  return (
    <div className="bundle-type-card">
      <Card padding="400">
        <div className="bundle-type-card__content">
          {bundle.premium && (
            <div className="bundle-type-card__premium">
              <Tooltip
                content="Available with the premium plan"
                preferredPosition="above"
              >
                <span
                  className="bundle-type-card__premium-activator"
                  tabIndex={0}
                  aria-label="Premium bundle type"
                >
                  <Badge tone="info">Premium</Badge>
                </span>
              </Tooltip>
            </div>
          )}

          <BlockStack gap="300">
            <div className="bundle-type-card__image-wrapper">
              <img
                src={bundle.image}
                alt={bundle.title}
                className="bundle-type-card__image"
                loading="lazy"
              />
            </div>

            <div className="bundle-type-card__information">
              <BlockStack gap="200">
                <Text
                  as="h2"
                  variant="headingMd"
                  alignment="center"
                  fontWeight="semibold"
                >
                  {bundle.title}
                </Text>

                <Text
                  as="p"
                  variant="bodyMd"
                  alignment="center"
                  tone="subdued"
                >
                  {bundle.description}
                </Text>
              </BlockStack>
            </div>
          </BlockStack>

          <div className="bundle-type-card__action">
            <Button
              variant="primary"
              fullWidth
              onClick={handleClick}
              loading={isLoading}
            >
              {bundle.buttonLabel}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function BundleTypesPage() {
  return (
    <Page>
      <BlockStack gap="600">
        <InlineStack gap="300" blockAlign="start" wrap={false}>
          <Button
            icon={ArrowLeftIcon}
            accessibilityLabel="Back to app home"
            url="/app"
          />

          <BlockStack gap="100">
            <Text as="h1" variant="headingLg" fontWeight="bold">
              Bundle Types
            </Text>

            <Text as="p" variant="bodySm" tone="subdued">
              Choose the type of bundle you want to create
            </Text>
          </BlockStack>
        </InlineStack>

        <InlineGrid
          columns={{
            sm: 1,
            md: 2,
            lg: 2,
          }}
          gap="300"
          alignItems="stretch"
        >
          {BUNDLE_TYPES.map((bundle) => (
            <BundleTypeCard key={bundle.id} bundle={bundle} />
          ))}
        </InlineGrid>
      </BlockStack>
    </Page>
  );
}
