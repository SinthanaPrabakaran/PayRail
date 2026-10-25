import {
  AppError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  UnprocessableEntityError,
  ServiceUnavailableError,
} from '../../src/shared/errors';

describe('Error Classes (Unit)', () => {
  it('AppError should set defaults properly', () => {
    const error = new AppError('Something broke');
    expect(error.message).toBe('Something broke');
    expect(error.statusCode).toBe(500);
    expect(error.isOperational).toBe(true);
    expect(error.details).toBeUndefined();
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AppError);
  });

  it('AppError should allow custom status code and details', () => {
    const details = { field: 'name' };
    const error = new AppError('Custom Error', 501, false, details);
    expect(error.statusCode).toBe(501);
    expect(error.isOperational).toBe(false);
    expect(error.details).toEqual(details);
  });

  it('BadRequestError should initialize with 400 and default message', () => {
    const err = new BadRequestError();
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad Request');
    expect(err.isOperational).toBe(true);

    const custom = new BadRequestError('Invalid query', { key: 1 });
    expect(custom.message).toBe('Invalid query');
    expect(custom.details).toEqual({ key: 1 });
  });

  it('UnauthorizedError should initialize with 401', () => {
    const err = new UnauthorizedError();
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Unauthorized');
  });

  it('ForbiddenError should initialize with 403', () => {
    const err = new ForbiddenError();
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Forbidden');
  });

  it('NotFoundError should initialize with 404', () => {
    const err = new NotFoundError();
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('Resource Not Found');
  });

  it('ConflictError should initialize with 409', () => {
    const err = new ConflictError();
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Conflict');
  });

  it('UnprocessableEntityError should initialize with 422', () => {
    const err = new UnprocessableEntityError();
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Unprocessable Entity');
  });

  it('ServiceUnavailableError should initialize with 503', () => {
    const err = new ServiceUnavailableError();
    expect(err.statusCode).toBe(503);
    expect(err.message).toBe('Service Unavailable');
  });
});
