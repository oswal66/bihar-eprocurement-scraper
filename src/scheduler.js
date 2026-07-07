import cron from 'node-cron';
import { scrapeTenders } from './scraper.js';
import config from './config.js';

let lastScrapedAt = null;
let isScrapingInProgress = false;

/**
 * Start scheduled scraping
 */
export function startScheduler() {
  console.log('Starting tender scraper scheduler...');
  console.log(`Scrape interval: ${config.scraper.interval}ms (${config.scraper.interval / 1000 / 60} minutes)`);

  // Initial scrape
  performScrape();

  // Schedule recurring scrapes
  const intervalMinutes = Math.max(1, Math.floor(config.scraper.interval / 60000));
  const cronExpression = `*/${intervalMinutes} * * * *`; // Every N minutes

  cron.schedule(cronExpression, () => {
    performScrape();
  });

  console.log('Scheduler started successfully');
}

/**
 * Perform scrape with error handling
 */
async function performScrape() {
  if (isScrapingInProgress) {
    console.log('Scrape already in progress, skipping...');
    return;
  }

  isScrapingInProgress = true;
  console.log(`\n[${new Date().toISOString()}] Starting scheduled scrape...`);

  try {
    const result = await scrapeTenders();
    lastScrapedAt = new Date();
    console.log(`Scrape completed. Scraped: ${result.scrapedCount}, Saved: ${result.savedCount}`);
  } catch (error) {
    console.error('Scrape error:', error);
  } finally {
    isScrapingInProgress = false;
  }
}

/**
 * Get scheduler status
 */
export function getSchedulerStatus() {
  return {
    lastScrapedAt,
    isScrapingInProgress,
    nextScrapeIn: lastScrapedAt ? calculateNextScrapeTime() : 'Pending',
  };
}

/**
 * Calculate time until next scrape
 */
function calculateNextScrapeTime() {
  if (!lastScrapedAt) return null;
  const nextTime = new Date(lastScrapedAt.getTime() + config.scraper.interval);
  const msUntilNext = nextTime.getTime() - Date.now();
  return Math.max(0, msUntilNext);
}

// Start scheduler if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startScheduler();
  console.log('Scheduler running. Press Ctrl+C to stop.');
}

export default { startScheduler, getSchedulerStatus };
