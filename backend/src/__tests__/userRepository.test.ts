import { database } from '../database';
import { initializeSchema } from '../database/schema';
import { cleanAllTables } from './helpers/db-cleanup';
import {
  createUser,
  getUserById,
  getUserByEmail,
  getUserByUsername,
  emailExists,
  usernameExists,
  updateUser,
  deleteUser,
} from '../repositories/userRepository';
import { CreateUserInput } from '../models/user';
import fs from 'fs';
import path from 'path';

// 使用内存数据库进行测试
const TEST_DB_PATH = ':memory:';

describe('User Repository', () => {
  beforeAll(async () => {
    // 连接到测试数据库
    await database.connect();
    await initializeSchema();
  });

  afterAll(async () => {
    // 关闭数据库连接
    await database.close();
  });

  beforeEach(async () => {
    // 清空数据
    await cleanAllTables();
  });

  describe('createUser', () => {
    it('should create a new user successfully', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      const user = await createUser(input);

      expect(user.userId).toBeDefined();
      expect(user.username).toBe(input.username);
      expect(user.email).toBe(input.email);
      expect(user.passwordHash).toBeDefined();
      expect(user.passwordHash).not.toBe(input.password);
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
      expect(user.createdAt).toBe(user.updatedAt);
    });

    it('should generate unique user IDs', async () => {
      const input1: CreateUserInput = {
        username: 'user1',
        email: 'user1@example.com',
        password: 'password123',
      };

      const input2: CreateUserInput = {
        username: 'user2',
        email: 'user2@example.com',
        password: 'password123',
      };

      const user1 = await createUser(input1);
      const user2 = await createUser(input2);

      expect(user1.userId).not.toBe(user2.userId);
    });

    it('should hash passwords differently for same password', async () => {
      const input1: CreateUserInput = {
        username: 'user1',
        email: 'user1@example.com',
        password: 'samepassword',
      };

      const input2: CreateUserInput = {
        username: 'user2',
        email: 'user2@example.com',
        password: 'samepassword',
      };

      const user1 = await createUser(input1);
      const user2 = await createUser(input2);

      expect(user1.passwordHash).not.toBe(user2.passwordHash);
    });
  });

  describe('getUserById', () => {
    it('should retrieve user by ID', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      const createdUser = await createUser(input);
      const retrievedUser = await getUserById(createdUser.userId);

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser?.userId).toBe(createdUser.userId);
      expect(retrievedUser?.username).toBe(createdUser.username);
      expect(retrievedUser?.email).toBe(createdUser.email);
    });

    it('should return undefined for non-existent user ID', async () => {
      const user = await getUserById('non-existent-id');
      expect(user).toBeUndefined();
    });
  });

  describe('getUserByEmail', () => {
    it('should retrieve user by email', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      const createdUser = await createUser(input);
      const retrievedUser = await getUserByEmail(input.email!);

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser?.userId).toBe(createdUser.userId);
      expect(retrievedUser?.email).toBe(input.email);
    });

    it('should return undefined for non-existent email', async () => {
      const user = await getUserByEmail('nonexistent@example.com');
      expect(user).toBeUndefined();
    });
  });

  describe('getUserByUsername', () => {
    it('should retrieve user by username', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      const createdUser = await createUser(input);
      const retrievedUser = await getUserByUsername(input.username);

      expect(retrievedUser).toBeDefined();
      expect(retrievedUser?.userId).toBe(createdUser.userId);
      expect(retrievedUser?.username).toBe(input.username);
    });

    it('should return undefined for non-existent username', async () => {
      const user = await getUserByUsername('nonexistentuser');
      expect(user).toBeUndefined();
    });
  });

  describe('emailExists', () => {
    it('should return true for existing email', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      await createUser(input);
      const exists = await emailExists(input.email!);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent email', async () => {
      const exists = await emailExists('nonexistent@example.com');
      expect(exists).toBe(false);
    });
  });

  describe('usernameExists', () => {
    it('should return true for existing username', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      await createUser(input);
      const exists = await usernameExists(input.username);

      expect(exists).toBe(true);
    });

    it('should return false for non-existent username', async () => {
      const exists = await usernameExists('nonexistentuser');
      expect(exists).toBe(false);
    });
  });

  describe('updateUser', () => {
    it('should update user username', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      const user = await createUser(input);
      const updatedUser = await updateUser(user.userId, { username: 'newusername' });

      expect(updatedUser).toBeDefined();
      expect(updatedUser?.username).toBe('newusername');
      expect(updatedUser?.email).toBe(input.email);
      expect(updatedUser?.updatedAt).toBeGreaterThan(user.updatedAt);
    });

    it('should update user email', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      const user = await createUser(input);
      const updatedUser = await updateUser(user.userId, { email: 'newemail@example.com' });

      expect(updatedUser).toBeDefined();
      expect(updatedUser?.email).toBe('newemail@example.com');
      expect(updatedUser?.username).toBe(input.username);
    });

    it('should return undefined for non-existent user', async () => {
      const updatedUser = await updateUser('non-existent-id', { username: 'newname' });
      expect(updatedUser).toBeUndefined();
    });
  });

  describe('deleteUser', () => {
    it('should delete user successfully', async () => {
      const input: CreateUserInput = {
        username: 'testuser',
        email: 'test@example.com',
        password: 'password123',
      };

      const user = await createUser(input);
      const deleted = await deleteUser(user.userId);

      expect(deleted).toBe(true);

      const retrievedUser = await getUserById(user.userId);
      expect(retrievedUser).toBeUndefined();
    });

    it('should return false for non-existent user', async () => {
      const deleted = await deleteUser('non-existent-id');
      expect(deleted).toBe(false);
    });
  });

  describe('Data Persistence Round-trip', () => {
    it('should maintain data integrity after create and retrieve', async () => {
      const input: CreateUserInput = {
        username: 'roundtripuser',
        email: 'roundtrip@example.com',
        password: 'password123',
      };

      const createdUser = await createUser(input);
      const retrievedUser = await getUserById(createdUser.userId);

      expect(retrievedUser).toEqual(createdUser);
    });

    it('should retrieve same user by different methods', async () => {
      const input: CreateUserInput = {
        username: 'multiuser',
        email: 'multi@example.com',
        password: 'password123',
      };

      const createdUser = await createUser(input);
      const byId = await getUserById(createdUser.userId);
      const byEmail = await getUserByEmail(input.email!);
      const byUsername = await getUserByUsername(input.username);

      expect(byId).toEqual(createdUser);
      expect(byEmail).toEqual(createdUser);
      expect(byUsername).toEqual(createdUser);
    });
  });
});
