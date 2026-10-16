import { describe, it, expect } from 'vitest'
import { getLocalIpv4 } from '../system.service'
import type { NetworkInterfaceInfo } from 'os'

describe('system.service', () => {
  it('prefers physical interface over virtual switch', () => {
    const mockInterfaces: Record<string, NetworkInterfaceInfo[]> = {
      '以太网': [
        {
          address: 'fe80::7292:649b:bc75:24b',
          netmask: 'ffff:ffff:ffff:ffff::',
          family: 'IPv6',
          mac: '34:5a:60:7f:03:65',
          internal: false,
          cidr: 'fe80::7292:649b:bc75:24b/64',
          scopeid: 20
        },
        {
          address: '192.168.10.23',
          netmask: '255.255.255.0',
          family: 'IPv4',
          mac: '34:5a:60:7f:03:65',
          internal: false,
          cidr: '192.168.10.23/24'
        }
      ],
      'vEthernet (Default Switch)': [
        {
          address: '172.22.48.1',
          netmask: '255.255.240.0',
          family: 'IPv4',
          mac: '00:15:5d:d4:a9:70',
          internal: false,
          cidr: '172.22.48.1/20'
        }
      ],
      'Loopback Pseudo-Interface 1': [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8'
        }
      ]
    }

    const ip = getLocalIpv4(mockInterfaces)
    expect(ip).toBe('192.168.10.23')
  })

  it('falls back to 127.0.0.1 if only internal interfaces exist', () => {
    const mockInterfaces: Record<string, NetworkInterfaceInfo[]> = {
      lo: [
        {
          address: '127.0.0.1',
          netmask: '255.0.0.0',
          family: 'IPv4',
          mac: '00:00:00:00:00:00',
          internal: true,
          cidr: '127.0.0.1/8'
        }
      ]
    }

    const ip = getLocalIpv4(mockInterfaces)
    expect(ip).toBe('127.0.0.1')
  })
})
