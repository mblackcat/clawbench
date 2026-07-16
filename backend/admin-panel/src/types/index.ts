// Shared types for the admin panel

export type ApplicationType = 'app' | 'ai-skill' | 'prompt' | 'link';

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

/** Common metadata keys used across resource types */
export interface ApplicationMetadata {
  entry?: string;
  category?: string;
  params?: unknown;
  supported_workspace_types?: string[];
  /** Cover image URL (app / ai-skill / prompt / link) */
  coverUrl?: string;
  /** Legacy / link icon URL */
  icon?: string;
  /** Link target URL */
  url?: string;
  mini?: boolean;
  [key: string]: unknown;
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
  metadata: ApplicationMetadata | null;
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

export const APPLICATION_TYPES: ApplicationType[] = ['app', 'ai-skill', 'prompt', 'link'];

export const TYPE_LABELS: Record<ApplicationType | string, string> = {
  app: 'App',
  'ai-skill': 'AI Skill',
  prompt: 'Prompt',
  link: 'Link',
};
