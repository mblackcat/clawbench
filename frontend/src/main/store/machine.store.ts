import Store from 'electron-store'
import { randomUUID } from 'crypto'

interface MachineStoreSchema {
  machineId: string
}

const machineStore = new Store<MachineStoreSchema>({
  name: 'machine-store',
  schema: {
    machineId: { type: 'string', default: '' }
  }
})

export function getMachineId(): string {
  let id = machineStore.get('machineId')
  if (!id) {
    id = randomUUID()
    machineStore.set('machineId', id)
  }
  return id
}
