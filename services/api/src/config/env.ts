import 'dotenv/config';
import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .url()
      .refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol), {
        message: 'must be a PostgreSQL connection URL',
      }),
    JWT_SECRET: z
      .string()
      .refine((value) => Buffer.byteLength(value, 'utf8') >= 32, {
        message: 'must contain at least 32 bytes',
      })
      .refine((value) => !/^(replace|change[-_]?me|your[-_])/i.test(value), {
        message: 'must not be a placeholder value',
      }),
    JWT_ISSUER: z.string().min(1).default('service-remoto-api'),
    JWT_AUDIENCE: z.string().min(1).default('service-remoto-client'),
    CLIENT_ORIGIN: z
      .string()
      .url()
      .refine((value) => new URL(value).origin === value, {
        message: 'must contain only the origin, without a path',
      })
      .optional(),
    DIAGNOSTIC_CONSENT_VERSION: z.string().min(1).default('2026-09-24-v1'),
  })
  .superRefine((values, context) => {
    if (values.NODE_ENV === 'production' || values.NODE_ENV === 'staging') {
      if (!values.CLIENT_ORIGIN) {
        context.addIssue({
          code: 'custom',
          path: ['CLIENT_ORIGIN'],
          message: 'must be explicitly configured in staging and production',
        });
      } else if (new URL(values.CLIENT_ORIGIN).protocol !== 'https:') {
        context.addIssue({
          code: 'custom',
          path: ['CLIENT_ORIGIN'],
          message: 'must use HTTPS in staging and production',
        });
      }
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const issues = parsedEnv.error.issues
    .map(({ path, message }) => `${path.join('.') || 'environment'}: ${message}`)
    .join('; ');
  throw new Error(`Invalid API environment configuration: ${issues}`);
}

export const env = {
  ...parsedEnv.data,
  CLIENT_ORIGIN: parsedEnv.data.CLIENT_ORIGIN ?? 'http://localhost:5173',
};
