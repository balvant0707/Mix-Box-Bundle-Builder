import { BlockStack, Box, Card, Icon, InlineStack, Text } from '@shopify/polaris';

// Box background tokens (bg-fill-*) and Icon tones overlap but aren't
// identical — e.g. "tertiary" is a valid background but not a valid Icon
// tone. Map each supported chip color to a valid Icon tone explicitly.
const ICON_TONE_BY_CHIP_TONE = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  critical: 'critical',
  magic: 'magic',
  tertiary: 'subdued',
};

/**
 * Shared stat tile used on the Dashboard, Manage Box, and Analytics pages.
 * `icon` is an optional Polaris icon source rendered in a tinted chip;
 * `change` is an optional signed percent rendered as a success/critical badge-like pill.
 */
export function StatCard({ label, value, sub, icon, iconTone = 'info', change }) {
  const hasChange = change !== null && change !== undefined && Number.isFinite(change);
  const isUp = hasChange && change >= 0;

  return (
    <Card>
      <BlockStack gap="200">
        <InlineStack gap="200" blockAlign="center" wrap={false}>
          {icon ? (
            <Box background={`bg-fill-${iconTone}`} borderRadius="200" padding="150">
              <Icon source={icon} tone={ICON_TONE_BY_CHIP_TONE[iconTone] || 'base'} />
            </Box>
          ) : null}
          <Text as="p" variant="bodySm" tone="subdued">
            {label}
          </Text>
        </InlineStack>

        <InlineStack gap="200" blockAlign="center">
          <Text as="p" variant="heading2xl">
            {value}
          </Text>
          {hasChange ? (
            <Box
              background={isUp ? 'bg-fill-success-secondary' : 'bg-fill-critical-secondary'}
              borderRadius="100"
              paddingInline="150"
              paddingBlock="050"
            >
              <Text as="span" variant="bodySm" fontWeight="semibold" tone={isUp ? 'success' : 'critical'}>
                {isUp ? '▲' : '▼'} {Math.abs(change).toFixed(0)}%
              </Text>
            </Box>
          ) : null}
        </InlineStack>

        {sub ? (
          <Text as="p" variant="bodySm" tone="subdued">
            {sub}
          </Text>
        ) : null}
      </BlockStack>
    </Card>
  );
}
