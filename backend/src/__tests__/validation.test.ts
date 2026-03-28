import {
  isValidEmail,
  isValidUsername,
  isValidPassword,
  validateRegistrationInput,
} from '../utils/validation';

describe('Validation Utilities', () => {
  describe('isValidEmail', () => {
    it('should accept valid email addresses', () => {
      expect(isValidEmail('test@example.com')).toBe(true);
      expect(isValidEmail('user.name@example.com')).toBe(true);
      expect(isValidEmail('user+tag@example.co.uk')).toBe(true);
      expect(isValidEmail('test123@test-domain.com')).toBe(true);
    });

    it('should reject invalid email addresses', () => {
      expect(isValidEmail('invalid')).toBe(false);
      expect(isValidEmail('invalid@')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('test@')).toBe(false);
      expect(isValidEmail('test @example.com')).toBe(false);
      expect(isValidEmail('')).toBe(false);
    });
  });

  describe('isValidUsername', () => {
    it('should accept valid usernames', () => {
      expect(isValidUsername('abc')).toBe(true);
      expect(isValidUsername('testuser')).toBe(true);
      expect(isValidUsername('test_user')).toBe(true);
      expect(isValidUsername('test-user')).toBe(true);
      expect(isValidUsername('test123')).toBe(true);
      expect(isValidUsername('TEST')).toBe(true);
      expect(isValidUsername('a'.repeat(30))).toBe(true);
    });

    it('should reject usernames that are too short', () => {
      expect(isValidUsername('ab')).toBe(false);
      expect(isValidUsername('a')).toBe(false);
      expect(isValidUsername('')).toBe(false);
    });

    it('should reject usernames that are too long', () => {
      expect(isValidUsername('a'.repeat(31))).toBe(false);
      expect(isValidUsername('a'.repeat(50))).toBe(false);
    });

    it('should reject usernames with invalid characters', () => {
      expect(isValidUsername('test user')).toBe(false);
      expect(isValidUsername('test@user')).toBe(false);
      expect(isValidUsername('test.user')).toBe(false);
      expect(isValidUsername('test!user')).toBe(false);
      expect(isValidUsername('test#user')).toBe(false);
    });
  });

  describe('isValidPassword', () => {
    it('should accept valid passwords', () => {
      expect(isValidPassword('12345678')).toBe(true);
      expect(isValidPassword('password123')).toBe(true);
      expect(isValidPassword('a'.repeat(8))).toBe(true);
      expect(isValidPassword('a'.repeat(100))).toBe(true);
    });

    it('should reject passwords that are too short', () => {
      expect(isValidPassword('1234567')).toBe(false);
      expect(isValidPassword('short')).toBe(false);
      expect(isValidPassword('')).toBe(false);
    });
  });

  describe('validateRegistrationInput', () => {
    it('should validate correct input', () => {
      const result = validateRegistrationInput(
        'testuser',
        'test@example.com',
        'password123'
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for missing username', () => {
      const result = validateRegistrationInput(
        '',
        'test@example.com',
        'password123'
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Username is required');
    });

    it('should return errors for invalid username', () => {
      const result = validateRegistrationInput(
        'ab',
        'test@example.com',
        'password123'
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Username must be 3-30 characters');
    });

    it('should return errors for missing email', () => {
      const result = validateRegistrationInput(
        'testuser',
        '',
        'password123'
      );

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return errors for invalid email', () => {
      const result = validateRegistrationInput(
        'testuser',
        'invalid-email',
        'password123'
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid email format');
    });

    it('should return errors for missing password', () => {
      const result = validateRegistrationInput(
        'testuser',
        'test@example.com',
        ''
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password is required');
    });

    it('should return errors for short password', () => {
      const result = validateRegistrationInput(
        'testuser',
        'test@example.com',
        'short'
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Password must be at least 8 characters');
    });

    it('should return multiple errors for multiple invalid fields', () => {
      const result = validateRegistrationInput(
        'ab',
        'invalid-email',
        'short'
      );

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('should return all errors when all fields are missing', () => {
      const result = validateRegistrationInput('', '', '');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Username is required');
      expect(result.errors).toContain('Password is required');
    });
  });
});
