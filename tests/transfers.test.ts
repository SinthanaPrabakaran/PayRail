import request from 'supertest';
import { createApp } from '../src/app';
import { mongoManager } from '../src/config/mongo';
import { redisManager } from '../src/config/redis';
import { UserModel } from '../src/modules/auth/user.model';
import { WalletModel } from '../src/modules/wallets/wallet.model';
import { TransferModel } from '../src/modules/transfers/transfer.model';
import { IdempotencyModel } from '../src/modules/transfers/idempotency.model';
import { LedgerEntryModel } from '../src/modules/ledger/ledger.model';
import { WalletService } from '../src/modules/wallets/wallet.service';
import { generateAccessToken } from '../src/shared/token';

describe('Phase 5: Secure Idempotent Transfers & Concurrency Stress Tests', () => {
  const app = createApp();

  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let tokenA: string;

  let walletA: { id: string };
  let walletB: { id: string };

  beforeAll(async () => {
    await mongoManager.connect(3, 1000);
    await redisManager.connect(3, 1000);

    // Clean up Phase 5 test records
    await UserModel.deleteMany({ email: /transfer_test.*@example\.com$/ });
    await WalletModel.deleteMany({});
    await TransferModel.deleteMany({});
    await IdempotencyModel.deleteMany({});
    await LedgerEntryModel.deleteMany({});

    // Create User A
    const docA = await UserModel.create({
      email: 'transfer_test_userA@example.com',
      passwordHash: 'dummyhash',
      firstName: 'Sender',
      lastName: 'A',
    });
    userA = { id: docA.id, email: docA.email };
    tokenA = generateAccessToken(userA).token;

    // Create User B
    const docB = await UserModel.create({
      email: 'transfer_test_userB@example.com',
      passwordHash: 'dummyhash',
      firstName: 'Recipient',
      lastName: 'B',
    });
    userB = { id: docB.id, email: docB.email };

    // Create wallets
    const wADoc = await WalletService.getOrCreateWallet(userA.id, 'INR');
    const wBDoc = await WalletService.getOrCreateWallet(userB.id, 'INR');
    walletA = { id: wADoc.id };
    walletB = { id: wBDoc.id };
  });

  afterAll(async () => {
    await UserModel.deleteMany({ email: /transfer_test.*@example\.com$/ });
    await WalletModel.deleteMany({});
    await TransferModel.deleteMany({});
    await IdempotencyModel.deleteMany({});
    await LedgerEntryModel.deleteMany({});
    await mongoManager.disconnect();
    await redisManager.disconnect();
  });

  describe('Standard Transfer & Validation', () => {
    it('should reject transfer creation without x-idempotency-key header', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          sourceWalletId: walletA.id,
          destinationWalletId: walletB.id,
          amount: 5000,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("Header 'x-idempotency-key' is required");
    });

    it('should reject transfer if source wallet has insufficient balance', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-idempotency-key', 'insufficient-funds-key-1')
        .send({
          sourceWalletId: walletA.id,
          destinationWalletId: walletB.id,
          amount: 500000, // 5,000 INR when wallet has 0
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Insufficient funds');
    });

    it('should reject transfer when source and destination wallets are identical', async () => {
      const res = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-idempotency-key', 'same-wallet-key-1')
        .send({
          sourceWalletId: walletA.id,
          destinationWalletId: walletA.id,
          amount: 1000,
        });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('cannot be identical');
    });
  });

  describe('Idempotency & Replay Semantics', () => {
    beforeAll(async () => {
      // Seed User A wallet with 100,000 Paise (1,000 INR)
      await WalletService.depositSimulatedFunds(userA.id, walletA.id, 100000, 'SEED_FOR_TRANSFER');
    });

    it('should execute transfer once and replay exact cached response on repeated identical key without moving funds again', async () => {
      const IDEMPOTENCY_KEY = 'replay-test-key-001';
      const payload = {
        sourceWalletId: walletA.id,
        destinationWalletId: walletB.id,
        amount: 10000, // 100 INR
        description: 'Monthly test allowance',
      };

      // 1. Initial balance check
      const wABefore = await WalletService.getWalletById(userA.id, walletA.id);
      const wBBefore = await WalletService.getWalletById(userB.id, walletB.id);

      // 2. First Execution
      const res1 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-idempotency-key', IDEMPOTENCY_KEY)
        .send(payload);

      expect(res1.status).toBe(201);
      expect(res1.body.meta.idempotencyStatus).toBe('EXECUTED');
      expect(res1.body.data.transfer.status).toBe('COMPLETED');
      const transferId = res1.body.data.transfer.id;

      // Balances must reflect 100 INR transfer
      const wAAfterFirst = await WalletService.getWalletById(userA.id, walletA.id);
      const wBAfterFirst = await WalletService.getWalletById(userB.id, walletB.id);
      expect(wAAfterFirst.balance).toBe(wABefore.balance - 10000);
      expect(wBAfterFirst.balance).toBe(wBBefore.balance + 10000);

      // 3. Replay with identical key and payload
      const res2 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-idempotency-key', IDEMPOTENCY_KEY)
        .send(payload);

      expect(res2.status).toBe(200);
      expect(res2.body.meta.idempotencyStatus).toBe('REPLAYED');
      expect(res2.body.data.transfer.id).toBe(transferId);

      // 4. Invariant: Balances must NOT have changed on replay
      const wAAfterSecond = await WalletService.getWalletById(userA.id, walletA.id);
      const wBAfterSecond = await WalletService.getWalletById(userB.id, walletB.id);
      expect(wAAfterSecond.balance).toBe(wAAfterFirst.balance);
      expect(wBAfterSecond.balance).toBe(wBAfterFirst.balance);

      // 5. Invariant: Ledger must have exactly 1 DEBIT and 1 CREDIT entry for this transferId
      const ledgerEntries = await LedgerEntryModel.find({
        reference: res1.body.data.transfer.transferId,
      });
      expect(ledgerEntries.length).toBe(2);
      expect(ledgerEntries.filter((e) => e.type === 'DEBIT').length).toBe(1);
      expect(ledgerEntries.filter((e) => e.type === 'CREDIT').length).toBe(1);
    });

    it('should reject repeated key with different request payload with 409 Conflict', async () => {
      const CONFLICT_KEY = 'conflict-payload-key-002';

      // 1. First execution
      const res1 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-idempotency-key', CONFLICT_KEY)
        .send({
          sourceWalletId: walletA.id,
          destinationWalletId: walletB.id,
          amount: 5000,
        });
      expect(res1.status).toBe(201);

      // 2. Second execution with modified amount using SAME idempotency key
      const res2 = await request(app)
        .post('/api/v1/transfers')
        .set('Authorization', `Bearer ${tokenA}`)
        .set('x-idempotency-key', CONFLICT_KEY)
        .send({
          sourceWalletId: walletA.id,
          destinationWalletId: walletB.id,
          amount: 9999, // Changed amount
        });

      expect(res2.status).toBe(409);
      expect(res2.body.error.code).toBe('ConflictError');
      expect(res2.body.error.message).toContain('payload differs from original request');
    });
  });

  describe('Concurrency Stress Testing: 20 Simultaneous Identical Requests', () => {
    beforeAll(async () => {
      // Ensure sender has sufficient funds: 200,000 Paise (2,000 INR)
      await WalletService.depositSimulatedFunds(userA.id, walletA.id, 200000, 'CONCURRENCY_SEED');
    });

    it('should fire 20 concurrent identical requests using ONE idempotency key and result in EXACTLY ONE financial transfer', async () => {
      const CONCURRENCY_KEY = `concurrent-stress-${Date.now()}`;
      const TRANSFER_AMOUNT = 2500; // 25 INR in minor units

      const wABefore = await WalletService.getWalletById(userA.id, walletA.id);
      const wBBefore = await WalletService.getWalletById(userB.id, walletB.id);

      // Fire 20 parallel HTTP requests simultaneously
      const parallelRequests = Array.from({ length: 20 }).map(() =>
        request(app)
          .post('/api/v1/transfers')
          .set('Authorization', `Bearer ${tokenA}`)
          .set('x-idempotency-key', CONCURRENCY_KEY)
          .send({
            sourceWalletId: walletA.id,
            destinationWalletId: walletB.id,
            amount: TRANSFER_AMOUNT,
            description: 'Concurrency stress batch',
          }),
      );

      const responses = await Promise.all(parallelRequests);

      // Status classification
      const createdCount = responses.filter((r) => r.status === 201).length;
      const replayedCount = responses.filter((r) => r.status === 200).length;
      const inFlightConflictCount = responses.filter((r) => r.status === 409).length;

      // Exactly ONE request must execute the transfer (HTTP 201)
      expect(createdCount).toBe(1);

      // The remaining 19 requests must be either in-flight conflicts (409) or replayed results (200)
      expect(createdCount + replayedCount + inFlightConflictCount).toBe(20);

      // CRITICAL FINANCIAL INVARIANT 1:
      // Sender balance must have decreased by EXACTLY ONE TRANSFER AMOUNT (2500 paise), NEVER 50,000 paise
      const wAAfter = await WalletService.getWalletById(userA.id, walletA.id);
      expect(wAAfter.balance).toBe(wABefore.balance - TRANSFER_AMOUNT);

      // CRITICAL FINANCIAL INVARIANT 2:
      // Recipient balance must have increased by EXACTLY ONE TRANSFER AMOUNT
      const wBAfter = await WalletService.getWalletById(userB.id, walletB.id);
      expect(wBAfter.balance).toBe(wBBefore.balance + TRANSFER_AMOUNT);

      // CRITICAL FINANCIAL INVARIANT 3:
      // Exactly ONE Transfer record must exist for this idempotency session
      const createdTransfers = await TransferModel.find({
        sourceWalletId: walletA.id,
        destinationWalletId: walletB.id,
        amount: TRANSFER_AMOUNT,
        description: 'Concurrency stress batch',
      });
      expect(createdTransfers.length).toBe(1);

      // CRITICAL FINANCIAL INVARIANT 4:
      // Reconcile sender and recipient wallets against the double-entry journal
      const reconcileA = await WalletService.reconcileWallet(userA.id, walletA.id);
      const reconcileB = await WalletService.reconcileWallet(userB.id, walletB.id);
      expect(reconcileA.isReconciled).toBe(true);
      expect(reconcileB.isReconciled).toBe(true);
    });
  });

  describe('Simultaneous Distinct Debits on Same Wallet', () => {
    it('should correctly handle simultaneous independent transfers without balance corruption or negative balances', async () => {
      const wABefore = await WalletService.getWalletById(userA.id, walletA.id);
      const distinctAmount = 1000; // 10 INR each

      // Fire 5 distinct parallel transfers with UNIQUE keys
      const distinctRequests = Array.from({ length: 5 }).map((_, idx) =>
        request(app)
          .post('/api/v1/transfers')
          .set('Authorization', `Bearer ${tokenA}`)
          .set('x-idempotency-key', `distinct-debit-key-${Date.now()}-${idx}`)
          .send({
            sourceWalletId: walletA.id,
            destinationWalletId: walletB.id,
            amount: distinctAmount,
            description: `Distinct transfer ${idx}`,
          }),
      );

      const responses = await Promise.all(distinctRequests);

      // All 5 must succeed with 201 Created
      const successCount = responses.filter((r) => r.status === 201).length;
      expect(successCount).toBe(5);

      const wAAfter = await WalletService.getWalletById(userA.id, walletA.id);
      expect(wAAfter.balance).toBe(wABefore.balance - distinctAmount * 5);

      // Validate reconciliation
      const reconciliation = await WalletService.reconcileWallet(userA.id, walletA.id);
      expect(reconciliation.isReconciled).toBe(true);
    });
  });
});
