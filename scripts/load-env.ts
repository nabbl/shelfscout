import { loadEnvConfig } from '@next/env';

// Match Next's .env.local precedence and escaped-dollar handling in the worker.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
