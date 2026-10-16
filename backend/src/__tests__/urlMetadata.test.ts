import http from 'http';
import { AddressInfo } from 'net';
import {
  isBlockedAddress,
  normalizeUrl,
  fallbackTitleFromUrl,
  fetchUrlMetadata,
} from '../services/urlMetadata.service';

describe('urlMetadata.service', () => {
  describe('isBlockedAddress', () => {
    it.each([
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '::1',
      '::',
      'fe80::1',
      'fc00::1',
      'fd12:3456::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:10.0.0.1',
      'not-an-ip',
    ])('blocks %s', (ip) => {
      expect(isBlockedAddress(ip)).toBe(true);
    });

    it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '93.184.216.34', '2606:4700:4700::1111'])(
      'allows %s',
      (ip) => {
        expect(isBlockedAddress(ip)).toBe(false);
      }
    );
  });

  it('normalizes urls and derives fallback titles', () => {
    expect(normalizeUrl('example.com/path')).toBe('https://example.com/path');
    expect(normalizeUrl('ftp://example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('   ')).toBeNull();
    expect(fallbackTitleFromUrl('https://www.example.com/a')).toBe('example.com');
  });

  describe('fetchUrlMetadata SSRF protection', () => {
    let server: http.Server;
    let port: number;
    let hits = 0;

    beforeAll(async () => {
      server = http.createServer((_req, res) => {
        hits++;
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<html><head><title>Internal Secret</title></head></html>');
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      port = (server.address() as AddressInfo).port;
    });

    afterAll(async () => {
      delete process.env.NAV_METADATA_ALLOW_PRIVATE;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('does not fetch loopback targets (IP literal or localhost)', async () => {
      hits = 0;
      const byIp = await fetchUrlMetadata(`http://127.0.0.1:${port}/`);
      const byName = await fetchUrlMetadata(`http://localhost:${port}/`);
      expect(byIp.title).toBeNull();
      expect(byName.title).toBeNull();
      expect(hits).toBe(0);
    });

    it('fetches private targets when NAV_METADATA_ALLOW_PRIVATE=true', async () => {
      process.env.NAV_METADATA_ALLOW_PRIVATE = 'true';
      const result = await fetchUrlMetadata(`http://127.0.0.1:${port}/`);
      expect(result.title).toBe('Internal Secret');
      delete process.env.NAV_METADATA_ALLOW_PRIVATE;
    });
  });
});
