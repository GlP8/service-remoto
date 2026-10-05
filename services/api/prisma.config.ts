import 'dotenv/config';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';
import { env } from './src/config/env.js';

export default definePrismaConfig({
  orm: ormConfig({
    contract: "./prisma/schema.prisma",
    db: {
      connection: env.DATABASE_URL,
    },
  }),
});
