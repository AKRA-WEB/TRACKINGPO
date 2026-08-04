async (page) => {
  const dataRequests = [];
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.route('https://unpkg.com/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: 'window.lucide={createIcons:function(){}};'
  }));
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
    status: 200,
    contentType: 'text/css',
    body: ''
  }));
  await page.route('https://script.google.com/**', async route => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ valid: true }) });
      return;
    }

    const body = JSON.parse(request.postData() || '{}');
    const data = body.data || {};
    dataRequests.push({ action: body.action, data });
    const row = (uid, status) => ({
      uid,
      refPrUid: `BILL-${uid}`,
      rowNumber: uid === 'MATCH' ? 2 : 3,
      poDate: '04/08/2026',
      poNumber: `PO-${uid}`,
      vendor: 'Fixture Vendor',
      warehouse: 'W1',
      sku: 'SKU-1',
      product: `${uid} Item`,
      quantity: 2,
      unit: 'EA',
      status,
      displayStatus: status,
      grQty: 2,
      locIn: 'A1',
      ata: '04/08/2026',
      receiverName: 'Fixture Receiver'
    });

    let response;
    if (body.action === 'getInitialData' && data.includeMatch === true) {
      response = { success: true, prList: [], pendingPOs: [], vendors: [], grCompleted: [row('MATCH', 'GR Completed')] };
    } else if (body.action === 'getInitialData' && data.includeAPV === true) {
      response = { success: true, prList: [], pendingPOs: [], vendors: [], apvList: [row('APV', 'PO Closed - Ready for APV')] };
    } else if (body.action === 'getInitialData') {
      response = { success: true, prList: [], pendingPOs: [], vendors: [] };
    } else if (body.action === 'getProducts') {
      response = { success: true, products: [], vendors: [] };
    } else {
      response = { success: true };
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response)
    });
  });

  await page.goto('http://localhost:4174/');
  await page.locator('#app-content').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    window.appSession = { roles: ['ADMIN'], perms: { 'app-po': ['createPO'] } };
  });

  const navColor = await page.locator('nav').evaluate(element => getComputedStyle(element).backgroundColor);
  if (navColor !== 'rgb(23, 28, 143)') throw new Error(`Compiled brand color missing: ${navColor}`);

  await page.locator('#btn-tab-match').click();
  await page.getByText('กลุ่มรายการรอกระทบยอด').waitFor();
  await page.getByText('MATCH Item').waitFor();

  await page.locator('#btn-tab-apv').click();
  await page.getByText('RPO-PO-APV').waitFor();

  const matchRequest = dataRequests.find(item => item.data.includeMatch === true);
  const apvRequest = dataRequests.find(item => item.data.includeAPV === true);
  if (!matchRequest || matchRequest.data.includeAPV !== false) throw new Error('Match did not request an independent payload');
  if (!apvRequest || apvRequest.data.includeMatch !== false) throw new Error('APV did not request an independent payload');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#btn-tab-po').click();
  await page.getByRole('button', { name: /สร้างบิลใหม่/ }).click();
  await page.locator('#modal-create-po').waitFor({ state: 'visible' });
  const mobileModalWidth = await page.locator('#modal-create-po > div').evaluate(element => element.getBoundingClientRect().width);
  if (mobileModalWidth > 390) throw new Error(`Mobile modal overflowed viewport: ${mobileModalWidth}`);

  await page.setViewportSize({ width: 1024, height: 900 });
  const tabletModalWidth = await page.locator('#modal-create-po > div').evaluate(element => element.getBoundingClientRect().width);
  if (tabletModalWidth > 1024) throw new Error(`Tablet modal overflowed viewport: ${tabletModalWidth}`);

  await page.setViewportSize({ width: 1440, height: 900 });
  const desktopModalWidth = await page.locator('#modal-create-po > div').evaluate(element => element.getBoundingClientRect().width);
  if (desktopModalWidth > 1024 || desktopModalWidth < 900) {
    throw new Error(`Desktop modal did not retain its compiled width: ${desktopModalWidth}`);
  }

  if (pageErrors.length) throw new Error(`Page errors: ${pageErrors.join(' | ')}`);
  if (consoleErrors.length) throw new Error(`Console errors: ${consoleErrors.join(' | ')}`);
}
