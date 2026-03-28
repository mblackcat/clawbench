export interface Workspace {
  id: string
  name: string
  path: string
  vcsType: 'git' | 'svn' | 'perforce' | 'none'
  createdAt: string
}
