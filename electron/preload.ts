import { contextBridge, ipcRenderer } from 'electron';

/** Secure bridge: the renderer reaches the main process only through window.dawn. */
const sub = (channel: string, cb: (payload: any) => void) => {
  const listener = (_e: any, payload: any) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

const api = {
  runtime: {
    status: () => ipcRenderer.invoke('runtime:status'),
    start: () => ipcRenderer.invoke('runtime:start'),
    stop: () => ipcRenderer.invoke('runtime:stop'),
    restart: () => ipcRenderer.invoke('runtime:restart'),
    switchModel: (path: string) => ipcRenderer.invoke('runtime:switchModel', path),
    logs: () => ipcRenderer.invoke('runtime:logs'),
    onUpdate: (cb: (p: any) => void) => sub('runtime:update', cb),
    onLog: (cb: (p: any) => void) => sub('runtime:log', cb),
  },
  models: {
    list: () => ipcRenderer.invoke('model:list'),
    import: () => ipcRenderer.invoke('model:import'),
    select: (p: string) => ipcRenderer.invoke('model:select', p),
    remove: (p: string) => ipcRenderer.invoke('model:remove', p),
    openFolder: () => ipcRenderer.invoke('model:openFolder'),
    systemRam: () => ipcRenderer.invoke('model:systemRam'),
  },
  rag: {
    status: () => ipcRenderer.invoke('rag:status'),
    pickFolder: () => ipcRenderer.invoke('rag:pickFolder'),
    estimate: (f: string) => ipcRenderer.invoke('rag:estimate', f),
    addFolder: (f: string) => ipcRenderer.invoke('rag:addFolder', f),
    removeFolder: (f: string) => ipcRenderer.invoke('rag:removeFolder', f),
    index: () => ipcRenderer.invoke('rag:index'),
    pause: () => ipcRenderer.invoke('rag:pause'),
    deleteAll: () => ipcRenderer.invoke('rag:deleteAll'),
    onProgress: (cb: (p: any) => void) => sub('rag:progress', cb),
  },
  setup: {
    complete: (patch: any) => ipcRenderer.invoke('setup:complete', patch),
  },
  hub: {
    catalog: () => ipcRenderer.invoke('hub:catalog'),
    hardware: () => ipcRenderer.invoke('hub:hardware'),
    download: (p: any) => ipcRenderer.invoke('hub:download', p),
    pause: (id: string) => ipcRenderer.invoke('hub:pause', id),
    resume: (id: string) => ipcRenderer.invoke('hub:resume', id),
    cancel: (id: string) => ipcRenderer.invoke('hub:cancel', id),
    downloads: () => ipcRenderer.invoke('hub:downloads'),
    roles: () => ipcRenderer.invoke('hub:roles'),
    setRole: (role: string, path: string) => ipcRenderer.invoke('hub:setRole', { role, path }),
    switchTo: (path: string) => ipcRenderer.invoke('hub:switchTo', path),
    onProgress: (cb: (p: any) => void) => sub('hub:progress', cb),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb: (p: any) => void) => sub('updater:status', cb),
  },
  voice: {
    engine: () => ipcRenderer.invoke('voice:engine'),
    synth: (text: string) => ipcRenderer.invoke('voice:synth', text),
  },
  vault: {
    pick: () => ipcRenderer.invoke('vault:pick'),
    connect: (folder: string) => ipcRenderer.invoke('vault:connect', folder),
    test: () => ipcRenderer.invoke('vault:test'),
    status: () => ipcRenderer.invoke('vault:status'),
    reindex: () => ipcRenderer.invoke('vault:reindex'),
    search: (q: string) => ipcRenderer.invoke('vault:search', q),
    open: () => ipcRenderer.invoke('vault:open'),
    openNote: (rel: string) => ipcRenderer.invoke('vault:openNote', rel),
    writeMemory: (m: any) => ipcRenderer.invoke('vault:writeMemory', m),
    saveConversation: (id: string) => ipcRenderer.invoke('vault:saveConversation', id),
    graphExport: () => ipcRenderer.invoke('vault:graphExport'),
    onProgress: (cb: (p: any) => void) => sub('vault:progress', cb),
  },
  notion: {
    status: () => ipcRenderer.invoke('notion:status'),
    connect: (token: string) => ipcRenderer.invoke('notion:connect', token),
    test: () => ipcRenderer.invoke('notion:test'),
    sync: () => ipcRenderer.invoke('notion:sync'),
    search: (q: string) => ipcRenderer.invoke('notion:search', q),
    open: (url: string) => ipcRenderer.invoke('notion:open', url),
    disconnect: () => ipcRenderer.invoke('notion:disconnect'),
    onProgress: (cb: (p: any) => void) => sub('notion:progress', cb),
  },
  conv: {
    list: () => ipcRenderer.invoke('conv:list'),
    search: (q: string) => ipcRenderer.invoke('conv:search', q),
    get: (id: string) => ipcRenderer.invoke('conv:get', id),
    create: (opts?: any) => ipcRenderer.invoke('conv:create', opts),
    update: (id: string, patch: any) => ipcRenderer.invoke('conv:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('conv:delete', id),
  },
  chat: {
    send: (p: any) => ipcRenderer.invoke('chat:send', p),
    regenerate: (p: any) => ipcRenderer.invoke('chat:regenerate', p),
    stop: (p: any) => ipcRenderer.invoke('chat:stop', p),
    onToken: (cb: (p: any) => void) => sub('chat:token', cb),
    onDone: (cb: (p: any) => void) => sub('chat:done', cb),
    onError: (cb: (p: any) => void) => sub('chat:error', cb),
    onStatus: (cb: (p: any) => void) => sub('chat:status', cb),
    onToolRequest: (cb: (p: any) => void) => sub('chat:tool-request', cb),
    resolveTool: (callId: string, approved: boolean) => ipcRenderer.invoke('chat:tool-resolve', { callId, approved }),
  },
  memory: {
    list: () => ipcRenderer.invoke('memory:list'),
    add: (content: string, type?: string) => ipcRenderer.invoke('memory:add', { content, type }),
    update: (id: string, patch: any) => ipcRenderer.invoke('memory:update', id, patch),
    remove: (id: string) => ipcRenderer.invoke('memory:remove', id),
    clear: () => ipcRenderer.invoke('memory:clear'),
  },
  fileAgent: {
    undo: () => ipcRenderer.invoke('fileagent:undo'),
    openDownloads: () => ipcRenderer.invoke('fileagent:openDownloads'),
    scan: (p: string) => ipcRenderer.invoke('fileagent:scan', p),
  },
  companion: {
    status: () => ipcRenderer.invoke('companion:status'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('companion:setEnabled', enabled),
    setPort: (port: number) => ipcRenderer.invoke('companion:setPort', port),
    regeneratePin: () => ipcRenderer.invoke('companion:regeneratePin'),
    firewall: () => ipcRenderer.invoke('companion:firewall'),
  },
  vision: {
    available: () => ipcRenderer.invoke('vision:available'),
    cameras: () => ipcRenderer.invoke('vision:cameras'),
    start: () => ipcRenderer.invoke('vision:start'),
    stop: () => ipcRenderer.invoke('vision:stop'),
    status: () => ipcRenderer.invoke('vision:status'),
    detections: () => ipcRenderer.invoke('vision:detections'),
    context: () => ipcRenderer.invoke('vision:context'),
    ocr: () => ipcRenderer.invoke('vision:ocr'),
    forget: () => ipcRenderer.invoke('vision:forget'),
    snapshot: (annotated?: boolean) => ipcRenderer.invoke('vision:snapshot', annotated),
    frame: () => ipcRenderer.invoke('vision:frame'),
  },
  graph: {
    get: () => ipcRenderer.invoke('graph:get'),
    rebuild: () => ipcRenderer.invoke('graph:rebuild'),
    node: (id: string) => ipcRenderer.invoke('graph:node', id),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    save: (patch: any) => ipcRenderer.invoke('settings:save', patch),
  },
  logs: {
    get: () => ipcRenderer.invoke('logs:get'),
    clear: () => ipcRenderer.invoke('logs:clear'),
    onNew: (cb: (p: any) => void) => sub('log:new', cb),
  },
  openExternal: (url: string) => ipcRenderer.invoke('open:external', url),
};

contextBridge.exposeInMainWorld('dawn', api);
export type DawnApi = typeof api;
