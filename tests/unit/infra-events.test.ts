import mongoose from 'mongoose';
import { mongoManager } from '../../src/config/mongo';
import { redisManager } from '../../src/config/redis';
import { rabbitmqManager } from '../../src/config/rabbitmq';

describe('Config Managers Error Event Listeners (Unit)', () => {
  it('mongo connection events trigger state updates', () => {
    mongoose.connection.emit('error', new Error('Mongo socket error'));
    expect(mongoManager.getStatus()).toBe('down');

    mongoose.connection.emit('disconnected');
    expect(mongoManager.getStatus()).toBe('down');
  });

  it('redis client events trigger state updates', () => {
    const client = redisManager.getClient();
    client.emit('error', new Error('Redis connection error'));
    expect(redisManager.getStatus()).toBe('down');

    client.emit('close');
    expect(redisManager.getStatus()).toBe('down');
  });

  it('rabbitmq connection events trigger state updates', () => {
    const conn = rabbitmqManager.getConnection();
    if (conn) {
      conn.emit('error', new Error('RabbitMQ mock error'));
      expect(rabbitmqManager.getStatus()).toBe('down');
    }
  });
});
