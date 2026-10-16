import http from 'http';
import https from 'https';
import dns from 'dns';
import net from 'net';
import { URL } from 'url';
import { logger } from '../utils/logger';

/**
 * URL 元信息抓取 — 导航栏未配置标题/图标时，服务端请求该 URL 解析 <title> 与 favicon。
 *
 * 抓取由 admin 触发且目标由 admin 填写，防护措施：
 * 仅 http/https、限制重定向次数、超时、读取字节上限；
 * SSRF：DNS 解析后拒绝私网 / 回环 / 链路本地 / 保留地址（连接时校验，防 DNS rebinding，
 * 每次重定向同样校验）。内网部署需要抓取内网页面时可设 NAV_METADATA_ALLOW_PRIVATE=true。
 */

/** 单次请求超时 */
const TIMEOUT_MS = 8000;
/** 只读取前 512KB —— <head> 足够，避免大页面拖垮进程 */
const MAX_BYTES = 512 * 1024;
/** 最多跟随的重定向次数 */
const MAX_REDIRECTS = 3;

const USER_AGENT = 'Mozilla/5.0 (compatible; ClawBench/1.0) NavMetadataBot';

/** 是否允许抓取私网地址（默认禁止，防 SSRF） */
function allowPrivateTargets(): boolean {
  return process.env.NAV_METADATA_ALLOW_PRIVATE === 'true';
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + (parseInt(part, 10) & 0xff), 0) >>> 0;
}

function inIpv4Cidr(ip: string, base: string, bits: number): boolean {
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
}

const BLOCKED_IPV4_CIDRS: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local (incl. cloud metadata 169.254.169.254)
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay anycast
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
];

/**
 * 判断 IP 是否为禁止抓取的地址（私网 / 回环 / 链路本地 / 保留 / 组播）
 * @param address IPv4 或 IPv6 字面量
 */
export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) {
    return BLOCKED_IPV4_CIDRS.some(([base, bits]) => inIpv4Cidr(address, base, bits));
  }
  if (family === 6) {
    const lower = address.toLowerCase().split('%')[0];
    // IPv4-mapped / -compatible (::ffff:a.b.c.d, ::a.b.c.d)
    const mapped = /^::(ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isBlockedAddress(mapped[2]);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isBlockedAddress(`${hi >> 8}.${hi & 0xff}.${lo >> 8}.${lo & 0xff}`);
    }
    if (lower === '::' || lower === '::1') return true;
    const firstHextet = parseInt(lower.split(':')[0] || '0', 16);
    if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
    if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
    if ((firstHextet & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
    if ((firstHextet & 0xff00) === 0xff00) return true; // ff00::/8 multicast
    if (lower.startsWith('64:ff9b:')) return true; // NAT64 (may embed private IPv4)
    if (lower.startsWith('2002:')) return true; // 6to4 (may embed private IPv4)
    return false;
  }
  return true; // not an IP literal → treat as unsafe
}

/**
 * http(s).get 的 lookup：解析后逐个校验地址，命中禁止地址则报错。
 * 在建立连接时校验，避免"先查后连"之间被 DNS rebinding 绕过。
 */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) {
      (callback as any)(err);
      return;
    }
    const list = (Array.isArray(addresses) ? addresses : [addresses]) as dns.LookupAddress[];
    if (list.length === 0) {
      (callback as any)(new Error(`No address for ${hostname}`));
      return;
    }
    if (!allowPrivateTargets()) {
      const blocked = list.find((a) => isBlockedAddress(a.address));
      if (blocked) {
        (callback as any)(new Error(`Blocked private address for ${hostname}`));
        return;
      }
    }
    if ((options as dns.LookupOptions).all) {
      (callback as any)(null, list);
    } else {
      (callback as any)(null, list[0].address, list[0].family);
    }
  });
};

/** 同步校验 URL 的 hostname：IP 字面量直接判断（Node 不会对 IP 字面量调用 lookup） */
function isBlockedLiteralHost(target: URL): boolean {
  if (allowPrivateTargets()) return false;
  const host = target.hostname.replace(/^\[|\]$/g, '');
  if (host.toLowerCase() === 'localhost' || host.toLowerCase().endsWith('.localhost')) return true;
  if (net.isIP(host)) return isBlockedAddress(host);
  return false;
}

/** 抓取结果；抓取失败时字段为 null */
export interface UrlMetadata {
  title: string | null;
  icon: string | null;
}

/**
 * 规范化用户输入的 URL：缺省协议时补 https://
 * @param raw 原始输入
 * @returns 规范化后的绝对 URL；非法时返回 null
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    if (!parsed.hostname) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * 从 URL 推导兜底标题（hostname，去掉 www.）
 * @param url 绝对 URL
 * @returns 兜底标题
 */
export function fallbackTitleFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

/** 解码 HTML 中常见的实体，避免标题里出现 &amp; 之类 */
function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&amp;/g, '&');
}

/**
 * 读取一个 URL 的 HTML（跟随重定向，截断到 MAX_BYTES）
 * @returns HTML 文本与最终 URL；失败时返回 null
 */
function fetchHtml(
  target: string,
  redirectsLeft: number
): Promise<{ body: string; finalUrl: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: { body: string; finalUrl: string } | null): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let parsedTarget: URL;
    try {
      // 提前校验，非法 URL 直接失败而不是抛到 http.get
      parsedTarget = new URL(target);
    } catch {
      finish(null);
      return;
    }
    if (parsedTarget.protocol !== 'http:' && parsedTarget.protocol !== 'https:') {
      finish(null);
      return;
    }
    if (isBlockedLiteralHost(parsedTarget)) {
      logger.warn(`URL metadata fetch blocked (private address): ${parsedTarget.hostname}`);
      finish(null);
      return;
    }

    const client = parsedTarget.protocol === 'https:' ? https : http;
    const request = client.get(
      target,
      {
        timeout: TIMEOUT_MS,
        lookup: safeLookup,
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml',
        },
      },
      (response) => {
        const status = response.statusCode ?? 0;
        const location = response.headers.location;

        if (status >= 300 && status < 400 && location) {
          response.resume();
          if (redirectsLeft <= 0) {
            finish(null);
            return;
          }
          let next: string;
          try {
            next = new URL(location, target).toString();
          } catch {
            finish(null);
            return;
          }
          fetchHtml(next, redirectsLeft - 1).then(finish);
          return;
        }

        if (status < 200 || status >= 300) {
          response.resume();
          finish(null);
          return;
        }

        const chunks: Buffer[] = [];
        let received = 0;
        response.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received <= MAX_BYTES) {
            chunks.push(chunk);
          } else {
            // 已够解析 <head>，主动断开
            response.destroy();
          }
        });
        response.on('end', () => {
          finish({ body: Buffer.concat(chunks).toString('utf8'), finalUrl: target });
        });
        response.on('close', () => {
          // 因超限被 destroy 时走这里，已收到的部分足以解析 <head>
          finish(
            chunks.length > 0
              ? { body: Buffer.concat(chunks).toString('utf8'), finalUrl: target }
              : null
          );
        });
        response.on('error', () => finish(null));
      }
    );

    request.on('timeout', () => request.destroy());
    request.on('error', () => finish(null));
  });
}

/** 从 HTML 中解析 <title> */
function parseTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = decodeEntities(match[1]).replace(/\s+/g, ' ').trim();
  return title || null;
}

/** 从 HTML 中解析 favicon（<link rel="icon">），解析不到时回退到 /favicon.ico */
function parseIcon(html: string, baseUrl: string): string | null {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const relMatch = /\brel\s*=\s*["']?([^"'>]+)/i.exec(tag);
    if (!relMatch) continue;
    const rel = relMatch[1].toLowerCase();
    if (!/\b(shortcut )?icon\b/.test(rel) && !rel.includes('apple-touch-icon')) continue;

    const hrefMatch = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (!hrefMatch) continue;
    try {
      return new URL(decodeEntities(hrefMatch[1]).trim(), baseUrl).toString();
    } catch {
      continue;
    }
  }

  try {
    return new URL('/favicon.ico', baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * 抓取 URL 的标题与图标。网络失败时 title 为 null（由调用方兜底为 hostname），
 * icon 退回站点根目录的 /favicon.ico。
 *
 * @param url 绝对 URL（应先经 normalizeUrl 处理）
 * @returns 标题与图标
 */
export async function fetchUrlMetadata(url: string): Promise<UrlMetadata> {
  try {
    const result = await fetchHtml(url, MAX_REDIRECTS);
    if (!result) {
      // 页面拿不到时，favicon 仍大概率存在于站点根目录
      let icon: string | null = null;
      try {
        icon = new URL('/favicon.ico', url).toString();
      } catch {
        icon = null;
      }
      return { title: null, icon };
    }
    return {
      title: parseTitle(result.body),
      icon: parseIcon(result.body, result.finalUrl),
    };
  } catch (error) {
    logger.warn(`Failed to fetch URL metadata for ${url}: ${String(error)}`);
    return { title: null, icon: null };
  }
}
