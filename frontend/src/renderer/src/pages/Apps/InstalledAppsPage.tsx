/**
 * 收藏栏页面（原已装应用）
 * 统一显示所有本地收藏内容（app/skill/prompt）
 * 支持长按拖拽排序
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Typography, Empty, Button, Tag, Tooltip, theme, App, Space } from 'antd';
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
  SnippetsOutlined
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
import ParamDrawer from '../../components/ParamDrawer';
import CreateTypeModal from '../../components/CreateTypeModal';
import { useT } from '../../i18n';

const { Title, Text } = Typography;

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
  onTryPrompt
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

        <div style={{ padding: '12px 16px', minHeight: 72, flex: 1 }}>
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
          )}
        </div>
      </div>
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
  const [createModalOpen, setCreateModalOpen] = useState(false);

  const isLocalMode = useAuthStore((state) => state.isLocalMode);
  const t = useT();

  const fetchApps = useSubAppStore((state) => state.fetchApps);
  const appInfos = useSubAppStore((state) => state.appInfos);
  const user = useAuthStore((state) => state.user);
  const startTask = useTaskStore((state) => state.startTask);
  const setActiveTask = useTaskStore((state) => state.setActiveTask);
  const appShortcutEnabled = useSettingsStore((state) => state.appShortcutEnabled);
  const appShortcutModifier = useSettingsStore((state) => state.appShortcutModifier);
  const appOrder = useSettingsStore((state) => state.appOrder);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const fetchSettings = useSettingsStore((state) => state.fetchSettings);

  // PointerSensor with activation constraint — requires 200ms hold or 5px move
  // so normal clicks on buttons still work
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: 200, tolerance: 5 }
    })
  );

  useEffect(() => {
    loadApps();
    fetchSettings();
  }, [fetchApps]);

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
      { key: 'prompt', label: t('workbench.groupPrompt'), items: [] }
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
    return groups.filter(g => g.items.length > 0);
  }, [apps, t]);

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

  const handleRun = useCallback(async (appId: string, appName: string, manifest: SubAppManifest) => {
    const hasParams = manifest.params && manifest.params.length > 0;
    if (hasParams || manifest.confirm_before_run) {
      setDrawerAppId(appId);
      setDrawerManifest(manifest);
      setDrawerOpen(true);
      return;
    }
    await executeApp(appId, appName, {});
  }, []);

  const handleDrawerSubmit = async (params: Record<string, unknown>) => {
    setDrawerOpen(false);
    if (drawerAppId && drawerManifest) {
      await executeApp(drawerAppId, drawerManifest.name, params);
    }
  };

  const executeApp = async (appId: string, appName: string, params: Record<string, unknown>) => {
    try {
      const taskId = await window.api.subapp.execute(appId, params);
      startTask(taskId, appId, appName);
      setActiveTask(taskId);
      message.success(t('workbench.appStarted', appName));
    } catch (error) {
      console.error('Failed to run app:', error);
      message.error(t('workbench.runFailed'));
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

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>{t('workbench.title')}</Title>
        <div style={{ display: 'flex', gap: 8 }}>
          {!isLocalMode && (
            <Button icon={<CompassOutlined />} onClick={() => navigate('/apps/library')}>
              {t('workbench.discover')}
            </Button>
          )}
          <Space.Compact>
            <Button icon={<SnippetsOutlined />} onClick={() => navigate('/apps/my-contributions')}>
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

      {!hasApps ? (
        <Empty description={t('workbench.noFavorites')} />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          {groupedApps.map((group) => (
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
              <SortableContext
                items={group.items.map((a) => a.id)}
                strategy={rectSortingStrategy}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                    gap: 16
                  }}
                >
                  {group.items.map((app, index) => {
                    // 快捷键只对第一组（app）的前 9 个生效
                    const globalIndex = group.key === 'app' ? index : -1;
                    const shortcutLabel = globalIndex >= 0 && globalIndex < 9 && appShortcutEnabled
                      ? `${modifierLabel} + ${globalIndex + 1}`
                      : null;
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
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </div>
          ))}
        </DndContext>
      )}

      <ParamDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        manifest={drawerManifest}
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
