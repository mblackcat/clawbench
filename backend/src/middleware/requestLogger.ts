import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * 请求日志中间件
 */
export const requestLogger = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const startTime = Date.now();

  // 记录响应完成
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    logger.info(
      `${req.method} ${req.path} ${res.statusCode} - ${duration}ms`
    );
  });

  next();
};
