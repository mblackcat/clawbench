import { Response } from 'express';
import { ApiResponse } from '../types/api';

/**
 * 发送成功响应
 */
export const sendSuccess = <T>(res: Response, data: T, statusCode = 200) => {
  const response: ApiResponse<T> = {
    success: true,
    data,
  };
  res.status(statusCode).json(response);
};
