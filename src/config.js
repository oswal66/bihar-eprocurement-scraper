import dotenv from 'dotenv';

dotenv.config();

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
    key: process.env.SUPABASE_KEY,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  scraper: {
    interval: parseInt(process.env.SCRAPE_INTERVAL) || 3600000, // 1 hour
    eprocUrl: process.env.EPROC_URL || 'https://ihar.bihar.gov.in/eproc2/',
  },
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

export default config;
