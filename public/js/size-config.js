// One file, used by BOTH the website and the server. The admin picks each product's sizes in Admin > Products;
// the lists below are only the starting point for products that have not been set yet.
// Put a copy at:  lib/size-config.js  (server)  and  public/js/size-config.js  (website)
(function (root) {
  const SIZE_CONFIG = {
    // Categories that need a size
    categories: ['Clothes'],
    // Products in ANY category whose name matches this also need a size (e.g. a hoodie saved under "Others")
    namePattern: /hoodie|shirt|\btee|sleeve|jersey|polo|jacket/i,
    // Every size the admin can tick in Admin > Products (also the only sizes the server accepts, in this order)
    allSizes: ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL'],
    // Sizes offered when the admin has not chosen any for a product (and the pre-ticked sizes for new clothes)
    defaultSizes: ['S', 'M', 'L', 'XL', '2XL'],
    // Per-product sizes (key = product name exactly as in your database). Optional.
    // 'BU Hoodie': ['M', 'L', 'XL'],
    sizes: {},
    // Size chart picture
    defaultChart: '/img/size-chart.jpg',
    // Per-product size chart picture. Optional.
    // 'BU Hoodie': '/img/hoodie-size-chart.jpg',
    charts: {},
    // Built-in size chart table, shown whenever the picture is missing. Values in cm.
    table: {
      head: ['Size', 'Width (cm)', 'Height (cm)'],
      rows: [['S', 47, 65], ['M', 50, 68], ['L', 53, 71], ['XL', 56, 74], ['2XL', 59, 77]],
    },
    // Per-product table. Optional.  'BU Hoodie': { head: [...], rows: [...] }
    tables: {},
  };
  // The admin's choice (product.sizes, saved from Admin > Products) wins. null = not chosen yet, so the rules above decide.
  //   []  = this item has no sizes     ['S','M'] = only these sizes
  const hasChoice = (p) => !!p && Array.isArray(p.sizes);
  const byRules = (p) => !!SIZE_CONFIG.sizes[p.name] || SIZE_CONFIG.categories.includes(p.category) || SIZE_CONFIG.namePattern.test(p.name || '');
  SIZE_CONFIG.needsSize = (p) => !!p && (hasChoice(p) ? p.sizes.length > 0 : byRules(p));
  SIZE_CONFIG.sizesOf = (p) => (hasChoice(p) && p.sizes.length ? p.sizes : SIZE_CONFIG.sizes[p.name] || SIZE_CONFIG.defaultSizes);
  SIZE_CONFIG.tableOf = (p) => SIZE_CONFIG.tables[p.name] || SIZE_CONFIG.table;
  SIZE_CONFIG.chartOf = (p) => SIZE_CONFIG.charts[p.name] || SIZE_CONFIG.defaultChart;
  if (typeof module !== 'undefined' && module.exports) module.exports = SIZE_CONFIG;
  else root.SIZE_CONFIG = SIZE_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);