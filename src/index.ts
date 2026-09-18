// Core exports
export { BaileysTransporter } from './infrastructure/repositories/baileys.repository';
export { LeadCreate } from './application/lead.create';
export { ContainerBuilder } from 'node-dependency-injection';
export { default as container } from './infrastructure/ioc';

// MySQL & Auth exports for custom integrations
export {
    useMySQLAuthState,
    clearSessionMemoryCache,
    deleteSessionAuth,
    clearMySQLSessionForJid
} from './infrastructure/auth/mysql.auth';
export { default as pool } from './infrastructure/database/connection';
