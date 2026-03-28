import { hashPassword, verifyPassword } from '../utils/password';
import { userRowToUser, userToResponse, User, UserRow } from '../models/user';

describe('User Model and Password Utilities', () => {
  describe('Password Hashing', () => {
    it('should hash password successfully', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);

      expect(hash).toBeDefined();
      expect(hash).not.toBe(password);
      expect(hash.length).toBeGreaterThan(0);
    });

    it('should generate different hashes for same password', async () => {
      const password = 'testPassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });

    it('should verify correct password', async () => {
      const password = 'testPassword123';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });

    it('should reject incorrect password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword456';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(wrongPassword, hash);

      expect(isValid).toBe(false);
    });

    it('should handle empty password', async () => {
      const password = '';
      const hash = await hashPassword(password);
      const isValid = await verifyPassword(password, hash);

      expect(isValid).toBe(true);
    });
  });

  describe('User Model Transformations', () => {
    const mockUserRow: UserRow = {
      user_id: '123e4567-e89b-12d3-a456-426614174000',
      username: 'testuser',
      email: 'test@example.com',
      password_hash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
      created_at: 1234567890000,
      updated_at: 1234567890000,
    };

    const mockUser: User = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      username: 'testuser',
      email: 'test@example.com',
      passwordHash: '$2a$10$abcdefghijklmnopqrstuvwxyz',
      createdAt: 1234567890000,
      updatedAt: 1234567890000,
    };

    it('should convert database row to user object', () => {
      const user = userRowToUser(mockUserRow);

      expect(user.userId).toBe(mockUserRow.user_id);
      expect(user.username).toBe(mockUserRow.username);
      expect(user.email).toBe(mockUserRow.email);
      expect(user.passwordHash).toBe(mockUserRow.password_hash);
      expect(user.createdAt).toBe(mockUserRow.created_at);
      expect(user.updatedAt).toBe(mockUserRow.updated_at);
    });

    it('should convert user to response object without password', () => {
      const response = userToResponse(mockUser);

      expect(response.userId).toBe(mockUser.userId);
      expect(response.username).toBe(mockUser.username);
      expect(response.email).toBe(mockUser.email);
      expect(response.createdAt).toBe(mockUser.createdAt);
      expect(response.updatedAt).toBe(mockUser.updatedAt);
      expect('passwordHash' in response).toBe(false);
    });

    it('should preserve all fields except password in response', () => {
      const response = userToResponse(mockUser);
      const responseKeys = Object.keys(response);

      expect(responseKeys).toContain('userId');
      expect(responseKeys).toContain('username');
      expect(responseKeys).toContain('email');
      expect(responseKeys).toContain('createdAt');
      expect(responseKeys).toContain('updatedAt');
      expect(responseKeys).not.toContain('passwordHash');
      expect(responseKeys.length).toBe(8);
    });
  });
});
