import { Request, Response } from 'express';
import { CardController } from '../../src/modules/cards/card.controller';
import { CardService } from '../../src/modules/cards/card.service';
import { UnauthorizedError } from '../../src/shared/errors';

jest.mock('../../src/modules/cards/card.service');

describe('Card Controller (Unit)', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let nextFn: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReq = {
      headers: {},
      params: {},
      body: {},
      requestId: 'test-req-card',
    };
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    nextFn = jest.fn();
  });

  describe('getCards', () => {
    it('should throw UnauthorizedError when req.user is absent', async () => {
      await CardController.getCards(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should return 200 with list of user cards', async () => {
      mockReq.user = { userId: 'u1', email: 'u1@ex.com', role: 'user', tokenId: 't1' };
      const fakeCards = [{ id: 'card-1', lastFour: '1234' }];
      (CardService.getUserCards as jest.Mock).mockResolvedValue(fakeCards);

      await CardController.getCards(mockReq as Request, mockRes as Response, nextFn);

      expect(CardService.getUserCards).toHaveBeenCalledWith('u1');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: fakeCards,
        }),
      );
    });
  });

  describe('createCard', () => {
    it('should throw UnauthorizedError when req.user is absent', async () => {
      await CardController.createCard(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should create virtual card and return 201', async () => {
      mockReq.user = { userId: 'u1', email: 'u1@ex.com', role: 'user', tokenId: 't1' };
      mockReq.body = {
        walletId: '60c72b2f9b1d8b001c8b4567',
        cardholderName: 'Alice Smith',
        spendingLimit: 5000,
      };

      const createdCard = { id: 'card-new', ...mockReq.body };
      (CardService.createVirtualCard as jest.Mock).mockResolvedValue(createdCard);

      await CardController.createCard(mockReq as Request, mockRes as Response, nextFn);

      expect(CardService.createVirtualCard).toHaveBeenCalledWith('u1', expect.any(Object));
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: createdCard,
        }),
      );
    });
  });

  describe('getCard', () => {
    it('should throw UnauthorizedError when req.user is absent', async () => {
      await CardController.getCard(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should return card when found', async () => {
      mockReq.user = { userId: 'u1', email: 'u1@ex.com', role: 'user', tokenId: 't1' };
      mockReq.params = { id: 'c1' };
      const card = { id: 'c1', maskedPan: '•••• 1234' };
      (CardService.getCardById as jest.Mock).mockResolvedValue(card);

      await CardController.getCard(mockReq as Request, mockRes as Response, nextFn);

      expect(CardService.getCardById).toHaveBeenCalledWith('u1', 'c1');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: card,
        }),
      );
    });
  });

  describe('updateStatus', () => {
    it('should throw UnauthorizedError when req.user is absent', async () => {
      await CardController.updateStatus(mockReq as Request, mockRes as Response, nextFn);
      expect(nextFn).toHaveBeenCalledWith(expect.any(UnauthorizedError));
    });

    it('should update card status and return 200', async () => {
      mockReq.user = { userId: 'u1', email: 'u1@ex.com', role: 'user', tokenId: 't1' };
      mockReq.params = { id: 'c1' };
      mockReq.body = { status: 'FROZEN' };

      const updated = { id: 'c1', status: 'FROZEN' };
      (CardService.updateCardStatus as jest.Mock).mockResolvedValue(updated);

      await CardController.updateStatus(mockReq as Request, mockRes as Response, nextFn);

      expect(CardService.updateCardStatus).toHaveBeenCalledWith('u1', 'c1', 'FROZEN');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: updated,
        }),
      );
    });
  });
});
