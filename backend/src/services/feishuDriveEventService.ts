/**
 * Feishu drive/file edit event fan-out for CoPiper spreadsheet sync.
 * Events are optional enhancement; clients always poll as baseline.
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface SpreadsheetEditEvent {
  type: 'spreadsheet_edited';
  token: string;
  ts: number;
  fileType?: string;
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

/** In-memory recent events for late subscribers (last 50) */
const recent: SpreadsheetEditEvent[] = [];
const MAX_RECENT = 50;

export function publishSpreadsheetEdit(token: string, fileType?: string): void {
  if (!token) return;
  const evt: SpreadsheetEditEvent = {
    type: 'spreadsheet_edited',
    token,
    ts: Date.now(),
    fileType,
  };
  recent.push(evt);
  if (recent.length > MAX_RECENT) recent.shift();
  bus.emit('edit', evt);
  logger.info(`Feishu drive event: spreadsheet_edited token=${token}`);
}

export function subscribeEdits(listener: (evt: SpreadsheetEditEvent) => void): () => void {
  bus.on('edit', listener);
  return () => bus.off('edit', listener);
}

export function getRecentEdits(): SpreadsheetEditEvent[] {
  return [...recent];
}

/**
 * Parse Feishu event body (HTTP callback or WS-style payload).
 * Supports drive.file.edit_v1-like shapes.
 */
export function handleFeishuEventPayload(body: Record<string, unknown>): void {
  // Challenge for URL verification
  // (caller handles challenge response)

  const header = (body.header || {}) as Record<string, unknown>;
  const eventType = String(header.event_type || body.type || '');
  const event = (body.event || body) as Record<string, unknown>;

  if (
    eventType.includes('file.edit') ||
    eventType.includes('drive.file') ||
    eventType === 'drive.file.edit_v1'
  ) {
    const fileToken =
      (event.file_token as string) ||
      (event.token as string) ||
      ((event.file as Record<string, unknown>)?.token as string) ||
      '';
    const fileType =
      (event.file_type as string) ||
      ((event.file as Record<string, unknown>)?.type as string) ||
      '';
    // Spreadsheet tokens often start with sht
    if (fileToken) {
      publishSpreadsheetEdit(fileToken, fileType);
    }
  }

  // Also accept simplified internal test payload
  if (body.type === 'spreadsheet_edited' && typeof body.token === 'string') {
    publishSpreadsheetEdit(body.token as string);
  }
}
