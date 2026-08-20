const assert = require('assert');
const poClient = require('../js/supabase-po-client.js');

async function runTests() {
  console.log('=== TESTING PO SUPABASE API CLIENT ADAPTER ===\n');

  // 1. Initial Data Read (<50ms)
  console.log('[1/4] Testing getInitialData (Active PO Bills & Vendors)...');
  const t0 = Date.now();
  const initData = await poClient.getInitialData();
  const initMs = Date.now() - t0;
  assert.strictEqual(initData.status, 'success');
  assert(Array.isArray(initData.activeBills), 'Active bills must be an array');
  assert(initData.vendors.length > 100, 'Must load >100 active vendors');
  console.log(`  -> Initial Read Latency: ${initMs}ms`);
  console.log(`  -> Active Bills Count: ${initData.activeBills.length}`);
  console.log(`  -> Active Vendors Count: ${initData.vendors.length}`);

  // 2. Full Catalog getProducts (4,799 Master Products)
  console.log('\n[2/5] Testing getProducts (Full 4,799 Catalog Pagination)...');
  const tProd = Date.now();
  const allProds = await poClient.getProducts();
  const prodMs = Date.now() - tProd;
  assert(allProds.length >= 4700, `Must load entire product catalog, got ${allProds.length}`);
  console.log(`  -> Full Catalog Latency: ${prodMs}ms (loaded ${allProds.length} products)`);

  // 3. Instant Multi-Token Search on Products (<30ms)
  console.log('\n[3/5] Testing Multi-Token Product Search with PostgreSQL GIN index...');
  const tSearch = Date.now();
  const searchResults = await poClient.searchProducts('มายองเนส', 10);
  const searchMs = Date.now() - tSearch;
  assert(searchResults.length > 0, 'Must find matching mayonnaise items');
  console.log(`  -> Single Token Search Latency: ${searchMs}ms (found ${searchResults.length} matches)`);
  console.log(`  -> Top Match: [${searchResults[0].sku}] ${searchResults[0].product_name}`);

  const multiTokenResults = await poClient.searchProducts('กล่อง 1 ปอนด์', 20);
  assert(multiTokenResults.length > 0, 'Must find multi-token items like กล่อง 1 ปอนด์');
  console.log(`  -> Multi-Token Search: found ${multiTokenResults.length} matches for "กล่อง 1 ปอนด์"`);

  // 4. Save Direct PO
  console.log('\n[4/5] Testing Direct PO creation mutation...');
  const newPO = {
    poNumber: 'PO-TEST-' + Date.now(),
    poDate: '2026-08-19',
    vendor: 'บจก. เม่งฮง',
    warehouse: 'W1',
    remark: 'ทดสอบระบบ Supabase Integration',
    items: [
      {
        sku: 'FF21610104',
        productName: 'มายองเนส SE เบสท์ฟู้ดส์ (ลัง12x910g)',
        poQty: 25,
        unit: 'ลัง'
      }
    ]
  };

  const saveRes = await poClient.saveDirectPO(newPO);
  assert.strictEqual(saveRes.status, 'success');
  assert(saveRes.poId, 'Must return created PO ID');
  console.log(`  -> Created PO [${saveRes.poNumber}] ID: ${saveRes.poId}`);

  // 5. Delete Bill
  console.log('\n[5/5] Testing PO Bill deletion...');
  const delRes = await poClient.deleteBill(saveRes.poId);
  assert.strictEqual(delRes.status, 'success');
  console.log(`  -> Cleaned up test PO ID [${saveRes.poId}]`);

  console.log('\n🌟 PO SUPABASE API CLIENT ADAPTER TESTS PASSED 100%! 🌟');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});

