import { createApp } from '../src/app';
import { mongoManager } from '../src/config/mongo';
import { redisManager } from '../src/config/redis';
import { QueueManager, QUEUES, EXCHANGES, ROUTING_KEYS } from '../src/queues/queue.manager';
import { OutboxModel } from '../src/modules/outbox/outbox.model';
import { OutboxService } from '../src/modules/outbox/outbox.service';
import { ProcessedJobModel } from '../src/modules/jobs/processed-job.model';
import { NotificationWorker } from '../src/workers/notification.worker';
import { StatementWorker } from '../src/workers/statement.worker';
import { UserModel } from '../src/modules/auth/user.model';
import { WalletService } from '../src/modules/wallets/wallet.service';
import { generateAccessToken } from '../src/shared/token';
import request from 'supertest';
import { v4 as uuidv4 } from 'uuid';

describe('Phase 7: RabbitMQ Asynchronous Notifications, Statements, Outbox & DLQ', () => {
  const app = createApp();

  let notificationWorker: NotificationWorker;
  let statementWorker: StatementWorker;

  let testUser: { id: string; email: string };
  let authToken: string;
  let walletId: string;

  beforeAll(async () => {
    await mongoManager.connect(3, 1000);
    await redisManager.connect(3, 1000);
    await QueueManager.initializeTopology();

    // Clean test collections
    await UserModel.deleteMany({ email: /phase7.*@example\.com$/ });
    await OutboxModel.deleteMany({});
    await ProcessedJobModel.deleteMany({});

    // Create user and wallet
    const doc = await UserModel.create({
      email: 'phase7_worker_test@example.com',
      passwordHash: 'dummyhash',
      firstName: 'Worker',
      lastName: 'Tester',
    });
    testUser = { id: doc.id, email: doc.email };
    authToken = generateAccessToken(testUser).token;

    const w = await WalletService.getOrCreateWallet(testUser.id, 'INR');
    walletId = w.id;

    // Initialize and start workers
    notificationWorker = new NotificationWorker({ prefetch: 5, maxRetries: 3 });
    statementWorker = new StatementWorker({ prefetch: 2, maxRetries: 3 });

    await notificationWorker.start();
    await statementWorker.start();
  });

  afterAll(async () => {
    await notificationWorker.stop();
    await statementWorker.stop();
    await UserModel.deleteMany({ email: /phase7.*@example\.com$/ });
    await OutboxModel.deleteMany({});
    await ProcessedJobModel.deleteMany({});
    await QueueManager.close();
    await mongoManager.disconnect();
    await redisManager.disconnect();
  });

  describe('1. Successful Asynchronous Notification Processing & Outbox Flow', () => {
    it('should persist notification in MongoDB Outbox and deliver via RabbitMQ worker', async () => {
      const eventId = uuidv4();
      const correlationId = uuidv4();

      // Enqueue in Outbox
      await OutboxService.enqueue(eventId, ROUTING_KEYS.NOTIFICATION, {
        version: '1.0',
        eventId,
        correlationId,
        timestamp: new Date().toISOString(),
        producer: 'payrail-test',
        retryCount: 0,
        topic: 'notification.dispatch',
        payload: {
          recipientUserId: testUser.id,
          type: 'FUNDS_DEPOSITED',
          channel: 'IN_APP',
          title: 'Deposit Successful',
          body: 'Your wallet has been credited with 10000 Paise.',
        },
      });

      // Verify outbox document is PENDING initially
      const outboxEntry = await OutboxModel.findOne({ eventId });
      expect(outboxEntry).toBeDefined();
      expect(outboxEntry?.status).toBe('PENDING');

      // Process outbox batch (publishes with publisher confirmation)
      const outboxResult = await OutboxService.processOutboxBatch();
      expect(outboxResult.succeeded).toBeGreaterThanOrEqual(1);

      // Verify outbox transitioned to PUBLISHED
      const updatedOutbox = await OutboxModel.findOne({ eventId });
      expect(updatedOutbox?.status).toBe('PUBLISHED');
      expect(updatedOutbox?.publishedAt).toBeDefined();

      // Wait briefly for worker to consume and manually acknowledge
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Verify ProcessedJob record exists in MongoDB
      const processedJob = await ProcessedJobModel.findOne({ jobId: eventId });
      expect(processedJob).toBeDefined();
      expect(processedJob?.status).toBe('PROCESSED');
      expect(processedJob?.jobType).toBe('NOTIFICATION');
      expect(processedJob?.attempts).toBe(1);
    });
  });

  describe('2. Idempotent Consumer & Duplicate Message Suppression', () => {
    it('should safely acknowledge repeated/duplicate message without duplicating processing side-effects', async () => {
      const eventId = uuidv4();
      const message = {
        version: '1.0' as const,
        eventId,
        correlationId: uuidv4(),
        timestamp: new Date().toISOString(),
        producer: 'payrail-test',
        retryCount: 0,
        topic: 'notification.dispatch' as const,
        payload: {
          recipientUserId: testUser.id,
          type: 'TRANSFER_SENT' as const,
          channel: 'EMAIL_SIMULATED' as const,
          title: 'Transfer Confirmation',
          body: 'Simulated email for transfer confirmation.',
        },
      };

      // 1. Publish first time
      await QueueManager.publishWithConfirm(
        EXCHANGES.PAYRAIL_DIRECT,
        ROUTING_KEYS.NOTIFICATION,
        message,
      );

      // Wait for first processing
      await new Promise((resolve) => setTimeout(resolve, 600));

      const jobFirst = await ProcessedJobModel.findOne({ jobId: eventId });
      expect(jobFirst?.status).toBe('PROCESSED');
      expect(jobFirst?.attempts).toBe(1);

      // 2. Publish duplicate message with the SAME eventId
      await QueueManager.publishWithConfirm(
        EXCHANGES.PAYRAIL_DIRECT,
        ROUTING_KEYS.NOTIFICATION,
        message,
      );

      await new Promise((resolve) => setTimeout(resolve, 600));

      // Verify job remained single processed execution
      const jobsCount = await ProcessedJobModel.countDocuments({ jobId: eventId });
      expect(jobsCount).toBe(1);
    });
  });

  describe('3. Statement Generation Asynchronous Jobs', () => {
    it('should submit statement job via HTTP endpoint and complete processing asynchronously', async () => {
      // Seed transactions
      await WalletService.depositSimulatedFunds(testUser.id, walletId, 5000, 'TX_STATEMENT_1');
      await WalletService.depositSimulatedFunds(testUser.id, walletId, 10000, 'TX_STATEMENT_2');

      // Submit statement job via REST endpoint
      const postRes = await request(app)
        .post('/api/v1/notifications/statement-jobs')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          walletId,
          format: 'JSON',
        });

      expect(postRes.status).toBe(202);
      expect(postRes.body.data.status).toBe('QUEUED');
      const jobId = postRes.body.data.jobId;

      // Poll/wait for worker to consume and complete statement job
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Verify through GET endpoint
      const getRes = await request(app)
        .get(`/api/v1/notifications/statement-jobs/${jobId}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.status).toBe('PROCESSED');
      expect(getRes.body.data.outputSummary).toContain('Generated statement containing');
    });
  });

  describe('4. Poison Messages & Dead-Letter Routing (DLQ)', () => {
    it('should reject malformed/unparseable poison message directly to payrail.dead_letter queue without infinite looping', async () => {
      const channel = await QueueManager.getChannel();

      // Publish completely invalid non-JSON payload to notifications queue
      channel.sendToQueue(QUEUES.NOTIFICATIONS, Buffer.from('NOT_A_VALID_JSON_STRING'), {
        persistent: true,
      });

      // Wait for worker to consume, nack with requeue=false, and route to DLX
      await new Promise((resolve) => setTimeout(resolve, 600));

      // Inspect Dead Letter Queue: It must have received the dead-lettered message
      const dlqMessage = await channel.get(QUEUES.DEAD_LETTER, { noAck: true });
      expect(dlqMessage).not.toBe(false);
      if (dlqMessage) {
        expect(dlqMessage.content.toString()).toBe('NOT_A_VALID_JSON_STRING');
      }
    });

    it('should route invalid schema message to Dead Letter Queue without crashing worker', async () => {
      const channel = await QueueManager.getChannel();

      // Publish JSON that violates required schema (missing version, eventId, etc)
      const invalidSchema = { invalidProperty: 'no-schema-match' };
      channel.sendToQueue(QUEUES.NOTIFICATIONS, Buffer.from(JSON.stringify(invalidSchema)), {
        persistent: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 600));

      const dlqMessage = await channel.get(QUEUES.DEAD_LETTER, { noAck: true });
      expect(dlqMessage).not.toBe(false);
      if (dlqMessage) {
        expect(dlqMessage.content.toString()).toContain('no-schema-match');
      }
    });
  });
});
