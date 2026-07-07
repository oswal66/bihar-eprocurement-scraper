import { chromium } from 'playwright';
import * as cheerio from 'cheerio';
import config from './config.js';
import { saveTender, getTenderByNumber } from './database.js';

/**
 * Scrape tender data from Bihar eProcurement website using Playwright
 * Handles modals and prevents stale data
 */
export async function scrapeTenders() {
  let browser;
  try {
    console.log('🕷️  Starting tender scrape...');
    console.log(`📍 URL: ${config.scraper.eprocUrl}`);

    // Launch browser
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    // Navigate to page
    console.log('📄 Loading page...');
    await page.goto(config.scraper.eprocUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Handle modals - Close any overlay/modal elements
    console.log('🔍 Checking for modals...');
    
    try {
      // Try to close modals with timeout
      await page.locator('.modal, [role="dialog"], .popup, .overlay').evaluateAll(
        (elements) => {
          elements.forEach((el) => {
            const closeBtn = el.querySelector('button:contains("Close"), button:contains("X"), .close, [aria-label*="close" i]');
            if (closeBtn && closeBtn.offsetParent !== null) {
              closeBtn.click();
            }
          });
        }
      );
      
      await page.waitForTimeout(1000);
      console.log('✅ Modal close attempt completed');
    } catch (e) {
      console.log('⚠️  Modal close skipped (non-critical)');
    }

    // Wait for table to be visible
    await page.waitForSelector('table tbody tr', { timeout: 10000 }).catch(() => {
      console.warn('⚠️  Table might not be visible, continuing anyway...');
    });

    // Get page content
    const content = await page.content();
    const $ = cheerio.load(content);

    // Parse tenders
    const tenders = await parseTendersFromHtml($);
    
    let savedCount = 0;
    const now = new Date();

    // Save tenders with stale data prevention
    for (const tender of tenders) {
      try {
        // Check if tender already exists and is recent
        const existingTender = await getTenderByNumber(tender.tender_number);
        
        if (existingTender) {
          // Calculate age of existing data
          const lastUpdated = new Date(existingTender.updated_at);
          const ageInHours = (now - lastUpdated) / (1000 * 60 * 60);
          
          // If data is less than 1 hour old and nothing changed, skip
          if (ageInHours < 1 && 
              existingTender.closing_date === tender.closing_date &&
              existingTender.status === tender.status) {
            console.log(`⏭️  Skipping ${tender.tender_number} (no changes)`);
            continue;
          }
          
          console.log(`🔄 Updating ${tender.tender_number} (age: ${ageInHours.toFixed(1)}h)`);
        } else {
          console.log(`✨ New tender: ${tender.tender_number}`);
        }

        // Save tender
        const saved = await saveTender(tender);
        if (saved) {
          savedCount++;
        }
      } catch (error) {
        console.error(`❌ Error processing tender:`, error.message);
      }
    }

    console.log(`\n✅ Scrape completed: ${tenders.length} tenders found, ${savedCount} saved/updated`);
    return { 
      scrapedCount: tenders.length, 
      savedCount: savedCount,
      timestamp: now.toISOString(),
    };

  } catch (error) {
    console.error('❌ Scraping error:', error.message);
    return { 
      scrapedCount: 0, 
      savedCount: 0, 
      error: error.message,
      timestamp: new Date().toISOString()
    };
  } finally {
    if (browser) {
      await browser.close();
      console.log('🔒 Browser closed');
    }
  }
}

/**
 * Parse tenders from HTML content with header filtering
 */
async function parseTendersFromHtml($) {
  const tenders = [];

  // Try multiple table selectors
  const tables = $('table');
  
  if (tables.length === 0) {
    console.warn('⚠️  No tables found on page');
    return tenders;
  }

  console.log(`📊 Found ${tables.length} table(s), parsing...`);

  // Keywords that indicate header/navigation rows
  const headerKeywords = [
    'Tender Number',
    'Description',
    'Department',
    'Closing',
    'Issuing Authority',
    'Status',
    'Category',
    'Type',
    'Opening Date',
    'Tender ID',
    'Title',
    'Organization'
  ];

  // Process each table
  tables.each((tableIdx, table) => {
    const rows = $(table).find('tbody tr');
    
    if (rows.length === 0) {
      console.log(`  Table ${tableIdx}: No rows`);
      return;
    }

    console.log(`  Table ${tableIdx}: ${rows.length} rows`);

    rows.each((rowIdx, row) => {
      try {
        const $row = $(row);
        const cells = $row.find('td');

        if (cells.length < 3) return;

        // Extract data - Common patterns for tender tables
        const tenderNumber = $(cells[0]).text().trim();
        const description = $(cells[1]).text().trim();
        const department = $(cells[2]).text().trim();
        const closingDateStr = cells.length > 3 ? $(cells[3]).text().trim() : '';

        // Skip if missing critical data
        if (!tenderNumber || !description) return;

        // Filter out header rows
        const rowText = [tenderNumber, description, department].join(' ').toLowerCase();
        const isHeaderRow = headerKeywords.some(keyword => 
          rowText.includes(keyword.toLowerCase())
        );

        if (isHeaderRow) {
          console.log(`  ⏭️  Skipping header row: ${tenderNumber}`);
          return;
        }

        // Skip if tenderNumber looks like a header (too generic)
        if (/^(S\.?No|Sno|No\.|Number|ID|Tender Number)$/i.test(tenderNumber)) {
          return;
        }

        // Extract link
        const link = $row.find('a').attr('href') || '';

        // Create tender object
        const tender = {
          tender_id: generateTenderId(tenderNumber),
          tender_number: tenderNumber,
          description: description,
          department: department || 'Unknown',
          tender_type: extractTenderType(description),
          opening_date: new Date(),
          closing_date: parseDate(closingDateStr),
          tender_value: extractTenderValue(description),
          category: extractCategory(description),
          location: department || 'Unknown',
          document_link: link,
          status: parseDate(closingDateStr) > new Date() ? 'Active' : 'Closed',
          scraped_at: new Date(),
        };

        tenders.push(tender);
      } catch (error) {
        console.error(`  Row ${rowIdx} parse error:`, error.message);
      }
    });
  });

  return tenders;
}

/**
 * Generate unique tender ID based on tender number (not timestamp dependent)
 */
function generateTenderId(tenderNumber) {
  // Use tender number as base for consistent IDs
  const hash = Buffer.from(tenderNumber).toString('base64').substring(0, 8);
  return `BIHAR_${tenderNumber}_${hash}`;
}

/**
 * Parse date string with multiple format support
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date();

  try {
    // Remove extra whitespace
    const cleaned = dateStr.trim();

    // DD-MM-YYYY or DD/MM/YYYY format
    const ddmmyyyy = /(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/.exec(cleaned);
    if (ddmmyyyy) {
      const [, day, month, year] = ddmmyyyy;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }

    // YYYY-MM-DD format
    const yyyymmdd = /(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/.exec(cleaned);
    if (yyyymmdd) {
      const [, year, month, day] = yyyymmdd;
      return new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
    }

    // Try ISO format
    const isoDate = new Date(cleaned);
    if (!isNaN(isoDate.getTime())) {
      return isoDate;
    }
  } catch (e) {
    console.warn(`Date parse warning: ${dateStr}`);
  }

  return new Date();
}

/**
 * Extract tender type from description
 */
function extractTenderType(description) {
  const lower = description.toLowerCase();
  if (lower.includes('supply')) return 'Supply';
  if (lower.includes('works') || lower.includes('civil')) return 'Works';
  if (lower.includes('service')) return 'Service';
  if (lower.includes('construction')) return 'Works';
  if (lower.includes('management') || lower.includes('contract')) return 'Service';
  return 'Other';
}

/**
 * Extract tender value from description
 */
function extractTenderValue(description) {
  try {
    // Look for currency patterns: ₹ or Rs.
    const matches = description.match(/₹[\s]*([\d,]+)|Rs\.?\s*([\d,]+)/i);
    if (matches) {
      const valueStr = (matches[1] || matches[2]).replace(/,/g, '');
      const value = parseFloat(valueStr);
      return !isNaN(value) ? value : null;
    }
  } catch (e) {
    // Continue silently
  }
  return null;
}

/**
 * Extract category from description
 */
function extractCategory(description) {
  const lower = description.toLowerCase();
  if (lower.includes('it') || lower.includes('software') || lower.includes('technology')) return 'IT';
  if (lower.includes('construction') || lower.includes('civil')) return 'Construction';
  if (lower.includes('medical') || lower.includes('health')) return 'Medical';
  if (lower.includes('equipment') || lower.includes('machine')) return 'Equipment';
  if (lower.includes('education') || lower.includes('training')) return 'Education';
  if (lower.includes('transport') || lower.includes('vehicle')) return 'Transportation';
  return 'General';
}

// Run scraper if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeTenders().then((result) => {
    console.log('\n📋 Scrape Result:', result);
    process.exit(0);
  });
}

export default { scrapeTenders };
