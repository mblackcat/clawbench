import Store from 'electron-store'

interface ApiCredentialsSchema {
  apiToken: string
}

const credentialsStore = new Store<ApiCredentialsSchema>({
  name: 'api-credentials',
  schema: {
    apiToken: { type: 'string', default: '' }
  }
})

export function saveApiToken(token: string): void {
  credentialsStore.set('apiToken', token)
}

export function clearApiToken(): void {
  credentialsStore.set('apiToken', '')
}

export function getApiToken(): string {
  return credentialsStore.get('apiToken')
}
