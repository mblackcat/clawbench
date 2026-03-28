import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { logger } from '../utils/logger';
import { AppError } from '../middleware/errorHandler';
import { ErrorCode } from '../types/api';

/**
 * 文件存储抽象接口
 * 定义文件存储服务的核心方法
 */
export interface IStorageService {
  /**
   * 保存文件
   * @param file 上传的文件
   * @param applicationId 应用ID
   * @param version 版本号
   * @returns 文件路径和大小
   */
  saveFile(
    file: Express.Multer.File,
    applicationId: string,
    version: string
  ): Promise<{ filePath: string; fileSize: number }>;

  /**
   * 读取文件
   * @param relativePath 相对路径
   * @returns 文件内容
   */
  readFile(relativePath: string): Promise<Buffer>;

  /**
   * 删除文件
   * @param relativePath 相对路径
   */
  deleteFile(relativePath: string): Promise<void>;

  /**
   * 获取文件完整路径
   * @param relativePath 相对路径
   * @returns 完整路径
   */
  getFullPath(relativePath: string): string;

  /**
   * 验证文件格式
   * @param file 上传的文件
   * @returns 是否有效
   */
  validateFile(file: Express.Multer.File): boolean;

  /**
   * 检查文件是否存在
   * @param relativePath 相对路径
   * @returns 是否存在
   */
  fileExists(relativePath: string): Promise<boolean>;

  /**
   * 生成文件路径
   * @param applicationId 应用ID
   * @param version 版本号
   * @param originalName 原始文件名
   * @returns 生成的相对路径
   */
  generateFilePath(
    applicationId: string,
    version: string,
    originalName: string
  ): string;
}

/**
 * 本地文件系统存储实现
 * 实现基于本地文件系统的文件存储服务
 */
export class LocalStorageService implements IStorageService {
  private storagePath: string;

  constructor(storagePath?: string) {
    this.storagePath = storagePath || config.storage.path;
    this.ensureStorageDirectory();
  }

  /**
   * 确保存储目录存在
   */
  private ensureStorageDirectory(): void {
    if (!fs.existsSync(this.storagePath)) {
      fs.mkdirSync(this.storagePath, { recursive: true });
      logger.info(`Created storage directory: ${this.storagePath}`);
    }
  }

  /**
   * 生成文件路径
   * 格式: {applicationId}/{version}_{uuid}.{ext}
   */
  generateFilePath(
    applicationId: string,
    version: string,
    originalName: string
  ): string {
    const ext = path.extname(originalName);
    const fileName = `${version}_${uuidv4()}${ext}`;
    return path.join(applicationId, fileName);
  }

  /**
   * 保存文件
   */
  async saveFile(
    file: Express.Multer.File,
    applicationId: string,
    version: string
  ): Promise<{ filePath: string; fileSize: number }> {
    try {
      // 验证文件
      this.validateFile(file);

      // 创建应用专属目录
      const appDir = path.join(this.storagePath, applicationId);
      if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true });
      }

      // 生成文件路径
      const relativePath = this.generateFilePath(
        applicationId,
        version,
        file.originalname
      );
      const fullPath = path.join(this.storagePath, relativePath);

      // 保存文件
      await fs.promises.writeFile(fullPath, file.buffer);

      logger.info(`File saved: ${fullPath}`);

      return {
        filePath: relativePath,
        fileSize: file.size,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      
      logger.error('Failed to save file', error);
      throw new AppError(
        ErrorCode.FILE_SYSTEM_ERROR,
        'Failed to save file',
        error
      );
    }
  }

  /**
   * 读取文件
   */
  async readFile(relativePath: string): Promise<Buffer> {
    try {
      const fullPath = path.join(this.storagePath, relativePath);
      
      if (!fs.existsSync(fullPath)) {
        throw new AppError(ErrorCode.NOT_FOUND, 'File not found');
      }

      return await fs.promises.readFile(fullPath);
    } catch (error) {
      if (error instanceof AppError) throw error;
      
      logger.error('Failed to read file', error);
      throw new AppError(
        ErrorCode.FILE_SYSTEM_ERROR,
        'Failed to read file',
        error
      );
    }
  }

  /**
   * 删除文件
   */
  async deleteFile(relativePath: string): Promise<void> {
    try {
      const fullPath = path.join(this.storagePath, relativePath);
      
      if (fs.existsSync(fullPath)) {
        await fs.promises.unlink(fullPath);
        logger.info(`File deleted: ${fullPath}`);
      }
    } catch (error) {
      logger.error('Failed to delete file', error);
      throw new AppError(
        ErrorCode.FILE_SYSTEM_ERROR,
        'Failed to delete file',
        error
      );
    }
  }

  /**
   * 获取文件完整路径
   */
  getFullPath(relativePath: string): string {
    return path.join(this.storagePath, relativePath);
  }

  /**
   * 检查文件是否存在
   */
  async fileExists(relativePath: string): Promise<boolean> {
    const fullPath = path.join(this.storagePath, relativePath);
    return fs.existsSync(fullPath);
  }

  /**
   * 验证文件格式（简单验证）
   */
  validateFile(file: Express.Multer.File): boolean {
    // 检查文件大小（最大 100MB）
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new AppError(
        ErrorCode.INVALID_FILE_FORMAT,
        'File size exceeds maximum limit (100MB)'
      );
    }

    // 检查文件是否为空
    if (file.size === 0) {
      throw new AppError(
        ErrorCode.INVALID_FILE_FORMAT,
        'File is empty'
      );
    }

    return true;
  }
}

// 导出单例实例
export const storageService = new LocalStorageService();
