import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useLoaderData, useLocation, useNavigate, useParams } from 'react-router';
import {
  Badge,
  Banner,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  Collapsible,
  ColorPicker,
  Divider,
  DropZone,
  EmptyState,
  Form,
  Grid,
  Icon,
  Image,
  InlineGrid,
  InlineStack,
  Modal,
  Page,
  Popover,
  RadioButton,
  RangeSlider,
  ResourceItem,
  ResourceList,
  Select,
  Spinner,
  Tabs,
  Text,
  TextField,
  Thumbnail,
  Tooltip,
} from '@shopify/polaris';
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CollectionIcon,
  DeleteIcon,
  ImageIcon,
  PlusIcon,
  ProductIcon,
  SearchIcon,
} from '@shopify/polaris-icons';
import { ToggleSwitch } from '../components/toggle-switch';
import { authenticate } from '../shopify.server';
import { withEmbeddedAppParams } from '../utils/embedded-app';
import { getBox } from '../models/boxes.server';

const PICKER_PAGE_SIZE = 10;
const BOX_CODE_MIN_LENGTH = 3;
const BOX_CODE_MAX_LENGTH = 10;
const BOX_CODE_PATTERN = /^\d+$/;

const EMPTY_PAGE_INFO = {
  hasNextPage: false,
  endCursor: null,
};
const EMPTY_ITEMS = [];

function normalizeBoxCode(value) {
  return String(value || '').trim();
}

function getBoxCodeValidationError(value) {
  const code = normalizeBoxCode(value);
  if (!code) return '';
  if (code.length < BOX_CODE_MIN_LENGTH || code.length > BOX_CODE_MAX_LENGTH) {
    return `Code must be ${BOX_CODE_MIN_LENGTH}-${BOX_CODE_MAX_LENGTH} digits.`;
  }
  if (!BOX_CODE_PATTERN.test(code)) {
    return 'Code can only contain numbers.';
  }
  return '';
}

const PRODUCTS_QUERY = `#graphql
  query SimpleBundleProducts($first: Int!, $after: String) {
    products(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          featuredImage {
            url
          }
          variants(first: 1) {
            edges {
              node {
                price
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const COLLECTIONS_QUERY = `#graphql
  query SimpleBundleCollections($first: Int!, $after: String) {
    collections(first: $first, after: $after) {
      edges {
        node {
          id
          title
          handle
          image {
            url
          }
          products(first: 10) {
            edges {
              node {
                id
                title
                handle
                featuredImage {
                  url
                }
                variants(first: 1) {
                  edges {
                    node {
                      price
                    }
                  }
                }
              }
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

function mapProductEdges(edges) {
  return (edges || []).map(({ node }) => {
    const price = node.variants?.edges?.[0]?.node?.price;

    return {
      id: node.id,
      title: node.title,
      image: node.featuredImage?.url || null,
      subtitle: price ? `$${price}` : node.handle || '',
    };
  });
}

function mapCollectionEdges(edges) {
  return (edges || []).map(({ node }) => ({
    id: node.id,
    title: node.title,
    image: node.image?.url || null,
    subtitle: node.handle || '',
    products: mapProductEdges(node.products?.edges),
  }));
}

function uniqueItems(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function getConfiguredProducts({
  productConfiguration,
  products,
  collections,
  selectedProductIds,
  selectedCollectionIds,
}) {
  if (productConfiguration === 'selected_products') {
    return products.filter((product) => selectedProductIds.includes(product.id));
  }

  if (productConfiguration === 'selected_collections') {
    return uniqueItems(
      collections
        .filter((collection) => selectedCollectionIds.includes(collection.id))
        .flatMap((collection) => collection.products || []),
    );
  }

  return products;
}

function getPageInfo(connection) {
  return connection?.pageInfo || EMPTY_PAGE_INFO;
}

async function loadPickerPage(admin, resource, after = null) {
  const query = resource === 'collections' ? COLLECTIONS_QUERY : PRODUCTS_QUERY;
  const response = await admin.graphql(query, {
    variables: { first: PICKER_PAGE_SIZE, after: after || null },
  });
  const json = await response.json();

  if (json?.errors?.length) {
    console.warn(`[app.simple] ${resource} GraphQL errors`, json.errors);
    return {
      resource,
      items: [],
      pageInfo: EMPTY_PAGE_INFO,
      error: `Unable to load ${resource}.`,
    };
  }

  const connection =
    resource === 'collections'
      ? json?.data?.collections
      : json?.data?.products;

  return {
    resource,
    items:
      resource === 'collections'
        ? mapCollectionEdges(connection?.edges)
        : mapProductEdges(connection?.edges),
    pageInfo: getPageInfo(connection),
    error: '',
  };
}

async function loadJsonOrNull(promise, label) {
  try {
    const response = await promise;
    return await response.json();
  } catch (error) {
    console.warn(`[app.simple] failed to load ${label}`, error);
    return null;
  }
}

export const loader = async ({ request, params }) => {
  const { admin, session } = await authenticate.admin(request);
  const url = new URL(request.url);
  const pickerResource = url.searchParams.get('pickerResource');

  if (pickerResource === 'products' || pickerResource === 'collections') {
    try {
      return await loadPickerPage(
        admin,
        pickerResource,
        url.searchParams.get('after'),
      );
    } catch (error) {
      console.warn(`[app.simple] failed to load ${pickerResource}`, error);
      return {
        resource: pickerResource,
        items: [],
        pageInfo: EMPTY_PAGE_INFO,
        error: `Unable to load ${pickerResource}.`,
      };
    }
  }

  const [box, productsJson, collectionsJson] = await Promise.all([
    getBox(params.id, session.shop),
    loadJsonOrNull(
      admin.graphql(PRODUCTS_QUERY, {
        variables: { first: PICKER_PAGE_SIZE, after: null },
      }),
      'products',
    ),
    loadJsonOrNull(
      admin.graphql(COLLECTIONS_QUERY, {
        variables: { first: PICKER_PAGE_SIZE, after: null },
      }),
      'collections',
    ),
  ]);

  if (!box) {
    const location = withEmbeddedAppParams("/app/boxes", new URL(request.url).search);
    return new Response(null, {
      status: 302,
      headers: { Location: location },
    });
  }

  if (
    productsJson?.errors?.length ||
    collectionsJson?.errors?.length
  ) {
    console.warn('[app.simple] GraphQL errors', {
      products: productsJson?.errors,
      collections: collectionsJson?.errors,
    });
  }

  const products = mapProductEdges(productsJson?.data?.products?.edges);
  const collections = mapCollectionEdges(collectionsJson?.data?.collections?.edges);

  return {
    initialData: {
      ...(box.simpleBoxPage || {}),
      ...box,
    },
    customers: [],
    customerTags: [],
    products,
    collections,
    productsPageInfo: getPageInfo(productsJson?.data?.products),
    collectionsPageInfo: getPageInfo(collectionsJson?.data?.collections),
  };
};

const DISCOUNT_OPTIONS = [
  { label: 'Percentage discount %', value: 'percentage' },
  { label: 'Fixed Amount Discount', value: 'fixed_amount' },
];

const DISCOUNT_MODE_OPTIONS = [
  { label: 'Fixed Amount', value: 'fixed_amount' },
  { label: 'Flat Discount', value: 'flat_discount' },
  { label: 'Free Gift Product', value: 'free_gift_product' },
];

function getDiscountSubmissionFields(form, selectedGiftProductIds = []) {
  if (form.discountMode === 'free_gift_product') {
    return {
      bundlePriceType: 'dynamic',
      discountMode: 'free_gift_product',
      discountType: 'buy_x_get_y',
      discountValue: '100',
      buyQuantity: 1,
      getQuantity: 1,
      selectedGiftProductIds,
    };
  }

  if (form.discountMode === 'flat_discount') {
    return {
      bundlePriceType: 'dynamic',
      discountMode: 'flat_discount',
      discountType: form.discountType === 'fixed_amount' ? 'fixed' : 'percent',
      discountValue: form.discountValue || '0',
      selectedGiftProductIds: [],
    };
  }

  return {
    bundlePriceType: 'dynamic',
    discountMode: 'fixed_amount',
    discountType: 'fixed',
    discountValue: form.discountValue || '0',
    selectedGiftProductIds: [],
  };
}

const PRODUCT_CONFIGURATION_OPTIONS = [
  { label: 'Wholestore', value: 'whole_store' },
  { label: 'Select products', value: 'selected_products' },
  { label: 'Select collections', value: 'selected_collections' },
];

const SCHEDULE_OPTIONS = [
  { label: 'Publish immediately', value: 'immediately' },
  { label: 'Schedule bundle', value: 'scheduled' },
];

const CUSTOMER_ELIGIBILITY_OPTIONS = [
  { label: 'All Customers', value: 'all' },
  { label: 'Customer Tags', value: 'tags' },
  { label: 'Specific Customer', value: 'specific' },
];

const ADVANCED_SETTINGS = [
  {
    field: 'hideOutOfStockProducts',
    label: 'Hide Out of Stock Products',
    helpText: 'Hide unavailable products from the storefront product selector.',
  },
  {
    field: 'showProductSearch',
    label: 'Show product search',
    helpText: 'Let customers search products inside the bundle selector.',
  },
  {
    field: 'hideBundleHeader',
    label: 'Hide bundle header',
    helpText: 'Hide the storefront bundle title and description header.',
  },
  {
    field: 'hideBannerImage',
    label: 'Hide Banner Image',
    helpText: 'Do not display the bundle banner image on the storefront.',
  },
  {
    field: 'hideProductInfoModal',
    label: 'Hide product info modal',
    helpText: 'Disable the product details modal from the storefront selector.',
  },
  {
    field: 'productImageAutoHeight',
    label: 'Product Image Auto Height',
    helpText: 'Let product images use their natural height instead of a fixed height.',
  },
  {
    field: 'displayCompareAtPrice',
    label: "Display 'Compare at' price",
    helpText: "Show compare-at prices when Shopify product variants include them.",
  },
  {
    field: 'redirectToCheckout',
    label: 'Redirect to Checkout',
    helpText: 'Send customers directly to checkout after adding the bundle.',
  },
  {
    field: 'redirectToCart',
    label: 'Redirect to Cart',
    helpText: 'Send customers to the cart after adding the bundle.',
  },
];

const FORM_TABS = [
  { id: 'content', content: 'Content', panelID: 'content-panel' },
  { id: 'design', content: 'Design', panelID: 'design-panel' },
  { id: 'advanced', content: 'Advanced', panelID: 'advanced-panel' },
];

const SIZE_OPTIONS = [
  { label: 'Small', value: 'Small' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Large', value: 'Large' },
];

const FONT_STYLE_OPTIONS = [
  { label: 'Light', value: 'Light' },
  { label: 'Regular', value: 'Regular' },
  { label: 'Medium', value: 'Medium' },
  { label: 'Bold', value: 'Bold' },
];

const IMAGE_DISPLAY_OPTIONS = [
  { label: 'Desktop/Mobile', value: 'Desktop/Mobile' },
  { label: 'Desktop only', value: 'Desktop only' },
  { label: 'Mobile only', value: 'Mobile only' },
];

const DEFAULT_DESIGN_SETTINGS = {
  backgroundColor: '#FFFFFF',
  cardBorderColor: '#F2F2F2',
  imageHeight: 200,
  imageHeightMobile: 160,
  imageDisplay: 'Desktop/Mobile',
  productCardDesktopSize: 'Large',
  productCardMobileSize: 'Medium',
  borderWidth: '0',
  borderRadius: 0,
  titleTextColor: '#050505',
  titleSize: '14',
  titleStyle: 'Regular',
  productPriceColor: '#000000',
  productPriceSize: '14',
  productPriceStyle: 'Medium',
  compareAtPriceColor: '#9D9D9D',
  compareAtPriceSize: '12',
  compareAtPriceStyle: 'Light',
  ctaBackgroundColor: '#303030',
  ctaTextColor: '#F5F5F5',
  ctaSize: '14',
  ctaStyle: 'Bold',
  variantSelectorColor: '#383838',
  variantSelectorSize: '12',
  variantSelectorStyle: 'Regular',
  imagePopupBackgroundColor: '#FFFFFF',
  imagePopupTextColor: '#303030',
};

function getCurrentDateTimeInput() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');

  return {
    date: `${year}-${month}-${day}`,
    time: `${hours}:${minutes}`,
  };
}

function clampDateInput(value, minDate) {
  if (!value) return value;
  return value < minDate ? minDate : value;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHexColor(value, fallback = '#FFFFFF') {
  const raw = String(value || '').trim();
  const hex = raw.startsWith('#') ? raw : `#${raw}`;

  if (/^#[0-9A-Fa-f]{3}$/.test(hex)) {
    return `#${hex
      .slice(1)
      .split('')
      .map((char) => `${char}${char}`)
      .join('')}`.toUpperCase();
  }

  if (/^#[0-9A-Fa-f]{6}([0-9A-Fa-f]{2})?$/.test(hex)) {
    return hex.toUpperCase();
  }

  return fallback;
}

function hexToHsba(value) {
  const hex = normalizeHexColor(value);
  const red = parseInt(hex.slice(1, 3), 16) / 255;
  const green = parseInt(hex.slice(3, 5), 16) / 255;
  const blue = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const alpha = hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = ((green - blue) / delta) % 6;
    } else if (max === green) {
      hue = (blue - red) / delta + 2;
    } else {
      hue = (red - green) / delta + 4;
    }
    hue *= 60;
    if (hue < 0) hue += 360;
  }

  return {
    hue,
    saturation: max === 0 ? 0 : delta / max,
    brightness: max,
    alpha,
  };
}

function hsbaToHex({ hue, saturation, brightness, alpha = 1 }) {
  const chroma = brightness * saturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = brightness - chroma;
  const toHex = (channel) =>
    Math.round(clampNumber((channel + match) * 255, 0, 255))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase();
  const alphaHex = Math.round(clampNumber(alpha, 0, 1) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}${alpha < 1 ? alphaHex : ''}`;
}

function ColorField({ label, value, onChange }) {
  const [popoverActive, setPopoverActive] = useState(false);
  const colorValue = normalizeHexColor(value);
  const swatchColor = colorValue.length === 9 ? colorValue.slice(0, 7) : colorValue;
  const alpha = colorValue.length === 9 ? parseInt(colorValue.slice(7, 9), 16) / 255 : 1;
  const swatchBackground = alpha < 1
    ? `linear-gradient(45deg, #d1d5db 25%, transparent 25%), linear-gradient(-45deg, #d1d5db 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #d1d5db 75%), linear-gradient(-45deg, transparent 75%, #d1d5db 75%)`
    : swatchColor;
  const activator = (
    <button
      type="button"
      onClick={() => setPopoverActive((active) => !active)}
      aria-label={`Open ${label} color picker`}
      style={{
        width: 44,
        minHeight: 36,
        height: '100%',
        border: '1px solid var(--p-color-border)',
        borderRadius: 'var(--p-border-radius-200)',
        background: 'var(--p-color-bg-surface)',
        padding: 4,
        display: 'flex',
        alignItems: 'stretch',
        cursor: 'pointer',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: 'block',
          width: '100%',
          minHeight: 26,
          borderRadius: 4,
          border: '1px solid var(--p-color-border)',
          background: swatchBackground,
          backgroundColor: swatchColor,
          backgroundSize: '8px 8px',
          backgroundPosition: '0 0, 0 4px, 4px -4px, -4px 0px',
          verticalAlign: 'middle',
        }}
      />
    </button>
  );

  return (
    <TextField
      label={label}
      value={colorValue}
      onChange={(nextValue) => onChange(normalizeHexColor(nextValue, nextValue))}
      autoComplete="off"
      connectedLeft={
        <Popover
          active={popoverActive}
          activator={activator}
          autofocusTarget="none"
          onClose={() => setPopoverActive(false)}
        >
          <Popover.Section>
            <BlockStack gap="300">
              <ColorPicker
                color={hexToHsba(colorValue)}
                onChange={(color) => onChange(hsbaToHex(color))}
                allowAlpha
                fullWidth
              />
              <TextField
                label={`${label} hex value`}
                value={colorValue}
                onChange={(nextValue) => onChange(normalizeHexColor(nextValue, nextValue))}
                autoComplete="off"
              />
            </BlockStack>
          </Popover.Section>
        </Popover>
      }
    />
  );
}

function DesignNumberField({ label, value, onChange, suffix, min = 0, max }) {
  return (
    <TextField
      label={label}
      type="number"
      value={String(value)}
      min={min}
      max={max}
      onChange={onChange}
      suffix={suffix}
      autoComplete="off"
    />
  );
}

function DesignRangeField({ label, value, min, max, step = 1, suffix = 'px', onChange }) {
  return (
    <BlockStack gap="200">
      <RangeSlider
        label={`${label}: ${value}${suffix}`}
        min={min}
        max={max}
        step={step}
        value={Number(value)}
        onChange={onChange}
        output
      />
    </BlockStack>
  );
}

function DesignSelectField({ label, options, value, onChange }) {
  return (
    <Select
      label={label}
      options={options}
      value={value}
      onChange={onChange}
    />
  );
}

function DesignFieldGroup({ children }) {
  return (
    <InlineGrid columns={{ xs: 1, md: 3 }} gap="400">
      {children}
    </InlineGrid>
  );
}

function PixelField({ label, value, onChange }) {
  return (
    <DesignNumberField
      label={label}
      value={value}
      onChange={onChange}
      suffix="px"
      min={0}
    />
  );
}

function DesignSection({ title, children }) {
  return (
    <BlockStack gap="300">
      {title ? (
        <Text as="h3" variant="headingMd">
          {title}
        </Text>
      ) : null}
      {children}
    </BlockStack>
  );
}

function FormTabs({ selected, onSelect }) {
  return (
    <div className="simple-bundle-tabs">
      <style>
        {`
          .simple-bundle-tabs {
            background: #ffffff;
            border-radius: 8px;
            padding: 8px 12px;
          }

          .simple-bundle-tabs .Polaris-Tabs__Wrapper {
            border: 0;
          }

          .simple-bundle-tabs .Polaris-Tabs__Tab {
            border-radius: 8px;
            color: #303030;
            min-height: 36px;
            padding-inline: 16px;
          }

          .simple-bundle-tabs .Polaris-Tabs__Tab[aria-selected='true'],
          .simple-bundle-tabs .Polaris-Tabs__Tab--active {
            background: #000000 !important;
            color: #ffffff !important;
          }

          .simple-bundle-tabs .Polaris-Tabs__Tab[aria-selected='true'] span,
          .simple-bundle-tabs .Polaris-Tabs__Tab--active span {
            color: #ffffff !important;
          }
        `}
      </style>
      <Tabs tabs={FORM_TABS} selected={selected} onSelect={onSelect} />
    </div>
  );
}

function ProductCardDesignPanel({ settings, onChange }) {
  return (
    <BlockStack gap="400">
      <DesignSection title="General">
        <DesignFieldGroup>
          <ColorField
            label="Background Color"
            value={settings.backgroundColor}
            onChange={(value) => onChange('backgroundColor', value)}
          />
          <ColorField
            label="Card Border Color"
            value={settings.cardBorderColor}
            onChange={(value) => onChange('cardBorderColor', value)}
          />
          <DesignRangeField
            label="Image Height"
            min={80}
            max={420}
            value={settings.imageHeight}
            onChange={(value) => onChange('imageHeight', value)}
          />
          <DesignRangeField
            label="Image Height Mobile"
            min={80}
            max={320}
            value={settings.imageHeightMobile}
            onChange={(value) => onChange('imageHeightMobile', value)}
          />
          <DesignSelectField
            label="Image Display"
            options={IMAGE_DISPLAY_OPTIONS}
            value={settings.imageDisplay}
            onChange={(value) => onChange('imageDisplay', value)}
          />
          <DesignSelectField
            label="Product Card Desktop Size"
            options={SIZE_OPTIONS}
            value={settings.productCardDesktopSize}
            onChange={(value) => onChange('productCardDesktopSize', value)}
          />
          <DesignSelectField
            label="Product Card Mobile Size"
            options={SIZE_OPTIONS}
            value={settings.productCardMobileSize}
            onChange={(value) => onChange('productCardMobileSize', value)}
          />
          <PixelField
            label="Border Width"
            value={settings.borderWidth}
            onChange={(value) => onChange('borderWidth', value)}
          />
          <DesignRangeField
            label="Border Radius"
            min={0}
            max={40}
            value={settings.borderRadius}
            onChange={(value) => onChange('borderRadius', value)}
          />
        </DesignFieldGroup>
      </DesignSection>

      <Divider />

      <DesignSection title="Title">
        <DesignFieldGroup>
          <ColorField label="Text Color" value={settings.titleTextColor} onChange={(value) => onChange('titleTextColor', value)} />
          <PixelField label="Size" value={settings.titleSize} onChange={(value) => onChange('titleSize', value)} />
          <DesignSelectField label="Style" options={FONT_STYLE_OPTIONS} value={settings.titleStyle} onChange={(value) => onChange('titleStyle', value)} />
        </DesignFieldGroup>
      </DesignSection>

      <Divider />

      <DesignSection title="Price">
        <DesignFieldGroup>
          <ColorField label="Product Price Color" value={settings.productPriceColor} onChange={(value) => onChange('productPriceColor', value)} />
          <PixelField label="Product Price Size" value={settings.productPriceSize} onChange={(value) => onChange('productPriceSize', value)} />
          <DesignSelectField label="Product Price Style" options={FONT_STYLE_OPTIONS} value={settings.productPriceStyle} onChange={(value) => onChange('productPriceStyle', value)} />
        </DesignFieldGroup>
      </DesignSection>

      <Divider />

      <DesignSection title="Compare at Price">
        <DesignFieldGroup>
          <ColorField label="Compare-at Price" value={settings.compareAtPriceColor} onChange={(value) => onChange('compareAtPriceColor', value)} />
          <PixelField label="Compare-at Price Size" value={settings.compareAtPriceSize} onChange={(value) => onChange('compareAtPriceSize', value)} />
          <DesignSelectField label="Compare-at Price Style" options={FONT_STYLE_OPTIONS} value={settings.compareAtPriceStyle} onChange={(value) => onChange('compareAtPriceStyle', value)} />
        </DesignFieldGroup>
      </DesignSection>

      <Divider />

      <DesignSection title="CTA">
        <DesignFieldGroup>
          <ColorField label="Background Color" value={settings.ctaBackgroundColor} onChange={(value) => onChange('ctaBackgroundColor', value)} />
          <ColorField label="Text Color" value={settings.ctaTextColor} onChange={(value) => onChange('ctaTextColor', value)} />
          <PixelField label="Size" value={settings.ctaSize} onChange={(value) => onChange('ctaSize', value)} />
          <DesignSelectField label="Style" options={FONT_STYLE_OPTIONS} value={settings.ctaStyle} onChange={(value) => onChange('ctaStyle', value)} />
        </DesignFieldGroup>
      </DesignSection>

      <Divider />

      <DesignSection title="Variant Selector">
        <DesignFieldGroup>
          <ColorField label="Color" value={settings.variantSelectorColor} onChange={(value) => onChange('variantSelectorColor', value)} />
          <PixelField label="Size" value={settings.variantSelectorSize} onChange={(value) => onChange('variantSelectorSize', value)} />
          <DesignSelectField label="Style" options={FONT_STYLE_OPTIONS} value={settings.variantSelectorStyle} onChange={(value) => onChange('variantSelectorStyle', value)} />
        </DesignFieldGroup>
      </DesignSection>

      <Divider />

      <DesignSection title="Image Popup">
        <DesignFieldGroup>
          <ColorField label="Background Color" value={settings.imagePopupBackgroundColor} onChange={(value) => onChange('imagePopupBackgroundColor', value)} />
          <ColorField label="Text Color" value={settings.imagePopupTextColor} onChange={(value) => onChange('imagePopupTextColor', value)} />
        </DesignFieldGroup>
      </DesignSection>
    </BlockStack>
  );
}

function DesignTabPanel({ settings, onChange, onBack, onNext }) {
  return (
    <BlockStack gap="400">
      <Card padding="0">
        <BlockStack gap="0">
          <Box padding="400">
            <ProductCardDesignPanel settings={settings} onChange={onChange} />
          </Box>
          <Divider />
          <Box padding="400">
            <InlineStack align="space-between">
              <Button onClick={onBack}>Back</Button>
              <Button onClick={onNext}>Next</Button>
            </InlineStack>
          </Box>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}

function CustomerEligibilitySection({
  form,
  onChange,
  onBrowseTags,
  onBrowseCustomers,
  customerDisplayValue,
}) {
  const selected = Array.isArray(form.eligibility)
    ? form.eligibility
    : [form.eligibility || 'all'];
  const selectedValue = selected[0] || 'all';

  return (
    <BlockStack gap="300">
      <ChoiceList
        title="Customer eligibility"
        titleHidden
        choices={CUSTOMER_ELIGIBILITY_OPTIONS}
        selected={[selectedValue]}
        onChange={(value) => onChange('eligibility', value)}
      />

      {selectedValue === 'tags' ? (
        <TextField
          label="Customer tags"
          labelHidden
          prefix={<Icon source={SearchIcon} />}
          placeholder="Browse customers by tag"
          value={form.customerTags}
          onChange={(value) => onChange('customerTags', value)}
          autoComplete="off"
          connectedRight={<Button onClick={onBrowseTags}>Browse</Button>}
        />
      ) : null}

      {selectedValue === 'specific' ? (
        <TextField
          label="Specific customers"
          labelHidden
          prefix={<Icon source={SearchIcon} />}
          placeholder="Browse customer by email or tag"
          value={customerDisplayValue}
          onChange={() => { }}
          autoComplete="off"
          readOnly
          connectedRight={<Button onClick={onBrowseCustomers}>Browse</Button>}
        />
      ) : null}
    </BlockStack>
  );
}

function BundleInformationSection({ form, onChange, boxCodeError }) {
  return (
    <BlockStack gap="400">
      <TextField
        label="Title"
        requiredIndicator
        value={form.title}
        onChange={(value) => onChange('title', value)}
        placeholder="Build your perfect bundle"
        autoComplete="off"
      />

      <TextField
        label="Code"
        value={form.boxCode}
        onChange={(value) => onChange('boxCode', value)}
        placeholder="Auto-generated if blank"
        helpText="Use 3-10 digits. This code is saved with the box and must be unique."
        error={boxCodeError || undefined}
        autoComplete="off"
      />

      <TextField
        label="Description"
        value={form.description}
        onChange={(value) => onChange('description', value)}
        multiline={4}
        placeholder="Describe this bundle"
        autoComplete="off"
      />

      <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
        <ImageUploader
          label="Bundle Image"
          value={form.bundleImage}
          onChange={(value) => onChange('bundleImage', value)}
          helpText="Used as the main bundle thumbnail or product-style image."
        />

        <ImageUploader
          label="Banner Image"
          value={form.bannerImage}
          onChange={(value) => onChange('bannerImage', value)}
          helpText="Displayed as the wide banner at the top of the bundle preview."
        />
      </InlineGrid>
    </BlockStack>
  );
}

function StatusSummarySection({ status, onChange }) {
  return (
    <Card>
      <BlockStack gap="300">
        <InlineStack align="space-between" blockAlign="center">
          <Text as="h2" variant="headingMd">
            Status
          </Text>
          <Badge tone={status === 'active' ? 'success' : undefined}>
            {status === 'active' ? 'Active' : 'Inactive'}
          </Badge>
        </InlineStack>

        <Divider />

        <InlineStack gap="500" blockAlign="center">
          <RadioButton
            label="Active"
            checked={status === 'active'}
            id="bundle-status-active"
            name="bundleStatus"
            onChange={() => onChange('active')}
          />
          <RadioButton
            label="Inactive"
            checked={status === 'inactive'}
            id="bundle-status-inactive"
            name="bundleStatus"
            onChange={() => onChange('inactive')}
          />
        </InlineStack>
      </BlockStack>
    </Card>
  );
}

function ProductPreviewGrid({ products, maxItems }) {
  const limit = Math.max(Number(maxItems) || 0, 0);
  const visibleProducts = products.slice(0, limit || 6);

  if (!visibleProducts.length) return null;

  return (
    <div
      style={{
        display: 'grid',
        gap: 8,
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
      }}
    >
      {visibleProducts.map((product) => (
        <div
          key={product.id}
          style={{
            minWidth: 0,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              alignItems: 'center',
              aspectRatio: '1 / 1',
              background: '#ffffff',
              border: '1px solid #d8d8d8',
              borderRadius: 5,
              display: 'flex',
              justifyContent: 'center',
              overflow: 'hidden',
              width: '100%',
            }}
          >
            {product.image ? (
              <img
                src={product.image}
                alt={product.title}
                style={{
                  display: 'block',
                  height: '100%',
                  objectFit: 'contain',
                  width: '100%',
                }}
              />
            ) : (
              <Icon source={ProductIcon} tone="subdued" />
            )}
          </div>

          <div
            title={product.title}
            style={{
              color: '#4b4b4b',
              fontSize: 13,
              fontWeight: 600,
              lineHeight: '18px',
              marginTop: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {product.title}
          </div>
        </div>
      ))}
    </div>
  );
}

function AdvancedTabPanel({ form, onChange }) {
  return (
    <Card>
      <BlockStack gap="500">
        <BlockStack gap="100">
          <Text as="h2" variant="headingMd">
            Advanced
          </Text>
          <Text as="p" tone="subdued">
            Configure storefront behavior for this bundle.
          </Text>
        </BlockStack>

        <Divider />

        <BlockStack gap="300">
          {ADVANCED_SETTINGS.map((setting) => (
            <Box
              key={setting.field}
              padding="300"
              borderRadius="300"
              borderWidth="025"
              borderColor="border"
            >
              <InlineStack align="space-between" blockAlign="start" gap="400" wrap={false}>
                <BlockStack gap="100">
                  <Text as="p" fontWeight="semibold">
                    {setting.label}
                  </Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {setting.helpText}
                  </Text>
                </BlockStack>

                <ToggleSwitch
                  checked={Boolean(form[setting.field])}
                  onChange={() => onChange(setting.field, !form[setting.field])}
                />
              </InlineStack>
            </Box>
          ))}
        </BlockStack>
      </BlockStack>
    </Card>
  );
}

function SummaryPreviewPanel({
  form,
  selectedCount,
  discountText,
  scheduleText,
  bannerPreview,
  bundlePreview,
  previewProducts = [],
  onStatusChange,
}) {
  const selectedEligibility = Array.isArray(form.eligibility)
    ? form.eligibility[0]
    : form.eligibility;
  const eligibilityLabel =
    CUSTOMER_ELIGIBILITY_OPTIONS.find((item) => item.value === selectedEligibility)
      ?.label || 'All Customers';

  return (
    <BlockStack gap="400">
      {onStatusChange ? (
        <StatusSummarySection
          status={form.status}
          onChange={onStatusChange}
        />
      ) : null}

      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Summary
          </Text>

          <Divider />

          <InlineStack align="space-between">
            <Text as="span" tone="subdued">
              Required product items
            </Text>
            <Text as="span" fontWeight="semibold">
              {form.productItems || '0'}
            </Text>
          </InlineStack>

          <InlineStack align="space-between">
            <Text as="span" tone="subdued">
              Available items
            </Text>
            <Text as="span" fontWeight="semibold">
              {selectedCount}
            </Text>
          </InlineStack>

          <InlineStack align="space-between">
            <Text as="span" tone="subdued">
              Discount
            </Text>
            <Text as="span" fontWeight="semibold">
              {discountText}
            </Text>
          </InlineStack>

          <InlineStack align="space-between">
            <Text as="span" tone="subdued">
              Customer Eligibility
            </Text>
            <Text as="span" fontWeight="semibold">
              {eligibilityLabel}
            </Text>
          </InlineStack>

          <BlockStack gap="100">
            <Text as="span" tone="subdued">
              Schedule
            </Text>
            <Text as="p" fontWeight="semibold">
              {scheduleText}
            </Text>
          </BlockStack>
        </BlockStack>
      </Card>

      <Card>
        <BlockStack gap="400">
          <Text as="h2" variant="headingMd">
            Preview
          </Text>

          <Divider />

          {bannerPreview ? (
            <Image source={bannerPreview} alt="Bundle banner preview" />
          ) : (
            <Box
              padding="600"
              background="bg-surface-secondary"
              borderRadius="300"
            >
              <BlockStack gap="200" inlineAlign="center">
                <Icon source={ImageIcon} />
                <Text as="p" tone="subdued">
                  Banner preview
                </Text>
              </BlockStack>
            </Box>
          )}

          <InlineStack gap="300" blockAlign="center" wrap={false}>
            <Thumbnail
              source={bundlePreview || ImageIcon}
              alt="Bundle preview"
              size="large"
            />

            <BlockStack gap="100">
              <Text as="h2" variant="headingLg">
                {form.title || 'Bundle title'}
              </Text>
              <Text as="p" tone="subdued">
                {form.description || 'Your bundle description will appear here.'}
              </Text>
            </BlockStack>
          </InlineStack>

          <Box
            padding="400"
            background="bg-surface-secondary"
            borderRadius="300"
          >
            <BlockStack gap="300">
              <BlockStack gap="100">
                <Text as="h3" variant="headingMd">
                  {form.stepTitle || 'Choose your products'}
                </Text>
                <Text as="p" tone="subdued">
                  {form.stepDescription || 'Step description'}
                </Text>
              </BlockStack>

              <ProductPreviewGrid
                products={previewProducts}
                maxItems={form.productItems}
              />
            </BlockStack>
          </Box>

          <Button variant="primary" fullWidth>
            {form.buttonLabel || 'Add bundle to cart'}
          </Button>
        </BlockStack>
      </Card>
    </BlockStack>
  );
}


function AccordionSection({
  id,
  title,
  description,
  open,
  onToggle,
  children,
}) {
  return (
    <Card padding="0">
      <Box padding="400">
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) 32px',
            gap: '12px',
            alignItems: 'center',
            width: '100%',
          }}
        >
          <BlockStack gap="100">
            <Text as="h2" variant="headingMd">
              {title}
            </Text>
            {description ? (
              <Text as="p" tone="subdued">
                {description}
              </Text>
            ) : null}
          </BlockStack>

          <Button
            variant="plain"
            icon={open ? ChevronUpIcon : ChevronDownIcon}
            onClick={() => onToggle(id)}
            accessibilityLabel={open ? `Collapse ${title}` : `Expand ${title}`}
            ariaExpanded={open}
            ariaControls={`${id}-content`}
          />
        </div>
      </Box>

      <Collapsible
        id={`${id}-content`}
        open={open}
        transition={{ duration: '200ms', timingFunction: 'ease-in-out' }}
        expandOnPrint
      >
        <Divider />
        <Box padding="400">{children}</Box>
      </Collapsible>
    </Card>
  );
}

function useFilePreview(file) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!file || typeof file === 'string') {
      setUrl(typeof file === 'string' ? file : '');
      return undefined;
    }

    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);

    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  return url;
}

function ImageUploader({ label, value, onChange, helpText }) {
  const previewUrl = useFilePreview(value);

  const handleDrop = useCallback(
    (_droppedFiles, acceptedFiles) => {
      onChange(acceptedFiles?.[0] ?? null);
    },
    [onChange],
  );

  return (
    <BlockStack gap="200">
      <Text as="p" variant="bodyMd" fontWeight="medium">
        {label}
      </Text>

      <DropZone
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        type="image"
        allowMultiple={false}
        onDrop={handleDrop}
      >
        {value ? (
          <Box padding="300">
            <InlineStack gap="300" blockAlign="center" wrap={false}>
              <Thumbnail
                source={previewUrl || ImageIcon}
                alt={value?.name || label}
                size="large"
              />

              <BlockStack gap="100">
                <Text as="p" fontWeight="semibold">
                  {value?.name || label}
                </Text>

                {value?.size ? (
                  <Text as="p" tone="subdued" variant="bodySm">
                    {(value.size / 1024).toFixed(1)} KB
                  </Text>
                ) : null}

                <Tooltip content={`Remove ${label}`}>
                  <Button
                    variant="plain"
                    tone="critical"
                    icon={DeleteIcon}
                    onClick={() => onChange(null)}
                  >
                    Remove
                  </Button>
                </Tooltip>
              </BlockStack>
            </InlineStack>
          </Box>
        ) : (
          <DropZone.FileUpload
            actionTitle={`Upload ${label}`}
            actionHint="PNG, JPG, WEBP or SVG"
          />
        )}
      </DropZone>
    </BlockStack>
  );
}

function mergeUniqueItems(currentItems, nextItems) {
  const seen = new Set(currentItems.map((item) => item.id));
  const merged = [...currentItems];

  for (const item of nextItems || []) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

function useInfinitePickerPagination({
  resource,
  initialItems,
  initialPageInfo,
  open,
}) {
  const fetcher = useFetcher();
  const pendingCursorRef = useRef(null);
  const initialRequestRef = useRef(false);
  const [items, setItems] = useState(initialItems || []);
  const [pageInfo, setPageInfo] = useState(initialPageInfo || EMPTY_PAGE_INFO);
  const [error, setError] = useState('');

  useEffect(() => {
    setItems(initialItems || []);
    setPageInfo(initialPageInfo || EMPTY_PAGE_INFO);
    setError('');
    pendingCursorRef.current = null;
    initialRequestRef.current = false;
  }, [initialItems, initialPageInfo]);

  useEffect(() => {
    if (!fetcher.data || fetcher.data.resource !== resource) return;

    pendingCursorRef.current = null;
    initialRequestRef.current = true;

    if (fetcher.data.error) {
      setError(fetcher.data.error);
      return;
    }

    setError('');
    setItems((current) => mergeUniqueItems(current, fetcher.data.items || []));
    setPageInfo(fetcher.data.pageInfo || EMPTY_PAGE_INFO);
  }, [fetcher.data, resource]);

  const loadingMore = fetcher.state !== 'idle';
  const hasNextPage = Boolean(pageInfo?.hasNextPage);

  const loadFirstPage = useCallback(() => {
    if (!open || loadingMore || initialRequestRef.current) {
      return;
    }

    initialRequestRef.current = true;
    pendingCursorRef.current = null;
    setError('');

    const params = new URLSearchParams({
      pickerResource: resource,
    });

    fetcher.load(`/app/simple?${params.toString()}`);
  }, [fetcher, loadingMore, open, resource]);

  useEffect(() => {
    if (open && !items.length) {
      loadFirstPage();
    }
  }, [items.length, loadFirstPage, open]);

  const loadMore = useCallback(() => {
    const after = pageInfo?.endCursor;

    if (
      !open ||
      loadingMore ||
      !hasNextPage ||
      !after ||
      pendingCursorRef.current === after
    ) {
      return;
    }

    pendingCursorRef.current = after;
    setError('');

    const params = new URLSearchParams({
      pickerResource: resource,
      after,
    });

    fetcher.load(`/app/simple?${params.toString()}`);
  }, [fetcher, hasNextPage, loadingMore, open, pageInfo?.endCursor, resource]);

  return {
    items,
    pageInfo,
    error,
    loadingMore,
    hasNextPage,
    loadFirstPage,
    loadMore,
  };
}

function PickerModal({
  open,
  title,
  items,
  loadingMore,
  error,
  selectedIds,
  onLoadMore,
  onClose,
  onSave,
  type,
  multiple = true,
}) {
  const [query, setQuery] = useState('');
  const [draftSelected, setDraftSelected] = useState(selectedIds);
  const initialLoading = loadingMore && !items.length;

  useEffect(() => {
    if (open) {
      setDraftSelected(selectedIds);
      setQuery('');
    }
  }, [open, selectedIds]);

  const filteredItems = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return items;

    return items.filter((item) =>
      String(item.title || '').toLowerCase().includes(search),
    );
  }, [items, query]);

  const toggleItem = useCallback((id) => {
    setDraftSelected((current) => {
      if (!multiple) return current.includes(id) ? [] : [id];

      return current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id];
    });
  }, [multiple]);

  const handleClose = useCallback(() => {
    setDraftSelected(selectedIds);
    setQuery('');
    onClose();
  }, [onClose, selectedIds]);

  const handleScroll = useCallback(
    (event) => {
      const target = event.currentTarget;
      const distanceFromBottom =
        target.scrollHeight - target.scrollTop - target.clientHeight;

      if (distanceFromBottom <= 80) {
        onLoadMore?.();
      }
    },
    [onLoadMore],
  );

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={title}
      primaryAction={{
        content: multiple ? `Add selected ${type}` : 'Add selected product',
        onAction: () => {
          onSave(draftSelected);
          setQuery('');
        },
      }}
      secondaryActions={[{ content: 'Cancel', onAction: handleClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <style>
            {`
              .simple-picker-scroll {
                scrollbar-width: none;
                -ms-overflow-style: none;
              }

              .simple-picker-scroll::-webkit-scrollbar {
                display: none;
              }
            `}
          </style>
          <TextField
            label={`Search ${type}`}
            labelHidden
            prefix={<Icon source={SearchIcon} />}
            placeholder={`Search ${type}...`}
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />

          <div
            className="simple-picker-scroll"
            onScroll={handleScroll}
            style={{
              maxHeight: 'min(68vh, 640px)',
              minHeight: 520,
              overflowY: 'auto',
              paddingRight: 0,
            }}
          >
            <BlockStack gap="300">
              {initialLoading ? (
                <Box padding="800">
                  <InlineStack align="center">
                    <Spinner accessibilityLabel={`Loading ${type}`} size="small" />
                  </InlineStack>
                </Box>
              ) : filteredItems.length ? (
                <ResourceList
                  resourceName={{
                    singular: type === 'products' ? 'product' : 'collection',
                    plural: type,
                  }}
                  items={filteredItems}
                  renderItem={(item) => {
                    const selected = draftSelected.includes(item.id);

                    return (
                      <ResourceItem
                        id={item.id}
                        accessibilityLabel={`Select ${item.title}`}
                        onClick={() => toggleItem(item.id)}
                        media={
                          <Thumbnail
                            source={
                              item.image ||
                              (type === 'products' ? ProductIcon : CollectionIcon)
                            }
                            alt={item.title}
                            size="small"
                          />
                        }
                      >
                        <InlineStack
                          align="space-between"
                          blockAlign="center"
                          wrap={false}
                        >
                          <BlockStack gap="050">
                            <Text as="h3" variant="bodyMd" fontWeight="semibold">
                              {item.title}
                            </Text>
                            {item.subtitle ? (
                              <Text as="p" tone="subdued">
                                {item.subtitle}
                              </Text>
                            ) : null}
                          </BlockStack>

                          <Checkbox
                            label={`Select ${item.title}`}
                            labelHidden
                            checked={selected}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => toggleItem(item.id)}
                          />
                        </InlineStack>
                      </ResourceItem>
                    );
                  }}
                />
              ) : (
                <EmptyState heading={`No ${type} found`} image="">
                  <Text as="p">Try another search term.</Text>
                </EmptyState>
              )}

              {error ? (
                <Text as="p" tone="critical">
                  {error}
                </Text>
              ) : null}

              {loadingMore && items.length ? (
                <Box padding="400">
                  <InlineStack align="center">
                    <Spinner accessibilityLabel={`Loading more ${type}`} size="small" />
                  </InlineStack>
                </Box>
              ) : null}
            </BlockStack>
          </div>
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function csvToList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function listToCsv(values) {
  return values.filter(Boolean).join(', ');
}

function CustomerTagsModal({ open, tags, selectedTags, onClose, onSave }) {
  const [query, setQuery] = useState('');
  const [draftSelected, setDraftSelected] = useState(selectedTags);

  useEffect(() => {
    if (open) {
      setDraftSelected(selectedTags);
      setQuery('');
    }
  }, [open, selectedTags]);

  const filteredTags = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return tags;

    return tags.filter((tag) =>
      tag.label.toLowerCase().includes(search),
    );
  }, [query, tags]);

  const toggleTag = useCallback((value) => {
    setDraftSelected((current) =>
      current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value],
    );
  }, []);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select Customer Tags"
      primaryAction={{
        content: 'Done',
        onAction: () => onSave(draftSelected),
      }}
      secondaryActions={[{ content: 'Close', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label="Search customer by tag"
            labelHidden
            prefix={<Icon source={SearchIcon} />}
            placeholder="Search customer by tag"
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />

          {filteredTags.length ? (
            <BlockStack gap="300">
              {filteredTags.map((tag) => (
                <Checkbox
                  key={tag.value}
                  label={tag.label}
                  checked={draftSelected.includes(tag.value)}
                  onChange={() => toggleTag(tag.value)}
                />
              ))}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">
              No customer tags found.
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function CustomerAvatar({ name, color }) {
  const initial = String(name || '?').trim().charAt(0).toUpperCase();

  return (
    <div
      aria-hidden="true"
      style={{
        width: 50,
        height: 50,
        borderRadius: 8,
        background: color,
        border: '1px solid rgba(0, 0, 0, 0.12)',
        display: 'grid',
        placeItems: 'center',
        color: '#0f766e',
        fontSize: 22,
        fontWeight: 700,
      }}
    >
      {initial}
    </div>
  );
}

function CustomersModal({ open, customers, selectedCustomers, onClose, onSave }) {
  const [query, setQuery] = useState('');
  const [draftSelected, setDraftSelected] = useState(selectedCustomers);

  useEffect(() => {
    if (open) {
      setDraftSelected(selectedCustomers);
      setQuery('');
    }
  }, [open, selectedCustomers]);

  const filteredCustomers = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return customers;

    return customers.filter((customer) =>
      `${customer.name} ${customer.email} ${(customer.tags || []).join(' ')}`
        .toLowerCase()
        .includes(search),
    );
  }, [customers, query]);

  const selectedCustomerIds = useMemo(
    () => new Set(draftSelected),
    [draftSelected],
  );
  const allVisibleSelected =
    filteredCustomers.length > 0 &&
    filteredCustomers.every((customer) => selectedCustomerIds.has(customer.id));

  const toggleCustomer = useCallback((id) => {
    setDraftSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  }, []);

  const toggleVisibleCustomers = useCallback(() => {
    const visibleIds = filteredCustomers.map((customer) => customer.id);
    setDraftSelected((current) => {
      if (visibleIds.every((id) => current.includes(id))) {
        return current.filter((id) => !visibleIds.includes(id));
      }

      return [...new Set([...current, ...visibleIds])];
    });
  }, [filteredCustomers]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Select Customers"
      primaryAction={{
        content: 'Done',
        onAction: () => onSave(draftSelected),
      }}
      secondaryActions={[{ content: 'Close', onAction: onClose }]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label="Search customer by email or tag"
            labelHidden
            prefix={<Icon source={SearchIcon} />}
            placeholder="Search customer by email or tag"
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />

          {filteredCustomers.length ? (
            <BlockStack gap="0">
              <Box paddingBlockEnd="300">
                <Checkbox
                  label="Check All"
                  checked={allVisibleSelected}
                  onChange={toggleVisibleCustomers}
                />
              </Box>
              <Divider />

              {filteredCustomers.map((customer) => (
                <Box key={customer.id} paddingBlock="300">
                  <InlineStack gap="300" blockAlign="center" wrap={false}>
                    <Checkbox
                      label={`Select ${customer.name}`}
                      labelHidden
                      checked={selectedCustomerIds.has(customer.id)}
                      onChange={() => toggleCustomer(customer.id)}
                    />
                    <CustomerAvatar name={customer.name} color={customer.color} />
                    <BlockStack gap="050">
                      <Text as="span" fontWeight="semibold">
                        {customer.name}
                      </Text>
                      <Text as="span" tone="subdued">
                        {customer.email || 'No email'}
                      </Text>
                    </BlockStack>
                  </InlineStack>
                  <Box paddingBlockStart="300">
                    <Divider />
                  </Box>
                </Box>
              ))}
            </BlockStack>
          ) : (
            <Text as="p" tone="subdued">
              No customers found.
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function getCustomerSelectionLabel(selectedCustomers, customers) {
  const labelById = new Map(
    customers.map((customer) => [
      customer.id,
      customer.email || customer.name || customer.id,
    ]),
  );

  return listToCsv(
    selectedCustomers.map((id) => labelById.get(id) || id),
  );
}

function SelectedItems({ items, selectedIds, onRemove, type }) {
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));

  if (!selectedItems.length) {
    return null;
  }

  return (
    <ResourceList
      resourceName={{ singular: 'item', plural: 'items' }}
      items={selectedItems}
      renderItem={(item) => (
        <ResourceItem
          id={item.id}
          media={
            <Thumbnail
              source={
                item.image || (type === 'products' ? ProductIcon : CollectionIcon)
              }
              alt={item.title}
              size="small"
            />
          }
          accessibilityLabel={item.title}
        >
          <InlineStack align="space-between" blockAlign="center" wrap={false}>
            <BlockStack gap="050">
              <Text as="p" fontWeight="semibold">
                {item.title}
              </Text>
              {item.subtitle ? (
                <Text as="p" tone="subdued" variant="bodySm">
                  {item.subtitle}
                </Text>
              ) : null}
            </BlockStack>

            <Tooltip content={`Remove ${item.title}`}>
              <Button
                variant="plain"
                tone="critical"
                icon={DeleteIcon}
                onClick={() => onRemove(item.id)}
                accessibilityLabel={`Remove ${item.title}`}
              />
            </Tooltip>
          </InlineStack>
        </ResourceItem>
      )}
    />
  );
}
export default function EditSingleMixMatchBundlePage() {
  const {
    initialData,
    products: propProducts = EMPTY_ITEMS,
    collections: propCollections = EMPTY_ITEMS,
  } = useLoaderData();
  const { id } = useParams();
  const loaderData = useLoaderData() || {};
  const location = useLocation();
  const navigate = useNavigate();
  const customerOptions = loaderData.customers || [];
  const customerTagOptions = loaderData.customerTags || [];
  const initialProducts = useMemo(
    () => (propProducts.length ? propProducts : loaderData.products || []),
    [loaderData.products, propProducts],
  );
  const initialCollections = useMemo(
    () =>
      propCollections.length
        ? propCollections
        : loaderData.collections || [],
    [loaderData.collections, propCollections],
  );
  const initialProductsPageInfo = propProducts.length
    ? EMPTY_PAGE_INFO
    : loaderData.productsPageInfo || EMPTY_PAGE_INFO;
  const initialCollectionsPageInfo = propCollections.length
    ? EMPTY_PAGE_INFO
    : loaderData.collectionsPageInfo || EMPTY_PAGE_INFO;
  const currentSchedule = useMemo(() => getCurrentDateTimeInput(), []);
  const minScheduleDate = currentSchedule.date;
  const handleBack = useCallback(() => {
    navigate(withEmbeddedAppParams('/app/boxes', location.search));
  }, [location.search, navigate]);

  const [form, setForm] = useState({
    status: initialData?.status || 'active',
    boxCode: initialData?.boxCode || '',
    title: initialData?.title || '',
    description: initialData?.description || '',
    bundleImage: initialData?.bundleImage || null,
    bannerImage: initialData?.bannerImage || null,
    stepTitle: initialData?.stepTitle || 'Choose your products',
    stepDescription:
      initialData?.stepDescription ||
      'Select products to create your custom bundle.',
    productItems: initialData?.productItems || '3',
    buttonLabel: initialData?.buttonLabel || 'Add bundle to cart',
    discountMode:
      initialData?.discountMode ||
      (initialData?.discountType && initialData.discountType !== 'fixed_bundle_price'
        ? 'flat_discount'
        : 'fixed_amount'),
    discountType:
      initialData?.discountType && initialData.discountType !== 'fixed_bundle_price'
        ? initialData.discountType
        : 'percentage',
    discountValue: initialData?.discountValue || '',
    productConfiguration:
      initialData?.productConfiguration || 'whole_store',
    scheduleType: initialData?.scheduleType || 'immediately',
    startDate: clampDateInput(initialData?.startDate, minScheduleDate) || minScheduleDate,
    startTime: initialData?.startTime || currentSchedule.time,
    hasEndDate: initialData?.hasEndDate || false,
    endDate: initialData?.endDate
      ? clampDateInput(initialData.endDate, initialData?.startDate || minScheduleDate)
      : '',
    endTime: initialData?.endTime || '',
    eligibility: initialData?.eligibility || ['all'],
    customerTags: initialData?.customerTags || '',
    customers: initialData?.customers || '',
    hideOutOfStockProducts: Boolean(initialData?.hideOutOfStockProducts),
    showProductSearch: Boolean(initialData?.showProductSearch),
    hideBundleHeader: Boolean(initialData?.hideBundleHeader),
    hideBannerImage: Boolean(initialData?.hideBannerImage),
    hideProductInfoModal: Boolean(initialData?.hideProductInfoModal),
    productImageAutoHeight: Boolean(initialData?.productImageAutoHeight),
    displayCompareAtPrice: Boolean(initialData?.displayCompareAtPrice),
    redirectToCheckout: Boolean(initialData?.redirectToCheckout),
    redirectToCart: Boolean(initialData?.redirectToCart),
  });

  const [openSections, setOpenSections] = useState({
    bundleInformation: true,
    configureBundle: true,
    discount: false,
    productConfiguration: false,
    customerEligibility: false,
    schedule: false,
  });

  const [selectedProductIds, setSelectedProductIds] = useState(
    initialData?.selectedProductIds || [],
  );
  const [selectedCollectionIds, setSelectedCollectionIds] = useState(
    initialData?.selectedCollectionIds || [],
  );
  const [selectedGiftProductIds, setSelectedGiftProductIds] = useState(
    initialData?.selectedGiftProductIds || [],
  );
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [giftProductModalOpen, setGiftProductModalOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [customerTagsModalOpen, setCustomerTagsModalOpen] = useState(false);
  const [customersModalOpen, setCustomersModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [selectedTab, setSelectedTab] = useState(0);
  const [designSettings, setDesignSettings] = useState({
    ...DEFAULT_DESIGN_SETTINGS,
    ...(initialData?.designSettings || {}),
  });
  const productPicker = useInfinitePickerPagination({
    resource: 'products',
    initialItems: initialProducts,
    initialPageInfo: initialProductsPageInfo,
    open: productModalOpen || giftProductModalOpen,
  });
  const collectionPicker = useInfinitePickerPagination({
    resource: 'collections',
    initialItems: initialCollections,
    initialPageInfo: initialCollectionsPageInfo,
    open: collectionModalOpen,
  });
  const products = productPicker.items;
  const collections = collectionPicker.items;

  const bannerPreview = useFilePreview(form.bannerImage);
  const bundlePreview = useFilePreview(form.bundleImage);
  const customerDisplayValue = useMemo(
    () =>
      getCustomerSelectionLabel(csvToList(form.customers), customerOptions),
    [customerOptions, form.customers],
  );
  const boxCodeError = getBoxCodeValidationError(form.boxCode);

  const setField = useCallback((field, value) => {
    setForm((current) => {
      if (field === 'scheduleType' && value === 'scheduled') {
        return {
          ...current,
          scheduleType: value,
          startDate: clampDateInput(current.startDate, minScheduleDate) || minScheduleDate,
          startTime: current.startTime || currentSchedule.time,
        };
      }

      if (field === 'startDate') {
        const startDate = clampDateInput(value, minScheduleDate) || minScheduleDate;
        return {
          ...current,
          startDate,
          endDate: current.endDate ? clampDateInput(current.endDate, startDate) : current.endDate,
        };
      }

      if (field === 'endDate') {
        const minEndDate = current.startDate || minScheduleDate;
        return { ...current, endDate: clampDateInput(value, minEndDate) };
      }

      return { ...current, [field]: value };
    });
  }, [currentSchedule.time, minScheduleDate]);

  const setDesignField = useCallback((field, value) => {
    setDesignSettings((current) => ({ ...current, [field]: value }));
  }, []);

  const toggleSection = useCallback((sectionId) => {
    setOpenSections((current) => ({
      ...current,
      [sectionId]: !current[sectionId],
    }));
  }, []);

  const selectedCount = useMemo(() => {
    if (form.productConfiguration === 'selected_products') {
      return selectedProductIds.length;
    }

    if (form.productConfiguration === 'selected_collections') {
      return selectedCollectionIds.length;
    }

    return products.length;
  }, [
    form.productConfiguration,
    products.length,
    selectedCollectionIds.length,
    selectedProductIds.length,
  ]);

  const previewProducts = useMemo(
    () =>
      getConfiguredProducts({
        productConfiguration: form.productConfiguration,
        products,
        collections,
        selectedProductIds,
        selectedCollectionIds,
      }),
    [
      collections,
      form.productConfiguration,
      products,
      selectedCollectionIds,
      selectedProductIds,
    ],
  );

  const discountText = useMemo(() => {
    const value = form.discountValue || '0';

    if (form.discountMode === 'free_gift_product') {
      const giftProduct = products.find((product) =>
        selectedGiftProductIds.includes(product.id),
      );
      return giftProduct ? `Free gift: ${giftProduct.title}` : 'Free gift product';
    }

    if (form.discountMode === 'flat_discount') {
      if (form.discountType === 'percentage') return `${value}% off`;
      if (form.discountType === 'fixed_amount') return `$${value} off`;
    }

    return `$${value} fixed amount`;
  }, [
    form.discountMode,
    form.discountType,
    form.discountValue,
    products,
    selectedGiftProductIds,
  ]);

  const scheduleText = useMemo(() => {
    if (form.scheduleType === 'immediately') return 'Publish immediately';

    if (!form.startDate) return 'Schedule not completed';

    const start = [form.startDate, form.startTime].filter(Boolean).join(' ');
    const end = form.hasEndDate
      ? [form.endDate, form.endTime].filter(Boolean).join(' ')
      : '';

    return end ? `${start} to ${end}` : `Starts ${start}`;
  }, [
    form.endDate,
    form.endTime,
    form.hasEndDate,
    form.scheduleType,
    form.startDate,
    form.startTime,
  ]);

  const handleSubmit = useCallback(async () => {
    const codeError = getBoxCodeValidationError(form.boxCode);
    if (codeError) {
      setSubmitError(codeError);
      setOpenSections((current) => ({ ...current, bundleInformation: true }));
      return;
    }

    try {
      setSaving(true);
      setSubmitError('');
      const submission = {
        ...form,
        boxCode: normalizeBoxCode(form.boxCode),
        ...getDiscountSubmissionFields(form, selectedGiftProductIds),
        selectedProductIds,
        selectedCollectionIds,
        selectedGiftProductIds,
      };

      const title = form.title?.trim() || 'Mix n Match Bundle';
      const response = await fetch(`/api/admin/boxes/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...submission,
          boxName: title,
          displayTitle: title,
          itemCount: form.productItems || '1',
          bundlePrice: form.discountMode === 'fixed_amount' ? form.discountValue || '0' : '0',
        }),
      });
      if (!response.ok) {
        const json = await response.json().catch(() => null);
        throw new Error(json?.error || 'Failed to save bundle');
      }
      navigate(withEmbeddedAppParams('/app/boxes', location.search));
    } catch (error) {
      setSubmitError(error?.message || 'Failed to save bundle');
    } finally {
      setSaving(false);
    }
  }, [
    form,
    id,
    location.search,
    navigate,
    selectedCollectionIds,
    selectedGiftProductIds,
    selectedProductIds,
  ]);

  return (
    <Page
      title="Edit Single Mix & Match Bundle"
      paddingBlockEnd="800"
      backAction={{ content: 'Boxes', onAction: handleBack }}
      primaryAction={{
        content: 'Save Bundle',
        onAction: handleSubmit,
        loading: saving,
      }}
    >
      <Form onSubmit={handleSubmit}>
        <BlockStack gap="400">
          {submitError ? (
            <Banner tone="critical">
              <p>{submitError}</p>
            </Banner>
          ) : null}

          <FormTabs selected={selectedTab} onSelect={setSelectedTab} />

          {selectedTab === 0 ? (
            <BlockStack gap="400">
              <Grid>
                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 8, xl: 8 }}>
                  <BlockStack gap="200" paddingBlockEnd="800">
                    <AccordionSection
                      id="bundleInformation"
                      title="Bundle Information"
                      description="Enter the main bundle details and images."
                      open={openSections.bundleInformation}
                      onToggle={toggleSection}
                    >
                      <BundleInformationSection
                        form={form}
                        onChange={setField}
                        boxCodeError={boxCodeError}
                      />
                    </AccordionSection>
                    <AccordionSection
                      id="configureBundle"
                      title="Configure Bundle"
                      description="Configure the customer selection step."
                      open={openSections.configureBundle}
                      onToggle={toggleSection}
                    >
                      <BlockStack gap="400">
                        <TextField
                          label="Step Title"
                          value={form.stepTitle}
                          onChange={(value) => setField('stepTitle', value)}
                          autoComplete="off"
                        />

                        <TextField
                          label="Step Description"
                          value={form.stepDescription}
                          onChange={(value) => setField('stepDescription', value)}
                          multiline={3}
                          autoComplete="off"
                        />

                        <TextField
                          label="Product Items"
                          type="number"
                          min={1}
                          value={form.productItems}
                          onChange={(value) => setField('productItems', value)}
                          helpText="Number of products the customer must select."
                          autoComplete="off"
                        />

                        <TextField
                          label="Button Label"
                          value={form.buttonLabel}
                          onChange={(value) => setField('buttonLabel', value)}
                          autoComplete="off"
                        />
                      </BlockStack>
                    </AccordionSection>

                    <AccordionSection
                      id="discount"
                      title="Discount"
                      description="Choose how the bundle price or discount is calculated."
                      open={openSections.discount}
                      onToggle={toggleSection}
                    >
                      <BlockStack gap="400">
                        <ChoiceList
                          title="Discount mode"
                          titleHidden
                          choices={DISCOUNT_MODE_OPTIONS}
                          selected={[form.discountMode]}
                          onChange={(value) => setField('discountMode', value[0])}
                        />

                        {form.discountMode === 'fixed_amount' ? (
                          <TextField
                            label="Fixed Amount"
                            type="number"
                            min={0}
                            value={form.discountValue}
                            onChange={(value) => setField('discountValue', value)}
                            prefix="$"
                            placeholder="0"
                            autoComplete="off"
                          />
                        ) : null}

                        {form.discountMode === 'flat_discount' ? (
                          <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                            <Select
                              label="Discount Type"
                              options={DISCOUNT_OPTIONS}
                              value={form.discountType}
                              onChange={(value) => setField('discountType', value)}
                            />

                            <TextField
                              label="Value"
                              type="number"
                              min={0}
                              value={form.discountValue}
                              onChange={(value) => setField('discountValue', value)}
                              prefix={form.discountType === 'percentage' ? undefined : '$'}
                              suffix={form.discountType === 'percentage' ? '%' : undefined}
                              placeholder="0"
                              autoComplete="off"
                            />
                          </InlineGrid>
                        ) : null}

                        {form.discountMode === 'free_gift_product' ? (
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingSm">
                                Free gift product
                              </Text>
                              <Button
                                icon={PlusIcon}
                                onClick={() => setGiftProductModalOpen(true)}
                              >
                                Add Product
                              </Button>
                            </InlineStack>
                            <SelectedItems
                              type="products"
                              items={products}
                              selectedIds={selectedGiftProductIds}
                              onRemove={(id) =>
                                setSelectedGiftProductIds((current) =>
                                  current.filter((currentId) => currentId !== id),
                                )
                              }
                            />
                          </BlockStack>
                        ) : null}
                      </BlockStack>
                    </AccordionSection>

                    <AccordionSection
                      id="productConfiguration"
                      title="Product Configuration"
                      description="Choose which store items customers can add to this bundle."
                      open={openSections.productConfiguration}
                      onToggle={toggleSection}
                    >
                      <BlockStack gap="400">
                        <ChoiceList
                          title="Product source"
                          titleHidden
                          choices={PRODUCT_CONFIGURATION_OPTIONS}
                          selected={[form.productConfiguration]}
                          onChange={(value) =>
                            setField('productConfiguration', value[0])
                          }
                        />

                        {form.productConfiguration === 'selected_products' ? (
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingSm">
                                Selected products
                              </Text>

                              <Tooltip content="Open product selector">
                                <Button
                                  icon={PlusIcon}
                                  onClick={() => setProductModalOpen(true)}
                                >
                                  Add Products
                                </Button>
                              </Tooltip>
                            </InlineStack>

                            <SelectedItems
                              type="products"
                              items={products}
                              selectedIds={selectedProductIds}
                              onRemove={(id) =>
                                setSelectedProductIds((current) =>
                                  current.filter((currentId) => currentId !== id),
                                )
                              }
                            />
                          </BlockStack>
                        ) : null}

                        {form.productConfiguration === 'selected_collections' ? (
                          <BlockStack gap="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <Text as="h3" variant="headingSm">
                                Selected collections
                              </Text>

                              <Tooltip content="Open collection selector">
                                <Button
                                  icon={PlusIcon}
                                  onClick={() => setCollectionModalOpen(true)}
                                >
                                  Add Collections
                                </Button>
                              </Tooltip>
                            </InlineStack>

                            <SelectedItems
                              type="collections"
                              items={collections}
                              selectedIds={selectedCollectionIds}
                              onRemove={(id) =>
                                setSelectedCollectionIds((current) =>
                                  current.filter((currentId) => currentId !== id),
                                )
                              }
                            />
                          </BlockStack>
                        ) : null}
                      </BlockStack>
                    </AccordionSection>

                    <AccordionSection
                      id="customerEligibility"
                      title="Customer Eligibility"
                      description="Choose who can see the product."
                      open={openSections.customerEligibility}
                      onToggle={toggleSection}
                    >
                      <CustomerEligibilitySection
                        form={form}
                        onChange={setField}
                        onBrowseTags={() => setCustomerTagsModalOpen(true)}
                        onBrowseCustomers={() => setCustomersModalOpen(true)}
                        customerDisplayValue={customerDisplayValue}
                      />
                    </AccordionSection>

                    <AccordionSection
                      id="schedule"
                      title="Schedule"
                      description="Publish immediately or schedule the bundle for a date and time."
                      open={openSections.schedule}
                      onToggle={toggleSection}
                      paddingBottom="400"
                    >
                      <BlockStack gap="400">
                        <ChoiceList
                          title="Publishing schedule"
                          titleHidden
                          choices={SCHEDULE_OPTIONS}
                          selected={[form.scheduleType]}
                          onChange={(value) => setField('scheduleType', value[0])}
                        />

                        {form.scheduleType === 'scheduled' ? (
                          <BlockStack gap="400">
                            <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                              <TextField
                                label="Start Date"
                                type="date"
                                value={form.startDate}
                                onChange={(value) => setField('startDate', value)}
                                min={minScheduleDate}
                                prefix={<Icon source={CalendarIcon} />}
                                autoComplete="off"
                              />

                              <TextField
                                label="Start Time"
                                type="time"
                                value={form.startTime}
                                onChange={(value) => setField('startTime', value)}
                                autoComplete="off"
                              />
                            </InlineGrid>

                            <Checkbox
                              label="Set an end date"
                              checked={form.hasEndDate}
                              onChange={(value) => setField('hasEndDate', value)}
                              helpText="The bundle becomes unavailable after the end date and time."
                            />

                            {form.hasEndDate ? (
                              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                                <TextField
                                  label="End Date"
                                  type="date"
                                  value={form.endDate}
                                  onChange={(value) => setField('endDate', value)}
                                  min={form.startDate || minScheduleDate}
                                  prefix={<Icon source={CalendarIcon} />}
                                  autoComplete="off"
                                />

                                <TextField
                                  label="End Time"
                                  type="time"
                                  value={form.endTime}
                                  onChange={(value) => setField('endTime', value)}
                                  autoComplete="off"
                                />
                              </InlineGrid>
                            ) : null}
                          </BlockStack>
                        ) : null}
                      </BlockStack>
                    </AccordionSection>
                  </BlockStack>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 4, xl: 4 }}>
                  <SummaryPreviewPanel
                    form={form}
                    selectedCount={selectedCount}
                    discountText={discountText}
                    scheduleText={scheduleText}
                    bannerPreview={bannerPreview}
                    bundlePreview={bundlePreview}
                    previewProducts={previewProducts}
                    onStatusChange={(value) => setField('status', value)}
                  />
                </Grid.Cell>
              </Grid>
            </BlockStack>
          ) : null}

          {selectedTab === 1 ? (
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 8, xl: 8 }}>
                <DesignTabPanel
                  settings={designSettings}
                  onChange={setDesignField}
                  onBack={() => setSelectedTab(0)}
                  onNext={() => setSelectedTab(2)}
                />
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 4, xl: 4 }}>
                <SummaryPreviewPanel
                  form={form}
                  selectedCount={selectedCount}
                  discountText={discountText}
                  scheduleText={scheduleText}
                  bannerPreview={bannerPreview}
                  bundlePreview={bundlePreview}
                  previewProducts={previewProducts}
                  onStatusChange={(value) => setField('status', value)}
                />
              </Grid.Cell>
            </Grid>
          ) : null}

          {selectedTab === 2 ? (
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 8, xl: 8 }}>
                <AdvancedTabPanel form={form} onChange={setField} />
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 4, xl: 4 }}>
                <SummaryPreviewPanel
                  form={form}
                  selectedCount={selectedCount}
                  discountText={discountText}
                  scheduleText={scheduleText}
                  bannerPreview={bannerPreview}
                  bundlePreview={bundlePreview}
                  previewProducts={previewProducts}
                  onStatusChange={(value) => setField('status', value)}
                />
              </Grid.Cell>
            </Grid>
          ) : null}
        </BlockStack>
      </Form>

      <PickerModal
        open={productModalOpen}
        title="Add Products"
        items={products}
        loadingMore={productPicker.loadingMore}
        error={productPicker.error}
        selectedIds={selectedProductIds}
        onLoadMore={productPicker.loadMore}
        onClose={() => setProductModalOpen(false)}
        onSave={(ids) => {
          setSelectedProductIds(ids);
          setProductModalOpen(false);
        }}
        type="products"
      />

      <PickerModal
        open={giftProductModalOpen}
        title="Add Free Gift Product"
        items={products}
        loadingMore={productPicker.loadingMore}
        error={productPicker.error}
        selectedIds={selectedGiftProductIds}
        onLoadMore={productPicker.loadMore}
        onClose={() => setGiftProductModalOpen(false)}
        onSave={(ids) => {
          setSelectedGiftProductIds(ids.slice(0, 1));
          setGiftProductModalOpen(false);
        }}
        type="products"
        multiple={false}
      />

      <PickerModal
        open={collectionModalOpen}
        title="Add Collections"
        items={collections}
        loadingMore={collectionPicker.loadingMore}
        error={collectionPicker.error}
        selectedIds={selectedCollectionIds}
        onLoadMore={collectionPicker.loadMore}
        onClose={() => setCollectionModalOpen(false)}
        onSave={(ids) => {
          setSelectedCollectionIds(ids);
          setCollectionModalOpen(false);
        }}
        type="collections"
      />

      <CustomerTagsModal
        open={customerTagsModalOpen}
        tags={customerTagOptions}
        selectedTags={csvToList(form.customerTags)}
        onClose={() => setCustomerTagsModalOpen(false)}
        onSave={(tags) => {
          setField('customerTags', listToCsv(tags));
          setCustomerTagsModalOpen(false);
        }}
      />

      <CustomersModal
        open={customersModalOpen}
        customers={customerOptions}
        selectedCustomers={csvToList(form.customers)}
        onClose={() => setCustomersModalOpen(false)}
        onSave={(customers) => {
          setField('customers', listToCsv(customers));
          setCustomersModalOpen(false);
        }}
      />
    </Page>
  );
}