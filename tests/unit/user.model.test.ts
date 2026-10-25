import { UserModel } from '../../src/modules/auth/user.model';
import mongoose from 'mongoose';

describe('User Model JSON Transform (Unit)', () => {
  it('should transform user document to JSON omitting passwordHash and renaming _id to id', () => {
    const fakeObjectId = new mongoose.Types.ObjectId();
    const doc = new UserModel({
      _id: fakeObjectId,
      email: 'user@example.com',
      passwordHash: 'secret-hash',
      firstName: 'Alice',
      lastName: 'Smith',
      role: 'user',
      isActive: true,
    });

    const json = doc.toJSON();
    expect(json.id).toBe(fakeObjectId.toString());
    expect(json._id).toBeUndefined();
    expect(json.passwordHash).toBeUndefined();
    expect(json.__v).toBeUndefined();
    expect(json.email).toBe('user@example.com');
  });
});
