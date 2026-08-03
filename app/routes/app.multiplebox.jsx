import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetcher, useLoaderData, useLocation, useNavigate } from 'react-router';
import {
  Badge,
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
  PackageIcon,
  PlusIcon,
  ProductIcon,
  SearchIcon,
} from '@shopify/polaris-icons';
import { authenticate } from '../shopify.server';
import { withEmbeddedAppParams } from '../utils/embedded-app';

const CUSTOMERS_QUERY = `#graphql
  query SimpleBundleCustomers($first: Int!) {
    customers(first: $first, sortKey: UPDATED_AT, reverse: true) {
      nodes {
        id
        firstName
        lastName
        displayName
        tags
        defaultEmailAddress {
          emailAddress
        }
      }
    }
  }
`;

const PICKER_PAGE_SIZE = 10;

const EMPTY_PAGE_INFO = {
  hasNextPage: false,
  endCursor: null,
};
const EMPTY_ITEMS = [];

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

function colorFromString(value) {
  const colors = ['#6ee7df', '#f0abfc', '#f5b5f1', '#bae6fd', '#34d399', '#5eead4'];
  const text = String(value || '');
  const total = Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);

  return colors[total % colors.length];
}

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

function createQuantityPack(index, overrides = {}) {
  return {
    id: overrides.id || `pack-${Date.now()}-${index + 1}`,
    title: overrides.title || `Pack ${index + 1}`,
    stepTitle: overrides.stepTitle || 'Choose your products',
    stepDescription:
      overrides.stepDescription ||
      'Select products to create your custom bundle.',
    productItems: overrides.productItems || '3',
    buttonLabel: overrides.buttonLabel || 'Add bundle to cart',
    discountType: overrides.discountType || 'fixed_bundle_price',
    discountValue: overrides.discountValue || '',
    productConfiguration: overrides.productConfiguration || 'whole_store',
    scheduleType: overrides.scheduleType || 'immediately',
    startDate: overrides.startDate || '',
    startTime: overrides.startTime || '',
    hasEndDate: overrides.hasEndDate || false,
    endDate: overrides.endDate || '',
    endTime: overrides.endTime || '',
    selectedProductIds: overrides.selectedProductIds || [],
    selectedCollectionIds: overrides.selectedCollectionIds || [],
  };
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

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
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

  try {
    const [customersResponse, productsResponse, collectionsResponse] =
      await Promise.all([
        admin.graphql(CUSTOMERS_QUERY, { variables: { first: 100 } }),
        admin.graphql(PRODUCTS_QUERY, {
          variables: { first: PICKER_PAGE_SIZE, after: null },
        }),
        admin.graphql(COLLECTIONS_QUERY, {
          variables: { first: PICKER_PAGE_SIZE, after: null },
        }),
      ]);
    const [customersJson, productsJson, collectionsJson] = await Promise.all([
      customersResponse.json(),
      productsResponse.json(),
      collectionsResponse.json(),
    ]);

    if (
      customersJson?.errors?.length ||
      productsJson?.errors?.length ||
      collectionsJson?.errors?.length
    ) {
      console.warn('[app.simple] GraphQL errors', {
        customers: customersJson?.errors,
        products: productsJson?.errors,
        collections: collectionsJson?.errors,
      });
    }

    const customers = (customersJson?.data?.customers?.nodes || []).map((customer) => {
      const email = customer.defaultEmailAddress?.emailAddress || '';
      const name =
        customer.displayName ||
        [customer.firstName, customer.lastName].filter(Boolean).join(' ') ||
        email ||
        customer.id;

      return {
        id: customer.id,
        name,
        email,
        tags: customer.tags || [],
        color: colorFromString(customer.id || email || name),
      };
    });

    const products = mapProductEdges(productsJson?.data?.products?.edges);
    const collections = mapCollectionEdges(collectionsJson?.data?.collections?.edges);

    const customerTags = Array.from(
      new Set(customers.flatMap((customer) => customer.tags || [])),
    )
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b))
      .map((tag) => ({ label: tag, value: tag }));

    return {
      customers,
      customerTags,
      products,
      collections,
      productsPageInfo: getPageInfo(productsJson?.data?.products),
      collectionsPageInfo: getPageInfo(collectionsJson?.data?.collections),
    };
  } catch (error) {
    console.warn('[app.simple] failed to load resources', error);
    return {
      customers: [],
      customerTags: [],
      products: [],
      collections: [],
      productsPageInfo: EMPTY_PAGE_INFO,
      collectionsPageInfo: EMPTY_PAGE_INFO,
    };
  }
};

const CUSTOMER_ELIGIBILITY_OPTIONS = [
  { label: 'All Customers', value: 'all' },
  { label: 'Customer Tags', value: 'tags' },
  { label: 'Specific Customer', value: 'specific' },
];

const DISCOUNT_OPTIONS = [
  { label: 'Fixed bundle price', value: 'fixed_bundle_price' },
  { label: 'Percentage discount %', value: 'percentage' },
  { label: 'Fixed amount discount $', value: 'fixed_amount' },
];

const PRODUCT_CONFIGURATION_OPTIONS = [
  { label: 'Wholestore', value: 'whole_store' },
  { label: 'Select products', value: 'selected_products' },
  { label: 'Select collections', value: 'selected_collections' },
];

const SCHEDULE_OPTIONS = [
  { label: 'Publish immediately', value: 'immediately' },
  { label: 'Schedule bundle', value: 'scheduled' },
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

function BundleInformationSection({
  form,
  onChange,
  activePack,
  activePackId,
  onActivePackChange,
  onActivePackSelect,
  minScheduleDate,
  products,
  collections,
  onBrowseProducts,
  onBrowseCollections,
  onRemoveProduct,
  onRemoveCollection,
}) {
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

      <QuantityPackSection
        activePack={activePack}
        activePackId={activePackId}
        onActivePackChange={onActivePackChange}
        onActivePackSelect={onActivePackSelect}
        minScheduleDate={minScheduleDate}
        products={products}
        collections={collections}
        onBrowseProducts={onBrowseProducts}
        onBrowseCollections={onBrowseCollections}
        onRemoveProduct={onRemoveProduct}
        onRemoveCollection={onRemoveCollection}
        packs={form.quantityPacks || []}
        onAddPack={() => {
          const currentPacks = form.quantityPacks || [];
          const newPack = createQuantityPack(currentPacks.length);
          onChange('quantityPacks', [
            ...currentPacks,
            newPack,
          ]);
          onChange('createQuantityPackProduct', true);
          return newPack.id;
        }}
      />
    </BlockStack>
  );
}

function QuantityPackSection({
  activePack,
  activePackId,
  onActivePackChange,
  onActivePackSelect,
  minScheduleDate,
  products,
  collections,
  onBrowseProducts,
  onBrowseCollections,
  onRemoveProduct,
  onRemoveCollection,
  packs,
  onAddPack,
}) {
  const hasPacks = packs.length > 0;
  const currentPack = activePack || packs[0];

  const handleAddPack = useCallback(() => {
    const packId = onAddPack();
    if (packId) onActivePackSelect(packId);
  }, [onActivePackSelect, onAddPack]);

  return (
    <Card padding="0">
      <Box padding="400">
        <InlineStack align="space-between" blockAlign="start" gap="400">
          <BlockStack gap="100">
            <Text as="h3" variant="headingMd">
              Bundle Pack
            </Text>
            <Text as="p" tone="subdued">
              Create Bundle packs and options for your storefront.
            </Text>
          </BlockStack>

          {hasPacks ? (
            <Button variant="primary" icon={PlusIcon} onClick={handleAddPack}>
              Add Another Pack
            </Button>
          ) : null}
        </InlineStack>
      </Box>

      <Divider />

      <Box padding="400">
        {hasPacks ? (
          <BlockStack gap="500">
            <InlineStack gap="400" wrap>
              {packs.map((pack) => (
                <button
                  type="button"
                  key={pack.id}
                  onClick={() => onActivePackSelect(pack.id)}
                  style={{
                    minWidth: 100,
                    minHeight: 40,
                    border: pack.id === activePackId
                      ? '1px solid #202223'
                      : '1px solid var(--p-color-border)',
                    background: pack.id === activePackId
                      ? '#202223'
                      : 'var(--p-color-bg-surface)',
                    borderRadius: 12,
                    color: pack.id === activePackId
                      ? '#ffffff'
                      : 'var(--p-color-text)',
                    padding: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      width: 30,
                      height: 30,
                      color: pack.id === activePackId
                        ? '#ffffff'
                        : 'var(--p-color-icon)',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Icon source={PackageIcon} />
                  </span>
                  <Text as="span" fontWeight="bold">
                    {pack.title}
                  </Text>
                </button>
              ))}
            </InlineStack>

            <QuantityPackConfigurationList
              key={activePackId}
              pack={currentPack}
              onChange={onActivePackChange}
              minScheduleDate={minScheduleDate}
              products={products}
              collections={collections}
              onBrowseProducts={onBrowseProducts}
              onBrowseCollections={onBrowseCollections}
              onRemoveProduct={onRemoveProduct}
              onRemoveCollection={onRemoveCollection}
            />
          </BlockStack>
        ) : (
          <div
            style={{
              border: '1px dashed var(--p-color-border)',
              borderRadius: 8,
              minHeight: 160,
              display: 'grid',
              placeItems: 'center',
              padding: 24,
            }}
          >
            <BlockStack gap="400" inlineAlign="center">
              <Button variant="primary" icon={PlusIcon} onClick={handleAddPack}>
                Add Bundle Pack
              </Button>
              <Text as="p" tone="subdued">
                Create custom bundle packs for your store.
              </Text>
            </BlockStack>
          </div>
        )}
      </Box>
    </Card>
  );
}

function QuantityPackConfigurationList({
  pack,
  onChange,
  minScheduleDate,
  products,
  collections,
  onBrowseProducts,
  onBrowseCollections,
  onRemoveProduct,
  onRemoveCollection,
}) {
  const [openPanel, setOpenPanel] = useState('');
  const togglePanel = useCallback((panel) => {
    setOpenPanel((current) => (current === panel ? '' : panel));
  }, []);

  return (
    <BlockStack gap="200">
      <PackSectionPreview
        id="configureBundles"
        title="Configure Bundles"
        open={openPanel === 'configureBundles'}
        onToggle={togglePanel}
      >
        <BlockStack gap="400">
          <TextField
            label="Step Title"
            value={pack.stepTitle}
            onChange={(value) => onChange('stepTitle', value)}
            autoComplete="off"
          />
          <TextField
            label="Step Description"
            value={pack.stepDescription}
            onChange={(value) => onChange('stepDescription', value)}
            multiline={3}
            autoComplete="off"
          />
          <TextField
            label="Product Items"
            type="number"
            min={1}
            value={pack.productItems}
            onChange={(value) => onChange('productItems', value)}
            helpText="Number of products the customer must select."
            autoComplete="off"
          />
          <TextField
            label="Button Label"
            value={pack.buttonLabel}
            onChange={(value) => onChange('buttonLabel', value)}
            autoComplete="off"
          />
        </BlockStack>
      </PackSectionPreview>

      <PackSectionPreview
        id="discounts"
        title="Discounts"
        open={openPanel === 'discounts'}
        onToggle={togglePanel}
      >
        <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
          <Select
            label="Discount Type"
            options={DISCOUNT_OPTIONS}
            value={pack.discountType}
            onChange={(value) => onChange('discountType', value)}
          />
          <TextField
            label="Value"
            type="number"
            min={0}
            value={pack.discountValue}
            onChange={(value) => onChange('discountValue', value)}
            prefix={pack.discountType === 'percentage' ? undefined : '$'}
            suffix={pack.discountType === 'percentage' ? '%' : undefined}
            placeholder="0"
            autoComplete="off"
          />
        </InlineGrid>
      </PackSectionPreview>

      <PackSectionPreview
        id="productConfiguration"
        title="Product Configuration"
        open={openPanel === 'productConfiguration'}
        onToggle={togglePanel}
      >
        <BlockStack gap="400">
          <ChoiceList
            title="Product source"
            titleHidden
            choices={PRODUCT_CONFIGURATION_OPTIONS}
            selected={[pack.productConfiguration]}
            onChange={(value) => onChange('productConfiguration', value[0])}
          />

          {pack.productConfiguration === 'selected_products' ? (
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Selected products
                </Text>
                <Button icon={PlusIcon} onClick={onBrowseProducts}>
                  Add Products
                </Button>
              </InlineStack>
              <SelectedItems
                type="products"
                items={products}
                selectedIds={pack.selectedProductIds}
                onRemove={onRemoveProduct}
              />
            </BlockStack>
          ) : null}

          {pack.productConfiguration === 'selected_collections' ? (
            <BlockStack gap="300">
              <InlineStack align="space-between" blockAlign="center">
                <Text as="h3" variant="headingSm">
                  Selected collections
                </Text>
                <Button icon={PlusIcon} onClick={onBrowseCollections}>
                  Add Collections
                </Button>
              </InlineStack>
              <SelectedItems
                type="collections"
                items={collections}
                selectedIds={pack.selectedCollectionIds}
                onRemove={onRemoveCollection}
              />
            </BlockStack>
          ) : null}
        </BlockStack>
      </PackSectionPreview>

      <PackSectionPreview
        id="schedule"
        title="Schedule"
        open={openPanel === 'schedule'}
        onToggle={togglePanel}
      >
        <BlockStack gap="400">
          <ChoiceList
            title="Publishing schedule"
            titleHidden
            choices={SCHEDULE_OPTIONS}
            selected={[pack.scheduleType]}
            onChange={(value) => onChange('scheduleType', value[0])}
          />
          {pack.scheduleType === 'scheduled' ? (
            <BlockStack gap="400">
              <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                <TextField
                  label="Start Date"
                  type="date"
                  value={pack.startDate}
                  onChange={(value) => onChange('startDate', value)}
                  min={minScheduleDate}
                  prefix={<Icon source={CalendarIcon} />}
                  autoComplete="off"
                />
                <TextField
                  label="Start Time"
                  type="time"
                  value={pack.startTime}
                  onChange={(value) => onChange('startTime', value)}
                  autoComplete="off"
                />
              </InlineGrid>
              <Checkbox
                label="Set an end date"
                checked={pack.hasEndDate}
                onChange={(value) => onChange('hasEndDate', value)}
                helpText="The bundle becomes unavailable after the end date and time."
              />
              {pack.hasEndDate ? (
                <InlineGrid columns={{ xs: 1, md: 2 }} gap="400">
                  <TextField
                    label="End Date"
                    type="date"
                    value={pack.endDate}
                    onChange={(value) => onChange('endDate', value)}
                    min={pack.startDate || minScheduleDate}
                    prefix={<Icon source={CalendarIcon} />}
                    autoComplete="off"
                  />
                  <TextField
                    label="End Time"
                    type="time"
                    value={pack.endTime}
                    onChange={(value) => onChange('endTime', value)}
                    autoComplete="off"
                  />
                </InlineGrid>
              ) : null}
            </BlockStack>
          ) : null}
        </BlockStack>
      </PackSectionPreview>
    </BlockStack>
  );
}

function PackSectionPreview({
  id,
  title,
  active = false,
  open = false,
  onToggle,
  children,
}) {
  const canExpand = Boolean(children && onToggle);

  return (
    <div
      style={{
        background: active ? '#202223' : 'var(--p-color-bg-surface)',
        border: active ? '1px solid #202223' : '1px solid var(--p-color-border)',
        borderRadius: 8,
        color: active ? '#ffffff' : 'var(--p-color-text)',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={() => {
          if (canExpand) onToggle(id);
        }}
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        aria-disabled={!canExpand}
        style={{
          width: '100%',
          border: 0,
          background: 'transparent',
          color: 'inherit',
          cursor: canExpand ? 'pointer' : 'default',
          padding: '16px 20px',
          textAlign: 'left',
        }}
      >
        <InlineStack align="space-between" blockAlign="center">
          <span
            style={{
              color: active ? '#ffffff' : 'var(--p-color-text)',
              fontWeight: 600,
            }}
          >
            {title}
          </span>
          <span style={{ color: active ? '#ffffff' : 'var(--p-color-icon)' }}>
            {canExpand ? (
              <Icon source={open ? ChevronUpIcon : ChevronDownIcon} />
            ) : (
              <Icon source={ChevronDownIcon} />
            )}
          </span>
        </InlineStack>
      </button>

      {canExpand ? (
        <Collapsible
          id={`${id}-panel`}
          open={open}
          transition={{ duration: '200ms', timingFunction: 'ease-in-out' }}
          expandOnPrint
        >
          <Divider />
          <Box padding="400" background="bg-surface">
            {children}
          </Box>
        </Collapsible>
      ) : null}
    </div>
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

function ProductPreviewGrid({ products }) {
  const visibleProducts = products.slice(0, 8);

  if (!visibleProducts.length) return null;

  return (
    <InlineGrid columns={{ xs: 2, sm: 4 }} gap="200">
      {visibleProducts.map((product) => (
        <Box
          key={product.id}
          padding="200"
          background="bg-surface"
          borderRadius="300"
          borderWidth="025"
          borderColor="border"
        >
          <BlockStack gap="150">
            <Thumbnail
              source={product.image || ProductIcon}
              alt={product.title}
              size="medium"
            />
            <BlockStack gap="050">
              <Text as="p" variant="bodySm" fontWeight="semibold">
                {product.title}
              </Text>
              {product.subtitle ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {product.subtitle}
                </Text>
              ) : null}
            </BlockStack>
          </BlockStack>
        </Box>
      ))}
    </InlineGrid>
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
  previewPacks = [],
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

          {previewPacks.length ? (
            <BlockStack gap="300">
              {previewPacks.map((pack) => (
                <Box
                  key={pack.id}
                  padding="400"
                  background="bg-surface-secondary"
                  borderRadius="300"
                >
                  <BlockStack gap="300">
                    <InlineStack gap="200" blockAlign="center">
                      <Icon source={PackageIcon} />
                      <Text as="h3" variant="headingMd">
                        {pack.title}
                      </Text>
                    </InlineStack>

                    <BlockStack gap="100">
                      <Text as="h4" variant="headingSm">
                        {pack.stepTitle || 'Choose your products'}
                      </Text>
                      <Text as="p" tone="subdued">
                        {pack.stepDescription || 'Step description'}
                      </Text>
                    </BlockStack>

                    <ProductPreviewGrid products={pack.products} />
                  </BlockStack>
                </Box>
              ))}
            </BlockStack>
          ) : (
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

                <ProductPreviewGrid products={previewProducts} />
              </BlockStack>
            </Box>
          )}

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
    setDraftSelected((current) =>
      current.includes(id)
        ? current.filter((currentId) => currentId !== id)
        : [...current, id],
    );
  }, []);

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
        content: `Add selected ${type}`,
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

              .simple-picker-scroll > .Polaris-BlockStack {
                min-height: 100%;
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
              height: 'min(78vh, 760px)',
              maxHeight: 'calc(100vh - 220px)',
              minHeight: 'min(620px, calc(100vh - 220px))',
              overflowY: 'auto',
              overflowX: 'hidden',
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
export default function MixMatchBundleFormPolaris({
  initialData,
  products: propProducts = EMPTY_ITEMS,
  collections: propCollections = EMPTY_ITEMS,
  onBack,
  onSubmit,
}) {
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
    if (onBack) {
      onBack();
      return;
    }

    navigate(withEmbeddedAppParams('/app/boxes', location.search));
  }, [location.search, navigate, onBack]);

  const [form, setForm] = useState({
    status: initialData?.status || 'active',
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
    discountType: initialData?.discountType || 'fixed_bundle_price',
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
    createQuantityPackProduct: initialData?.createQuantityPackProduct || false,
    quantityPacks: (initialData?.quantityPacks || []).map((pack, index) =>
      createQuantityPack(index, pack),
    ),
  });

  const [activePackId, setActivePackId] = useState(
    initialData?.quantityPacks?.[0]?.id || '',
  );
  const [openSections, setOpenSections] = useState({
    bundleInformation: true,
    customerEligibility: false,
  });

  const [selectedProductIds, setSelectedProductIds] = useState(
    initialData?.selectedProductIds || [],
  );
  const [selectedCollectionIds, setSelectedCollectionIds] = useState(
    initialData?.selectedCollectionIds || [],
  );
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [customerTagsModalOpen, setCustomerTagsModalOpen] = useState(false);
  const [customersModalOpen, setCustomersModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);
  const [designSettings, setDesignSettings] = useState({
    ...DEFAULT_DESIGN_SETTINGS,
    ...(initialData?.designSettings || {}),
  });
  const productPicker = useInfinitePickerPagination({
    resource: 'products',
    initialItems: initialProducts,
    initialPageInfo: initialProductsPageInfo,
    open: productModalOpen,
  });
  const collectionPicker = useInfinitePickerPagination({
    resource: 'collections',
    initialItems: initialCollections,
    initialPageInfo: initialCollectionsPageInfo,
    open: collectionModalOpen,
  });
  const products = productPicker.items;
  const collections = collectionPicker.items;
  const activePack = useMemo(
    () =>
      form.quantityPacks.find((pack) => pack.id === activePackId) ||
      form.quantityPacks[0] ||
      null,
    [activePackId, form.quantityPacks],
  );

  const bannerPreview = useFilePreview(form.bannerImage);
  const bundlePreview = useFilePreview(form.bundleImage);
  const customerDisplayValue = useMemo(
    () =>
      getCustomerSelectionLabel(csvToList(form.customers), customerOptions),
    [customerOptions, form.customers],
  );

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

  useEffect(() => {
    if (!form.quantityPacks.length) {
      setActivePackId('');
      return;
    }

    if (!form.quantityPacks.some((pack) => pack.id === activePackId)) {
      setActivePackId(form.quantityPacks[0].id);
    }
  }, [activePackId, form.quantityPacks]);

  const setActivePackField = useCallback((field, value) => {
    setForm((current) => ({
      ...current,
      quantityPacks: current.quantityPacks.map((pack) => {
        if (pack.id !== activePackId) return pack;

        if (field === 'scheduleType' && value === 'scheduled') {
          return {
            ...pack,
            scheduleType: value,
            startDate:
              clampDateInput(pack.startDate, minScheduleDate) || minScheduleDate,
            startTime: pack.startTime || currentSchedule.time,
          };
        }

        if (field === 'startDate') {
          const startDate =
            clampDateInput(value, minScheduleDate) || minScheduleDate;
          return {
            ...pack,
            startDate,
            endDate: pack.endDate
              ? clampDateInput(pack.endDate, startDate)
              : pack.endDate,
          };
        }

        if (field === 'endDate') {
          const minEndDate = pack.startDate || minScheduleDate;
          return { ...pack, endDate: clampDateInput(value, minEndDate) };
        }

        return { ...pack, [field]: value };
      }),
    }));
  }, [activePackId, currentSchedule.time, minScheduleDate]);

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
    const source = activePack || form;

    if (source.productConfiguration === 'selected_products') {
      return activePack?.selectedProductIds?.length ?? selectedProductIds.length;
    }

    if (source.productConfiguration === 'selected_collections') {
      return (
        activePack?.selectedCollectionIds?.length ??
        selectedCollectionIds.length
      );
    }

    return products.length;
  }, [
    activePack,
    form,
    products.length,
    selectedCollectionIds.length,
    selectedProductIds.length,
  ]);

  const previewProducts = useMemo(() => {
    const source = activePack || form;

    return getConfiguredProducts({
      productConfiguration: source.productConfiguration,
      products,
      collections,
      selectedProductIds: activePack?.selectedProductIds || selectedProductIds,
      selectedCollectionIds:
        activePack?.selectedCollectionIds || selectedCollectionIds,
    });
  }, [
    activePack,
    collections,
    form,
    products,
    selectedCollectionIds,
    selectedProductIds,
  ]);

  const previewPacks = useMemo(
    () =>
      (form.quantityPacks || []).map((pack) => ({
        ...pack,
        products: getConfiguredProducts({
          productConfiguration: pack.productConfiguration,
          products,
          collections,
          selectedProductIds: pack.selectedProductIds || [],
          selectedCollectionIds: pack.selectedCollectionIds || [],
        }),
      })),
    [collections, form.quantityPacks, products],
  );

  const discountText = useMemo(() => {
    const source = activePack || form;
    const value = source.discountValue || '0';

    if (source.discountType === 'percentage') return `${value}% off`;
    if (source.discountType === 'fixed_amount') return `$${value} off`;

    return `$${value} bundle price`;
  }, [activePack, form]);

  const scheduleText = useMemo(() => {
    const source = activePack || form;

    if (source.scheduleType === 'immediately') return 'Publish immediately';

    if (!source.startDate) return 'Schedule not completed';

    const start = [source.startDate, source.startTime].filter(Boolean).join(' ');
    const end = source.hasEndDate
      ? [source.endDate, source.endTime].filter(Boolean).join(' ')
      : '';

    return end ? `${start} to ${end}` : `Starts ${start}`;
  }, [activePack, form]);

  const summaryForm = useMemo(() => {
    if (!activePack) return form;

    return {
      ...form,
      stepTitle: activePack.stepTitle,
      stepDescription: activePack.stepDescription,
      productItems: activePack.productItems,
      buttonLabel: activePack.buttonLabel,
      discountType: activePack.discountType,
      discountValue: activePack.discountValue,
      productConfiguration: activePack.productConfiguration,
      scheduleType: activePack.scheduleType,
      startDate: activePack.startDate,
      startTime: activePack.startTime,
      hasEndDate: activePack.hasEndDate,
      endDate: activePack.endDate,
      endTime: activePack.endTime,
    };
  }, [activePack, form]);

  const handleSubmit = useCallback(async () => {
    try {
      setSaving(true);
      await onSubmit?.({
        ...form,
        selectedProductIds,
        selectedCollectionIds,
      });
    } finally {
      setSaving(false);
    }
  }, [form, onSubmit, selectedCollectionIds, selectedProductIds]);

  return (
    <Page
      title="Create Mix n Match Bundle"
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
                        activePack={activePack}
                        activePackId={activePackId}
                        onActivePackChange={setActivePackField}
                        onActivePackSelect={setActivePackId}
                        minScheduleDate={minScheduleDate}
                        products={products}
                        collections={collections}
                        onBrowseProducts={() => setProductModalOpen(true)}
                        onBrowseCollections={() => setCollectionModalOpen(true)}
                        onRemoveProduct={(id) =>
                          setActivePackField(
                            'selectedProductIds',
                            (activePack?.selectedProductIds || []).filter(
                              (currentId) => currentId !== id,
                            ),
                          )
                        }
                        onRemoveCollection={(id) =>
                          setActivePackField(
                            'selectedCollectionIds',
                            (activePack?.selectedCollectionIds || []).filter(
                              (currentId) => currentId !== id,
                            ),
                          )
                        }
                      />
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
                  </BlockStack>
                </Grid.Cell>

                <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 4, xl: 4 }}>
                  <SummaryPreviewPanel
                    form={summaryForm}
                    selectedCount={selectedCount}
                    discountText={discountText}
                    scheduleText={scheduleText}
                    bannerPreview={bannerPreview}
                    bundlePreview={bundlePreview}
                    previewProducts={previewProducts}
                    previewPacks={previewPacks}
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
                  form={summaryForm}
                  selectedCount={selectedCount}
                  discountText={discountText}
                  scheduleText={scheduleText}
                  bannerPreview={bannerPreview}
                  bundlePreview={bundlePreview}
                  previewProducts={previewProducts}
                  previewPacks={previewPacks}
                  onStatusChange={(value) => setField('status', value)}
                />
              </Grid.Cell>
            </Grid>
          ) : null}

          {selectedTab === 2 ? (
            <Grid>
              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 8, xl: 8 }}>
                <Card>
                  <BlockStack gap="300">
                    <Text as="h2" variant="headingMd">
                      Advanced
                    </Text>
                    <Text as="p" tone="subdued">
                      Advanced settings will appear here.
                    </Text>
                  </BlockStack>
                </Card>
              </Grid.Cell>

              <Grid.Cell columnSpan={{ xs: 6, sm: 6, md: 6, lg: 4, xl: 4 }}>
                <SummaryPreviewPanel
                  form={summaryForm}
                  selectedCount={selectedCount}
                  discountText={discountText}
                  scheduleText={scheduleText}
                  bannerPreview={bannerPreview}
                  bundlePreview={bundlePreview}
                  previewProducts={previewProducts}
                  previewPacks={previewPacks}
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
        selectedIds={activePack?.selectedProductIds || []}
        onLoadMore={productPicker.loadMore}
        onClose={() => setProductModalOpen(false)}
        onSave={(ids) => {
          setActivePackField('selectedProductIds', ids);
          setProductModalOpen(false);
        }}
        type="products"
      />

      <PickerModal
        open={collectionModalOpen}
        title="Add Collections"
        items={collections}
        loadingMore={collectionPicker.loadingMore}
        error={collectionPicker.error}
        selectedIds={activePack?.selectedCollectionIds || []}
        onLoadMore={collectionPicker.loadMore}
        onClose={() => setCollectionModalOpen(false)}
        onSave={(ids) => {
          setActivePackField('selectedCollectionIds', ids);
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
