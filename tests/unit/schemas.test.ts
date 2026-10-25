import { TransferService } from '../../src/modules/transfers/transfer.service';
import { createTransferSchema } from '../../src/modules/transfers/transfer.schema';
import { createCardSchema, updateCardStatusSchema } from '../../src/modules/cards/card.schema';
import {
  notificationMessageSchema,
  statementMessageSchema,
} from '../../src/queues/message.schemas';

describe('Validation Schemas & Fingerprinting (Unit)', () => {
  describe('Transfer Fingerprint Determinism', () => {
    it('should generate identical SHA-256 fingerprints regardless of key ordering', () => {
      const obj1 = {
        amount: 5000,
        sourceWalletId: 'w1',
        destinationWalletId: 'w2',
        description: 'Test payment',
      };

      const obj2 = {
        description: 'Test payment',
        destinationWalletId: 'w2',
        amount: 5000,
        sourceWalletId: 'w1',
      };

      const hash1 = TransferService.computeFingerprint(obj1);
      const hash2 = TransferService.computeFingerprint(obj2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it('should generate distinct fingerprints for different amounts or destinations', () => {
      const obj1 = { sourceWalletId: 'w1', destinationWalletId: 'w2', amount: 5000 };
      const obj2 = { sourceWalletId: 'w1', destinationWalletId: 'w2', amount: 5001 };

      const hash1 = TransferService.computeFingerprint(obj1);
      const hash2 = TransferService.computeFingerprint(obj2);

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('createTransferSchema', () => {
    it('should validate valid transfer inputs', () => {
      const valid = {
        sourceWalletId: '60c72b2f9b1d8b001c8b4567',
        destinationWalletId: '60c72b2f9b1d8b001c8b4568',
        amount: 2500,
        description: 'Payment for services',
      };

      const parsed = createTransferSchema.parse(valid);
      expect(parsed.amount).toBe(2500);
      expect(parsed.sourceWalletId).toBe(valid.sourceWalletId);
    });

    it('should reject non-integer amounts (prevent floating point precision issues)', () => {
      const invalid = {
        sourceWalletId: 'w1',
        destinationWalletId: 'w2',
        amount: 19.99,
      };

      expect(() => createTransferSchema.parse(invalid)).toThrow(
        /Amount must be an integer in minor units/,
      );
    });

    it('should reject zero or negative amounts', () => {
      expect(() =>
        createTransferSchema.parse({
          sourceWalletId: 'w1',
          destinationWalletId: 'w2',
          amount: 0,
        }),
      ).toThrow();

      expect(() =>
        createTransferSchema.parse({
          sourceWalletId: 'w1',
          destinationWalletId: 'w2',
          amount: -100,
        }),
      ).toThrow();
    });
  });

  describe('Card Schemas', () => {
    it('should validate valid createCard input with default limit', () => {
      const valid = {
        walletId: '60c72b2f9b1d8b001c8b4567',
        cardholderName: 'Alice Smith',
        spendingLimit: 10000,
      };

      const parsed = createCardSchema.parse(valid);
      expect(parsed.spendingLimit).toBe(10000);
      expect(parsed.cardholderName).toBe('Alice Smith');
    });

    it('should reject invalid card status updates', () => {
      expect(() => updateCardStatusSchema.parse({ status: 'INVALID_STATUS' })).toThrow();
      expect(updateCardStatusSchema.parse({ status: 'FROZEN' }).status).toBe('FROZEN');
      expect(updateCardStatusSchema.parse({ status: 'ACTIVE' }).status).toBe('ACTIVE');
      expect(updateCardStatusSchema.parse({ status: 'TERMINATED' }).status).toBe('TERMINATED');
    });
  });

  describe('Queue Message Schemas', () => {
    it('should validate proper NotificationMessage', () => {
      const validMsg = {
        version: '1.0',
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        correlationId: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: new Date().toISOString(),
        producer: 'payrail-test',
        retryCount: 0,
        topic: 'notification.dispatch',
        payload: {
          recipientUserId: 'user-1',
          type: 'TRANSFER_SENT',
          channel: 'IN_APP',
          title: 'Transfer successful',
          body: 'You sent 50.00 INR',
        },
      };

      const result = notificationMessageSchema.parse(validMsg);
      expect(result.topic).toBe('notification.dispatch');
      expect(result.payload.type).toBe('TRANSFER_SENT');
    });

    it('should reject invalid NotificationMessage with unsupported event type', () => {
      const invalidMsg = {
        version: '1.0',
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        correlationId: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: new Date().toISOString(),
        topic: 'notification.dispatch',
        payload: {
          recipientUserId: 'user-1',
          type: 'UNKNOWN_EVENT_TYPE',
          channel: 'IN_APP',
          title: 'Title',
          body: 'Body',
        },
      };

      expect(() => notificationMessageSchema.parse(invalidMsg)).toThrow();
    });

    it('should validate proper StatementMessage', () => {
      const validMsg = {
        version: '1.0',
        eventId: '123e4567-e89b-12d3-a456-426614174000',
        correlationId: '123e4567-e89b-12d3-a456-426614174001',
        timestamp: new Date().toISOString(),
        topic: 'statement.generate',
        payload: {
          jobId: '123e4567-e89b-12d3-a456-426614174002',
          userId: 'user-1',
          walletId: 'wallet-1',
          startDate: new Date().toISOString(),
          endDate: new Date().toISOString(),
          format: 'JSON',
        },
      };

      const result = statementMessageSchema.parse(validMsg);
      expect(result.payload.format).toBe('JSON');
    });
  });
});
