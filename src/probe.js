import { chromium } from 'playwright';

/**
 * Probe the Bihar eProcurement website to understand its structure
 * This will help us identify the exact CSS selectors for tender data
 */
async function probeWebsite() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log('🔍 Probing Bihar eProcurement website...');
    console.log('URL: https://eproc2.bihar.gov.in/EPSV2Web/openarea/tenderListingPage.action');

    await page.goto('https://eproc2.bihar.gov.in/EPSV2Web/openarea/tenderListingPage.action', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    console.log('\n✓ Page loaded successfully');

    // Take screenshot
    await page.screenshot({ path: 'probe-screenshot.png' });
    console.log('📸 Screenshot saved: probe-screenshot.png');

    // Check for modals
    const modals = await page.$$('.modal, [role="dialog"], .popup, .overlay');
    console.log(`\n📋 Found ${modals.length} modal/dialog elements`);

    if (modals.length > 0) {
      console.log('Attempting to close modals...');
      for (const modal of modals) {
        const closeBtn = await modal.$('.close, [aria-label*="close" i], button[type="button"]');
        if (closeBtn) {
          await closeBtn.click();
          await page.waitForTimeout(500);
        }
      }
    }

    // Get page title
    const title = await page.title();
    console.log(`\n📄 Page Title: ${title}`);

    // Find main content area
    const mainContent = await page.evaluate(() => {
      const main = document.querySelector('main, .main-content, .content, .container');
      return main ? main.className : 'Not found';
    });
    console.log(`📍 Main Content Classes: ${mainContent}`);

    // Look for table structures
    const tables = await page.$$eval('table', (tables) =>
      tables.map((table, idx) => ({
        index: idx,
        rows: table.querySelectorAll('tbody tr').length,
        headers: Array.from(table.querySelectorAll('thead th')).map((th) => th.textContent.trim()),
      }))
    );

    console.log(`\n📊 Found ${tables.length} tables:`);
    tables.forEach((table) => {
      console.log(`\n  Table ${table.index}:`);
      console.log(`    Rows: ${table.rows}`);
      console.log(`    Headers: ${table.headers.join(' | ')}`);
    });

    // Look for tender data patterns
    const pageText = await page.evaluate(() => document.body.innerText);
    const hasLatestTenders = pageText.includes('Latest Tenders') || pageText.includes('latestTenders');
    console.log(`\n✓ Contains "Latest Tenders": ${hasLatestTenders}`);

    // Extract first table structure with data
    const tenderData = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      const results = [];

      tables.forEach((table, tableIdx) => {
        const rows = table.querySelectorAll('tbody tr');
        if (rows.length === 0) return;

        const firstRow = rows[0];
        const cells = firstRow.querySelectorAll('td');

        if (cells.length > 0) {
          results.push({
            tableIndex: tableIdx,
            totalRows: rows.length,
            columns: cells.length,
            firstRowData: Array.from(cells)
              .slice(0, 6)
              .map((cell) => cell.textContent.trim().substring(0, 80)),
            sampleLinks: Array.from(cells)
              .map((cell) => cell.querySelector('a')?.href)
              .filter(Boolean)
              .slice(0, 3),
          });
        }
      });

      return results;
    });

    console.log('\n📋 Sample Tender Data:');
    console.log(JSON.stringify(tenderData, null, 2));

    // Check for pagination
    const pagination = await page.evaluate(() => {
      const paginators = document.querySelectorAll('[class*="paginat"], [class*="page-"]');
      return {
        found: paginators.length > 0,
        text: Array.from(paginators).map((p) => p.textContent.trim()),
      };
    });

    console.log(`\n📄 Pagination Found: ${pagination.found}`);
    if (pagination.text.length > 0) {
      console.log(`   ${pagination.text.join(' | ')}`);
    }

    // Check for data attributes
    const dataAttributes = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      const attrs = new Set();

      tables.forEach((table) => {
        const rows = table.querySelectorAll('tr');
        rows.forEach((row) => {
          Array.from(row.attributes).forEach((attr) => {
            if (attr.name.includes('data-') || attr.name.includes('id')) {
              attrs.add(attr.name);
            }
          });
        });
      });

      return Array.from(attrs);
    });

    console.log(`\n🏷️  Data Attributes Found: ${dataAttributes.join(', ') || 'None'}`);

    console.log('\n✅ Probe Complete!');
    console.log('\n🔗 Recommended CSS Selectors:');
    console.log('   For latest tenders table: table tbody tr');
    console.log('   For tender number: td:nth-child(1)');
    console.log('   For description: td:nth-child(2)');
    console.log('   For department: td:nth-child(3)');
    console.log('   For dates: td:nth-child(4), td:nth-child(5)');
  } catch (error) {
    console.error('❌ Probe Error:', error.message);
  } finally {
    await browser.close();
  }
}

// Run probe
probeWebsite().catch(console.error);
