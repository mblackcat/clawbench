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

// ── Projects ───────────────────────────────────────────────

/** Project VCS backends */
export type VcsType = 'git' | 'svn' | 'none';

export type ProjectStatus = 'active' | 'archived';

export interface Project {
  projectId: string;
  name: string;
  description?: string | null;
  vcsType: VcsType;
  repoUrl?: string | null;
  status: ProjectStatus;
  createdBy?: string;
  createdAt: number;
  updatedAt: number;
  memberCount?: number;
  myRole?: 'admin' | 'member' | null;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  username?: string;
  role: 'admin' | 'member';
  joinedAt: number;
}

// ── Common / builtin apps ──────────────────────────────────

export interface CommonApp {
  appKey: string;
  name: string;
  description?: string | null;
  /** Version (builtin apps ship with the client bundle) */
  version?: string | null;
  /** True for builtin apps; distinguishes them from user-developed apps */
  builtin: boolean;
  enabled: boolean;
  sortOrder: number;
  /** Pinned to the top section of the client workbench */
  pinned: boolean;
  /** Client-reported install/download count */
  downloadCount: number;
  /** Client-reported run count */
  executionCount: number;
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface CommonAppExecutionError {
  errorId: string;
  appKey: string;
  userId: string;
  username?: string;
  version: string | null;
  message: string;
  details: string | null;
  createdAt: number;
}

export type CommonAppEventType = 'download' | 'execution' | 'error' | 'version';

/** A download or execution event row (admin stats tabs). */
export interface CommonAppEvent {
  eventId: string;
  appKey: string;
  userId: string;
  username?: string;
  eventType: 'download' | 'execution';
  success: boolean;
  /** User-initiated cancel — distinct from failure (grey Cancelled in Runs). */
  cancelled?: boolean;
  version: string | null;
  errorMessage: string | null;
  errorDetails: string | null;
  createdAt: number;
}

/** A version-change history row (admin stats version tab). */
export interface CommonAppVersionHistory {
  versionHistId: string;
  appKey: string;
  version: string;
  changedBy: string | null;
  changedByName?: string | null;
  source: string;
  createdAt: number;
}
