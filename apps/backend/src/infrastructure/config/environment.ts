import dotenv from 'dotenv';
import { StealthLevel } from '../../domain/types/scraper.types.js';

dotenv.config();

export interface ProxyConfig {
  enabled: boolean;
  provider: string;
  apiKey?: string;
  listUrl?: string;
  username?: string;
  password?: string;
  testUrl: string;
}

export interface SingleTestConfig {
  enabled: boolean;
  allowDirectIP: boolean;
  maxExecutions: number;
  executionCount: number;
}

export interface AppConfig {
  port: number;
  nodeEnv: string;
  frontendOrigin: string;
  headlessMode: boolean;
  defaultStealthLevel: StealthLevel;
  maxConcurrentBrowsers: number;
  browserTimeoutMs: number;
  debugDumpHtml: boolean;
  proxy: ProxyConfig;
  singleTest: SingleTestConfig;
}

export const env: AppConfig = {
  port: parseInt(process.env.PORT || '4000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:3000',
  headlessMode: process.env.HEADLESS_MODE !== 'false',
  defaultStealthLevel: 'paranoid', // Maximum stealth evasion by default
  maxConcurrentBrowsers: parseInt(process.env.MAX_CONCURRENT_BROWSERS || '15', 10),
  browserTimeoutMs: parseInt(process.env.BROWSER_TIMEOUT_MS || '30000', 10),
  debugDumpHtml: process.env.DEBUG_DUMP_HTML === 'true',
  proxy: {
    enabled: process.env.PROXY_ENABLED === 'true',
    provider: process.env.PROXY_PROVIDER || 'webshare',
    apiKey: process.env.PROXY_API_KEY,
    listUrl: process.env.PROXY_LIST_URL,
    username: process.env.PROXY_USERNAME,
    password: process.env.PROXY_PASSWORD,
    testUrl: process.env.PROXY_TEST_URL || 'https://api.ipify.org?format=json',
  },
  singleTest: {
    enabled: process.env.SINGLE_TEST_MODE === 'true',
    allowDirectIP: process.env.ALLOW_DIRECT_IP === 'true',
    maxExecutions: parseInt(process.env.MAX_TEST_EXECUTIONS || '1', 10),
    executionCount: 0,
  },
};
