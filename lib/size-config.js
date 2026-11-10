// One file, used by BOTH the website and the server. Edit sizes here, no database needed.
// Put a copy at:  lib/size-config.js  (server)  and  public/js/size-config.js  (website)
(function (root) {
  const SIZE_CONFIG = {
    // Categories that need a size
    categories: ['Clothes'],
    // Products in ANY category whose name matches this also need a size (e.g. a hoodie saved under "Others")
    namePattern: /hoodie|shirt|\btee|sleeve|jersey|polo|jacket/i,
    // Sizes offered when a product has no special list below
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
  SIZE_CONFIG.needsSize = (p) => !!p && (!!SIZE_CONFIG.sizes[p.name] || SIZE_CONFIG.categories.includes(p.category) || SIZE_CONFIG.namePattern.test(p.name || ''));
  SIZE_CONFIG.sizesOf = (p) => SIZE_CONFIG.sizes[p.name] || SIZE_CONFIG.defaultSizes;
  SIZE_CONFIG.tableOf = (p) => SIZE_CONFIG.tables[p.name] || SIZE_CONFIG.table;
  SIZE_CONFIG.chartOf = (p) => SIZE_CONFIG.charts[p.name] || SIZE_CONFIG.defaultChart;
  if (typeof module !== 'undefined' && module.exports) module.exports = SIZE_CONFIG;
  else root.SIZE_CONFIG = SIZE_CONFIG;
})(typeof window !== 'undefined' ? window : globalThis);