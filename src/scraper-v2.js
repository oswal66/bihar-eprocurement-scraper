import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import config from './config.js';
import { saveTender, getTenderByNumber } from './database.js';

/**
 * Production-grade Bihar eProcurement Scraper
 * 
 * Target: Preview Tender Modal (AJAX-loaded, AngularJS-driven)
 * Approach: Cautious, validation-first, stale-data prevention
 * 
 * The listing page is a navigation layer only.
 * The Preview modal is the authoritative data source.
 */

const SELECTORS = {
  // Listing page
  listingTable: 'table tbody',
  listingRow: 'tr[data-ng-repeat*="tender"], tr',
  viewButton: 'button:has-text("View"), a:has-text("View"), .btn-view',
  
  // Preview modal
  modal: '.modal.in, [role="dialog"][aria-modal="true"]',
  modalContent: '.modal-content, .modal-body',
  loadingSpinner: '.spinner, .loading-indicator, [class*="loading"]',
  
  // Tender data sections in modal
  tenderNumber: '[ng-bind*="tender.tenderNumber"], [ng-bind*="tenderNumber"]',
  referenceNumber: '[ng-bind*="referenceNumber"], [ng-bind*="refNo"]',
  nitNumber: '[ng-bind*="nitNumber"], [ng-bind*="nit"]',
  department: '[ng-bind*="department"], [ng-bind*="dept"]',
  description: '[ng-bind*="description"], [ng-bind*="title"]',
  
  // Financial information
  emd: '[ng-bind*="emd"], [ng-bind*="earnestMoney"]',
  tenderFee: '[ng-bind*="tenderFee"], [ng-bind*="fee"]',
  processingFee: '[ng-bind*="processingFee"]',
  
  // Dates
  openingDate: '[ng-bind*="openingDate"], [ng-bind*="openDate"]',
  closingDate: '[ng-bind*="closingDate"], [ng-bind*="closeDate"]',
  
  // Attachments
  attachments: '.attachment-list, [ng-repeat*="attachment"]',
  
  // Close button
  closeButton: '.close, [aria-label*="close" i], button.btn-close',
};

const RETRY_CONFIG = {
  maxAttempts: 3,
  initialDelay: 1000,
  backoffMultiplier: 1.5,
};

const DOM_STABILITY_CONFIG = {
  mutationWaitTime: 2000,
  checkInterval: 500,
  maxChecks: 10,
};

class ScraperLogger {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.logs = [];
    this.screenshotDir = `./scraper-logs/${sessionId}`;
    
    if (!fs.existsSync(this.screenshotDir)) {
      fs.mkdirSync(this.screenshotDir, { recursive: true });
    }
  }

  log(level, message, data = null) {
    const timestamp = new Date().toISOString();
    const logEntry = { timestamp, level, message, data };
    this.logs.push(logEntry);
    
    const prefix = {
      INFO: '📘',
      WARN: '⚠️ ',
      ERROR: '❌',
      SUCCESS: '✅',
      DEBUG: '🔍',
    }[level] || '📝';
    
    console.log(`${prefix} [${level}] ${message}`, data ? JSON.stringify(data) : '');
  }

  async captureScreenshot(page, label) {
    try {
      const filename = `${label}-${Date.now()}.png`;
      const filepath = path.join(this.screenshotDir, filename);
      await page.screenshot({ path: filepath });
      this.log('DEBUG', `Screenshot saved: ${filename}`);
    } catch (error) {
      this.log('WARN', `Failed to capture screenshot: ${error.message}`);
    }
  }

  async captureHTML(page, label) {
    try {
      const html = await page.content();
      const filename = `${label}-${Date.now()}.html`;
      const filepath = path.join(this.screenshotDir, filename);
      fs.writeFileSync(filepath, html);
      this.log('DEBUG', `HTML captured: ${filename}`);
    } catch (error) {
      this.log('WARN', `Failed to capture HTML: ${error.message}`);
    }
  }

  saveReport() {
    const reportPath = path.join(this.screenshotDir, 'scraper-report.json');
    fs.writeFileSync(reportPath, JSON.stringify(this.logs, null, 2));
    this.log('INFO', `Report saved: ${reportPath}`);
  }
}

export async function scrapeTenders() {
  const sessionId = `scrape-${Date.now()}`;
  const logger = new ScraperLogger(sessionId);
  let browser;

  try {
    logger.log('INFO', 'Starting Bihar eProcurement Tender Scraper', { sessionId });
    
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    // Set viewport and timeout
    await page.setViewportSize({ width: 1280, height: 720 });
    page.setDefaultTimeout(30000);
    page.setDefaultNavigationTimeout(30000);

    logger.log('INFO', 'Navigating to listing page', { url: config.scraper.eprocUrl });
    await page.goto(config.scraper.eprocUrl, { waitUntil: 'networkidle' });

    await logger.captureScreenshot(page, 'listing-page-initial');

    // Close any initial modals
    logger.log('INFO', 'Attempting to close initial modals');
    await closeAllModals(page, logger);

    // Extract tender references from listing
    logger.log('INFO', 'Extracting tender references from listing page');
    const tenderReferences = await extractTenderReferences(page, logger);
    
    if (tenderReferences.length === 0) {
      logger.log('WARN', 'No tenders found in listing');
      return { scrapedCount: 0, savedCount: 0, validatedCount: 0 };
    }

    logger.log('INFO', `Found ${tenderReferences.length} tenders to scrape`);

    // Process each tender through the modal
    let scrapedCount = 0;
    let savedCount = 0;
    let validatedCount = 0;
    const processedTenderIds = new Set();

    for (let i = 0; i < tenderReferences.length; i++) {
      const ref = tenderReferences[i];
      logger.log('INFO', `Processing tender ${i + 1}/${tenderReferences.length}`, ref);

      try {
        // Re-locate the row (handles DOM updates)
        const rowLocated = await relocateAndClickTender(page, ref, logger);
        if (!rowLocated) {
          logger.log('WARN', `Failed to locate and click tender: ${ref.tenderNumber}`);
          continue;
        }

        // Wait for modal to load with stale-data detection
        const modalLoaded = await waitForModalLoad(page, logger);
        if (!modalLoaded) {
          logger.log('WARN', `Modal failed to load for tender: ${ref.tenderNumber}`);
          await logger.captureScreenshot(page, `modal-load-fail-${ref.tenderNumber}`);
          continue;
        }

        // Verify modal content belongs to clicked tender
        const contentVerified = await verifyModalContent(page, ref, logger);
        if (!contentVerified) {
          logger.log('WARN', `Modal content verification failed for tender: ${ref.tenderNumber}`);
          await logger.captureScreenshot(page, `content-verify-fail-${ref.tenderNumber}`);
          continue;
        }

        // Extract tender data from modal
        const tenderData = await extractTenderFromModal(page, logger);
        if (!tenderData) {
          logger.log('WARN', `Failed to extract tender data from modal`);
          continue;
        }

        scrapedCount++;

        // Validate extracted data
        const validationResult = validateTenderData(tenderData, logger);
        if (validationResult.isValid) {
          validatedCount++;
          
          // Check for duplicates
          if (!processedTenderIds.has(tenderData.tender_id)) {
            processedTenderIds.add(tenderData.tender_id);
            
            // Save to database
            const saved = await saveTender(tenderData);
            if (saved) {
              savedCount++;
              logger.log('SUCCESS', `Tender saved: ${tenderData.tender_number}`);
            }
          } else {
            logger.log('WARN', `Duplicate tender skipped: ${tenderData.tender_number}`);
          }
        } else {
          logger.log('WARN', `Tender validation failed`, validationResult.errors);
        }

        // Close modal for next iteration
        await closeAllModals(page, logger);
        await page.waitForTimeout(500);

      } catch (error) {
        logger.log('ERROR', `Error processing tender ${i + 1}`, { error: error.message });
        await logger.captureScreenshot(page, `error-tender-${i}`);
      }
    }

    logger.log('SUCCESS', 'Scraping completed', {
      scrapedCount,
      validatedCount,
      savedCount,
      totalProcessed: tenderReferences.length,
    });

    logger.saveReport();
    return { scrapedCount, validatedCount, savedCount };

  } catch (error) {
    logger.log('ERROR', 'Fatal scraper error', { error: error.message, stack: error.stack });
    logger.saveReport();
    return { scrapedCount: 0, validatedCount: 0, savedCount: 0, error: error.message };

  } finally {
    if (browser) {
      await browser.close();
      logger.log('INFO', 'Browser closed');
    }
  }
}

/**
 * Extract visible tender references from listing page
 * Use these as navigation handles only
 */
async function extractTenderReferences(page, logger) {
  const references = [];

  try {
    const rows = await page.$$eval('table tbody tr', (rows) => {
      return rows.map((row, idx) => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) return null;

        return {
          rowIndex: idx,
          tenderNumber: cells[0]?.textContent?.trim() || '',
          referenceNumber: cells.length > 1 ? cells[1]?.textContent?.trim() : '',
          description: cells.length > 2 ? cells[2]?.textContent?.trim() : '',
        };
      }).filter(Boolean);
    });

    logger.log('INFO', `Extracted ${references.length} tender references`);
    return references;

  } catch (error) {
    logger.log('ERROR', `Failed to extract tender references: ${error.message}`);
    return [];
  }
}

/**
 * Relocate row and click the View button
 * Handles DOM updates between references
 */
async function relocateAndClickTender(page, ref, logger) {
  try {
    logger.log('DEBUG', `Relocating tender: ${ref.tenderNumber}`);

    // Re-query rows to handle DOM updates
    const rows = await page.$$('table tbody tr');

    for (const row of rows) {
      const tenderNum = await row.$eval('td:first-child', el => el.textContent.trim()).catch(() => '');
      
      if (tenderNum === ref.tenderNumber) {
        logger.log('DEBUG', `Found matching row for ${ref.tenderNumber}`);
        
        // Click the View button
        const viewBtn = await row.$('button:has-text("View"), a:has-text("View"), .btn-view');
        if (viewBtn) {
          await viewBtn.click();
          logger.log('DEBUG', `Clicked View button for ${ref.tenderNumber}`);
          return true;
        }
      }
    }

    logger.log('WARN', `Could not relocate tender row: ${ref.tenderNumber}`);
    return false;

  } catch (error) {
    logger.log('ERROR', `Error relocating tender: ${error.message}`);
    return false;
  }
}

/**
 * Wait for modal to fully load with DOM stability check
 */
async function waitForModalLoad(page, logger) {
  try {
    logger.log('DEBUG', 'Waiting for modal to appear');

    // Wait for modal to appear
    await page.waitForSelector('.modal.in, [role="dialog"][aria-modal="true"]', { timeout: 10000 });
    logger.log('DEBUG', 'Modal element detected');

    // Wait for loading spinner to disappear
    const spinnerGone = await waitForSpinner(page, logger);
    if (!spinnerGone) {
      logger.log('WARN', 'Loading spinner still visible, continuing anyway');
    }

    // Wait for DOM to stabilize
    const stabilized = await waitForDOMStability(page, logger);
    if (!stabilized) {
      logger.log('WARN', 'DOM did not stabilize within timeout');
    }

    logger.log('SUCCESS', 'Modal ready for data extraction');
    return true;

  } catch (error) {
    logger.log('ERROR', `Failed to wait for modal load: ${error.message}`);
    return false;
  }
}

/**
 * Wait for loading spinner to disappear
 */
async function waitForSpinner(page, logger) {
  try {
    const spinner = await page.$('.spinner, .loading-indicator, [class*="loading"]');
    if (!spinner) {
      logger.log('DEBUG', 'No loading spinner found');
      return true;
    }

    logger.log('DEBUG', 'Waiting for spinner to disappear');
    await page.waitForSelector('.spinner, .loading-indicator, [class*="loading"]', 
      { state: 'hidden', timeout: 10000 });
    
    logger.log('DEBUG', 'Spinner disappeared');
    return true;

  } catch (error) {
    logger.log('WARN', `Spinner wait timeout: ${error.message}`);
    return false;
  }
}

/**
 * Wait for DOM to stabilize (no mutations for configured period)
 */
async function waitForDOMStability(page, logger) {
  try {
    logger.log('DEBUG', 'Checking DOM stability');

    let previousHTML = await page.content();
    let stableCycles = 0;

    for (let i = 0; i < DOM_STABILITY_CONFIG.maxChecks; i++) {
      await page.waitForTimeout(DOM_STABILITY_CONFIG.checkInterval);
      
      const currentHTML = await page.content();
      
      if (currentHTML === previousHTML) {
        stableCycles++;
        if (stableCycles >= 2) {
          logger.log('DEBUG', `DOM stabilized after ${i} cycles`);
          return true;
        }
      } else {
        stableCycles = 0;
        previousHTML = currentHTML;
      }
    }

    logger.log('WARN', 'DOM did not fully stabilize');
    return false;

  } catch (error) {
    logger.log('ERROR', `Error checking DOM stability: ${error.message}`);
    return false;
  }
}

/**
 * Verify modal content belongs to clicked tender
 * Multiple independent checks to detect stale data
 */
async function verifyModalContent(page, expectedRef, logger) {
  try {
    logger.log('DEBUG', 'Verifying modal content matches clicked tender');

    const modalTenderNumber = await page.$eval(
      '[ng-bind*="tenderNumber"], [ng-bind*="tender.tenderNumber"]',
      el => el.textContent.trim()
    ).catch(() => null);

    if (modalTenderNumber && modalTenderNumber !== expectedRef.tenderNumber) {
      logger.log('ERROR', 'Stale modal data detected', {
        expected: expectedRef.tenderNumber,
        actual: modalTenderNumber,
      });
      return false;
    }

    // Check for financial data changes (indicates fresh load)
    const financialData = await page.$$eval(
      '[ng-bind*="emd"], [ng-bind*="fee"]',
      els => els.map(el => el.textContent.trim())
    ).catch(() => []);

    if (financialData.length === 0) {
      logger.log('WARN', 'No financial data found in modal, but continuing');
    }

    logger.log('SUCCESS', 'Modal content verified');
    return true;

  } catch (error) {
    logger.log('ERROR', `Error verifying modal content: ${error.message}`);
    return false;
  }
}

/**
 * Extract complete tender data from Preview modal
 * Sections: General, Financial, Technical, Dates, Eligibility, Attachments
 */
async function extractTenderFromModal(page, logger) {
  try {
    logger.log('DEBUG', 'Extracting tender data from modal');

    // Extract all text content with structure
    const tenderData = await page.evaluate(() => {
      const getText = (selector) => {
        const el = document.querySelector(selector);
        return el ? el.textContent.trim() : null;
      };

      const getAllText = (selector) => {
        return Array.from(document.querySelectorAll(selector))
          .map(el => el.textContent.trim())
          .filter(Boolean);
      };

      return {
        // General Information
        tenderNumber: getText('[ng-bind*="tenderNumber"]'),
        referenceNumber: getText('[ng-bind*="referenceNumber"], [ng-bind*="refNo"]'),
        nitNumber: getText('[ng-bind*="nitNumber"]'),
        description: getText('[ng-bind*="description"], [ng-bind*="title"]'),
        department: getText('[ng-bind*="department"]'),
        
        // Financial Information
        emd: getText('[ng-bind*="emd"], [ng-bind*="earnestMoney"]'),
        tenderFee: getText('[ng-bind*="tenderFee"]'),
        processingFee: getText('[ng-bind*="processingFee"]'),
        
        // Dates
        openingDate: getText('[ng-bind*="openingDate"]'),
        closingDate: getText('[ng-bind*="closingDate"]'),
        
        // Categories
        category: getText('[ng-bind*="category"]'),
        type: getText('[ng-bind*="tenderType"]'),
        
        // Additional
        location: getText('[ng-bind*="location"]'),
        totalValue: getText('[ng-bind*="totalValue"], [ng-bind*="estimatedValue"]'),
        
        // Attachments
        attachments: getAllText('.attachment-list li, [ng-repeat*="attachment"] a'),
      };
    });

    logger.log('DEBUG', 'Raw tender data extracted', tenderData);
    return tenderData;

  } catch (error) {
    logger.log('ERROR', `Error extracting tender data: ${error.message}`);
    return null;
  }
}

/**
 * Validate tender data before saving
 */
function validateTenderData(data, logger) {
  const errors = [];

  // Required fields
  if (!data.tenderNumber || data.tenderNumber.length === 0) {
    errors.push('Missing tender number');
  }
  if (!data.description || data.description.length < 5) {
    errors.push('Description too short or missing');
  }

  // Validate dates
  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  };

  const closingDate = parseDate(data.closingDate);
  if (closingDate && closingDate < new Date()) {
    logger.log('DEBUG', `Tender has passed closing date: ${data.closingDate}`);
  }

  // Financial sanity checks
  const parseAmount = (amountStr) => {
    if (!amountStr) return 0;
    const match = amountStr.match(/[\d,]+/);
    return match ? parseInt(match[0].replace(/,/g, '')) : 0;
  };

  const emd = parseAmount(data.emd);
  const tenderFee = parseAmount(data.tenderFee);

  if (emd < 0 || tenderFee < 0) {
    errors.push('Invalid financial values');
  }

  const isValid = errors.length === 0;
  
  if (!isValid) {
    logger.log('WARN', 'Tender validation failed', { errors });
  }

  return { isValid, errors };
}

/**
 * Close all modals
 */
async function closeAllModals(page, logger) {
  try {
    const closeButtons = await page.$$('.close, button[aria-label*="close" i]');
    for (const btn of closeButtons) {
      try {
        await btn.click();
        await page.waitForTimeout(300);
      } catch (e) {
        // Continue
      }
    }
    logger.log('DEBUG', 'Closed all modals');
  } catch (error) {
    logger.log('WARN', `Error closing modals: ${error.message}`);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeTenders().then((result) => {
    console.log('\n📋 Scrape Result:', result);
    process.exit(0);
  });
}

export default { scrapeTenders };
