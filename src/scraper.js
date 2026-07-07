import axios from 'axios';
import * as cheerio from 'cheerio';
import config from './config.js';
import { saveTender } from './database.js';

/**
 * Scrape tender data from IHAR eProcurement website
 */
export async function scrapeTenders() {
  try {
    console.log('Starting tender scrape...');
    console.log(`Fetching from: ${config.scraper.eprocUrl}`);

    // Fetch the webpage
    const response = await axios.get(config.scraper.eprocUrl, {
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    let scrapedCount = 0;
    let savedCount = 0;

    // Parse tender table - Adjust selectors based on actual website structure
    // Common selectors for tender tables
    const rows = $('table tbody tr');

    if (rows.length === 0) {
      console.warn('No tender rows found. The website structure may have changed.');
      return { scrapedCount: 0, savedCount: 0 };
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows.eq(i);
      const cells = row.find('td');

      if (cells.length < 4) continue;

      try {
        // Extract data from cells - Adjust indices based on actual column order
        const tenderNumber = cells.eq(0).text().trim() || `TENDER_${Date.now()}_${i}`;
        const description = cells.eq(1).text().trim();
        const department = cells.eq(2).text().trim();
        const closingDateStr = cells.eq(3).text().trim();

        // Parse dates
        const closingDate = parseDate(closingDateStr);
        const openingDate = new Date(); // Default to today if not available

        // Extract link if available
        const documentLink = row.find('a').attr('href') || '';

        const tenderData = {
          tender_id: generateTenderId(tenderNumber),
          tender_number: tenderNumber,
          description: description,
          department: department,
          tender_type: extractTenderType(description),
          opening_date: openingDate,
          closing_date: closingDate,
          tender_value: extractTenderValue(description),
          category: extractCategory(description),
          location: department, // Using department as location for now
          document_link: documentLink,
          status: closingDate > new Date() ? 'Active' : 'Closed',
        };

        scrapedCount++;

        // Save to database
        const saved = await saveTender(tenderData);
        if (saved) {
          savedCount++;
        }
      } catch (error) {
        console.error(`Error processing row ${i}:`, error.message);
      }
    }

    console.log(`Scrape completed: ${scrapedCount} tenders found, ${savedCount} saved`);
    return { scrapedCount, savedCount };
  } catch (error) {
    console.error('Scraping error:', error.message);
    return { scrapedCount: 0, savedCount: 0, error: error.message };
  }
}

/**
 * Parse date string to Date object
 */
function parseDate(dateStr) {
  if (!dateStr) return new Date();

  // Try common date formats
  const formats = [
    /\d{1,2}[-/]\d{1,2}[-/]\d{4}/, // DD-MM-YYYY or DD/MM/YYYY
    /\d{4}[-/]\d{1,2}[-/]\d{1,2}/, // YYYY-MM-DD
  ];

  for (const format of formats) {
    const match = dateStr.match(format);
    if (match) {
      return new Date(match[0]);
    }
  }

  return new Date();
}

/**
 * Generate unique tender ID
 */
function generateTenderId(tenderNumber) {
  return `BIHAR_${tenderNumber}_${Date.now()}`;
}

/**
 * Extract tender type from description
 */
function extractTenderType(description) {
  const lowerDesc = description.toLowerCase();
  if (lowerDesc.includes('supply')) return 'Supply';
  if (lowerDesc.includes('works')) return 'Works';
  if (lowerDesc.includes('service')) return 'Service';
  if (lowerDesc.includes('construction')) return 'Works';
  return 'Other';
}

/**
 * Extract tender value from description
 */
function extractTenderValue(description) {
  const matches = description.match(/₹[\d,]+|Rs\.\s*[\d,]+/i);
  if (matches) {
    const valueStr = matches[0].replace(/[₹Rs.\s]/g, '').replace(/,/g, '');
    return parseFloat(valueStr) || null;
  }
  return null;
}

/**
 * Extract category from description
 */
function extractCategory(description) {
  const lowerDesc = description.toLowerCase();
  if (lowerDesc.includes('it') || lowerDesc.includes('software')) return 'IT';
  if (lowerDesc.includes('construction')) return 'Construction';
  if (lowerDesc.includes('medical')) return 'Medical';
  if (lowerDesc.includes('equipment')) return 'Equipment';
  return 'General';
}

// Run scraper if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeTenders().then((result) => {
    console.log('Result:', result);
    process.exit(0);
  });
}

export default { scrapeTenders };
