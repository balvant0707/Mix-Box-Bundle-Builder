import {useCallback, useEffect, useMemo, useState} from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  Card,
  Checkbox,
  ChoiceList,
  Collapsible,
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
  RadioButton,
  ResourceItem,
  ResourceList,
  Select,
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

const DISCOUNT_OPTIONS = [
  {label: 'Fixed bundle price', value: 'fixed_bundle_price'},
  {label: 'Percentage discount %', value: 'percentage'},
  {label: 'Fixed amount discount $', value: 'fixed_amount'},
];

const PRODUCT_CONFIGURATION_OPTIONS = [
  {label: 'Whole store', value: 'whole_store'},
  {label: 'Select products', value: 'selected_products'},
  {label: 'Select collections', value: 'selected_collections'},
];

const SCHEDULE_OPTIONS = [
  {label: 'Publish immediately', value: 'immediately'},
  {label: 'Schedule bundle', value: 'scheduled'},
];

const FORM_TABS = [
  {id: 'content', content: 'Content', panelID: 'content-panel'},
  {id: 'design', content: 'Design', panelID: 'design-panel'},
  {id: 'advanced', content: 'Advanced', panelID: 'advanced-panel'},
];

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
        transition={{duration: '200ms', timingFunction: 'ease-in-out'}}
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

function ImageUploader({label, value, onChange, helpText}) {
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

function PickerModal({
  open,
  title,
  items,
  selectedIds,
  onClose,
  onSave,
  type,
}) {
  const [query, setQuery] = useState('');
  const [draftSelected, setDraftSelected] = useState(selectedIds);

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
      secondaryActions={[{content: 'Cancel', onAction: handleClose}]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <TextField
            label={`Search ${type}`}
            labelHidden
            prefix={<Icon source={SearchIcon} />}
            placeholder={`Search ${type}...`}
            value={query}
            onChange={setQuery}
            autoComplete="off"
          />

          {filteredItems.length ? (
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
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
}

function SelectedItems({items, selectedIds, onRemove, emptyText, type}) {
  const selectedItems = items.filter((item) => selectedIds.includes(item.id));

  if (!selectedItems.length) {
    return (
      <Box
        padding="400"
        background="bg-surface-secondary"
        borderRadius="300"
      >
        <Text as="p" tone="subdued">
          {emptyText}
        </Text>
      </Box>
    );
  }

  return (
    <ResourceList
      resourceName={{singular: 'item', plural: 'items'}}
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
  products = [],
  collections = [],
  onBack,
  onSubmit,
}) {
  const currentSchedule = useMemo(() => getCurrentDateTimeInput(), []);
  const minScheduleDate = currentSchedule.date;
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
  });

  const [openSections, setOpenSections] = useState({
    bundleInformation: true,
    configureBundle: false,
    discount: false,
    productConfiguration: false,
    schedule: false,
  });

  const [selectedProductIds, setSelectedProductIds] = useState(
    initialData?.selectedProductIds || [],
  );
  const [selectedCollectionIds, setSelectedCollectionIds] = useState(
    initialData?.selectedCollectionIds || [],
  );
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [collectionModalOpen, setCollectionModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedTab, setSelectedTab] = useState(0);

  const bannerPreview = useFilePreview(form.bannerImage);
  const bundlePreview = useFilePreview(form.bundleImage);

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
        return {...current, endDate: clampDateInput(value, minEndDate)};
      }

      return {...current, [field]: value};
    });
  }, [currentSchedule.time, minScheduleDate]);

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

  const discountText = useMemo(() => {
    const value = form.discountValue || '0';

    if (form.discountType === 'percentage') return `${value}% off`;
    if (form.discountType === 'fixed_amount') return `$${value} off`;

    return `$${value} bundle price`;
  }, [form.discountType, form.discountValue]);

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
      backAction={onBack ? {content: 'Back', onAction: onBack} : undefined}
      primaryAction={{
        content: 'Save Bundle',
        onAction: handleSubmit,
        loading: saving,
      }}
    >
      <Form onSubmit={handleSubmit}>
        <BlockStack gap="400">
          <Tabs tabs={FORM_TABS} selected={selectedTab} onSelect={setSelectedTab} />

          {selectedTab === 0 ? (
        <Grid>
          <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 8, xl: 8}}>
            <BlockStack gap="200" paddingBlockEnd="800">
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <Text as="h2" variant="headingMd">
                      Status
                    </Text>

                    <Badge tone={form.status === 'active' ? 'success' : undefined}>
                      {form.status === 'active' ? 'Active' : 'Inactive'}
                    </Badge>
                  </InlineStack>

                  <Divider />

                  <InlineStack gap="500" blockAlign="center">
                    <RadioButton
                      label="Active"
                      checked={form.status === 'active'}
                      id="bundle-status-active"
                      name="bundleStatus"
                      onChange={() => setField('status', 'active')}
                    />
                    <RadioButton
                      label="Inactive"
                      checked={form.status === 'inactive'}
                      id="bundle-status-inactive"
                      name="bundleStatus"
                      onChange={() => setField('status', 'inactive')}
                    />
                  </InlineStack>
                </BlockStack>
              </Card>

              <AccordionSection
                id="bundleInformation"
                title="Bundle Information"
                description="Enter the main bundle details and images."
                open={openSections.bundleInformation}
                onToggle={toggleSection}
              >
                <BlockStack gap="400">
                  <TextField
                    label="Title"
                    requiredIndicator
                    value={form.title}
                    onChange={(value) => setField('title', value)}
                    placeholder="Build your perfect bundle"
                    autoComplete="off"
                  />

                  <TextField
                    label="Description"
                    value={form.description}
                    onChange={(value) => setField('description', value)}
                    multiline={4}
                    placeholder="Describe this bundle"
                    autoComplete="off"
                  />

                  <InlineGrid columns={{xs: 1, md: 2}} gap="400">
                    <ImageUploader
                      label="Bundle Image"
                      value={form.bundleImage}
                      onChange={(value) => setField('bundleImage', value)}
                      helpText="Used as the main bundle thumbnail or product-style image."
                    />

                    <ImageUploader
                      label="Banner Image"
                      value={form.bannerImage}
                      onChange={(value) => setField('bannerImage', value)}
                      helpText="Displayed as the wide banner at the top of the bundle preview."
                    />
                  </InlineGrid>
                </BlockStack>
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
                <InlineGrid columns={{xs: 1, md: 2}} gap="400">
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

                  {form.productConfiguration === 'whole_store' ? (
                    <div
                      style={{
                        background: 'var(--p-color-bg-surface-secondary)',
                        borderRadius: 'var(--p-border-radius-300)',
                        padding: '16px',
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          maxWidth: '100%',
                        }}
                      >
                        <Icon source={ProductIcon} />
                        <Text as="p">
                          All active products in the store will be available.
                        </Text>
                      </div>
                    </div>
                  ) : null}

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
                        emptyText="No products selected yet."
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
                        emptyText="No collections selected yet."
                      />
                    </BlockStack>
                  ) : null}
                </BlockStack>
              </AccordionSection>

              <AccordionSection
                id="schedule"
                title="Schedule"
                description="Publish immediately or schedule the bundle for a date and time."
                open={openSections.schedule}
                onToggle={toggleSection}
                paddingBottom ="400"
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
                      <InlineGrid columns={{xs: 1, md: 2}} gap="400">
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
                        <InlineGrid columns={{xs: 1, md: 2}} gap="400">
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
                  ) : (
                    <div
                      style={{
                        background: 'var(--p-color-bg-surface-secondary)',
                        borderRadius: 'var(--p-border-radius-300)',
                        padding: '16px',
                        width: '100%',
                      }}
                    >
                      <div
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '8px',
                          maxWidth: '100%',
                        }}
                      >
                        <Icon source={CalendarIcon} />
                        <Text as="p">
                          The bundle will be available immediately after saving.
                        </Text>
                      </div>
                    </div>
                  )}
                </BlockStack>
              </AccordionSection>
            </BlockStack>
          </Grid.Cell>

          <Grid.Cell columnSpan={{xs: 6, sm: 6, md: 6, lg: 4, xl: 4}}>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    Summary
                  </Text>

                  <Divider />

                  <InlineStack align="space-between">
                    <Text as="span" tone="subdued">
                      Status
                    </Text>
                    <Badge tone={form.status === 'active' ? 'success' : undefined}>
                      {form.status === 'active' ? 'Active' : 'Inactive'}
                    </Badge>
                  </InlineStack>

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
                        {form.description ||
                          'Your bundle description will appear here.'}
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

                      <InlineGrid columns={{xs: 2, sm: 4}} gap="200">
                        {Array.from({
                          length: Math.min(Number(form.productItems) || 3, 4),
                        }).map((_, index) => (
                          <Box
                            key={index}
                            padding="400"
                            background="bg-surface"
                            borderRadius="300"
                            borderWidth="025"
                            borderColor="border"
                          >
                            <BlockStack inlineAlign="center">
                              <Text as="span" tone="subdued">
                                {index + 1}
                              </Text>
                            </BlockStack>
                          </Box>
                        ))}
                      </InlineGrid>
                    </BlockStack>
                  </Box>

                  <Button variant="primary" fullWidth>
                    {form.buttonLabel || 'Add bundle to cart'}
                  </Button>
                </BlockStack>
              </Card>
            </BlockStack>
          </Grid.Cell>
        </Grid>
          ) : null}

          {selectedTab === 1 ? (
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Design
                </Text>
                <Text as="p" tone="subdued">
                  Design settings will appear here.
                </Text>
              </BlockStack>
            </Card>
          ) : null}

          {selectedTab === 2 ? (
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
          ) : null}
        </BlockStack>
      </Form>

      <PickerModal
        open={productModalOpen}
        title="Add Products"
        items={products}
        selectedIds={selectedProductIds}
        onClose={() => setProductModalOpen(false)}
        onSave={(ids) => {
          setSelectedProductIds(ids);
          setProductModalOpen(false);
        }}
        type="products"
      />

      <PickerModal
        open={collectionModalOpen}
        title="Add Collections"
        items={collections}
        selectedIds={selectedCollectionIds}
        onClose={() => setCollectionModalOpen(false)}
        onSave={(ids) => {
          setSelectedCollectionIds(ids);
          setCollectionModalOpen(false);
        }}
        type="collections"
      />
    </Page>
  );
}
