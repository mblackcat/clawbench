/**
 * 收藏栏页面（原已装应用）—— Workbench 模块（canonical: `workbench` / 路由 `/workbench/installed`）
 * Workbench 子概念：sub apps & ai skills & prompts & links（资源中心）。
 * 注意：本模块旧名/旧路由为 "Apps"(`/apps`)，与 AI Coding(`/ai-coding`) 无关。
 * 统一显示所有本地收藏内容（app/skill/prompt）
 * 支持长按拖拽排序
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Typography, Empty, Button, Tag, Tooltip, theme, App, Space, Segmented, Tabs } from 'antd';
import {
  SyncOutlined,
  PlayCircleOutlined,
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
  CloudDownloadOutlined
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
import { useSubAppStore } from '../../stores/useSubAppStore';
import { useAuthStore } from '../../stores/useAuthStore';
import { useTaskStore } from '../../stores/useTaskStore';
import { useSettingsStore } from '../../stores/useSettingsStore';
import { useWorkspaceStore } from '../../stores/useWorkspaceStore';
import { useChatStore } from '../../stores/useChatStore';
import { useSkillStore } from '../../stores/useSkillStore';
import { useAppScheduleStore } from '../../stores/useAppScheduleStore';
import type { ScannedSkill } from '../../types/skill';
import dayjs from 'dayjs';
import ParamDrawer from '../../components/ParamDrawer';
import CreateTypeModal from '../../components/CreateTypeModal';
import { openExternalLink } from '../../utils/markdown-links';
import { buildInitialAppParams, saveAppParams } from '../../utils/subapp-params';
import { useT } from '../../i18n';
import { applicationManager } from '../../services/applicationManager';

const { Title, Text } = Typography;

type ViewMode = 'tiled' | 'tabbed';
const VIEW_MODE_STORAGE_KEY = 'workbench.viewMode';

interface SubAppInfo {
  id: string
  manifest: SubAppManifest
  path: string
  source: 'user'
}

type AppType = 'installed' | 'draft' | 'local';

interface AppWithType extends SubAppInfo {
  appType: AppType
}

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
  token: any
  t: (key: string, ...args: string[]) => string
  getAppTypeTag: (appType: AppType) => React.ReactNode
  getManifestTypeTag: (type?: string) => React.ReactNode
  onRun: (id: string, name: string, manifest: SubAppManifest) => void
  onUninstall: (id: string, name: string) => void
  onActivateSkill: (id: string, name: string) => void
  onCopyPrompt: (id: string) => void
  onTryPrompt: (id: string) => void
  onViewDetail: (id: string) => void
  onShowDetail: (id: string, manifest: SubAppManifest) => void
  /** 是否有新版本（市场版本高于本地版本） */
  hasUpdate?: boolean
  /** 市场最新版本号（hasUpdate 为 true 时展示） */
  latestVersion?: string
  /** 点击更新按钮 */
  onUpdate: (id: string, name: string) => void
  /** 该 app 是否已开启定时执行 */
  scheduleEnabled?: boolean
  /** 下次执行时间戳（scheduleEnabled 为 true 时展示） */
  scheduleNextRunAt?: number
}

const SortableAppCard: React.FC<SortableCardProps> = ({
  appWithType,
  index,
  shortcutLabel,
  token,
  t,
  getAppTypeTag,
  getManifestTypeTag,
  onRun,
  onUninstall,
  onActivateSkill,
  onCopyPrompt,
  onTryPrompt,
  onViewDetail,
  onShowDetail,
  hasUpdate,
  latestVersion,
  onUpdate,
  scheduleEnabled,
  scheduleNextRunAt
}) => {
  const { id, manifest, appType } = appWithType;
  const app = manifest;
  const manifestType = app.type || 'app';

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
    position: 'relative'
  };

  return (
    <div ref={setNodeRef} style={style}>
      <div
        className="cb-glass-card"
        style={{ position: 'relative' }}
      >
        {/* Drag handle + shortcut label in top-right */}
        <div
          style={{
            position: 'absolute',
            top: 6,
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 4
          }}
        >
          {shortcutLabel && (
            <Tooltip title={t('workbench.shortcutTooltip', shortcutLabel)}>
              <div
                style={{
                  padding: '1px 6px',
                  borderRadius: 4,
                  background: token.colorFillSecondary,
                  color: token.colorTextSecondary,
                  fontSize: 10,
                  fontWeight: 600,
                  lineHeight: '18px',
                  whiteSpace: 'nowrap',
                  fontFamily: 'system-ui, -apple-system, sans-serif'
                }}
              >
                {shortcutLabel}
              </div>
            </Tooltip>
          )}
          <div
            {...attributes}
            {...listeners}
            style={{
              cursor: 'grab',
              color: token.colorTextQuaternary,
              fontSize: 14,
              padding: '2px 0',
              touchAction: 'none'
            }}
          >
            <HolderOutlined />
          </div>
        </div>

        <div
          style={{ padding: '12px 16px', minHeight: 72, flex: 1, cursor: 'pointer' }}
          onClick={(e) => {
            e.stopPropagation()
            onShowDetail(id, manifest)
          }}
        >
          <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            marginBottom: 8,
            minHeight: 44
          }}>
            <Tooltip title={app.name}>
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
                {app.name}
              </Text>
            </Tooltip>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Tag style={{ margin: 0 }}>v{app.version}</Tag>
            {getManifestTypeTag(app.type)}
            {getAppTypeTag(appType)}
            {hasUpdate && (
              <Tag
                color="processing"
                icon={<SyncOutlined spin />}
                style={{
                  margin: 0,
                  fontWeight: 600,
                  animation: 'cb-update-pulse 1.8s ease-in-out infinite'
                }}
              >
                {latestVersion ? t('workbench.updateAvailableVersion', latestVersion) : t('workbench.updateAvailable')}
              </Tag>
            )}
            {manifestType === 'app' && scheduleEnabled && scheduleNextRunAt && (
              <Tooltip title={`${t('appSchedule.nextRun')}: ${dayjs(scheduleNextRunAt).format('YYYY-MM-DD HH:mm')}`}>
                <Tag
                  color="processing"
                  icon={<SyncOutlined spin />}
                  style={{ margin: 0, whiteSpace: 'nowrap' }}
                >
                  {t('appSchedule.nextRunShort')} {dayjs(scheduleNextRunAt).format('MM-DD HH:mm')}
                </Tag>
              </Tooltip>
            )}
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            borderTop: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          {/* 删除按钮 */}
          <div
            onClick={() => onUninstall(id, app.name)}
            style={{
              flex: 1,
              padding: '8px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              cursor: 'pointer',
              color: token.colorError,
              fontWeight: 500,
              fontSize: 13
            }}
          >
            <DeleteOutlined /> {t('workbench.delete')}
          </div>

          <div
            style={{
              width: 1,
              alignSelf: 'stretch',
              background: token.colorBorderSecondary
            }}
          />

          {/* 根据类型显示不同操作 */}
          {manifestType === 'ai-skill' ? (
            <>
              <div
                onClick={() => onViewDetail(id)}
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
              <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorderSecondary }} />
              <div
                onClick={() => onActivateSkill(id, app.name)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  color: token.colorWarning,
                  fontWeight: 500,
                  fontSize: 13
                }}
              >
                <ThunderboltOutlined /> {t('workbench.activateSkill')}
              </div>
            </>
          ) : manifestType === 'prompt' ? (
            <>
              <div
                onClick={() => onCopyPrompt(id)}
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
                <CopyOutlined /> {t('workbench.copy')}
              </div>
              <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorderSecondary }} />
              <div
                onClick={() => onTryPrompt(id)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  color: token.colorSuccess,
                  fontWeight: 500,
                  fontSize: 13
                }}
              >
                <RocketOutlined /> {t('workbench.tryIt')}
              </div>
            </>
          ) : (
            <>
              {/* 更新按钮（仅 app 类型且有新版本时显示，位于 删除 与 运行 之间） */}
              {manifestType === 'app' && hasUpdate && (
                <>
                  <div
                    onClick={() => onUpdate(id, app.name)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      cursor: 'pointer',
                      color: token.colorPrimary,
                      fontWeight: 600,
                      fontSize: 13
                    }}
                  >
                    <CloudDownloadOutlined /> {t('workbench.update')}
                  </div>
                  <div style={{ width: 1, alignSelf: 'stretch', background: token.colorBorderSecondary }} />
                </>
              )}
              <div
                onClick={() => onRun(id, app.name, manifest)}
                style={{
                  flex: 1,
                  padding: '8px 0',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  cursor: 'pointer',
                  color: token.colorSuccess,
                  fontWeight: 500,
                  fontSize: 13
                }}
              >
                <PlayCircleOutlined /> {t('workbench.run')}
              </div>
            </>
          )}
        </div>
      </div>
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
  const [apps, setApps] = useState<AppWithType[]>([]);
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
  const startTask = useTaskStore((state) => state.startTask);
  const setActiveTask = useTaskStore((state) => state.setActiveTask);
  const appShortcutEnabled = useSettingsStore((state) => state.appShortcutEnabled);
  const appShortcutModifier = useSettingsStore((state) => state.appShortcutModifier);
  const appOrder = useSettingsStore((state) => state.appOrder);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const fetchSettings = useSettingsStore((state) => state.fetchSettings);

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

  useEffect(() => {
    const init = async () => {
      await loadApps();
      fetchSettings();
      fetchSchedules();
      // 联网模式下打开收藏栏时检查一次已安装应用的更新（checkForUpdates 内部
      // 读取 store 中最新的 appInfos，因此必须在 loadApps 完成后调用）
      if (!isLocalMode) {
        checkForUpdates().catch(() => { /* 非关键路径 */ });
      }
    };
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // 监听 appInfos 变化，分类应用
  useEffect(() => {
    classifyApps();
  }, [appInfos, user, appOrder]);

  const loadApps = async () => {
    try {
      await fetchApps();
    } catch (error) {
      console.error('Failed to load apps:', error);
    }
  };

  /**
   * 分类应用并按 appOrder 排序，再按类型分组
   */
  const classifyApps = () => {
    const classified: AppWithType[] = appInfos
      .filter(info => info.source === 'user')
      .map(info => {
        const manifest = info.manifest;
        let appType: AppType = 'local';

        if (manifest.published) {
          appType = 'installed';
        } else {
          const authorId = getAuthorId(manifest.author);
          const currentUserId = user?.feishu_id || user?.id;

          if (authorId && currentUserId && authorId === currentUserId) {
            appType = 'draft';
          } else {
            appType = 'local';
          }
        }

        return { ...info, appType };
      });

    // Sort by persisted order; unknown apps go to the end in their original order
    if (appOrder.length > 0) {
      const orderMap = new Map(appOrder.map((id, i) => [id, i]));
      classified.sort((a, b) => {
        const ia = orderMap.get(a.id) ?? Infinity;
        const ib = orderMap.get(b.id) ?? Infinity;
        return ia - ib;
      });
    }

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

  const getAuthorId = (author: string | { name: string; email?: string; feishu_id?: string } | undefined): string | undefined => {
    if (!author) return undefined;
    if (typeof author === 'string') return undefined;
    return author.feishu_id;
  };

  const handleUninstall = useCallback((appId: string, appName: string) => {
    modal.confirm({
      title: t('workbench.confirmDelete'),
      content: t('workbench.confirmDeleteContent', appName),
      okText: t('workbench.confirm'),
      okType: 'danger',
      cancelText: t('workbench.cancel'),
      onOk: async () => {
        try {
          await window.api.subapp.uninstall(appId);
          message.success(t('workbench.deleteSuccess'));
          await loadApps();
        } catch (error) {
          console.error('Failed to delete app:', error);
          message.error(t('workbench.deleteFailed'));
        }
      }
    });
  }, [modal, message]);

  /**
   * 更新已安装应用到市场最新版本（非破坏性合并：保留本地生成的文件）。
   */
  const handleUpdate = useCallback((appId: string, appName: string) => {
    modal.confirm({
      title: t('workbench.updateConfirmTitle'),
      content: t('workbench.updateConfirmContent', appName),
      okText: t('workbench.update'),
      cancelText: t('workbench.cancel'),
      onOk: async () => {
        const hide = message.loading(t('workbench.updating', appName), 0);
        try {
          await applicationManager.updateInstalledApp(appId);
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
  }, [modal, message, checkForUpdates]);

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

      const taskId = await window.api.subapp.execute(appId, params);
      startTask(taskId, appId, appName);
      setActiveTask(taskId);
      message.success(t('workbench.appStarted', appName));
    } catch (error) {
      console.error('Failed to run app:', error);
      // Surface the real reason (e.g. "Sub-app not found") so a launch failure
      // is never a silent generic toast with nothing in the output panel.
      const reason = error instanceof Error ? error.message : String(error);
      message.error(reason ? t('workbench.runFailedReason', reason) : t('workbench.runFailed'));
    }
  };

  const getAppTypeTag = useCallback((appType: AppType) => {
    switch (appType) {
      case 'installed':
        return <Tag color="blue" style={{ margin: 0 }}>{t('workbench.tagFavorited')}</Tag>;
      case 'draft':
        return <Tag color="orange" style={{ margin: 0 }}>{t('workbench.tagDraft')}</Tag>;
      case 'local':
        return <Tag color="default" style={{ margin: 0 }}>{t('workbench.tagLocal')}</Tag>;
    }
  }, []);

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
  }, [message, t]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    // Only allow reorder within the same type group
    const activeApp = apps.find((a) => a.id === active.id);
    const overApp = apps.find((a) => a.id === over.id);
    if (!activeApp || !overApp) return;
    const activeType = activeApp.manifest.type || 'app';
    const overType = overApp.manifest.type || 'app';
    if (activeType !== overType) return;

    const oldIndex = apps.findIndex((a) => a.id === active.id);
    const newIndex = apps.findIndex((a) => a.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...apps];
    const [moved] = reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, moved);

    setApps(reordered);
    // Persist order
    const newOrder = reordered.map((a) => a.id);
    updateSetting('appOrder', newOrder);
  }, [apps, updateSetting]);

  const hasApps = apps.length > 0;

  /** Renders the sortable card grid for a single category group (no header). */
  const renderGroupGrid = (group: { key: string; items: AppWithType[] }) => (
    <SortableContext items={group.items.map((a) => a.id)} strategy={rectSortingStrategy}>
      <div
        style={
          group.key === 'link'
            ? {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(102px, 1fr))',
                gridAutoRows: '60px',
                gridAutoFlow: 'dense',
                gap: 16
              }
            : {
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 16
              }
        }
      >
        {group.items.map((app, index) => {
          if (group.key === 'link') {
            return (
              <SortableLinkCard
                key={app.id}
                appWithType={app}
                token={token}
                t={t}
                onOpen={handleOpenLink}
                onUninstall={handleUninstall}
              />
            );
          }
          // 快捷键只对第一组（app）的前 9 个生效
          const globalIndex = group.key === 'app' ? index : -1;
          const shortcutLabel =
            globalIndex >= 0 && globalIndex < 9 && appShortcutEnabled
              ? `${modifierLabel} + ${globalIndex + 1}`
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
              getAppTypeTag={getAppTypeTag}
              getManifestTypeTag={getManifestTypeTag}
              onRun={handleRun}
              onUninstall={handleUninstall}
              onActivateSkill={handleActivateSkill}
              onCopyPrompt={handleCopyPrompt}
              onTryPrompt={handleTryPrompt}
              onViewDetail={handleViewDetail}
              onShowDetail={handleShowDetail}
              hasUpdate={!!updateMap[app.id]?.hasUpdate}
              latestVersion={updateMap[app.id]?.latestVersion}
              onUpdate={handleUpdate}
              scheduleEnabled={!!sched?.enabled}
              scheduleNextRunAt={sched?.nextRunAt}
            />
          );
        })}
      </div>
    </SortableContext>
  );

  return (
    <div style={{ padding: 24 }}>
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
            <Button icon={<CompassOutlined />} onClick={() => navigate('/workbench/library')}>
              {t('workbench.discover')}
            </Button>
          )}
          <Space.Compact>
            <Button icon={<SnippetsOutlined />} onClick={() => navigate('/workbench/my-contributions')}>
              {t('workbench.mine')}
            </Button>
            <Button icon={<PlusOutlined />} onClick={() => setCreateModalOpen(true)}>
              {t('workbench.create')}
            </Button>
          </Space.Compact>
          <Button icon={<SyncOutlined />} onClick={loadApps}>
            {t('workbench.refresh')}
          </Button>
        </div>
      </div>

      {!hasApps && workspaceSkills.length === 0 ? (
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
