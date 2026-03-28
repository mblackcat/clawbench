import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';
import { ApiError, ErrorCode, ErrorStatusMap } from '../types/api';

/**
 * 自定义错误类
 */
export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    public message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * 错误处理中间件
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // 记录错误日志
  logger.error(`Error: ${err.message}`, {
    error: err,
    path: req.path,
    method: req.method,
    body: req.body,
  });

  // 如果是自定义错误
  if (err instanceof AppError) {
    const statusCode = ErrorStatusMap[err.code] || 500;
    const errorResponse: ApiError = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    };
    return res.status(statusCode).json(errorResponse);
  }

  // 未知错误
  const errorResponse: ApiError = {
    success: false,
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Internal server error',
    },
  };
  res.status(500).json(errorResponse);
};

/**
 * 404 处理中间件
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const error = new AppError(
    ErrorCode.NOT_FOUND,
    `Route ${req.method} ${req.path} not found`
  );
  next(error);
};
