import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { requireAdmin } from '../middleware/adminAuth';
import {
  getDashboardStatsHandler,
  listUsersHandler,
  updateUserHandler,
  deleteUserHandler,
  listAllApplicationsHandler,
  updateApplicationAdminHandler,
  listExecutionErrorsHandler,
} from '../controllers/adminController';

/**
 * Admin routes — all require authentication + admin role.
 * Mounted at /api/v1/admin
 */
export const adminRouter = Router();

// All admin routes require auth + admin role
adminRouter.use(authenticate, requireAdmin);

// Dashboard stats
adminRouter.get('/stats', getDashboardStatsHandler);

// User management
adminRouter.get('/users', listUsersHandler);
adminRouter.put('/users/:userId', updateUserHandler);
adminRouter.delete('/users/:userId', deleteUserHandler);

// Application management (admin view — all apps including unpublished)
adminRouter.get('/applications', listAllApplicationsHandler);
adminRouter.put('/applications/:applicationId', updateApplicationAdminHandler);

// Execution error logs (admin-only visibility)
adminRouter.get('/applications/:applicationId/execution-errors', listExecutionErrorsHandler);
