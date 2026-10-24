import winston from 'winston';
import { env } from '../config/env.js';

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

winston.addColors(colors);

const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.errors({ stack: true }),
  env.NODE_ENV === 'production'
    ? winston.format.json()
    : winston.format.printf(
        (info) =>
          `[${info.timestamp}] [${info.level.toUpperCase()}]${
            info.requestId ? ` [reqId: ${info.requestId}]` : ''
          }: ${info.message}${info.stack ? `\n${info.stack}` : ''}`,
      ),
);

const transports = [
  new winston.transports.Console({
    silent: env.LOG_LEVEL === 'silent',
  }),
];

export const logger = winston.createLogger({
  level: env.LOG_LEVEL === 'silent' ? 'info' : env.LOG_LEVEL,
  levels,
  format,
  transports,
});
