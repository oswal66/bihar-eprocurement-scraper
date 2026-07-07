import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import config from './config.js';
import {
  getAllTenders,
  getTenderById,
  getTendersByDepartment,
  getTendersByStatus,
  getUpcomingTenders,
  getTenderCount,
} from './database.js';
import { scrapeTenders } from './scraper.js';
import { startScheduler, getSchedulerStatus } from './scheduler.js';

const app = express();

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// API Routes

/**
 * GET /api/tenders - Get all tenders with pagination
 */
app.get('/api/tenders', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;
    const data = await getAllTenders(limit, offset);
    const count = await getTenderCount();

    res.json({
      success: true,
      count,
      limit,
      offset,
      data,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tenders/:id - Get tender by ID
 */
app.get('/api/tenders/:id', async (req, res) => {
  try {
    const tender = await getTenderById(req.params.id);
    if (!tender) {
      return res.status(404).json({ success: false, error: 'Tender not found' });
    }
    res.json({ success: true, data: tender });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tenders/department/:department - Get tenders by department
 */
app.get('/api/tenders/department/:department', async (req, res) => {
  try {
    const tenders = await getTendersByDepartment(req.params.department);
    res.json({ success: true, count: tenders.length, data: tenders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tenders/status/:status - Get tenders by status
 */
app.get('/api/tenders/status/:status', async (req, res) => {
  try {
    const tenders = await getTendersByStatus(req.params.status);
    res.json({ success: true, count: tenders.length, data: tenders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/tenders/upcoming - Get upcoming tenders
 */
app.get('/api/upcoming', async (req, res) => {
  try {
    const daysAhead = parseInt(req.query.days) || 7;
    const tenders = await getUpcomingTenders(daysAhead);
    res.json({ success: true, daysAhead, count: tenders.length, data: tenders });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/scrape/trigger - Trigger immediate scrape
 */
app.post('/api/scrape/trigger', async (req, res) => {
  try {
    const result = await scrapeTenders();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/scrape/status - Get scraper status
 */
app.get('/api/scrape/status', (req, res) => {
  try {
    const status = getSchedulerStatus();
    res.json({ success: true, ...status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/stats - Get statistics
 */
app.get('/api/stats', async (req, res) => {
  try {
    const count = await getTenderCount();
    const schedulerStatus = getSchedulerStatus();
    res.json({
      success: true,
      totalTenders: count,
      lastScrapedAt: schedulerStatus.lastScrapedAt,
      isScrapingInProgress: schedulerStatus.isScrapingInProgress,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Server error:', error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

// Start server and scheduler
const PORT = config.server.port;

app.listen(PORT, () => {
  console.log(`\nBihar eProcurement Tender Scraper`);
  console.log(`================================`);
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${config.server.nodeEnv}`);
  console.log(`\nAPI Documentation:`);
  console.log(`- GET  /health                    - Health check`);
  console.log(`- GET  /api/tenders               - Get all tenders`);
  console.log(`- GET  /api/tenders/:id           - Get tender by ID`);
  console.log(`- GET  /api/tenders/department/:dept - Get by department`);
  console.log(`- GET  /api/upcoming              - Get upcoming tenders`);
  console.log(`- POST /api/scrape/trigger        - Trigger immediate scrape`);
  console.log(`- GET  /api/scrape/status         - Get scraper status`);
  console.log(`- GET  /api/stats                 - Get statistics`);
  console.log(`\n`);

  // Start the scheduler
  startScheduler();
});

export default app;
