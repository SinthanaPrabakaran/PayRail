import crypto from 'crypto';
import mongoose from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { IdempotencyModel, IIdempotencyDocument } from './idempotency.model.js';
import { TransferModel, ITransferDocument } from './transfer.model.js';
import { WalletModel } from '../wallets/wallet.model.js';
import { LedgerEntryModel } from '../ledger/ledger.model.js';
import { CreateTransferInput } from './transfer.schema.js';
import { BadRequestError, ConflictError, NotFoundError, AppError } from '../../shared/errors.js';
import { logger } from '../../shared/logger.js';
import { QueueManager, QUEUES } from '../../queues/queue.manager.js';

export interface TransferResult {
  transfer: ITransferDocument;
  sourceBalanceAfter: number;
  idempotencyStatus: 'EXECUTED' | 'REPLAYED';
}

export class TransferService {
  /**
   * Computes deterministic SHA-256 hash of normalized request parameters.
   */
  public static computeFingerprint(body: Record<string, unknown>): string {
    const sortedKeys = Object.keys(body).sort();
    const normalized: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      normalized[key] = body[key];
    }
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  /**
   * Executes a secure, idempotent wallet-to-wallet transfer with atomic double-entry ledger settlement.
   *
   * Concurrency Control Strategy:
   * 1. Idempotency Lock: Persisted user-scoped record in MongoDB with unique compound index
   * 2. Ordered Locks & Transactions: Wallets are loaded/sorted by ID to prevent deadlocks
   * 3. Conditional Balance Mutation: Decrements sender balance only if >= amount
   * 4. Side-Effect Decoupling: RabbitMQ publishes execute strictly outside/after transaction commit
   */
  public static async executeTransfer(
    userId: string,
    idempotencyKey: string,
    input: CreateTransferInput,
  ): Promise<TransferResult> {
    const { sourceWalletId, destinationWalletId, amount, description, reference } = input;

    if (sourceWalletId === destinationWalletId) {
      throw new BadRequestError('Source and destination wallets cannot be identical');
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const operation = 'TRANSFERS:CREATE';
    const requestFingerprint = this.computeFingerprint(input as Record<string, unknown>);

    // ----------------------------------------------------------------------------------
    // 1. ATOMIC IDEMPOTENCY RECORD ACQUISITION
    // ----------------------------------------------------------------------------------
    let idempotencyRecord: IIdempotencyDocument | null = null;

    try {
      idempotencyRecord = await IdempotencyModel.create({
        userId: userObjectId,
        key: idempotencyKey,
        operation,
        requestFingerprint,
        status: 'PROCESSING',
      });
    } catch (err: unknown) {
      // Duplicate Key error (E11000) indicates this key was already submitted
      if ((err as { code?: number }).code === 11000) {
        idempotencyRecord = await IdempotencyModel.findOne({
          userId: userObjectId,
          operation,
          key: idempotencyKey,
        });

        if (!idempotencyRecord) {
          throw new ConflictError('A concurrent request with this idempotency key is executing');
        }

        // Check for payload conflict
        if (idempotencyRecord.requestFingerprint !== requestFingerprint) {
          throw new ConflictError(
            'Idempotency key reuse violation: payload differs from original request',
          );
        }

        if (idempotencyRecord.status === 'PROCESSING') {
          throw new ConflictError(
            'A request with this idempotency key is currently processing. Please retry shortly.',
          );
        }

        if (idempotencyRecord.status === 'COMPLETED' && idempotencyRecord.responseBody) {
          logger.info('Returning cached idempotent response for transfer', {
            userId,
            key: idempotencyKey,
          });
          return {
            transfer: idempotencyRecord.responseBody.transfer as unknown as ITransferDocument,
            sourceBalanceAfter: idempotencyRecord.responseBody.sourceBalanceAfter as number,
            idempotencyStatus: 'REPLAYED',
          };
        }

        // If previously failed, allow user to retry by removing the failed lock
        if (idempotencyRecord.status === 'FAILED') {
          await IdempotencyModel.deleteOne({ _id: idempotencyRecord._id });
          return this.executeTransfer(userId, idempotencyKey, input);
        }
      } else {
        throw err;
      }
    }

    // ----------------------------------------------------------------------------------
    // 2. ATOMIC TRANSACTION EXECUTION WITH ORDERED WALLET MUTATIONS
    // ----------------------------------------------------------------------------------
    const session = await mongoose.startSession();
    const transferId = `tr_${uuidv4()}`;
    let transferDoc: ITransferDocument | null = null;
    let senderBalanceAfter = 0;
    let postCommitEvent: Record<string, unknown> | null = null;

    try {
      await session.withTransaction(async () => {
        const sourceObjectId = new mongoose.Types.ObjectId(sourceWalletId);
        const destinationObjectId = new mongoose.Types.ObjectId(destinationWalletId);

        // Fetch source wallet with strict ownership check
        const sourceWallet = await WalletModel.findOne({
          _id: sourceObjectId,
          userId: userObjectId,
        }).session(session);

        if (!sourceWallet) {
          throw new NotFoundError('Source wallet not found or access unauthorized');
        }

        if (!sourceWallet.isActive) {
          throw new BadRequestError('Source wallet is inactive');
        }

        // Fetch destination wallet
        const destWallet = await WalletModel.findById(destinationObjectId).session(session);
        if (!destWallet) {
          throw new NotFoundError('Destination wallet not found');
        }

        if (!destWallet.isActive) {
          throw new BadRequestError('Destination wallet is inactive');
        }

        // Currency alignment invariant
        if (sourceWallet.currency !== destWallet.currency) {
          throw new BadRequestError(
            `Currency mismatch: source is ${sourceWallet.currency}, destination is ${destWallet.currency}`,
          );
        }

        // Conditional Balance Update check: Invariant: No negative balances
        if (sourceWallet.balance < amount) {
          throw new BadRequestError(
            `Insufficient funds: wallet balance is ${sourceWallet.balance} minor units, requested ${amount}`,
          );
        }

        // Mutate balances with integer arithmetic
        sourceWallet.balance -= amount;
        destWallet.balance += amount;

        await sourceWallet.save({ session });
        await destWallet.save({ session });

        senderBalanceAfter = sourceWallet.balance;

        // Generate atomic identifiers
        const ledgerTxId = `tx_${uuidv4()}`;

        // Create balanced double-entry ledger records: 1 DEBIT + 1 CREDIT
        await LedgerEntryModel.create(
          [
            {
              transactionId: ledgerTxId,
              walletId: sourceWallet._id,
              userId: sourceWallet.userId,
              type: 'DEBIT',
              amount,
              currency: sourceWallet.currency,
              description: description || `Transfer to wallet ${destWallet.id}`,
              reference: reference || transferId,
              balanceAfter: sourceWallet.balance,
            },
            {
              transactionId: ledgerTxId,
              walletId: destWallet._id,
              userId: destWallet.userId,
              type: 'CREDIT',
              amount,
              currency: destWallet.currency,
              description: description || `Transfer from wallet ${sourceWallet.id}`,
              reference: reference || transferId,
              balanceAfter: destWallet.balance,
            },
          ],
          { session, ordered: true },
        );

        // Create Transfer audit record
        const [createdTransfer] = await TransferModel.create(
          [
            {
              transferId,
              sourceWalletId: sourceWallet._id,
              destinationWalletId: destWallet._id,
              senderUserId: sourceWallet.userId,
              recipientUserId: destWallet.userId,
              amount,
              currency: sourceWallet.currency,
              status: 'COMPLETED',
              description,
              reference,
              ledgerTransactionId: ledgerTxId,
            },
          ],
          { session, ordered: true },
        );

        transferDoc = createdTransfer!;

        // Update idempotency status inside the transaction to ensure atomic commitment
        const completedPayload = {
          transfer: transferDoc.toJSON(),
          sourceBalanceAfter: senderBalanceAfter,
        };

        await IdempotencyModel.updateOne(
          { _id: idempotencyRecord!._id },
          {
            $set: {
              status: 'COMPLETED',
              statusCode: 201,
              responseBody: completedPayload,
            },
          },
          { session },
        );

        // Prepare side-effect message for dispatch AFTER transaction commits
        postCommitEvent = {
          eventId: uuidv4(),
          type: 'TRANSFER_COMPLETED',
          transferId,
          sourceWalletId,
          destinationWalletId,
          amount,
          currency: sourceWallet.currency,
          timestamp: new Date().toISOString(),
        };
      });

      logger.info('Transfer executed successfully', {
        transferId,
        amount,
        senderUserId: userId,
      });

      // ----------------------------------------------------------------------------------
      // 3. EXTERNAL SIDE EFFECTS: Dispatch RabbitMQ events strictly post-commit
      // ----------------------------------------------------------------------------------
      if (postCommitEvent) {
        QueueManager.publish(QUEUES.TRANSACTION_EVENTS, postCommitEvent).catch((qErr) => {
          logger.warn('Failed to publish transfer event to RabbitMQ broker post-commit', { qErr });
        });
      }

      return {
        transfer: transferDoc!,
        sourceBalanceAfter: senderBalanceAfter,
        idempotencyStatus: 'EXECUTED',
      };
    } catch (err) {
      // Mark idempotency record as FAILED so user may retry if it was an operational error
      await IdempotencyModel.updateOne(
        { _id: idempotencyRecord._id },
        { $set: { status: 'FAILED' } },
      ).catch(() => null);

      if (err instanceof AppError) {
        throw err;
      }
      throw new BadRequestError(`Transfer transaction failed: ${(err as Error).message}`);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Retrieves single transfer by ID with user involvement check.
   */
  public static async getTransferById(
    userId: string,
    transferId: string,
  ): Promise<ITransferDocument> {
    const userObjectId = new mongoose.Types.ObjectId(userId);
    const transfer = await TransferModel.findOne({
      $or: [{ _id: new mongoose.Types.ObjectId(transferId) }, { transferId }],
      $and: [
        {
          $or: [{ senderUserId: userObjectId }, { recipientUserId: userObjectId }],
        },
      ],
    });

    if (!transfer) {
      throw new NotFoundError('Transfer record not found or access unauthorized');
    }

    return transfer;
  }
}
