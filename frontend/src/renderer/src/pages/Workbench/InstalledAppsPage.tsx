/**
 * 收藏栏页面（原已装应用）—— Workbench 模块（canonical: `workbench` / 路由 `/workbench/installed`）
 * Workbench 子概念：sub apps & ai skills & prompts & links（资源中心）。
 * 注意：本模块旧名/旧路由为 "Apps"(`/apps`)，与 AI Coding(`/ai-coding`) 无关。
 * 统一显示所有本地收藏内容（app/skill/prompt）
 * 支持长按拖拽排序
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Typography, Empty, Button, Tag, Tooltip, theme, App, Space, Segmented, Tabs, Divider, Spin } from 'antd';
import {
  SyncOutlined,
  CaretRightOutlined,
  MoreOutlined,
  DeleteOutlined,
  HolderOutlined,
  ThunderboltOutlined,
  CopyOutlined,
  RocketOutlined,
  CompassOutlined,
  PlusOutlined,
  SnippetsOutlined,
  LinkOutlined,
  ExportOutlined,
  CloseOutlined,
  AppstoreOutlined,
  ProfileOutlined,
  FileTextOutlined,
  CloudDownloadOutlined,
  PushpinOutlined,
  PushpinFilled
} from '@ant-design/icons';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useNavigate } from 'react-router-dom';
import type { SubAppManifest } from '../../types/subapp';
import { resolveAppPublished } from '../../types/subapp';
import { useSubAppStore } from '../../stores/useSubAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useChatStore } from '../../stores/useChatStore';
import { useSkillStore } from '../../stores/useSkillStore';
import { useAppScheduleStore } from '../../stores/useAppScheduleStore';
import { useProjectNavStore } from '../../stores/useProjectNavStore';
import type { ScannedSkill } from '../../types/skill';
import type { Application } from '../../types/api';
import dayjs from 'dayjs';
import ParamDrawer from '../../components/ParamDrawer';
import CreateTypeModal from '../../components/CreateTypeModal';
import NavBookmarkBar from '../../components/NavBookmarkBar';
import { FolderCard } from '../../components/FolderCard';
import { AppIcon } from '../../components/AppIcon';
import { AppStatusTag, AppVersionTag } from '../../components/AppStatusTag';
import {
  BUILTIN_APP_ID_PREFIX,
  builtinAppKeyFromId,
  isBuiltinAppId,
  resolveLocalAppStatus,
  type AppCardStatus,
  type AppOrigin
} from '../../utils/app-status';
import { openExternalLink } from '../../utils/markdown-links';
import { buildInitialAppParams, saveAppParams } from '../../utils/subapp-params';
import { useT } from '../../i18n';
import { applicationManager } from '../../services/applicationManager';
import { mergeAdminPins, readLastAdminPins, writeLastAdminPins } from '../../utils/builtin-pins';
import { apiClient } from '../../services/apiClient';
import { isAuthoredByCurrentUser } from '../../utils/app-identity';
import { seedTaskFromExecuteResult, describeEarlyTerminal } from '../../utils/subapp-execute';

const { Title, Text } = Typography;

type ViewMode = 'tiled' | 'tabbed';
const VIEW_MODE_STORAGE_KEY = 'workbench.viewMode';

interface SubAppInfo {
  id: string
  manifest: SubAppManifest
  path: string
  source: 'user'
}

// Publication status. Renamed from 'installed' (which was misleading — every
// card here is favorited) to 'published' so the tag actually conveys useful
// information. Server-authoritative via resolveAppPublished(): the server-side
// published-name set is the single source of truth; manifest.published is only
// a positive offline fallback. (Stale local published:false from old publish
// flows must never override the server — see reconcilePublishedFlags.)
type AppType = 'published' | 'draft' | 'local';

interface AppWithType extends SubAppInfo {
  appType: AppType
  /** Card status used by AppStatusTag / AppVersionTag (status model). */
  status: AppCardStatus
  /** Marketplace version when known (drives the version-diff tag). */
  remoteVersion?: string
  /** App origin: own / builtin / installed. */
  origin: AppOrigin
  /** Marketplace applicationId when matched (id first, then name). */
  applicationId?: string
}

/**
 * Module-level cache of the last classified list so returning to the page
 * paints immediately (optimistic first paint) while fresh data loads.
 */
let cachedClassifiedApps: AppWithType[] = [];

/**
 * Converts an Electron accelerator modifier string to a human-readable label.
 */
function formatModifier(modifier: string): string {
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  return modifier
    .replace('CommandOrControl', isMac ? '⌘' : 'Ctrl')
    .replace('Control', 'Ctrl')
    .replace('Shift', isMac ? '⇧' : 'Shift')
    .replace('Alt', isMac ? '⌥' : 'Alt')
    .replace(/\+/g, ' + ');
}

// ---- Sortable App Card ----

interface SortableCardProps {
  appWithType: AppWithType
  index: number
  shortcutLabel: string | null
  token: ReturnType<typeof theme.useToken>['token']
  t: (key: string, ...args: string[]) => string
  getManifestTypeTag: (type?: string) => React.ReactNode
  onRun: (id: string, name: string, manifest: SubAppManifest) => void
  onUninstall: (id: string, name: string) => void
  onActivateSkill: (id: string, name: string) => void
  onCopyPrompt: (id: string) => void
  onTryPrompt: (id: string) => void
  onViewDetail: (id: string) => void
  onShowDetail: (id: string, manifest: SubAppManifest) => void
  /** 更新到最新版本（市场 / 服务端归档 / 自带版本） */
  onUpdate: (app: AppWithType) => void
  /** 重置为线上 / 自带版本（本地版本高于基线时） */
  onReset: (app: AppWithType) => void
  /** 该 app 是否已开启定时执行 */
  scheduleEnabled?: boolean
  /** 下次执行时间戳（scheduleEnabled 为 true 时展示） */
  scheduleNextRunAt?: number
  /** 是否置顶到收藏栏分组顶部 */
  pinned?: boolean
  /** 切换置顶状态（管理员置顶的内置应用不提供切换） */
  onTogglePin?: (id: string) => void
  /** 该内置应用由管理员置顶（只读展示） */
  adminPinned?: boolean
}

const SortableAppCard: React.FC<SortableCardProps> = ({
  appWithType,
  shortcutLabel,
  token,
  t,
  getManifestTypeTag,
  onRun,
  onUninstall,
  onActivateSkill,
  onCopyPrompt,
  onTryPrompt,
  onViewDetail,
  onShowDetail,
  onUpdate,
  onReset,
  scheduleEnabled,
  scheduleNextRunAt,
  pinned,
  onTogglePin,
  adminPinned
}) => {
  const { id, manifest, status, origin } = appWithType;
  const app = manifest;
  const manifestType = app.type || 'app';
  const isBuiltin = origin === 'builtin';
  const isDraft = status === 'draft';
  const needsUpdate = status === 'pending_update';
  const needsReset = status === 'reset_builtin' || status === 'reset_online';
  const hasSchedule = manifestType === 'app' && !!scheduleEnabled && !!scheduleNextRunAt;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    position: 'relative',
    height: '100%'
  };

  const variant = isBuiltin
    ? 'builtin'
    : isDraft
      ? 'draft'
      : origin === 'own'
        ? 'own-published'
        : 'regular';

  const notchActions = (
    <>
      {isBuiltin && adminPinned ? (
        <Tooltip title={t('workbench.pinnedByAdmin')}>
          <span className="cb-notch-btn">
            <PushpinFilled style={{ color: token.colorPrimary, fontSize: 13 }} />
          </span>
        </Tooltip>
      ) : (
        onTogglePin && (
          <Tooltip title={pinned ? t('workbench.unpin') : t('workbench.pin')}>
            <button
              type="button"
              className="cb-notch-btn"
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin(id);
              }}
            >
              {pinned ? (
                <PushpinFilled style={{ color: token.colorPrimary, fontSize: 13 }} />
              ) : (
                <PushpinOutlined style={{ fontSize: 13 }} />
              )}
            </button>
          </Tooltip>
        )
      )}
      <Tooltip title={t('workbench.dragSortTip')}>
        <div
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="cb-notch-btn"
          style={{ cursor: 'grab', touchAction: 'none' }}
        >
          <HolderOutlined style={{ fontSize: 13 }} />
        </div>
      </Tooltip>
    </>
  );

  /** Round action button; stops propagation so the card click (detail) doesn't fire. */
  const actionBtn = (
    key: string,
    title: string,
    kind: 'primary' | 'danger' | 'neutral',
    icon: React.ReactNode,
    onClick: () => void
  ) => (
    <Tooltip key={key} title={title}>
      <button
        type="button"
        className={`cb-round-action-btn cb-round-action-${kind}`}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
      >
        {icon}
      </button>
    </Tooltip>
  );

  const typeActions =
    manifestType === 'ai-skill'
      ? [
          actionBtn('detail', t('skillDetail.detail'), 'neutral', <FileTextOutlined style={{ fontSize: 13 }} />, () => onViewDetail(id)),
          actionBtn('activate', t('workbench.activateSkill'), 'primary', <ThunderboltOutlined style={{ fontSize: 14 }} />, () => onActivateSkill(id, app.name))
        ]
      : manifestType === 'prompt'
        ? [
            actionBtn('copy', t('workbench.copy'), 'neutral', <CopyOutlined style={{ fontSize: 13 }} />, () => onCopyPrompt(id)),
            actionBtn('try', t('workbench.tryIt'), 'primary', <RocketOutlined style={{ fontSize: 14 }} />, () => onTryPrompt(id))
          ]
        : [
            actionBtn('run', t('workbench.run'), 'primary', <CaretRightOutlined style={{ fontSize: 14, marginLeft: 2 }} />, () => onRun(id, app.name, manifest))
          ];

  return (
    <div ref={setNodeRef} style={style}>
      <FolderCard
        variant={variant}
        pinned={pinned}
        notchActions={notchActions}
        style={{ cursor: 'pointer' }}
        onClick={(e) => {
          e.stopPropagation();
          onShowDetail(id, manifest);
        }}
      >
        {/* Header: icon + single-line title (leaves room for the notch actions) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 32, width: 'calc(100% - 74px)' }}>
          <AppIcon icon={manifest.icon} name={app.name} category={manifest.category} size={28} />
          <Tooltip
            title={
              <div>
                <div>{app.name}</div>
                <div style={{ marginTop: 2, fontSize: 12 }}>{t('workbench.cardTipClick')}</div>
                {shortcutLabel && (
                  <div style={{ marginTop: 2, fontSize: 12 }}>
                    {t('workbench.shortcutTooltip', shortcutLabel)}
                  </div>
                )}
              </div>
            }
          >
            <Text
              strong
              ellipsis
              style={{
                fontSize: 13,
                lineHeight: '20px',
                color: isDraft ? token.colorTextSecondary : undefined,
                fontWeight: pinned && !isDraft ? 700 : 600
              }}
            >
              {app.name}
            </Text>
          </Tooltip>
        </div>

        {/* Single-line description */}
        <div
          className="cb-card-desc"
          style={{
            fontSize: 12,
            lineHeight: '18px',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            margin: '6px 0'
          }}
        >
          {manifest.description || t('workbench.noDesc')}
        </div>

        {/* Tag row */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', minHeight: 20, marginBottom: 8 }}>
          {getManifestTypeTag(app.type)}
          <AppStatusTag status={status} />
        </div>

        {/* Bottom row: version on the left, round actions on the right */}
        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 6,
            paddingTop: 8
          }}
        >
          <AppVersionTag
            localVersion={app.version}
            remoteVersion={appWithType.remoteVersion}
            status={status}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {hasSchedule && (
              <Tooltip title={`${t('appSchedule.nextRun')}: ${dayjs(scheduleNextRunAt).format('YYYY-MM-DD HH:mm')}`}>
                <button
                  type="button"
                  className="cb-round-action-btn cb-round-action-neutral"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShowDetail(id, manifest);
                  }}
                >
                  <SyncOutlined spin style={{ color: token.colorPrimary, fontSize: 13 }} />
                </button>
              </Tooltip>
            )}
            {actionBtn('delete', t('workbench.delete'), 'danger', <DeleteOutlined style={{ fontSize: 13 }} />, () => onUninstall(id, app.name))}
            {needsUpdate &&
              actionBtn('update', t('appStatus.updateAction'), 'neutral', <CloudDownloadOutlined style={{ fontSize: 14, color: token.colorPrimary }} />, () => onUpdate(appWithType))}
            {needsReset &&
              actionBtn('reset', t('appStatus.reset'), 'neutral', <SyncOutlined style={{ fontSize: 13, color: token.colorWarning }} />, () => onReset(appWithType))}
            {typeActions}
          </div>
        </div>
      </FolderCard>
    </div>
  );
};

// ---- Sortable Link Card ----

interface SortableLinkCardProps {
  appWithType: AppWithType
  token: any
  t: (key: string, ...args: string[]) => string
  onOpen: (app: AppWithType) => void
  onUninstall: (id: string, name: string) => void
}

const SortableLinkCard: React.FC<SortableLinkCardProps> = ({
  appWithType,
  token,
  t,
  onOpen,
  onUninstall
}) => {
  const { id, manifest } = appWithType;
  const isMini = !!manifest.mini;
  const [imgError, setImgError] = useState(false);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    // mini occupies 1 grid cell; a normal card spans 2x2 (== 4 minis)
    gridColumn: isMini ? 'span 1' : 'span 2',
    gridRow: isMini ? 'span 1' : 'span 2'
  };

  const iconSize = isMini ? 20 : 36;
  const hasIcon = !!manifest.icon && !imgError;

  const iconNode = hasIcon ? (
    <img
      src={manifest.icon}
      alt=""
      onError={() => setImgError(true)}
      style={{ width: iconSize, height: iconSize, borderRadius: 6, objectFit: 'contain', flexShrink: 0 }}
    />
  ) : (
    <div
      style={{
        width: iconSize,
        height: iconSize,
        borderRadius: 6,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorFillSecondary,
        color: token.colorTextSecondary,
        fontSize: iconSize * 0.55
      }}
    >
      <LinkOutlined />
    </div>
  );

  const deleteBtn = (
    <div
      onClick={(e) => {
        e.stopPropagation();
        onUninstall(id, manifest.name);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className="cb-link-card__del"
      style={{
        position: 'absolute',
        top: 4,
        right: 4,
        width: 18,
        height: 18,
        borderRadius: 4,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: token.colorFillSecondary,
        color: token.colorTextSecondary,
        fontSize: 10,
        cursor: 'pointer',
        zIndex: 2
      }}
    >
      <CloseOutlined />
    </div>
  );

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <Tooltip title={manifest.url || manifest.name}>
        <div
          className="cb-glass-card cb-link-card"
          onClick={() => onOpen(appWithType)}
          style={{
            position: 'relative',
            height: '100%',
            cursor: 'pointer',
            padding: isMini ? '8px 10px' : '12px 14px',
            display: 'flex',
            flexDirection: isMini ? 'row' : 'column',
            alignItems: isMini ? 'center' : 'flex-start',
            justifyContent: isMini ? 'flex-start' : 'space-between',
            gap: isMini ? 8 : 10
          }}
        >
          {deleteBtn}
          <div
            style={{
              display: 'flex',
              flexDirection: isMini ? 'row' : 'column',
              alignItems: isMini ? 'center' : 'flex-start',
              gap: isMini ? 8 : 10,
              width: '100%',
              minWidth: 0
            }}
          >
            {iconNode}
            <Text
              strong
              style={{
                flex: 1,
                minWidth: 0,
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
                wordBreak: 'break-word',
                lineHeight: isMini ? '16px' : '20px',
                fontSize: isMini ? 12 : 14
              }}
            >
              {manifest.name}
            </Text>
          </div>
          {!isMini && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', color: token.colorPrimary, fontSize: 13, fontWeight: 500 }}>
              <ExportOutlined /> {t('workbench.open')}
            </div>
          )}
        </div>
      </Tooltip>
    </div>
  );
};

// ---- Main Page ----

const InstalledAppsPage: React.FC = () => {
  const navigate = useNavigate();
  const { token } = theme.useToken();
  const { modal, message } = App.useApp();
  const [apps, setApps] = useState<AppWithType[]>(() => cachedClassifiedApps);
  // Initial load spinner only when there is nothing cached to paint.
  const [loading, setLoading] = useState(() => cachedClassifiedApps.length === 0);
  // Server-side set of published app names (mirror of the marketplace). Used
  // to authoritatively decide whether a locally-favorited app has been
  // published — same source of truth as 我的 page. Empty in local mode.
  const [publishedAppNames, setPublishedAppNames] = useState<Set<string>>(new Set());
  /** Marketplace apps by applicationId / name — remote version + applicationId (id first, then name). */
  const [marketById, setMarketById] = useState<Map<string, Application>>(new Map());
  const [marketByName, setMarketByName] = useState<Map<string, Application>>(new Map());
  /** Builtin server (or bundled) version keyed by full app id. */
  const [builtinRemoteVersion, setBuiltinRemoteVersion] = useState<Map<string, string>>(new Map());
  /** appKeys whose server has an admin-published archive (update pulls server bytes). */
  const [builtinHasArchive, setBuiltinHasArchive] = useState<Set<string>>(new Set());
  /** Builtins pinned by an admin (server common_apps.pinned); empty in local mode. */
  const [adminPinnedIds, setAdminPinnedIds] = useState<Set<string>>(new Set());
  /**
   * Effectively-enabled builtin appKeys (project-scoped, or global without a
   * project). null = unknown (local mode / offline / fetch failed) → never hide.
   */
  const [enabledBuiltinKeys, setEnabledBuiltinKeys] = useState<Set<string> | null>(null);
  /** Digits 1–9 the main process actually bound as global shortcuts. */
  const [registeredShortcutDigits, setRegisteredShortcutDigits] = useState<Set<number>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerManifest, setDrawerManifest] = useState<SubAppManifest | null>(null);
  const [drawerAppId, setDrawerAppId] = useState<string>('');
  const [drawerInitialValues, setDrawerInitialValues] = useState<Record<string, unknown>>({});
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // View mode (平铺 / tab 页签), persisted across sessions.
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    localStorage.getItem(VIEW_MODE_STORAGE_KEY) === 'tabbed' ? 'tabbed' : 'tiled'
  );
  const [activeTab, setActiveTab] = useState<string>('app');

  const handleViewModeChange = (value: ViewMode) => {
    setViewMode(value);
    localStorage.setItem(VIEW_MODE_STORAGE_KEY, value);
  };

  const isLocalMode = useAuthStore((state) => state.isLocalMode);
  const t = useT();

  const fetchApps = useSubAppStore((state) => state.fetchApps);
  const appInfos = useSubAppStore((state) => state.appInfos);
  const updateMap = useSubAppStore((state) => state.updateMap);
  const checkForUpdates = useSubAppStore((state) => state.checkForUpdates);
  const user = useAuthStore((state) => state.user);
  const appShortcutEnabled = useSettingsStore((state) => state.appShortcutEnabled);
  const appShortcutModifier = useSettingsStore((state) => state.appShortcutModifier);
  const appOrder = useSettingsStore((state) => state.appOrder);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const fetchSettings = useSettingsStore((state) => state.fetchSettings);
  const pinnedApps = useSettingsStore((state) => state.pinnedApps);
  const togglePinnedApp = useSettingsStore((state) => state.togglePinnedApp);
  const activeProjectId = useSettingsStore((state) => state.activeProject?.projectId ?? null);
  const fetchNav = useProjectNavStore((s) => s.fetchNav);

  // Workspace skills for the AI Skills tab
  const projectSkills = useSkillStore((s) => s.projectSkills)
  const fetchProjectSkills = useSkillStore((s) => s.fetchProjectSkills)
  const activeWorkspace = useWorkspaceStore((s) => s.activeWorkspace)
  const [workspaceSkills, setWorkspaceSkills] = useState<ScannedSkill[]>([])

  // App scheduling (定时执行) — one schedule per app, keyed by appId
  const schedules = useAppScheduleStore((s) => s.schedules)
  const fetchSchedules = useAppScheduleStore((s) => s.fetchSchedules)
  const scheduleByApp = useMemo(() => {
    const m = new Map<string, { enabled: boolean; nextRunAt?: number }>();
    for (const s of schedules) m.set(s.appId, { enabled: s.enabled, nextRunAt: s.nextRunAt });
    return m;
  }, [schedules]);

  // PointerSensor with activation constraint — requires 200ms hold or 5px move
  // so normal clicks on buttons still work
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 200, tolerance: 5 }
    })
  );

  const loadApps = useCallback(async () => {
    try {
      await fetchApps();
    } catch (error) {
      console.error('Failed to load apps:', error);
    }
  }, [fetchApps]);

  const refreshRegisteredShortcuts = useCallback(async () => {
    try {
      const digits = await window.api.settings.getRegisteredShortcuts();
      setRegisteredShortcutDigits(new Set(digits));
    } catch {
      setRegisteredShortcutDigits(new Set());
    }
  }, []);

  /**
   * Builtin sync: admin pins → pinnedApps, server/bundled versions, archive
   * availability, and which builtins are enabled for the active project.
   * Global + project lists are fetched in parallel; any failure keeps the
   * local view (builtins are never hidden when enablement is unknown).
   */
  const syncBuiltins = useCallback(async () => {
    if (isLocalMode) {
      setEnabledBuiltinKeys(null);
      // Local mode: no admin pins — every builtin pin is the user's own (toggleable)
      setAdminPinnedIds(new Set());
      return;
    }
    const [globalRes, projectRes] = await Promise.allSettled([
      apiClient.listCommonApps(),
      activeProjectId ? apiClient.listProjectCommonApps(activeProjectId) : Promise.resolve(null)
    ]);

    if (globalRes.status === 'fulfilled') {
      const { commonApps } = globalRes.value;
      // Admin pins are merged with the user's own pins (incl. builtins the user
      // pinned); only pins that came from a since-withdrawn admin pin are dropped.
      const serverPinned = commonApps
        .filter((a) => a.pinned)
        .map((a) => `${BUILTIN_APP_ID_PREFIX}${a.appKey}`);
      setAdminPinnedIds(new Set(serverPinned));
      const current = useSettingsStore.getState().pinnedApps;
      const next = mergeAdminPins(current, serverPinned, readLastAdminPins());
      writeLastAdminPins(serverPinned);
      const changed = next.length !== current.length || next.some((id, i) => id !== current[i]);
      if (changed) {
        await updateSetting('pinnedApps', next);
      }

      const versions = new Map<string, string>();
      const archiveKeys = new Set<string>();
      await Promise.all(
        commonApps.map(async (ca) => {
          const id = `${BUILTIN_APP_ID_PREFIX}${ca.appKey}`;
          if (ca.version) {
            versions.set(id, ca.version);
          } else {
            try {
              const bundled = await window.api.subapp.getBundledBuiltinVersion(id);
              if (bundled) versions.set(id, bundled);
            } catch {
              /* ignore */
            }
          }
          if (ca.hasArchive) archiveKeys.add(ca.appKey);
        })
      );
      setBuiltinRemoteVersion(versions);
      setBuiltinHasArchive(archiveKeys);
    }

    if (activeProjectId) {
      setEnabledBuiltinKeys(
        projectRes.status === 'fulfilled' && projectRes.value
          ? new Set(projectRes.value.commonApps.map((a) => a.appKey))
          : null
      );
    } else {
      setEnabledBuiltinKeys(
        globalRes.status === 'fulfilled'
          ? new Set(globalRes.value.commonApps.filter((a) => a.enabled !== false).map((a) => a.appKey))
          : null
      );
    }
  }, [isLocalMode, activeProjectId, updateSetting]);

  /** Marketplace snapshot: published names + id/name maps for version matching. */
  const syncMarketApps = useCallback(async () => {
    try {
      const published = await applicationManager.fetchApplications(true);
      const publishedNames = new Set(published.map((a) => a.name));
      setPublishedAppNames(publishedNames);
      setMarketById(new Map(published.map((a) => [a.applicationId, a])));
      setMarketByName(new Map(published.map((a) => [a.name, a])));
      // 治愈：以服务端为准回写本地 manifest 的 published，修复旧版未回写的脏数据。
      const healed = await applicationManager.reconcilePublishedFlags(
        useSubAppStore.getState().appInfos,
        publishedNames
      );
      if (healed > 0) {
        await loadApps(); // 重新扫描磁盘，使治愈后的标记在 UI 反映
      }
    } catch {
      // 非关键路径：网络异常时回退到 manifest.published
    }
  }, [loadApps]);

  const syncRemoteData = useCallback(async () => {
    if (isLocalMode) return;
    await Promise.allSettled([
      checkForUpdates(),
      syncMarketApps(),
      syncBuiltins()
    ]);
  }, [isLocalMode, checkForUpdates, syncMarketApps, syncBuiltins]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      // Phase 1: local data (apps on disk, settings, bound shortcuts) → paint.
      try {
        await Promise.all([loadApps(), fetchSettings(), refreshRegisteredShortcuts()]);
        if (cancelled) return;
        fetchSchedules();
      } catch (err) {
        console.error('Failed to load local workbench data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
      // Phase 2: remote state in the background (market, builtins, pins).
      if (!cancelled) void syncRemoteData();
    };
    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Project switch: refresh nav bookmarks and project-scoped builtin enablement.
  const isFirstProjectEffect = React.useRef(true);
  useEffect(() => {
    void fetchNav();
    if (isFirstProjectEffect.current) {
      // Initial builtin sync already runs in phase 2 of init.
      isFirstProjectEffect.current = false;
      return;
    }
    void syncBuiltins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, fetchNav]);

  // Re-query which digits actually bound after shortcut settings change.
  useEffect(() => {
    void refreshRegisteredShortcuts();
  }, [appShortcutEnabled, appShortcutModifier, refreshRegisteredShortcuts]);

  const handleRefresh = useCallback(async () => {
    setLoading(true);
    try {
      await loadApps();
      await syncRemoteData();
    } finally {
      setLoading(false);
    }
  }, [loadApps, syncRemoteData]);

  // Refresh schedule badges when a scheduled app run fires (success or failure)
  useEffect(() => {
    const unsubscribe = window.api.appSchedule.onExecuted(() => {
      fetchSchedules();
    });
    return unsubscribe;
  }, [fetchSchedules]);

  // Load workspace skills for the AI Skills tab
  useEffect(() => {
    if (activeWorkspace?.path) {
      fetchProjectSkills(activeWorkspace.path)
    }
  }, [activeWorkspace?.path, fetchProjectSkills])

  // Sync workspace skills from store
  useEffect(() => {
    setWorkspaceSkills(projectSkills)
  }, [projectSkills])

  // 监听数据变化，分类应用
  useEffect(() => {
    classifyApps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    appInfos,
    user,
    appOrder,
    publishedAppNames,
    pinnedApps,
    updateMap,
    marketById,
    marketByName,
    builtinRemoteVersion,
    enabledBuiltinKeys
  ]);

  /**
   * 分类应用并排序（置顶在前，区内按 appOrder），再按类型分组。
   *
   * 发布状态以服务端为准（见 resolveAppPublished）。作者判定用
   * isAuthoredByCurrentUser。远端版本：内置 → common_apps / 自带版本；其他 →
   * 市场应用（先按 manifest.id 再按名称匹配），兜底 checkForUpdates 结果。
   * 被当前项目禁用的内置应用隐藏（启用态未知时不隐藏）。
   */
  const classifyApps = () => {
    const classified: AppWithType[] = appInfos
      .filter(info => info.source === 'user')
      .filter((info) => {
        if (!isBuiltinAppId(info.id) || enabledBuiltinKeys === null) return true;
        return enabledBuiltinKeys.has(builtinAppKeyFromId(info.id));
      })
      .map(info => {
        const manifest = info.manifest;
        const builtin = isBuiltinAppId(info.id);
        const isPublished = resolveAppPublished(manifest, publishedAppNames);
        const isOwn = !builtin && isAuthoredByCurrentUser(manifest.author, user);
        const origin: AppOrigin = builtin ? 'builtin' : isOwn ? 'own' : 'installed';

        let appType: AppType = 'local';
        if (isPublished) {
          appType = 'published';
        } else if (isOwn) {
          appType = 'draft';
        }

        let remoteVersion: string | undefined;
        let applicationId: string | undefined;
        if (builtin) {
          remoteVersion = builtinRemoteVersion.get(info.id);
        } else {
          const market = marketById.get(info.id) || marketByName.get(manifest.name);
          if (market) {
            remoteVersion = market.version;
            applicationId = market.applicationId;
          }
          if (!remoteVersion) {
            const upd = updateMap[info.id];
            if (upd?.latestVersion) {
              remoteVersion = upd.latestVersion;
              applicationId = applicationId ?? upd.applicationId;
            }
          }
        }

        const status = resolveLocalAppStatus({
          origin,
          isPublished,
          localVersion: manifest.version,
          remoteVersion
        });

        return { ...info, appType, status, remoteVersion, origin, applicationId };
      });

    // Sort: pinned apps first (within their type group — grouping happens
    // after), then by persisted drag order; unknown apps go to the end.
    const pinnedSet = new Set(pinnedApps);
    const orderMap = new Map(appOrder.map((id, i) => [id, i]));
    classified.sort((a, b) => {
      const pa = pinnedSet.has(a.id) ? 0 : 1;
      const pb = pinnedSet.has(b.id) ? 0 : 1;
      if (pa !== pb) return pa - pb;
      const ia = orderMap.get(a.id) ?? Infinity;
      const ib = orderMap.get(b.id) ?? Infinity;
      return ia - ib;
    });

    cachedClassifiedApps = classified;
    setApps(classified);
  };

  /** 按 manifest.type 分成三组，顺序：app → ai-skill → prompt */
  const groupedApps = useMemo(() => {
    const groups: { key: string; label: string; items: AppWithType[] }[] = [
      { key: 'app', label: t('workbench.groupApp'), items: [] },
      { key: 'ai-skill', label: t('workbench.groupSkill'), items: [] },
      { key: 'prompt', label: t('workbench.groupPrompt'), items: [] },
      { key: 'link', label: t('workbench.groupLink'), items: [] }
    ];
    const groupMap = new Map(groups.map(g => [g.key, g]));
    for (const app of apps) {
      const type = app.manifest.type || 'app';
      const group = groupMap.get(type);
      if (group) {
        group.items.push(app);
      } else {
        groupMap.get('app')!.items.push(app);
      }
    }
    // Always include the ai-skill group (it shows workspace skills even when
    // there are no installed/bookmarked ai-skill items).
    return groups.filter(g => g.items.length > 0 || g.key === 'ai-skill');
  }, [apps, t]);

  // Keep the tabbed-view active key pointing at an existing group.
  // Skip the fallback when the only group is the always-included empty
  // ai-skill placeholder — data hasn't loaded yet, so don't switch tabs.
  useEffect(() => {
    if (groupedApps.length === 0) return;
    const hasRealGroups = groupedApps.some(g => g.items.length > 0);
    if (!hasRealGroups) return;
    if (!groupedApps.some((g) => g.key === activeTab)) {
      setActiveTab(groupedApps[0].key);
    }
  }, [groupedApps, activeTab]);

  const handleUninstall = useCallback((appId: string, appName: string) => {
    modal.confirm({
      title: t('workbench.confirmDelete'),
      content: t('workbench.confirmDeleteContent', appName),
      okText: t('workbench.confirm'),
      okType: 'danger',
      cancelText: t('workbench.cancel'),
      onOk: async () => {
        try {
          const result = await window.api.subapp.uninstall(appId);
          if (result && result.success === false) throw new Error(result.error || 'uninstall failed');
          // Remember deleted builtins so startup seeding doesn't bring them back
          if (isBuiltinAppId(appId)) await window.api.subapp.markBuiltinRemoved(appId);
          message.success(t('workbench.deleteSuccess'));
          await loadApps();
        } catch (error) {
          console.error('Failed to delete app:', error);
          message.error(t('workbench.deleteFailed'));
        }
      }
    });
  }, [modal, message, t, loadApps]);

  /**
   * 更新到最新版本（非破坏性合并：保留本地生成的文件）。
   * 内置应用：服务端有管理员发布的归档则拉取服务端版本，否则重装自带版本。
   * 其他应用：按匹配到的市场 applicationId（兜底 manifest.id）更新。
   */
  const handleUpdate = useCallback((app: AppWithType) => {
    const appName = app.manifest.name;
    modal.confirm({
      title: t('workbench.updateConfirmTitle'),
      content: t('workbench.updateConfirmContent', appName),
      okText: t('workbench.update'),
      cancelText: t('workbench.cancel'),
      onOk: async () => {
        const hide = message.loading(t('workbench.updating', appName), 0);
        try {
          if (app.origin === 'builtin') {
            if (builtinHasArchive.has(builtinAppKeyFromId(app.id))) {
              await applicationManager.updateBuiltinApp(app.id);
            } else {
              const result = await window.api.subapp.resetBuiltin(app.id);
              if (!result.success) throw new Error(result.error || t('workbench.updateFailed'));
            }
          } else {
            await applicationManager.updateInstalledApp(app.applicationId ?? app.id);
          }
          hide();
          message.success(t('workbench.updateSuccess', appName));
          await loadApps();
          // 更新完成后重新检查一次，刷新更新标记
          checkForUpdates().catch(() => { /* 非关键 */ });
        } catch (error) {
          hide();
          console.error('Failed to update app:', error);
          const reason = error instanceof Error ? error.message : String(error);
          message.error(reason ? t('workbench.updateFailedReason', reason) : t('workbench.updateFailed'));
        }
      }
    });
  }, [modal, message, t, builtinHasArchive, loadApps, checkForUpdates]);

  /**
   * 重置：本地版本高于基线时，完整替换为自带版本（内置）或线上版本（市场安装），丢弃本地改动。
   */
  const handleReset = useCallback((app: AppWithType) => {
    const appName = app.manifest.name;
    const isBuiltin = app.origin === 'builtin';
    modal.confirm({
      title: t('appStatus.resetConfirmTitle'),
      content: isBuiltin
        ? t('appStatus.resetBuiltinConfirm', appName)
        : t('appStatus.resetOnlineConfirm', appName),
      okText: t('appStatus.reset'),
      okType: 'danger',
      cancelText: t('workbench.cancel'),
      onOk: async () => {
        const hide = message.loading(t('workbench.updating', appName), 0);
        try {
          if (isBuiltin) {
            const result = await window.api.subapp.resetBuiltin(app.id);
            if (!result.success) throw new Error(result.error || t('appStatus.resetFailed'));
          } else {
            await applicationManager.resetInstalledApp(app.applicationId ?? app.id);
          }
          hide();
          message.success(t('appStatus.resetSuccess', appName));
          await loadApps();
        } catch (error) {
          hide();
          console.error('Failed to reset app:', error);
          message.error(t('appStatus.resetFailed'));
        }
      }
    });
  }, [modal, message, t, loadApps]);

  const handleRun = useCallback(async (appId: string, appName: string, manifest: SubAppManifest) => {
    const params = manifest.params || [];
    const hasRequiredParams = params.some((p) => p.required);
    if (hasRequiredParams || manifest.confirm_before_run) {
      setDrawerAppId(appId);
      setDrawerManifest(manifest);
      setDrawerInitialValues(buildInitialAppParams(appId, params));
      setDrawerOpen(true);
      return;
    }
    await executeApp(appId, appName, buildInitialAppParams(appId, params));
  }, []);

  /** Always open the detail sidebar for the given app. */
  const handleShowDetail = useCallback((appId: string, manifest: SubAppManifest) => {
    setDrawerAppId(appId);
    setDrawerManifest(manifest);
    setDrawerInitialValues(buildInitialAppParams(appId, manifest.params || []));
    setDrawerOpen(true);
  }, []);

  const handleDrawerSubmit = async (params: Record<string, unknown>) => {
    setDrawerOpen(false);
    if (drawerAppId && drawerManifest) {
      saveAppParams(drawerAppId, params);
      await executeApp(drawerAppId, drawerManifest.name, params);
    }
  };

  const executeApp = async (appId: string, appName: string, params: Record<string, unknown>) => {
    try {
      // Sub-apps run against the active workspace — its path/vcs is passed to
      // the Python SDK. A fresh install has no workspace yet, so fail-fast here
      // with an actionable hint instead of letting the main process throw an
      // opaque "No active workspace selected" error the user never sees.
      const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
      if (!activeWorkspace) {
        message.warning(t('workbench.selectWorkspaceFirst'));
        return;
      }

      const result = seedTaskFromExecuteResult(
        await window.api.subapp.execute(appId, params),
        appId,
        appName
      );
      if (result.earlyTerminal) {
        message.error(describeEarlyTerminal(result.earlyTerminal, t));
        return;
      }
      message.success(t('workbench.appStarted', appName));
    } catch (error) {
      console.error('Failed to run app:', error);
      // Surface the real reason (e.g. "Sub-app not found") so a launch failure
      // is never a silent generic toast with nothing in the output panel.
      const reason = error instanceof Error ? error.message : String(error);
      message.error(reason ? t('workbench.runFailedReason', reason) : t('workbench.runFailed'));
    }
  };

  const getManifestTypeTag = useCallback((type?: string) => {
    switch (type) {
      case 'ai-skill':
        return <Tag color="purple" style={{ margin: 0 }}>{t('workbench.tagSkill')}</Tag>;
      case 'prompt':
        return <Tag color="cyan" style={{ margin: 0 }}>{t('workbench.tagPrompt')}</Tag>;
      case 'link':
        return <Tag color="geekblue" style={{ margin: 0 }}>{t('workbench.tagLink')}</Tag>;
      default:
        return null;
    }
  }, []);

  const handleActivateSkill = useCallback(async (appId: string, appName: string) => {
    try {
      const activeWorkspace = useWorkspaceStore.getState().activeWorkspace;
      if (!activeWorkspace) {
        message.warning(t('workbench.selectWorkspaceFirst'));
        return;
      }

      const result = await window.api.skill.detectWorkspaceType(activeWorkspace.path);
      if (!result.success || !result.types || result.types.length === 0) {
        message.warning(t('workbench.noAIToolDetected'));
        return;
      }

      await window.api.skill.activate(appId, activeWorkspace.path);
      const toolName = result.types[0] === 'claude' ? 'Claude Code' : result.types[0] === 'codex' ? 'Codex' : 'Gemini';
      message.success(t('workbench.skillActivated', appName, toolName));
    } catch (error) {
      console.error('Failed to activate skill:', error);
      message.error(t('workbench.skillActivateFailed'));
    }
  }, [message]);

  const handleViewDetail = useCallback((appId: string) => {
    navigate(`/workbench/skill-detail/${appId}`);
  }, [navigate]);

  /** Navigate to skill detail view for a workspace skill (by path). */
  const handleOpenWorkspaceSkill = useCallback((skillPath: string) => {
    // Use a dummy appId with the path as query param
    navigate(`/workbench/skill-detail/_ws?path=${encodeURIComponent(skillPath)}`);
  }, [navigate]);

  /** Render a card for a workspace (project/global) skill. */
  const renderWorkspaceSkillCard = (skill: ScannedSkill) => {
    return (
      <div key={skill.path} className="cb-glass-card">
        <div style={{ padding: '12px 16px', minHeight: 72, flex: 1 }}>
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 8,
            minHeight: 44
          }}>
            <Tooltip title={skill.displayName || skill.name}>
              <Text
                strong
                style={{
                  flex: 1,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                  wordBreak: 'break-word',
                  lineHeight: '22px',
                  minHeight: 44
                }}
              >
                {skill.displayName || skill.name}
              </Text>
            </Tooltip>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag style={{ margin: 0 }}>v{skill.version}</Tag>
            <Tag color="purple" style={{ margin: 0 }}>{t('workbench.tagSkill')}</Tag>
            <Tag color={skill.scope === 'global' ? 'blue' : 'green'} style={{ margin: 0 }}>
              {skill.scope === 'global' ? t('skill.badge.global') : t('skill.badge.project')}
            </Tag>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            borderTop: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          <div
            onClick={() => handleOpenWorkspaceSkill(skill.path)}
            style={{
              flex: 1,
              padding: '8px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              color: token.colorPrimary,
              fontWeight: 500,
              fontSize: 13
            }}
          >
            <FileTextOutlined /> {t('skillDetail.detail')}
          </div>
        </div>
      </div>
    );
  };

  const handleCopyPrompt = useCallback(async (appId: string) => {
    try {
      const appPath = await window.api.developer.getAppPath(appId);
      const content = await window.api.developer.readFile(`${appPath}/prompt.md`);
      await navigator.clipboard.writeText(content);
      message.success(t('workbench.promptCopied'));
    } catch (error) {
      console.error('Failed to copy prompt:', error);
      message.error(t('workbench.copyFailed'));
    }
  }, [message]);

  const handleTryPrompt = useCallback(async (appId: string) => {
    try {
      const appPath = await window.api.developer.getAppPath(appId);
      const content = await window.api.developer.readFile(`${appPath}/prompt.md`);
      const store = useChatStore.getState();
      store.clearActiveConversation();
      store.setPrefillInput(content);
      navigate('/ai-chat');
    } catch (error) {
      console.error('Failed to try prompt:', error);
      message.error(t('workbench.openFailed'));
    }
  }, [message, navigate]);

  // Human-readable modifier prefix for shortcut badge (e.g. "Ctrl + ⇧ + ")
  const modifierLabel = useMemo(() => formatModifier(appShortcutModifier), [appShortcutModifier]);

  const handleOpenLink = useCallback(async (app: AppWithType) => {
    const { id, manifest } = app;
    const url = manifest.url;
    if (!url) {
      message.error(t('workbench.openFailed'));
      return;
    }
    openExternalLink(url);
    // Auto-fetch favicon on first open when no icon is configured, then persist.
    if (!manifest.icon) {
      try {
        const icon = await window.api.link.fetchFavicon(url);
        if (icon) {
          await window.api.developer.updateApp(id, { ...manifest, icon });
          await loadApps();
        }
      } catch (error) {
        console.error('Failed to fetch favicon:', error);
      }
    }
  }, [message, t, loadApps]);

  const pinnedSet = useMemo(() => new Set(pinnedApps), [pinnedApps]);

  /**
   * Drag sort only within the same type group AND the same pinned / unpinned
   * section; the persisted appOrder keeps every other item in place.
   */
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeApp = apps.find((a) => a.id === active.id);
    const overApp = apps.find((a) => a.id === over.id);
    if (!activeApp || !overApp) return;
    const sectionKey = (a: AppWithType) =>
      `${a.manifest.type || 'app'}:${pinnedSet.has(a.id) ? 'pinned' : 'rest'}`;
    if (sectionKey(activeApp) !== sectionKey(overApp)) return;

    const key = sectionKey(activeApp);
    const section = apps.filter((a) => sectionKey(a) === key);
    const oldIndex = section.findIndex((a) => a.id === active.id);
    const newIndex = section.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const [moved] = section.splice(oldIndex, 1);
    section.splice(newIndex, 0, moved);

    let cursor = 0;
    const reordered = apps.map((a) => (sectionKey(a) === key ? section[cursor++] : a));

    cachedClassifiedApps = reordered;
    setApps(reordered);
    updateSetting('appOrder', reordered.map((a) => a.id));
  }, [apps, pinnedSet, updateSetting]);

  const hasApps = apps.length > 0;

  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))',
    gap: 12
  };

  /**
   * Card for an app/skill/prompt. `shortcutIndex` is the position in the app
   * group (pinned first, matching the main-process shortcut order); the hint
   * is shown only when that digit actually bound.
   */
  const renderAppCard = (app: AppWithType, index: number, shortcutIndex: number) => {
    const digit = shortcutIndex + 1;
    const shortcutLabel =
      shortcutIndex >= 0 && digit <= 9 && appShortcutEnabled && registeredShortcutDigits.has(digit)
        ? `${modifierLabel} + ${digit}`
        : null;
    const sched = scheduleByApp.get(app.id);
    return (
      <SortableAppCard
        key={app.id}
        appWithType={app}
        index={index}
        shortcutLabel={shortcutLabel}
        token={token}
        t={t}
        getManifestTypeTag={getManifestTypeTag}
        onRun={handleRun}
        onUninstall={handleUninstall}
        onActivateSkill={handleActivateSkill}
        onCopyPrompt={handleCopyPrompt}
        onTryPrompt={handleTryPrompt}
        onViewDetail={handleViewDetail}
        onShowDetail={handleShowDetail}
        onUpdate={handleUpdate}
        onReset={handleReset}
        scheduleEnabled={!!sched?.enabled}
        scheduleNextRunAt={sched?.nextRunAt}
        pinned={pinnedSet.has(app.id)}
        onTogglePin={togglePinnedApp}
        adminPinned={app.origin === 'builtin' && adminPinnedIds.has(app.id)}
      />
    );
  };

  /** Renders the sortable card grid(s) for a single category group (no header). */
  const renderGroupGrid = (group: { key: string; items: AppWithType[] }) => {
    if (group.key === 'link') {
      return (
        <SortableContext items={group.items.map((a) => a.id)} strategy={rectSortingStrategy}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(102px, 1fr))',
              gridAutoRows: '60px',
              gridAutoFlow: 'dense',
              gap: 16
            }}
          >
            {group.items.map((app) => (
              <SortableLinkCard
                key={app.id}
                appWithType={app}
                token={token}
                t={t}
                onOpen={handleOpenLink}
                onUninstall={handleUninstall}
              />
            ))}
          </div>
        </SortableContext>
      );
    }

    // Pinned and unpinned sections sort independently.
    const pinnedItems = group.items.filter((a) => pinnedSet.has(a.id));
    const restItems = group.items.filter((a) => !pinnedSet.has(a.id));
    // 快捷键只对 app 组生效（顺序：置顶区在前）
    const shortcutIndexOf = (i: number) => (group.key === 'app' ? i : -1);
    return (
      <>
        {pinnedItems.length > 0 && (
          <SortableContext items={pinnedItems.map((a) => a.id)} strategy={rectSortingStrategy}>
            <div style={gridStyle}>
              {pinnedItems.map((app, i) => renderAppCard(app, i, shortcutIndexOf(i)))}
            </div>
          </SortableContext>
        )}
        {pinnedItems.length > 0 && restItems.length > 0 && (
          <Divider style={{ margin: '16px 0' }}>
            <span style={{ color: token.colorTextTertiary, fontSize: 12 }}>
              <MoreOutlined />
            </span>
          </Divider>
        )}
        {restItems.length > 0 && (
          <SortableContext items={restItems.map((a) => a.id)} strategy={rectSortingStrategy}>
            <div style={gridStyle}>
              {restItems.map((app, i) =>
                renderAppCard(app, pinnedItems.length + i, shortcutIndexOf(pinnedItems.length + i))
              )}
            </div>
          </SortableContext>
        )}
      </>
    );
  };

  return (
    <div style={{ padding: 24 }}>
      {/* 项目导航栏（后端配置；本地模式 / 无配置时不渲染） */}
      <NavBookmarkBar />

      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>{t('workbench.title')}</Title>
        <div style={{ display: 'flex', gap: 8 }}>
          <Segmented
            value={viewMode}
            onChange={(v) => handleViewModeChange(v as ViewMode)}
            options={[
              { value: 'tiled', icon: <Tooltip title={t('workbench.viewTiled')}><AppstoreOutlined /></Tooltip> },
              { value: 'tabbed', icon: <Tooltip title={t('workbench.viewTabbed')}><ProfileOutlined /></Tooltip> }
            ]}
          />
          {!isLocalMode && (
            <Button icon={<CompassOutlined />} onClick={() => navigate('/workbench/library', { state: { from: '/workbench/installed' } })}>
              {t('workbench.discover')}
            </Button>
          )}
          <Space.Compact>
            <Button icon={<SnippetsOutlined />} onClick={() => navigate('/workbench/my-contributions', { state: { from: '/workbench/installed' } })}>
              {t('workbench.mine')}
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
              {t('workbench.create')}
            </Button>
          </Space.Compact>
          <Button icon={<SyncOutlined />} onClick={handleRefresh} loading={loading}>
            {t('workbench.refresh')}
          </Button>
        </div>
      </div>

      {loading && !hasApps ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: 360
          }}
        >
          <Spin size="large" />
          <Text type="secondary" style={{ marginTop: 16 }}>
            {t('workbench.loading')}
          </Text>
        </div>
      ) : !hasApps && workspaceSkills.length === 0 ? (
        <Empty description={t('workbench.noFavorites')} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {viewMode === 'tabbed' ? (
            <Tabs
              activeKey={groupedApps.some((g) => g.key === activeTab) ? activeTab : groupedApps[0]?.key}
              onChange={setActiveTab}
              items={groupedApps.map((group) => ({
                key: group.key,
                label: group.label,
                children: group.key === 'ai-skill' ? (
                  <div>
                    {group.items.length > 0 && renderGroupGrid(group)}
                    {workspaceSkills.length > 0 && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 16,
                        marginTop: group.items.length > 0 ? 24 : 0
                      }}>
                        {workspaceSkills.map(renderWorkspaceSkillCard)}
                      </div>
                    )}
                    {group.items.length === 0 && workspaceSkills.length === 0 && (
                      <Empty description={t('skill.empty')} />
                    )}
                  </div>
                ) : (
                  renderGroupGrid(group)
                )
              }))}
            />
          ) : (
            groupedApps.map((group) => (
              <div key={group.key} style={{ marginBottom: 24 }}>
                <Text
                  type="secondary"
                  style={{
                    display: 'block',
                    marginBottom: 12,
                    fontSize: 13,
                    fontWeight: 500
                  }}
                >
                  {group.label}
                </Text>
                {group.key === 'ai-skill' ? (
                  <div>
                    {group.items.length > 0 && renderGroupGrid(group)}
                    {workspaceSkills.length > 0 && (
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 16,
                        marginTop: group.items.length > 0 ? 24 : 0
                      }}>
                        {workspaceSkills.map(renderWorkspaceSkillCard)}
                      </div>
                    )}
                    {group.items.length === 0 && workspaceSkills.length === 0 && (
                      <Empty description={t('skill.empty')} />
                    )}
                  </div>
                ) : (
                  renderGroupGrid(group)
                )}
              </div>
            ))
          )}
        </DndContext>
      )}

      <ParamDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        manifest={drawerManifest}
        initialValues={drawerInitialValues}
        resolveSlot={window.api.subapp.resolveSlot}
        onSubmit={handleDrawerSubmit}
      />

      <CreateTypeModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
      />
    </div>
  );
};

export default InstalledAppsPage;
