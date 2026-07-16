import { useEffect } from 'react'
import { theme } from 'antd'

/**
 * Shared Handsontable ("handsome table") theming.
 *
 * Injects a single global <style> that adapts every Handsontable instance —
 * cells, headers, context/dropdown menus, filters, autocomplete/select
 * listboxes and the Copiper multi-select editor panel — to the active Ant
 * Design light/dark token set.
 *
 * Originally lived inline in Copiper's CopiperTable; extracted here so the
 * AI Terminal DB grids render with the exact same scheme. Consumers mark
 * their primary data-table container with `data-hot-main` so its cells get
 * the solid container background (vs. the elevated popup background used by
 * editor/menu instances that Handsontable appends elsewhere in the DOM).
 *
 * The style element is ref-counted: it is created by the first mounted
 * consumer and removed only when the last one unmounts, so themes shared
 * across simultaneously-mounted grids (Copiper + DB tabs) don't tear each
 * other down.
 */

const STYLE_ID = 'clawbench-hot-theme'
let refCount = 0

/** Container attribute marking the primary (non-popup) data table. */
export const HOT_MAIN_ATTR = 'data-hot-main'

export function useHandsontableTheme(): void {
  const { token } = theme.useToken()

  useEffect(() => {
    refCount += 1
    let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = STYLE_ID
      document.head.appendChild(el)
    }

    el.textContent = `
      .handsontable { color: ${token.colorText}; font-size: ${token.fontSize}px; }
      .handsontable th {
        background-color: ${token.colorBgLayout} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable td {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable td.htDimmed {
        color: ${token.colorTextSecondary} !important;
        background-color: ${token.colorBgLayout} !important;
      }
      .handsontable tr:hover td { background-color: ${token.colorPrimaryBg}; }
      .handsontable .currentRow td { background-color: ${token.colorPrimaryBg}; }
      .handsontable .area td { background-color: ${token.colorPrimaryBgHover}; }
      .handsontable .htCheckboxRendererInput { accent-color: ${token.colorPrimary}; }
      .handsontableInput, .handsontableInputHolder textarea {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
      }
      /* Context menu & dropdown menu — outer wrapper */
      .htContextMenu,
      .htDropdownMenu {
        border: 1px solid ${token.colorBorderSecondary} !important;
        border-radius: 8px !important;
        overflow: hidden !important;
        box-shadow: ${token.boxShadow} !important;
        background-color: ${token.colorBgElevated} !important;
      }
      .htContextMenu .ht_master table,
      .htDropdownMenu .ht_master table {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htContextMenu .ht_master td,
      .htDropdownMenu .ht_master td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htContextMenu .ht_master td.current,
      .htContextMenu .ht_master td:hover,
      .htDropdownMenu .ht_master td.current,
      .htDropdownMenu .ht_master td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }
      .htContextMenu .htSeparator td,
      .htDropdownMenu .htSeparator td {
        border-color: ${token.colorBorderSecondary} !important;
      }

      /* Filter sections background */
      .htFiltersMenuCondition,
      .htFiltersMenuValue,
      .htFiltersMenuOperators,
      .htDropdownMenu .htFiltersMenuCondition,
      .htDropdownMenu .htFiltersMenuValue,
      .htDropdownMenu .htFiltersMenuOperators {
        background-color: ${token.colorBgElevated} !important;
      }

      /* Filter labels */
      .htFiltersMenuLabel,
      .htDropdownMenu .htFiltersMenuLabel {
        color: ${token.colorText} !important;
      }

      /* Condition filter select */
      .htUISelect,
      .htDropdownMenu .htUISelect,
      .htFiltersMenuCondition .htUISelect {
        background-color: ${token.colorBgContainer} !important;
        border-color: ${token.colorBorder} !important;
        color: ${token.colorText} !important;
        border-radius: 6px !important;
      }
      .htUISelectCaption,
      .htDropdownMenu .htUISelectCaption,
      .htFiltersMenuCondition .htUISelectCaption {
        color: ${token.colorText} !important;
        background-color: transparent !important;
      }
      /* Native <select> inside htUISelect */
      .htUISelect select,
      .htFiltersMenuCondition select {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorder} !important;
      }
      /* htUISelect expanded dropdown — a child Handsontable listbox */
      .htUISelect .htCore,
      .htUISelect .ht_master .htCore,
      .htUISelect .ht_master table {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
      }
      .htUISelect .ht_master td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htUISelect .ht_master td.current,
      .htUISelect .ht_master td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }

      /* Filter text inputs */
      .htFiltersMenuCondition .htUIInput input,
      .htFiltersMenuValue .htUIMultipleSelectSearch input {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorder} !important;
        border-radius: 6px !important;
      }

      /* Multi-select checkbox list */
      .htUIMultipleSelectHot,
      .htFiltersMenuValue .htUIMultipleSelectHot {
        background-color: ${token.colorBgElevated} !important;
      }
      .htUIMultipleSelectHot td,
      .htFiltersMenuValue .htUIMultipleSelectHot td,
      .htDropdownMenu .htFiltersMenuValue .htUIMultipleSelectHot td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htUIMultipleSelectHot td.current,
      .htUIMultipleSelectHot td:hover,
      .htFiltersMenuValue .htUIMultipleSelectHot td.current,
      .htFiltersMenuValue .htUIMultipleSelectHot td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }

      /* Checkbox accent */
      .htFiltersMenuValue input[type="checkbox"],
      .htDropdownMenu input[type="checkbox"] {
        accent-color: ${token.colorPrimary} !important;
      }

      /* Selection controls (全选 / 清除) */
      .htUISelectionControls a,
      .htDropdownMenu .htUISelectionControls a {
        color: ${token.colorPrimary} !important;
      }

      /* Action bar (确认 / 取消 buttons) */
      .htFiltersMenuActionBar,
      .htDropdownMenu .htFiltersMenuActionBar {
        padding: 8px !important;
        background-color: ${token.colorBgElevated} !important;
      }
      .htUIButton,
      .htFiltersMenuActionBar .htUIButton {
        background-color: ${token.colorBgContainer} !important;
        color: ${token.colorText} !important;
        border: 1px solid ${token.colorBorder} !important;
        border-radius: 6px !important;
        cursor: pointer !important;
        overflow: hidden !important;
      }
      /* Inner <input type="button"> inside htUIButton — strip its own bg */
      .htUIButton input,
      .htUIButton input[type="button"],
      .htFiltersMenuActionBar .htUIButton input {
        background-color: transparent !important;
        color: inherit !important;
        border: none !important;
        cursor: pointer !important;
      }
      .htUIButton:hover,
      .htFiltersMenuActionBar .htUIButton:hover {
        background-color: ${token.colorPrimaryBg} !important;
        border-color: ${token.colorPrimary} !important;
      }
      /* OK button — must override Handsontable green */
      .htUIButtonOK,
      .htUIButton.htUIButtonOK,
      .htFiltersMenuActionBar .htUIButton.htUIButtonOK {
        background-color: ${token.colorPrimary} !important;
        color: #fff !important;
        border-color: ${token.colorPrimary} !important;
      }
      .htUIButtonOK input,
      .htUIButton.htUIButtonOK input,
      .htUIButton.htUIButtonOK input[type="button"] {
        color: #fff !important;
        background-color: transparent !important;
      }
      .htUIButtonOK:hover,
      .htUIButton.htUIButtonOK:hover {
        opacity: 0.85;
      }
      /* Cell autocomplete / dropdown list / select editor popups */
      .handsontable.listbox .ht_master table,
      .htSelectEditor .ht_master table,
      .ht_editor_visible .ht_master table {
        background-color: ${token.colorBgElevated} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable.listbox td,
      .handsontable.listbox th,
      .htSelectEditor td,
      .htSelectEditor th {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .handsontable.listbox tr td.current,
      .handsontable.listbox tr:hover td,
      .htSelectEditor tr td.current,
      .htSelectEditor tr:hover td {
        background-color: ${token.colorPrimaryBg} !important;
        color: ${token.colorText} !important;
      }
      /* Catch-all: any Handsontable instance used as a popup/editor for filter selects */
      .htFiltersMenuCondition .handsontable td,
      .htFiltersMenuCondition .htCore td,
      .htFiltersMenuCondition table.htCore {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      .htFiltersMenuCondition .handsontable td.current,
      .htFiltersMenuCondition .handsontable td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }
      /* Column header: ensure dropdown button is always accessible */
      .handsontable thead th .relative {
        padding-right: 20px;
      }
      .handsontable thead th .colHeader {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        display: block;
      }
      .handsontable thead th .changeType {
        position: absolute;
        right: 2px;
        top: 50%;
        transform: translateY(-50%);
      }

      /*
       * Global fallback — popup Handsontable instances (condition select list,
       * autocomplete, etc.) may be appended outside any known parent container.
       * Use the generated ht_ id prefix to target ALL instances.
       */
      div[id^="ht_"] .ht_master td {
        background-color: ${token.colorBgElevated} !important;
        color: ${token.colorText} !important;
        border-color: ${token.colorBorderSecondary} !important;
      }
      div[id^="ht_"] .ht_master td.current,
      div[id^="ht_"] .ht_master td:hover {
        background-color: ${token.colorPrimaryBg} !important;
      }

      /* Custom multi-select editor panel (Copiper indices columns) */
      .copiper-multiselect-panel {
        position: absolute;
        z-index: 10000;
        max-height: 280px;
        display: flex;
        flex-direction: column;
        background-color: ${token.colorBgElevated};
        border: 1px solid ${token.colorBorderSecondary};
        border-radius: 8px;
        box-shadow: ${token.boxShadow};
        overflow: hidden;
      }
      .copiper-multiselect-search {
        margin: 6px;
        padding: 4px 8px;
        background-color: ${token.colorBgContainer};
        color: ${token.colorText};
        border: 1px solid ${token.colorBorder};
        border-radius: 6px;
        outline: none;
        font-size: ${token.fontSize}px;
      }
      .copiper-multiselect-search:focus {
        border-color: ${token.colorPrimary};
      }
      .copiper-multiselect-list {
        overflow-y: auto;
        padding: 0 4px 6px;
      }
      .copiper-multiselect-item {
        padding: 4px 24px 4px 8px;
        border-radius: 4px;
        cursor: pointer;
        color: ${token.colorText};
        white-space: nowrap;
        position: relative;
        user-select: none;
      }
      .copiper-multiselect-item:hover {
        background-color: ${token.colorPrimaryBg};
      }
      .copiper-multiselect-item.is-selected {
        background-color: ${token.colorPrimaryBgHover};
        font-weight: 600;
      }
      .copiper-multiselect-item.is-selected::after {
        content: '✓';
        position: absolute;
        right: 8px;
        color: ${token.colorPrimary};
      }
      .copiper-multiselect-empty {
        padding: 8px;
        color: ${token.colorTextSecondary};
        font-size: ${token.fontSize}px;
        text-align: center;
      }
      /* Re-pin main data table cells (container marked with ${HOT_MAIN_ATTR}) */
      [${HOT_MAIN_ATTR}] .ht_master td {
        background-color: ${token.colorBgContainer} !important;
      }
      [${HOT_MAIN_ATTR}] .ht_master td.htDimmed {
        background-color: ${token.colorBgLayout} !important;
        color: ${token.colorTextSecondary} !important;
      }
      [${HOT_MAIN_ATTR}] .ht_master tr:hover td,
      [${HOT_MAIN_ATTR}] .ht_master .currentRow td {
        background-color: ${token.colorPrimaryBg} !important;
      }
      [${HOT_MAIN_ATTR}] .ht_master .area td {
        background-color: ${token.colorPrimaryBgHover} !important;
      }

      /* ── AI Terminal DB grid: custom cell editors ── */
      /* Magnifier button floating over a text cell being edited */
      .db-textexpand-icon {
        position: absolute;
        z-index: 10001;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
        cursor: pointer;
        color: ${token.colorTextSecondary};
        background-color: ${token.colorBgContainer};
        border: 1px solid ${token.colorBorder};
      }
      .db-textexpand-icon:hover {
        color: ${token.colorPrimary};
        border-color: ${token.colorPrimary};
      }
      /* Expanded multi-line text panel */
      .db-textexpand-panel {
        position: absolute;
        z-index: 10002;
        flex-direction: column;
        gap: 8px;
        padding: 8px;
        background-color: ${token.colorBgElevated};
        border: 1px solid ${token.colorBorderSecondary};
        border-radius: 8px;
        box-shadow: ${token.boxShadow};
      }
      .db-textexpand-textarea {
        min-width: 300px;
        min-height: 140px;
        max-height: min(60vh, 480px);
        max-width: min(80vw, 720px);
        resize: both;
        padding: 6px 8px;
        font-size: ${token.fontSize}px;
        color: ${token.colorText};
        background-color: ${token.colorBgContainer};
        border: 1px solid ${token.colorBorder};
        border-radius: 6px;
        outline: none;
        /* Allow selecting / copying even when read-only */
        user-select: text;
      }
      .db-textexpand-textarea[readonly] {
        cursor: text;
      }
      .db-textexpand-textarea:focus {
        border-color: ${token.colorPrimary};
      }
      .db-textexpand-bar {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }
      .db-textexpand-btn {
        padding: 3px 14px;
        font-size: ${token.fontSize}px;
        color: ${token.colorText};
        background-color: ${token.colorBgContainer};
        border: 1px solid ${token.colorBorder};
        border-radius: 6px;
        cursor: pointer;
      }
      .db-textexpand-btn:hover {
        border-color: ${token.colorPrimary};
        color: ${token.colorPrimary};
      }
      .db-textexpand-btn-primary {
        color: #fff;
        background-color: ${token.colorPrimary};
        border-color: ${token.colorPrimary};
      }
      .db-textexpand-btn-primary:hover {
        color: #fff;
        opacity: 0.85;
      }
      /* Compact single-line data grid: no wrapping, ellipsis truncation */
      .db-grid-compact .ht_master td,
      [${HOT_MAIN_ATTR}] .ht_master td {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      /* Native datetime editor input */
      .db-datetime-input {
        height: 24px;
        padding: 0 6px;
        font-size: ${token.fontSize}px;
        color: ${token.colorText};
        background-color: ${token.colorBgContainer};
        border: 1px solid ${token.colorPrimary};
        border-radius: 4px;
        outline: none;
      }
    `

    return () => {
      refCount -= 1
      if (refCount <= 0) {
        refCount = 0
        document.getElementById(STYLE_ID)?.remove()
      }
    }
  }, [
    token.colorBgContainer, token.colorBgLayout, token.colorBgElevated,
    token.colorText, token.colorTextSecondary, token.colorBorderSecondary,
    token.colorBorder, token.colorPrimary, token.colorPrimaryBg,
    token.colorPrimaryBgHover, token.colorPrimaryHover, token.fontSize,
    token.boxShadow
  ])
}