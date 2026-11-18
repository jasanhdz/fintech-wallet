import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitialWallet1763000000000 } from './migrations/1763000000000-InitialWallet.js';
import { LedgerTransactionAppendOnly1763000001000 } from './migrations/1763000001000-LedgerTransactionAppendOnly.js';
import { RuntimeLeastPrivilege1763000002000 } from './migrations/1763000002000-RuntimeLeastPrivilege.js';

let instance: DataSource | undefined;
let instanceUrl: string | undefined;
export const dataSource = (url = process.env.DATABASE_URL) => {
  if (instance && instanceUrl !== url) throw new Error('Database connection already configured for a different URL');
  if (!instance) { instanceUrl = url; instance = new DataSource({ type: 'postgres', url, entities: [], migrations: [InitialWallet1763000000000, LedgerTransactionAppendOnly1763000001000, RuntimeLeastPrivilege1763000002000], synchronize: false, migrationsRun: false }); }
  return instance;
};
