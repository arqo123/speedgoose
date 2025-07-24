import { stopTestDB } from './testUtils';

export default async function globalTeardown() {
  await stopTestDB();
}