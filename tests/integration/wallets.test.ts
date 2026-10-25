import request from 'supertest';
import { createApp } from '../../src/app';
import { mongoManager } from '../../src/config/mongo';
import { redisManager } from '../../src/config/redis';
import { UserModel } from '../../src/modules/auth/user.model';
import { WalletModel } from '../../src/modules/wallets/wallet.model';
import { CardModel } from '../../src/modules/cards/card.model';
import { LedgerEntryModel } from '../../src/modules/ledger/ledger.model';
import { generateAccessToken } from '../../src/shared/token';

describe('Phase 4: Wallets, Ledger & Simulated Cards', () => {
  const app = createApp();

  let userA: { id: string; email: string };
  let userB: { id: string; email: string };
  let tokenA: string;
  let tokenB: string;

  beforeAll(async () => {
    await mongoManager.connect(3, 1000);
    await redisManager.connect(3, 1000);

    // Setup 2 test users
    await UserModel.deleteMany({ email: /phase4.*@example\.com$/ });
    await WalletModel.deleteMany({});
    await CardModel.deleteMany({});
    await LedgerEntryModel.deleteMany({});

    const docA = await UserModel.create({
      email: 'phase4_userA@example.com',
      passwordHash: 'dummy',
      firstName: 'User',
      lastName: 'A',
    });
    userA = { id: docA.id, email: docA.email };
    tokenA = generateAccessToken(userA).token;

    const docB = await UserModel.create({
      email: 'phase4_userB@example.com',
      passwordHash: 'dummy',
      firstName: 'User',
      lastName: 'B',
    });
    userB = { id: docB.id, email: docB.email };
    tokenB = generateAccessToken(userB).token;
  });

  afterAll(async () => {
    if (userA?.id && userB?.id) {
      await WalletModel.deleteMany({ userId: { $in: [userA.id, userB.id] } });
      await CardModel.deleteMany({ userId: { $in: [userA.id, userB.id] } });
      await LedgerEntryModel.deleteMany({ userId: { $in: [userA.id, userB.id] } });
    }
    await UserModel.deleteMany({ email: /phase4.*@example\.com$/ });
    await mongoManager.disconnect();
    await redisManager.disconnect();
  });

  describe('Wallet Creation & Currency Handling', () => {
    it('should create or retrieve wallet in default INR currency with zero balance', async () => {
      const res = await request(app)
        .post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currency: 'INR' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.currency).toBe('INR');
      expect(res.body.data.balance).toBe(0);
      expect(res.body.data.userId).toBe(userA.id);
    });

    it('should create multi-currency wallet (USD) for same user', async () => {
      const res = await request(app)
        .post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currency: 'USD' });

      expect(res.status).toBe(201);
      expect(res.body.data.currency).toBe('USD');
      expect(res.body.data.balance).toBe(0);
    });

    it('should reject unsupported currencies with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currency: 'INVALID_CURRENCY' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });

  describe('Simulated Deposits & Strict Integer Minor Units', () => {
    let walletId: string;

    beforeAll(async () => {
      const walletRes = await request(app)
        .post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currency: 'INR' });
      walletId = walletRes.body.data.id;
    });

    it('should successfully deposit funds specified strictly in integer minor units (e.g. 50000 Paise = 500 INR)', async () => {
      const res = await request(app)
        .post(`/api/v1/wallets/${walletId}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          amount: 50000, // 50,000 paise
          reference: 'INITIAL_TEST_SEED',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.wallet.balance).toBe(50000);
      expect(res.body.data.ledgerEntry.amount).toBe(50000);
      expect(res.body.data.ledgerEntry.type).toBe('CREDIT');
      expect(res.body.data.ledgerEntry.balanceAfter).toBe(50000);
    });

    it('should reject fractional / floating-point amounts with 400 Bad Request', async () => {
      const res = await request(app)
        .post(`/api/v1/wallets/${walletId}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 100.5 }); // Floats forbidden

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ValidationError');
    });

    it('should reject negative or zero deposits', async () => {
      const res = await request(app)
        .post(`/api/v1/wallets/${walletId}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: -500 });

      expect(res.status).toBe(400);
    });

    it('should reject deposit into an inactive wallet with 400 Bad Request', async () => {
      const inactive = await WalletModel.create({
        userId: userA.id,
        currency: 'EUR',
        balance: 0,
        isActive: false,
      });

      const res = await request(app)
        .post(`/api/v1/wallets/${inactive.id}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 1000 });

      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain('Cannot deposit funds into an inactive wallet');
    });
  });

  describe('Authorization & IDOR Protection', () => {
    let walletAId: string;

    beforeAll(async () => {
      const walletRes = await request(app)
        .post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currency: 'INR' });
      walletAId = walletRes.body.data.id;
    });

    it('should forbid User B from viewing or accessing User A wallet', async () => {
      const res = await request(app)
        .get(`/api/v1/wallets/${walletAId}`)
        .set('Authorization', `Bearer ${tokenB}`); // User B token

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NotFoundError');
    });

    it('should forbid User B from depositing into User A wallet', async () => {
      const res = await request(app)
        .post(`/api/v1/wallets/${walletAId}/deposit`)
        .set('Authorization', `Bearer ${tokenB}`) // User B token
        .send({ amount: 1000 });

      expect(res.status).toBe(404);
    });
  });

  describe('Ledger Immutability & Balance Reconciliation', () => {
    let walletId: string;

    beforeAll(async () => {
      const walletRes = await request(app)
        .post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currency: 'INR' });
      walletId = walletRes.body.data.id;

      // Add multiple simulated deposits
      await request(app)
        .post(`/api/v1/wallets/${walletId}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 20000 });
      await request(app)
        .post(`/api/v1/wallets/${walletId}/deposit`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ amount: 30000 });
    });

    it('should reconcile wallet balance perfectly with sum of immutable ledger entries', async () => {
      const res = await request(app)
        .get(`/api/v1/wallets/${walletId}/reconcile`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.isReconciled).toBe(true);
      expect(res.body.data.walletBalance).toBe(res.body.data.calculatedBalance);
    });

    it('should return paginated transaction history sorted newest first', async () => {
      const res = await request(app)
        .get(`/api/v1/wallets/${walletId}/transactions?page=1&limit=2`)
        .set('Authorization', `Bearer ${tokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeLessThanOrEqual(2);
      expect(res.body.meta.pagination.page).toBe(1);
      expect(res.body.meta.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('should strictly throw error when attempting direct update on ledger entry (immutability check)', async () => {
      const entry = await LedgerEntryModel.findOne({ userId: userA.id });
      expect(entry).not.toBeNull();

      await expect(
        LedgerEntryModel.updateOne({ _id: entry!._id }, { amount: 999999 }),
      ).rejects.toThrow('Ledger entries are strictly immutable');
    });
  });

  describe('Virtual Prepaid Cards', () => {
    let walletId: string;
    let cardId: string;

    beforeAll(async () => {
      const walletRes = await request(app)
        .post('/api/v1/wallets')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ currency: 'INR' });
      walletId = walletRes.body.data.id;
    });

    it('should create virtual card with masked PAN and no real credentials', async () => {
      const res = await request(app)
        .post('/api/v1/cards')
        .set('Authorization', `Bearer ${tokenA}`)
        .send({
          walletId,
          cardholderName: 'John Doe',
          spendingLimit: 25000,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.maskedPan).toMatch(/^•••• •••• •••• \d{4}$/);
      expect(res.body.data.isSimulated).toBe(true);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data).not.toHaveProperty('cvv');
      expect(res.body.data).not.toHaveProperty('pan');

      cardId = res.body.data.id;
    });

    it('should allow user to freeze and unfreeze card', async () => {
      // Freeze card
      const freezeRes = await request(app)
        .patch(`/api/v1/cards/${cardId}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'FROZEN' });

      expect(freezeRes.status).toBe(200);
      expect(freezeRes.body.data.status).toBe('FROZEN');

      // Unfreeze card
      const unfreezeRes = await request(app)
        .patch(`/api/v1/cards/${cardId}/status`)
        .set('Authorization', `Bearer ${tokenA}`)
        .send({ status: 'ACTIVE' });

      expect(unfreezeRes.status).toBe(200);
      expect(unfreezeRes.body.data.status).toBe('ACTIVE');
    });

    it('should forbid User B from viewing or updating User A card', async () => {
      const res = await request(app)
        .patch(`/api/v1/cards/${cardId}/status`)
        .set('Authorization', `Bearer ${tokenB}`)
        .send({ status: 'FROZEN' });

      expect(res.status).toBe(404);
    });
  });
});
