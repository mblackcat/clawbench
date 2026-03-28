import fs from 'fs';
import path from 'path';
import { LocalStorageService, IStorageService } from '../services/storage';
import { AppError } from '../middleware/errorHandler';
import { ErrorCode } from '../types/api';

describe('Storage Service Tests', () => {
  let storageService: IStorageService;
  let testStoragePath: string;

  beforeEach(() => {
    // 创建临时测试目录
    testStoragePath = path.join(__dirname, '../../test-uploads');
    storageService = new LocalStorageService(testStoragePath);
  });

  afterEach(() => {
    // 清理测试目录
    if (fs.existsSync(testStoragePath)) {
      fs.rmSync(testStoragePath, { recursive: true, force: true });
    }
  });

  describe('Storage Directory Management', () => {
    it('should create storage directory on initialization', () => {
      expect(fs.existsSync(testStoragePath)).toBe(true);
    });

    it('should not fail if storage directory already exists', () => {
      // 创建第二个实例，应该不会失败
      const service2 = new LocalStorageService(testStoragePath);
      expect(fs.existsSync(testStoragePath)).toBe(true);
    });
  });

  describe('File Path Generation', () => {
    it('should generate valid file path with application ID and version', () => {
      const filePath = storageService.generateFilePath(
        'app-123',
        '1.0.0',
        'test.zip'
      );

      expect(filePath).toContain('app-123');
      expect(filePath).toContain('1.0.0');
      expect(filePath).toMatch(/\.zip$/);
    });

    it('should generate unique file paths for same inputs', () => {
      const path1 = storageService.generateFilePath(
        'app-123',
        '1.0.0',
        'test.zip'
      );
      const path2 = storageService.generateFilePath(
        'app-123',
        '1.0.0',
        'test.zip'
      );

      expect(path1).not.toBe(path2);
    });

    it('should preserve file extension', () => {
      const extensions = ['.zip', '.exe', '.dmg', '.tar'];
      
      extensions.forEach((ext) => {
        const filePath = storageService.generateFilePath(
          'app-123',
          '1.0.0',
          `test${ext}`
        );
        expect(filePath).toMatch(new RegExp(`${ext.replace('.', '\\.')}$`));
      });
    });

    it('should handle files without extension', () => {
      const filePath = storageService.generateFilePath(
        'app-123',
        '1.0.0',
        'test'
      );

      expect(filePath).toContain('app-123');
      expect(filePath).toContain('1.0.0');
    });
  });

  describe('File Validation', () => {
    it('should accept valid file within size limit', () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 50 * 1024 * 1024, // 50MB
        buffer: Buffer.from('test'),
      } as Express.Multer.File;

      expect(() => storageService.validateFile(mockFile)).not.toThrow();
    });

    it('should reject file exceeding size limit', () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 150 * 1024 * 1024, // 150MB
        buffer: Buffer.from('test'),
      } as Express.Multer.File;

      expect(() => storageService.validateFile(mockFile)).toThrow(AppError);
      expect(() => storageService.validateFile(mockFile)).toThrow(
        /File size exceeds maximum limit/
      );
    });

    it('should reject empty file', () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 0,
        buffer: Buffer.from(''),
      } as Express.Multer.File;

      expect(() => storageService.validateFile(mockFile)).toThrow(AppError);
      expect(() => storageService.validateFile(mockFile)).toThrow(/File is empty/);
    });
  });

  describe('File Save Operations', () => {
    it('should save file successfully', async () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 1024,
        buffer: Buffer.from('test file content'),
      } as Express.Multer.File;

      const result = await storageService.saveFile(
        mockFile,
        'app-123',
        '1.0.0'
      );

      expect(result.filePath).toBeDefined();
      expect(result.fileSize).toBe(1024);
      expect(result.filePath).toContain('app-123');
      expect(result.filePath).toContain('1.0.0');
    });

    it('should create application directory if not exists', async () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 1024,
        buffer: Buffer.from('test file content'),
      } as Express.Multer.File;

      await storageService.saveFile(mockFile, 'new-app', '1.0.0');

      const appDir = path.join(testStoragePath, 'new-app');
      expect(fs.existsSync(appDir)).toBe(true);
    });

    it('should save actual file content', async () => {
      const content = 'test file content';
      const mockFile = {
        originalname: 'test.zip',
        size: content.length,
        buffer: Buffer.from(content),
      } as Express.Multer.File;

      const result = await storageService.saveFile(
        mockFile,
        'app-123',
        '1.0.0'
      );

      const fullPath = storageService.getFullPath(result.filePath);
      const savedContent = fs.readFileSync(fullPath, 'utf-8');
      expect(savedContent).toBe(content);
    });

    it('should reject invalid file during save', async () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 0, // Empty file
        buffer: Buffer.from(''),
      } as Express.Multer.File;

      await expect(
        storageService.saveFile(mockFile, 'app-123', '1.0.0')
      ).rejects.toThrow(AppError);
    });
  });

  describe('File Read Operations', () => {
    it('should read existing file', async () => {
      const content = 'test file content';
      const mockFile = {
        originalname: 'test.zip',
        size: content.length,
        buffer: Buffer.from(content),
      } as Express.Multer.File;

      const { filePath } = await storageService.saveFile(
        mockFile,
        'app-123',
        '1.0.0'
      );

      const readContent = await storageService.readFile(filePath);
      expect(readContent.toString()).toBe(content);
    });

    it('should throw error for non-existent file', async () => {
      await expect(
        storageService.readFile('non-existent/file.zip')
      ).rejects.toThrow(AppError);
    });
  });

  describe('File Delete Operations', () => {
    it('should delete existing file', async () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 1024,
        buffer: Buffer.from('test file content'),
      } as Express.Multer.File;

      const { filePath } = await storageService.saveFile(
        mockFile,
        'app-123',
        '1.0.0'
      );

      const fullPath = storageService.getFullPath(filePath);
      expect(fs.existsSync(fullPath)).toBe(true);

      await storageService.deleteFile(filePath);
      expect(fs.existsSync(fullPath)).toBe(false);
    });

    it('should not throw error when deleting non-existent file', async () => {
      await expect(
        storageService.deleteFile('non-existent/file.zip')
      ).resolves.not.toThrow();
    });
  });

  describe('File Existence Check', () => {
    it('should return true for existing file', async () => {
      const mockFile = {
        originalname: 'test.zip',
        size: 1024,
        buffer: Buffer.from('test file content'),
      } as Express.Multer.File;

      const { filePath } = await storageService.saveFile(
        mockFile,
        'app-123',
        '1.0.0'
      );

      const exists = await storageService.fileExists(filePath);
      expect(exists).toBe(true);
    });

    it('should return false for non-existent file', async () => {
      const exists = await storageService.fileExists('non-existent/file.zip');
      expect(exists).toBe(false);
    });
  });

  describe('Full Path Operations', () => {
    it('should return correct full path', () => {
      const relativePath = 'app-123/1.0.0_test.zip';
      const fullPath = storageService.getFullPath(relativePath);

      expect(fullPath).toContain(testStoragePath);
      expect(fullPath).toContain(relativePath);
    });

    it('should handle path separators correctly', () => {
      const relativePath = path.join('app-123', '1.0.0_test.zip');
      const fullPath = storageService.getFullPath(relativePath);

      expect(path.isAbsolute(fullPath)).toBe(true);
    });
  });

  describe('Multiple File Operations', () => {
    it('should handle multiple files for same application', async () => {
      const files = [
        { version: '1.0.0', content: 'version 1.0.0' },
        { version: '1.1.0', content: 'version 1.1.0' },
        { version: '2.0.0', content: 'version 2.0.0' },
      ];

      const savedFiles = [];

      for (const file of files) {
        const mockFile = {
          originalname: 'test.zip',
          size: file.content.length,
          buffer: Buffer.from(file.content),
        } as Express.Multer.File;

        const result = await storageService.saveFile(
          mockFile,
          'app-123',
          file.version
        );
        savedFiles.push(result);
      }

      // 验证所有文件都存在
      for (const saved of savedFiles) {
        const exists = await storageService.fileExists(saved.filePath);
        expect(exists).toBe(true);
      }

      // 验证文件内容正确
      for (let i = 0; i < savedFiles.length; i++) {
        const content = await storageService.readFile(savedFiles[i].filePath);
        expect(content.toString()).toBe(files[i].content);
      }
    });

    it('should handle multiple applications', async () => {
      const apps = ['app-1', 'app-2', 'app-3'];

      for (const appId of apps) {
        const mockFile = {
          originalname: 'test.zip',
          size: 1024,
          buffer: Buffer.from(`content for ${appId}`),
        } as Express.Multer.File;

        await storageService.saveFile(mockFile, appId, '1.0.0');

        const appDir = path.join(testStoragePath, appId);
        expect(fs.existsSync(appDir)).toBe(true);
      }
    });
  });

  describe('Interface Compliance', () => {
    it('should implement all IStorageService methods', () => {
      expect(typeof storageService.saveFile).toBe('function');
      expect(typeof storageService.readFile).toBe('function');
      expect(typeof storageService.deleteFile).toBe('function');
      expect(typeof storageService.getFullPath).toBe('function');
      expect(typeof storageService.validateFile).toBe('function');
      expect(typeof storageService.fileExists).toBe('function');
      expect(typeof storageService.generateFilePath).toBe('function');
    });
  });
});
