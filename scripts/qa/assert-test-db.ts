import { assertSafeTestDatabase } from '../../api/src/db/test-database-guard.js';
assertSafeTestDatabase(process.env.TEST_DATABASE_URL, process.env.DATABASE_URL);
