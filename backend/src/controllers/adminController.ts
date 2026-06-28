import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import {
  getDashboardStats,
  listUsers,
  countUsers,
  updateUserRole,
  deleteUser,
  listAllApplications,
  countAllApplications,
} from '../repositories/adminRepository';
import { userToResponse } from '../models/user';
import { applicationToResponse } from '../models/application';
import { logger } from '../utils/logger';

/**
 * Admin controller — handlers for admin-only endpoints.
 * All handlers assume `authenticate` + `requireAdmin` middleware has run.
 */

/**
 * GET /api/v1/admin/stats
 * Returns dashboard aggregate statistics.
 */
export async function getDashboardStatsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const stats = await getDashboardStats();
    res.json({ success: true, data: stats });
  } catch (error) {
    logger.error('Error fetching dashboard stats:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * GET /api/v1/admin/users
 * Returns paginated user list with optional search.
 * Query params: search, limit (default 20), offset (default 0)
 */
export async function listUsersHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const search = req.query.search as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const [users, total] = await Promise.all([
      listUsers(search, limit, offset),
      countUsers(search),
    ]);

    res.json({
      success: true,
      data: {
        users: users.map(userToResponse),
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error listing users:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * PUT /api/v1/admin/users/:userId
 * Updates a user (currently only role changes are supported).
 * Body: { role: 'admin' | 'user' }
 */
export async function updateUserHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { userId } = req.params;
    const { role } = req.body;

    if (!role || !['admin', 'user'].includes(role)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Role must be "admin" or "user"',
        },
      });
      return;
    }

    const updated = await updateUserRole(userId, role as 'admin' | 'user');

    if (!updated) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
      return;
    }

    res.json({ success: true, data: { user: userToResponse(updated) } });
  } catch (error) {
    logger.error('Error updating user:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * DELETE /api/v1/admin/users/:userId
 * Deletes a user. Cannot delete self.
 */
export async function deleteUserHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const { userId } = req.params;

    // Prevent self-deletion
    if (userId === req.userId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: 'Cannot delete your own account',
        },
      });
      return;
    }

    const deleted = await deleteUser(userId);

    if (!deleted) {
      res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      });
      return;
    }

    res.json({ success: true, data: { message: 'User deleted' } });
  } catch (error) {
    logger.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}

/**
 * GET /api/v1/admin/applications
 * Returns paginated application list (including unpublished) for admin review.
 * Query params: search, type, limit, offset
 */
export async function listAllApplicationsHandler(
  req: AuthRequest,
  res: Response
): Promise<void> {
  try {
    const search = req.query.search as string | undefined;
    const type = req.query.type as string | undefined;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = parseInt(req.query.offset as string) || 0;

    const [applications, total] = await Promise.all([
      listAllApplications(search, type, limit, offset),
      countAllApplications(search, type),
    ]);

    res.json({
      success: true,
      data: {
        applications: applications.map(applicationToResponse),
        total,
        limit,
        offset,
      },
    });
  } catch (error) {
    logger.error('Error listing all applications:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}
