export type SplitDirection = 'horizontal' | 'vertical'

export interface SplitNode {
  type: 'split'
  direction: SplitDirection
  children: LayoutNode[]
  sizes?: number[]
}

export interface LeafNode {
  type: 'leaf'
  id: string
  tabIds: string[]       // session IDs
  activeTabId: string | null
}

export type LayoutNode = SplitNode | LeafNode

// ── Tree utilities ──

let _paneCounter = 0
export function genPaneId(): string {
  return `pane-${Date.now()}-${++_paneCounter}`
}

/** Create a default single-pane layout */
export function createDefaultLayout(sessionIds: string[]): LeafNode {
  return {
    type: 'leaf',
    id: genPaneId(),
    tabIds: [...sessionIds],
    activeTabId: sessionIds[0] || null,
  }
}

/** Find a leaf node by pane ID */
export function findLeaf(node: LayoutNode, paneId: string): LeafNode | null {
  if (node.type === 'leaf') return node.id === paneId ? node : null
  for (const child of node.children) {
    const found = findLeaf(child, paneId)
    if (found) return found
  }
  return null
}

/** Find which leaf contains a given session ID */
export function findLeafBySessionId(node: LayoutNode, sessionId: string): LeafNode | null {
  if (node.type === 'leaf') return node.tabIds.includes(sessionId) ? node : null
  for (const child of node.children) {
    const found = findLeafBySessionId(child, sessionId)
    if (found) return found
  }
  return null
}

/** Collect all leaf nodes */
export function collectLeaves(node: LayoutNode): LeafNode[] {
  if (node.type === 'leaf') return [node]
  return node.children.flatMap(collectLeaves)
}

/** Deep-clone and replace a leaf node by ID with a new node */
export function replaceNode(root: LayoutNode, paneId: string, replacement: LayoutNode): LayoutNode {
  if (root.type === 'leaf') {
    return root.id === paneId ? replacement : root
  }
  return {
    ...root,
    children: root.children.map(child => replaceNode(child, paneId, replacement)),
  }
}

/** Remove a leaf from the tree by pane ID, collapsing single-child splits */
export function removeLeaf(root: LayoutNode, paneId: string): LayoutNode | null {
  if (root.type === 'leaf') {
    return root.id === paneId ? null : root
  }
  const newChildren = root.children
    .map(child => removeLeaf(child, paneId))
    .filter((c): c is LayoutNode => c !== null)
  if (newChildren.length === 0) return null
  if (newChildren.length === 1) return newChildren[0]
  return { ...root, children: newChildren }
}

/**
 * Update a leaf node in-place (immutably).
 * Returns a new tree with the leaf replaced by updater result.
 */
export function updateLeaf(
  root: LayoutNode,
  paneId: string,
  updater: (leaf: LeafNode) => LeafNode
): LayoutNode {
  if (root.type === 'leaf') {
    return root.id === paneId ? updater(root) : root
  }
  return {
    ...root,
    children: root.children.map(child => updateLeaf(child, paneId, updater)),
  }
}

/** Navigate to a split node by path and update its sizes */
export function updateSplitSizes(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (path.length === 0 && node.type === 'split') {
    return { ...node, sizes }
  }
  if (node.type === 'split' && path.length > 0) {
    const [idx, ...rest] = path
    return {
      ...node,
      children: node.children.map((child, i) =>
        i === idx ? updateSplitSizes(child, rest, sizes) : child
      ),
    }
  }
  return node
}
