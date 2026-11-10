import { Request } from 'express';

/** 存储的 IP 最大长度（IPv6 最长 45 字符，留余量） */
const MAX_IP_LENGTH = 64;

/**
 * 服务端观察到的客户端 IP。
 *
 * 只使用 Express 的 `req.ip`：未设置 TRUST_PROXY 时为 TCP 对端地址；设置后由 Express 按
 * 信任的代理跳数解析 X-Forwarded-For。**不**读取客户端自报的 IP（body / query / X-Client-IP），
 * 因为它们可被任意伪造。IPv4-mapped IPv6（::ffff:1.2.3.4）规整为 IPv4。
 */
export function getClientIp(req: Request): string | undefined {
  const raw = (req.ip || '').trim();
  if (!raw) return undefined;
  const ip = raw.startsWith('::ffff:') && raw.includes('.') ? raw.slice('::ffff:'.length) : raw;
  return ip.slice(0, MAX_IP_LENGTH);
}
