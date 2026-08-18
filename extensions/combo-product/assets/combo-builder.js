(function () {
  'use strict';

  // Routed through Shopify's app proxy (see shopify.app.toml [app_proxy]) so the
  // widget always talks to whichever backend the shop's app installation points
  // at, instead of a hardcoded (and easily stale) absolute host.
  var DEFAULT_API_BASE = '/apps/product-builder';

  // ═══ TEMPORARY DIAGNOSTIC INSTRUMENTATION — remove this whole block once the ═══
  // ═══ live disappearance root cause is confirmed from real console output.   ═══
  // Enable/disable without a redeploy via the browser console:
  //   localStorage.setItem('cbDebug', '1')   // turn on general diagnostics
  //   localStorage.removeItem('cbDebug')     // back to default (off)
  var __CB_DEBUG__ = (function () {
    try { return localStorage.getItem('cbDebug') === '1'; } catch (_) { return false; }
  })();
  var __CB_MULTIPLE_BOX_DEBUG__ = (function () {
    try { return localStorage.getItem('cbMultipleBoxDebug') !== '0'; } catch (_) { return true; }
  })();
  var __cbDebugStart = (window.performance && performance.now) ? performance.now() : Date.now();
  function cbNow() {
    return Math.round(((window.performance && performance.now) ? performance.now() : Date.now()) - __cbDebugStart);
  }
  function cbLog() {
    if (!__CB_DEBUG__) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[COMBO-DEBUG] +' + cbNow() + 'ms');
    try { console.log.apply(console, args); } catch (_) {}
  }
  function mbLog() {
    if (!__CB_MULTIPLE_BOX_DEBUG__) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[MultipleBox] +' + cbNow() + 'ms');
    try { console.log.apply(console, args); } catch (_) {}
  }
  function mbError() {
    if (!__CB_MULTIPLE_BOX_DEBUG__) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('[MultipleBox] +' + cbNow() + 'ms');
    try { console.error.apply(console, args); } catch (_) {}
  }
  function cbDescribeRoot(root) {
    if (!root) return { exists: false };
    var cs = null;
    try { cs = window.getComputedStyle ? window.getComputedStyle(root) : null; } catch (_) {}
    var parent = root.parentNode;
    return {
      id: root.id,
      isConnected: root.isConnected,
      inlineDisplay: root.style ? root.style.display : null,
      computedDisplay: cs ? cs.display : null,
      computedVisibility: cs ? cs.visibility : null,
      computedOpacity: cs ? cs.opacity : null,
      htmlLength: root.innerHTML ? root.innerHTML.length : 0,
      className: root.className,
      cbInitialized: root.getAttribute('data-cb-initialized'),
      cbRendered: root.getAttribute('data-cb-rendered'),
      cbSuppressed: root.getAttribute('data-cb-suppressed-by-manual-block'),
      cbNoProductContext: root.getAttribute('data-cb-no-product-context'),
      cbNoProductMatch: root.getAttribute('data-cb-no-product-match'),
      productId: root.dataset ? root.dataset.productId : null,
      parentTag: parent ? (parent.id ? ('#' + parent.id) : parent.tagName) : null,
      parentDisplay: parent && parent.style ? parent.style.display : null,
    };
  }
  // Attaches a live watcher directly to a successfully-rendered root so we can
  // log the EXACT moment/mutation/attribute-change responsible if it ever goes
  // away — instead of guessing from static code reading.
  function cbWatchRootDisappearance(root) {
    if (!__CB_DEBUG__) return;
    if (!root || typeof MutationObserver === 'undefined') return;
    if (root.__cbWatched) return; // one watcher per element instance
    root.__cbWatched = true;
    var lastSnapshot = JSON.stringify(cbDescribeRoot(root));
    cbLog('watch: attached disappearance watcher', cbDescribeRoot(root));

    if (root.parentNode) {
      try {
        new MutationObserver(function () {
          if (!root.isConnected) {
            cbLog('*** ROOT DISCONNECTED FROM DOCUMENT ***', cbDescribeRoot(root));
            try { console.trace('[COMBO-DEBUG] stack at disconnection (root=' + root.id + ')'); } catch (_) {}
          }
        }).observe(root.parentNode, { childList: true });
      } catch (_) {}
    }

    try {
      new MutationObserver(function () {
        var snapshot = cbDescribeRoot(root);
        var next = JSON.stringify(snapshot);
        if (next === lastSnapshot) return;
        cbLog('root mutated', 'before=', lastSnapshot, 'after=', next);
        if (snapshot.htmlLength === 0 || snapshot.computedDisplay === 'none' || snapshot.computedVisibility === 'hidden' || snapshot.computedOpacity === '0') {
          cbLog('*** ROOT VISUALLY CLEARED/HIDDEN ***', snapshot);
          try { console.trace('[COMBO-DEBUG] stack at clear/hide (root=' + root.id + ')'); } catch (_) {}
        }
        lastSnapshot = next;
      }).observe(root, {
        childList: true,
        attributes: true,
        attributeFilter: ['style', 'class', 'data-cb-initialized', 'data-cb-rendered', 'data-cb-suppressed-by-manual-block'],
      });
    } catch (_) {}
  }
  function cbInstallLifecycleListeners() {
    if (!__CB_DEBUG__) return;
    if (window.__cbLifecycleListenersInstalled) return;
    window.__cbLifecycleListenersInstalled = true;
    function snapshotAllRoots(label) {
      var roots = document.querySelectorAll('.combo-builder-root');
      var out = [];
      for (var i = 0; i < roots.length; i++) out.push(cbDescribeRoot(roots[i]));
      cbLog(label, 'combo-root count=' + roots.length, out);
    }
    ['shopify:section:load', 'shopify:section:unload', 'shopify:section:reorder', 'shopify:section:select', 'shopify:section:deselect']
      .forEach(function (evt) {
        document.addEventListener(evt, function (e) {
          cbLog('EVENT', evt, 'target=', e.target && (e.target.id || e.target.className));
          snapshotAllRoots('roots at ' + evt);
        });
      });
    ['variant:change', 'product:variant-change', 'change'].forEach(function (evt) {
      document.addEventListener(evt, function (e) {
        if (evt === 'change' && !(e.target && /variant|option/i.test(String(e.target.name || e.target.id || '')))) return;
        cbLog('EVENT', evt, 'target=', e.target && (e.target.id || e.target.name || e.target.className));
      }, true);
    });
    window.addEventListener('popstate', function () { cbLog('EVENT popstate'); snapshotAllRoots('roots at popstate'); });
    window.addEventListener('pageshow', function (e) { cbLog('EVENT pageshow persisted=' + e.persisted); snapshotAllRoots('roots at pageshow'); });
    document.addEventListener('DOMContentLoaded', function () { cbLog('EVENT DOMContentLoaded'); });
    window.addEventListener('load', function () { cbLog('EVENT window load'); snapshotAllRoots('roots at window load'); });
    cbLog('lifecycle listeners installed');
  }
  // ═══ END TEMPORARY DIAGNOSTIC INSTRUMENTATION (helpers) ═══

  // ─── Utilities ───────────────────────────────────────────────────────────────

  function generateSessionId() {
    return 'cb_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now();
  }

  function formatPrice(amount, currencySymbol, currencyCode) {
    var numericAmount = Number(amount) || 0;
    var code = String(currencyCode || "").trim().toUpperCase();
    if (/^[A-Z]{3}$/.test(code)) {
      try {
        return new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: code,
          currencyDisplay: "narrowSymbol",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(numericAmount);
      } catch (_err) {}
    }

    var symbol = currencySymbol || "$";
    return symbol + numericAmount.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function isDynamicBundlePrice(box) {
    return String((box && box.bundlePriceType) || 'manual') === 'dynamic';
  }

  // Single/Multiple Box discount config (page- or pack-level, sourced from
  // simple_box_page/multiple_box_page/multiple_box_quantity_pack) takes
  // priority over the legacy per-box comboConfig JSON, which only real
  // "Specific Combo" boxes still populate. Both shapes are identical
  // ({discountType, discountValue, buyQuantity, getQuantity, ...}) so every
  // existing discount-math/badge function keeps working unchanged.
  function getBoxDiscountConfig(box) {
    if (!box) return null;
    if (box.comboConfig) return box.comboConfig;
    // Single and Multiple Box discounts are page-level. Pack overrides only
    // remain as a fallback for older saved Multiple Box data.
    return box.pageDiscount || null;
  }

  var DESIGN_FONT_WEIGHT_MAP = {
    'Light': 300,
    'Regular': 400,
    'Medium': 500,
    'Semi Bold': 600,
    'SemiBold': 600,
    'Bold': 700
  };

  function resolveFontWeight(styleLabel, fallback) {
    if (styleLabel == null) return fallback;
    var mapped = DESIGN_FONT_WEIGHT_MAP[String(styleLabel).trim()];
    return mapped != null ? mapped : fallback;
  }

  var DESIGN_CARD_SIZE_MAP = {
    'Small': '140px',
    'Medium': '180px',
    'Large': '220px',
  };

  var LEARN_MORE_ICON_SVG = '<svg class="cb-product-learn-svg" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="8 8 84 84" aria-hidden="true" focusable="false"><path d="M49.9997559,8.083252c-23.112793,0-41.9165039,18.8037109-41.9165039,41.9165039c0,23.1132812,18.8037109,41.9169922,41.9165039,41.9169922c23.1132812,0,41.9169922-18.8037109,41.9169922-41.9169922C91.916748,26.8869629,73.1130371,8.083252,49.9997559,8.083252zM49.9997559,85.916748c-19.8041992,0-35.9165039-16.1123047-35.9165039-35.9169922c0-19.8041992,16.1123047-35.9165039,35.9165039-35.9165039c19.8046875,0,35.9169922,16.1123047,35.9169922,35.9165039C85.916748,69.8044434,69.8044434,85.916748,49.9997559,85.916748z"/><path d="M49.9997559,28.2907715c-1.4599609,0-2.7216797,0.5141602-3.7880859,1.5410156c-1.0654297,1.027832-1.5986328,2.2426758-1.5986328,3.6445312c0,1.4980469,0.5039062,2.7275391,1.5126953,3.6875c1.0078125,0.9604492,2.2988281,1.4404297,3.8740234,1.4404297s2.8662109-0.4799805,3.8740234-1.4404297c1.0097656-0.9599609,1.5136719-2.1894531,1.5136719-3.6875c0-1.4018555-0.5332031-2.6166992-1.5996094-3.6445312C52.7214355,28.8049316,51.4597168,28.2907715,49.9997559,28.2907715z"/><rect x="44.5837402" y="41.1105957" width="10.7744141" height="28.722168"/></svg>';

  function resolveProductCardSize(sizeLabel, fallback) {
    if (sizeLabel == null) return fallback;
    return DESIGN_CARD_SIZE_MAP[String(sizeLabel).trim()] || fallback;
  }

  function getVariantInventoryQuantity(variant) {
    if (!variant) return null;
    var raw = variant.inventoryQuantity != null
      ? variant.inventoryQuantity
      : variant.inventory_quantity != null
        ? variant.inventory_quantity
        : null;
    if (raw == null || raw === '') return null;
    var numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function isVariantAvailable(variant) {
    if (!variant) return false;
    var quantity = getVariantInventoryQuantity(variant);
    if (quantity != null) return quantity > 0;
    return true;
  }

  function isDefaultVariantTitle(title) {
    return !title || String(title).trim().toLowerCase() === 'default title';
  }

  // Builds an inline `style="--cb-box-x: ...; ..."` string from a box's
  // admin-configured designSettings so each box/pack can render with its own
  // colors/sizes without needing a per-box <style> tag (see combo-builder.css
  // for the --cb-box-* variables and their :root fallbacks).
  function buildBoxDesignStyle(designSettings) {
    if (!designSettings) return '';

    var decls = [];
    function set(name, value) {
      if (value == null || value === '') return;
      decls.push(name + ':' + value);
    }
    function px(value) {
      if (value == null || value === '') return null;
      var parsed = parseInt(String(value), 10);
      return isNaN(parsed) ? null : parsed + 'px';
    }

    set('--cb-box-bg', normalizeHexColor(designSettings.backgroundColor, null));
    set('--cb-box-border-color', normalizeHexColor(designSettings.cardBorderColor, null));
    set('--cb-box-border-width', px(designSettings.borderWidth));
    set('--cb-box-border-radius', px(designSettings.borderRadius));
    set('--cb-box-image-height', px(designSettings.imageHeight));
    set('--cb-box-image-height-mobile', px(designSettings.imageHeightMobile));
    set('--cb-box-image-display-desktop', designSettings.imageDisplay === 'Mobile only' ? 'none' : 'block');
    set('--cb-box-image-display-mobile', designSettings.imageDisplay === 'Desktop only' ? 'none' : 'block');
    set('--cb-box-product-card-size', resolveProductCardSize(designSettings.productCardDesktopSize, null));
    set('--cb-box-product-card-size-mobile', resolveProductCardSize(designSettings.productCardMobileSize, null));

    set('--cb-box-title-color', normalizeHexColor(designSettings.titleTextColor, null));
    set('--cb-box-title-size', px(designSettings.titleSize));
    set('--cb-box-title-weight', resolveFontWeight(designSettings.titleStyle, null));

    set('--cb-box-price-color', normalizeHexColor(designSettings.productPriceColor, null));
    set('--cb-box-price-size', px(designSettings.productPriceSize));
    set('--cb-box-price-weight', resolveFontWeight(designSettings.productPriceStyle, null));
    set('--cb-box-compare-price-color', normalizeHexColor(designSettings.compareAtPriceColor, null));
    set('--cb-box-compare-price-size', px(designSettings.compareAtPriceSize));
    set('--cb-box-compare-price-weight', resolveFontWeight(designSettings.compareAtPriceStyle, null));

    set('--cb-box-cta-bg', normalizeHexColor(designSettings.ctaBackgroundColor, null));
    set('--cb-box-cta-color', normalizeHexColor(designSettings.ctaTextColor, null));
    set('--cb-box-cta-size', px(designSettings.ctaSize));
    set('--cb-box-cta-weight', resolveFontWeight(designSettings.ctaStyle, null));

    set('--cb-box-variant-color', normalizeHexColor(designSettings.variantSelectorColor, null));
    set('--cb-box-variant-size', px(designSettings.variantSelectorSize));
    set('--cb-box-variant-weight', resolveFontWeight(designSettings.variantSelectorStyle, null));
    set('--cb-filter-title-size', designSettings.titleSize != null ? (Math.max(14, Math.min(20, parseInt(String(designSettings.titleSize), 10) || 16)) + 'px') : null);
    set('--cb-filter-section-size', designSettings.variantSelectorSize != null ? (Math.max(12, Math.min(15, parseInt(String(designSettings.variantSelectorSize), 10) || 13)) + 'px') : null);
    set('--cb-filter-body-size', designSettings.variantSelectorSize != null ? (Math.max(11, Math.min(14, parseInt(String(designSettings.variantSelectorSize), 10) || 12)) + 'px') : null);
    set('--cb-filter-heading-color', normalizeHexColor(designSettings.titleTextColor, null));
    set('--cb-filter-body-color', normalizeHexColor(designSettings.variantSelectorColor, null));

    set('--cb-box-popup-bg', normalizeHexColor(designSettings.imagePopupBackgroundColor, null));
    set('--cb-box-popup-color', normalizeHexColor(designSettings.imagePopupTextColor, null));

    return decls.join(';');
  }

  function applyBoxDesignStyle(el, designSettings) {
    if (!el) return;
    var style = buildBoxDesignStyle(designSettings);
    if (!style) return;
    style.split(';').forEach(function (decl) {
      var idx = decl.indexOf(':');
      if (idx <= 0) return;
      el.style.setProperty(decl.slice(0, idx), decl.slice(idx + 1));
    });
  }

  function normalizeProductCardsPerRow(value) {
    var parsed = parseInt(value, 10);
    return [3, 4, 5, 6].indexOf(parsed) !== -1 ? parsed : 4;
  }

  function normalizeProductGridControlPerRow(value) {
    var parsed = parseInt(value, 10);
    return [3, 4, 5].indexOf(parsed) !== -1 ? parsed : 4;
  }

  function normalizeOptionList(options) {
    if (!Array.isArray(options)) return [];
    return options.map(function (option) {
      if (!option) return null;
      var name = option.name || option;
      var values = Array.isArray(option.values) ? option.values : [];
      return {
        name: String(name || '').trim(),
        values: values.map(function (value) { return String(value || '').trim(); }).filter(Boolean)
      };
    }).filter(function (option) { return option && option.name && option.values.length > 0; });
  }

  function getProductColorValues(product) {
    var values = [];
    if (Array.isArray(product && product.colorValues)) values = values.concat(product.colorValues);
    var options = normalizeOptionList(product && product.productOptions);
    options.forEach(function (option) {
      if (/^(color|colour)$/i.test(option.name)) values = values.concat(option.values);
    });
    if (Array.isArray(product && product.variants)) {
      product.variants.forEach(function (variant) {
        (variant.selectedOptions || []).forEach(function (option) {
          if (option && /^(color|colour)$/i.test(option.name)) values.push(option.value);
        });
      });
    }
    var seen = {};
    return values.map(function (value) { return String(value || '').trim(); })
      .filter(function (value) {
        var key = value.toLowerCase();
        if (!value || seen[key]) return false;
        seen[key] = true;
        return true;
      });
  }

  function productMatchesColor(product, color) {
    if (!color) return true;
    var wanted = String(color).toLowerCase();
    return getProductColorValues(product).some(function (value) {
      return String(value).toLowerCase() === wanted;
    });
  }

  function isProductAvailable(product) {
    var productQuantity = product && (
      product.productQuantity != null
        ? product.productQuantity
        : product.inventoryQuantity != null
          ? product.inventoryQuantity
          : product.quantity
    );
    if (productQuantity != null && productQuantity !== '') return Number(productQuantity) > 0;
    if (Array.isArray(product && product.variants) && product.variants.length > 0) {
      return product.variants.some(isVariantAvailable);
    }
    return true;
  }

  function markProductCardSoldOut(card, addBtn) {
    if (!addBtn) return;
    addBtn.textContent = 'Sold Out';
    addBtn.disabled = true;
    addBtn.classList.add('cb-add-btn--sold-out');
    if (card) card.setAttribute('aria-disabled', 'true');
  }

  function parseBooleanSetting(value, fallback) {
    if (value == null || value === '') return !!fallback;
    if (typeof value === 'boolean') return value;
    var normalized = String(value).trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
    return !!fallback;
  }

  function normalizeHexColor(value, fallback) {
    if (value == null) return fallback;
    var raw = String(value).trim();
    if (!raw) return fallback;
    if (/^#[0-9a-f]{6}$/i.test(raw)) return raw;
    if (/^#[0-9a-f]{3}$/i.test(raw)) {
      return '#' +
        raw.charAt(1) + raw.charAt(1) +
        raw.charAt(2) + raw.charAt(2) +
        raw.charAt(3) + raw.charAt(3);
    }
    return fallback;
  }

  function pickReadableTextColor(backgroundColor, darkText, lightText) {
    var fallbackDark = darkText || '#111827';
    var fallbackLight = lightText || '#ffffff';
    var hex = normalizeHexColor(backgroundColor, '');
    if (!hex) return fallbackLight;

    var r = parseInt(hex.slice(1, 3), 16);
    var g = parseInt(hex.slice(3, 5), 16);
    var b = parseInt(hex.slice(5, 7), 16);
    var perceivedBrightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;

    return perceivedBrightness >= 160 ? fallbackDark : fallbackLight;
  }

  function getSelectedProductsTotal(slots) {
    var total = 0;
    (slots || []).forEach(function (p) {
      if (!p) return;
      if (p.productPrice != null && parseFloat(p.productPrice) > 0) {
        total += parseFloat(p.productPrice);
      }
    });
    return total;
  }

  function getBuyXGetYFreeUnits(totalQty, buyQty, getQty) {
    var safeQty = Math.max(0, parseInt(String(totalQty || 0), 10) || 0);
    var safeBuyQty = Math.max(1, parseInt(String(buyQty || 1), 10) || 1);
    var safeGetQty = Math.max(1, parseInt(String(getQty || 1), 10) || 1);
    var groupSize = safeBuyQty + safeGetQty;
    if (safeQty <= 0 || groupSize <= 0) return 0;
    var fullGroups = Math.floor(safeQty / groupSize);
    var remainder = safeQty % groupSize;
    var partialFree = Math.max(0, Math.min(safeGetQty, remainder - safeBuyQty));
    return (fullGroups * safeGetQty) + partialFree;
  }

  function getBuyXGetYDiscountAmount(totalPrice, comboConfig, selectedItems) {
    if (!(totalPrice > 0) || !comboConfig) return 0;

    var unitPrices = [];
    if (Array.isArray(selectedItems)) {
      selectedItems.forEach(function (item) {
        if (!item) return;
        var raw = item;
        if (typeof item === 'object') raw = item.productPrice != null ? item.productPrice : item.price;
        var parsed = parseFloat(raw);
        if (parsed > 0) unitPrices.push(parsed);
      });
    }

    var quantity = unitPrices.length;
    if (quantity <= 0) {
      quantity = Math.max(0, parseInt(String(comboConfig.type || 0), 10) || 0);
    }
    if (quantity <= 0) return 0;

    var freeUnits = getBuyXGetYFreeUnits(quantity, comboConfig.buyQuantity, comboConfig.getQuantity);
    if (freeUnits <= 0) return 0;

    var freeAmount = 0;
    if (unitPrices.length >= freeUnits) {
      unitPrices.sort(function (a, b) { return a - b; });
      for (var i = 0; i < freeUnits; i++) freeAmount += unitPrices[i] || 0;
    } else {
      freeAmount = (totalPrice / quantity) * freeUnits;
    }

    return Math.min(totalPrice, freeAmount);
  }

  function getComboDiscountBreakdown(totalPrice, comboConfig, selectedItems) {
    var baseTotal = parseFloat(totalPrice) || 0;
    if (baseTotal <= 0 || !comboConfig) {
      return { discountedTotal: Math.max(0, baseTotal), discountAmount: 0, freeUnits: 0 };
    }

    var discountType = comboConfig.discountType || 'none';
    var discountValue = parseFloat(comboConfig.discountValue) || 0;

    if (discountType === 'percent') {
      var percentDiscount = Math.min(baseTotal, Math.max(0, baseTotal * (discountValue / 100)));
      return { discountedTotal: Math.max(0, baseTotal - percentDiscount), discountAmount: percentDiscount, freeUnits: 0 };
    }
    if (discountType === 'fixed') {
      var fixedDiscount = Math.min(baseTotal, Math.max(0, discountValue));
      return { discountedTotal: Math.max(0, baseTotal - fixedDiscount), discountAmount: fixedDiscount, freeUnits: 0 };
    }
    if (discountType === 'buy_x_get_y') {
      var bxgyDiscount = getBuyXGetYDiscountAmount(baseTotal, comboConfig, selectedItems);
      var bxgyFreeUnits = 0;
      if (Array.isArray(selectedItems)) {
        var qty = 0;
        selectedItems.forEach(function (item) {
          if (!item) return;
          var raw = item;
          if (typeof item === 'object') raw = item.productPrice != null ? item.productPrice : item.price;
          if ((parseFloat(raw) || 0) > 0) qty += 1;
        });
        bxgyFreeUnits = getBuyXGetYFreeUnits(qty, comboConfig.buyQuantity, comboConfig.getQuantity);
      }
      return {
        discountedTotal: Math.max(0, baseTotal - bxgyDiscount),
        discountAmount: Math.max(0, bxgyDiscount),
        freeUnits: Math.max(0, bxgyFreeUnits),
      };
    }

    return { discountedTotal: Math.max(0, baseTotal), discountAmount: 0, freeUnits: 0 };
  }

  function applyComboDiscount(price, comboConfig, selectedItems) {
    return getComboDiscountBreakdown(price, comboConfig, selectedItems).discountedTotal;
  }

  function renderStickyTotal(totalEl, amount, currencySymbol) {
    if (!totalEl) return;
    var parsedAmount = parseFloat(amount);
    var hasAmount = !isNaN(parsedAmount);
    totalEl.innerHTML =
      'Total <span class="cb-sticky-price">' +
      (hasAmount ? (formatPrice(parsedAmount, currencySymbol, null) + '/-') : '') +
      '</span>';
  }

  function setBoxCardPrice(box, amount, currencySymbol) {
    if (!box || !box._priceTextEl) return;
    var parsedAmount = parseFloat(amount);
    if (isDynamicBundlePrice(box) && !(parsedAmount > 0)) {
      box._priceTextEl.textContent = '';
      box._priceTextEl.style.display = 'none';
      return;
    }
    box._priceTextEl.style.display = '';
    box._priceTextEl.textContent = formatPrice(parsedAmount || 0, currencySymbol, null);
  }

  function getDynamicDisplayPrice(amount) {
    var parsedAmount = parseFloat(amount);
    return parsedAmount > 0 ? parsedAmount : null;
  }

  function setWizardStep2Preview(ctx, slots) {
    // Indicator is styled via CSS class — no content insertion needed
  }

  function resolveAddToCartLabel(settings, ctxOverride, box) {
    if (box) {
      var boxLabel = resolveBoxButtonLabel(box);
      if (boxLabel && String(boxLabel).trim()) return String(boxLabel).trim();
    }
    if (ctxOverride && String(ctxOverride).trim()) return String(ctxOverride).trim();
    var label = settings && settings.addToCartLabel != null
      ? String(settings.addToCartLabel).trim()
      : '';
    if (!label || label.toUpperCase() === 'ADD TO CART') return 'Add To Cart';
    return label;
  }

  function resolveCtaButtonLabel(settings, boxOverride) {
    if (boxOverride && String(boxOverride).trim()) return String(boxOverride).trim();
    var label = settings && settings.ctaButtonLabel != null
      ? String(settings.ctaButtonLabel).trim()
      : '';
    if (!label) return 'BUILD YOUR OWN BOX';
    return label;
  }

  function resolveBoxButtonLabel(box) {
    var label = '';
    if (box && box.productButtonTitle != null) label = String(box.productButtonTitle).trim();
    if (box && box.addToCartLabel != null) label = String(box.addToCartLabel).trim();
    // Single/Multiple Box page (or, once a pack is chosen, pack-level) button label
    if (!label && box && box.buttonLabel) label = String(box.buttonLabel).trim();
    if (!label && box && box.comboConfig && box.comboConfig.productButtonTitle != null) {
      label = String(box.comboConfig.productButtonTitle).trim();
    }
    if (!label && box && box.comboConfig && box.comboConfig.addToCartLabel != null) {
      label = String(box.comboConfig.addToCartLabel).trim();
    }
    return label;
  }

  function resolveProductGridButtonLabel(box, settings) {
    var label = resolveBoxButtonLabel(box);
    if (!label && settings && settings.addToCartLabel != null) {
      label = String(settings.addToCartLabel).trim();
    }
    return label || 'ADD TO BOX';
  }

  function resolveStepSelectionButtonLabel(stepCfg, box, settings) {
    var label = '';
    if (stepCfg && stepCfg.popup && stepCfg.popup.btn != null) {
      label = String(stepCfg.popup.btn).trim();
    }
    if (label) return label;
    return resolveProductGridButtonLabel(box, settings);
  }

  function resolveStepCartButtonLabel(box, ctx) {
    var label = resolveProductGridButtonLabel(box, ctx && ctx.settings);
    if (label && String(label).trim()) return String(label).trim();
    return resolveAddToCartLabel(ctx && ctx.settings, ctx && ctx.cartBtnLabel);
  }

  function setWizardSelectedPrice(ctx, box, amount) {
    if (!ctx || ctx.layoutMode !== 'steps' || !ctx._wizardSelectedPriceEl) return;
    var el = ctx._wizardSelectedPriceEl;
    var parsedAmount = parseFloat(amount);
    var shouldHide = isNaN(parsedAmount) || (isDynamicBundlePrice(box) && !(parsedAmount > 0));

    if (shouldHide) {
      el.style.display = 'none';
      el.innerHTML = '';
      return;
    }

    el.innerHTML = 'Selected Combo Price: <span class="cb-wizard-selected-price-value">' +
      formatPrice(parsedAmount, ctx.currencySymbol, ctx.currencyCode) +
      '</span>';
    el.style.display = 'flex';
  }

  // ─── Preset Theme Palettes ────────────────────────────────────────────────────

  var PRESET_THEMES = {
    'oh-so-minimal':     { primary: '#1a1a1a', bg: '#fafafa', text: '#111827', muted: '#000000', border: '#e5e7eb', idleNum: '#d1d5db', accentLt: '#f3f4f6', headingClr: '#1a1a1a' },
    'fresh-gradient':    { primary: '#7c3aed', bg: '#faf5ff', text: '#1e1b4b', muted: '#6d28d9', border: '#ede9fe', idleNum: '#c4b5fd', accentLt: '#ede9fe', headingClr: '#5b21b6' },
    'aqua':              { primary: '#0891b2', bg: '#ecfeff', text: '#0c4a6e', muted: '#0e7490', border: '#cffafe', idleNum: '#a5f3fc', accentLt: '#cffafe', headingClr: '#0e7490' },
    'golden-hour':       { primary: '#d97706', bg: '#fffbeb', text: '#1c1917', muted: '#b45309', border: '#fde68a', idleNum: '#fcd34d', accentLt: '#fef3c7', headingClr: '#92400e' },
    'sharp-edge':        { primary: '#000000', bg: '#ffffff', text: '#000000', muted: '#374151', border: '#000000', idleNum: '#9ca3af', accentLt: '#f3f4f6', headingClr: '#000000' },
    'poseidon':          { primary: '#38bdf8', bg: '#0c1445', text: '#e0f2fe', muted: '#93c5fd', border: '#1e3a8a', idleNum: '#475569', accentLt: '#1e3a8a', headingClr: '#7dd3fc' },
    'sand-dunes':        { primary: '#92400e', bg: '#fef9ee', text: '#1c1917', muted: '#78350f', border: '#fcd34d', idleNum: '#fbbf24', accentLt: '#fef3c7', headingClr: '#78350f' },
    'bubblegum':         { primary: '#db2777', bg: '#fdf2f8', text: '#831843', muted: '#be185d', border: '#fbcfe8', idleNum: '#f9a8d4', accentLt: '#fce7f3', headingClr: '#9d174d' },
    'cape-town':         { primary: '#dc2626', bg: '#f8fafc', text: '#0f172a', muted: '#64748b', border: '#fee2e2', idleNum: '#fca5a5', accentLt: '#fee2e2', headingClr: '#991b1b' },
    'blackout':          { primary: '#e5e7eb', bg: '#000000', text: '#f9fafb', muted: '#9ca3af', border: '#374151', idleNum: '#4b5563', accentLt: '#1f2937', headingClr: '#f3f4f6' },
    'urban-underground': { primary: '#a855f7', bg: '#1e1b4b', text: '#f5f3ff', muted: '#c084fc', border: '#312e81', idleNum: '#4c1d95', accentLt: '#2e1065', headingClr: '#d8b4fe' },
    'cyber-pink':        { primary: '#ec4899', bg: '#0f172a', text: '#fce7f3', muted: '#f472b6', border: '#1e1b4b', idleNum: '#4c1d95', accentLt: '#1e1b4b', headingClr: '#f9a8d4' },
    'key-lime-pie':      { primary: '#84cc16', bg: '#111827', text: '#f7fee7', muted: '#a3e635', border: '#1f2937', idleNum: '#374151', accentLt: '#1a2e05', headingClr: '#bef264' },
    'lemonade':          { primary: '#ca8a04', bg: '#fefce8', text: '#1c1917', muted: '#a16207', border: '#fef08a', idleNum: '#fde047', accentLt: '#fefce8', headingClr: '#854d0e' },
    'nile':              { primary: '#f59e0b', bg: '#0c1a0e', text: '#f0fdf4', muted: '#fbbf24', border: '#14532d', idleNum: '#166534', accentLt: '#052e16', headingClr: '#fcd34d' },
    'lavender':          { primary: '#8b5cf6', bg: '#f5f3ff', text: '#1e1b4b', muted: '#7c3aed', border: '#ddd6fe', idleNum: '#c4b5fd', accentLt: '#ede9fe', headingClr: '#5b21b6' },
    'magma-lake':        { primary: '#f97316', bg: '#1c0a00', text: '#fff7ed', muted: '#fb923c', border: '#431407', idleNum: '#7c2d12', accentLt: '#431407', headingClr: '#fed7aa' },
    'smooth-silk':       { primary: '#f43f5e', bg: '#fff1f2', text: '#1c0a0e', muted: '#be123c', border: '#fecdd3', idleNum: '#fda4af', accentLt: '#ffe4e6', headingClr: '#9f1239' },
  };

  function applyPresetTheme(rootEl, themeName) {
    if (!themeName || themeName === 'custom' || !PRESET_THEMES[themeName]) return;
    var t = PRESET_THEMES[themeName];
    var buttonTextColor = pickReadableTextColor(t.primary, '#111827', '#ffffff');
    var instance = rootEl.getAttribute('data-cb-instance') || rootEl.getAttribute('data-block-id');
    if (!instance) return;

    var styleId = 'cb-theme-override-' + instance;
    var existing = document.getElementById(styleId);
    if (existing) existing.parentNode.removeChild(existing);

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = '[data-cb-instance="' + instance + '"] {' +
      '--cb-primary:' + t.primary + ';' +
      '--cb-primary-hover:' + t.primary + ';' +
      '--cb-primary-light:' + t.accentLt + ';' +
      '--cb-primary-glow:' + t.primary + '33;' +
      '--cb-active-slot:' + t.primary + ';' +
      '--cb-bg:' + t.bg + ';' +
      '--cb-text:' + t.text + ';' +
      '--cb-text-muted:' + t.muted + ';' +
      '--cb-border:' + t.border + ';' +
      '--cb-border-dashed:' + t.border + ';' +
      '--cb-idle-num:' + t.idleNum + ';' +
      '--cb-product-card-bg:' + t.bg + ';' +
      '--cb-product-font-color:' + t.text + ';' +
      '--cb-product-btn-bg:' + t.primary + ';' +
      '--cb-product-btn-text:' + buttonTextColor + ';' +
    '}';
    // Append to body so this rule comes after the liquid block's <style> in
    // document order, winning the CSS cascade at equal specificity.
    document.body.appendChild(style);
  }

  function applyCustomColors(rootEl, settings) {
    if (!settings) return;
    var primaryColor = normalizeHexColor(settings.buttonColor, '#2A7A4F');
    var activeSlotColor = normalizeHexColor(settings.activeSlotColor, primaryColor);
    var cardBgColor = normalizeHexColor(
      settings.productCardBackgroundColor || settings.cardBackgroundColor || settings.cardBgColor || settings.backgroundColor,
      '#ffffff'
    );
    var fontColor = normalizeHexColor(
      settings.productCardFontColor || settings.fontColor || settings.textColor,
      pickReadableTextColor(cardBgColor, '#111827', '#ffffff')
    );
    var buttonTextColor = normalizeHexColor(
      settings.buttonTextColor || settings.buttonFontColor,
      pickReadableTextColor(primaryColor, '#111827', '#ffffff')
    );
    var instance = rootEl.getAttribute('data-cb-instance') || rootEl.getAttribute('data-block-id');
    if (!instance) return;

    var styleId = 'cb-custom-colors-' + instance;
    var existing = document.getElementById(styleId);
    if (existing) existing.parentNode.removeChild(existing);

    var style = document.createElement('style');
    style.id = styleId;
    style.textContent = '[data-cb-instance="' + instance + '"] {' +
      '--cb-primary:' + primaryColor + ';' +
      '--cb-primary-hover:' + activeSlotColor + ';' +
      '--cb-primary-glow:' + primaryColor + '33;' +
      '--cb-active-slot:' + activeSlotColor + ';' +
      '--cb-product-card-bg:' + cardBgColor + ';' +
      '--cb-product-font-color:' + fontColor + ';' +
      '--cb-product-btn-bg:' + primaryColor + ';' +
      '--cb-product-btn-text:' + buttonTextColor + ';' +
    '}';
    document.body.appendChild(style);
  }

  // ─── Variant Cache + Picker ───────────────────────────────────────────────────

  var productDataCache = {};
  var productDataPending = {};
  var _productDescriptionModal = null;
  var _productDescriptionModalTitle = null;
  var _productDescriptionModalBody = null;
  var _productDescriptionModalCloseBtn = null;
  var _productDescriptionModalLastFocus = null;
  var _productDescriptionModalBodyOverflow = '';
  var _productDescriptionModalRequestToken = 0;

  function sanitizeProductDescriptionHtml(html) {
    var wrapper = document.createElement('div');
    wrapper.innerHTML = html || '';

    Array.prototype.forEach.call(
      wrapper.querySelectorAll('script, iframe, object, embed'),
      function (node) {
        if (node.parentNode) node.parentNode.removeChild(node);
      }
    );

    Array.prototype.forEach.call(wrapper.querySelectorAll('*'), function (node) {
      for (var i = node.attributes.length - 1; i >= 0; i--) {
        var attrName = node.attributes[i].name;
        if (/^on/i.test(attrName)) node.removeAttribute(attrName);
      }
    });

    return wrapper.innerHTML;
  }

  function fetchProductData(handle, cb) {
    if (!handle) {
      cb(new Error('Missing product handle'), null);
      return;
    }

    if (productDataCache[handle]) {
      cb(null, productDataCache[handle]);
      return;
    }

    if (productDataPending[handle]) {
      productDataPending[handle].push(cb);
      return;
    }

    productDataPending[handle] = [cb];

    fetch('/products/' + handle + '.js')
      .then(function (r) {
        if (!r.ok) throw new Error('Failed to load product details');
        return r.json();
      })
      .then(function (data) {
        var normalized = {
          descriptionHtml: sanitizeProductDescriptionHtml(data && data.description),
          variants: (data && data.variants ? data.variants : []).map(function (v) {
            return {
              id: String(v.id),
              title: v.title,
              available: isVariantAvailable(v),
              inventoryQuantity: getVariantInventoryQuantity(v),
              // Shopify product JSON returns variant prices in the smallest unit.
              price: v.price != null ? (parseFloat(v.price) / 100) : null,
              compareAtPrice: v.compare_at_price != null ? (parseFloat(v.compare_at_price) / 100) : null,
            };
          }),
        };

        productDataCache[handle] = normalized;

        var queued = productDataPending[handle] || [];
        delete productDataPending[handle];
        queued.forEach(function (done) { done(null, normalized); });
      })
      .catch(function (err) {
        var queued = productDataPending[handle] || [];
        delete productDataPending[handle];
        queued.forEach(function (done) { done(err, null); });
      });
  }

  function ensureProductDescriptionModal() {
    if (_productDescriptionModal) return _productDescriptionModal;

    var overlay = document.createElement('div');
    overlay.className = 'cb-product-modal';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    var dialog = document.createElement('div');
    dialog.className = 'cb-product-modal-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'cb-product-modal-title');
    dialog.addEventListener('click', function (e) { e.stopPropagation(); });

    var header = document.createElement('div');
    header.className = 'cb-product-modal-header';

    var title = document.createElement('h3');
    title.className = 'cb-product-modal-title';
    title.id = 'cb-product-modal-title';
    header.appendChild(title);

    var closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'cb-product-modal-close';
    closeBtn.setAttribute('aria-label', 'Close description popup');
    closeBtn.innerHTML = '&times;';
    header.appendChild(closeBtn);

    var body = document.createElement('div');
    body.className = 'cb-product-modal-body';

    dialog.appendChild(header);
    dialog.appendChild(body);
    overlay.appendChild(dialog);

    overlay.addEventListener('click', closeProductDescriptionModal);
    closeBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      closeProductDescriptionModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && _productDescriptionModal && !_productDescriptionModal.hidden) {
        closeProductDescriptionModal();
      }
    });

    document.body.appendChild(overlay);

    _productDescriptionModal = overlay;
    _productDescriptionModalTitle = title;
    _productDescriptionModalBody = body;
    _productDescriptionModalCloseBtn = closeBtn;

    return _productDescriptionModal;
  }

  function closeProductDescriptionModal() {
    if (!_productDescriptionModal || _productDescriptionModal.hidden) return;

    _productDescriptionModal.hidden = true;
    _productDescriptionModal.setAttribute('aria-hidden', 'true');
    _productDescriptionModal.removeAttribute('data-cb-instance');
    _productDescriptionModal.classList.remove('cb-product-modal--info');
    document.body.style.overflow = _productDescriptionModalBodyOverflow;

    if (
      _productDescriptionModalLastFocus &&
      typeof _productDescriptionModalLastFocus.focus === 'function'
    ) {
      _productDescriptionModalLastFocus.focus();
    }
  }

  function openProductDescriptionModal(product, triggerEl, rootEl, designStyle) {
    if (!product || !product.productHandle) return;

    var modal = ensureProductDescriptionModal();
    modal.classList.remove('cb-product-modal--info');
    var blockId = rootEl &&
      (rootEl.getAttribute('data-cb-instance') || rootEl.getAttribute('data-block-id'));
    var requestToken = ++_productDescriptionModalRequestToken;

    // Popup bg/text color are per-box design settings — the modal is a single
    // shared DOM node appended to <body>, so it needs its own inline style
    // scoped to whichever box's product was clicked, same idea as data-cb-instance.
    var dialogEl = modal.querySelector('.cb-product-modal-dialog');
    if (dialogEl) dialogEl.setAttribute('style', designStyle || '');

    _productDescriptionModalLastFocus = triggerEl || document.activeElement;
    _productDescriptionModalBodyOverflow = document.body.style.overflow;
    _productDescriptionModalTitle.textContent = product.productTitle || 'Product details';
    _productDescriptionModalBody.innerHTML =
      '<p class="cb-product-modal-loading">Loading description...</p>';

    if (blockId) modal.setAttribute('data-cb-instance', blockId);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    if (product.productDescriptionResolved) {
      _productDescriptionModalBody.innerHTML = product.productDescriptionHtml ||
        '<p class="cb-product-modal-empty">No description available for this product.</p>';
      if (_productDescriptionModalCloseBtn) _productDescriptionModalCloseBtn.focus();
      return;
    }

    fetchProductData(product.productHandle, function (err, data) {
      if (requestToken !== _productDescriptionModalRequestToken) return;

      product.productDescriptionResolved = !err;
      product.productDescriptionHtml =
        !err && data && data.descriptionHtml
          ? data.descriptionHtml
          : '';

      _productDescriptionModalBody.innerHTML = product.productDescriptionHtml ||
        '<p class="cb-product-modal-empty">No description available for this product.</p>';

      if (_productDescriptionModalCloseBtn) _productDescriptionModalCloseBtn.focus();
    });
  }

  function openProductInfoModal(product, triggerEl, rootEl, designStyle, options, onAdd) {
    if (!product || !product.productHandle || typeof onAdd !== 'function') return false;

    options = options || {};
    var modal = ensureProductDescriptionModal();
    var blockId = rootEl &&
      (rootEl.getAttribute('data-cb-instance') || rootEl.getAttribute('data-block-id'));
    var requestToken = ++_productDescriptionModalRequestToken;
    var dialogEl = modal.querySelector('.cb-product-modal-dialog');
    var blockedSet = {};
    (options.blockedVariantIds || []).forEach(function (id) {
      blockedSet[String(id)] = true;
    });

    if (dialogEl) dialogEl.setAttribute('style', designStyle || '');
    modal.classList.add('cb-product-modal--info');
    _productDescriptionModalLastFocus = triggerEl || document.activeElement;
    _productDescriptionModalBodyOverflow = document.body.style.overflow;
    _productDescriptionModalTitle.textContent = product.productTitle || 'Product details';
    _productDescriptionModalBody.innerHTML = '';

    if (blockId) modal.setAttribute('data-cb-instance', blockId);
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    var info = document.createElement('div');
    info.className = 'cb-product-info-modal';

    var media = document.createElement('div');
    media.className = 'cb-product-info-modal-media';
    if (product.productImageUrl) {
      var img = document.createElement('img');
      img.src = product.productImageUrl;
      img.alt = product.productTitle || '';
      img.loading = 'lazy';
      media.appendChild(img);
    } else {
      var placeholder = document.createElement('div');
      placeholder.className = 'cb-product-info-modal-placeholder';
      placeholder.textContent = (product.productTitle || '?').charAt(0).toUpperCase();
      media.appendChild(placeholder);
    }
    info.appendChild(media);

    var details = document.createElement('div');
    details.className = 'cb-product-info-modal-details';

    var title = document.createElement('h4');
    title.className = 'cb-product-info-modal-title';
    title.textContent = product.productTitle || 'Product';
    details.appendChild(title);

    var priceWrap = document.createElement('div');
    priceWrap.className = 'cb-product-info-modal-price';
    details.appendChild(priceWrap);

    function renderModalPrice(price, compareAt) {
      priceWrap.innerHTML = '';
      var sp = price != null ? parseFloat(price) : null;
      var cp = compareAt != null ? parseFloat(compareAt) : null;
      if (sp && sp > 0) {
        var pEl = document.createElement('span');
        pEl.textContent = formatPrice(sp, options.currencySymbol, options.currencyCode);
        priceWrap.appendChild(pEl);
        if (options.showCompareAtPrice && cp && cp > sp) {
          var cEl = document.createElement('span');
          cEl.className = 'cb-product-info-modal-compare';
          cEl.textContent = formatPrice(cp, options.currencySymbol, options.currencyCode);
          priceWrap.appendChild(cEl);
        }
      }
    }

    var selectedVariantId = options.selectedVariantId || null;
    var selectedVariantTitle = options.selectedVariantTitle || null;
    var selectedVariantPrice = options.selectedVariantPrice != null ? options.selectedVariantPrice : product.productPrice;
    var selectedVariantCompare = options.selectedVariantCompareAtPrice != null
      ? options.selectedVariantCompareAtPrice
      : product.productCompareAtPrice;
    renderModalPrice(selectedVariantPrice, selectedVariantCompare);

    var variantGroup = document.createElement('div');
    variantGroup.className = 'cb-product-info-modal-variant';
    variantGroup.hidden = true;
    var variantLabel = document.createElement('label');
    variantLabel.textContent = 'Title';
    variantGroup.appendChild(variantLabel);
    var variantSelect = document.createElement('select');
    variantSelect.className = 'cb-product-info-modal-select';
    variantSelect.disabled = true;
    var loadingOpt = document.createElement('option');
    loadingOpt.textContent = 'Loading options...';
    variantSelect.appendChild(loadingOpt);
    variantGroup.appendChild(variantSelect);
    details.appendChild(variantGroup);

    var addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'cb-product-info-modal-add';
    addBtn.textContent = options.buttonLabel || 'Add to Bundle';
    addBtn.disabled = true;
    details.appendChild(addBtn);

    var learnMoreBtn = document.createElement('button');
    learnMoreBtn.type = 'button';
    learnMoreBtn.className = 'cb-product-info-modal-learn';
    learnMoreBtn.innerHTML = LEARN_MORE_ICON_SVG + '<span>Learn more</span>';
    learnMoreBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openProductDescriptionModal(product, learnMoreBtn, rootEl, designStyle);
    });
    details.appendChild(learnMoreBtn);

    info.appendChild(details);
    _productDescriptionModalBody.appendChild(info);

    function setSelectedVariant(variant) {
      if (!variant) return;
      selectedVariantId = variant.id;
      selectedVariantTitle = variant.title !== 'Default Title' ? variant.title : null;
      selectedVariantPrice = variant.price != null ? variant.price : product.productPrice;
      selectedVariantCompare = variant.compareAtPrice != null ? variant.compareAtPrice : product.productCompareAtPrice;
      renderModalPrice(selectedVariantPrice, selectedVariantCompare);
      addBtn.disabled = false;
    }

    function renderVariantOptions(variants) {
      variantSelect.innerHTML = '';
      variantGroup.hidden = false;
      variantSelect.disabled = false;
      var firstAvailable = null;
      variants.forEach(function (variant) {
        var isBlocked = !!blockedSet[String(variant.id)];
        var isUnavailable = !isVariantAvailable(variant);
        var isDisabled = isUnavailable || isBlocked;
        var option = document.createElement('option');
        option.value = variant.id;
        option.disabled = isDisabled;
        option.textContent = variant.title + (isUnavailable ? ' - Out of stock' : (isBlocked ? ' - Already in box' : ''));
        variantSelect.appendChild(option);
        if (!firstAvailable && !isDisabled) firstAvailable = variant;
      });

      variantSelect._cbVariants = variants;
      if (selectedVariantId) {
        var selected = variants.filter(function (variant) {
          return String(variant.id) === String(selectedVariantId) && !variantSelect.querySelector('option[value="' + variant.id + '"]').disabled;
        })[0];
        if (selected) firstAvailable = selected;
      }

      if (firstAvailable) {
        variantSelect.value = firstAvailable.id;
        setSelectedVariant(firstAvailable);
      } else {
        var emptyOpt = document.createElement('option');
        emptyOpt.textContent = 'No available options';
        variantSelect.innerHTML = '';
        variantSelect.appendChild(emptyOpt);
        variantSelect.disabled = true;
        addBtn.disabled = true;
      }
    }

    variantSelect.addEventListener('change', function () {
      var variants = variantSelect._cbVariants || [];
      for (var i = 0; i < variants.length; i++) {
        if (String(variants[i].id) === String(variantSelect.value)) {
          setSelectedVariant(variants[i]);
          break;
        }
      }
    });

    addBtn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!selectedVariantId) return;
      closeProductDescriptionModal();
      onAdd(selectedVariantId, selectedVariantTitle, selectedVariantPrice, selectedVariantCompare);
    });

    fetchVariants(product.productHandle, product.variantIds, function (err, variants) {
      if (requestToken !== _productDescriptionModalRequestToken) return;
      if (err || !variants || variants.length === 0) {
        var fallbackId = product.variantIds && product.variantIds[0] ? String(product.variantIds[0]) : null;
        variantGroup.hidden = true;
        if (fallbackId && !blockedSet[fallbackId]) {
          selectedVariantId = fallbackId;
          selectedVariantTitle = null;
          addBtn.disabled = false;
        } else {
          variantSelect.innerHTML = '<option>No available options</option>';
        }
        return;
      }
      if (variants.length <= 1) {
        var onlyVariant = variants[0];
        if (onlyVariant && isVariantAvailable(onlyVariant) && !blockedSet[String(onlyVariant.id)]) {
          variantGroup.hidden = true;
          setSelectedVariant(onlyVariant);
        } else {
          variantGroup.hidden = true;
          variantSelect.innerHTML = '';
          addBtn.disabled = true;
        }
        return;
      }
      renderVariantOptions(variants);
    });

    if (_productDescriptionModalCloseBtn) _productDescriptionModalCloseBtn.focus();
    return true;
  }

  function fetchVariants(handle, allowedVariantIds, cb) {
    function applyAllowedFilter(variants) {
      var all = Array.isArray(variants) ? variants.slice() : [];
      // Historical boxes may contain only one saved variant ID for multi-variant products.
      // Only enforce allow-list filtering when there is an explicit multi-variant allow-list.
      if (allowedVariantIds && allowedVariantIds.length > 1) {
        var allowed = allowedVariantIds.map(String);
        all = all.filter(function (v) { return allowed.indexOf(v.id) !== -1; });
      }
      return all;
    }

    fetchProductData(handle, function (err, productData) {
      if (err) {
        cb(err, null);
        return;
      }
      cb(null, applyAllowedFilter(productData.variants));
    });
  }

  function showVariantPicker(card, product, addBtn, blockedVariantIds, cb) {
    if ((addBtn && addBtn.disabled) || !isProductAvailable(product)) {
      markProductCardSoldOut(card, addBtn);
      return;
    }

    addBtn.style.display = 'none';

    var picker = document.createElement('div');
    picker.className = 'cb-variant-picker';
    card.insertBefore(picker, addBtn);
    card.classList.add('cb-product-card--picking');

    var titleEl = document.createElement('div');
    titleEl.className = 'cb-variant-picker-title';
    titleEl.textContent = 'Select option:';
    picker.appendChild(titleEl);

    var loadingEl = document.createElement('span');
    loadingEl.className = 'cb-variant-picker-loading';
    loadingEl.textContent = 'Loading…';
    picker.appendChild(loadingEl);

    function closePicker() {
      card.classList.remove('cb-product-card--picking');
      if (picker.parentNode) picker.parentNode.removeChild(picker);
      addBtn.style.display = '';
    }

    fetchVariants(product.productHandle, product.variantIds, function (err, variants) {
      if (picker.contains(loadingEl)) picker.removeChild(loadingEl);

      var blockedSet = {};
      (blockedVariantIds || []).forEach(function (id) {
        blockedSet[String(id)] = true;
      });

      if (err || !variants || variants.length === 0) {
        closePicker();
        cb(
          product.variantIds && product.variantIds[0] ? product.variantIds[0] : null,
          '',
          product.productPrice,
          product.productCompareAtPrice
        );
        return;
      }

      if (variants.length === 1) {
        var only = variants[0];
        var onlyBlocked = !!blockedSet[String(only.id)];
        var onlyUnavailable = !isVariantAvailable(only);
        if (!onlyBlocked && !onlyUnavailable) {
          closePicker();
          cb(
            only.id,
            only.title !== 'Default Title' ? only.title : '',
            only.price,
            only.compareAtPrice
          );
          return;
        }
        closePicker();
        if (onlyUnavailable) markProductCardSoldOut(card, addBtn);
        return;
      }

      var btnsDiv = document.createElement('div');
      btnsDiv.className = 'cb-variant-btns';
      var selectableCount = 0;
      variants.forEach(function (v) {
        var isBlocked = !!blockedSet[String(v.id)];
        var isUnavailable = !isVariantAvailable(v);
        var isDisabled = isBlocked || isUnavailable;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'cb-variant-btn' +
          (isUnavailable ? ' cb-variant-btn--oos' : '') +
          (isBlocked ? ' cb-variant-btn--selected' : '');
        btn.textContent = v.title;
        if (isDisabled) {
          btn.disabled = true;
          btn.title = isBlocked ? 'Already selected in this box' : 'Out of stock';
        } else {
          selectableCount++;
        }
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          if (isDisabled) return;
          closePicker();
          cb(
            v.id,
            v.title !== 'Default Title' ? v.title : '',
            v.price,
            v.compareAtPrice
          );
        });
        btnsDiv.appendChild(btn);
      });
      picker.appendChild(btnsDiv);

      if (selectableCount === 0) {
        var emptyEl = document.createElement('div');
        emptyEl.className = 'cb-variant-picker-loading';
        emptyEl.textContent = 'All variants are already selected.';
        picker.appendChild(emptyEl);
      }

      var cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'cb-variant-cancel-btn';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); closePicker(); });
      picker.appendChild(cancelBtn);
    });
  }

  // ─── Sticky Footer instances ──────────────────────────────────────────────────
  // A manual Theme App Block may appear more than once on the same page. Keep
  // sticky-cart DOM/state per combo-builder root so one block never removes or
  // mutates another block's sticky action bar.
  var _stickyInstances = {};
  var _stickyBodyOriginalPaddingBottom = null;
  var _drawerScrollRecoveryBound = false;
  var _pageLoaderEl = null;
  var _pageLoaderActiveCount = 0;

  function getComboInstanceRoot(ctxOrRoot) {
    if (!ctxOrRoot) return null;
    if (ctxOrRoot.nodeType === 1) return ctxOrRoot;
    return ctxOrRoot.rootEl || null;
  }

  function getComboInstanceKey(ctxOrRoot) {
    var root = getComboInstanceRoot(ctxOrRoot);
    if (!root) return '__combo_builder_default__';
    return root.getAttribute('data-cb-instance') ||
      root.getAttribute('data-block-id') ||
      root.id ||
      '__combo_builder_default__';
  }

  function getStickyFooterState(ctxOrRoot) {
    var key = getComboInstanceKey(ctxOrRoot);
    var root = getComboInstanceRoot(ctxOrRoot);
    if (!_stickyInstances[key]) {
      _stickyInstances[key] = {
        key: key,
        rootEl: root,
        el: null,
        btn: null,
        savingsEl: null,
        totalEl: null,
      };
    } else if (root) {
      _stickyInstances[key].rootEl = root;
    }
    return _stickyInstances[key];
  }

  function updateStickyFooterStack() {
    if (!document.body) return;

    var keys = Object.keys(_stickyInstances);
    var activeStates = [];

    keys.forEach(function (key) {
      var state = _stickyInstances[key];
      if (!state) return;

      // Shopify section rendering can replace a block root without executing
      // the embedded script again. Remove any sticky UI that belongs to the
      // detached root; the replacement root will build its own instance.
      if (state.rootEl && state.rootEl.isConnected === false) {
        if (state.el && state.el.parentNode) state.el.parentNode.removeChild(state.el);
        delete _stickyInstances[key];
        return;
      }

      if (state.el && state.el.isConnected !== false) activeStates.push(state);
    });

    if (activeStates.length === 0) {
      if (_stickyBodyOriginalPaddingBottom !== null) {
        document.body.style.paddingBottom = _stickyBodyOriginalPaddingBottom;
        _stickyBodyOriginalPaddingBottom = null;
      }
      return;
    }

    if (_stickyBodyOriginalPaddingBottom === null) {
      _stickyBodyOriginalPaddingBottom = document.body.style.paddingBottom || '';
    }

    var bottomOffset = 0;
    activeStates.forEach(function (state) {
      var height = 72;
      try {
        height = Math.max(1, Math.ceil(state.el.getBoundingClientRect().height || 72));
      } catch (_) {}
      state.el.style.bottom = bottomOffset + 'px';
      bottomOffset += height;
    });

    document.body.style.paddingBottom = _stickyBodyOriginalPaddingBottom
      ? 'calc(' + _stickyBodyOriginalPaddingBottom + ' + ' + bottomOffset + 'px)'
      : bottomOffset + 'px';
  }

  function removeStickyFooter(ctxOrRoot) {
    // No argument remains a safe cleanup-all fallback for legacy/global paths.
    if (!ctxOrRoot) {
      Object.keys(_stickyInstances).forEach(function (key) {
        var state = _stickyInstances[key];
        if (state && state.el && state.el.parentNode) state.el.parentNode.removeChild(state.el);
        delete _stickyInstances[key];
      });
      updateStickyFooterStack();
      return;
    }

    var key = getComboInstanceKey(ctxOrRoot);
    var state = _stickyInstances[key];
    if (state && state.el && state.el.parentNode) state.el.parentNode.removeChild(state.el);
    // Preserve the per-instance state object so closures inside renderBuilder /
    // renderSpecificComboBuilder keep a stable reference when a box rebuilds
    // its sticky footer. Only the DOM references are reset here.
    if (state) {
      state.el = null;
      state.btn = null;
      state.savingsEl = null;
      state.totalEl = null;
      state.rootEl = getComboInstanceRoot(ctxOrRoot) || state.rootEl;
    }
    updateStickyFooterStack();
  }

  function applyProductPagePreviewMode(root) {
    if (!root) return;

    try {
      root.classList.add('cb-preview-mode');
      if (document && document.documentElement) document.documentElement.classList.add('cb-preview-mode');
      if (document && document.body) document.body.classList.add('cb-preview-mode');
    } catch (_) {}

    // Hide common product info containers only in preview mode.
    var hideSelectors = [
      '.product__info-wrapper',
      '.product__info-container',
      '.product__column-sticky',
      '.product-main__info',
      '.product-form',
      '[data-product-blocks]',
      '[data-product-information]',
      '.product-single__meta',
      '.productView-details',
      '.product-info',
      '.main-product__info',
      '.product-page-info'
    ];

    for (var i = 0; i < hideSelectors.length; i++) {
      var nodes = document.querySelectorAll(hideSelectors[i]);
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (!el || el.contains(root) || root.contains(el)) continue;
        if (el.closest && el.closest('header, footer, .shopify-section-group-header-group, .shopify-section-group-footer-group, [id*="shopify-section-header"], [id*="shopify-section-footer"]')) continue;
        if (el.closest && el.closest('.combo-builder-root')) continue;
        if (el.getAttribute('data-cb-preview-hidden') === '1') continue;
        el.setAttribute('data-cb-preview-hidden', '1');
        el.style.setProperty('display', 'none', 'important');
      }
    }

    // If theme layout is two-column product media/info, hide the sibling info column too.
    var productContainers = document.querySelectorAll('.product, .main-product, [data-section-type="product"]');
    for (var pi = 0; pi < productContainers.length; pi++) {
      var pc = productContainers[pi];
      if (!pc || !pc.contains(root)) continue;
      if (pc.closest && pc.closest('header, footer, .shopify-section-group-header-group, .shopify-section-group-footer-group, [id*="shopify-section-header"], [id*="shopify-section-footer"]')) continue;
      var infoSibling = pc.querySelector('.product__info-wrapper, .product__info-container, .product-main__info, .product-info');
      if (infoSibling && !infoSibling.contains(root)) {
        infoSibling.setAttribute('data-cb-preview-hidden', '1');
        infoSibling.style.setProperty('display', 'none', 'important');
      }
    }

    // Generated bundle products should behave like a dedicated builder page:
    // keep header, footer, and the section containing the builder; hide other
    // theme sections in the main content area.
    var sectionNodes = document.querySelectorAll('.shopify-section, section[id^="shopify-section-"], main > *, #MainContent > *, .content-for-layout > *');
    for (var hi = 0; hi < sectionNodes.length; hi++) {
      var sectionEl = sectionNodes[hi];
      if (!sectionEl || sectionEl === root || sectionEl.contains(root) || root.contains(sectionEl)) continue;
      if (sectionEl.closest && sectionEl.closest('header, footer, .shopify-section-group-header-group, .shopify-section-group-footer-group, [id*="shopify-section-header"], [id*="shopify-section-footer"], .site-header, .site-footer')) continue;
      if (sectionEl.matches && sectionEl.matches('header, footer, .shopify-section-group-header-group, .shopify-section-group-footer-group, [id*="shopify-section-header"], [id*="shopify-section-footer"], .site-header, .site-footer')) continue;
      if (sectionEl.closest && sectionEl.closest('.combo-builder-root')) continue;
      if (sectionEl.getAttribute('data-cb-preview-hidden') === '1') continue;
      sectionEl.setAttribute('data-cb-preview-hidden', '1');
      sectionEl.style.setProperty('display', 'none', 'important');
    }

    var visibleShellSelectors = [
      'header',
      'footer',
      '.shopify-section-group-header-group',
      '.shopify-section-group-footer-group',
      '[id*="shopify-section-header"]',
      '[id*="shopify-section-footer"]',
      '.site-header',
      '.site-footer'
    ];
    for (var si = 0; si < visibleShellSelectors.length; si++) {
      var shellNodes = document.querySelectorAll(visibleShellSelectors[si]);
      for (var sj = 0; sj < shellNodes.length; sj++) {
        shellNodes[sj].removeAttribute('data-cb-preview-hidden');
        shellNodes[sj].style.removeProperty('display');
      }
    }
  }

  function placeAutoProductRootBeforeFooter(root) {
    if (!root || root.getAttribute('data-cb-auto-positioned') === '1') return;

    var blockedContainer = root.closest && root.closest('header, footer, .shopify-section-group-header-group, .shopify-section-group-footer-group, [id*="shopify-section-header"], [id*="shopify-section-footer"]');
    var main = document.querySelector('main, #MainContent, [role="main"], .main-content, .content-for-layout');
    var footer = document.querySelector('footer, .shopify-section-group-footer-group, [id*="shopify-section-footer"], .site-footer');

    if (footer && footer.parentNode && footer !== root && !footer.contains(root)) {
      footer.parentNode.insertBefore(root, footer);
      root.setAttribute('data-cb-auto-positioned', '1');
      return;
    }

    if (main && main !== root && !root.contains(main)) {
      main.appendChild(root);
      root.setAttribute('data-cb-auto-positioned', '1');
      return;
    }

    if (main && main.contains(root) && !blockedContainer) {
      root.setAttribute('data-cb-auto-positioned', '1');
      return;
    }

    if (document.body && root.parentNode !== document.body) {
      document.body.appendChild(root);
      root.setAttribute('data-cb-auto-positioned', '1');
    }
  }

  // A freshly AJAX-rendered auto-embed root may not have had initWidget()
  // called yet, so its JS-added class may not exist. Always treat the Liquid
  // data-auto-product-box flag as the source of truth as well as the class.
  // This prevents one uninitialized auto root from being misidentified as a
  // manual combo-builder block during section/variant HTML replacement.
  function isAutoProductComboRoot(root) {
    if (!root) return false;
    if (root.dataset && root.dataset.cbSource === 'auto') return true;
    if (root.classList && root.classList.contains('combo-builder-auto-product-root')) return true;
    return parseBooleanSetting(root.dataset && root.dataset.autoProductBox, false);
  }

  function isManualComboBuilderRoot(root) {
    if (!root) return false;
    if (root.dataset && root.dataset.cbSource === 'manual') return true;
    if (root.classList && root.classList.contains('combo-builder-manual-root')) return true;
    return !isAutoProductComboRoot(root);
  }

  function hasManualComboBuilderRoot(currentRoot) {
    var roots = document.querySelectorAll('.combo-builder-root');
    var otherIds = [];
    for (var i = 0; i < roots.length; i++) {
      var candidate = roots[i];
      if (candidate === currentRoot) continue;
      if (candidate.isConnected === false) continue;
      if (!isManualComboBuilderRoot(candidate)) continue;
      otherIds.push(candidate.id || '(no id)');
    }
    if (otherIds.length > 0) {
      cbLog('hasManualComboBuilderRoot(' + (currentRoot && currentRoot.id) + ') => true', 'otherManualRoots=', otherIds);
      return true;
    }
    return false;
  }

  function suppressAutoProductComboRoot(root, reason) {
    if (!root) return;
    cbLog('suppressAutoProductComboRoot()', reason || '', cbDescribeRoot(root));
    root.innerHTML = '';
    root.style.display = 'none';
    // A suppressed root does not currently contain rendered bundle UI.
    // Removing this flag lets lifecycle recovery accurately distinguish it
    // from a root whose already-rendered children were unexpectedly removed.
    root.removeAttribute('data-cb-rendered');
    root.setAttribute('data-cb-suppressed-by-manual-block', '1');
  }

  function suppressManualComboBuilderRoot(root, reason) {
    if (!root) return;
    cbLog('suppressManualComboBuilderRoot()', reason || '', cbDescribeRoot(root));
    root.innerHTML = '';
    root.style.display = 'none';
    root.removeAttribute('data-cb-rendered');
    root.setAttribute('data-cb-suppressed-by-auto-product', '1');
  }

  function suppressManualComboBuilderRoots(activeAutoRoot) {
    var roots = document.querySelectorAll('.combo-builder-root');
    for (var i = 0; i < roots.length; i++) {
      var candidate = roots[i];
      if (candidate === activeAutoRoot) continue;
      if (candidate.isConnected === false) continue;
      if (!isManualComboBuilderRoot(candidate)) continue;
      suppressManualComboBuilderRoot(candidate, 'matched product-specific auto root is active');
    }
  }

  function hasActiveRenderedAutoProductRoot(currentRoot) {
    var roots = document.querySelectorAll('.combo-builder-root');
    for (var i = 0; i < roots.length; i++) {
      var candidate = roots[i];
      if (candidate === currentRoot) continue;
      if (candidate.isConnected === false) continue;
      if (!isAutoProductComboRoot(candidate)) continue;
      if (candidate.getAttribute('data-cb-rendered') !== '1') continue;
      if (!candidate.querySelector('.cb-wrapper')) continue;
      if (candidate.style && candidate.style.display === 'none') continue;
      return true;
    }
    return false;
  }

  function restoreComboRootVisibility(root) {
    if (!root) return;
    root.style.removeProperty('display');
    root.removeAttribute('data-cb-suppressed-by-manual-block');
    root.removeAttribute('data-cb-suppressed-by-auto-product');
    root.removeAttribute('data-cb-no-product-context');
    root.removeAttribute('data-cb-no-product-match');
  }

  // Product-only/auto roots must fail closed: if the current Shopify product
  // is not mapped to a bundle, never fall back to the general bundle list.
  function hideProductOnlyRoot(root, reason) {
    if (!root) return;
    cbLog('hideProductOnlyRoot()', reason || '', cbDescribeRoot(root));
    root.innerHTML = '';
    root.style.display = 'none';
    root.removeAttribute('data-cb-rendered');
    root.setAttribute('data-cb-no-product-match', '1');
  }

  function clearAutoProductComboRoots(currentRoot) {
    if (!isAutoProductComboRoot(currentRoot)) {
      cbLog('clearAutoProductComboRoots() skipped for non-auto root', 'callerRoot=' + (currentRoot && currentRoot.id));
      return;
    }
    var roots = document.querySelectorAll('.combo-builder-root');
    var candidates = [];
    var currentProductId = normalizeShopifyProductId(currentRoot && currentRoot.dataset && currentRoot.dataset.productId);
    for (var ri = 0; ri < roots.length; ri++) {
      var candidate = roots[ri];
      if (candidate === currentRoot) continue;
      if (!isAutoProductComboRoot(candidate)) continue;
      if (normalizeShopifyProductId(candidate.dataset && candidate.dataset.productId) !== currentProductId) continue;
      candidates.push(candidate);
    }
    cbLog('clearAutoProductComboRoots() called', 'callerRoot=' + (currentRoot && currentRoot.id), 'candidateCount=' + candidates.length);
    for (var i = 0; i < candidates.length; i++) {
      suppressAutoProductComboRoot(candidates[i], 'duplicate auto product root');
    }
  }

  function ensurePageLoader() {
    if (_pageLoaderEl) return _pageLoaderEl;

    var overlay = document.createElement('div');
    overlay.className = 'cb-page-loader';
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    var panel = document.createElement('div');
    panel.className = 'cb-page-loader-panel';

    var spinner = document.createElement('span');
    spinner.className = 'combo-builder-spinner';
    spinner.setAttribute('aria-hidden', 'true');
    panel.appendChild(spinner);

    var text = document.createElement('span');
    text.className = 'cb-page-loader-text';
    text.id = 'cb-page-loader-text';
    panel.appendChild(text);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    _pageLoaderEl = overlay;
    return _pageLoaderEl;
  }

  function showPageLoader(text) {
    var overlay = ensurePageLoader();
    var textEl = overlay.querySelector('#cb-page-loader-text');
    if (textEl) textEl.textContent = text || '';
    _pageLoaderActiveCount++;
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
  }

  function hidePageLoader(force) {
    if (!_pageLoaderEl) return;
    if (force) _pageLoaderActiveCount = 0;
    else _pageLoaderActiveCount = Math.max(0, _pageLoaderActiveCount - 1);
    if (_pageLoaderActiveCount > 0) return;
    _pageLoaderEl.hidden = true;
    _pageLoaderEl.setAttribute('aria-hidden', 'true');
  }

  function createStickyFooter(box, ctx, onCartClick) {
    removeStickyFooter(ctx);
    var stickyState = getStickyFooterState(ctx);

    var footer = document.createElement('div');
    footer.className = 'cb-sticky-footer';

    // Inherit the widget's CSS custom properties so the sticky footer
    // picks up the same dynamic theme set in combo-builder.liquid
    if (ctx.rootEl) {
      var blockId = ctx.rootEl.getAttribute('data-cb-instance') || ctx.rootEl.getAttribute('data-block-id');
      if (blockId) footer.setAttribute('data-cb-instance', blockId);
    }

    // Left: icon + box name
    var left = document.createElement('div');
    left.className = 'cb-sticky-left';
    var icon = document.createElement('span');
    icon.className = 'cb-sticky-icon';
    icon.textContent = box.isGiftBox ? '🎁' : '🛍️';
    left.appendChild(icon);
    var nameEl = document.createElement('div');
    nameEl.className = 'cb-sticky-name';
    nameEl.textContent = box.displayTitle;
    left.appendChild(nameEl);
    footer.appendChild(left);

    // Center: total price + MRP savings
    var center = document.createElement('div');
    center.className = 'cb-sticky-center';
    var totalRow = document.createElement('div');
    totalRow.className = 'cb-sticky-total';
    renderStickyTotal(
      totalRow,
      isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
      ctx.currencySymbol
    );
    center.appendChild(totalRow);
    var savingsRow = document.createElement('div');
    savingsRow.className = 'cb-sticky-savings-row';
    savingsRow.style.display = 'none';
    center.appendChild(savingsRow);
    footer.appendChild(center);
    stickyState.savingsEl = savingsRow;

    // Right: action button
    var btn = document.createElement('button');
    btn.className = 'cb-sticky-btn';
    btn.type = 'button';
    btn.disabled = true;
    btn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel);
    btn.addEventListener('click', onCartClick);
    footer.appendChild(btn);

    document.body.appendChild(footer);
    document.body.style.paddingBottom = '72px';

    stickyState.rootEl = ctx && ctx.rootEl ? ctx.rootEl : stickyState.rootEl;
    stickyState.el = footer;
    stickyState.btn = btn;
    stickyState.totalEl = totalRow;
    updateStickyFooterStack();
    return btn;
  }

  // ─── Specific Combo: Collection Products Fetcher ──────────────────────────────
  var _collectionProductsCache = {};
  function fetchCollectionProducts(handle, cb) {
    if (_collectionProductsCache[handle]) { cb(null, _collectionProductsCache[handle]); return; }

    var allProds = [];
    var seenIds = {};

    function fetchPage(page) {
      fetch('/collections/' + encodeURIComponent(handle) + '/products.json?limit=250&page=' + page)
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var batch = (data.products || []);
          batch.forEach(function (p) {
            if (seenIds[p.id]) return;
            seenIds[p.id] = true;
            var v0 = p.variants && p.variants[0] ? p.variants[0] : null;
            allProds.push({
              productId: p.id ? ('gid://shopify/Product/' + p.id) : null,
              productTitle: p.title,
              productHandle: p.handle,
              productImageUrl: p.images && p.images[0] ? p.images[0].src : null,
              productPrice: v0 ? parseFloat(v0.price) : 0,
              productType: p.product_type || '',
              vendor: p.vendor || '',
              tags: p.tags || '',
              productAvailable: (p.variants || []).some(isVariantAvailable),
              productOptions: normalizeOptionList(p.options || []),
              colorValues: normalizeOptionList(p.options || []).filter(function (option) { return /^(color|colour)$/i.test(option.name); }).reduce(function (acc, option) { return acc.concat(option.values); }, []),
              variants: (p.variants || []).map(function (v) {
                return {
                  id: String(v.id),
                  price: v.price != null ? parseFloat(v.price) : null,
                  available: isVariantAvailable(v),
                  inventoryQuantity: getVariantInventoryQuantity(v),
                  selectedOptions: normalizeOptionList(p.options || []).map(function (option, index) {
                    return { name: option.name, value: v['option' + (index + 1)] || '' };
                  }).filter(function (option) { return option.value; })
                };
              }),
              variantIds: (p.variants || []).map(function (v) { return String(v.id); }),
            });
          });
          // If we got a full page of 250, there may be more
          if (batch.length === 250) {
            fetchPage(page + 1);
          } else {
            _collectionProductsCache[handle] = allProds;
            cb(null, allProds);
          }
        })
        .catch(function (err) {
          if (allProds.length > 0) {
            _collectionProductsCache[handle] = allProds;
            cb(null, allProds);
          } else {
            cb(err, null);
          }
        });
    }

    fetchPage(1);
  }

  // ─── Main Widget Init ─────────────────────────────────────────────────────────

  function initWidget(config) {
    if (window.__COMBO_BUILDER_EMBED__ !== true) {
      disableFrontendWhenEmbedOff();
      return;
    }

    cbLog('initWidget() called', 'mountId=' + config.mountId);
    var root = document.getElementById(config.mountId);
    if (!root) { cbLog('initWidget: root NOT FOUND for mountId=' + config.mountId); return; }
    if (root.getAttribute('data-cb-initialized') === '1') {
      cbLog('initWidget: SKIPPED — already initialized', cbDescribeRoot(root));
      return;
    }
    root.setAttribute('data-cb-initialized', '1');
    cbLog('initWidget: proceeding, marked data-cb-initialized=1', cbDescribeRoot(root));

    var shop = root.dataset.shop || config.shop;
    var currencySymbol = root.dataset.currencySymbol || config.currencySymbol || "$";
    var currencyCode = root.dataset.currency || config.currency || "USD";
    var layout = root.dataset.layout || config.layout || 'grid';
    var layoutMode = root.dataset.layoutMode || config.layoutMode || 'grid';
    var autoProductBox = parseBooleanSetting(
      root.dataset.autoProductBox != null ? root.dataset.autoProductBox : config.autoProductBox,
      false
    );
    var productBoxOnly = autoProductBox || parseBooleanSetting(
      root.dataset.productBoxOnly != null ? root.dataset.productBoxOnly : config.productBoxOnly,
      false
    );
    var showAllBoxes = parseBooleanSetting(
      root.dataset.showAllBoxes != null ? root.dataset.showAllBoxes : config.showAllBoxes,
      false
    );
    var currentCustomerId = normalizeShopifyProductId(root.dataset.customerId || config.customerId || null);
    var currentCustomerTags = parseDelimitedList(root.dataset.customerTags || config.customerTags || []);
    var boxTypeFilter = String(root.dataset.boxTypeFilter || config.boxTypeFilter || 'all').toLowerCase();
    if (boxTypeFilter !== 'single' && boxTypeFilter !== 'multiple') boxTypeFilter = 'all';
    var currentProductId = normalizeShopifyProductId(root.dataset.productId || config.productId || null);
    // productBoxOnly is derived ONLY from the root's own mode (autoProductBox,
    // or an explicit data-product-box-only attribute) — never promoted just
    // because currentProductId happens to be present. A manual
    // combo-builder.liquid block always stays in general/show-all mode; only
    // the automatic combo-embed root does exact current-product matching.
    // See the STRICT PRODUCT-PAGE RULE block below for how a matched auto
    // root then takes ownership of the page by suppressing manual roots.
    cbLog('initWidget: productId raw=' + (root.dataset.productId || config.productId || null) + ' normalized=' + currentProductId, 'autoProductBox=' + autoProductBox, 'productBoxOnly=' + productBoxOnly, 'showAllBoxes=' + showAllBoxes);
    if (productBoxOnly && !currentProductId) {
      cbLog('initWidget: HIDING — productBoxOnly with no product id', cbDescribeRoot(root));
      hideProductOnlyRoot(root, 'missing Shopify product context');
      root.setAttribute('data-cb-no-product-context', '1');
      return;
    }
    // Mark auto ownership before checking for manual roots. During an AJAX
    // section replacement there can briefly be multiple fresh roots in the DOM;
    // classifying this root first prevents another auto root from looking manual.
    if (autoProductBox) {
      root.classList.add('combo-builder-auto-product-root');
    }
    if (autoProductBox) {
      // This root may have been suppressed during an earlier manual-block phase.
      // If the manual root is gone now, restore it before fetching/rendering.
      restoreComboRootVisibility(root);
      clearAutoProductComboRoots(root);
    } else {
      root.classList.add('combo-builder-manual-root');
      if (hasActiveRenderedAutoProductRoot(root)) {
        cbLog('initWidget: HIDING manual root because a matched auto product root is active', cbDescribeRoot(root));
        suppressManualComboBuilderRoot(root, 'matched product-specific auto root is active');
        return;
      }
      cbLog('initWidget: non-auto-embed root initializing — calling clearAutoProductComboRoots()', 'callerRoot=' + root.id);
      clearAutoProductComboRoots(root);
      restoreComboRootVisibility(root);
    }
    var enableStickyCart = parseBooleanSetting(
      root.dataset.enableStickyCart != null ? root.dataset.enableStickyCart : config.enableStickyCart,
      true
    );
    // Theme editor can re-render the block with updated settings while an older
    // sticky footer instance is still mounted. Clear it immediately when sticky
    // cart is disabled so stale CTA bars do not persist.
    if (enableStickyCart === false) {
      removeStickyFooter(root);
    }
    var apiBase = root.dataset.apiBase || config.apiBase || DEFAULT_API_BASE;
    var previewBoxToken = null;
    try {
      var previewParams = new URLSearchParams(window.location.search || '');
      previewBoxToken = (previewParams.get('cb_preview_box') || '').trim();
      if (!previewBoxToken) {
        var pathname = String(window.location.pathname || '/');
        var segments = pathname.split('/').filter(Boolean);
        // Support direct preview URL format: https://store-domain/{boxCodeOrId}
        if (segments.length === 1) {
          previewBoxToken = decodeURIComponent(segments[0] || '').trim();
        }
      }
    } catch (_) {}
    // Apply preview hiding immediately to avoid a brief flash of theme product info
    // while combo data is still loading from the API.
    if (previewBoxToken) {
      applyProductPagePreviewMode(root);
    }

    var boxIdsFilter = null;
    var rawBoxIds = root.dataset.boxIds || config.boxIds || null;
    if (rawBoxIds) {
      boxIdsFilter = String(rawBoxIds).split(',').map(function (id) { return parseInt(id.trim(), 10); }).filter(Boolean);
    }

    // Per-box visibility filter from theme editor (box names, codes, or numeric IDs — comma/newline separated)
    var visibleBoxNames = null;
    var visibleBoxCodes = null;
    var rawVisible = root.dataset.visibleBoxes || config.visibleBoxes || null;
    if (rawVisible && String(rawVisible).trim()) {
      var visTokens = String(rawVisible).split(/[\n,]+/)
        .map(function (t) { return t.trim(); }).filter(Boolean);
      var visIdTokens = [], visNameTokens = [], visCodeTokens = [];
      visTokens.forEach(function (t) {
        var n = parseInt(t, 10);
        if (!isNaN(n) && String(n) === t) {
          visIdTokens.push(n);
        } else if (/^[A-Z0-9]{5}$/.test(t.toUpperCase()) && t.length === 5) {
          // 5-char alphanumeric → treat as boxCode
          visCodeTokens.push(t.toUpperCase());
        } else {
          visNameTokens.push(t.toLowerCase());
        }
      });
      if (visIdTokens.length > 0) {
        boxIdsFilter = (boxIdsFilter || []).concat(visIdTokens);
      }
      if (visNameTokens.length > 0) {
        visibleBoxNames = visNameTokens;
      }
      if (visCodeTokens.length > 0) {
        visibleBoxCodes = visCodeTokens;
      }
    }

    // Current page handle passed from Liquid
    var currentPageHandle = root.dataset.pageHandle || null;

    if (!shop) {
      root.innerHTML = '';
      return;
    }

    root.innerHTML = '<div class="cb-initial-loader"><span class="combo-builder-spinner" aria-hidden="true"></span><span>Loading\u2026</span></div>';

    fetchBoxes(shop, apiBase, function (err, boxes, settings) {
      var apiBoxCount = (boxes && boxes.length) || 0;
      cbLog('initWidget fetch callback: err=' + (err && err.message), 'boxCount=' + apiBoxCount, 'orderLimitReached=' + (settings && settings.orderLimitReached));

      // Shopify/theme AJAX can replace the root while fetchBoxes() is in flight.
      // Never let an old request render into, clear, or otherwise mutate a stale
      // detached node after a new same-id root has already appeared.
      if (!root.isConnected || document.getElementById(config.mountId) !== root) {
        cbLog('initWidget fetch callback: STALE ROOT — response discarded', cbDescribeRoot(root));
        return;
      }
      if (!autoProductBox && root.getAttribute('data-cb-suppressed-by-auto-product') === '1') {
        cbLog('initWidget fetch callback: EXIT - manual root is suppressed by active auto product root', cbDescribeRoot(root));
        return;
      }

      root.innerHTML = '';

      // Order limit reached — show a notice and block the widget entirely
      if (settings && settings.orderLimitReached) {
        var shopHost = String(shop || '')
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, '')
          .replace(/\/.*$/, '');
        var storeHandle = shopHost.replace(/\.myshopify\.com$/, '');
        var upgradePlanUrl = storeHandle && storeHandle.indexOf('.') === -1
          ? ('https://admin.shopify.com/store/' + encodeURIComponent(storeHandle) + '/apps/mixbox-box-bundle-builder/app/pricing')
          : 'https://apps.shopify.com/mixbox/pricing';

        var limitBanner = document.createElement('div');
        limitBanner.style.cssText = [
          'padding:20px 24px',
          'text-align:center',
          'border:1px solid #fcd34d',
          'border-radius:4px',
          'background:#fffbeb',
          'font-family:inherit',
          'margin:8px 0',
          'max-width:600px',
          'width:100%',
          'margin:10px auto',
        ].join(';');
        limitBanner.innerHTML =
          '<p style="margin:0 0 6px;font-size:15px;font-weight:600;color:#92400e;">' +
          'MixBox – Box & Bundle Builder App Disabled</p>' +
          '<p style="margin:0;font-size:13px;color:#78350f;">' +
          'Please upgrade your plan to continue using App.</p>';
        root.appendChild(limitBanner);
        return;
      }

      if (err) {
        cbLog('initWidget fetch callback: EXIT — fetch error');
        return;
      }
      if (!boxes || boxes.length === 0) {
        cbLog('initWidget fetch callback: EXIT — API returned no boxes');
        if (productBoxOnly) hideProductOnlyRoot(root, 'API returned no bundle for current product');
        return;
      }

      boxes = filterBoxesByCustomerEligibility(boxes, currentCustomerId, currentCustomerTags);
      if (!boxes || boxes.length === 0) {
        cbLog('initWidget fetch callback: EXIT - no boxes allowed for current customer eligibility');
        if (productBoxOnly) hideProductOnlyRoot(root, 'customer eligibility blocked current product bundle');
        else root.innerHTML = '';
        return;
      }

      var productMatchedBoxes = [];
      if (currentProductId) {
        productMatchedBoxes = boxes.filter(function (b) {
          return normalizeShopifyProductId(b && b.shopifyProductId) === currentProductId;
        });
      }

      // If the auto embed explicitly carries a Single/Multiple type constraint,
      // apply it only AFTER the exact Shopify product-id match. This guarantees
      // a Single product cannot accidentally display a Multiple configuration
      // (or vice versa) even if stale/duplicate API rows exist.
      if (productBoxOnly && boxTypeFilter !== 'all') {
        productMatchedBoxes = productMatchedBoxes.filter(function (b) {
          return String(b && b.boxType || '').trim().toLowerCase() === boxTypeFilter;
        });
      }

      cbLog('initWidget fetch callback: matching', 'currentProductId=' + currentProductId,
        'boxTypeFilter=' + boxTypeFilter,
        'matchedBoxIds=', productMatchedBoxes.map(function (b) { return b.id + ':' + b.boxType; }));

      // STRICT PRODUCT-PAGE RULE:
      //   Only a root that is actually in productBoxOnly mode (the automatic
      //   combo-embed, or an explicit data-product-box-only root) does exact
      //   current-product mapping. A manual combo-builder.liquid block is
      //   never promoted into this mode just because currentProductId is
      //   present — it always stays the general "show all bundles" block.
      //   There is deliberately NO fallback from productMatchedBoxes to
      //   `boxes` here: a matched auto root renders exactly one bundle and
      //   then suppresses any manual roots on the page (see
      //   suppressManualComboBuilderRoots below); an unmatched auto root
      //   fails closed via hideProductOnlyRoot() and leaves any manual roots
      //   completely untouched.
      if (productBoxOnly) {
        if (!currentProductId) {
          hideProductOnlyRoot(root, 'product-only root lost product context');
          return;
        }
        if (productMatchedBoxes.length === 0) {
          hideProductOnlyRoot(root, 'normal/unmapped product — no bundle UI');
          return;
        }
        if (productMatchedBoxes.length > 1) {
          if (__CB_DEBUG__) console.warn('[ComboBuilder] Multiple active bundle records map to Shopify product ' + currentProductId + '. Rendering only the first exact match.',
            productMatchedBoxes.map(function (b) { return { id: b.id, boxType: b.boxType, shopifyProductId: b.shopifyProductId }; }));
        }
        boxes = [productMatchedBoxes[0]];
        if (autoProductBox) {
          suppressManualComboBuilderRoots(root);
        }
      }
      if (!productBoxOnly) {
        // Normal/manual Theme App Blocks are general bundle pickers. They must
        // show every eligible Single + Multiple Box in THIS block instance,
        // regardless of currentProductId. Explicit legacy/unknown rows are kept
        // for backwards compatibility; explicit non-Single/Multiple types are
        // excluded from the default "all" view.
        boxes = boxes.filter(function (b) {
          var type = String(b && b.boxType || '').trim().toLowerCase();
          if (!type) return true;
          if (boxTypeFilter === 'single' || boxTypeFilter === 'multiple') {
            return type === boxTypeFilter;
          }
          return type === 'single' || type === 'multiple';
        });
      }
      if (boxIdsFilter && boxIdsFilter.length > 0) {
        boxes = boxes.filter(function (b) { return boxIdsFilter.indexOf(b.id) !== -1; });
      }
      // Filter by visible box names set in theme editor
      if (visibleBoxNames && visibleBoxNames.length > 0) {
        boxes = boxes.filter(function (b) {
          var name = String(b.boxName || b.displayTitle || '').trim().toLowerCase();
          return visibleBoxNames.indexOf(name) !== -1;
        });
      }
      // Filter by box code (5-char unique code)
      if (visibleBoxCodes && visibleBoxCodes.length > 0) {
        boxes = boxes.filter(function (b) {
          return b.boxCode && visibleBoxCodes.indexOf(String(b.boxCode).toUpperCase()) !== -1;
        });
      }
      // Filter by page assignment: show box if pageHandle is null (all pages) or matches current page
      if (currentPageHandle && !productBoxOnly && !showAllBoxes) {
        boxes = boxes.filter(function (b) {
          if (!b.pageHandle) return true; // null = show on all pages
          var ph = String(b.pageHandle).trim();
          if (ph === currentPageHandle) return true;
          // "product" matches any product page; "collection" matches any collection page
          if (ph === 'product' && String(currentPageHandle).indexOf('product:') === 0) return true;
          if (ph === 'collection' && String(currentPageHandle).indexOf('collection:') === 0) return true;
          return false;
        });
      }
      cbLog('[PRODUCT-BUNDLE]',
        'currentProductId=' + currentProductId,
        'productBoxOnly=' + productBoxOnly,
        'autoProductBox=' + autoProductBox,
        'showAllBoxes=' + showAllBoxes,
        'apiBoxCount=' + apiBoxCount,
        'matchedBoxIds=' + JSON.stringify(productMatchedBoxes.map(function (b) { return b.id + ':' + b.boxType; })),
        'finalRenderBoxIds=' + JSON.stringify(boxes.map(function (b) { return b.id + ':' + b.boxType; })));
      if (boxes.length === 0) {
        cbLog('initWidget fetch callback: EXIT — 0 boxes after all filters');
        if (productBoxOnly) hideProductOnlyRoot(root, 'no exact product bundle after filters');
        else root.innerHTML = '';
        return;
      }
      cbLog('initWidget fetch callback: proceeding to render', 'finalBoxIds=', boxes.map(function (b) { return b.id + ':' + b.boxType; }));
      if (productBoxOnly) {
        if (autoProductBox) {
          placeAutoProductRootBeforeFooter(root);
        }
        applyProductPagePreviewMode(root);
      }
      var previewBoxId = null;
      var previewBox = null;
      if (previewBoxToken) {
        var tokLower = String(previewBoxToken).toLowerCase();
        for (var bi = 0; bi < boxes.length; bi++) {
          var pb = boxes[bi] || {};
          var pbCode = pb.boxCode ? String(pb.boxCode).toLowerCase() : '';
          var pbId = pb.id != null ? String(pb.id) : '';
          var pbName = String(pb.boxName || pb.displayTitle || '').trim().toLowerCase();
          if (pbCode === tokLower || pbId === previewBoxToken || pbName === tokLower) {
            previewBoxId = pb.id;
            previewBox = pb;
            break;
          }
        }
      }
      if (previewBox) {
        // Admin eye-preview mode: render only the requested combo box.
        boxes = [previewBox];
      }
      var isPreviewMode = !!(previewBox && previewBoxToken);

      var resolvedHeading = root.dataset.heading || config.heading || (settings && settings.widgetHeadingText) || 'Build Your Own Box!';
      if (settings && settings.presetTheme) applyPresetTheme(root, settings.presetTheme);
      if (settings && (!settings.presetTheme || settings.presetTheme === 'custom')) applyCustomColors(root, settings);
      root.style.setProperty(
        '--cb-products-per-row',
        String(normalizeProductCardsPerRow(settings && settings.productCardsPerRow))
      );

      // Apply dynamic max-width from admin settings
      if (settings && settings.widgetMaxWidth != null) {
        var mw = parseInt(settings.widgetMaxWidth, 10);
        if (mw === 0) {
          // Full width: break out of any theme container using viewport units
          root.style.width = '100vw';
          root.style.maxWidth = '100vw';
          root.style.marginLeft = 'calc(50% - 50vw)';
          root.style.marginRight = 'calc(50% - 50vw)';
          root.style.setProperty('--cb-max-width', '100%');
        } else {
          // Specific width: center with max-width on the root itself
          root.style.width = '100%';
          root.style.maxWidth = mw + 'px';
          root.style.marginLeft = 'auto';
          root.style.marginRight = 'auto';
          root.style.setProperty('--cb-max-width', mw + 'px');
        }
      }

      var step1Label = root.dataset.step1Label || config.step1Label || 'Select Box';
      var step2Label = root.dataset.step2Label || config.step2Label || 'Pick Items';
      var step3Label = root.dataset.step3Label || config.step3Label || 'Add to Cart';
      var cartBtnLabel = root.dataset.cartBtnLabel || config.cartBtnLabel || '';
      var checkoutBtnLabel = root.dataset.checkoutBtnLabel || config.checkoutBtnLabel || 'Checkout';
      var step1Heading = root.dataset.step1Heading || config.step1Heading || 'Step 1: Select your box';
      var step2Heading = root.dataset.step2Heading || config.step2Heading || 'Step 2: Select your products';
      var step3Heading = root.dataset.step3Heading || config.step3Heading || 'Step 3: Complete your order';
      var step3Buttons = root.dataset.step3Buttons || config.step3Buttons || 'both';
      renderWidget(root, { shop: shop, boxes: boxes, currencySymbol: currencySymbol, currencyCode: currencyCode, layout: layout, layoutMode: layoutMode, enableStickyCart: enableStickyCart, heading: resolvedHeading, apiBase: apiBase, settings: settings || {}, rootEl: root, step1Label: step1Label, step2Label: step2Label, step3Label: step3Label, cartBtnLabel: cartBtnLabel, checkoutBtnLabel: checkoutBtnLabel, step1Heading: step1Heading, step2Heading: step2Heading, step3Heading: step3Heading, step3Buttons: step3Buttons, previewBoxId: previewBoxId, previewBoxCode: previewBoxToken, isPreviewMode: isPreviewMode, autoProductBox: autoProductBox, productBoxOnly: productBoxOnly, productId: currentProductId, boxTypeFilter: boxTypeFilter });
    }, productBoxOnly ? currentProductId : null, previewBoxToken);
  }

  function initLegacyWidget(el) {
    var shop = el.dataset.shop || (window.Shopify && window.Shopify.shop) || null;
    initWidget({
      mountId: el.id,
      shop: shop,
      apiBase: el.dataset.apiBase || DEFAULT_API_BASE,
      currencySymbol: el.dataset.currencySymbol || (window.Shopify && window.Shopify.currency && window.Shopify.currency.symbol) || "$",
      currency: el.dataset.currency || (window.Shopify && window.Shopify.currency && window.Shopify.currency.active) || "USD",
      layout: el.dataset.layout || 'grid',
      layoutMode: el.dataset.layoutMode || 'grid',
      heading: el.dataset.heading || 'Build Your Own Box!',
      boxIds: el.dataset.boxIds || null,
      productId: el.dataset.productId || null,
      autoProductBox: el.dataset.autoProductBox || false,
      boxTypeFilter: el.dataset.boxTypeFilter || 'all',
    });
  }

  // ─── API ──────────────────────────────────────────────────────────────────────

  function fetchBoxes(shop, apiBase, cb, productId, previewBoxCode) {
    var url = apiBase + '/api/storefront/boxes?shop=' + encodeURIComponent(shop);
    var normalizedProductId = normalizeShopifyProductId(productId);
    if (normalizedProductId) {
      url += '&productId=' + encodeURIComponent(normalizedProductId);
    }
    if (previewBoxCode) {
      // Lets the admin "Live Preview" link show a draft/inactive/not-yet-
      // scheduled bundle exactly as it will render once published — see the
      // matching server-side bypass in getStorefrontBoxes().
      url += '&previewBoxCode=' + encodeURIComponent(previewBoxCode);
    }
    cbLog('fetchBoxes: REQUEST', url);
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        if (data && Array.isArray(data.boxes)) {
          var filtered = data.boxes.filter(function (b) { return b && b.isActive !== false; });
          cbLog('fetchBoxes: RESPONSE', 'rawCount=' + data.boxes.length, 'afterActiveFilter=' + filtered.length,
            filtered.map(function (b) { return { id: b.id, boxType: b.boxType, shopifyProductId: b.shopifyProductId }; }));
          cb(null, filtered, data.settings || {});
        }
        else if (Array.isArray(data)) {
          cbLog('fetchBoxes: RESPONSE (legacy array shape)', 'count=' + data.length);
          cb(null, data.filter(function (b) { return b && b.isActive !== false; }), {});
        }
        else {
          cbLog('fetchBoxes: RESPONSE was not in an expected shape', data);
          cb(null, [], {});
        }
      })
      .catch(function (e) { cbLog('fetchBoxes: ERROR', e && e.message); cb(e, null, {}); });
  }

  function parseDelimitedList(value) {
    if (Array.isArray(value)) {
      return value.map(function (entry) { return String(entry || '').trim(); }).filter(Boolean);
    }
    if (value == null) return [];
    return String(value)
      .split(',')
      .map(function (entry) { return entry.trim(); })
      .filter(Boolean);
  }

  function hasMatchingCustomerTag(requiredTags, currentTags) {
    if (!requiredTags.length) return false;
    var current = {};
    currentTags.forEach(function (tag) {
      current[String(tag || '').trim().toLowerCase()] = true;
    });
    return requiredTags.some(function (tag) {
      return current[String(tag || '').trim().toLowerCase()] === true;
    });
  }

  function isBoxAllowedForCustomer(box, customerId, customerTags) {
    var eligibility = parseDelimitedList(box && box.eligibility);
    if (!eligibility.length || eligibility.indexOf('all') !== -1) return true;

    if (eligibility.indexOf('tags') !== -1) {
      if (hasMatchingCustomerTag(parseDelimitedList(box && box.customerTags), customerTags)) {
        return true;
      }
    }

    if (eligibility.indexOf('specific') !== -1) {
      var selectedCustomers = parseDelimitedList(box && box.customers).map(normalizeShopifyProductId);
      if (customerId && selectedCustomers.indexOf(customerId) !== -1) return true;
    }

    return false;
  }

  function filterBoxesByCustomerEligibility(boxes, customerId, customerTags) {
    if (!Array.isArray(boxes)) return [];
    return boxes.filter(function (box) {
      return isBoxAllowedForCustomer(box, customerId, customerTags);
    });
  }

  function normalizeShopifyProductId(value) {
    if (value == null) return null;
    var id = String(value).trim();
    if (!id) return null;
    if (id.indexOf('/') !== -1) return id.split('/').pop();
    return id;
  }

  function getInternalBundleProductIds(ctx) {
    var map = {};
    if (!ctx || !Array.isArray(ctx.boxes)) return map;
    ctx.boxes.forEach(function (box) {
      var pid = normalizeShopifyProductId(box && box.shopifyProductId);
      if (pid) map[pid] = true;
    });
    return map;
  }

  function hasInternalComboTag(tagsValue) {
    var tags = [];
    if (Array.isArray(tagsValue)) {
      tags = tagsValue;
    } else if (typeof tagsValue === 'string' && tagsValue.trim()) {
      tags = tagsValue.split(',');
    }
    for (var i = 0; i < tags.length; i++) {
      if (String(tags[i]).trim().toLowerCase() === 'combo-builder-internal') return true;
    }
    return false;
  }

  function shouldExcludeInternalComboProduct(product, internalBundleProductIds) {
    if (!product) return false;
    var pid = normalizeShopifyProductId(product.productId != null ? product.productId : product.id);
    if (pid && internalBundleProductIds && internalBundleProductIds[pid]) return true;

    var vendor = product.vendor != null ? String(product.vendor).trim().toLowerCase() : '';
    if (vendor === 'combobuilder') return true;

    if (hasInternalComboTag(product.tags)) return true;
    return false;
  }

  function filterInternalComboProducts(products, ctx) {
    if (!Array.isArray(products) || products.length === 0) return [];
    var internalBundleProductIds = getInternalBundleProductIds(ctx);
    return products.filter(function (product) {
      return !shouldExcludeInternalComboProduct(product, internalBundleProductIds);
    });
  }

  var _wholeStoreProductsCache = null;
  function fetchWholeStoreProducts(cb) {
    if (Array.isArray(_wholeStoreProductsCache)) { cb(null, _wholeStoreProductsCache); return; }

    var allProds = [];
    var seenIds = {};

    function fetchPage(page) {
      fetch('/products.json?limit=250&page=' + page, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var batch = (data.products || []);
          batch.forEach(function (p) {
            if (seenIds[p.id]) return;
            seenIds[p.id] = true;
            var v0 = p.variants && p.variants[0] ? p.variants[0] : null;
            allProds.push({
              productId: p.id ? ('gid://shopify/Product/' + p.id) : null,
              productTitle: p.title || '',
              productHandle: p.handle || '',
              productImageUrl: p.images && p.images[0] ? p.images[0].src : null,
              productPrice: v0 ? parseFloat(v0.price) : 0,
              productType: p.product_type || '',
              productAvailable: (p.variants || []).some(isVariantAvailable),
              productOptions: normalizeOptionList(p.options || []),
              colorValues: normalizeOptionList(p.options || []).filter(function (option) { return /^(color|colour)$/i.test(option.name); }).reduce(function (acc, option) { return acc.concat(option.values); }, []),
              variants: (p.variants || []).map(function (v) {
                return {
                  id: String(v.id),
                  price: v.price != null ? parseFloat(v.price) : null,
                  available: isVariantAvailable(v),
                  inventoryQuantity: getVariantInventoryQuantity(v),
                  selectedOptions: normalizeOptionList(p.options || []).map(function (option, index) {
                    return { name: option.name, value: v['option' + (index + 1)] || '' };
                  }).filter(function (option) { return option.value; })
                };
              }),
              variantIds: (p.variants || []).map(function (v) { return String(v.id); }),
              isCollection: false,
              vendor: p.vendor || '',
              tags: p.tags || '',
            });
          });
          if (batch.length === 250) {
            fetchPage(page + 1);
          } else {
            _wholeStoreProductsCache = allProds;
            cb(null, allProds);
          }
        })
        .catch(function (err) {
          if (allProds.length > 0) {
            _wholeStoreProductsCache = allProds;
            cb(null, allProds);
          } else {
            cb(err, null);
          }
        });
    }

    fetchPage(1);
  }

  function fetchProducts(boxId, shop, apiBase, scopeType, packKey, ctx, cb, packIndex, options) {
    if (scopeType === 'wholestore') {
      // Whole-store scope has no per-box/per-pack product list to speak of —
      // it's every storefront product, resolved the same way regardless of packKey.
      var pageUrl = apiBase + '/api/storefront/boxes/' + boxId + '/products?shop=' + encodeURIComponent(shop);
      if (packKey) pageUrl += '&packKey=' + encodeURIComponent(packKey);
      if (packIndex != null) pageUrl += '&packIndex=' + encodeURIComponent(String(packIndex));
      if (ctx && ctx.previewBoxCode) pageUrl += '&previewBoxCode=' + encodeURIComponent(ctx.previewBoxCode);
      var pageSize = options && options.first ? parseInt(String(options.first), 10) : 24;
      pageUrl += '&first=' + encodeURIComponent(String(Math.max(1, Math.min(50, pageSize || 24))));
      if (options && options.after) pageUrl += '&after=' + encodeURIComponent(options.after);
      if (options && options.before) pageUrl += '&before=' + encodeURIComponent(options.before);
      if (options && options.search) pageUrl += '&search=' + encodeURIComponent(options.search);
      fetch(pageUrl, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (data) {
          var products = Array.isArray(data && data.products) ? data.products : [];
          cb(null, filterInternalComboProducts(products, ctx), data && data.pageInfo ? data.pageInfo : null);
        })
        .catch(function (e) { cb(e, null, null); });
      return;
    }
    var url = apiBase + '/api/storefront/boxes/' + boxId + '/products?shop=' + encodeURIComponent(shop);
    if (packKey) url += '&packKey=' + encodeURIComponent(packKey);
    if (packIndex != null) url += '&packIndex=' + encodeURIComponent(String(packIndex));
    if (ctx && ctx.previewBoxCode) url += '&previewBoxCode=' + encodeURIComponent(ctx.previewBoxCode);
    fetch(url, { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (data) {
        var rawProducts = Array.isArray(data) ? data : (Array.isArray(data && data.products) ? data.products : []);
        var products = options && options.allowInternalProducts
          ? rawProducts
          : filterInternalComboProducts(rawProducts, ctx);
        cb(null, products, data && data.pageInfo ? data.pageInfo : null);
      })
      .catch(function (e) { cb(e, null); });
  }

  // ─── Render Widget ────────────────────────────────────────────────────────────

  function renderWidget(root, ctx) {
    cbLog('renderWidget() called', 'root=' + root.id, 'boxCount=' + (ctx.boxes && ctx.boxes.length), 'boxIds=', (ctx.boxes || []).map(function (b) { return b && b.id + ':' + b.boxType; }));

    // Do not render into a root that was removed/replaced between init and render.
    if (!root || !root.isConnected) {
      cbLog('renderWidget: EXIT — root is detached/stale');
      return;
    }
    if (!ctx.autoProductBox && root.getAttribute('data-cb-suppressed-by-auto-product') === '1') {
      cbLog('renderWidget: EXIT - manual root is suppressed by active auto product root', cbDescribeRoot(root));
      return;
    }

    // A root may carry display:none from an earlier no-context/manual-suppression
    // state. A successful render must explicitly restore visibility.
    restoreComboRootVisibility(root);
    root.innerHTML = '';

    // Preserve Liquid/theme classes rather than replacing className wholesale.
    root.classList.add('combo-builder-root', 'cb-loaded');
    if (ctx.autoProductBox) {
      root.classList.add('combo-builder-auto-product-root');
      root.classList.remove('combo-builder-manual-root');
      root.setAttribute('data-cb-source', 'auto');
    } else {
      root.classList.remove('combo-builder-auto-product-root');
      root.classList.add('combo-builder-manual-root');
      root.setAttribute('data-cb-source', 'manual');
    }
    // Marks this root as having real, successfully-matched content — see
    // clearAutoProductComboRoots(), which must never wipe a root once this is
    // set, regardless of when/why it runs again later.
    root.setAttribute('data-cb-rendered', '1');
    cbLog('renderWidget: proceeding to build DOM, marked data-cb-rendered=1', cbDescribeRoot(root));
    cbWatchRootDisappearance(root);

    // Keep the complete eligible box list in one manual app-block instance.
    // The old special case rendered only Multiple Boxes when two or more
    // quantity-pack bundles existed, which silently dropped Single Boxes from
    // the same block. The normal card/grid flow below already supports mixed
    // Single + Multiple bundles and keeps selection state local to ctx/root.

    var wrapper = document.createElement('div');
    wrapper.className = 'cb-wrapper';
    ctx._wrapper = wrapper;

    // ── Steps Mode: 3-stage wizard progress bar ──────────────────────────────
    if (ctx.layoutMode === 'steps') {
      var wizardEl = document.createElement('div');
      wizardEl.className = 'cb-wizard';
      wizardEl.setAttribute('aria-label', 'Build Your Box progress');

      // Header: title + change-box action
      var wizardHeader = document.createElement('div');
      wizardHeader.className = 'cb-wizard-header';

      var wizardTitle = document.createElement('div');
      wizardTitle.className = 'cb-wizard-title';
      wizardTitle.textContent = 'Build Your Box';
      wizardHeader.appendChild(wizardTitle);

      var wizardChangeBtn = document.createElement('button');
      wizardChangeBtn.type = 'button';
      wizardChangeBtn.className = 'cb-change-box-btn';
      wizardChangeBtn.innerHTML = '&#8592; Back';
      wizardChangeBtn.style.visibility = 'hidden';
      wizardHeader.insertBefore(wizardChangeBtn, wizardTitle);
      ctx._changeBoxBtn = wizardChangeBtn;

      wizardEl.appendChild(wizardHeader);

      // Steps row: [step-wrapper] [line] [step-wrapper] [line] [step-wrapper]
      var stepsRow = document.createElement('div');
      stepsRow.className = 'cb-wizard-steps-row';
      stepsRow.setAttribute('role', 'list');

      var WIZARD_STEP_DEFS = [
        { label: ctx.step1Label || 'Select Box',  description: 'Choose your box',      doneLabel: (ctx.step1Label || 'Select Box') + ' \u2713' },
        { label: ctx.step2Label || 'Pick Items',  description: 'Pick your products',   doneLabel: (ctx.step2Label || 'Pick Items') + ' \u2713' },
        { label: ctx.step3Label || 'Add to Cart', description: 'Add your box to cart', doneLabel: (ctx.step3Label || 'Add to Cart') + ' \u2713' }
      ];
      var wizardDots = [];
      var wizardLines = [];
      var wizardDotEls = [];
      var wizardLabelEls = [];

      WIZARD_STEP_DEFS.forEach(function (def, i) {
        if (i > 0) {
          var line = document.createElement('div');
          line.className = 'cb-wizard-line';
          stepsRow.appendChild(line);
          wizardLines.push(line);
        }

        var stepWrapper = document.createElement('div');
        stepWrapper.className = 'cb-wizard-step-wrapper';
        stepWrapper.setAttribute('role', 'listitem');
        stepWrapper.setAttribute('aria-label', def.description);
        stepWrapper.title = def.description;

        var stepEl = document.createElement('div');
        stepEl.className = 'cb-wizard-step' + (i === 0 ? ' cb-wizard-step--active' : '');
        stepWrapper.appendChild(stepEl);

        var stepLbl = document.createElement('div');
        stepLbl.className = 'cb-wizard-step-label';
        stepLbl.textContent = def.label;
        stepWrapper.appendChild(stepLbl);

        stepsRow.appendChild(stepWrapper);
        wizardDots.push(stepEl);
        wizardDotEls.push(stepEl);
        wizardLabelEls.push(stepLbl);
      });

      wizardEl.appendChild(stepsRow);

      var wizardSelectedPrice = document.createElement('div');
      wizardSelectedPrice.className = 'cb-wizard-selected-price';
      wizardSelectedPrice.style.display = 'none';
      wizardEl.appendChild(wizardSelectedPrice);

      wrapper.appendChild(wizardEl);
      ctx._wizardDots = wizardDots;
      ctx._wizardLines = wizardLines;
      ctx._wizardDotEls = wizardDotEls;
      ctx._wizardLabelEls = wizardLabelEls;
      ctx._wizardStepDefs = WIZARD_STEP_DEFS;
      ctx._wizardSelectedPriceEl = wizardSelectedPrice;
    }

    var activeBoxBanner = document.createElement('div');
    activeBoxBanner.className = 'cb-active-box-banner';
    activeBoxBanner.hidden = true;
    root.appendChild(activeBoxBanner);
    ctx._activeBoxBanner = activeBoxBanner;

    // Step 1 Heading
    var step1Head = document.createElement('h2');
    step1Head.className = 'cb-step-heading';
    step1Head.textContent = ctx.step1Heading || 'Step 1: Select your box';
    wrapper.appendChild(step1Head);

    // ── Box grid ─────────────────────────────────────────────────────────────────
    var boxGrid = document.createElement('div');
    boxGrid.className = 'cb-box-grid';
    ctx.boxes.forEach(function (box) { boxGrid.appendChild(createBoxCard(box, ctx)); });
    wrapper.appendChild(boxGrid);

    // Store refs so openBuilder can show/hide Step 1 in steps mode
    if (ctx.layoutMode === 'steps') {
      ctx._step1Head = step1Head;
      ctx._boxGrid = boxGrid;
    }

    // ── Builder area ──────────────────────────────────────────────────────────
    var builderArea = document.createElement('div');
    builderArea.className = 'cb-builder-area';
    builderArea.style.display = 'none';
    wrapper.appendChild(builderArea);

    root.appendChild(wrapper);
    cbLog('renderWidget: content appended to root', cbDescribeRoot(root));

    // Single box visible: skip Step 1 entirely — hide heading + grid and auto-select
    if (ctx.productBoxOnly) {
      step1Head.style.display = 'none';
    }

    if (ctx.boxes.length === 1) {
      step1Head.style.display = 'none';
      boxGrid.style.display = 'none';
      var onlyCard = boxGrid.firstElementChild;
      if (onlyCard) onlyCard.click();
      return;
    }

    // Preview mode from admin eye action: auto-open requested box in both grid and steps layouts
    if (tryAutoSelectPreviewBox(boxGrid, ctx)) {
      return;
    }

    // Multiple boxes: auto-select first in grid mode; steps mode waits for user click
    if (ctx.layoutMode !== 'steps') {
      var firstCard = boxGrid.firstElementChild;
      if (firstCard) firstCard.click();
    }
  }

  // ─── Box Card ─────────────────────────────────────────────────────────────────

  function renderIndependentBundleSection(root, box, ctx, index) {
    var wrapper = document.createElement('div');
    wrapper.className = 'cb-wrapper cb-wrapper--independent';
    wrapper.setAttribute('data-box-id', String(box && box.id));

    var builderArea = document.createElement('div');
    builderArea.className = 'cb-builder-area';
    builderArea.style.display = 'block';
    wrapper.appendChild(builderArea);
    root.appendChild(wrapper);

    var childCtx = Object.assign({}, ctx, {
      boxes: [box],
      rootEl: root,
      _wrapper: wrapper,
      _openBoxId: box && box.id,
      _independentIndex: index,
    });

    var designStyle = buildBoxDesignStyle(box && box.designSettings);
    if (designStyle) builderArea.setAttribute('style', designStyle);
    applyBoxDesignStyle(wrapper, box && box.designSettings);

    if (Array.isArray(box && box.quantityPacks) && box.quantityPacks.length > 0) {
      renderPackPicker(builderArea, box, childCtx);
      return;
    }

    showPageLoader('Loading products...');
    fetchProducts(box.id, childCtx.shop, childCtx.apiBase, box.scopeType, null, childCtx, function (err, products) {
      hidePageLoader(true);
      if (err || !products || products.length === 0) {
        builderArea.innerHTML = '<p class="cb-error">Failed to load products. Please reload and try again.</p>';
        return;
      }
      renderBuilder(builderArea, box, products, childCtx);
    });
  }

  function appendShopParam(url, shop) {
    if (!url || !shop || /[?&]shop=/.test(url)) return url;
    return url + (url.indexOf('?') === -1 ? '?' : '&') + 'shop=' + encodeURIComponent(shop);
  }

  function resolveStorefrontImageSrc(src, ctx) {
    if (!src) return null;
    var value = String(src);
    if (/^(data:|blob:|https?:\/\/|\/\/)/i.test(value)) return value;
    if (value.indexOf('/api/storefront/') === 0 && ctx && ctx.apiBase) {
      return appendShopParam(ctx.apiBase.replace(/\/+$/, '') + value, ctx.shop);
    }
    return appendShopParam(value, ctx && ctx.shop);
  }

  function getBoxCardBannerSrc(box, ctx) {
    if (box.bannerImage) return resolveStorefrontImageSrc(box.bannerImage, ctx);
    if (box.bannerImageUrl) return box.bannerImageUrl;
    if (box.hasUploadedBanner) {
      return appendShopParam(ctx.apiBase + '/api/storefront/boxes/' + box.id + '/banner', ctx.shop);
    }

    var steps = box && box.comboConfig && Array.isArray(box.comboConfig.steps)
      ? box.comboConfig.steps
      : [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i] && steps[i].stepImageUrl) return steps[i].stepImageUrl;
    }

    return null;
  }

  function getBoxCardBundleImageSrc(box, ctx) {
    if (box.bundleImage) return resolveStorefrontImageSrc(box.bundleImage, ctx);
    if (box.bundleImageUrl) return box.bundleImageUrl;
    if (box.hasUploadedBundleImage && ctx && ctx.apiBase) {
      return appendShopParam(ctx.apiBase + '/api/storefront/boxes/' + box.id + '/image/bundleImage', ctx.shop);
    }
    return null;
  }

  function setActiveBoxBanner(ctx, box) {
    var banner = ctx && ctx._activeBoxBanner;
    if (!banner) return;

    banner.innerHTML = '';
    applyBoxDesignStyle(banner, box && box.designSettings);
    if (!box || box.hideBannerImage) {
      banner.hidden = true;
      return;
    }

    var bannerSrc = getBoxCardBannerSrc(box, ctx);
    if (!bannerSrc) {
      banner.hidden = true;
      return;
    }

    var img = document.createElement('img');
    img.className = 'cb-active-box-banner-img';
    img.src = bannerSrc;
    img.alt = box.displayTitle || box.boxName || 'Bundle banner';
    img.loading = 'lazy';
    banner.appendChild(img);
    banner.hidden = false;
  }

  function createBoxCard(box, ctx) {
    var card = document.createElement('div');
    card.className = 'cb-box-card' + (box.productImageAutoHeight ? ' cb-box-card--auto-height' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.setAttribute('data-box-id', String(box.id));

    var designStyle = buildBoxDesignStyle(box.designSettings);
    if (designStyle) card.setAttribute('style', designStyle);

    // Gift badge — top-left corner of card
    if (box.isGiftBox) {
      var giftTag = document.createElement('span');
      giftTag.className = 'cb-gift-tag';
      giftTag.textContent = 'Gift Box';
      card.appendChild(giftTag);
    }

    // Discount badge — top-right corner of card banner
    var _discountCfg = getBoxDiscountConfig(box) || {};
    var _discountType = _discountCfg.discountType || 'none';
    var _discountValue = parseFloat(_discountCfg.discountValue) || 0;
    var _hasDiscount = isDynamicBundlePrice(box) && (_discountType === 'buy_x_get_y' || (_discountType !== 'none' && _discountValue > 0));
    if (_hasDiscount) {
      var discountBadge = document.createElement('span');
      discountBadge.className = 'cb-discount-badge';
      if (_discountType === 'buy_x_get_y') {
        var _buyQty = Math.max(1, parseInt(String(_discountCfg.buyQuantity || 1), 10) || 1);
        var _getQty = Math.max(1, parseInt(String(_discountCfg.getQuantity || 1), 10) || 1);
        discountBadge.textContent = 'BUY ' + _buyQty + ' GET ' + _getQty;
      } else {
        discountBadge.textContent = _discountType === 'percent'
          ? _discountValue + '% OFF'
          : ctx.currencySymbol + _discountValue + ' OFF';
      }
      card.appendChild(discountBadge);
    }

    // Checkmark badge (shown when selected)
    var check = document.createElement('div');
    check.className = 'cb-box-check';
    check.innerHTML = '&#10003;';
    card.appendChild(check);

    // Body text
    var body = document.createElement('div');
    body.className = 'cb-box-body';

    var bundleImageSrc = getBoxCardBundleImageSrc(box, ctx);
    if (bundleImageSrc) {
      var bundleImageWrap = document.createElement('div');
      bundleImageWrap.className = 'cb-box-bundle-image-wrap';
      var bundleImage = document.createElement('img');
      bundleImage.className = 'cb-box-bundle-image';
      bundleImage.src = bundleImageSrc;
      bundleImage.alt = box.displayTitle || box.boxName || 'Bundle image';
      bundleImage.loading = 'lazy';
      bundleImageWrap.appendChild(bundleImage);
      body.appendChild(bundleImageWrap);
    }

    // Display title moved from banner overlay to body
    var titleText = document.createElement('div');
    titleText.className = 'cb-box-display-title';
    titleText.textContent = box.displayTitle || box.boxName || ('Buy ' + box.itemCount);
    body.appendChild(titleText);

    var priceText = document.createElement('div');
    priceText.className = 'cb-box-price-text';
    box._priceTextEl = priceText;
    setBoxCardPrice(
      box,
      isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
      ctx.currencySymbol
    );
    body.appendChild(priceText);

    // CTA button
    var ctaBtn = document.createElement('button');
    ctaBtn.className = 'cb-box-cta-btn';
    ctaBtn.type = 'button';
    ctaBtn.textContent = resolveCtaButtonLabel(ctx.settings, box.ctaButtonLabel);
    body.appendChild(ctaBtn);

    card.appendChild(body);

    function onSelect() {
      var cardScope = ctx && ctx.rootEl ? ctx.rootEl : card.closest('.combo-builder-root');
      if (cardScope) {
        cardScope.querySelectorAll('.cb-box-card').forEach(function (c) { c.classList.remove('cb-box-card--active'); });
      }
      card.classList.add('cb-box-card--active');
      setActiveBoxBanner(ctx, box);
      openBuilder(box, ctx);
    }

    card.addEventListener('click', onSelect);
    card.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(); }
    });

    return card;
  }

  function tryAutoSelectPreviewBox(boxGrid, ctx) {
    if (!ctx || !ctx.previewBoxId || !boxGrid) return false;
    var previewCard = boxGrid.querySelector('.cb-box-card[data-box-id="' + String(ctx.previewBoxId) + '"]');
    if (!previewCard) return false;
    previewCard.click();
    return true;
  }

  // ─── Open Builder ─────────────────────────────────────────────────────────────

  function openBuilder(box, ctx) {
    var wrapper = ctx && ctx._wrapper
      ? ctx._wrapper
      : (ctx && ctx.rootEl ? ctx.rootEl.querySelector('.cb-wrapper') : null);
    if (!wrapper) return;
    var builderArea = wrapper.querySelector('.cb-builder-area');
    if (!builderArea) return;

    // Steps mode: hide Step 1 (box grid) and advance wizard
    if (ctx.layoutMode === 'steps') {
      if (ctx._step1Head) ctx._step1Head.style.display = 'none';
      if (ctx._boxGrid) ctx._boxGrid.style.display = 'none';

      // Wire Change box button (pre-created in renderWidget wizard header)
      if (ctx._changeBoxBtn && !ctx._changeBoxBtnWired) {
        ctx._changeBoxBtnWired = true;
        var _cbBtn = ctx._changeBoxBtn;
        _cbBtn.addEventListener('click', function () {
          // Multiple Box has an inner Pack-by-Pack flow. Give it first chance
          // to handle Back (final review -> last Pack, Pack N -> Pack N-1).
          if (typeof ctx._packFlowBackHandler === 'function' && ctx._packFlowBackHandler()) {
            return;
          }

          // Two-level back: if product grid is currently hidden (all slots filled),
          // first go back to showing the product grid. If product grid is already
          // visible, go all the way back to Step 1 (box selection).
          if (ctx._productSection && ctx._productSection.style.display === 'none') {
            ctx._productSection.style.display = '';
            return;
          }

          if (ctx._step1Head) ctx._step1Head.style.display = '';
          if (ctx._boxGrid) ctx._boxGrid.style.display = '';
          if (typeof ctx._packFlowCleanup === 'function') {
            try { ctx._packFlowCleanup(); } catch (_) {}
          }
          ctx._packFlowCleanup = null;
          ctx._packFlowBackHandler = null;
          builderArea.style.display = 'none';
          builderArea.innerHTML = '';
          ctx._productSection = null;
          ctx._openBoxId = null;
          setActiveBoxBanner(ctx, null);
          _cbBtn.style.visibility = 'hidden';
          setWizardSelectedPrice(ctx, null, null);
          if (ctx._wizardStep1Content) ctx._wizardStep1Content.style.display = 'none';
          if (ctx._wizardDots) {
            ctx._wizardDots[0].className = 'cb-wizard-step cb-wizard-step--active';
            ctx._wizardDots[1].className = 'cb-wizard-step';
            ctx._wizardDots[2].className = 'cb-wizard-step';
            if (ctx._wizardLines[0]) ctx._wizardLines[0].className = 'cb-wizard-line';
            if (ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line';
            if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
              ctx._wizardLabelEls.forEach(function (el, i) { el.textContent = ctx._wizardStepDefs[i].label; });
            }
          }
          if (ctx.rootEl) {
            ctx.rootEl.querySelectorAll('.cb-box-card').forEach(function (c) { c.classList.remove('cb-box-card--active'); });
          }
        });
      }
      if (ctx._changeBoxBtn) ctx._changeBoxBtn.style.visibility = 'visible';

      if (ctx._wizardDots) {
        ctx._wizardDots[0].className = 'cb-wizard-step cb-wizard-step--done';
        ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--active';
        ctx._wizardDots[2].className = 'cb-wizard-step';
        if (ctx._wizardLines[0]) ctx._wizardLines[0].className = 'cb-wizard-line cb-wizard-line--done';
        if (ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line';
        if (ctx._wizardLabelEls) {
          var boxTitle = (box.displayTitle || box.boxName || '').slice(0, 20);
          ctx._wizardLabelEls[0].textContent = boxTitle || (ctx._wizardStepDefs ? ctx._wizardStepDefs[0].doneLabel : 'Box Selected');
          if (ctx._wizardStepDefs) ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].label;
          if (ctx._wizardStepDefs) ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
        }
        // Show box image + name in Step 1 box
        if (ctx._wizardStep1Content) {
          var bSrc = getBoxCardBannerSrc(box, ctx);
          if (bSrc && ctx._wizardStep1Img) {
            ctx._wizardStep1Img.src = bSrc;
            ctx._wizardStep1Img.style.display = 'block';
          } else if (ctx._wizardStep1Img) {
            ctx._wizardStep1Img.style.display = 'none';
          }
          if (ctx._wizardStep1Name) {
            ctx._wizardStep1Name.textContent = box.displayTitle || box.boxName || '';
          }
          ctx._wizardStep1Content.style.display = 'flex';
        }
      }
      setWizardSelectedPrice(ctx, box, parseFloat(box.bundlePrice) || 0);
    }

    if (isDynamicBundlePrice(box)) {
      setBoxCardPrice(box, null, ctx.currencySymbol);
    }

    if (typeof ctx._packFlowCleanup === 'function') {
      try { ctx._packFlowCleanup(); } catch (_) {}
    }
    ctx._packFlowCleanup = null;
    ctx._packFlowBackHandler = null;

    ctx._openBoxId = box.id;

    builderArea.innerHTML = '';

    // Per-box design settings apply to the whole opened builder area too (not
    // just the box card) — packs share their page's designSettings, there's
    // no separate per-pack design config. Set before `display` so the inline
    // style attribute isn't clobbered.
    var designStyle = buildBoxDesignStyle(box.designSettings);
    if (designStyle) builderArea.setAttribute('style', designStyle);
    applyBoxDesignStyle(ctx.rootEl, box.designSettings);
    applyBoxDesignStyle(wrapper, box.designSettings);
    builderArea.classList.toggle('cb-builder-area--auto-height', !!box.productImageAutoHeight);
    builderArea.style.display = 'block';

    if (Array.isArray(box.quantityPacks) && box.quantityPacks.length > 0) {
      // Multiple Box: each quantity pack is a frontend step in array order.
      // Pack 1 -> Step 1, Pack 2 -> Step 2, Pack 3 -> Step 3, etc.
      // The first pack opens immediately after the customer selects the box.
      renderPackPicker(builderArea, box, ctx);
      builderArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (box.comboConfig && Array.isArray(box.comboConfig.steps) && box.comboConfig.steps.length > 0) {
      // Inline grid spinner shown by loadAndRenderGrid inside renderSpecificComboBuilder
      setTimeout(function () {
        renderSpecificComboBuilder(builderArea, box, ctx);
        builderArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 0);
    } else {
      showPageLoader('Loading products…');
      fetchProducts(box.id, ctx.shop, ctx.apiBase, box.scopeType, null, ctx, function (err, products) {
        hidePageLoader(true);
        if (ctx._openBoxId !== box.id) return;
        if (err || !products || products.length === 0) {
          builderArea.innerHTML = '<p class="cb-error">Failed to load products. Please reload and try again.</p>';
          return;
        }
        renderBuilder(builderArea, box, products, ctx);
        builderArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  }

  // ─── Mix n Match: Pack → Step Flow ────────────────────────────────────────────
  // Every quantityPack maps one-to-one, in order, to its own sequential Step:
  // Pack 1 -> Step 1, Pack 2 -> Step 2, etc. (box.quantityPacks already arrives
  // pre-sorted by sortOrder — see getBox()'s orderBy — so array order IS pack
  // order; no sorting by title/position needed here). The customer completes
  // each Step's own product grid (existing renderBuilder, reused unmodified per
  // Step) in order; a Step's own existing "all slots filled" validation gates
  // moving to the next one. All Packs' selections are kept (see packSlotsByKey)
  // until the LAST Step's Add to Cart/Checkout, which submits every Pack's
  // selection together as one combined action (see addPackStepsToCart).

  function getPackKey(pack) {
    return String(pack && (pack.packKey || pack.title || pack.productItems || '') || '');
  }

  // Merges the chosen pack's own fields on top of the real box object. Fields
  // like shopifyVariantId/shopifyProductId/id/allowDuplicates/isGiftBox are
  // intentionally left untouched (packs share ONE Shopify bundle product with
  // their box) — only presentational/pricing/product-selection fields are
  // overridden, so renderBuilder/addToCart need zero pack-specific branching.
  function buildPackOverrideBox(box, pack) {
    var discountSource = (box && box.pageDiscount) || pack || {};
    var bundlePriceType = discountSource.bundlePriceType || (pack && pack.bundlePriceType) || (box && box.bundlePriceType) || 'manual';
    var isManual = String(bundlePriceType || 'manual') === 'manual';
    return Object.assign({}, box, {
      _packKey: getPackKey(pack),
      _packTitle: pack.title || ('Pack of ' + pack.productItems),
      // Every Pack maps to exactly one Step with exactly one product selection —
      // the Pack's own "Product Items" count no longer determines slot count
      // (that field is now unused by the Multiple Box selection flow; the
      // number of selections is driven solely by the number of Packs/Steps).
      itemCount: 1,
      stepTitle: pack.stepTitle || box.stepTitle,
      stepDescription: pack.stepDescription || box.stepDescription,
      buttonLabel: pack.buttonLabel || box.buttonLabel,
      productButtonTitle: pack.buttonLabel || box.productButtonTitle,
      scopeType: pack.productConfiguration === 'whole_store' ? 'wholestore' : 'specific',
      bundlePriceType: bundlePriceType,
      bundlePrice: isManual ? (discountSource.discountValue != null ? discountSource.discountValue : 0) : 0,
      comboConfig: !isManual
        ? {
            discountType: discountSource.discountType,
            discountValue: discountSource.discountValue,
            buyQuantity: discountSource.buyQuantity,
            getQuantity: discountSource.getQuantity
          }
        : null
    });
  }

  // doneFlags: boolean array, one per pack, reflecting each Pack's OWN actual
  // completion — never inferred from a sequential position/count, since every
  // Pack's section is visible and editable at the same time (see
  // renderPackPicker) and Packs can be completed in any order.
  // doneFlags: boolean per Pack (has a selection). activeIndex: which Pack's
  // Step is currently shown (or -1 once every Pack is done). onSelectDone, if
  // given, makes a completed Step's dot clickable so the customer can jump
  // back to review/change that Pack's selection (see renderPackPicker).
  // Decorates renderBuilder's own slot row (built for whichever Pack is
  // currently active — see renderPackPicker) with one extra box per OTHER
  // Pack, reusing the exact same .cb-slot-step markup/classes renderBuilder
  // already uses for a real, filled slot (no new visual language). The
  // active Pack's own real slot box is preserved as-is at its correct
  // position; other Packs render as read-only previews (their selected
  // product's thumbnail once done, a plain number until then), and a done
  // Pack's box is clickable to jump back and revisit it.
  function isPackOptional(pack) {
    if (!pack) return false;
    return pack.optional === true || String(pack.optional).toLowerCase() === 'true';
  }

  function normalizeStepProduct(p) {
    p = p || {};
    var rawVarId = p && (p.variantId || p.selectedVariantId || null);
    var numericVarId = rawVarId && String(rawVarId).indexOf('/') !== -1
      ? String(rawVarId).split('/').pop()
      : (rawVarId ? String(rawVarId) : null);
    return {
      productId: p.id || p.productId,
      productTitle: p.title || p.productTitle || '',
      productHandle: p.handle || p.productHandle || '',
      productImageUrl: p.imageUrl || p.productImageUrl || null,
      productPrice: parseFloat(p.price || p.productPrice) || 0,
      productCompareAtPrice: parseFloat(p.compareAtPrice || p.productCompareAtPrice) || null,
      productAvailable: p.productAvailable,
      productOptions: p.productOptions,
      colorValues: p.colorValues,
      variants: p.variants,
      variantIds: numericVarId ? [numericVarId] : (Array.isArray(p.variantIds) ? p.variantIds : []),
      isCollection: !!p.isCollection,
    };
  }

  function getInlineStepProducts(stepCfg, ctx) {
    if (!stepCfg) return null;
    if (Array.isArray(stepCfg.resolvedProducts) && stepCfg.resolvedProducts.length > 0) {
      return filterInternalComboProducts(stepCfg.resolvedProducts.map(normalizeStepProduct), ctx);
    }
    if (Array.isArray(stepCfg.selectedProducts) && stepCfg.selectedProducts.length > 0) {
      return filterInternalComboProducts(stepCfg.selectedProducts.map(normalizeStepProduct), ctx);
    }
    return null;
  }

  function decorateRealPackStepNode(step, pack, idx, slotProduct, isSkipped) {
    if (!step) return;
    if (!step.__cbPackClickGuard) {
      step.__cbPackClickGuard = true;
      step.addEventListener('click', function (event) {
        if (event.target && event.target.closest && event.target.closest('.cb-slot-remove')) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      }, true);
    }
    step.classList.toggle('cb-slot-step--filled', !!slotProduct);
    step.classList.toggle('cb-slot-step--skipped', !slotProduct && !!isSkipped);
    step.classList.toggle('cb-slot-step--active', !slotProduct && !isSkipped);

    var numEl = step.querySelector('.cb-slot-step-num');
    if (numEl) {
      numEl.innerHTML = '';
      if (slotProduct && slotProduct.productImageUrl) {
        var thumb = document.createElement('img');
        thumb.src = slotProduct.productImageUrl;
        thumb.alt = slotProduct.productTitle || '';
        thumb.className = 'cb-slot-step-thumb';
        numEl.appendChild(thumb);
      } else if (slotProduct) {
        numEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
      } else {
        numEl.textContent = String(idx + 1);
      }
    }

    var smallText = step.querySelector('.cb-slot-step-small');
    if (smallText) {
      smallText.textContent = slotProduct ? 'Selected' : (isSkipped ? 'Skipped' : (isPackOptional(pack) ? 'Optional' : 'Select your'));
    }

    var itemLink = step.querySelector('.cb-slot-step-item');
    if (itemLink) {
      itemLink.textContent = pack.title || ('Pack ' + (idx + 1));
      itemLink.classList.toggle('cb-slot-step-item--filled', !!slotProduct);
    }

    var labelEl = step.querySelector('.cb-slot-step-label');
    if (labelEl) {
      var oldDetail = labelEl.querySelector('.cb-pack-selected-detail');
      if (oldDetail) oldDetail.remove();
      if (slotProduct) {
        var detail = document.createElement('span');
        detail.className = 'cb-pack-selected-detail';
        var detailTitle = slotProduct.productTitle || ('Item ' + (idx + 1));
        if (slotProduct.selectedVariantTitle) detailTitle += ' (' + slotProduct.selectedVariantTitle + ')';
        detail.textContent = detailTitle;
        detail.title = detailTitle;
        labelEl.appendChild(detail);
      }
    }
  }

  function decoratePackRow(slotStepsEl, packs, packKeysInOrder, packSlotsByKey, skippedPacksByIndex, currentIndex, onRevisit, onRemove) {
    if (!slotStepsEl) return;
    var realSlotNode = slotStepsEl.querySelector('.cb-slot-step');
    slotStepsEl.innerHTML = '';

    packs.forEach(function (pack, idx) {
      if (idx > 0) {
        var connector = document.createElement('div');
        connector.className = 'cb-slot-connector';
        slotStepsEl.appendChild(connector);
      }

      var slotProduct = (packSlotsByKey[packKeysInOrder[idx]] || []).filter(Boolean)[0] || null;
      var isSkipped = !!skippedPacksByIndex[idx];

      if (idx === currentIndex && realSlotNode) {
        decorateRealPackStepNode(realSlotNode, pack, idx, slotProduct, isSkipped);
        slotStepsEl.appendChild(realSlotNode);
        return;
      }

      var step = document.createElement('div');
      step.className = 'cb-slot-step';
      if (slotProduct) step.classList.add('cb-slot-step--filled');
      else if (isSkipped) step.classList.add('cb-slot-step--skipped');
      else if (idx === currentIndex) step.classList.add('cb-slot-step--active');

      var numEl = document.createElement('div');
      numEl.className = 'cb-slot-step-num';
      if (slotProduct && slotProduct.productImageUrl) {
        var thumb = document.createElement('img');
        thumb.src = slotProduct.productImageUrl;
        thumb.alt = slotProduct.productTitle || '';
        thumb.className = 'cb-slot-step-thumb';
        numEl.appendChild(thumb);
      } else if (slotProduct) {
        numEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
      } else {
        numEl.textContent = String(idx + 1);
      }
      step.appendChild(numEl);

      var labelEl = document.createElement('div');
      labelEl.className = 'cb-slot-step-label';
      var smallText = document.createElement('span');
      smallText.className = 'cb-slot-step-small';
      smallText.textContent = slotProduct ? 'Selected' : (isSkipped ? 'Skipped' : (isPackOptional(pack) ? 'Optional' : 'Select your'));
      labelEl.appendChild(smallText);

      var itemLink = document.createElement('div');
      itemLink.className = 'cb-slot-step-item';
      itemLink.textContent = pack.title || ('Pack ' + (idx + 1));
      if (slotProduct) itemLink.classList.add('cb-slot-step-item--filled');
      labelEl.appendChild(itemLink);

      if (slotProduct) {
        var detail = document.createElement('span');
        detail.className = 'cb-pack-selected-detail';
        var detailTitle = slotProduct.productTitle || ('Item ' + (idx + 1));
        if (slotProduct.selectedVariantTitle) detailTitle += ' (' + slotProduct.selectedVariantTitle + ')';
        detail.textContent = detailTitle;
        detail.title = detailTitle;
        labelEl.appendChild(detail);
      }
      step.appendChild(labelEl);

      if ((slotProduct || isSkipped) && typeof onRevisit === 'function') {
        step.style.cursor = 'pointer';
        step.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          onRevisit(idx);
        });
      }

      if (slotProduct && typeof onRemove === 'function') {
        var removeBtn = document.createElement('button');
        removeBtn.className = 'cb-slot-remove';
        removeBtn.type = 'button';
        removeBtn.setAttribute('aria-label', 'Remove selected product from ' + (pack.title || ('Pack ' + (idx + 1))));
        removeBtn.innerHTML = '&times;';
        removeBtn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          onRemove(idx);
        });
        step.appendChild(removeBtn);
      }

      slotStepsEl.appendChild(step);
    });
  }

  // Sequential Pack -> Step flow: exactly one Pack's product grid is visible
  // at a time (Pack 1 -> Step 1, Pack 2 -> Step 2, ...). Selecting that Pack's
  // one product auto-advances to the next incomplete Pack — no manual
  // "Continue" click. Every Pack's own cart/checkout UI stays suppressed (see
  // renderBuilder's stepOptions.hideOwnCartUI); a single page-level Add to
  // Cart/Checkout appear only on the dedicated Final Review stage after every
  // Pack is selected or intentionally skipped (optional Packs only). Completed
  // Steps stay clickable so the customer can go back and change an earlier
  // Pack's pick; every Pack's selection is kept in packSlotsByKey regardless
  // of which Step is showing.
  // All Packs are shown together as slot-style boxes in the same row as the
  // active Pack's own product slot (see decoratePackRow) — no separate progress
  // row above the bundle.
  function renderPackPicker(container, box, ctx) {
    container.innerHTML = '';

    var packs = Array.isArray(box.quantityPacks) ? box.quantityPacks : [];

    // Exact Multiple Box storefront flow:
    //   Pack 1 / Step 1 -> customer MUST select a product.
    //   Pack 2+        -> customer selects a product, or may Skip only when
    //                     that Pack is explicitly configured as optional.
    // Keep the server/admin object immutable by cloning only Pack 1 when its
    // stored optional flag is true. This makes the first Pack a hard gate on
    // the storefront without changing the saved configuration.
    packs = packs.map(function (pack, index) {
      if (index !== 0 || !isPackOptional(pack)) return pack;
      return Object.assign({}, pack, { optional: false });
    });

    mbLog('init', {
      boxId: box && box.id,
      packCount: packs.length,
      packs: packs.map(function (pack, idx) {
        return {
          index: idx,
          packKey: getPackKey(pack),
          title: pack && pack.title,
          productConfiguration: pack && pack.productConfiguration,
          optional: isPackOptional(pack)
        };
      })
    });

    if (packs.length === 0) {
      mbLog('no packs configured', { boxId: box && box.id });
      container.innerHTML = '<p class="cb-error">No steps configured for this bundle.</p>';
      return;
    }

    var stepArea = document.createElement('div');
    stepArea.className = 'cb-pack-builder-panel';
    container.appendChild(stepArea);

    // Final action reuses the existing inline slot-row cart button so the
    // completed Multiple Box view keeps the current Pack grid visible.
    var finalStage = document.createElement('div');
    finalStage.className = 'cb-pack-final-stage cb-step3-cart';
    finalStage.style.display = 'none';

    var finalGiftInput = null;
    if (box.giftMessageEnabled) {
      var finalGiftSection = document.createElement('div');
      finalGiftSection.className = 'cb-gift-section';
      finalGiftSection.style.display = 'block';

      var finalGiftLabel = document.createElement('label');
      finalGiftLabel.className = 'cb-gift-label';
      finalGiftLabel.textContent = 'Gift Message (optional)';

      finalGiftInput = document.createElement('textarea');
      finalGiftInput.className = 'cb-gift-input';
      finalGiftInput.placeholder = 'Write a personal message...';
      finalGiftInput.rows = 2;
      finalGiftInput.maxLength = 100;

      finalGiftSection.appendChild(finalGiftLabel);
      finalGiftSection.appendChild(finalGiftInput);
      finalStage.appendChild(finalGiftSection);
    }

    var finalCartBtn = null;

    finalCartBtn = document.createElement('button');
    finalCartBtn.type = 'button';
    finalCartBtn.className = 'cb-inline-cart-btn cb-pack-final-cart-btn';
    finalCartBtn.disabled = true;
    finalCartBtn.style.display = 'none';
    finalCartBtn.textContent = resolveStepCartButtonLabel(box, ctx);
    container.appendChild(finalStage);

    // Persist every Pack selection by array index. Pack keys/titles can be
    // missing or duplicated; array position is the only guaranteed unique
    // identity inside a single Multiple Box configuration.
    var packSlotsByKey = {};
    var packKeysInOrder = packs.map(function (_pack, i) { return i; });
    var packProductsCache = {};
    var packWholeStorePageState = {};

    // Explicit state is required so an optional Pack that was intentionally
    // skipped is not confused with a Pack the customer has never visited.
    var stepStates = packs.map(function () {
      return { status: 'pending' }; // pending | selected | skipped
    });

    var currentIndex = 0;
    var advanceTimer = null;
    var stepLoadToken = 0;
    var destroyed = false;
    var sessionId = generateSessionId();

    function getStepStatus(index) {
      var state = stepStates[index];
      return state && state.status ? state.status : 'pending';
    }

    function setStepStatus(index, status) {
      if (!stepStates[index]) stepStates[index] = { status: 'pending' };
      stepStates[index].status = status;
    }

    function hasSelectedPack(index) {
      return Array.isArray(packSlotsByKey[index]) && packSlotsByKey[index].some(Boolean);
    }

    function syncStepStateFromSlots(index) {
      if (hasSelectedPack(index)) {
        setStepStatus(index, 'selected');
        return;
      }
      // An explicit skip remains skipped until the customer selects a product.
      if (getStepStatus(index) !== 'skipped') setStepStatus(index, 'pending');
    }

    function isPackComplete(index) {
      var status = getStepStatus(index);
      return status === 'selected' || (status === 'skipped' && isPackOptional(packs[index]));
    }

    function isFlowComplete() {
      for (var i = 0; i < packs.length; i++) {
        if (!isPackComplete(i)) return false;
      }
      return true;
    }

    function firstIncompleteIndex() {
      for (var i = 0; i < packs.length; i++) {
        if (!isPackComplete(i)) return i;
      }
      return -1;
    }

    function nextIncompleteIndexAfter(index) {
      for (var i = index + 1; i < packs.length; i++) {
        if (!isPackComplete(i)) return i;
      }
      return -1;
    }

    function getSkippedMap() {
      var skipped = {};
      stepStates.forEach(function (state, idx) {
        if (state && state.status === 'skipped') skipped[idx] = true;
      });
      return skipped;
    }

    function getAllOtherSelectedSlots(index) {
      var selected = [];
      packs.forEach(function (_pack, idx) {
        if (idx === index) return;
        (packSlotsByKey[idx] || []).forEach(function (slot) {
          if (slot) selected.push(slot);
        });
      });
      return selected;
    }

    function getPackProducts(index, packBox, cb) {
      if (packProductsCache[index]) {
        mbLog('products cache hit', { step: index + 1, count: packProductsCache[index].length });
        cb(null, packProductsCache[index], null);
        return;
      }

      var pack = packs[index];
      var inlineProducts = getInlineStepProducts(pack, ctx);
      if (inlineProducts) {
        packProductsCache[index] = inlineProducts;
        mbLog('products resolved inline', { step: index + 1, count: inlineProducts.length });
        cb(null, inlineProducts, null);
        return;
      }

      if (
        pack &&
        pack.productConfiguration === 'selected_collections' &&
        Array.isArray(pack.collections) &&
        pack.collections.length > 0
      ) {
        var colls = pack.collections.filter(function (c) { return c && c.handle; });
        if (!colls.length) {
          cb(null, [], null);
          return;
        }

        var remaining = colls.length;
        var allProds = [];
        var seenIds = {};
        var firstErr = null;

        colls.forEach(function (coll) {
          fetchCollectionProducts(coll.handle, function (err, prods) {
            if (err) firstErr = err;

            (prods || []).forEach(function (p) {
              if (!p || seenIds[p.productId]) return;
              seenIds[p.productId] = true;
              allProds.push(p);
            });

            remaining--;
            if (remaining === 0) {
              var filtered = filterInternalComboProducts(allProds, ctx);
              if (filtered.length > 0) packProductsCache[index] = filtered;

              mbLog('products resolved from collections', {
                step: index + 1,
                collectionCount: colls.length,
                count: filtered.length,
                error: firstErr && firstErr.message
              });

              cb(firstErr && filtered.length === 0 ? firstErr : null, filtered, null);
            }
          });
        });
        return;
      }

      fetchProducts(
        box.id,
        ctx.shop,
        ctx.apiBase,
        packBox.scopeType,
        getPackKey(pack),
        ctx,
        function (err, products, pageInfo) {
          if (!err && products && products.length > 0 && packBox.scopeType !== 'wholestore') {
            packProductsCache[index] = products;
          }
          if (!err && packBox.scopeType === 'wholestore') {
            packWholeStorePageState[index] = {
              pageInfo: pageInfo || null,
              cursorStack: [],
              search: ''
            };
          }

          mbLog('products resolved from API', {
            step: index + 1,
            packKey: getPackKey(pack),
            scopeType: packBox && packBox.scopeType,
            count: products ? products.length : 0,
            error: err && err.message
          });

          cb(err, products, pageInfo || null);
        },
        index,
        { allowInternalProducts: true }
      );
    }

    function syncGlobalWizard(showFinal) {
      if (ctx.layoutMode !== 'steps' || !ctx._wizardDots) return;

      if (showFinal) {
        ctx._wizardDots[0].className = 'cb-wizard-step cb-wizard-step--done';
        ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--done';
        ctx._wizardDots[2].className = 'cb-wizard-step cb-wizard-step--active';

        if (ctx._wizardLines && ctx._wizardLines[0]) {
          ctx._wizardLines[0].className = 'cb-wizard-line cb-wizard-line--done';
        }
        if (ctx._wizardLines && ctx._wizardLines[1]) {
          ctx._wizardLines[1].className = 'cb-wizard-line cb-wizard-line--done';
        }

        if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
          ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].doneLabel;
          ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
        }
      } else {
        ctx._wizardDots[0].className = 'cb-wizard-step cb-wizard-step--done';
        ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--active';
        ctx._wizardDots[2].className = 'cb-wizard-step';

        if (ctx._wizardLines && ctx._wizardLines[0]) {
          ctx._wizardLines[0].className = 'cb-wizard-line cb-wizard-line--done';
        }
        if (ctx._wizardLines && ctx._wizardLines[1]) {
          ctx._wizardLines[1].className = 'cb-wizard-line';
        }

        if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
          ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].label;
          ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
        }
      }
    }

    function renderFinalSummary() {
      finalSummarySteps.innerHTML = '';

      packs.forEach(function (pack, idx) {
        if (idx > 0) {
          var connector = document.createElement('div');
          connector.className = 'cb-slot-connector';
          finalSummarySteps.appendChild(connector);
        }

        var slotProduct = (packSlotsByKey[idx] || []).filter(Boolean)[0] || null;
        var status = getStepStatus(idx);
        var isSkipped = status === 'skipped';

        var reviewStep = document.createElement('div');
        reviewStep.className = 'cb-slot-step cb-pack-review-step';
        if (slotProduct) reviewStep.classList.add('cb-slot-step--filled');
        if (isSkipped) reviewStep.classList.add('cb-slot-step--skipped');
        reviewStep.setAttribute('role', 'button');
        reviewStep.setAttribute('tabindex', '0');
        reviewStep.setAttribute('aria-label', 'Edit Pack ' + (idx + 1));
        reviewStep.title = 'Edit this step';

        var numEl = document.createElement('div');
        numEl.className = 'cb-slot-step-num';
        if (slotProduct && slotProduct.productImageUrl) {
          var thumb = document.createElement('img');
          thumb.src = slotProduct.productImageUrl;
          thumb.alt = slotProduct.productTitle || '';
          thumb.className = 'cb-slot-step-thumb';
          numEl.appendChild(thumb);
        } else if (slotProduct) {
          numEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
        } else {
          numEl.textContent = String(idx + 1);
        }
        reviewStep.appendChild(numEl);

        var labelEl = document.createElement('div');
        labelEl.className = 'cb-slot-step-label';

        var smallText = document.createElement('span');
        smallText.className = 'cb-slot-step-small';
        smallText.textContent = isSkipped ? 'Skipped' : 'Selected';
        labelEl.appendChild(smallText);

        var packTitle = document.createElement('div');
        packTitle.className = 'cb-slot-step-item cb-slot-step-item--filled';
        packTitle.textContent = pack.title || ('Pack ' + (idx + 1));
        labelEl.appendChild(packTitle);

        var selectionText = document.createElement('span');
        selectionText.className = 'cb-pack-review-selection';
        selectionText.style.display = 'block';
        selectionText.style.marginTop = '2px';
        selectionText.style.fontSize = '11px';
        selectionText.style.lineHeight = '1.35';
        selectionText.style.color = 'var(--cb-text-muted)';
        if (slotProduct) {
          var selectedLabel = slotProduct.productTitle || ('Item ' + (idx + 1));
          if (slotProduct.selectedVariantTitle) selectedLabel += ' · ' + slotProduct.selectedVariantTitle;
          selectionText.textContent = selectedLabel;
        } else {
          selectionText.textContent = 'Optional step skipped';
        }
        labelEl.appendChild(selectionText);

        reviewStep.appendChild(labelEl);

        function editStep() {
          openStep(idx);
        }
        reviewStep.addEventListener('click', editStep);
        reviewStep.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            editStep();
          }
        });

        finalSummarySteps.appendChild(reviewStep);
      });
    }

    function getPackEntriesForCart() {
      return packs.map(function (pack, idx) {
        return {
          packKey: getPackKey(pack),
          packTitle: pack.title,
          slots: packSlotsByKey[idx] || []
        };
      }).filter(function (entry) {
        return (entry.slots || []).some(Boolean);
      });
    }

    function setFinalCartButtonState(ready) {
      if (!finalCartBtn) return;
      finalCartBtn.disabled = !ready;
      finalCartBtn.style.display = ready ? '' : 'none';
      if (ready) finalCartBtn.classList.add('cb-inline-cart-btn--ready');
      else finalCartBtn.classList.remove('cb-inline-cart-btn--ready');
    }

    function attachFinalCartButton() {
      if (!finalCartBtn) return;

      var wrapper = stepArea.querySelector('.cb-slot-wrapper');
      if (wrapper && finalCartBtn.parentNode !== wrapper) {
        wrapper.appendChild(finalCartBtn);
      }

      var hasAnySelected = packs.some(function (_pack, idx) {
        return hasSelectedPack(idx);
      });
      setFinalCartButtonState(isFlowComplete() && hasAnySelected);
    }

    function refreshFinalState() {
      var hasAnySelected = packs.some(function (_pack, idx) {
        return hasSelectedPack(idx);
      });
      var flowComplete = isFlowComplete();
      var ready = flowComplete && hasAnySelected;

      mbLog('final state', {
        ready: ready,
        flowComplete: flowComplete,
        firstIncompleteStep: firstIncompleteIndex() === -1 ? null : firstIncompleteIndex() + 1,
        stepStates: stepStates.map(function (state) { return state.status; })
      });

      setFinalCartButtonState(ready);
      return ready;
    }

    function showFinalReview() {
      if (destroyed || ctx._openBoxId !== box.id) return;
      if (!isFlowComplete()) return;

      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
      }

      stepArea.style.display = '';
      finalStage.style.display = 'none';
      attachFinalCartButton();
      refreshFinalState();
      syncGlobalWizard(true);

      // Keep the last Pack product grid in view; the final Add to Cart button
      // appears beside the selected Pack row.
    }

    function restoreFinalButtons() {
      if (finalCartBtn) {
        finalCartBtn.disabled = !refreshFinalState();
        finalCartBtn.classList.remove('cb-inline-cart-btn--loading');
        finalCartBtn.textContent = resolveStepCartButtonLabel(box, ctx);
      }
    }

    function resetFlow() {
      packSlotsByKey = {};
      stepStates = packs.map(function () { return { status: 'pending' }; });
      sessionId = generateSessionId();
      if (finalGiftInput) finalGiftInput.value = '';
      finalStage.style.display = 'none';
      stepArea.style.display = '';
      refreshFinalState();
      openStep(0);
    }

    function removePackSelection(index) {
      if (index < 0 || index >= packs.length) return;
      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
      }
      packSlotsByKey[index] = [];
      setStepStatus(index, 'pending');
      finalStage.style.display = 'none';
      refreshFinalState();
      openStep(index);
    }

    function submitPackFlow(action) {
      if (!refreshFinalState()) return;

      var packEntries = getPackEntriesForCart();
      if (!packEntries.length) return;

      if (finalCartBtn) {
        finalCartBtn.disabled = true;
        finalCartBtn.classList.add('cb-inline-cart-btn--loading');
        finalCartBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Adding…</span>';
      }
      mbLog('final submit clicked', {
        action: action,
        boxId: box && box.id,
        stepStates: stepStates.map(function (state) { return state.status; }),
        selectedSteps: packs.map(function (_pack, idx) { return hasSelectedPack(idx); })
      });

      addPackStepsToCart(
        box,
        packEntries,
        sessionId,
        finalGiftInput ? finalGiftInput.value : null,
        ctx,
        action,
        function () {
          mbLog('final submit success', { boxId: box && box.id, action: action });
          // Checkout redirects immediately after this callback. Reset only the
          // stay-on-page cart flow so the customer sees a clean builder next.
          if (action !== 'checkout') resetFlow();
        },
        function () {
          mbError('final submit failed', { boxId: box && box.id, action: action });
          restoreFinalButtons();
          window.alert('Something went wrong adding your bundle to the cart. Please try again.');
        }
      );
    }

    if (finalCartBtn) {
      finalCartBtn.addEventListener('click', function () {
        if (finalCartBtn.disabled) return;
        submitPackFlow('cart');
      });
    }

    function advanceAfterStep(index) {
      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
      }

      var next = nextIncompleteIndexAfter(index);
      if (next === -1) {
        if (isFlowComplete()) {
          mbLog('advance complete', { fromStep: index + 1 });
          advanceTimer = setTimeout(function () {
            advanceTimer = null;
            showFinalReview();
          }, 450);
        } else {
          // Forward-only rule: never wrap backwards automatically. If an older
          // step somehow became pending, keep the current step active and let
          // the customer navigate back explicitly.
          refreshFinalState();
        }
        return;
      }

      mbLog('advance scheduled', { fromStep: index + 1, toStep: next + 1 });
      advanceTimer = setTimeout(function () {
        advanceTimer = null;
        if (destroyed || ctx._openBoxId !== box.id) return;
        openStep(next);
      }, 450);
    }

    function renderUnavailableStep(index, pack, err) {
      stepArea.innerHTML = '';

      var progressWrapper = document.createElement('div');
      progressWrapper.className = 'cb-slot-wrapper';
      var progressSteps = document.createElement('div');
      progressSteps.className = 'cb-slot-steps';
      progressWrapper.appendChild(progressSteps);
      stepArea.appendChild(progressWrapper);

      decoratePackRow(
        progressSteps,
        packs,
        packKeysInOrder,
        packSlotsByKey,
        getSkippedMap(),
        index,
        function (doneIndex) { openStep(doneIndex); },
        removePackSelection
      );
      attachFinalCartButton();

      if (!box.hideBundleHeader) {
        var title = document.createElement('h2');
        title.className = 'cb-step-heading';
        title.textContent = pack.stepTitle || box.stepTitle || ('Step ' + (index + 1));
        stepArea.appendChild(title);

        if (pack.stepDescription || box.stepDescription) {
          var description = document.createElement('p');
          description.className = 'cb-step-description';
          description.textContent = pack.stepDescription || box.stepDescription;
          stepArea.appendChild(description);
        }
      }

      var message = document.createElement('p');
      message.className = 'cb-error';
      message.textContent = err
        ? 'Failed to load products for this step. Please reload and try again.'
        : 'No products available for this step.';
      stepArea.appendChild(message);

      // An optional step with a genuinely empty configured source can still be
      // intentionally skipped. A network/API failure is not silently skipped.
      if (!err && isPackOptional(pack)) {
        var skipBtn = document.createElement('button');
        skipBtn.type = 'button';
        skipBtn.className = 'cb-step-skip-btn';
        skipBtn.textContent = 'Skip';
        skipBtn.addEventListener('click', function () {
          packSlotsByKey[index] = [];
          setStepStatus(index, 'skipped');
          refreshFinalState();
          advanceAfterStep(index);
        });
        stepArea.appendChild(skipBtn);
      }
    }

    function openStep(index) {
      if (destroyed || ctx._openBoxId !== box.id) return;
      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
      }
      if (index < 0 || index >= packs.length) return;

      currentIndex = index;
      stepArea.style.display = '';
      finalStage.style.display = 'none';
      syncGlobalWizard(false);

      mbLog('open step', {
        step: index + 1,
        packKey: getPackKey(packs[index]),
        title: packs[index] && packs[index].title,
        productConfiguration: packs[index] && packs[index].productConfiguration,
        previouslySelected: hasSelectedPack(index),
        status: getStepStatus(index)
      });

      var pack = packs[index];
      var packBox = buildPackOverrideBox(box, pack);

      function getSelectionSignature(slots) {
        return (slots || []).filter(Boolean).map(function (slot) {
          return [
            String(slot.productId || ''),
            String(slot.selectedVariantId || '')
          ].join(':');
        }).join('|');
      }

      // Re-opening an already completed Pack must NOT immediately auto-advance
      // just because renderBuilder emits its initialSlots through onSlotsChange.
      // Advance only when the customer actually changes/selects a product.
      var lastSelectionSignature = getSelectionSignature(packSlotsByKey[index] || []);

      function decorateNow() {
        decoratePackRow(
          stepArea.querySelector('.cb-slot-steps'),
          packs,
          packKeysInOrder,
          packSlotsByKey,
          getSkippedMap(),
          currentIndex,
          function (doneIndex) { openStep(doneIndex); },
          removePackSelection
        );
        attachFinalCartButton();
      }

      showPageLoader('Loading products…');
      var loadToken = ++stepLoadToken;
      stepArea.innerHTML = '';

      getPackProducts(index, packBox, function (err, products, pageInfo) {
        hidePageLoader(true);

        if (destroyed || loadToken !== stepLoadToken) return;
        if (ctx._openBoxId !== box.id) return;

        if (err || !products || products.length === 0) {
          mbError('step products unavailable', {
            step: index + 1,
            packKey: getPackKey(pack),
            error: err && err.message,
            count: products ? products.length : 0
          });
          renderUnavailableStep(index, pack, err);
          return;
        }

        mbLog('render step products', {
          step: index + 1,
          packKey: getPackKey(pack),
          count: products.length
        });

        var wholeStorePager = null;
        if (packBox && packBox.scopeType === 'wholestore') {
          packWholeStorePageState[index] = packWholeStorePageState[index] || {
            pageInfo: pageInfo || null,
            cursorStack: [],
            search: ''
          };
          packWholeStorePageState[index].pageInfo = pageInfo || packWholeStorePageState[index].pageInfo || null;
      wholeStorePager = {
            pageInfo: packWholeStorePageState[index].pageInfo,
            canGoPrevious: function () {
              var state = packWholeStorePageState[index] || {};
              return !!(state.pageInfo && state.pageInfo.hasPreviousPage && state.pageInfo.startCursor);
            },
            previousCursor: function () {
              var state = packWholeStorePageState[index] || {};
              return state.pageInfo && state.pageInfo.startCursor ? state.pageInfo.startCursor : null;
            },
            loadPage: function (request, done) {
              var state = packWholeStorePageState[index] || { pageInfo: null, cursorStack: [], search: '' };
              var nextSearch = String(request && request.search || '');
              var reset = !!(request && request.reset) || nextSearch !== String(state.search || '');
              var backwards = !!(request && request.backwards);
              var after = reset ? null : ((request && request.after) || null);
              var before = reset ? null : ((request && request.before) || null);

              fetchProducts(
                box.id,
                ctx.shop,
                ctx.apiBase,
                packBox.scopeType,
                getPackKey(pack),
                ctx,
                function (pageErr, nextProducts, nextPageInfo) {
                  if (!pageErr) {
                    if (reset) {
                      state.cursorStack = [];
                    } else if (!backwards && state.pageInfo && state.pageInfo.startCursor) {
                      state.cursorStack.push(state.pageInfo.startCursor);
                    }
                    state.search = nextSearch;
                    state.pageInfo = nextPageInfo || null;
                    packWholeStorePageState[index] = state;
                    wholeStorePager.pageInfo = state.pageInfo;
                  }
                  done(pageErr, nextProducts || [], nextPageInfo || null);
                },
                index,
                { allowInternalProducts: true, after: after, before: before, search: nextSearch, first: 24 }
              );
            }
          };
        }

        renderBuilder(stepArea, packBox, products, ctx, {
          hideOwnCartUI: true,
          nestedStepFlow: true,
          wholeStorePager: wholeStorePager,
          initialSlots: packSlotsByKey[index] || null,
          externalSlots: getAllOtherSelectedSlots(index),
          optional: isPackOptional(pack),
          canGoPrev: function () {
            return index > 0;
          },
          canGoNext: function () {
            return index < packs.length - 1 && isPackComplete(index);
          },
          onPrevPack: function () {
            if (index > 0) openStep(index - 1);
          },
          onNextPack: function () {
            if (index < packs.length - 1 && isPackComplete(index)) openStep(index + 1);
          },
          onSkip: function () {
            if (index !== currentIndex) return;

            mbLog('skip step', { step: index + 1, packKey: getPackKey(pack) });
            packSlotsByKey[index] = [];
            setStepStatus(index, 'skipped');
            decorateNow();
            refreshFinalState();
            advanceAfterStep(index);
          },
          onSlotsChange: function (slots) {
            var nextSelectionSignature = getSelectionSignature(slots);
            var selectionChanged = nextSelectionSignature !== lastSelectionSignature;
            lastSelectionSignature = nextSelectionSignature;

            packSlotsByKey[index] = slots.slice();

            if (slots.some(Boolean)) {
              setStepStatus(index, 'selected');
            } else if (getStepStatus(index) !== 'skipped') {
              setStepStatus(index, 'pending');
            }

            if (index !== currentIndex) return;

            mbLog('step selection changed', {
              step: index + 1,
              status: getStepStatus(index),
              selectionChanged: selectionChanged,
              selected: slots.filter(Boolean).map(function (slot) {
                return {
                  productId: slot.productId,
                  title: slot.productTitle,
                  variantId: slot.selectedVariantId || null
                };
              })
            });

            decorateNow();
            refreshFinalState();
            if (!isFlowComplete()) {
              finalStage.style.display = 'none';
              syncGlobalWizard(false);
            }

            if (selectionChanged && slots.some(Boolean)) {
              // Brief pause so the customer sees the selected state before the
              // next Pack replaces the active product grid. Restoring a Pack's
              // existing initial selection does not count as a new selection.
              advanceAfterStep(index);
            }
          }
        });

        // Initial slots can be restored when revisiting a completed Pack.
        syncStepStateFromSlots(index);
        decorateNow();
        refreshFinalState();

        try {
          stepArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
        } catch (_) {}
      });
    }

    // Integrate Multiple Box's inner Pack flow with the existing global Back
    // button. At the final review it returns to the last Pack; inside Pack N it
    // returns to Pack N-1. From Pack 1 the generic handler continues back to
    // box selection.
    ctx._packFlowBackHandler = function () {
      if (destroyed || ctx._openBoxId !== box.id) return false;

      if (finalStage.style.display !== 'none') {
        openStep(Math.max(0, packs.length - 1));
        return true;
      }

      if (currentIndex > 0) {
        openStep(currentIndex - 1);
        return true;
      }

      return false;
    };

    // Called by openBuilder before a different box replaces this builder.
    ctx._packFlowCleanup = function () {
      destroyed = true;
      stepLoadToken++;
      if (advanceTimer) {
        clearTimeout(advanceTimer);
        advanceTimer = null;
      }
      if (ctx._packFlowBackHandler) ctx._packFlowBackHandler = null;
    };

    mbLog('default open first pack grid', {
      step: 1,
      packKey: getPackKey(packs[0])
    });
    openStep(0);
  }

  // ─── Render Builder ───────────────────────────────────────────────────────────

  // stepOptions (optional — used only by the Multiple Box Pack step flow, see
  // renderPackPicker) lets a caller: seed previously-made selections back in
  // (initialSlots) when the customer returns to this Pack's Step; observe every
  // selection change (onSlotsChange) so they stay persisted while other Steps
  // are open; and defer/relabel the completion action (onComplete/completeLabel/
  // hideCheckout) instead of adding straight to cart, since intermediate Steps
  // must wait for the LAST Step before anything is actually submitted. Omitting
  // stepOptions (every existing caller — Single Box, Specific Combo) preserves
  // the exact current behavior untouched.
  function renderBuilder(container, box, products, ctx, stepOptions) {
    container.innerHTML = '';

    var stickyState = getStickyFooterState(ctx);
    var searchTerm = '';
    var wholeStorePager = stepOptions && stepOptions.wholeStorePager ? stepOptions.wholeStorePager : null;
    var wholeStorePageInfo = wholeStorePager && wholeStorePager.pageInfo ? wholeStorePager.pageInfo : null;
    var wholeStoreLoading = false;
    var wholeStoreSearchTimer = null;
    var selectedProductsPerRow = normalizeProductGridControlPerRow(ctx.settings && ctx.settings.productCardsPerRow);
    var sessionId = generateSessionId();
    var initialSlots = (stepOptions && Array.isArray(stepOptions.initialSlots)) ? stepOptions.initialSlots : null;
    var slots = [];
    for (var s = 0; s < box.itemCount; s++) { slots.push((initialSlots && initialSlots[s]) || null); }
    var activeSlotIndex = 0;
    for (var s0 = 0; s0 < slots.length; s0++) {
      if (!slots[s0]) { activeSlotIndex = s0; break; }
    }
    if (box._packKey) {
      ctx._activePackKey = String(box._packKey);
      ctx._activePackHasSelections = function () {
        return slots.some(function (slot) { return !!slot; });
      };
    }

    // ── Step 2 Heading ── box/pack stepTitle (admin-configured) wins over the
    // widget-level ctx.step2Heading default; hideBundleHeader hides it entirely.
    if (!box.hideBundleHeader) {
      var step2Head = document.createElement('h2');
      step2Head.className = 'cb-step-heading';
      step2Head.textContent = box.stepTitle || ctx.step2Heading || 'Step 2: Select your products';
      container.appendChild(step2Head);

      if (box.stepDescription) {
        var step2Desc = document.createElement('p');
        step2Desc.className = 'cb-step-description';
        step2Desc.textContent = box.stepDescription;
        container.appendChild(step2Desc);
      }
    }

    // ── Slot Steps Row ──
    var slotWrapper = document.createElement('div');
    slotWrapper.className = 'cb-slot-wrapper';

    var slotSteps = document.createElement('div');
    slotSteps.className = 'cb-slot-steps';

    // Inline action button (at end of slot row)
    var inlineCartBtn = document.createElement('button');
    inlineCartBtn.className = 'cb-inline-cart-btn';
    inlineCartBtn.type = 'button';
    inlineCartBtn.disabled = true;
    inlineCartBtn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box);

    function hydrateProductPricing(done) {
      var tasks = products.map(function (p) {
        if (!p || !p.productHandle) return Promise.resolve();
        return new Promise(function (resolve) {
          fetchVariants(p.productHandle, p.variantIds, function (err, variants) {
            if (!err && variants && variants.length > 0) {
              var first = variants[0];
              if ((p.productPrice == null || parseFloat(p.productPrice) <= 0) && first.price != null) {
                p.productPrice = parseFloat(first.price);
              }
              if ((p.productCompareAtPrice == null || parseFloat(p.productCompareAtPrice) <= 0) && first.compareAtPrice != null) {
                p.productCompareAtPrice = parseFloat(first.compareAtPrice);
              }
            }
            resolve();
          });
        });
      });

      Promise.all(tasks).then(function () {
        if (typeof done === 'function') done();
      });
    }

    function renderSlots() {
      slotSteps.innerHTML = '';
      slots.forEach(function (slotProduct, idx) {
        // Connector line between slots
        if (idx > 0) {
          var connector = document.createElement('div');
          connector.className = 'cb-slot-connector';
          slotSteps.appendChild(connector);
        }

        var step = document.createElement('div');
        step.className = 'cb-slot-step';

        if (slotProduct) {
          step.classList.add('cb-slot-step--filled');
        } else if (idx === activeSlotIndex) {
          step.classList.add('cb-slot-step--active');
        }

        // Number / thumbnail inside the step box
        var numEl = document.createElement('div');
        numEl.className = 'cb-slot-step-num';
        if (slotProduct) {
          if (slotProduct.productImageUrl) {
            var thumb = document.createElement('img');
            thumb.src = slotProduct.productImageUrl;
            thumb.alt = slotProduct.productTitle || '';
            thumb.className = 'cb-slot-step-thumb';
            numEl.appendChild(thumb);
          } else {
            numEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
          }
        } else {
          numEl.textContent = idx + 1;
        }
        step.appendChild(numEl);

        // Label below step box
        var labelEl = document.createElement('div');
        labelEl.className = 'cb-slot-step-label';
        var smallText = document.createElement('span');
        smallText.className = 'cb-slot-step-small';
        smallText.textContent = slotProduct ? 'Selected' : 'Select your';
        labelEl.appendChild(smallText);

        var itemLink = document.createElement('div');
        itemLink.className = 'cb-slot-step-item';
        if (slotProduct) {
          var shortTitle = slotProduct.productTitle || ('Item ' + (idx + 1));
          if (slotProduct.selectedVariantTitle) shortTitle += ' · ' + slotProduct.selectedVariantTitle;
          itemLink.textContent = shortTitle.length > 16 ? shortTitle.slice(0, 15) + '…' : shortTitle;
          itemLink.classList.add('cb-slot-step-item--filled');
          // Click to change slot
          ;(function (i) {
            step.style.cursor = 'pointer';
            step.addEventListener('click', function () {
              activeSlotIndex = i;
              renderSlots();
              renderProductGrid();
            });
          })(idx);

          // Remove (×) button
          var removeBtn = document.createElement('button');
          removeBtn.className = 'cb-slot-remove';
          removeBtn.type = 'button';
          removeBtn.setAttribute('aria-label', 'Remove');
          removeBtn.innerHTML = '&times;';
          ;(function (i) {
            removeBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              slots[i] = null;
              activeSlotIndex = i;
              renderSlots();
              renderProductGrid();
              updateCartButton();
            });
          })(idx);
          step.appendChild(removeBtn);
        } else {
          itemLink.textContent = 'Item ' + (idx + 1);
        }
        labelEl.appendChild(itemLink);
        step.appendChild(labelEl);

        slotSteps.appendChild(step);
      });
    }

    renderSlots();

    slotWrapper.appendChild(slotSteps);

    // In steps mode the inline cart button is always hidden — step3CartSection handles the action.
    // A Pack section in the "all Packs on one page" Multiple Box flow (stepOptions.hideOwnCartUI)
    // never shows its own cart action either — only one page-level Add to Cart button exists,
    // built by renderPackPicker once every Pack has a selection (see addPackStepsToCart).
    var hideOwnCartUI = !!(stepOptions && stepOptions.hideOwnCartUI);
    if (ctx.layoutMode === 'steps' || hideOwnCartUI) {
      inlineCartBtn.style.display = 'none';
    }
    slotWrapper.appendChild(inlineCartBtn);

    // Mobile cart buttons (≤750px sticky bar — shown via CSS media query)
    var mobileCartBtns = document.createElement('div');
    mobileCartBtns.className = 'cb-slot-mobile-btns';
    var mobileAddBtn = document.createElement('button');
    mobileAddBtn.className = 'cb-mobile-add-btn';
    mobileAddBtn.type = 'button';
    mobileAddBtn.disabled = true;
    mobileAddBtn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box);
    var mobileCheckoutBtn = document.createElement('button');
    mobileCheckoutBtn.className = 'cb-mobile-checkout-btn';
    mobileCheckoutBtn.type = 'button';
    mobileCheckoutBtn.disabled = true;
    mobileCheckoutBtn.style.display = 'none'; // hidden until all slots filled
    mobileCheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
    mobileCartBtns.appendChild(mobileAddBtn);
    mobileCartBtns.appendChild(mobileCheckoutBtn);
    if (hideOwnCartUI) mobileCartBtns.style.display = 'none';
    slotWrapper.appendChild(mobileCartBtns);

    container.appendChild(slotWrapper);
    requestAnimationFrame(function () {
      slotWrapper.scrollLeft = 0;
    });

    // ── Steps Mode: Step 3 cart section (hidden until all slots filled) ──
    var step3CartBtn = null;
    var step3CheckoutBtn = null;
    var step3CartSection = null;
    if (ctx.layoutMode === 'steps' && !hideOwnCartUI) {
      step3CartSection = document.createElement('div');
      step3CartSection.className = 'cb-step3-cart';
      step3CartSection.style.display = 'none';

      var step3Head = document.createElement('h2');
      step3Head.className = 'cb-step-heading cb-step3-heading';
      step3Head.textContent = ctx.step3Heading || 'Step 3: Complete your order';
      step3CartSection.appendChild(step3Head);

      var step3Btns = document.createElement('div');
      step3Btns.className = 'cb-step3-buttons';

      // An intermediate Pack Step (stepOptions.hideCheckout) always needs its
      // own "Continue" action regardless of the merchant's cart/checkout button
      // preference — checkout only becomes available again on the LAST Step,
      // where the original (unchanged) ctx.step3Buttons behavior applies.
      var isIntermediateStep = !!(stepOptions && stepOptions.hideCheckout);
      var showCart     = isIntermediateStep || ctx.step3Buttons !== 'checkout_only';
      var showCheckout = !isIntermediateStep && ctx.step3Buttons !== 'cart_only';

      if (showCart) {
        step3CartBtn = document.createElement('button');
        step3CartBtn.type = 'button';
        step3CartBtn.className = 'cb-step3-cart-btn';
        step3CartBtn.textContent = (stepOptions && stepOptions.completeLabel) || resolveStepCartButtonLabel(box, ctx);
        step3Btns.appendChild(step3CartBtn);
      }

      if (showCheckout) {
        step3CheckoutBtn = document.createElement('button');
        step3CheckoutBtn.type = 'button';
        step3CheckoutBtn.className = 'cb-step3-checkout-btn';
        step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
        step3Btns.appendChild(step3CheckoutBtn);
      }

      step3CartSection.appendChild(step3Btns);
      slotWrapper.appendChild(step3CartSection);
    }

    // ── Gift Message ──

    // ─── Gift Message ─────────────────────────────────────────────────────────
    var giftInput = null;
    var giftSection = null;
    if (box.giftMessageEnabled && !hideOwnCartUI) {
      giftSection = document.createElement('div');
      giftSection.className = 'cb-gift-section';
      giftSection.style.display = 'none';
      var giftLabel = document.createElement('label');
      giftLabel.className = 'cb-gift-label';
      giftLabel.textContent = 'Gift Message (optional)';
      giftInput = document.createElement('textarea');
      giftInput.className = 'cb-gift-input';
      giftInput.placeholder = 'Write a personal message...';
      giftInput.rows = 2;
      giftInput.maxLength = 100;
      giftSection.appendChild(giftLabel);
      giftSection.appendChild(giftInput);
      container.appendChild(giftSection);
    }

    // ── Product Section ──
    var productSection = document.createElement('div');
    productSection.className = 'cb-product-section';

    var productLabel = document.createElement('div');
    productLabel.className = 'cb-product-label';
    productSection.appendChild(productLabel);

    var skipStepBtn = null;
    if (stepOptions && stepOptions.optional && typeof stepOptions.onSkip === 'function') {
      skipStepBtn = document.createElement('button');
      skipStepBtn.type = 'button';
      skipStepBtn.className = 'cb-step-skip-btn';
      skipStepBtn.textContent = 'Skip';
      skipStepBtn.addEventListener('click', function () {
        slots[activeSlotIndex] = null;
        renderSlots();
        renderProductGrid();
        updateCartButton();
        stepOptions.onSkip();
      });
    }

    var packNavWrap = null;
    var prevPackBtn = null;
    var nextPackBtn = null;
    if (stepOptions && (typeof stepOptions.onPrevPack === 'function' || typeof stepOptions.onNextPack === 'function')) {
      packNavWrap = document.createElement('span');
      packNavWrap.className = 'cb-pack-nav-controls';

      if (typeof stepOptions.onPrevPack === 'function') {
        prevPackBtn = document.createElement('button');
        prevPackBtn.type = 'button';
        prevPackBtn.className = 'cb-step-skip-btn cb-pack-nav-btn cb-pack-nav-btn--prev';
        prevPackBtn.textContent = '<';
        prevPackBtn.setAttribute('aria-label', 'Previous pack');
        prevPackBtn.addEventListener('click', function () {
          if (prevPackBtn.disabled) return;
          stepOptions.onPrevPack();
        });
        packNavWrap.appendChild(prevPackBtn);
      }

      if (typeof stepOptions.onNextPack === 'function') {
        nextPackBtn = document.createElement('button');
        nextPackBtn.type = 'button';
        nextPackBtn.className = 'cb-step-skip-btn cb-pack-nav-btn cb-pack-nav-btn--next';
        nextPackBtn.textContent = '>';
        nextPackBtn.setAttribute('aria-label', 'Next pack');
        nextPackBtn.addEventListener('click', function () {
          if (nextPackBtn.disabled) return;
          stepOptions.onNextPack();
        });
        packNavWrap.appendChild(nextPackBtn);
      }
    }

    var productToolbar = document.createElement('div');
    productToolbar.className = 'cb-product-toolbar';
    productSection.appendChild(productToolbar);

    var searchInput = null;
    var productCountEl = null;
    if (box.showProductSearch) {
      var searchWrap = document.createElement('div');
      searchWrap.className = 'cb-product-search-wrap';
      searchInput = document.createElement('input');
      searchInput.type = 'search';
      searchInput.className = 'cb-product-search';
      searchInput.placeholder = 'Search products...';
      searchInput.addEventListener('input', function () {
        searchTerm = String(searchInput.value || '').trim().toLowerCase();
        if (wholeStorePager && typeof wholeStorePager.loadPage === 'function') {
          if (wholeStoreSearchTimer) clearTimeout(wholeStoreSearchTimer);
          wholeStoreSearchTimer = setTimeout(function () {
            loadWholeStorePage(null, searchTerm, true);
          }, 250);
          return;
        }
        renderProductGrid();
      });
      searchWrap.appendChild(searchInput);
      productCountEl = document.createElement('span');
      productCountEl.className = 'cb-product-search-count';
      productCountEl.textContent = '0';
      searchWrap.appendChild(productCountEl);
    }

    if (searchWrap) productToolbar.appendChild(searchWrap);

    var rowControl = document.createElement('div');
    rowControl.className = 'cb-products-per-row-control';
    rowControl.setAttribute('aria-label', 'Products per row');

    var rowIcon = document.createElement('span');
    rowIcon.className = 'cb-products-per-row-icon';
    rowIcon.setAttribute('aria-hidden', 'true');
    rowIcon.innerHTML = '<span></span><span></span><span></span><span></span>';
    rowControl.appendChild(rowIcon);

    var rowButtons = [];
    function applyProductsPerRow(value) {
      selectedProductsPerRow = normalizeProductGridControlPerRow(value);
      if (!productGrid) return;
      productGrid.style.setProperty('--cb-products-per-row', String(selectedProductsPerRow));
      productGrid.style.setProperty('--cb-products-per-row-tablet', String(Math.min(selectedProductsPerRow, 3)));
      productGrid.style.setProperty('--cb-products-per-row-mobile', String(Math.min(selectedProductsPerRow, 2)));
      rowButtons.forEach(function (btn) {
        var isActive = String(btn.getAttribute('data-row-count')) === String(selectedProductsPerRow);
        btn.classList.toggle('cb-products-per-row-btn--active', isActive);
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
    }
    [3, 4, 5].forEach(function (count) {
      var rowBtn = document.createElement('button');
      rowBtn.type = 'button';
      rowBtn.className = 'cb-products-per-row-btn';
      rowBtn.innerHTML = Array(count + 1).join('<span></span>');
      rowBtn.setAttribute('data-row-count', String(count));
      rowBtn.setAttribute('aria-label', 'Show ' + count + ' products per row');
      rowBtn.setAttribute('aria-pressed', 'false');
      rowBtn.addEventListener('click', function () { applyProductsPerRow(count); });
      rowButtons.push(rowBtn);
      rowControl.appendChild(rowBtn);
    });
    productToolbar.appendChild(rowControl);

    var productGrid = document.createElement('div');
    productGrid.className = ctx.layout === 'list' ? 'cb-product-list' : 'cb-product-grid';
    productSection.appendChild(productGrid);
    var wholeStorePagination = document.createElement('div');
    wholeStorePagination.className = 'cb-product-pagination';
    wholeStorePagination.style.display = 'none';
    productSection.appendChild(wholeStorePagination);
    applyProductsPerRow(selectedProductsPerRow);
    container.appendChild(productSection);
    ctx._productSection = productSection;

    // ── Update cart button state ──
    function updateCartButton() {
      if (stepOptions && typeof stepOptions.onSlotsChange === 'function') {
        stepOptions.onSlotsChange(slots);
      }

      var filled = slots.filter(Boolean).length;
      var remaining = box.itemCount - filled;
      var allFilled = remaining === 0;
      var addLabel = (stepOptions && stepOptions.completeLabel) || resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box);
      var stepAddLabel = (stepOptions && stepOptions.completeLabel) || resolveStepCartButtonLabel(box, ctx);

      // Inline button
      inlineCartBtn.disabled = !allFilled;
      if (allFilled) {
        inlineCartBtn.classList.add('cb-inline-cart-btn--ready');
        inlineCartBtn.textContent = addLabel;
      } else {
        inlineCartBtn.classList.remove('cb-inline-cart-btn--ready');
        inlineCartBtn.textContent = addLabel;
      }

      // Mobile cart buttons (sticky slot bar on ≤750px)
      mobileAddBtn.disabled = !allFilled;
      if (allFilled) {
        mobileAddBtn.classList.add('cb-mobile-add-btn--ready');
        mobileAddBtn.textContent = addLabel;
      } else {
        mobileAddBtn.classList.remove('cb-mobile-add-btn--ready');
        mobileAddBtn.textContent = addLabel;
      }
      // Checkout only visible when all slots are ready (never for an
      // intermediate Pack Step — checkout only makes sense once every Step
      // is done, see stepOptions.hideCheckout in renderPackPicker).
      var checkoutAllowed = allFilled && !(stepOptions && stepOptions.hideCheckout);
      mobileCheckoutBtn.disabled = !checkoutAllowed;
      mobileCheckoutBtn.style.display = checkoutAllowed ? '' : 'none';

      // Sticky footer button
      if (stickyState.btn) {
        stickyState.btn.disabled = !allFilled;
        if (allFilled) {
          stickyState.btn.classList.add('cb-sticky-btn--ready');
          stickyState.btn.textContent = addLabel;
        } else {
          stickyState.btn.classList.remove('cb-sticky-btn--ready');
          stickyState.btn.textContent = addLabel;
        }
      }

      // Gift message visibility
      if (giftSection) giftSection.style.display = allFilled ? 'block' : 'none';

      var hasSelected = false;
      slots.forEach(function (p) {
        if (p) hasSelected = true;
      });
      var totalMrp = getSelectedProductsTotal(slots);
      var isDynamic = isDynamicBundlePrice(box);
      var dynamicBreakdown = isDynamic
        ? getComboDiscountBreakdown(totalMrp, getBoxDiscountConfig(box), slots)
        : { discountedTotal: 0, discountAmount: 0, freeUnits: 0 };
      var dynamicEffectivePrice = isDynamic ? dynamicBreakdown.discountedTotal : 0;

      if (stickyState.totalEl) {
        renderStickyTotal(
          stickyState.totalEl,
          isDynamic ? getDynamicDisplayPrice(dynamicEffectivePrice) : (parseFloat(box.bundlePrice) || 0),
          ctx.currencySymbol
        );
      }

      if (isDynamic) {
        setBoxCardPrice(box, getDynamicDisplayPrice(dynamicEffectivePrice), ctx.currencySymbol);
      }

      setWizardSelectedPrice(
        ctx,
        box,
        isDynamic ? getDynamicDisplayPrice(dynamicEffectivePrice) : (parseFloat(box.bundlePrice) || 0)
      );

      if (stickyState.savingsEl) {
        if (isDynamic) {
          var dynSavings = dynamicBreakdown.discountAmount;
          if (hasSelected && dynSavings > 0.005) {
            var dynSavingsBadge = (ctx.settings && ctx.settings.showSavingsBadge)
              ? '<span class="cb-sticky-save">Save ' + formatPrice(dynSavings, ctx.currencySymbol, ctx.currencyCode) + '</span>'
              : '';
            var _dgc = getBoxDiscountConfig(box);
            var dynFreeUnitsBadge =
              _dgc && _dgc.discountType === 'buy_x_get_y' && dynamicBreakdown.freeUnits > 0
                ? '<span class="cb-sticky-save">Free items: ' + dynamicBreakdown.freeUnits + '</span>'
                : '';
            stickyState.savingsEl.innerHTML =
              '<span class="cb-sticky-mrp">MRP: ' + formatPrice(totalMrp, ctx.currencySymbol, ctx.currencyCode) + '</span>' +
              dynSavingsBadge +
              dynFreeUnitsBadge;
            stickyState.savingsEl.style.display = 'flex';
          } else {
            stickyState.savingsEl.style.display = 'none';
          }
        } else if (hasSelected) {
          var bundlePrice = parseFloat(box.bundlePrice);
          var savingsAmt = totalMrp - bundlePrice;
          var savingsBadge = (ctx.settings && ctx.settings.showSavingsBadge && savingsAmt > 0)
            ? '<span class="cb-sticky-save">Save ' + formatPrice(savingsAmt, ctx.currencySymbol, ctx.currencyCode) + '</span>'
            : '';
          stickyState.savingsEl.innerHTML =
            '<span class="cb-sticky-mrp">MRP: ' + formatPrice(totalMrp, ctx.currencySymbol, ctx.currencyCode) + '</span>' +
            savingsBadge;
          stickyState.savingsEl.style.display = 'flex';
        } else {
          stickyState.savingsEl.style.display = 'none';
        }
      }

      // Steps mode: hide product grid when all filled; enable/disable cart buttons; update wizard dot
      if (ctx.layoutMode === 'steps' && !hideOwnCartUI && !(stepOptions && stepOptions.nestedStepFlow)) {
        var savedScrollY = window.scrollY;
        productSection.style.display = allFilled ? 'none' : '';
        if (step3CartSection) step3CartSection.style.display = allFilled ? '' : 'none';
        if (allFilled) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { window.scrollTo(0, savedScrollY); });
          });
        }
        if (step3CartBtn) {
          step3CartBtn.disabled = !allFilled;
          if (!allFilled) {
            step3CartBtn.classList.remove('cb-step3-cart-btn--loading');
            step3CartBtn.textContent = stepAddLabel;
          }
        }
        if (step3CheckoutBtn) {
          step3CheckoutBtn.disabled = !allFilled;
          if (!allFilled) {
            step3CheckoutBtn.classList.remove('cb-step3-checkout-btn--loading');
            step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
          }
        }
        if (allFilled && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--done';
          setWizardStep2Preview(ctx, slots);
          ctx._wizardDots[2].className = 'cb-wizard-step cb-wizard-step--active';
          if (ctx._wizardLines && ctx._wizardLines[1]) {
            ctx._wizardLines[1].className = 'cb-wizard-line cb-wizard-line--done';
          }
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].doneLabel;
            ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
          }
        } else if (!allFilled && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--active';
                    ctx._wizardDots[2].className = 'cb-wizard-step';
          if (ctx._wizardLines && ctx._wizardLines[1]) {
            ctx._wizardLines[1].className = 'cb-wizard-line';
          }
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].label;
          }
        }
      }
    }

    // ── Product Grid ──
    function renderProductGrid() {
      productLabel.textContent = 'Choose your Item ' + (activeSlotIndex + 1);
      if (packNavWrap) {
        if (prevPackBtn) {
          prevPackBtn.disabled = typeof stepOptions.canGoPrev === 'function'
            ? !stepOptions.canGoPrev()
            : stepOptions && stepOptions.canGoPrev === false;
        }
        if (nextPackBtn) {
          nextPackBtn.disabled = typeof stepOptions.canGoNext === 'function'
            ? !stepOptions.canGoNext()
            : stepOptions && stepOptions.canGoNext === false;
        }
        productLabel.appendChild(packNavWrap);
      }
      if (skipStepBtn) {
        skipStepBtn.style.display = slots[activeSlotIndex] ? 'none' : 'inline-flex';
        productLabel.appendChild(skipStepBtn);
      }
      productGrid.innerHTML = '';

      var usedIds = [];
      var externalUsedIds = [];
      var usedVariantIdsByProduct = {};
      if (!box.allowDuplicates) {
        var duplicateCheckSlots = slots.slice();
        if (stepOptions && Array.isArray(stepOptions.externalSlots)) {
          stepOptions.externalSlots.forEach(function (p) {
            if (p) externalUsedIds.push(p.productId);
          });
          duplicateCheckSlots = duplicateCheckSlots.concat(stepOptions.externalSlots);
        }
        duplicateCheckSlots.forEach(function (p) {
          if (!p) return;
          usedIds.push(p.productId);
          if (p.selectedVariantId) {
            var key = String(p.productId);
            if (!usedVariantIdsByProduct[key]) usedVariantIdsByProduct[key] = [];
            var selectedId = String(p.selectedVariantId);
            if (usedVariantIdsByProduct[key].indexOf(selectedId) === -1) {
              usedVariantIdsByProduct[key].push(selectedId);
            }
          }
        });
      }

      var visibleProducts = searchTerm
        ? products.filter(function (p) { return String(p && p.productTitle || '').toLowerCase().indexOf(searchTerm) !== -1; })
        : products;

      if (productCountEl) {
        productCountEl.textContent = String(visibleProducts.length) + ' shown';
      }

      if (searchTerm && visibleProducts.length === 0) {
        var noResults = document.createElement('p');
        noResults.className = 'cb-product-search-empty';
        noResults.textContent = 'No products match "' + (searchInput ? searchInput.value : '') + '".';
        productGrid.appendChild(noResults);
      } else if (visibleProducts.length === 0) {
        var noFilteredResults = document.createElement('p');
        noFilteredResults.className = 'cb-product-search-empty';
        noFilteredResults.textContent = 'No products available.';
        productGrid.appendChild(noFilteredResults);
      }

      visibleProducts.forEach(function (product) {
        var isCurrentSlot = slots[activeSlotIndex] && slots[activeSlotIndex].productId === product.productId;
        var variantCapable = !product.isCollection && !!product.productHandle;
        var productVariantIds = Array.isArray(product.variantIds)
          ? product.variantIds.map(function (id) { return String(id); }).filter(Boolean)
          : [];
        var blockedVariantIds = (!box.allowDuplicates && usedVariantIdsByProduct[String(product.productId)])
          ? usedVariantIdsByProduct[String(product.productId)].slice()
          : [];

        var productUsedById = !box.allowDuplicates &&
          usedIds.indexOf(product.productId) !== -1 &&
          !isCurrentSlot;
        var allKnownVariantsUsed = variantCapable &&
          productVariantIds.length > 0 &&
          blockedVariantIds.length >= productVariantIds.length &&
          !isCurrentSlot;

        // When duplicate products are disabled, block the whole product card once the
        // product is already selected in another slot. Variant selection still applies
        // for the initial add, but the same product cannot be added a second time.
        var isUsedByExternal = !box.allowDuplicates && externalUsedIds.indexOf(product.productId) !== -1 && !isCurrentSlot;
        var isUsed = productUsedById || allKnownVariantsUsed;

        var card = document.createElement('div');
        card.className = 'cb-product-card';
        if (isCurrentSlot) {
          card.classList.add('cb-product-card--current');
        } else if (isUsed) {
          card.classList.add('cb-product-card--used');
        }
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        // Image wrap
        var imgWrap = document.createElement('div');
        imgWrap.className = 'cb-product-img-wrap';
        if (product.productImageUrl) {
          var img = document.createElement('img');
          img.src = product.productImageUrl;
          img.alt = product.productTitle || '';
          img.className = 'cb-product-img';
          img.loading = 'lazy';
          imgWrap.appendChild(img);
        } else {
          var ph = document.createElement('div');
          ph.className = 'cb-product-img-placeholder';
          ph.textContent = (product.productTitle || '?').charAt(0).toUpperCase();
          imgWrap.appendChild(ph);
        }

        card.appendChild(imgWrap);

        // Mutable selected-variant state for this card (updated by inline select)
        var selVarId = null;
        var selVarTitle = null;
        var selVarPrice = product.productPrice != null ? parseFloat(product.productPrice) : null;
        var selVarCompare = product.productCompareAtPrice != null ? parseFloat(product.productCompareAtPrice) : null;
        var cardSoldOut = !isProductAvailable(product);

        // Product info area
        var infoEl = document.createElement('div');
        infoEl.className = 'cb-product-info';

        var titleRow = document.createElement('div');
        titleRow.className = 'cb-product-title-row';

        var titleEl = document.createElement('div');
        titleEl.className = 'cb-product-title';
        titleEl.textContent = product.productTitle || product.productId;
        titleRow.appendChild(titleEl);

        var learnBtn = null;
        if (product.productHandle && !product.isCollection && !box.hideProductInfoModal) {
          learnBtn = document.createElement('button');
          learnBtn.type = 'button';
          learnBtn.className = 'cb-product-learn-link';
          learnBtn.innerHTML = LEARN_MORE_ICON_SVG + '<span>Learn more</span>';
          learnBtn.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openProductDescriptionModal(product, learnBtn, ctx.rootEl, buildBoxDesignStyle(box.designSettings));
          });
        }

        infoEl.appendChild(titleRow);

        // Updatable price + variant row
        var metaRow = document.createElement('div');
        metaRow.className = 'cb-product-meta-row';
        var priceWrap = document.createElement('span');
        priceWrap.className = 'cb-product-price-wrap';
        metaRow.appendChild(priceWrap);
        if (learnBtn) metaRow.appendChild(learnBtn);

        function renderPriceWrap(price, compareAt) {
          priceWrap.innerHTML = '';
          var sp = price != null ? parseFloat(price) : null;
          var cp = compareAt != null ? parseFloat(compareAt) : null;
          if (sp && sp > 0) {
            var pEl = document.createElement('span');
            pEl.className = 'cb-product-price';
            pEl.textContent = formatPrice(sp, ctx.currencySymbol, ctx.currencyCode);
            priceWrap.appendChild(pEl);
            if (box.displayCompareAtPrice && cp && cp > sp) {
              var cEl = document.createElement('span');
              cEl.className = 'cb-product-compare-price';
              cEl.textContent = formatPrice(cp, ctx.currencySymbol, ctx.currencyCode);
              priceWrap.appendChild(cEl);
            }
          }
        }

        renderPriceWrap(selVarPrice, selVarCompare);
        infoEl.appendChild(metaRow);
        card.appendChild(infoEl);

        // ── Inline variant select — rendered as own row below price ──
        if (!product.isCollection && product.productHandle) {
          var selectWrap = document.createElement('div');
          selectWrap.className = 'cb-variant-select-wrap';
          selectWrap.style.display = 'none';

          var variantSelect = document.createElement('select');
          variantSelect.className = 'cb-variant-select';
          // Stop card click from firing when interacting with select
          variantSelect.addEventListener('click', function (e) { e.stopPropagation(); });
          variantSelect.addEventListener('change', function (e) {
            e.stopPropagation();
            var cachedVariants = variantSelect._cbVariants || [];
            for (var vi = 0; vi < cachedVariants.length; vi++) {
              if (String(cachedVariants[vi].id) === variantSelect.value) {
                selVarId    = cachedVariants[vi].id;
                selVarPrice = cachedVariants[vi].price;
                selVarCompare = cachedVariants[vi].compareAtPrice;
                selVarTitle = !isDefaultVariantTitle(cachedVariants[vi].title) ? cachedVariants[vi].title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
                break;
              }
            }
          });

          selectWrap.appendChild(variantSelect);
          infoEl.appendChild(selectWrap); // placed as own row below metaRow

          // Load variants and populate select asynchronously
          ;(function (sel, wrap, blockedForLoad) {
            fetchVariants(product.productHandle, product.variantIds, function (err, variants) {
              if (err || !variants || variants.length === 0) return;
              var blockedSet = {};
              (blockedForLoad || []).forEach(function (id) { blockedSet[String(id)] = true; });

              // Single variant — set state silently, no select needed
              if (variants.length === 1) {
                var v0 = variants[0];
                if (v0.price != null) { selVarPrice = v0.price; selVarCompare = v0.compareAtPrice; }
                renderPriceWrap(selVarPrice, selVarCompare);
                wrap.style.display = 'none';
                sel._cbVariants = variants;
                if (v0.price != null) { selVarPrice = v0.price; selVarCompare = v0.compareAtPrice; }
                renderPriceWrap(selVarPrice, selVarCompare);
                var v0Unavailable = !isVariantAvailable(v0);
                if (v0Unavailable || blockedSet[String(v0.id)]) {
                  sel.innerHTML = '';
                  sel._cbVariants = variants;
                  var singleOpt = document.createElement('option');
                  singleOpt.value = v0.id;
                  singleOpt.disabled = true;
                  singleOpt.textContent = (v0.title || 'Default Title') + (!v0.available ? ' — Out of stock' : ' — Already in box');
                  sel.appendChild(singleOpt);
                  singleOpt.textContent = (v0.title || 'Default Title') + (v0Unavailable ? ' - Out of stock' : ' - Already in box');
                  sel.value = v0.id;
                  wrap.style.display = 'none';
                  if (v0Unavailable && addBtn) {
                    cardSoldOut = true;
                    markProductCardSoldOut(card, addBtn);
                  }
                  return;
                }
                selVarId = v0.id;
                selVarTitle = !isDefaultVariantTitle(v0.title) ? v0.title : null;
                return;
              }

              // Multiple variants — build select options
              sel.innerHTML = '';
              sel._cbVariants = variants;
              if (variants[0] && variants[0].price != null) {
                selVarPrice = variants[0].price;
                selVarCompare = variants[0].compareAtPrice;
                renderPriceWrap(selVarPrice, selVarCompare);
              }

              var firstAvailable = null;
              variants.forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = v.id;
                var label = v.title;
                var variantUnavailable = !isVariantAvailable(v);
                if (!v.available) { opt.disabled = true; label += ' — Out of stock'; }
                else if (blockedSet[String(v.id)]) { opt.disabled = true; label += ' — Already in box'; }
                if (variantUnavailable || blockedSet[String(v.id)]) {
                  opt.disabled = true;
                  label = v.title + (variantUnavailable ? ' - Out of stock' : ' - Already in box');
                } else {
                  opt.disabled = false;
                }
                opt.textContent = label;
                sel.appendChild(opt);
                if (!firstAvailable && !variantUnavailable && !blockedSet[String(v.id)]) firstAvailable = v;
              });

              if (firstAvailable) {
                sel.value = firstAvailable.id;
                selVarId    = firstAvailable.id;
                selVarPrice = firstAvailable.price;
                selVarCompare = firstAvailable.compareAtPrice;
                selVarTitle = !isDefaultVariantTitle(firstAvailable.title) ? firstAvailable.title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
              } else {
                cardSoldOut = true;
                markProductCardSoldOut(card, addBtn);
              }

              wrap.style.display = '';
            });
          })(variantSelect, selectWrap, blockedVariantIds);
        }

        // ADD TO BOX / REMOVE FROM BOX button
        var addBtn = document.createElement('button');
        var stepCfg = box && box.comboConfig && Array.isArray(box.comboConfig.steps)
          ? (box.comboConfig.steps[activeSlotIndex] || null)
          : null;
        var productGridBtnLabel = resolveStepSelectionButtonLabel(stepCfg, box, ctx.settings);
        addBtn.type = 'button';
        if (isCurrentSlot || isUsed) {
          addBtn.className = 'cb-add-btn cb-add-btn--remove';
          if (isUsedByExternal) {
            addBtn.disabled = true;
            addBtn.textContent = 'Already in box';
          } else {
            addBtn.innerHTML = '&times; REMOVE FROM BOX';
          }
        } else {
          addBtn.className = 'cb-add-btn';
          addBtn.textContent = productGridBtnLabel;
        }

        card.appendChild(addBtn);

        if (isCurrentSlot) {
          ;(function (aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              slots[activeSlotIndex] = null;
              renderSlots();
              renderProductGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(addBtn);
        } else if (isUsedByExternal) {
          card.setAttribute('aria-disabled', 'true');
        } else if (isUsed) {
          ;(function (p, aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              for (var si = 0; si < slots.length; si++) {
                if (slots[si] && slots[si].productId === p.productId) {
                  slots[si] = null;
                  activeSlotIndex = si;
                  break;
                }
              }
              renderSlots();
              renderProductGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(product, addBtn);
        } else {
          if (cardSoldOut) {
            markProductCardSoldOut(card, addBtn);
          }
          ;(function (p, aBtn, blockedVariantIdsForProduct) {
            function doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice) {
              if (cardSoldOut || aBtn.disabled) return;
              aBtn.textContent = '\u2713 ' + productGridBtnLabel;
              aBtn.classList.add('cb-add-btn--added');

              var resolvedPrice = p.productPrice;
              if (variantPrice != null && parseFloat(variantPrice) > 0) {
                resolvedPrice = parseFloat(variantPrice);
              }

              var resolvedCompareAtPrice = p.productCompareAtPrice;
              if (variantCompareAtPrice != null && parseFloat(variantCompareAtPrice) > 0) {
                resolvedCompareAtPrice = parseFloat(variantCompareAtPrice);
              }

              slots[activeSlotIndex] = {
                productId: p.productId,
                productTitle: p.productTitle,
                productImageUrl: p.productImageUrl,
                productHandle: p.productHandle,
                productPrice: resolvedPrice,
                productCompareAtPrice: resolvedCompareAtPrice,
                variantIds: p.variantIds,
                isCollection: p.isCollection,
                selectedVariantId: variantId || null,
                selectedVariantTitle: variantTitle || null,
              };

              var next = -1;
              for (var i = activeSlotIndex + 1; i < slots.length; i++) {
                if (!slots[i]) { next = i; break; }
              }
              if (next === -1) {
                for (var j = 0; j < activeSlotIndex; j++) {
                  if (!slots[j]) { next = j; break; }
                }
              }
              if (next !== -1) activeSlotIndex = next;

              renderSlots();
              renderProductGrid();
              updateCartButton();
            }

            function onProductClick(showInfoModal) {
              if (cardSoldOut || aBtn.disabled) return;
              if (showInfoModal && !box.hideProductInfoModal && p.productHandle && !p.isCollection) {
                var opened = openProductInfoModal(
                  p,
                  card,
                  ctx.rootEl,
                  buildBoxDesignStyle(box.designSettings),
                  {
                    blockedVariantIds: blockedVariantIdsForProduct,
                    selectedVariantId: selVarId,
                    selectedVariantTitle: selVarTitle,
                    selectedVariantPrice: selVarPrice,
                    selectedVariantCompareAtPrice: selVarCompare,
                    currencySymbol: ctx.currencySymbol,
                    currencyCode: ctx.currencyCode,
                    showCompareAtPrice: box.displayCompareAtPrice,
                    buttonLabel: 'Add to Bundle',
                  },
                  doAddToSlot
                );
                if (opened) return;
              }
              if (showInfoModal) return;

              if (p.isCollection || !p.productHandle) {
                // Collection or no handle — add directly with fallback variant
                var fallbackId = p.variantIds && p.variantIds[0] ? String(p.variantIds[0]) : null;
                if (!box.allowDuplicates && fallbackId && blockedVariantIdsForProduct && blockedVariantIdsForProduct.indexOf(fallbackId) !== -1) return;
                doAddToSlot(fallbackId, null, p.productPrice, p.productCompareAtPrice);
              } else if (selVarId) {
                // Use variant already selected in the inline dropdown
                if (!box.allowDuplicates && blockedVariantIdsForProduct && blockedVariantIdsForProduct.indexOf(String(selVarId)) !== -1) return;
                doAddToSlot(selVarId, selVarTitle, selVarPrice, selVarCompare);
              } else {
                // Variants still loading — fall back to popup picker
                showVariantPicker(card, p, aBtn, blockedVariantIdsForProduct, function (variantId, variantTitle, variantPrice, variantCompareAtPrice) {
                  if (!variantId) return;
                  doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice);
                });
              }
            }

            aBtn.addEventListener('click', function (e) { e.stopPropagation(); onProductClick(false); });
            card.addEventListener('click', function () { onProductClick(true); });
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProductClick(true); }
            });
          })(product, addBtn, blockedVariantIds);
        }

        productGrid.appendChild(card);
      });

      renderWholeStorePagination();
    }

    function renderWholeStorePagination() {
      if (!wholeStorePager) return;
      wholeStorePagination.innerHTML = '';
      wholeStorePagination.style.display = 'flex';

      var prevBtn = document.createElement('button');
      prevBtn.type = 'button';
      prevBtn.className = 'cb-product-page-btn';
      prevBtn.textContent = 'Previous';
      prevBtn.disabled = wholeStoreLoading || !wholeStorePager.canGoPrevious();
      prevBtn.addEventListener('click', function () {
        if (prevBtn.disabled) return;
        loadWholeStorePage(null, searchTerm, false, true, wholeStorePager.previousCursor());
      });

      var pageLabel = document.createElement('span');
      pageLabel.className = 'cb-product-page-label';
      pageLabel.textContent = wholeStoreLoading ? 'Loading products...' : 'Product page';

      var nextBtn = document.createElement('button');
      nextBtn.type = 'button';
      nextBtn.className = 'cb-product-page-btn';
      nextBtn.textContent = 'Next';
      nextBtn.disabled = wholeStoreLoading || !(wholeStorePageInfo && wholeStorePageInfo.hasNextPage && wholeStorePageInfo.endCursor);
      nextBtn.addEventListener('click', function () {
        if (nextBtn.disabled) return;
        loadWholeStorePage(wholeStorePageInfo.endCursor, searchTerm, false, false);
      });

      wholeStorePagination.appendChild(prevBtn);
      wholeStorePagination.appendChild(pageLabel);
      wholeStorePagination.appendChild(nextBtn);
    }

    function loadWholeStorePage(after, search, reset, backwards, before) {
      if (!wholeStorePager || wholeStoreLoading || typeof wholeStorePager.loadPage !== 'function') return;
      wholeStoreLoading = true;
      renderWholeStorePagination();
      wholeStorePager.loadPage({
        after: after || null,
        before: before || null,
        search: search || '',
        reset: !!reset,
        backwards: !!backwards,
      }, function (err, nextProducts, nextPageInfo) {
        wholeStoreLoading = false;
        if (err) {
          renderWholeStorePagination();
          return;
        }
        products = Array.isArray(nextProducts) ? nextProducts : [];
        wholeStorePageInfo = nextPageInfo || null;
        renderProductGrid();
      });
    }

    renderProductGrid();
    updateCartButton();
    hydrateProductPricing(function () {
      renderProductGrid();
      updateCartButton();
    });

    // ── Cart Action ──
    function resetBuilderSelection() {
      setTimeout(function () {
        for (var i = 0; i < slots.length; i++) {
          slots[i] = null;
        }
        activeSlotIndex = 0;

        if (giftInput) giftInput.value = '';

        setBoxCardPrice(
          box,
          isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
          ctx.currencySymbol
        );

        renderSlots();
        renderProductGrid();
        updateCartButton();
      }, 0);
    }

    function doAddToCart() {
      if (slots.filter(Boolean).length < box.itemCount) {
        // Flash empty slots
        var stepEls = slotSteps.querySelectorAll('.cb-slot-step');
        slots.forEach(function (p, idx) {
          if (!p && stepEls[idx * 2]) {
            stepEls[idx * 2].classList.add('cb-slot-step--error');
            setTimeout(function () { stepEls[idx * 2].classList.remove('cb-slot-step--error'); }, 700);
          }
        });
        return;
      }

      // Pack Step flow (see renderPackPicker): don't add to cart yet — hand the
      // completed selections to the orchestrator, which advances to the next
      // Step (or, on the last Step, submits every Pack's selections together).
      if (stepOptions && typeof stepOptions.onComplete === 'function') {
        stepOptions.onComplete(slots.slice(), sessionId, giftInput ? giftInput.value : null, 'cart');
        return;
      }

      // Immediately show loading state on buttons before async resolve
      [inlineCartBtn, stickyState.btn, mobileAddBtn].forEach(function (btn) {
        if (!btn) return;
        btn.disabled = true;
        if (btn === stickyState.btn) {
          btn.className = 'cb-sticky-btn cb-sticky-btn--loading';
        } else if (btn === mobileAddBtn) {
          btn.className = 'cb-mobile-add-btn cb-mobile-add-btn--loading';
        } else {
          btn.className = 'cb-inline-cart-btn cb-inline-cart-btn--loading';
        }
        btn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span class="cb-btn-label">Adding\u2026</span>';
      });
      showPageLoader('Adding products to cart\u2026');

      // Resolve missing variantIds (existing boxes created before the fix)
      var resolvePromises = slots.map(function (p) {
        if (!p || (p.variantIds && p.variantIds.length > 0)) return Promise.resolve();
        if (!p.productHandle) return Promise.resolve();
        return new Promise(function (resolve) {
          fetchProductData(p.productHandle, function (err, productData) {
            if (!err && productData && productData.variants && productData.variants.length > 0) {
              p.variantIds = [String(productData.variants[0].id)];
            }
            resolve();
          });
        });
      });

      // Admin-configured post-add behavior: redirect straight to checkout or
      // cart instead of staying on the page. redirectToCheckout wins if both
      // are somehow set. Undefined preserves today's default (stay + drawer).
      var addToCartRedirectUrl = box.redirectToCheckout ? '/checkout' : (box.redirectToCart ? '/cart' : undefined);

      Promise.all(resolvePromises).then(function () {
        addToCart(
          box,
          slots,
          sessionId,
          giftInput ? giftInput.value : null,
          inlineCartBtn,
          stickyState.btn,
          resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box),
          ctx.currencySymbol,
          ctx.apiBase,
          ctx.shop,
          resetBuilderSelection,
          addToCartRedirectUrl
        );
      });
    }

    function doCheckout() {
      if (slots.filter(Boolean).length < box.itemCount) {
        var stepEls = slotSteps.querySelectorAll('.cb-slot-step');
        slots.forEach(function (p, idx) {
          if (!p && stepEls[idx * 2]) {
            stepEls[idx * 2].classList.add('cb-slot-step--error');
            setTimeout(function () { stepEls[idx * 2].classList.remove('cb-slot-step--error'); }, 700);
          }
        });
        return;
      }
      if (stepOptions && typeof stepOptions.onComplete === 'function') {
        stepOptions.onComplete(slots.slice(), sessionId, giftInput ? giftInput.value : null, 'checkout');
        return;
      }
      if (step3CheckoutBtn) {
        step3CheckoutBtn.disabled = true;
        step3CheckoutBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span class="cb-btn-label">Processing\u2026</span>';
      }
      showPageLoader('Processing\u2026');
      var rp = slots.map(function (p) {
        if (!p || (p.variantIds && p.variantIds.length > 0)) return Promise.resolve();
        if (!p.productHandle) return Promise.resolve();
        return new Promise(function (resolve) {
          fetchProductData(p.productHandle, function (err, productData) {
            if (!err && productData && productData.variants && productData.variants.length > 0) {
              p.variantIds = [String(productData.variants[0].id)];
            }
            resolve();
          });
        });
      });
      Promise.all(rp).then(function () {
        addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, step3CheckoutBtn, null, 'Checkout \u2192', ctx.currencySymbol, ctx.apiBase, ctx.shop, null, '/checkout');
      });
    }

    inlineCartBtn.addEventListener('click', doAddToCart);
    mobileAddBtn.addEventListener('click', doAddToCart);
    mobileCheckoutBtn.addEventListener('click', doCheckout);

    // Steps mode: wire step3 buttons with immediate spinner
    if (ctx.layoutMode === 'steps') {
      if (step3CartBtn) {
        step3CartBtn.addEventListener('click', function () {
          if (slots.filter(Boolean).length < box.itemCount) return;
          step3CartBtn.disabled = true;
          step3CartBtn.classList.add('cb-step3-cart-btn--loading');
          step3CartBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Adding\u2026</span>';
          if (step3CheckoutBtn) step3CheckoutBtn.disabled = true;
          doAddToCart();
        });
      }
      if (step3CheckoutBtn) {
        step3CheckoutBtn.addEventListener('click', function () {
          if (slots.filter(Boolean).length < box.itemCount) return;
          step3CheckoutBtn.disabled = true;
          step3CheckoutBtn.classList.add('cb-step3-checkout-btn--loading');
          step3CheckoutBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Checkout\u2026</span>';
          if (step3CartBtn) step3CartBtn.disabled = true;
          doCheckout();
        });
      }
    }

    removeStickyFooter(ctx);
    if (ctx.enableStickyCart !== false && !hideOwnCartUI) {
      createStickyFooter(box, ctx, doAddToCart);
    }
    updateCartButton();
  }

  // ─── Specific Combo Builder ────────────────────────────────────────────────────
  // Same slot-box + product-grid UI as standard combo, but each slot draws
  // products from its own step config (selectedProducts or collections).

  function renderSpecificComboBuilder(container, box, ctx) {
    container.innerHTML = '';

    var stickyState = getStickyFooterState(ctx);
    var comboConfig = box.comboConfig;
    var numSteps = comboConfig.comboType || comboConfig.steps.length;
    var steps = comboConfig.steps.slice(0, numSteps);

    // Pad steps array to numSteps with safe defaults if the stored config has fewer entries
    // (can happen when a box was saved as 2-step and later changed to 3-step)
    while (steps.length < numSteps) {
      steps.push({ label: 'Item ' + (steps.length + 1), optional: false, scope: 'collection', collections: [], selectedProducts: [] });
    }

    var sessionId = generateSessionId();

    var slots = [];
    for (var si = 0; si < numSteps; si++) slots.push(null);
    var activeSlotIndex = 0;

    function isOptionalStep(stepCfg) {
      if (!stepCfg) return false;
      return stepCfg.optional === true || String(stepCfg.optional).toLowerCase() === 'true';
    }

    function getRequiredStepIndexes() {
      var required = [];
      for (var i = 0; i < numSteps; i++) {
        if (!isOptionalStep(steps[i])) required.push(i);
      }
      return required;
    }

    function areRequiredStepsFilled() {
      var required = getRequiredStepIndexes();
      if (required.length === 0) return slots.some(Boolean);
      for (var i = 0; i < required.length; i++) {
        if (!slots[required[i]]) return false;
      }
      return true;
    }

    // Specific combo should follow forward step flow only.
    // Do not wrap to previous empty steps (prevents jumping backwards after Skip).
    function findNextEmptySlot(currentIdx) {
      for (var i = currentIdx + 1; i < slots.length; i++) {
        if (!slots[i]) return i;
      }
      return -1;
    }

    // Per-step product cache (keyed by step index)
    var stepProductsCache = {};

    // ── Step 2 Heading ──
    var step2Head = document.createElement('h2');
    step2Head.className = 'cb-step-heading';
    step2Head.textContent = ctx.step2Heading || ('Step 2: ' + (comboConfig.title || 'Select your products'));
    container.appendChild(step2Head);

    if (comboConfig.highlightText) {
      var highlightEl = document.createElement('div');
      highlightEl.style.display = 'inline-flex';
      highlightEl.style.alignItems = 'center';
      highlightEl.style.padding = '4px 10px';
      highlightEl.style.marginBottom = '8px';
      highlightEl.style.borderRadius = '999px';
      highlightEl.style.fontSize = '11px';
      highlightEl.style.fontWeight = '700';
      highlightEl.style.letterSpacing = '0.03em';
      highlightEl.style.background = 'rgba(17,24,39,0.06)';
      highlightEl.style.color = '#111827';
      highlightEl.textContent = comboConfig.highlightText;
      container.appendChild(highlightEl);
    }

    if (comboConfig.subtitle) {
      var subEl = document.createElement('p');
      subEl.className = 'cb-combo-subtitle';
      subEl.textContent = comboConfig.subtitle;
      container.appendChild(subEl);
    }

    if (comboConfig.supportText) {
      var supportEl = document.createElement('p');
      supportEl.style.margin = '0 0 12px';
      supportEl.style.fontSize = '12px';
      supportEl.style.color = 'var(--cb-text-muted)';
      supportEl.textContent = comboConfig.supportText;
      container.appendChild(supportEl);
    }

    // ── Slot Steps Row (identical to renderBuilder) ──
    var slotWrapper = document.createElement('div');
    slotWrapper.className = 'cb-slot-wrapper';

    var slotSteps = document.createElement('div');
    slotSteps.className = 'cb-slot-steps';

    var inlineCartBtn = document.createElement('button');
    inlineCartBtn.className = 'cb-inline-cart-btn';
    inlineCartBtn.type = 'button';
    inlineCartBtn.disabled = true;
    inlineCartBtn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box);

    function renderSlots() {
      slotSteps.innerHTML = '';
      slots.forEach(function (slotProduct, idx) {
        if (idx > 0) {
          var connector = document.createElement('div');
          connector.className = 'cb-slot-connector';
          slotSteps.appendChild(connector);
        }

        var step = document.createElement('div');
        step.className = 'cb-slot-step';
        if (slotProduct) {
          step.classList.add('cb-slot-step--filled');
        } else if (idx === activeSlotIndex) {
          step.classList.add('cb-slot-step--active');
        }

        var numEl = document.createElement('div');
        numEl.className = 'cb-slot-step-num';
        if (slotProduct) {
          if (slotProduct.productImageUrl) {
            var thumb = document.createElement('img');
            thumb.src = slotProduct.productImageUrl;
            thumb.alt = slotProduct.productTitle || '';
            thumb.className = 'cb-slot-step-thumb';
            numEl.appendChild(thumb);
          } else {
            numEl.textContent = (slotProduct.productTitle || '?').charAt(0).toUpperCase();
          }
        } else {
          numEl.textContent = idx + 1;
        }
        step.appendChild(numEl);

        var labelEl = document.createElement('div');
        labelEl.className = 'cb-slot-step-label';
        var smallText = document.createElement('span');
        smallText.className = 'cb-slot-step-small';
        smallText.textContent = slotProduct ? 'Selected' : (isOptionalStep(steps[idx]) ? 'Optional' : 'Select your');
        labelEl.appendChild(smallText);

        var itemLink = document.createElement('div');
        itemLink.className = 'cb-slot-step-item';
        if (slotProduct) {
          var shortTitle = slotProduct.productTitle || ('Item ' + (idx + 1));
          if (slotProduct.selectedVariantTitle) shortTitle += ' · ' + slotProduct.selectedVariantTitle;
          itemLink.textContent = shortTitle.length > 16 ? shortTitle.slice(0, 15) + '\u2026' : shortTitle;
          itemLink.classList.add('cb-slot-step-item--filled');
          ;(function (i) {
            step.style.cursor = 'pointer';
            step.addEventListener('click', function () {
              activeSlotIndex = i;
              renderSlots();
              loadAndRenderGrid();
            });
          })(idx);

          var removeBtn = document.createElement('button');
          removeBtn.className = 'cb-slot-remove';
          removeBtn.type = 'button';
          removeBtn.setAttribute('aria-label', 'Remove');
          removeBtn.innerHTML = '&times;';
          ;(function (i) {
            removeBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              slots[i] = null;
              activeSlotIndex = i;
              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            });
          })(idx);
          step.appendChild(removeBtn);
        } else {
          // Use step label if set
          var stepLabel = (steps[idx] && steps[idx].label) ? steps[idx].label : ('Item ' + (idx + 1));
          if (isOptionalStep(steps[idx])) stepLabel += ' (Optional)';
          itemLink.textContent = stepLabel;
          ;(function (i) {
            step.style.cursor = 'pointer';
            step.addEventListener('click', function () {
              activeSlotIndex = i;
              renderSlots();
              loadAndRenderGrid();
            });
          })(idx);
        }
        labelEl.appendChild(itemLink);
        step.appendChild(labelEl);
        slotSteps.appendChild(step);
      });
    }

    renderSlots();
    slotWrapper.appendChild(slotSteps);

    // In steps mode the inline cart button is always hidden — step3CartSection handles the action.
    if (ctx.layoutMode === 'steps') {
      inlineCartBtn.style.display = 'none';
    }
    slotWrapper.appendChild(inlineCartBtn);

    // Mobile cart buttons (≤750px sticky slot bar — shown via CSS)
    var mobileCartBtns = document.createElement('div');
    mobileCartBtns.className = 'cb-slot-mobile-btns';
    var mobileAddBtn = document.createElement('button');
    mobileAddBtn.className = 'cb-mobile-add-btn';
    mobileAddBtn.type = 'button';
    mobileAddBtn.disabled = true;
    mobileAddBtn.textContent = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box);
    var mobileCheckoutBtn = document.createElement('button');
    mobileCheckoutBtn.className = 'cb-mobile-checkout-btn';
    mobileCheckoutBtn.type = 'button';
    mobileCheckoutBtn.disabled = true;
    mobileCheckoutBtn.style.display = 'none'; // hidden until all slots filled
    mobileCheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
    mobileCartBtns.appendChild(mobileAddBtn);
    mobileCartBtns.appendChild(mobileCheckoutBtn);
    slotWrapper.appendChild(mobileCartBtns);

    container.appendChild(slotWrapper);
    requestAnimationFrame(function () {
      slotWrapper.scrollLeft = 0;
    });

    // ── Step 3: Cart section (steps mode only, hidden until all slots filled) ──
    // Placed immediately after slotWrapper so buttons appear below selected products
    var step3CartSection = null;
    var step3CartBtn = null;
    var step3CheckoutBtn = null;
    if (ctx.layoutMode === 'steps') {
      step3CartSection = document.createElement('div');
      step3CartSection.className = 'cb-step3-cart';
      step3CartSection.style.display = 'none';

      var step3Head = document.createElement('h2');
      step3Head.className = 'cb-step-heading cb-step3-heading';
      step3Head.textContent = ctx.step3Heading || 'Step 3: Complete your order';
      step3CartSection.appendChild(step3Head);

      var step3Btns = document.createElement('div');
      step3Btns.className = 'cb-step3-buttons';

      var showCart     = ctx.step3Buttons !== 'checkout_only';
      var showCheckout = ctx.step3Buttons !== 'cart_only';

      if (showCart) {
        step3CartBtn = document.createElement('button');
        step3CartBtn.type = 'button';
        step3CartBtn.className = 'cb-step3-cart-btn';
        step3CartBtn.textContent = resolveStepCartButtonLabel(box, ctx);
        step3Btns.appendChild(step3CartBtn);
      }

      if (showCheckout) {
        step3CheckoutBtn = document.createElement('button');
        step3CheckoutBtn.type = 'button';
        step3CheckoutBtn.className = 'cb-step3-checkout-btn';
        step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
        step3Btns.appendChild(step3CheckoutBtn);
      }

      step3CartSection.appendChild(step3Btns);
      slotWrapper.appendChild(step3CartSection);
    }

    // ── Product Section ──
    var giftInput = null;
    var giftSection = null;
    if (box.giftMessageEnabled) {
      giftSection = document.createElement('div');
      giftSection.className = 'cb-gift-section';
      giftSection.style.display = 'none';
      var giftLabel = document.createElement('label');
      giftLabel.className = 'cb-gift-label';
      giftLabel.textContent = 'Gift Message (optional)';
      giftInput = document.createElement('textarea');
      giftInput.className = 'cb-gift-input';
      giftInput.placeholder = 'Write a personal message...';
      giftInput.rows = 2;
      giftInput.maxLength = 100;
      giftSection.appendChild(giftLabel);
      giftSection.appendChild(giftInput);
      container.appendChild(giftSection);
    }

    var productSection = document.createElement('div');
    productSection.className = 'cb-product-section';

    var productLabel = document.createElement('div');
    productLabel.className = 'cb-product-label';
    var productLabelContent = document.createElement('div');
    productLabelContent.className = 'cb-product-label-content';
    var productLabelText = document.createElement('span');
    productLabelText.className = 'cb-product-label-text';
    var productLabelDesc = document.createElement('div');
    productLabelDesc.className = 'cb-product-label-desc';
    productLabelDesc.style.display = 'none';
    productLabelContent.appendChild(productLabelText);
    productLabelContent.appendChild(productLabelDesc);
    productLabel.appendChild(productLabelContent);

    var skipStepBtn = document.createElement('button');
    skipStepBtn.type = 'button';
    skipStepBtn.className = 'cb-step-skip-btn';
    skipStepBtn.textContent = 'Skip';
    skipStepBtn.style.display = 'none';
    skipStepBtn.addEventListener('click', function () {
      var stepCfg = steps[activeSlotIndex] || {};
      if (!isOptionalStep(stepCfg)) return;
      slots[activeSlotIndex] = null;
      var next = findNextEmptySlot(activeSlotIndex);
      if (next !== -1) activeSlotIndex = next;
      renderSlots();
      loadAndRenderGrid();
      updateCartButton();
    });
    productLabel.appendChild(skipStepBtn);
    productSection.appendChild(productLabel);

    var productGrid = document.createElement('div');
    productGrid.className = 'cb-product-grid';
    var cols = normalizeProductCardsPerRow(ctx.settings && ctx.settings.productCardsPerRow);
    productGrid.style.setProperty('--cb-products-per-row', String(cols));
    productGrid.style.setProperty('--cb-products-per-row-tablet', String(Math.min(cols, 3)));
    productGrid.style.setProperty('--cb-products-per-row-mobile', String(Math.min(cols, 2)));
    productSection.appendChild(productGrid);
    container.appendChild(productSection);
    ctx._productSection = productSection;

    // ── Cart button state ──
    function updateCartButton() {
      var filled = slots.filter(Boolean).length;
      var allFilled = filled === numSteps;
      var cartReady = areRequiredStepsFilled();
      var addLabel = resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box);
      var stepAddLabel = resolveStepCartButtonLabel(box, ctx);

      inlineCartBtn.disabled = !cartReady;
      if (cartReady) inlineCartBtn.classList.add('cb-inline-cart-btn--ready');
      else inlineCartBtn.classList.remove('cb-inline-cart-btn--ready');
      inlineCartBtn.textContent = addLabel;

      // Mobile cart buttons
      mobileAddBtn.disabled = !cartReady;
      if (cartReady) { mobileAddBtn.classList.add('cb-mobile-add-btn--ready'); mobileAddBtn.textContent = addLabel; }
      else { mobileAddBtn.classList.remove('cb-mobile-add-btn--ready'); mobileAddBtn.textContent = addLabel; }
      mobileCheckoutBtn.disabled = !cartReady;
      mobileCheckoutBtn.style.display = cartReady ? '' : 'none';

      if (stickyState.btn) {
        stickyState.btn.disabled = !cartReady;
        if (cartReady) stickyState.btn.classList.add('cb-sticky-btn--ready');
        else stickyState.btn.classList.remove('cb-sticky-btn--ready');
        stickyState.btn.textContent = addLabel;
      }

      if (giftSection) giftSection.style.display = cartReady ? 'block' : 'none';

      var totalMrp = getSelectedProductsTotal(slots);
      var isDynamic = isDynamicBundlePrice(box);
      var bundlePriceRaw = parseFloat(box.bundlePrice) || 0;
      var dynamicBreakdown = getComboDiscountBreakdown(totalMrp, box.comboConfig, slots);
      var effectivePrice = isDynamic
        ? dynamicBreakdown.discountedTotal
        : bundlePriceRaw;
      if (stickyState.totalEl) {
        renderStickyTotal(
          stickyState.totalEl,
          isDynamic ? getDynamicDisplayPrice(effectivePrice) : effectivePrice,
          ctx.currencySymbol
        );
      }
      setBoxCardPrice(
        box,
        isDynamic ? getDynamicDisplayPrice(effectivePrice) : effectivePrice,
        ctx.currencySymbol
      );
      setWizardSelectedPrice(
        ctx,
        box,
        isDynamic ? getDynamicDisplayPrice(effectivePrice) : effectivePrice
      );

      // Savings / MRP row for specific combo
      if (stickyState.savingsEl) {
        var hasAnyProduct = slots.some(Boolean);
        var originalPrice = isDynamic ? totalMrp : bundlePriceRaw;
        var savings = isDynamic ? dynamicBreakdown.discountAmount : Math.max(0, totalMrp - bundlePriceRaw);
        if (hasAnyProduct && savings > 0.005) {
          var savingsBadge = (ctx.settings && ctx.settings.showSavingsBadge)
            ? '<span class="cb-sticky-save">Save ' + formatPrice(savings, ctx.currencySymbol, ctx.currencyCode) + '</span>'
            : '';
          var freeUnitsBadge =
            box && box.comboConfig && box.comboConfig.discountType === 'buy_x_get_y' && dynamicBreakdown.freeUnits > 0
              ? '<span class="cb-sticky-save">Free items: ' + dynamicBreakdown.freeUnits + '</span>'
              : '';
          stickyState.savingsEl.innerHTML =
            '<span class="cb-sticky-mrp">MRP: ' + formatPrice(originalPrice, ctx.currencySymbol, ctx.currencyCode) + '</span>' +
            savingsBadge +
            (isDynamic ? freeUnitsBadge : '');
          stickyState.savingsEl.style.display = 'flex';
        } else {
          stickyState.savingsEl.style.display = 'none';
        }
      }

      // Steps mode: hide product grid when done; enable/disable cart buttons; update wizard
      if (ctx.layoutMode === 'steps') {
        var savedScrollY = window.scrollY;
        productSection.style.display = allFilled ? 'none' : '';
        if (step3CartSection) step3CartSection.style.display = cartReady ? '' : 'none';
        if (allFilled) {
          requestAnimationFrame(function () {
            requestAnimationFrame(function () { window.scrollTo(0, savedScrollY); });
          });
        }
        if (step3CartBtn) {
          step3CartBtn.disabled = !cartReady;
          if (!cartReady) {
            step3CartBtn.classList.remove('cb-step3-cart-btn--loading');
            step3CartBtn.textContent = stepAddLabel;
          }
        }
        if (step3CheckoutBtn) {
          step3CheckoutBtn.disabled = !cartReady;
          if (!cartReady) {
            step3CheckoutBtn.classList.remove('cb-step3-checkout-btn--loading');
            step3CheckoutBtn.textContent = ctx.checkoutBtnLabel || 'Checkout';
          }
        }
        if (cartReady && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--done';
          setWizardStep2Preview(ctx, slots);
          ctx._wizardDots[2].className = 'cb-wizard-step cb-wizard-step--active';
          if (ctx._wizardLines && ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line cb-wizard-line--done';
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].doneLabel;
            ctx._wizardLabelEls[2].textContent = ctx._wizardStepDefs[2].label;
          }
        } else if (!cartReady && ctx._wizardDots && ctx._wizardDots[2]) {
          ctx._wizardDots[1].className = 'cb-wizard-step cb-wizard-step--active';
                    ctx._wizardDots[2].className = 'cb-wizard-step';
          if (ctx._wizardLines && ctx._wizardLines[1]) ctx._wizardLines[1].className = 'cb-wizard-line';
          if (ctx._wizardLabelEls && ctx._wizardStepDefs) {
            ctx._wizardLabelEls[1].textContent = ctx._wizardStepDefs[1].label;
          }
        }
      }
    }

    // ── Resolve products for a step ──
    function normalizeProduct(p) {
      var rawVarId = p.variantId || null;
      var numericVarId = rawVarId && String(rawVarId).indexOf('/') !== -1
        ? String(rawVarId).split('/').pop()
        : (rawVarId ? String(rawVarId) : null);
      return {
        productId: p.id || p.productId,
        productTitle: p.title || p.productTitle || '',
        productHandle: p.handle || p.productHandle || '',
        productImageUrl: p.imageUrl || p.productImageUrl || null,
        productPrice: parseFloat(p.price || p.productPrice) || 0,
        productCompareAtPrice: parseFloat(p.compareAtPrice || p.productCompareAtPrice) || null,
        variantIds: numericVarId ? [numericVarId] : (Array.isArray(p.variantIds) ? p.variantIds : []),
        isCollection: false,
      };
    }

    function getStepProducts(stepIdx, cb) {
      if (stepProductsCache[stepIdx]) { cb(null, stepProductsCache[stepIdx]); return; }
      var stepCfg = steps[stepIdx];
      if (!stepCfg) { cb(null, []); return; }

      // Primary source: admin-expanded resolvedProducts (Admin API → no storefront dependency)
      if (Array.isArray(stepCfg.resolvedProducts) && stepCfg.resolvedProducts.length > 0) {
        var resolved = filterInternalComboProducts(
          stepCfg.resolvedProducts.map(normalizeProduct),
          ctx
        );
        stepProductsCache[stepIdx] = resolved;
        cb(null, resolved);
        return;
      }

      var scope = stepCfg.scope || 'collection';

      if (scope === 'product' || scope === 'wholestore') {
        var prods = filterInternalComboProducts(
          (stepCfg.selectedProducts || []).map(normalizeProduct),
          ctx
        );
        stepProductsCache[stepIdx] = prods;
        cb(null, prods);
      } else {
        // Collection scope — fetch ALL configured collections and merge results
        var colls = (stepCfg.collections || []).filter(function (c) { return c && c.handle; });
        if (!colls.length) { cb(null, []); return; }

        var remaining = colls.length;
        var allProds = [];
        var seenIds = {};
        var firstErr = null;

        colls.forEach(function (coll) {
          fetchCollectionProducts(coll.handle, function (err, prods) {
            if (err) firstErr = err;
            if (prods) {
              var filteredProds = filterInternalComboProducts(prods, ctx);
              filteredProds.forEach(function (p) {
                if (!seenIds[p.productId]) {
                  seenIds[p.productId] = true;
                  allProds.push(p);
                }
              });
            }
            remaining--;
            if (remaining === 0) {
              if (allProds.length > 0) stepProductsCache[stepIdx] = allProds;
              cb(allProds.length === 0 ? firstErr : null, allProds);
            }
          });
        });
      }
    }

    // ── Product Grid rendering ──
    function renderProductGrid(products) {
      var stepCfg = steps[activeSlotIndex] || {};
      var stepLabelText = stepCfg.label || ('Item ' + (activeSlotIndex + 1));
      if (isOptionalStep(stepCfg)) stepLabelText += ' (Optional)';
      var popupCfg = stepCfg.popup || {};
      var stepHeading = typeof popupCfg.title === 'string' && popupCfg.title.trim()
        ? popupCfg.title.trim()
        : ('Choose your ' + stepLabelText);
      var stepDescription = typeof popupCfg.desc === 'string' ? popupCfg.desc.trim() : '';
      productLabelText.textContent = stepHeading;
      if (stepDescription) {
        productLabelDesc.textContent = stepDescription;
        productLabelDesc.style.display = 'block';
      } else {
        productLabelDesc.textContent = '';
        productLabelDesc.style.display = 'none';
      }
      skipStepBtn.style.display = isOptionalStep(stepCfg) && !slots[activeSlotIndex] ? 'inline-flex' : 'none';
      productGrid.innerHTML = '';

      if (!products) {
        productGrid.innerHTML = '';
        return;
      }
      if (products.length === 0) {
        productGrid.innerHTML = '<p style="color:var(--cb-text-muted);font-family:var(--cb-font);padding:24px 0;text-align:center;">No products available for this step.</p>';
        return;
      }

      // Build used-product tracking from all OTHER slots (for allowDuplicates = false)
      var usedIds = [];
      var usedVariantIdsByProduct = {};
      if (!box.allowDuplicates) {
        slots.forEach(function (p, si) {
          if (!p || si === activeSlotIndex) return;
          usedIds.push(p.productId);
          if (p.selectedVariantId) {
            var key = String(p.productId);
            if (!usedVariantIdsByProduct[key]) usedVariantIdsByProduct[key] = [];
            var sid = String(p.selectedVariantId);
            if (usedVariantIdsByProduct[key].indexOf(sid) === -1) usedVariantIdsByProduct[key].push(sid);
          }
        });
      }

      products.forEach(function (product) {
        var isCurrentSlot = slots[activeSlotIndex] && slots[activeSlotIndex].productId === product.productId;
        var isUsed = !box.allowDuplicates && usedIds.indexOf(product.productId) !== -1 && !isCurrentSlot;

        var card = document.createElement('div');
        card.className = 'cb-product-card';
        if (isCurrentSlot) {
          card.classList.add('cb-product-card--current');
        } else if (isUsed) {
          card.classList.add('cb-product-card--used');
        }
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');

        // Image
        var imgWrap = document.createElement('div');
        imgWrap.className = 'cb-product-img-wrap';
        if (product.productImageUrl) {
          var img = document.createElement('img');
          img.src = product.productImageUrl;
          img.alt = product.productTitle || '';
          img.className = 'cb-product-img';
          img.loading = 'lazy';
          imgWrap.appendChild(img);
        } else {
          var ph = document.createElement('div');
          ph.className = 'cb-product-img-placeholder';
          ph.textContent = (product.productTitle || '?').charAt(0).toUpperCase();
          imgWrap.appendChild(ph);
        }
        card.appendChild(imgWrap);

        var selVarId = null;
        var selVarTitle = null;
        var selVarPrice = product.productPrice != null ? parseFloat(product.productPrice) : null;
        var selVarCompare = product.productCompareAtPrice != null ? parseFloat(product.productCompareAtPrice) : null;
        var cardSoldOut = !isProductAvailable(product);

        var infoEl = document.createElement('div');
        infoEl.className = 'cb-product-info';

        var titleRow = document.createElement('div');
        titleRow.className = 'cb-product-title-row';
        var titleEl = document.createElement('div');
        titleEl.className = 'cb-product-title';
        titleEl.textContent = product.productTitle || product.productId;
        titleRow.appendChild(titleEl);

        var learnBtn = null;
        if (product.productHandle && !product.isCollection && !box.hideProductInfoModal) {
          learnBtn = document.createElement('button');
          learnBtn.type = 'button';
          learnBtn.className = 'cb-product-learn-link';
          learnBtn.innerHTML = LEARN_MORE_ICON_SVG + '<span>Learn more</span>';
          learnBtn.addEventListener('click', function (e) {
            e.preventDefault(); e.stopPropagation();
            openProductDescriptionModal(product, learnBtn, ctx.rootEl, buildBoxDesignStyle(box.designSettings));
          });
        }
        infoEl.appendChild(titleRow);

        var metaRow = document.createElement('div');
        metaRow.className = 'cb-product-meta-row';
        var priceWrap = document.createElement('span');
        priceWrap.className = 'cb-product-price-wrap';
        metaRow.appendChild(priceWrap);
        if (learnBtn) metaRow.appendChild(learnBtn);

        function renderPriceWrap(price, compareAt) {
          priceWrap.innerHTML = '';
          var sp = price != null ? parseFloat(price) : null;
          var cp = compareAt != null ? parseFloat(compareAt) : null;
          if (sp && sp > 0) {
            var pEl = document.createElement('span');
            pEl.className = 'cb-product-price';
            pEl.textContent = formatPrice(sp, ctx.currencySymbol, ctx.currencyCode);
            priceWrap.appendChild(pEl);
            if (box.displayCompareAtPrice && cp && cp > sp) {
              var cEl = document.createElement('span');
              cEl.className = 'cb-product-compare-price';
              cEl.textContent = formatPrice(cp, ctx.currencySymbol, ctx.currencyCode);
              priceWrap.appendChild(cEl);
            }
          }
        }
        renderPriceWrap(selVarPrice, selVarCompare);
        infoEl.appendChild(metaRow);
        card.appendChild(infoEl);

        // Variant select — own row below price
        if (!product.isCollection && product.productHandle) {
          var selectWrap = document.createElement('div');
          selectWrap.className = 'cb-variant-select-wrap';
          selectWrap.style.display = 'none';
          var variantSelect = document.createElement('select');
          variantSelect.className = 'cb-variant-select';
          variantSelect.addEventListener('click', function (e) { e.stopPropagation(); });
          variantSelect.addEventListener('change', function (e) {
            e.stopPropagation();
            var cached = variantSelect._cbVariants || [];
            for (var vi = 0; vi < cached.length; vi++) {
              if (String(cached[vi].id) === variantSelect.value) {
                selVarId    = cached[vi].id;
                selVarPrice = cached[vi].price;
                selVarCompare = cached[vi].compareAtPrice;
                selVarTitle = !isDefaultVariantTitle(cached[vi].title) ? cached[vi].title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
                break;
              }
            }
          });
          selectWrap.appendChild(variantSelect);
          infoEl.appendChild(selectWrap); // own row below metaRow

          ;(function (sel, wrap) {
            fetchVariants(product.productHandle, product.variantIds, function (err, variants) {
              if (err || !variants || variants.length === 0) return;
              if (variants.length === 1) {
                var v0 = variants[0];
                if (v0.price != null) {
                  selVarPrice = v0.price;
                  selVarCompare = v0.compareAtPrice;
                  renderPriceWrap(selVarPrice, selVarCompare);
                }
                wrap.style.display = 'none';
                sel._cbVariants = variants;
                var v0Unavailable = !isVariantAvailable(v0);
                if (v0Unavailable) {
                  sel.innerHTML = '';
                  sel._cbVariants = variants;
                  var singleOpt = document.createElement('option');
                  singleOpt.value = v0.id;
                  singleOpt.disabled = true;
                  singleOpt.textContent = (v0.title || 'Default Title') + ' — Out of stock';
                  sel.appendChild(singleOpt);
                  sel.value = v0.id;
                  wrap.style.display = 'none';
                  if (addBtn) {
                    cardSoldOut = true;
                    markProductCardSoldOut(card, addBtn);
                  }
                  return;
                }
                selVarId = v0.id;
                selVarTitle = !isDefaultVariantTitle(v0.title) ? v0.title : null;
                return;
              }
              sel.innerHTML = '';
              sel._cbVariants = variants;
              if (variants[0] && variants[0].price != null) {
                selVarPrice = variants[0].price;
                selVarCompare = variants[0].compareAtPrice;
                renderPriceWrap(selVarPrice, selVarCompare);
              }
              var firstAvailable = null;
              variants.forEach(function (v) {
                var opt = document.createElement('option');
                opt.value = v.id;
                var lbl = v.title;
                var variantUnavailable = !isVariantAvailable(v);
                if (variantUnavailable) { opt.disabled = true; lbl += ' \u2014 Out of stock'; }
                opt.textContent = lbl;
                sel.appendChild(opt);
                if (!firstAvailable && !variantUnavailable) firstAvailable = v;
              });
              if (firstAvailable) {
                sel.value = firstAvailable.id;
                selVarId    = firstAvailable.id;
                selVarPrice = firstAvailable.price;
                selVarCompare = firstAvailable.compareAtPrice;
                selVarTitle = !isDefaultVariantTitle(firstAvailable.title) ? firstAvailable.title : null;
                renderPriceWrap(selVarPrice, selVarCompare);
              } else {
                cardSoldOut = true;
                markProductCardSoldOut(card, addBtn);
              }
              wrap.style.display = '';
            });
          })(variantSelect, selectWrap);
        }

        // ADD TO BOX / REMOVE FROM BOX button
        var addBtn = document.createElement('button');
        var stepCfg = steps[activeSlotIndex] || null;
        var productGridBtnLabel = resolveStepSelectionButtonLabel(stepCfg, box, ctx.settings);
        addBtn.type = 'button';
        if (isCurrentSlot || isUsed) {
          addBtn.className = 'cb-add-btn cb-add-btn--remove';
          addBtn.innerHTML = '&times; REMOVE FROM BOX';
        } else {
          addBtn.className = 'cb-add-btn';
          addBtn.textContent = productGridBtnLabel;
        }
        card.appendChild(addBtn);

        if (isCurrentSlot) {
          ;(function (aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              slots[activeSlotIndex] = null;
              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(addBtn);
        } else if (isUsed) {
          ;(function (p, aBtn) {
            function onRemove(e) {
              e.stopPropagation();
              for (var si = 0; si < slots.length; si++) {
                if (slots[si] && slots[si].productId === p.productId) {
                  slots[si] = null;
                  break;
                }
              }
              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            }
            aBtn.addEventListener('click', onRemove);
            card.addEventListener('click', onRemove);
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRemove(e); }
            });
          })(product, addBtn);
        } else {
          if (cardSoldOut) {
            markProductCardSoldOut(card, addBtn);
          }
          ;(function (p, aBtn) {
            function doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice) {
              if (cardSoldOut || aBtn.disabled) return;
              aBtn.textContent = '\u2713 ' + productGridBtnLabel;
              aBtn.classList.add('cb-add-btn--added');

              var resolvedPrice = p.productPrice;
              if (variantPrice != null && parseFloat(variantPrice) > 0) resolvedPrice = parseFloat(variantPrice);

              slots[activeSlotIndex] = {
                productId: p.productId,
                productTitle: p.productTitle,
                productImageUrl: p.productImageUrl,
                productHandle: p.productHandle,
                productPrice: resolvedPrice,
                productCompareAtPrice: variantCompareAtPrice != null && parseFloat(variantCompareAtPrice) > 0
                  ? parseFloat(variantCompareAtPrice)
                  : p.productCompareAtPrice,
                variantIds: p.variantIds,
                isCollection: p.isCollection,
                selectedVariantId: variantId || null,
                selectedVariantTitle: variantTitle || null,
              };

              // Advance to next empty slot
              var next = findNextEmptySlot(activeSlotIndex);
              if (next !== -1) activeSlotIndex = next;

              renderSlots();
              loadAndRenderGrid();
              updateCartButton();
            }

            function onProductClick(showInfoModal) {
              if (cardSoldOut || aBtn.disabled) return;
              if (showInfoModal && !box.hideProductInfoModal && p.productHandle && !p.isCollection) {
                var opened = openProductInfoModal(
                  p,
                  card,
                  ctx.rootEl,
                  buildBoxDesignStyle(box.designSettings),
                  {
                    selectedVariantId: selVarId,
                    selectedVariantTitle: selVarTitle,
                    selectedVariantPrice: selVarPrice,
                    selectedVariantCompareAtPrice: selVarCompare,
                    currencySymbol: ctx.currencySymbol,
                    currencyCode: ctx.currencyCode,
                    showCompareAtPrice: box.displayCompareAtPrice,
                    buttonLabel: 'Add to Bundle',
                  },
                  doAddToSlot
                );
                if (opened) return;
              }
              if (showInfoModal) return;

              if (p.isCollection || !p.productHandle) {
                var fallbackId = p.variantIds && p.variantIds[0] ? String(p.variantIds[0]) : null;
                doAddToSlot(fallbackId, null, p.productPrice, null);
              } else if (selVarId) {
                doAddToSlot(selVarId, selVarTitle, selVarPrice, selVarCompare);
              } else {
                showVariantPicker(card, p, aBtn, [], function (variantId, variantTitle, variantPrice, variantCompareAtPrice) {
                  if (!variantId) return;
                  doAddToSlot(variantId, variantTitle, variantPrice, variantCompareAtPrice);
                });
              }
            }

            aBtn.addEventListener('click', function (e) { e.stopPropagation(); onProductClick(false); });
            card.addEventListener('click', function () { onProductClick(true); });
            card.addEventListener('keydown', function (e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onProductClick(true); }
            });
          })(product, addBtn);
        }


        productGrid.appendChild(card);
      });
    }

    var gridLoadToken = 0;

    // Load products for active slot then render grid
    function loadAndRenderGrid() {
      renderProductGrid(null);
      var previousOverlays = productSection.querySelectorAll('.cb-grid-overlay');
      previousOverlays.forEach(function (node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      });
      // Show inline spinner overlay on the product section
      var gridOverlay = document.createElement('div');
      gridOverlay.className = 'cb-grid-overlay';
      gridOverlay.innerHTML =
        '<span class="combo-builder-spinner" aria-hidden="true"></span>' +
        '<span class="cb-grid-overlay-text">Loading products\u2026</span>';
      productSection.appendChild(gridOverlay);
      var token = ++gridLoadToken;
      var startedAt = Date.now();
      var minVisibleMs = 220;

      getStepProducts(activeSlotIndex, function (err, products) {
        var elapsed = Date.now() - startedAt;
        var waitMs = Math.max(0, minVisibleMs - elapsed);
        setTimeout(function () {
          if (token !== gridLoadToken) return;
          if (gridOverlay.parentNode) gridOverlay.parentNode.removeChild(gridOverlay);
          renderProductGrid(err ? [] : products);
        }, waitMs);
      });
    }

    // ── Cart Action ──
    function resetSpecificCombo() {
      setTimeout(function () {
        for (var i = 0; i < slots.length; i++) slots[i] = null;
        activeSlotIndex = 0;
        if (giftInput) giftInput.value = '';
        setBoxCardPrice(
          box,
          isDynamicBundlePrice(box) ? null : (parseFloat(box.bundlePrice) || 0),
          ctx.currencySymbol
        );
        renderSlots();
        loadAndRenderGrid();
        updateCartButton();
      }, 0);
    }

    function doCart() {
      if (!areRequiredStepsFilled()) {
        var stepEls = slotSteps.querySelectorAll('.cb-slot-step');
        var missingRequired = getRequiredStepIndexes().filter(function (idx) { return !slots[idx]; });
        if (missingRequired.length === 0 && !slots.some(Boolean)) {
          missingRequired = [activeSlotIndex];
        }
        missingRequired.forEach(function (idx) {
          if (stepEls[idx * 2]) {
            stepEls[idx * 2].classList.add('cb-slot-step--error');
            setTimeout(function () { stepEls[idx * 2].classList.remove('cb-slot-step--error'); }, 700);
          }
        });
        return;
      }
      // Show spinner on cart buttons immediately
      [inlineCartBtn, stickyState.btn, mobileAddBtn].forEach(function (btn) {
        if (!btn) return;
        btn.disabled = true;
        if (btn === stickyState.btn) {
          btn.className = 'cb-sticky-btn cb-sticky-btn--loading';
        } else if (btn === mobileAddBtn) {
          btn.className = 'cb-mobile-add-btn cb-mobile-add-btn--loading';
        } else {
          btn.className = 'cb-inline-cart-btn cb-inline-cart-btn--loading';
        }
        btn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span class="cb-btn-label">Adding\u2026</span>';
      });
      showPageLoader('Adding products to cart\u2026');
      addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, inlineCartBtn, stickyState.btn, resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box), ctx.currencySymbol, ctx.apiBase, ctx.shop, resetSpecificCombo);
    }

    function doMobileCheckout() {
      if (!areRequiredStepsFilled()) { updateCartButton(); return; }
      mobileCheckoutBtn.disabled = true;
      mobileCheckoutBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span class="cb-btn-label">Processing\u2026</span>';
      showPageLoader('Processing\u2026');
      var rp = slots.map(function (p) {
        if (!p || (p.variantIds && p.variantIds.length > 0)) return Promise.resolve();
        if (!p.productHandle) return Promise.resolve();
        return new Promise(function (resolve) {
          fetchProductData(p.productHandle, function (err, productData) {
            if (!err && productData && productData.variants && productData.variants.length > 0) {
              p.variantIds = [String(productData.variants[0].id)];
            }
            resolve();
          });
        });
      });
      Promise.all(rp).then(function () {
        addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, mobileCheckoutBtn, null, 'Checkout \u2192', ctx.currencySymbol, ctx.apiBase, ctx.shop, null, '/checkout');
      });
    }

    inlineCartBtn.addEventListener('click', doCart);
    mobileAddBtn.addEventListener('click', doCart);
    mobileCheckoutBtn.addEventListener('click', doMobileCheckout);
    if (ctx.layoutMode === 'steps') {
      if (step3CartBtn) {
        step3CartBtn.addEventListener('click', function () {
          if (!areRequiredStepsFilled()) return;
          step3CartBtn.disabled = true;
          step3CartBtn.classList.add('cb-step3-cart-btn--loading');
          step3CartBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Adding\u2026</span>';
          if (step3CheckoutBtn) step3CheckoutBtn.disabled = true;
          showPageLoader('Adding products to cart\u2026');
          addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, inlineCartBtn, stickyState.btn, resolveAddToCartLabel(ctx.settings, ctx.cartBtnLabel, box), ctx.currencySymbol, ctx.apiBase, ctx.shop, resetSpecificCombo);
        });
      }
      if (step3CheckoutBtn) {
        step3CheckoutBtn.addEventListener('click', function () {
          if (!areRequiredStepsFilled()) return;
          step3CheckoutBtn.disabled = true;
          step3CheckoutBtn.classList.add('cb-step3-checkout-btn--loading');
          step3CheckoutBtn.innerHTML = '<span class="cb-btn-spinner" aria-hidden="true"></span><span>Checkout\u2026</span>';
          if (step3CartBtn) step3CartBtn.disabled = true;
          showPageLoader('Processing your order\u2026');
          addToCart(box, slots, sessionId, giftInput ? giftInput.value : null, null, null, 'Checkout \u2192', ctx.currencySymbol, ctx.apiBase, ctx.shop, resetSpecificCombo, '/checkout');
        });
      }
    }
    removeStickyFooter(ctx);
    if (ctx.enableStickyCart !== false) {
      createStickyFooter(box, ctx, doCart);
    }

    loadAndRenderGrid();
    updateCartButton();
  }

  function cleanupComboCartPresentation(root) {
    if (!root) return;

    var comboLineItems = [];
    var propNodes = root.querySelectorAll('li, p, dd, div, span');
    propNodes.forEach(function (node) {
      if (node.children && node.children.length > 0) return;

      var text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return;
      var lower = text.toLowerCase();

      // Safety cleanup for previously-created visible properties.
      if (
        lower.indexOf('bundle:') === 0 ||
        lower.indexOf('combo price:') === 0 ||
        lower.indexOf('selected items total:') === 0 ||
        lower.indexOf('mrp:') === 0
      ) {
        node.style.display = 'none';
      }

      if (lower.indexOf('item 1:') === 0 || lower.indexOf('item1:') === 0) {
        var lineItem = node.closest('[data-cart-item], .cart-item, .drawer__cart-item, .cart-drawer-item, .line-item, tr, li');
        if (lineItem && comboLineItems.indexOf(lineItem) === -1) {
          comboLineItems.push(lineItem);
        }
      }
    });

    enhanceComboCartPresentation(comboLineItems);

    comboLineItems.forEach(function (lineItem) {
      lineItem.classList.add('cb-combo-line-item');
    });

    if (!document.getElementById('cb-combo-cart-hide-qty')) {
      var style = document.createElement('style');
      style.id = 'cb-combo-cart-hide-qty';
      style.textContent =
        '.cb-combo-line-item quantity-input,' +
        '.cb-combo-line-item .quantity,' +
        '.cb-combo-line-item .cart-item__quantity,' +
        '.cb-combo-line-item .cart-item__quantity-wrapper,' +
        '.cb-combo-line-item .cart-drawer__quantity,' +
        '.cb-combo-line-item .quantity-popover-container,' +
        '.cb-combo-line-item .js-qty,' +
        '.cb-combo-line-item .js-qty__wrapper,' +
        '.cb-combo-line-item [data-quantity-selector],' +
        '.cb-combo-line-item button.quantity__button,' +
        '.cb-combo-line-item [name=\"plus\"],' +
        '.cb-combo-line-item [name=\"minus\"],' +
        '.cb-combo-line-item input[name=\"updates[]\"],' +
        '.cb-combo-line-item input[name^=\"updates[\"]' +
        '{display:none !important;}';
      document.head.appendChild(style);
    }
  }

  function getCartItemProperties(item) {
    if (!item) return {};
    var props = item.properties || item.line_level_properties || {};
    if (Array.isArray(props)) {
      var mapped = {};
      props.forEach(function (entry) {
        if (!entry) return;
        var key = entry.name || entry.key;
        if (!key) return;
        mapped[key] = entry.value;
      });
      return mapped;
    }
    return props && typeof props === 'object' ? props : {};
  }

  function getComboCartSelectionFromItem(item) {
    var props = getCartItemProperties(item);
    var selections = [];
    Object.keys(props).forEach(function (key) {
      var match = key.match(/^Item\s+(\d+)$/i);
      if (!match) return;
      var index = parseInt(match[1], 10);
      var title = props[key];
      if (!index || title == null || String(title).trim() === '') return;
      selections.push({
        index: index,
        title: String(title).trim(),
        image: props['_item_' + index + '_image'] || props['_item_' + index + '_image_url'] || '',
      });
    });
    return selections.sort(function (a, b) { return a.index - b.index; });
  }

  function getComboCartLineImageFromItem(item) {
    var props = getCartItemProperties(item);
    return (
      props._combo_bundle_image ||
      props._combo_box_image ||
      props._combo_image ||
      (item && item.image) ||
      (item && item.featured_image && item.featured_image.url) ||
      ''
    );
  }

  function enhanceComboCartPresentation(comboLineItems) {
    if (!Array.isArray(comboLineItems) || comboLineItems.length === 0 || !window.fetch) return;

    fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cart) {
        if (!cart || !Array.isArray(cart.items)) return;
        var comboCartItems = cart.items
          .map(function (item) {
            return {
              item: item,
              selections: getComboCartSelectionFromItem(item),
              bundleImage: getComboCartLineImageFromItem(item),
            };
          })
          .filter(function (entry) { return entry.selections.length > 0; });

        comboLineItems.forEach(function (lineItem, index) {
          var entry = comboCartItems[index] || comboCartItems[0];
          if (!entry || !entry.selections.length) return;
          renderComboCartLineImage(lineItem, entry.bundleImage, entry.item && (entry.item.product_title || entry.item.title));
          renderComboCartSelectionList(lineItem, entry.selections);
        });
      })
      .catch(function () {});
  }

  function renderComboCartLineImage(lineItem, imageSrc, imageAlt) {
    if (!lineItem || !imageSrc) return;

    var src = String(imageSrc).trim();
    if (!src) return;

    var existingImg = lineItem.querySelector(
      '.cart-item__media img:not(.cb-cart-selected-product__image),' +
      '.cart-drawer-item__media img:not(.cb-cart-selected-product__image),' +
      '.line-item__media img:not(.cb-cart-selected-product__image),' +
      'img.cart-item__image:not(.cb-cart-selected-product__image)'
    );

    if (existingImg) {
      existingImg.src = src;
      existingImg.alt = imageAlt || existingImg.alt || 'Bundle product image';
      existingImg.loading = existingImg.loading || 'lazy';
      existingImg.style.display = '';
      return;
    }

    var existingFallback = lineItem.querySelector('.cb-cart-box-image-wrap');
    if (existingFallback && existingFallback.parentNode) existingFallback.parentNode.removeChild(existingFallback);

    var wrap = document.createElement('div');
    wrap.className = 'cb-cart-box-image-wrap';

    var img = document.createElement('img');
    img.className = 'cb-cart-box-image';
    img.src = src;
    img.alt = imageAlt || 'Bundle product image';
    img.loading = 'lazy';
    wrap.appendChild(img);

    var media = lineItem.querySelector(
      '.cart-item__media,' +
      '.cart-drawer-item__media,' +
      '.line-item__media,' +
      '.cart-item__image-container'
    );

    if (media) {
      media.appendChild(wrap);
      return;
    }

    lineItem.insertBefore(wrap, lineItem.firstChild);
  }

  function renderComboCartSelectionList(lineItem, selections) {
    if (!lineItem || !Array.isArray(selections) || !selections.length) return;
    var existing = lineItem.querySelector('.cb-cart-selected-products');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var list = document.createElement('div');
    list.className = 'cb-cart-selected-products';

    selections.forEach(function (selection) {
      var row = document.createElement('div');
      row.className = 'cb-cart-selected-product';

      if (selection.image) {
        var img = document.createElement('img');
        img.className = 'cb-cart-selected-product__image';
        img.src = selection.image;
        img.alt = selection.title;
        img.loading = 'lazy';
        row.appendChild(img);
      }

      var title = document.createElement('span');
      title.className = 'cb-cart-selected-product__title';
      title.textContent = 'Item ' + selection.index + ': ' + selection.title;
      row.appendChild(title);
      list.appendChild(row);
    });

    var anchor = lineItem.querySelector('.product-option, .cart-item__details, .cart-drawer-item__details, .line-item__properties, dl, ul') || lineItem;
    if (anchor && anchor.parentNode && anchor !== lineItem) {
      anchor.parentNode.insertBefore(list, anchor.nextSibling);
    } else {
      lineItem.appendChild(list);
    }
  }

  function waitForComboCartPresentation(expectedItemsCount) {
    return new Promise(function (resolve) {
      var attempts = 0;
      var minimumVisibleItems = expectedItemsCount && expectedItemsCount > 0 ? expectedItemsCount : 1;

      function check() {
        cleanupComboCartPresentation(document);

        var comboLine = document.querySelector('.cb-combo-line-item');
        var visibleItemCount = 0;

        if (comboLine) {
          comboLine.querySelectorAll('li, p, dd, div, span').forEach(function (node) {
            if (node.children && node.children.length > 0) return;
            var text = (node.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
            if (/^item\s*\d+\s*:/.test(text)) visibleItemCount++;
          });
        }

        attempts++;
        if ((comboLine && visibleItemCount >= minimumVisibleItems) || attempts >= 12) {
          resolve();
          return;
        }

        setTimeout(check, 120);
      }

      setTimeout(check, 60);
    });
  }

  function isCartDrawerOpen() {
    var webComponentDrawer = document.querySelector('cart-drawer');
    if (webComponentDrawer) {
      var drawerDetails = webComponentDrawer.querySelector('details');
      if (drawerDetails && drawerDetails.hasAttribute('open')) return true;
      if (webComponentDrawer.getAttribute('aria-hidden') === 'false') return true;
      if (
        webComponentDrawer.classList.contains('active') ||
        webComponentDrawer.classList.contains('is-active') ||
        webComponentDrawer.classList.contains('open') ||
        webComponentDrawer.classList.contains('is-open')
      ) return true;
    }

    var genericDrawer = document.querySelector(
      '#CartDrawer, .cart-drawer, [data-cart-drawer], #AjaxCartDrawer, #mini-cart, .mini-cart-drawer'
    );
    if (!genericDrawer) return false;
    if (genericDrawer.getAttribute('aria-hidden') === 'false') return true;
    if (
      genericDrawer.classList.contains('active') ||
      genericDrawer.classList.contains('is-active') ||
      genericDrawer.classList.contains('open') ||
      genericDrawer.classList.contains('is-open')
    ) return true;
    return false;
  }

  function releasePageScrollIfDrawerClosed() {
    if (isCartDrawerOpen()) return;
    document.body.classList.remove('overflow-hidden');
    document.documentElement.classList.remove('overflow-hidden');
  }

  function bindDrawerScrollRecovery() {
    if (_drawerScrollRecoveryBound) return;
    _drawerScrollRecoveryBound = true;

    function scheduleUnlockCheck() {
      setTimeout(releasePageScrollIfDrawerClosed, 40);
      setTimeout(releasePageScrollIfDrawerClosed, 220);
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') scheduleUnlockCheck();
    });

    document.addEventListener('click', function (e) {
      var target = e.target;
      if (!target || !target.closest) return;
      if (
        target.closest('#CartDrawer-Overlay, .cart-drawer__overlay') ||
        target.closest('.drawer__close, .cart-drawer__close, [data-drawer-close], [data-cart-close]') ||
        target.closest('summary[aria-label*="Close"], button[aria-label*="Close"]')
      ) {
        scheduleUnlockCheck();
      }
    }, true);

    document.addEventListener('cart:refresh', scheduleUnlockCheck);
    document.addEventListener('cart:updated', scheduleUnlockCheck);
  }

  // ─── Add to Cart ──────────────────────────────────────────────────────────────

  function addToCart(box, slots, sessionId, giftMessage, inlineBtn, stickyBtn, readyLabel, currencySymbol, apiBase, shop, onSuccess, checkoutUrl) {
    var resolvedReadyLabel = readyLabel || 'Add To Cart';
    var resolvedCurrencySymbol = currencySymbol || "$";
    var resolvedApiBase = String(apiBase || DEFAULT_API_BASE || '').replace(/\/+$/, '');
    var sectionIds = ['cart-drawer', 'cart-icon-bubble', 'cart-notification-button', 'cart-notification'];
    var selectedItemsCount = slots.filter(Boolean).length;
    var normalizedGiftMessage = '';
    if (typeof giftMessage === 'string') {
      normalizedGiftMessage = giftMessage.trim();
      if (normalizedGiftMessage.length > 100) {
        normalizedGiftMessage = normalizedGiftMessage.slice(0, 100);
      }
    }

    function setBtnContent(btn, state, text) {
      if (!btn) return;
      btn.innerHTML = '';

      if (state === 'loading') {
        var spinner = document.createElement('span');
        spinner.className = 'cb-btn-spinner';
        spinner.setAttribute('aria-hidden', 'true');
        btn.appendChild(spinner);
      }

      var label = document.createElement('span');
      label.className = 'cb-btn-label';
      label.textContent = text;
      btn.appendChild(label);
    }

    function setBtns(state, text) {
      var displayText = state === 'loading'
        ? 'Adding...'
        : state === 'success'
          ? 'Added to Cart!'
          : text;

      [inlineBtn, stickyBtn].forEach(function (btn) {
        if (!btn) return;
        btn.disabled = state !== 'ready';
        btn.className = btn === stickyBtn ? 'cb-sticky-btn' : 'cb-inline-cart-btn';
        if (state === 'loading') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--loading' : 'cb-inline-cart-btn--loading');
        } else if (state === 'success') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--success' : 'cb-inline-cart-btn--success');
        } else if (state === 'error') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--error' : 'cb-inline-cart-btn--error');
          btn.disabled = false;
        } else if (state === 'ready') {
          btn.classList.add(btn === stickyBtn ? 'cb-sticky-btn--ready' : 'cb-inline-cart-btn--ready');
        }
        setBtnContent(btn, state, displayText);
      });
    }

    setBtns('loading', 'Adding…');

    showPageLoader('Adding products to cart…');

    function postCartItems(items) {
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          items: items,
          sections: sectionIds,
          sections_url: window.location.pathname + window.location.search,
        }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          if (__CB_DEBUG__) console.error('[ComboBuilder] Cart 422 details:', d);
          throw new Error(d.description || d.message || 'Cart error');
        });
        return r.json();
      });
    }

    function fetchCartState() {
      return fetch('/cart.js', {
        headers: { 'Accept': 'application/json' },
      }).then(function (r) {
        if (!r.ok) throw new Error('Failed to load cart');
        return r.json();
      });
    }

    function postCartChange(payload) {
      var body = {
        line: payload.line,
        quantity: payload.quantity,
        sections: sectionIds,
        sections_url: window.location.pathname + window.location.search,
      };
      if (payload.properties) body.properties = payload.properties;

      return fetch('/cart/change.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(body),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          throw new Error((d && (d.description || d.message || d.error)) || 'Cart change error');
        });
        return r.json();
      });
    }

    function postCartAttributes(attributes) {
      return fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          attributes: attributes || {},
          sections: sectionIds,
          sections_url: window.location.pathname + window.location.search,
        }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          throw new Error((d && (d.description || d.message || d.error)) || 'Cart update error');
        });
        return r.json();
      });
    }

    function upsertAdditionalSettingAttributes(nextAttributes) {
      return fetchCartState().then(function (cart) {
        var current = (cart && cart.attributes && typeof cart.attributes === 'object') ? cart.attributes : {};
        var merged = {};
        Object.keys(current).forEach(function (key) {
          merged[key] = current[key];
        });
        Object.keys(nextAttributes || {}).forEach(function (key) {
          merged[key] = nextAttributes[key];
        });
        return postCartAttributes(merged);
      });
    }

    function findExistingComboLine(cart, targetVariantId) {
      if (!cart || !Array.isArray(cart.items)) return null;
      var normalizedTargetVariantId = normalizeVariantId(targetVariantId);

      for (var i = 0; i < cart.items.length; i++) {
        var item = cart.items[i] || {};
        var itemVariantId = normalizeVariantId(item && (item.id != null ? item.id : item.variant_id));
        if (normalizedTargetVariantId && itemVariantId && normalizedTargetVariantId === itemVariantId) {
          return { line: i + 1, item: item };
        }
      }
      return null;
    }

    function normalizeVariantId(rawId) {
      if (rawId == null) return null;
      var id = String(rawId);
      return id.indexOf('/') !== -1 ? id.split('/').pop() : id;
    }

    function upsertComboLine(item) {
      return fetchCartState().then(function (cart) {
        var existing = findExistingComboLine(cart, item && item.id);
        if (!existing) {
          return postCartItems([item]);
        }

        var existingVariantId = normalizeVariantId(
          existing.item && (existing.item.id != null ? existing.item.id : existing.item.variant_id)
        );
        var targetVariantId = normalizeVariantId(item.id);

        // If variant changed, replace old line item so the cart uses the current combo variant.
        if (existingVariantId && targetVariantId && existingVariantId !== targetVariantId) {
          return postCartChange({ line: existing.line, quantity: 0 }).then(function () {
            return postCartItems([item]);
          });
        }

        // Same combo box exists in cart: overwrite its properties instead of adding duplicate.
        return postCartChange({
          line: existing.line,
          quantity: 1,
          properties: item.properties || {},
        });
      });
    }

    function resolveBundleVariantId() {
      if (!box || !box.id || !shop || !box.shopifyProductId || !resolvedApiBase) {
        return Promise.reject(new Error('Cannot resolve combo variant'));
      }

      return fetch(
        resolvedApiBase +
          '/api/storefront/boxes/' +
          encodeURIComponent(String(box.id)) +
          '/variant?shop=' +
          encodeURIComponent(shop),
        { headers: { 'Accept': 'application/json' } }
      )
        .then(function (r) {
          if (!r.ok) throw new Error('Variant repair failed');
          return r.json();
        })
        .then(function (data) {
          if (!data || !data.shopifyVariantId) {
            throw new Error('Variant repair failed');
          }
          box.shopifyVariantId = String(data.shopifyVariantId);
          return box.shopifyVariantId;
        });
    }

    function syncThemeCartUI(cartResponse) {
      var sections = cartResponse && cartResponse.sections;
      var drawerExist = document.querySelector('cart-drawer');
      var notifExist = document.querySelector('cart-notification');
      var renderedByTheme = false;

      if (drawerExist) drawerExist.classList.remove('is-empty');
      document.querySelectorAll('#CartDrawer, .cart-drawer, [data-cart-drawer]').forEach(function (el) {
        el.classList.remove('is-empty');
      });

      if (sections && drawerExist && typeof drawerExist.renderContents === 'function') {
        try {
          drawerExist.renderContents(cartResponse);
          renderedByTheme = true;
        } catch (e) {
          if (__CB_DEBUG__) console.warn('[ComboBuilder] cart-drawer.renderContents() failed:', e);
        }
      }

      if (sections && notifExist && typeof notifExist.renderContents === 'function') {
        try {
          notifExist.renderContents(cartResponse);
          renderedByTheme = true;
        } catch (e) {
          if (__CB_DEBUG__) console.warn('[ComboBuilder] cart-notification.renderContents() failed:', e);
        }
      }

      if (!sections || renderedByTheme) return;

      var parser = new DOMParser();
      Object.keys(sections).forEach(function (key) {
        var markup = sections[key];
        if (!markup) return;
        var doc = parser.parseFromString(markup, 'text/html');

        if (key === 'cart-drawer') {
          var drawerSectionExist = document.querySelector('#shopify-section-cart-drawer');
          var drawerSectionFresh = doc.querySelector('#shopify-section-cart-drawer');
          if (drawerSectionExist && drawerSectionFresh) {
            drawerSectionExist.innerHTML = drawerSectionFresh.innerHTML;
          } else {
            var drawerFresh = doc.querySelector('cart-drawer');
            if (drawerExist && drawerFresh) drawerExist.innerHTML = drawerFresh.innerHTML;
          }
        }

        if (key === 'cart-notification') {
          var notifSectionExist = document.querySelector('#shopify-section-cart-notification');
          var notifSectionFresh = doc.querySelector('#shopify-section-cart-notification');
          if (notifSectionExist && notifSectionFresh) {
            notifSectionExist.innerHTML = notifSectionFresh.innerHTML;
          } else {
            var notifFresh = doc.querySelector('cart-notification');
            if (notifExist && notifFresh) notifExist.innerHTML = notifFresh.innerHTML;
          }
        }

        if (key === 'cart-icon-bubble') {
          var bubbleSectionExist = document.querySelector('#shopify-section-cart-icon-bubble');
          var bubbleSectionFresh = doc.querySelector('#shopify-section-cart-icon-bubble');
          if (bubbleSectionExist && bubbleSectionFresh) {
            bubbleSectionExist.innerHTML = bubbleSectionFresh.innerHTML;
          }

          var countFresh = doc.querySelector('.cart-count-bubble');
          if (countFresh) {
            document.querySelectorAll('.cart-count-bubble').forEach(function (el) {
              el.innerHTML = countFresh.innerHTML;
            });
          }
        }
      });
    }

    var items = [];
    var additionalSettingAttributes = {};
    var isDynamic = String(box.bundlePriceType || 'manual') === 'dynamic';

    if (box.shopifyVariantId) {
      var totalMrp = 0;
      slots.forEach(function (p) {
        if (p && p.productPrice != null && parseFloat(p.productPrice) > 0) {
          totalMrp += parseFloat(p.productPrice);
        }
      });

      // For dynamic mode, effective cart price = sum of selected products minus any discount.
      // For manual mode, it is the fixed bundlePrice set by the merchant.
      var dynamicBreakdown = getComboDiscountBreakdown(totalMrp, getBoxDiscountConfig(box), slots);
      var effectivePrice = isDynamic ? dynamicBreakdown.discountedTotal : (parseFloat(box.bundlePrice) || 0);

      var bundleProps = {};
      var comboBoxId = box && box.id != null ? String(box.id) : '';
      var comboProductId = box && box.shopifyProductId != null ? String(box.shopifyProductId) : comboBoxId;
      var bundleImageSrc = getBoxCardBundleImageSrc(box, { apiBase: resolvedApiBase, shop: shop });

      slots.forEach(function (p, idx) {
        if (p) {
          var label = p.productTitle || ('Item ' + (idx + 1));
          if (p.selectedVariantTitle) label += ' (' + p.selectedVariantTitle + ')';
          bundleProps['Item ' + (idx + 1)] = label;
          bundleProps['_item_' + (idx + 1)] = label;
          if (p.productImageUrl) {
            bundleProps['_item_' + (idx + 1) + '_image'] = p.productImageUrl;
          }
        }
      });
      bundleProps['_combo_selected_count'] = String(selectedItemsCount);
      if (bundleImageSrc && !/^(data:|blob:)/i.test(String(bundleImageSrc))) {
        bundleProps['_combo_bundle_image'] = bundleImageSrc;
      }
      // Identifies this line as the qualifying Bundle Product for a specific
      // Box (+ pack, for Multiple Box), so the Free Gift sync below — and any
      // later reconciliation pass — can resolve/attach the correct gift and
      // never mixes up boxes/packs that happen to share the same variant.
      bundleProps['_bundle_box_id'] = comboBoxId;
      bundleProps['_bundle_pack_key'] = box && box._packKey ? String(box._packKey) : '';

      var shouldIncludeGiftDetails = !!(box && box.isGiftBox && box.giftMessageEnabled);

      items.push({ id: box.shopifyVariantId, quantity: 1, properties: bundleProps });

      additionalSettingAttributes = {};
      if (shouldIncludeGiftDetails) {
        additionalSettingAttributes['Gift Wrapper'] = 'Gift Packing';
        if (normalizedGiftMessage) additionalSettingAttributes['Gift Message'] = normalizedGiftMessage;
        additionalSettingAttributes['Build Box'] = 'MixBox – Box & Bundle Builder';
      }
    } else {
      hidePageLoader(true);
      setBtns('error', 'MixBox – Box & Bundle Builder not linked');
      setTimeout(function () { setBtns('ready', resolvedReadyLabel); }, 2500);
      return;
    }

    // For dynamic pricing: keep variant price at the selected products total (pre-discount),
    // so Shopify automatic discounts can allocate discount lines visible in Admin/checkout.
    function updateDynamicPriceThenCart() {
      var dynamicTotal = 0;
      slots.forEach(function (p) {
        if (p && p.productPrice != null && parseFloat(p.productPrice) > 0) {
          dynamicTotal += parseFloat(p.productPrice);
        }
      });
      if (dynamicTotal <= 0) {
        return Promise.reject(new Error('No product prices available for dynamic pricing'));
      }

      var updateUrl = resolvedApiBase +
        '/api/storefront/boxes/' + encodeURIComponent(String(box.id)) +
        '/update-price?shop=' + encodeURIComponent(shop);

      return fetch(updateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ price: dynamicTotal }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          throw new Error(d.error || 'Price update failed');
        });
        return r.json();
      }).then(function () {
        return upsertAdditionalSettingAttributes(additionalSettingAttributes).then(function () {
          return upsertComboLine(items[0]);
        });
      });
    }

    // For manual mode: call the variant endpoint first so the product is guaranteed
    // to be ACTIVE + published on the Online Store before /cart/add.js is called.
    // For dynamic mode: updateDynamicPriceThenCart already activates + publishes.
    function ensurePublishedThenCart() {
      return resolveBundleVariantId()
        .then(function (variantId) {
          if (__CB_DEBUG__) console.log('[ComboBuilder] resolveBundleVariantId resolved:', variantId);
          items[0].id = variantId;
        })
        .catch(function (e) {
          if (__CB_DEBUG__) console.warn('[ComboBuilder] resolveBundleVariantId failed (using stored id):', e && e.message, '| stored shopifyVariantId:', box.shopifyVariantId, '| box.shopifyProductId:', box.shopifyProductId);
        })
        // Brief pause so Shopify can propagate the publish/activate from the variant endpoint
        .then(function () { return new Promise(function (r) { setTimeout(r, 800); }); })
        .then(function () {
          return upsertAdditionalSettingAttributes(additionalSettingAttributes).then(function () {
            return upsertComboLine(items[0]);
          });
        });
    }

    var cartPromise = isDynamic ? updateDynamicPriceThenCart() : ensurePublishedThenCart();

    cartPromise
      .catch(function (err) {
        var msg = err && err.message ? String(err.message).toLowerCase() : '';
        if (msg.indexOf('cannot find variant') === -1) throw err;

        // Repair: fetch fresh variant ID (endpoint also re-activates + re-publishes product)
        return resolveBundleVariantId().then(function (variantId) {
          items[0].id = variantId;
          // 1500ms delay so Shopify can propagate the publication change
          return new Promise(function (resolve) { setTimeout(resolve, 1500); })
            .then(function () {
              return isDynamic ? updateDynamicPriceThenCart() : upsertComboLine(items[0]);
            });
        });
      })
      .then(function (cartResponse) {
        setBtns('success', 'Added to Cart! ✓');

        // cart/add.js returns sections HTML when requested — use it to refresh drawer content
        syncThemeCartUI(cartResponse);
        cleanupComboCartPresentation(document);

        // This box's own Free Gift Product (if configured) isn't added by Shopify's
        // automatic BXGY discount — that only makes an existing gift line free.
        // reconcileFreeGifts() finds this bundle line via the _bundle_box_id/
        // _bundle_pack_key properties just stamped on it and adds/adjusts the gift line.
        scheduleGiftReconcile(shop, resolvedApiBase, 0);

        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));

        if (checkoutUrl) {
          hidePageLoader(true);
          if (typeof onSuccess === 'function') onSuccess();
          setTimeout(function () { window.location.href = checkoutUrl; }, 600);
          return;
        }

        var opened = tryOpenThemeCartDrawer();
        if (!opened) {
          hidePageLoader(true);
          if (typeof onSuccess === 'function') onSuccess();
          setTimeout(function () { window.location.href = '/cart'; }, 1200);
          return;
        }

        setBtns('loading', 'Adding...');
        return waitForComboCartPresentation(selectedItemsCount).then(function () {
          hidePageLoader(true);
          if (typeof onSuccess === 'function') onSuccess();
          setBtns('success', 'Added to Cart! âœ”');
        });
      })
      .catch(function (err) {
        hidePageLoader(true);
        if (__CB_DEBUG__) console.error('[ComboBuilder] Add to cart error:', err);
        setBtns('error', 'Error — Try Again');
        setTimeout(function () { setBtns('ready', resolvedReadyLabel); }, 2500);
      });
  }

  // Combines every completed Pack's selections (see renderPackPicker's
  // sequential Step flow) into ONE Add to Cart/Checkout action: one cart line
  // per Pack — all sharing the Multiple Box's own variant, distinguished by
  // their own _bundle_pack_key/_item_N properties — submitted together. Mirrors
  // addToCart()'s single-pack item/pricing/cart-refresh logic (that function
  // can't be reused directly here since it assumes exactly one Pack's slots).
  function addPackStepsToCart(box, packEntries, sessionId, giftMessage, ctx, action, onSuccess, onError) {
    var resolvedApiBase = String((ctx && ctx.apiBase) || DEFAULT_API_BASE || '').replace(/\/+$/, '');
    var shop = ctx && ctx.shop;
    var sectionIds = ['cart-drawer', 'cart-icon-bubble', 'cart-notification-button', 'cart-notification'];
    var normalizedGiftMessage = typeof giftMessage === 'string' ? giftMessage.trim().slice(0, 100) : '';

    function postCartItems(items) {
      return fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          items: items,
          sections: sectionIds,
          sections_url: window.location.pathname + window.location.search,
        }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          mbError('cart rejected Multiple Box add', d);
          throw new Error(d.description || d.message || 'Cart error');
        });
        return r.json();
      });
    }

    function fetchCartState() {
      return fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
        .then(function (r) { if (!r.ok) throw new Error('Failed to load cart'); return r.json(); });
    }

    function postCartAttributes(attributes) {
      return fetch('/cart/update.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({
          attributes: attributes || {},
          sections: sectionIds,
          sections_url: window.location.pathname + window.location.search,
        }),
      }).then(function (r) {
        if (!r.ok) return r.json().then(function (d) {
          throw new Error((d && (d.description || d.message || d.error)) || 'Cart update error');
        });
        return r.json();
      });
    }

    var comboBoxId = box && box.id != null ? String(box.id) : '';
    var bundleImageSrc = getBoxCardBundleImageSrc(box, { apiBase: resolvedApiBase, shop: shop });
    var discountConfig = getBoxDiscountConfig(box);
    var isDynamic = String((discountConfig && discountConfig.bundlePriceType) || box.bundlePriceType || 'manual') === 'dynamic';
    var shouldIncludeGiftDetails = !!(box && box.isGiftBox && box.giftMessageEnabled);

    var bundleProps = {};
    var selectedCount = 0;
    var packKeys = [];

    packEntries.forEach(function (entry, packIdx) {
      var slots = entry.slots || [];
      if (entry.packKey) packKeys.push(String(entry.packKey));

      slots.forEach(function (p, idx) {
        if (p) {
          selectedCount++;
          var label = p.productTitle || ('Item ' + selectedCount);
          if (p.selectedVariantTitle) label += ' (' + p.selectedVariantTitle + ')';
          bundleProps['Item ' + selectedCount] = label;
          bundleProps['_item_' + selectedCount] = label;
          if (p.productImageUrl) bundleProps['_item_' + selectedCount + '_image'] = p.productImageUrl;

          bundleProps['_pack_' + (packIdx + 1) + '_item_' + (idx + 1)] = label;
        }
      });
    });

    bundleProps['_combo_selected_count'] = String(selectedCount);
    if (bundleImageSrc && !/^(data:|blob:)/i.test(String(bundleImageSrc))) {
      bundleProps['_combo_bundle_image'] = bundleImageSrc;
    }
    bundleProps['_bundle_box_id'] = comboBoxId;
    bundleProps['_bundle_pack_key'] = '';
    if (packKeys.length) bundleProps['_bundle_pack_keys'] = packKeys.join(',');

    var items = [{ id: box.shopifyVariantId, quantity: 1, properties: bundleProps }];

    var additionalSettingAttributes = {};
    if (shouldIncludeGiftDetails) {
      additionalSettingAttributes['Gift Wrapper'] = 'Gift Packing';
      if (normalizedGiftMessage) additionalSettingAttributes['Gift Message'] = normalizedGiftMessage;
      additionalSettingAttributes['Build Box'] = 'MixBox – Box & Bundle Builder';
    }

    function addItems() {
      if (!shouldIncludeGiftDetails) return postCartItems(items);
      return fetchCartState().then(function (cart) {
        var current = (cart && cart.attributes && typeof cart.attributes === 'object') ? cart.attributes : {};
        var merged = {};
        Object.keys(current).forEach(function (key) { merged[key] = current[key]; });
        Object.keys(additionalSettingAttributes).forEach(function (key) { merged[key] = additionalSettingAttributes[key]; });
        return postCartAttributes(merged).then(function () { return postCartItems(items); });
      });
    }

    showPageLoader('Adding products to cart…');

    var cartPromise;
    if (isDynamic) {
      // Same rule as addToCart()'s updateDynamicPriceThenCart, extended across
      // every Pack being submitted together: variant price = sum of every
      // selected product across all Packs (pre-discount), so Shopify's
      // automatic discount can still allocate a visible discount line.
      var dynamicTotal = 0;
      packEntries.forEach(function (entry) {
        (entry.slots || []).forEach(function (p) {
          if (p && p.productPrice != null && parseFloat(p.productPrice) > 0) {
            dynamicTotal += parseFloat(p.productPrice);
          }
        });
      });
      if (dynamicTotal <= 0) {
        cartPromise = Promise.reject(new Error('No product prices available for dynamic pricing'));
      } else {
        var updateUrl = resolvedApiBase +
          '/api/storefront/boxes/' + encodeURIComponent(String(box.id)) +
          '/update-price?shop=' + encodeURIComponent(shop);
        cartPromise = fetch(updateUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({ price: dynamicTotal }),
        }).then(function (r) {
          if (!r.ok) return r.json().then(function (d) { throw new Error(d.error || 'Price update failed'); });
          return r.json();
        }).then(addItems);
      }
    } else {
      cartPromise = addItems();
    }

    cartPromise
      .then(function (cartResponse) {
        hidePageLoader(true);
        try { syncThemeCartUIStandalone(cartResponse); } catch (e) { mbError('cart UI refresh failed after Multiple Box add', e); }
        scheduleGiftReconcile(shop, resolvedApiBase, 0);
        document.dispatchEvent(new CustomEvent('cart:refresh', { bubbles: true }));
        document.dispatchEvent(new CustomEvent('cart:updated', { bubbles: true }));
        if (typeof onSuccess === 'function') onSuccess();

        if (action === 'checkout') {
          window.location.href = '/checkout';
          return;
        }
        var opened = tryOpenThemeCartDrawer();
        if (!opened) {
          window.location.href = '/cart';
        }
      })
      .catch(function (err) {
        hidePageLoader(true);
        mbError('add to cart error', err);
        if (typeof onError === 'function') {
          onError(err);
        } else {
          window.alert('Something went wrong adding your bundle to the cart. Please try again.');
        }
      });
  }

  function tryOpenThemeCartDrawer() {
    var opened = false;

    var openEvents = [
      'cart:open',
      'drawer:open',
      'cart-drawer:open',
      'theme:cart:open',
      'cartdrawer:open',
    ];

    openEvents.forEach(function (eventName) {
      try {
        document.dispatchEvent(new CustomEvent(eventName, { bubbles: true }));
      } catch (e) {
        if (__CB_DEBUG__) console.warn('[ComboBuilder] Failed to dispatch drawer event', eventName, e);
      }
    });

    var webComponentDrawer = document.querySelector('cart-drawer');
    if (webComponentDrawer) {
      webComponentDrawer.classList.remove('is-empty');

      if (typeof webComponentDrawer.open === 'function') {
        try {
          webComponentDrawer.open();
          opened = true;
        } catch (e) {
          if (__CB_DEBUG__) console.warn('[ComboBuilder] cart-drawer.open() failed:', e);
        }
      }

      var drawerDetails = webComponentDrawer.querySelector('details');
      if (drawerDetails) {
        drawerDetails.setAttribute('open', 'open');
        opened = true;
      }

      webComponentDrawer.classList.add('active');
      webComponentDrawer.setAttribute('aria-hidden', 'false');

      var drawerOverlay = webComponentDrawer.querySelector('#CartDrawer-Overlay, .cart-drawer__overlay');
      if (drawerOverlay) drawerOverlay.classList.add('active');

      var drawerDetailsForToggle = webComponentDrawer.querySelector('details');
      if (drawerDetailsForToggle && !drawerDetailsForToggle.__cbToggleBound) {
        drawerDetailsForToggle.__cbToggleBound = true;
        drawerDetailsForToggle.addEventListener('toggle', function () {
          setTimeout(releasePageScrollIfDrawerClosed, 20);
        });
      }
    }

    var cartTrigger = !opened ? document.querySelector(
      '[data-cart-drawer-trigger], [aria-controls="CartDrawer"], button[name="cart"], .header__icon--cart'
    ) : null;
    if (cartTrigger && !opened) {
      try {
        cartTrigger.click();
        opened = true;
      } catch (e) {
        if (__CB_DEBUG__) console.warn('[ComboBuilder] Cart trigger click failed:', e);
      }
    }

    var genericDrawer = !opened ? document.querySelector(
      '#CartDrawer, .cart-drawer, [data-cart-drawer], #AjaxCartDrawer, #mini-cart, .mini-cart-drawer'
    ) : null;
    if (genericDrawer) {
      genericDrawer.classList.remove('is-empty');
      genericDrawer.classList.add('active', 'is-active', 'open', 'is-open');
      genericDrawer.setAttribute('aria-hidden', 'false');
      opened = true;
    }

    setTimeout(function () { cleanupComboCartPresentation(document); }, 50);
    bindDrawerScrollRecovery();
    setTimeout(releasePageScrollIfDrawerClosed, 250);
    return opened;
  }

  // ─── Root Recovery ────────────────────────────────────────────────────────────
  //
  // ROOT CAUSE of "bundle appears, then disappears": every `.combo-builder-root`
  // (the manual "Build Your Box" block AND the auto-embed) is a real Liquid-
  // rendered <div> that carries its own full config as `data-*` attributes, and
  // is populated by a one-time inline <script> that calls initWidget()/pushes
  // to window.__COMBO_BUILDER__ once, on initial page parse. Many themes update
  // parts of the product page (most commonly on variant/quantity change) via
  // Shopify's Section Rendering API — fetching fresh section HTML and swapping
  // it in via `container.innerHTML = html`. That REPLACES our root element with
  // a brand-new, un-initialized node (still showing just the Liquid fallback
  // spinner markup), and — critically — <script> tags inside HTML assigned via
  // `.innerHTML` never execute. So the one-time init script for the new node
  // never runs, `initWidget` is never called again, and the previously-matched
  // Single/Multiple Box configuration never comes back, even though the
  // product/box/design data itself never changed.
  //
  // Fix: watch the DOM for any `.combo-builder-root` that exists but hasn't
  // been initialized (this covers a same-id node being replaced by a theme
  // AJAX re-render, resize-driven layout changes, or any other DOM update —
  // whatever the trigger, if a root shows up without `data-cb-initialized`,
  // re-run initWidget() on it). Every root's own data-* attributes already
  // carry its full config (shop/apiBase/productId/currency/labels/etc — see
  // combo-builder.liquid / combo-embed.liquid), and initWidget() already
  // prefers `root.dataset.X` over any passed-in config for every field, so
  // `initWidget({ mountId: root.id })` alone fully restores the exact same
  // product-specific bundle (Single or Multiple) that was showing before —
  // never "all bundles" and never an empty grid.
  function reinitializeUninitializedComboRoots() {
    var roots = document.querySelectorAll('.combo-builder-root');
    var candidates = 0;

    for (var i = 0; i < roots.length; i++) {
      var el = roots[i];
      if (!el.id || el.isConnected === false) continue;

      var initialized = el.getAttribute('data-cb-initialized') === '1';
      var rendered = el.getAttribute('data-cb-rendered') === '1';
      var suppressed = el.getAttribute('data-cb-suppressed-by-manual-block') === '1';
      var suppressedByAuto = el.getAttribute('data-cb-suppressed-by-auto-product') === '1';
      var hasRenderedUi = !!el.querySelector('.cb-wrapper');
      var isAutoRoot = isAutoProductComboRoot(el);
      var isManualRoot = isManualComboBuilderRoot(el);

      // If an auto root was suppressed because a manual block existed, but a
      // later Shopify section/AJAX update removed that manual block, release the
      // suppression and initialize the auto root again.
      if (suppressed) {
        if (isAutoRoot && !hasManualComboBuilderRoot(el)) {
          candidates++;
          cbLog('reinitializeUninitializedComboRoots: manual owner gone — restoring suppressed auto root', cbDescribeRoot(el));
          restoreComboRootVisibility(el);
          el.removeAttribute('data-cb-initialized');
          el.removeAttribute('data-cb-rendered');
          try { initWidget({ mountId: el.id }); } catch (e0) { if (__CB_DEBUG__) console.error('[ComboBuilder]', e0); }
        }
        continue;
      }

      if (suppressedByAuto) {
        if (isManualRoot && !hasActiveRenderedAutoProductRoot(el)) {
          candidates++;
          cbLog('reinitializeUninitializedComboRoots: active auto root gone - restoring manual root', cbDescribeRoot(el));
          restoreComboRootVisibility(el);
          el.removeAttribute('data-cb-initialized');
          el.removeAttribute('data-cb-rendered');
          try { initWidget({ mountId: el.id }); } catch (eManual) { if (__CB_DEBUG__) console.error('[ComboBuilder]', eManual); }
        }
        continue;
      }

      // Normal Shopify Section Rendering API case: the old node was replaced
      // with fresh Liquid HTML. The new node has no data-cb-initialized flag.
      if (!initialized) {
        candidates++;
        cbLog('reinitializeUninitializedComboRoots: found fresh/uninitialized root, reinitializing', cbDescribeRoot(el));
        try { initWidget({ mountId: el.id }); } catch (e1) { if (__CB_DEBUG__) console.error('[ComboBuilder]', e1); }
        continue;
      }

      // Some themes keep the root element itself but replace/clear its children.
      // In that case data-cb-rendered survives even though .cb-wrapper is gone.
      // Reset only this proven destroyed-render state; do not retry legitimate
      // no-box/error/order-limit states indefinitely.
      if (rendered && !hasRenderedUi) {
        candidates++;
        cbLog('reinitializeUninitializedComboRoots: rendered root lost its UI — rebuilding', cbDescribeRoot(el));
        el.removeAttribute('data-cb-initialized');
        el.removeAttribute('data-cb-rendered');
        try { initWidget({ mountId: el.id }); } catch (e2) { if (__CB_DEBUG__) console.error('[ComboBuilder]', e2); }
      }
    }

    if (candidates === 0) {
      cbLog('reinitializeUninitializedComboRoots: scan found nothing to (re)init', 'totalRoots=' + roots.length);
    }
  }

  var _comboRootRecoveryTimer = null;
  function scheduleComboRootRecovery(delay) {
    if (_comboRootRecoveryTimer) clearTimeout(_comboRootRecoveryTimer);
    _comboRootRecoveryTimer = setTimeout(function () {
      _comboRootRecoveryTimer = null;
      reinitializeUninitializedComboRoots();
    }, delay == null ? 50 : Math.max(0, Number(delay) || 0));
  }

  function observeComboRootReplacement() {
    // Every block/embed instance on a page renders its own <script src="...">
    // tag, and a duplicate <script> tag re-executes this entire file even
    // though the browser only fetches the bytes once (see the runtime notes
    // on cbInstallLifecycleListeners/bindComboRootLifecycleRecoveryEvents,
    // which already self-guard this same way). Without this guard, N block
    // instances on one page would attach N separate MutationObservers, each
    // independently rescanning on every mutation.
    if (window.__cbRootObserverAttached) return;
    window.__cbRootObserverAttached = true;
    if (typeof MutationObserver === 'undefined' || !document.body) return;
    var observer = new MutationObserver(function (mutations) {
      cbLog('MutationObserver fired', 'mutationRecords=' + mutations.length);
      scheduleComboRootRecovery(50);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    cbLog('observeComboRootReplacement: MutationObserver attached to document.body');
  }

  function bindComboRootLifecycleRecoveryEvents() {
    if (window.__cbRootRecoveryEventsBound) return;
    window.__cbRootRecoveryEventsBound = true;

    // MutationObserver is the primary recovery path. These explicit Shopify
    // lifecycle hooks make recovery deterministic for themes/theme-editor flows
    // that emit section events around DOM replacement.
    ['shopify:section:load', 'shopify:section:reorder', 'shopify:block:select']
      .forEach(function (eventName) {
        document.addEventListener(eventName, function () {
          scheduleComboRootRecovery(50);
        });
      });

    // Popular product themes emit one of these after variant-related HTML work.
    // Scanning is safe even when no DOM was replaced because initialized roots
    // with intact .cb-wrapper content are ignored.
    ['variant:change', 'product:variant-change']
      .forEach(function (eventName) {
        document.addEventListener(eventName, function () {
          scheduleComboRootRecovery(80);
        });
      });
  }

  // ─── Free Gift Product Sync ──────────────────────────────────────────────────
  //
  // A configured Free Gift Product (Buy X Get Y automatic discount) only makes
  // an EXISTING gift line free — Shopify's automatic discount never inserts the
  // gift product into the cart by itself. This section resolves each qualifying
  // Bundle Product's Free Gift config (by Box ID/pack key — see resolveGiftForBox
  // server-side) and adds/adjusts/removes the corresponding gift line so its
  // quantity always matches the configured buy/get ratio, without ever touching
  // normal products or another box's gift.

  var _cbGiftConfigCache = {}; // key: boxId + ':' + packKey -> gift config, or null if checked and none
  var _cbGiftReconcileInFlight = false;
  var _cbGiftReconcileQueued = false;
  var _cbGiftReconcileTimer = null;

  function cbGiftCacheKey(boxId, packKey) {
    return String(boxId) + ':' + (packKey || '');
  }

  function cbGiftSectionIds() {
    return ['cart-drawer', 'cart-icon-bubble', 'cart-notification-button', 'cart-notification'];
  }

  function resolveGiftConfig(boxId, packKey, shop, apiBase) {
    var key = cbGiftCacheKey(boxId, packKey);
    if (Object.prototype.hasOwnProperty.call(_cbGiftConfigCache, key)) {
      return Promise.resolve(_cbGiftConfigCache[key]);
    }
    var base = String(apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
    var url = base + '/api/storefront/boxes/' + encodeURIComponent(String(boxId)) +
      '/gift?shop=' + encodeURIComponent(shop) +
      (packKey ? '&packKey=' + encodeURIComponent(packKey) : '');

    return fetch(url, { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.ok ? r.json() : { hasGift: false }; })
      .catch(function () { return { hasGift: false }; })
      .then(function (data) {
        _cbGiftConfigCache[key] = (data && data.hasGift) ? data : null;
        return _cbGiftConfigCache[key];
      });
  }

  function cbGiftCartChange(line, quantity, properties) {
    var body = {
      line: line,
      quantity: quantity,
      sections: cbGiftSectionIds(),
      sections_url: window.location.pathname + window.location.search,
    };
    if (properties) body.properties = properties;

    return fetch('/cart/change.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CB-Gift-Sync': '1' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function cbGiftCartAdd(variantId, quantity, properties) {
    return fetch('/cart/add.js', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CB-Gift-Sync': '1' },
      body: JSON.stringify({
        items: [{ id: variantId, quantity: quantity, properties: properties || {} }],
        sections: cbGiftSectionIds(),
        sections_url: window.location.pathname + window.location.search,
      }),
    }).then(function (r) { return r.json(); });
  }

  // Walks the live cart, groups qualifying Bundle Product lines by their
  // _bundle_box_id/_bundle_pack_key properties, resolves each group's Free Gift
  // config (cached per box/pack), and brings the matching gift line's quantity
  // to buyQty/getQty ratio × bundle quantity — adding it if missing, resizing it
  // if the bundle quantity changed, or removing it once no qualifying bundle
  // remains. Only ever touches lines carrying these markers, so normal products
  // and other boxes' lines are never affected.
  function reconcileFreeGifts(shop, apiBase) {
    if (!shop) return;
    if (_cbGiftReconcileInFlight) { _cbGiftReconcileQueued = true; return; }
    _cbGiftReconcileInFlight = true;

    fetch('/cart.js', { headers: { 'Accept': 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (cart) {
        var items = (cart && cart.items) || [];
        var bundleGroups = {};
        var giftLinesByKey = {};

        items.forEach(function (item, idx) {
          var props = item.properties || {};
          if (props._bundle_box_id) {
            var bundleKey = cbGiftCacheKey(props._bundle_box_id, props._bundle_pack_key);
            if (!bundleGroups[bundleKey]) {
              bundleGroups[bundleKey] = { boxId: props._bundle_box_id, packKey: props._bundle_pack_key || '', qty: 0 };
            }
            bundleGroups[bundleKey].qty += item.quantity;
          }
          if (props._free_gift_for_box_id) {
            var giftKey = cbGiftCacheKey(props._free_gift_for_box_id, props._free_gift_for_pack_key);
            giftLinesByKey[giftKey] = { line: idx + 1, item: item };
          }
        });

        var keys = Object.keys(bundleGroups);
        Object.keys(giftLinesByKey).forEach(function (giftKey) {
          if (keys.indexOf(giftKey) === -1) keys.push(giftKey);
        });

        var lastCartResponse = null;
        var chain = Promise.resolve();

        keys.forEach(function (key) {
          chain = chain.then(function () {
            var group = bundleGroups[key];
            var parts = key.split(':');
            var boxId = group ? group.boxId : parts[0];
            var packKey = group ? group.packKey : parts[1];
            var bundleQty = group ? group.qty : 0;
            var giftLine = giftLinesByKey[key];

            return resolveGiftConfig(boxId, packKey, shop, apiBase).then(function (giftConfig) {
              if (!giftConfig) {
                // Not (or no longer) a Free Gift box/pack — only clean up a stray
                // gift line if its qualifying bundle is completely gone.
                if (giftLine && bundleQty === 0) {
                  return cbGiftCartChange(giftLine.line, 0).then(function (resp) { lastCartResponse = resp; });
                }
                return null;
              }

              var desiredQty = Math.max(0, Math.floor(bundleQty / giftConfig.buyQuantity) * giftConfig.getQuantity);
              var currentQty = giftLine ? giftLine.item.quantity : 0;
              if (desiredQty === currentQty) return null;

              if (giftLine) {
                return cbGiftCartChange(giftLine.line, desiredQty, {
                  _free_gift: 'true',
                  _free_gift_for_box_id: String(boxId),
                  _free_gift_for_pack_key: packKey || '',
                }).then(function (resp) { lastCartResponse = resp; });
              }
              if (desiredQty > 0) {
                return cbGiftCartAdd(giftConfig.giftVariantId, desiredQty, {
                  _free_gift: 'true',
                  _free_gift_for_box_id: String(boxId),
                  _free_gift_for_pack_key: packKey || '',
                }).then(function (resp) { lastCartResponse = resp; });
              }
              return null;
            });
          });
        });

        return chain.then(function () { return lastCartResponse; });
      })
      .then(function (cartResponse) {
        if (cartResponse) {
          try { syncThemeCartUIStandalone(cartResponse); } catch (e) { if (__CB_DEBUG__) console.warn('[ComboBuilder] gift sync UI refresh failed:', e); }
        }
      })
      .catch(function (e) { if (__CB_DEBUG__) console.warn('[ComboBuilder] Free gift reconcile failed:', e); })
      .then(function () {
        _cbGiftReconcileInFlight = false;
        if (_cbGiftReconcileQueued) {
          _cbGiftReconcileQueued = false;
          scheduleGiftReconcile(shop, apiBase, 50);
        }
      });
  }

  function scheduleGiftReconcile(shop, apiBase, delay) {
    if (!shop) return;
    if (_cbGiftReconcileTimer) clearTimeout(_cbGiftReconcileTimer);
    _cbGiftReconcileTimer = setTimeout(function () {
      _cbGiftReconcileTimer = null;
      reconcileFreeGifts(shop, apiBase);
    }, delay == null ? 300 : delay);
  }

  // Minimal standalone re-implementation of addToCart()'s syncThemeCartUI —
  // reconcileFreeGifts runs at page/global scope (no per-widget `box` in
  // context), so it needs its own copy of the same theme drawer/notification
  // section-refresh logic rather than reaching into a specific widget closure.
  function syncThemeCartUIStandalone(cartResponse) {
    var sections = cartResponse && cartResponse.sections;
    if (!sections) return;

    var drawerExist = document.querySelector('cart-drawer');
    var notifExist = document.querySelector('cart-notification');
    var renderedByTheme = false;

    if (drawerExist) drawerExist.classList.remove('is-empty');

    if (drawerExist && typeof drawerExist.renderContents === 'function') {
      try { drawerExist.renderContents(cartResponse); renderedByTheme = true; }
      catch (e) { if (__CB_DEBUG__) console.warn('[ComboBuilder] cart-drawer.renderContents() failed:', e); }
    }
    if (notifExist && typeof notifExist.renderContents === 'function') {
      try { notifExist.renderContents(cartResponse); renderedByTheme = true; }
      catch (e) { if (__CB_DEBUG__) console.warn('[ComboBuilder] cart-notification.renderContents() failed:', e); }
    }
    if (renderedByTheme) return;

    var parser = new DOMParser();
    Object.keys(sections).forEach(function (key) {
      var markup = sections[key];
      if (!markup) return;
      var doc = parser.parseFromString(markup, 'text/html');

      if (key === 'cart-drawer') {
        var drawerSectionExist = document.querySelector('#shopify-section-cart-drawer');
        var drawerSectionFresh = doc.querySelector('#shopify-section-cart-drawer');
        if (drawerSectionExist && drawerSectionFresh) {
          drawerSectionExist.innerHTML = drawerSectionFresh.innerHTML;
        } else {
          var drawerFresh = doc.querySelector('cart-drawer');
          if (drawerExist && drawerFresh) drawerExist.innerHTML = drawerFresh.innerHTML;
        }
      }
      if (key === 'cart-notification') {
        var notifSectionExist = document.querySelector('#shopify-section-cart-notification');
        var notifSectionFresh = doc.querySelector('#shopify-section-cart-notification');
        if (notifSectionExist && notifSectionFresh) {
          notifSectionExist.innerHTML = notifSectionFresh.innerHTML;
        } else {
          var notifFresh = doc.querySelector('cart-notification');
          if (notifExist && notifFresh) notifExist.innerHTML = notifFresh.innerHTML;
        }
      }
      if (key === 'cart-icon-bubble') {
        var bubbleSectionExist = document.querySelector('#shopify-section-cart-icon-bubble');
        var bubbleSectionFresh = doc.querySelector('#shopify-section-cart-icon-bubble');
        if (bubbleSectionExist && bubbleSectionFresh) {
          bubbleSectionExist.innerHTML = bubbleSectionFresh.innerHTML;
        }
        var countFresh = doc.querySelector('.cart-count-bubble');
        if (countFresh) {
          document.querySelectorAll('.cart-count-bubble').forEach(function (el) {
            el.innerHTML = countFresh.innerHTML;
          });
        }
      }
    });
  }

  function cbGlobalShopAndApiBase() {
    var g = window.__COMBO_BUILDER_GLOBAL__ || {};
    var shop = g.shop || (window.Shopify && window.Shopify.shop) || null;
    var apiBase = g.apiBase || DEFAULT_API_BASE;
    return { shop: shop, apiBase: apiBase };
  }

  // Detects cart mutations the THEME's own cart drawer/page UI makes (native
  // quantity steppers, remove buttons, etc. — anything not marked with our own
  // X-CB-Gift-Sync header) via the same /cart/*.js endpoints, and re-runs the
  // gift reconciliation afterwards so gift quantity stays in sync and is
  // removed when its qualifying bundle is removed, without redesigning or
  // replacing any existing cart drawer/page behavior.
  function installGiftCartWatcher() {
    if (window.__cbGiftWatcherInstalled) return;
    window.__cbGiftWatcherInstalled = true;

    var nativeFetch = window.fetch;
    if (typeof nativeFetch !== 'function') return;

    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : ((input && input.url) || '');
      var isCartMutation = /\/cart\/(add|change|update|clear)(\.js)?(\?|$)/.test(String(url));
      var ownHeaders = init && init.headers;
      var isOwnGiftCall = !!(ownHeaders && ownHeaders['X-CB-Gift-Sync'] === '1');

      var result = nativeFetch.apply(this, arguments);
      if (isCartMutation && !isOwnGiftCall) {
        result.then(function () {
          var g = cbGlobalShopAndApiBase();
          scheduleGiftReconcile(g.shop, g.apiBase, 250);
        }).catch(function () {});
      }
      return result;
    };
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────────────

  function disableFrontendWhenEmbedOff() {
    var roots = document.querySelectorAll('.combo-builder-root, #combo-builder-widget, [id^="combo-builder-widget-legacy"]');
    for (var i = 0; i < roots.length; i++) {
      roots[i].innerHTML = '';
      roots[i].style.display = 'none';
      roots[i].setAttribute('data-cb-embed-disabled', '1');
      roots[i].removeAttribute('data-cb-initialized');
      roots[i].removeAttribute('data-cb-rendered');
    }
    window.__COMBO_BUILDER__ = {
      push: function () {
        disableFrontendWhenEmbedOff();
      },
    };
  }

  function bootstrap() {
    if (window.__COMBO_BUILDER_EMBED__ !== true) {
      disableFrontendWhenEmbedOff();
      return;
    }

    var widgetCount = 0;
    var queue = window.__COMBO_BUILDER__;
    if (Array.isArray(queue)) {
      queue.forEach(function (config) {
        try { initWidget(config); widgetCount++; } catch (e) { if (__CB_DEBUG__) console.error('[ComboBuilder]', e); }
      });
    }
    window.__COMBO_BUILDER__ = {
      push: function (config) {
        try { initWidget(config); } catch (e) { if (__CB_DEBUG__) console.error('[ComboBuilder]', e); }
      },
    };

    var legacyEl = document.getElementById('combo-builder-widget');
    if (legacyEl) { try { initLegacyWidget(legacyEl); widgetCount++; } catch (e) { if (__CB_DEBUG__) console.error('[ComboBuilder]', e); } }

    var legacyEls = document.querySelectorAll('[id^="combo-builder-widget-legacy"]');
    for (var i = 0; i < legacyEls.length; i++) {
      try { initLegacyWidget(legacyEls[i]); widgetCount++; } catch (e) { if (__CB_DEBUG__) console.error('[ComboBuilder]', e); }
    }

    cleanupComboCartPresentation(document);
    bindDrawerScrollRecovery();
    if (!window.__cbCartEventListenersBound) {
      window.__cbCartEventListenersBound = true;
      document.addEventListener('cart:refresh', function () { setTimeout(function () { cleanupComboCartPresentation(document); }, 20); });
      document.addEventListener('cart:updated', function () { setTimeout(function () { cleanupComboCartPresentation(document); }, 20); });
    }
    observeComboRootReplacement();
    bindComboRootLifecycleRecoveryEvents();
    // Also scan once after bootstrap in case theme/app scripts inserted a root
    // before the observer was attached but after the original Liquid queue ran.
    scheduleComboRootRecovery(0);
    cbInstallLifecycleListeners(); // TEMP DEBUG — remove with the rest of the instrumentation

    // Free Gift Product sync: watch for cart changes made by the theme's own
    // cart UI (native quantity/remove controls) and run one correction pass now,
    // in case a qualifying bundle's quantity changed on a previous page view.
    installGiftCartWatcher();
    var _cbGiftBoot = cbGlobalShopAndApiBase();
    if (_cbGiftBoot.shop) scheduleGiftReconcile(_cbGiftBoot.shop, _cbGiftBoot.apiBase, 400);

    document.dispatchEvent(new CustomEvent('comboBuildReady', { bubbles: true, detail: { widgetCount: widgetCount } }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }

})();
