// Shared types for the admin panel

export type ApplicationType = 'app' | 'ai-skill' | 'prompt';

export interface UserResponse {
  userId: string;
  username: string;
  email?: string;
  feishuOpenId?: string;
  avatarUrl?: string;
  authProvider?: string;
  role: 'admin' | 'user';
  createdAt: number;
  updatedAt: number;
}

export interface ApplicationVersionResponse {
  versionId: string;
  applicationId: string;
  version: string;
  changelog: string | null;
  fileSize: number;
  publishedAt: number;
}

export interface ExecutionErrorResponse {
  errorId: string;
  applicationId: string;
  userId: string;
  username?: string;
  version: string | null;
  message: string;
  details: string | null;
  createdAt: number;
}

export interface ApplicationResponse {
  applicationId: string;
  name: string;
  description: string | null;
  ownerId: string;
  ownerName?: string;
  type: ApplicationType;
  category: string | null;
  published: boolean;
  featured: boolean;
  /** Latest version number (from application_versions) */
  version?: string;
  downloadCount: number;
  executionCount: number;
  /** Full version history (detail endpoint only, newest first) */
  versions?: ApplicationVersionResponse[];
  metadata: Record<string, unknown> | null;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardStats {
  totalUsers: number;
  totalApplications: number;
  totalDownloads: number;
  publishedApplications: number;
  applicationByType: Record<string, number>;
}

export interface ReleaseFile {
  filename: string;
  size: number;
  version: string | null;
  platform: 'mac' | 'windows' | 'manifest' | 'other';
  url: string;
  updatedAt: number;
}

export interface LatestRelease {
  version: string | null;
  latest: {
    mac: ReleaseFile | null;
    windows: ReleaseFile | null;
    manifest: ReleaseFile | null;
  };
  allFiles: ReleaseFile[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedData<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
}
