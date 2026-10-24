/**
 * PayRail Database Seeding Script Placeholder (Phase 1)
 *
 * Future phases will populate ledger accounts, test wallets,
 * and demo credentials for simulated runs.
 */
import { logger } from '../src/shared/logger.js';

async function main(): Promise<void> {
  logger.info('Starting PayRail database seed...');
  logger.info('Phase 1 skeleton: no seed data to apply yet.');
}

main().catch((err) => {
  logger.error('Seed script encountered error', { err });
  process.exit(1);
});
