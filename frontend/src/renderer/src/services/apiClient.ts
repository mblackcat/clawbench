/**
 * API 客户端服务
 * 提供与后端 API 通信的封装，包括认证、错误处理和请求拦截
 */

import type {
  ApiResponse,
  ApiError,
  RegisterRequest,
  RegisterResponse,
  LoginRequest,
  LoginResponse,
  LogoutResponse,
  User,
  CreateApplicationRequest,
  CreateApplicationResponse,
  UpdateApplicationRequest,
  UpdateApplicationResponse,
  ListApplicationsQuery,
  ListApplicationsResponse,
  Application,
  ApplicationDetail,
  DeleteApplicationResponse,
  UploadApplicationResponse,
  ListVersionsResponse,
} from '../types/api';
import type {
  Conversation,
  Message,
  ChatAttachment,
  AIModel,
  ConversationListResponse,
  MessageListResponse,
} from '../types/chat';

// ============ 配置 ============

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api/v1';
const TOKEN_STORAGE_KEY = 'clawbench_token';

// ============ 认证令牌管理 ============

class TokenManager {
  private token: string | null = null;

  constructor() {
    this.loadToken();
  }

  /**
   * 从本地存储加载令牌
   */
  private loadToken(): void {
    try {
      this.token = localStorage.getItem(TOKEN_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to load token from localStorage:', error);
    }
  }

  /**
   * 获取当前令牌
   */
  getToken(): string | null {
    return this.token;
  }

  /**
   * 设置令牌并保存到本地存储
   */
  setToken(token: string): void {
    this.token = token;
    try {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } catch (error) {
      console.error('Failed to save token to localStorage:', error);
    }
    try {
      window.api.credentials.saveApiToken(token);
    } catch {
      // Not in Electron context or IPC unavailable
    }
  }

  /**
   * 清除令牌
   */
  clearToken(): void {
    this.token = null;
    try {
      localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch (error) {
      console.error('Failed to remove token from localStorage:', error);
    }
    try {
      window.api.credentials.clearApiToken();
    } catch {
      // Not in Electron context or IPC unavailable
    }
  }

  /**
   * 检查是否有令牌
   */
  hasToken(): boolean {
    return this.token !== null && this.token.length > 0;
  }
}

// ============ HTTP 客户端 ============

class HttpClient {
  private tokenManager: TokenManager;

  constructor(tokenManager: TokenManager) {
    this.tokenManager = tokenManager;
  }

  /**
   * 构建请求头
   */
  private buildHeaders(includeAuth: boolean = true): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (includeAuth && this.tokenManager.hasToken()) {
      const token = this.tokenManager.getToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    return headers;
  }

  /**
   * 处理响应
   */
  private async handleResponse<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('content-type');
    const isJson = contentType?.includes('application/json');

    if (!response.ok) {
      if (isJson) {
        const errorData: ApiError = await response.json();
        throw new ApiClientError(
          errorData.error.message,
          errorData.error.code,
          response.status,
          errorData.error.details
        );
      } else {
        throw new ApiClientError(
          `HTTP Error: ${response.statusText}`,
          'HTTP_ERROR',
          response.status
        );
      }
    }

    if (isJson) {
      const data: ApiResponse<T> = await response.json();
      return data.data;
    }

    // 对于非 JSON 响应（如文件下载），返回 response 本身
    return response as any;
  }

  /**
   * GET 请求
   */
  async get<T>(url: string, requireAuth: boolean = false): Promise<T> {
    try {
      const response = await fetch(`${API_BASE_URL}${url}`, {
        method: 'GET',
        headers: this.buildHeaders(requireAuth),
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError(
        'Network error occurred',
        'NETWORK_ERROR',
        0,
        error
      );
    }
  }

  /**
   * POST 请求
   */
  async post<T>(
    url: string,
    body: any,
    requireAuth: boolean = false
  ): Promise<T> {
    try {
      const response = await fetch(`${API_BASE_URL}${url}`, {
        method: 'POST',
        headers: this.buildHeaders(requireAuth),
        body: JSON.stringify(body),
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError(
        'Network error occurred',
        'NETWORK_ERROR',
        0,
        error
      );
    }
  }

  /**
   * PUT 请求
   */
  async put<T>(
    url: string,
    body: any,
    requireAuth: boolean = false
  ): Promise<T> {
    try {
      const response = await fetch(`${API_BASE_URL}${url}`, {
        method: 'PUT',
        headers: this.buildHeaders(requireAuth),
        body: JSON.stringify(body),
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError(
        'Network error occurred',
        'NETWORK_ERROR',
        0,
        error
      );
    }
  }

  /**
   * DELETE 请求
   */
  async delete<T>(url: string, requireAuth: boolean = false): Promise<T> {
    try {
      const response = await fetch(`${API_BASE_URL}${url}`, {
        method: 'DELETE',
        headers: this.buildHeaders(requireAuth),
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError(
        'Network error occurred',
        'NETWORK_ERROR',
        0,
        error
      );
    }
  }

  /**
   * 上传文件（multipart/form-data）
   */
  async upload<T>(
    url: string,
    formData: FormData,
    requireAuth: boolean = true
  ): Promise<T> {
    try {
      const headers: HeadersInit = {};
      if (requireAuth && this.tokenManager.hasToken()) {
        const token = this.tokenManager.getToken();
        if (token) {
          headers['Authorization'] = `Bearer ${token}`;
        }
      }

      const response = await fetch(`${API_BASE_URL}${url}`, {
        method: 'POST',
        headers,
        body: formData,
      });
      return this.handleResponse<T>(response);
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError(
        'Network error occurred',
        'NETWORK_ERROR',
        0,
        error
      );
    }
  }

  /**
   * 下载文件
   */
  async download(url: string, requireAuth: boolean = false): Promise<Blob> {
    try {
      const response = await fetch(`${API_BASE_URL}${url}`, {
        method: 'GET',
        headers: this.buildHeaders(requireAuth),
      });

      if (!response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          const errorData: ApiError = await response.json();
          throw new ApiClientError(
            errorData.error.message,
            errorData.error.code,
            response.status,
            errorData.error.details
          );
        }
        throw new ApiClientError(
          `HTTP Error: ${response.statusText}`,
          'HTTP_ERROR',
          response.status
        );
      }

      return await response.blob();
    } catch (error) {
      if (error instanceof ApiClientError) {
        throw error;
      }
      throw new ApiClientError(
        'Network error occurred',
        'NETWORK_ERROR',
        0,
        error
      );
    }
  }
}

// ============ 自定义错误类 ============

export class ApiClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
    public details?: any
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /**
   * 检查是否为认证错误
   */
  isAuthError(): boolean {
    return this.status === 401;
  }

  /**
   * 检查是否为权限错误
   */
  isPermissionError(): boolean {
    return this.status === 403;
  }

  /**
   * 检查是否为验证错误
   */
  isValidationError(): boolean {
    return this.status === 400;
  }

  /**
   * 检查是否为网络错误
   */
  isNetworkError(): boolean {
    return this.code === 'NETWORK_ERROR';
  }
}

// ============ API 客户端类 ============

class ApiClient {
  private tokenManager: TokenManager;
  private httpClient: HttpClient;

  constructor() {
    this.tokenManager = new TokenManager();
    this.httpClient = new HttpClient(this.tokenManager);
  }

  // ============ 用户 API ============

  /**
   * 用户注册
   */
  async register(data: RegisterRequest): Promise<RegisterResponse> {
    return this.httpClient.post<RegisterResponse>('/users/register', data);
  }

  /**
   * 用户登录
   */
  async login(data: LoginRequest): Promise<LoginResponse> {
    const response = await this.httpClient.post<LoginResponse>(
      '/users/login',
      data
    );
    // 保存令牌
    this.tokenManager.setToken(response.token);
    return response;
  }

  /**
   * 用户注销
   */
  async logout(): Promise<LogoutResponse> {
    try {
      const response = await this.httpClient.post<LogoutResponse>(
        '/users/logout',
        {},
        true
      );
      return response;
    } finally {
      // 无论成功与否都清除本地令牌
      this.tokenManager.clearToken();
    }
  }

  /**
   * 获取当前用户信息
   */
  async getCurrentUser(): Promise<User> {
    return this.httpClient.get<User>('/users/me', true);
  }

  /**
   * 检查是否已登录
   */
  isLoggedIn(): boolean {
    return this.tokenManager.hasToken();
  }

  /**
   * 获取当前令牌
   */
  getToken(): string | null {
    return this.tokenManager.getToken();
  }

  /**
   * 设置令牌（供飞书 OAuth 登录后使用）
   */
  setToken(token: string): void {
    this.tokenManager.setToken(token);
  }

  /**
   * 清除令牌
   */
  clearToken(): void {
    this.tokenManager.clearToken();
  }

  // ============ 应用 API ============

  /**
   * 创建应用
   */
  async createApplication(
    data: CreateApplicationRequest
  ): Promise<CreateApplicationResponse> {
    return this.httpClient.post<CreateApplicationResponse>(
      '/applications',
      data,
      true
    );
  }

  /**
   * 获取应用列表
   */
  async listApplications(
    query?: ListApplicationsQuery
  ): Promise<ListApplicationsResponse> {
    const params = new URLSearchParams();
    if (query?.type) params.append('type', query.type);
    if (query?.category) params.append('category', query.category);
    if (query?.search) params.append('search', query.search);
    if (query?.limit) params.append('limit', query.limit.toString());
    if (query?.offset) params.append('offset', query.offset.toString());

    const queryString = params.toString();
    const url = queryString ? `/applications?${queryString}` : '/applications';

    return this.httpClient.get<ListApplicationsResponse>(url);
  }

  /**
   * 获取应用详情
   */
  async getApplication(applicationId: string): Promise<ApplicationDetail> {
    return this.httpClient.get<ApplicationDetail>(
      `/applications/${applicationId}`
    );
  }

  /**
   * 更新应用
   */
  async updateApplication(
    applicationId: string,
    data: UpdateApplicationRequest
  ): Promise<UpdateApplicationResponse> {
    return this.httpClient.put<UpdateApplicationResponse>(
      `/applications/${applicationId}`,
      data,
      true
    );
  }

  /**
   * 删除应用
   */
  async deleteApplication(
    applicationId: string
  ): Promise<DeleteApplicationResponse> {
    return this.httpClient.delete<DeleteApplicationResponse>(
      `/applications/${applicationId}`,
      true
    );
  }

  /**
   * 获取当前用户的应用
   */
  async getUserApplications(): Promise<Application[]> {
    const response = await this.httpClient.get<{ applications: Application[] }>(
      '/users/me/applications',
      true
    );
    return response.applications;
  }

  // ============ 文件 API ============

  /**
   * 上传应用包
   */
  async uploadApplication(
    applicationId: string,
    file: File,
    version: string,
    changelog: string
  ): Promise<UploadApplicationResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('version', version);
    formData.append('changelog', changelog);

    return this.httpClient.upload<UploadApplicationResponse>(
      `/applications/${applicationId}/upload`,
      formData,
      true
    );
  }

  /**
   * 下载应用包
   */
  async downloadApplication(
    applicationId: string,
    version?: string
  ): Promise<Blob> {
    const url = version
      ? `/applications/${applicationId}/download?version=${version}`
      : `/applications/${applicationId}/download`;

    return this.httpClient.download(url, true);
  }

  /**
   * 获取应用版本列表
   */
  async getApplicationVersions(
    applicationId: string
  ): Promise<ListVersionsResponse> {
    return this.httpClient.get<ListVersionsResponse>(
      `/applications/${applicationId}/versions`
    );
  }

  // ============ Chat API ============

  async createConversation(title?: string, modelId?: string): Promise<Conversation> {
    return this.httpClient.post<Conversation>('/chat/conversations', { title, modelId }, true);
  }

  async listConversations(params?: { favorited?: boolean; limit?: number; offset?: number }): Promise<ConversationListResponse> {
    const urlParams = new URLSearchParams();
    if (params?.favorited !== undefined) urlParams.append('favorited', params.favorited ? '1' : '0');
    if (params?.limit) urlParams.append('limit', params.limit.toString());
    if (params?.offset) urlParams.append('offset', params.offset.toString());
    const queryString = urlParams.toString();
    const url = queryString ? `/chat/conversations?${queryString}` : '/chat/conversations';
    return this.httpClient.get<ConversationListResponse>(url, true);
  }

  async getConversation(id: string): Promise<{ conversation: Conversation; messages: Message[] }> {
    return this.httpClient.get<{ conversation: Conversation; messages: Message[] }>(`/chat/conversations/${id}`, true);
  }

  async updateConversation(id: string, data: { title?: string; favorited?: boolean }): Promise<Conversation> {
    return this.httpClient.put<Conversation>(`/chat/conversations/${id}`, data, true);
  }

  async deleteConversation(id: string): Promise<void> {
    await this.httpClient.delete(`/chat/conversations/${id}`, true);
  }

  async deleteMessage(conversationId: string, messageId: string, mode: 'single' | 'from-here' = 'single'): Promise<{ deleted: number }> {
    return this.httpClient.delete<{ deleted: number }>(`/chat/conversations/${conversationId}/messages/${messageId}?mode=${mode}`, true);
  }

  async sendMessage(conversationId: string, data: { role: string; content: string; modelId?: string; metadata?: Record<string, any> | null }): Promise<Message> {
    return this.httpClient.post<Message>(`/chat/conversations/${conversationId}/messages`, data, true);
  }

  async getMessages(conversationId: string, params?: { limit?: number; offset?: number }): Promise<MessageListResponse> {
    const urlParams = new URLSearchParams();
    if (params?.limit) urlParams.append('limit', params.limit.toString());
    if (params?.offset) urlParams.append('offset', params.offset.toString());
    const queryString = urlParams.toString();
    const url = queryString ? `/chat/conversations/${conversationId}/messages?${queryString}` : `/chat/conversations/${conversationId}/messages`;
    return this.httpClient.get<MessageListResponse>(url, true);
  }

  async uploadChatAttachment(conversationId: string, file: File): Promise<ChatAttachment> {
    const formData = new FormData();
    formData.append('file', file);
    return this.httpClient.upload<ChatAttachment>(`/chat/conversations/${conversationId}/attachments`, formData, true);
  }

  async linkAttachments(attachmentIds: string[], messageId: string): Promise<void> {
    await this.httpClient.put('/chat/attachments/link', { attachmentIds, messageId }, true);
  }

  // ============ AI API ============

  async getBuiltinModels(): Promise<AIModel[]> {
    const result = await this.httpClient.get<{ models: AIModel[] }>('/ai/models', true);
    return result.models;
  }

  async generateTitle(
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    conversationId: string
  ): Promise<string> {
    const result = await this.httpClient.post<{ title: string }>(
      '/ai/chat/generate-title',
      { modelId, messages, conversationId },
      true
    );
    return result.title;
  }
}

// ============ 导出单例实例 ============

export const apiClient = new ApiClient();
export default apiClient;
