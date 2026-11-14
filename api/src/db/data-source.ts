import 'reflect-metadata';
import { DataSource } from 'typeorm';

export const dataSource = (url = process.env.DATABASE_URL) => {
  if (!url) throw new Error('DATABASE_URL is required');
  return new DataSource({ type: 'postgres', url, entities: [], migrations: [], synchronize: false, migrationsRun: false });
};
