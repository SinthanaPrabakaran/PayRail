import { database } from '../../src/config/database';
import { mongoManager } from '../../src/config/mongo';
import { redisManager } from '../../src/config/redis';
import { rabbitmqManager } from '../../src/config/rabbitmq';

jest.mock('../../src/config/mongo');
jest.mock('../../src/config/redis');
jest.mock('../../src/config/rabbitmq');

describe('Database Infrastructure Delegation (Unit)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should delegate mongo methods to mongoManager', async () => {
    (mongoManager.connect as jest.Mock).mockResolvedValue(undefined);
    (mongoManager.disconnect as jest.Mock).mockResolvedValue(undefined);
    (mongoManager.getStatus as jest.Mock).mockReturnValue('up');
    (mongoManager.checkStatus as jest.Mock).mockResolvedValue('up');
    (mongoManager.verifyTransactionSupport as jest.Mock).mockResolvedValue(true);

    await database.connectMongo(3, 100);
    expect(mongoManager.connect).toHaveBeenCalledWith(3, 100);

    await database.disconnectMongo();
    expect(mongoManager.disconnect).toHaveBeenCalled();

    expect(database.getMongoStatus()).toBe('up');
    expect(await database.checkMongoStatus()).toBe('up');
    expect(await database.verifyMongoTransactions()).toBe(true);
  });

  it('should delegate redis methods to redisManager', async () => {
    (redisManager.connect as jest.Mock).mockResolvedValue(undefined);
    (redisManager.disconnect as jest.Mock).mockResolvedValue(undefined);
    (redisManager.checkStatus as jest.Mock).mockResolvedValue('up');
    (redisManager.getClient as jest.Mock).mockReturnValue({ status: 'ready' });

    await database.connectRedis(2, 50);
    expect(redisManager.connect).toHaveBeenCalledWith(2, 50);

    await database.closeRedis();
    expect(redisManager.disconnect).toHaveBeenCalled();

    expect(await database.checkRedisStatus()).toBe('up');
    expect(database.getRedisClient()).toEqual({ status: 'ready' });
  });

  it('should delegate rabbitmq methods to rabbitmqManager', async () => {
    (rabbitmqManager.connect as jest.Mock).mockResolvedValue(undefined);
    (rabbitmqManager.disconnect as jest.Mock).mockResolvedValue(undefined);
    (rabbitmqManager.checkStatus as jest.Mock).mockResolvedValue('up');

    await database.connectRabbitMQ(1, 10);
    expect(rabbitmqManager.connect).toHaveBeenCalledWith(1, 10);

    await database.closeRabbitMQ();
    expect(rabbitmqManager.disconnect).toHaveBeenCalled();

    expect(await database.checkRabbitMQStatus()).toBe('up');
  });

  it('should handle partial errors in initializeAll gracefully', async () => {
    (mongoManager.connect as jest.Mock).mockResolvedValue(undefined);
    (redisManager.connect as jest.Mock).mockRejectedValue(new Error('Redis connection refused'));
    (rabbitmqManager.connect as jest.Mock).mockResolvedValue(undefined);

    const result = await database.initializeAll(1, 10);
    expect(result.mongo).toBe(true);
    expect(result.redis).toBe(false);
    expect(result.rabbitmq).toBe(true);
  });
});
