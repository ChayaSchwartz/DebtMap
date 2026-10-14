import path from 'node:path';
import { config as loadEnv } from 'dotenv';
import { defineConfig, env } from 'prisma/config';

// One .env at the repository root serves the API, the Prisma CLI, and
// docker-compose. dotenv resolves relative to the working directory, which for
// the Prisma CLI is apps/api, so the root file is named explicitly.
loadEnv({ path: [path.resolve(__dirname, '../../.env'), path.resolve(__dirname, '.env')] });

/**
 * Prisma 7 reads the migration connection URL from here rather than from the
 * schema. The API itself connects through a driver adapter (see
 * `src/prisma/prisma.service.ts`); this file only serves the CLI.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
