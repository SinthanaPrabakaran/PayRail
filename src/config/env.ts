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
  MONGO_PORT: z.coerce.number().default(27017),
  MONGO_DATABASE: z.string().default('payrail'),
  MONGODB_URI: z
    .string()
    .url()
    .or(z.string().startsWith('mongodb://'))
    .or(z.string().startsWith('mongodb+srv://'))
    .default('mongodb://127.0.0.1:27017/payrail?replicaSet=rs0&directConnection=true'),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  RABBITMQ_USER: z.string().default('payrail'),
  RABBITMQ_PASS: z.string().default('payrail_rabbit_pass_dev'),
  RABBITMQ_PORT: z.coerce.number().default(5672),
  RABBITMQ_MGMT_PORT: z.coerce.number().default(15672),
  RABBITMQ_URL: z
    .string()
    .url()
    .or(z.string().startsWith('amqp://'))
    .or(z.string().startsWith('amqps://'))
    .default('amqp://payrail:payrail_rabbit_pass_dev@127.0.0.1:5672'),
  CORS_ORIGIN: z.string().default('*'),
  JWT_SECRET: z.string().min(16).default('payrail_super_secret_jwt_key_dev_mode_32chars'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_ISSUER: z.string().default('payrail-auth'),
  JWT_AUDIENCE: z.string().default('payrail-api'),
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
