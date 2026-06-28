import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';
import { getUserById } from '../repositories/userRepository';
import { logger } from '../utils/logger';

/**
 * Admin authorization middleware.
 * Must be used AFTER `authenticate` middleware (req.userId must be set).
 * Checks that the authenticated user has the 'admin' role.
 * Returns 403 if the user is not an admin.
 */
export async function requireAdmin(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authentication required',
        },
      });
      return;
    }

    const user = await getUserById(req.userId);

    if (!user) {
      res.status(401).json({
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
        },
      });
      return;
    }

    if (user.role !== 'admin') {
      res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Admin access required',
        },
      });
      return;
    }

    next();
  } catch (error) {
    logger.error('Admin auth error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
      },
    });
  }
}
