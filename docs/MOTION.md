# ClawBench Motion Layer — 交互动效层

## 目的
提供轻量、高性能且贴合屏幕刷新率的交互动效层（基于 `transform` / `opacity` / `filter` / `clip-path`）。
支持全局动效模式切换（右上角头像菜单：**敏捷** | **优雅**），偏好持久化在 localStorage `cb-motion`，
`index.html` 在首帧前写入 `<html data-motion>`，避免 React 挂载前闪烁。

## 模式说明
- **敏捷（Agile）**：所有 `--dur-*` 降为 1ms（不是 0，保证 transitionend/animationend 仍会触发），界面即时响应。
- **优雅（Elegant，默认）**：全开流畅动效，包括列表阶梯入场、卡片微按压/浮起、页面转场过渡等。

## 核心交付与接入
1. `frontend/src/renderer/src/styles/motion.css` —— 动效样式定义（`--dur-1..5` 阶梯、按压 `.cb-press`、悬浮 `.cb-hover`、聚焦环 `.cb-focus-ring`、阶梯入场 `.cb-stagger`、页面转场 `.cb-page-transition`、窗口失焦降饱和等）。
2. `frontend/src/renderer/src/motion/*` —— 动效 TypeScript 工具库：
   - `pref`：`initMotionPreference` / `setMotionMode` / `readStoredMotionPref` / 特性检测
   - `view-transition`：`withViewTransition`（不排队、吞掉 finished reject）、`setSharedTransitionName`
   - `ViewTransitionBridge`：把 react-router 的 push/replace 包进 View Transition（依赖 `UNSAFE_NavigationContext`，取不到 navigator 时自动降级为普通导航）
   - `window-focus`：`<html data-window-focus>`，CSS 仅对 `.cb-topbar` / `.cb-sidebar` 降饱和
   - `stagger`：`playStaggerOnce` / `useStaggerOnce(ref)`（只在挂载时播放一次）
   - `layer-fallback`：`setLayerOpen`（无 `@starting-style` 时的浮层兜底）
3. 接入点：
   - `main.tsx`：`initMotionPreference()` + `initWindowFocusSync()`；`App.tsx`：`<ViewTransitionBridge />`
   - 顶栏头像菜单：动效胶囊切换器（敏捷 | 优雅）
   - `AppLayout`：内容区 `.cb-page-transition` 包裹层按**一级路由段**作 key（同模块内参数/子路由变化不重挂载）
   - 侧栏底部按钮使用 `.cb-press`
   - 页面首屏阶梯入场：在列表容器上 `useStaggerOnce(ref)`（工作台 / LocalEnv 页面由各自模块按需接入）

## 约束
- 只动画 `transform` / `opacity` / `filter` / `clip-path`；时长只用 `--dur-1..5`。
- `will-change` 不常驻，只在交互开始时加 `.cb-will-change`。
- 不在动效层使用 `backdrop-filter`。
- `.cb-page-transition` 使用 `animation-fill-mode: backwards`，动画结束后不残留 transform，避免成为 `position: fixed` 后代的包含块。
