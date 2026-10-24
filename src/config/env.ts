import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_PREFIX: z.string().default('/api/v1'),
  APP_NAME: z.string().default('PayRail'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly', 'silent'])
    .default('info'),
  MONGODB_URI: z
    .string()
    .url()
    .or(z.string().startsWith('mongodb://'))
    .or(z.string().startsWith('mongodb+srv://'))
    .default('mongodb://localhost:27017/payrail'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  RABBITMQ_URL: z
    .string()
    .url()
    .or(z.string().startsWith('amqp://'))
    .or(z.string().startsWith('amqps://'))
    .default('amqp://guest:guest@localhost:5672'),
  CORS_ORIGIN: z.string().default('*'),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error(
    '❌ Invalid environment configuration:',
    JSON.stringify(parsedEnv.error.format(), null, 2),
  );
  process.exit(1);
}

export const env = parsedEnv.data;
export type EnvConfig = z.infer<typeof envSchema>;
