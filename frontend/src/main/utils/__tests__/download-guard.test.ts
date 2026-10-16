import { describe, it, expect, vi, afterEach } from 'vitest'
import { validateDownloadUrl, fetchPackageArchive } from '../download-guard'

describe('validateDownloadUrl', () => {
  const base = 'http://10.0.0.5:3001/api/v1'

  it('accepts public https hosts', () => {
    expect(() => validateDownloadUrl('https://market.example.com/a.zip', base)).not.toThrow()
  })

  it('trusts localhost and the configured backend origin even if private', () => {
    expect(() => validateDownloadUrl('http://localhost:3001/x.zip', base)).not.toThrow()
    expect(() => validateDownloadUrl('http://10.0.0.5:3001/x.zip', base)).not.toThrow()
  })

  it('rejects non-http protocols and malformed urls', () => {
    expect(() => validateDownloadUrl('file:///etc/passwd', base)).toThrow(/HTTP/)
    expect(() => validateDownloadUrl('ftp://example.com/a.zip', base)).toThrow(/HTTP/)
    expect(() => validateDownloadUrl('not a url', base)).toThrow(/Invalid URL/)
    expect(() => validateDownloadUrl('', base)).toThrow(/Invalid download URL/)
  })

  it('rejects other private, loopback and link-local hosts', () => {
    for (const host of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '[::1]', '[fd00::1]']) {
      expect(() => validateDownloadUrl(`http://${host}/a.zip`, base)).toThrow()
    }
  })

  it('rejects bare public IPs that are not the backend origin', () => {
    expect(() => validateDownloadUrl('http://8.8.8.8/a.zip', base)).toThrow(/Direct IP/)
  })

  it('does not treat 172.32.x as private but still blocks it as a bare IP', () => {
    expect(() => validateDownloadUrl('http://172.32.0.1/a.zip', base)).toThrow(/Direct IP/)
  })
})

describe('fetchPackageArchive', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects responses whose content-length exceeds the cap', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(new Uint8Array(10), { headers: { 'content-length': '999' } }))
    )
    await expect(
      fetchPackageArchive('http://localhost/a.zip', undefined, { maxBytes: 100 })
    ).rejects.toThrow(/exceeds/)
  })

  it('rejects bodies larger than the cap', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array(200))))
    await expect(
      fetchPackageArchive('http://localhost/a.zip', undefined, { maxBytes: 100 })
    ).rejects.toThrow(/exceeds/)
  })

  it('aborts a streamed body without content-length once it crosses the cap', async () => {
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(64))
        if (pulled > 1000) controller.close()
      }
    })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream)))
    await expect(
      fetchPackageArchive('http://localhost/a.zip', undefined, { maxBytes: 100 })
    ).rejects.toThrow(/exceeds/)
    expect(pulled).toBeLessThan(10)
  })

  it('surfaces HTTP errors and passes the bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response('nope', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPackageArchive('http://localhost/a.zip', 'tok')).rejects.toThrow(/404/)
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> }
    expect(init.headers.Authorization).toBe('Bearer tok')
  })

  it('returns the downloaded buffer', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))))
    const buf = await fetchPackageArchive('http://localhost/a.zip')
    expect([...buf]).toEqual([1, 2, 3])
  })
  it('re-validates redirect targets and refuses private hosts', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(null, { status: 302, headers: { location: 'http://192.168.1.10/evil.zip' } })
    )
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchPackageArchive('https://cdn.example.com/a.zip', 'tok')).rejects.toThrow(/Private|IP/)
  })

  it('follows a public redirect without forwarding the token off-origin', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: 'https://files.example.org/a.zip' } })
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([7])))
    vi.stubGlobal('fetch', fetchMock)
    const buf = await fetchPackageArchive('https://cdn.example.com/a.zip', 'tok')
    expect([...buf]).toEqual([7])
    const second = fetchMock.mock.calls[1][1] as { headers: Record<string, string> }
    expect(second.headers.Authorization).toBeUndefined()
  })
})
