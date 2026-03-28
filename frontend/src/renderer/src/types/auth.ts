export interface User {
  id: string
  name: string
  username?: string
  avatarUrl: string
  email?: string
  feishuId?: string
  feishu_id?: string
}

export interface AuthStatus {
  loggedIn: boolean
  user?: User
}
