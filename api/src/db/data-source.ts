import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { InitialWallet1763000000000 } from './migrations/1763000000000-InitialWallet.js';
import { LedgerTransactionAppendOnly1763000001000 } from './migrations/1763000001000-LedgerTransactionAppendOnly.js';
import { RuntimeLeastPrivilege1763000002000 } from './migrations/1763000002000-RuntimeLeastPrivilege.js';
import { InternalBeneficiaries1763000003000 } from './migrations/1763000003000-InternalBeneficiaries.js';
import { Transfers1763000004000 } from './migrations/1763000004000-Transfers.js';
import { TransferRuntimeGrants1763000005000 } from './migrations/1763000005000-TransferRuntimeGrants.js';
import { TransferRuntimePrivileges1763000006000 } from './migrations/1763000006000-TransferRuntimePrivileges.js';
import { TransferOtpAndLedgerHardening1763000007000 } from './migrations/1763000007000-TransferOtpAndLedgerHardening.js';
import { TransferTerminalStates1763000008000 } from './migrations/1763000008000-TransferTerminalStates.js';
import { TransferAttemptRecovery1763000009000 } from './migrations/1763000009000-TransferAttemptRecovery.js';

let instance: DataSource | undefined;
let instanceUrl: string | undefined;
export const dataSource = (url = process.env.DATABASE_URL) => {
  if (instance && instanceUrl !== url) throw new Error('Database connection already configured for a different URL');
  if (!instance) { instanceUrl = url; instance = new DataSource({ type: 'postgres', url, entities: [], migrations: [InitialWallet1763000000000, LedgerTransactionAppendOnly1763000001000, RuntimeLeastPrivilege1763000002000, InternalBeneficiaries1763000003000, Transfers1763000004000, TransferRuntimeGrants1763000005000, TransferRuntimePrivileges1763000006000, TransferOtpAndLedgerHardening1763000007000, TransferTerminalStates1763000008000, TransferAttemptRecovery1763000009000], synchronize: false, migrationsRun: false }); }
  return instance;
};
