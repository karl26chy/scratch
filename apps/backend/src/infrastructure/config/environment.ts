import dotenv from 'dotenv';
import { StealthLevel } from '../../domain/types/scraper.types.js';

dotenv.config();

export interface AppConfig {
  port: number;
  nodeEnv: string;
  frontendOrigin: string;
  headlessMode: boolean;
  defaultStealthLevel: StealthLevel;
  maxConcurrentBrowsers: number;
  browserTimeoutMs: number;
}

export const env: AppConfig = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  headlessMode: process.env.HEADLESS_MODE !== 'false',
  defaultStealthLevel: 'paranoid', // Maximum stealth evasion by default
  maxConcurrentBrowsers: parseInt(process.env.MAX_CONCURRENT_BROWSERS || '15', 10),
  browserTimeoutMs: parseInt(process.env.BROWSER_TIMEOUT_MS || '30000', 10),
};
