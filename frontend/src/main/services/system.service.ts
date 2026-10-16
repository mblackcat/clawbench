import os from 'os'

/**
 * Get the most relevant local IPv4 address (excluding loopback and APIPA).
 * Prioritizes physical interfaces and common private network subnets.
 */
export function getLocalIpv4(customInterfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>): string {
  const interfaces = customInterfaces || os.networkInterfaces()
  const candidates: Array<{ address: string; score: number }> = []

  const virtualRegex = /vethernet|virtual|docker|vmnet|veth|wsl|tailscale|wireguard|utun|tap|tun|pseudo|dummy/i
  const physicalRegex = /以太网|ethernet|wi-fi|wlan|lan|en\d|eth\d/i

  for (const [name, ifaceList] of Object.entries(interfaces)) {
    if (!ifaceList) continue
    const isVirtual = virtualRegex.test(name)
    const isPhysical = physicalRegex.test(name)

    for (const iface of ifaceList) {
      const isIpv4 = iface.family === 'IPv4' || (iface.family as unknown) === 4
      if (!isIpv4 || iface.internal) continue
      const addr = iface.address
      if (addr.startsWith('169.254.') || addr.startsWith('127.')) continue

      let score = 0
      if (!isVirtual) score += 100
      if (isPhysical) score += 50

      if (addr.startsWith('192.168.')) {
        score += 30
      } else if (addr.startsWith('10.')) {
        score += 25
      } else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr)) {
        score += 20
      } else {
        score += 10
      }

      candidates.push({ address: addr, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates[0]?.address || '127.0.0.1'
}
