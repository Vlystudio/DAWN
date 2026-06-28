/* companionBridge.ts — the script served to the phone as /dawn-bridge.js. It
 * recreates window.dawn (the exact shape of electron/preload.ts) but backed by
 * HTTP (/api/ipc) + SSE (/api/events) instead of Electron IPC, so DAWN's real
 * React app — brain, all views — runs on the phone unchanged.
 * Keep this a plain string: no backticks / ${} in the embedded client JS. */
export const BRIDGE = `(function(){
  var TOKEN = localStorage.getItem('dawn_token') || '';
  if(!TOKEN){ location.replace('/'); return; }

  function inv(channel){
    var args = Array.prototype.slice.call(arguments, 1);
    return fetch('/api/ipc', { method:'POST', headers:{ 'content-type':'application/json', 'x-dawn-token':TOKEN }, body: JSON.stringify({ channel: channel, args: args }) })
      .then(function(r){ if(r.status===401){ localStorage.removeItem('dawn_token'); location.replace('/'); throw new Error('unauthorized'); } return r.json(); })
      .then(function(j){ if(j && j.error) throw new Error(j.error); return j ? j.result : null; });
  }

  var subs = {};
  function subscribe(channel, cb){ (subs[channel] = subs[channel] || []).push(cb); return function(){ subs[channel] = (subs[channel]||[]).filter(function(x){ return x!==cb; }); }; }
  (function connect(){
    try {
      var es = new EventSource('/api/events?t=' + encodeURIComponent(TOKEN));
      es.onmessage = function(e){ try { var m = JSON.parse(e.data); var l = subs[m.channel]; if(l) l.slice().forEach(function(cb){ try { cb(m.payload); } catch(_){} }); } catch(_){} };
    } catch(e){}
  })();

  window.dawn = {
    runtime: {
      status: function(){ return inv('runtime:status'); },
      start: function(){ return inv('runtime:start'); },
      stop: function(){ return inv('runtime:stop'); },
      restart: function(){ return inv('runtime:restart'); },
      switchModel: function(p){ return inv('runtime:switchModel', p); },
      logs: function(){ return inv('runtime:logs'); },
      onUpdate: function(cb){ return subscribe('runtime:update', cb); },
      onLog: function(cb){ return subscribe('runtime:log', cb); }
    },
    models: {
      list: function(){ return inv('model:list'); },
      import: function(){ return inv('model:import'); },
      select: function(p){ return inv('model:select', p); },
      remove: function(p){ return inv('model:remove', p); },
      openFolder: function(){ return inv('model:openFolder'); },
      systemRam: function(){ return inv('model:systemRam'); }
    },
    rag: {
      status: function(){ return inv('rag:status'); },
      pickFolder: function(){ return inv('rag:pickFolder'); },
      estimate: function(f){ return inv('rag:estimate', f); },
      addFolder: function(f){ return inv('rag:addFolder', f); },
      removeFolder: function(f){ return inv('rag:removeFolder', f); },
      index: function(){ return inv('rag:index'); },
      pause: function(){ return inv('rag:pause'); },
      deleteAll: function(){ return inv('rag:deleteAll'); },
      onProgress: function(cb){ return subscribe('rag:progress', cb); }
    },
    setup: { complete: function(patch){ return inv('setup:complete', patch); } },
    hub: {
      catalog: function(){ return inv('hub:catalog'); },
      hardware: function(){ return inv('hub:hardware'); },
      download: function(p){ return inv('hub:download', p); },
      pause: function(id){ return inv('hub:pause', id); },
      resume: function(id){ return inv('hub:resume', id); },
      cancel: function(id){ return inv('hub:cancel', id); },
      downloads: function(){ return inv('hub:downloads'); },
      roles: function(){ return inv('hub:roles'); },
      setRole: function(role, path){ return inv('hub:setRole', { role: role, path: path }); },
      switchTo: function(path){ return inv('hub:switchTo', path); },
      onProgress: function(cb){ return subscribe('hub:progress', cb); }
    },
    updater: {
      check: function(){ return inv('updater:check'); },
      install: function(){ return inv('updater:install'); },
      onStatus: function(cb){ return subscribe('updater:status', cb); }
    },
    voice: {
      engine: function(){ return inv('voice:engine'); },
      synth: function(text){ return inv('voice:synth', text); }
    },
    vault: {
      pick: function(){ return inv('vault:pick'); },
      connect: function(folder){ return inv('vault:connect', folder); },
      test: function(){ return inv('vault:test'); },
      status: function(){ return inv('vault:status'); },
      reindex: function(){ return inv('vault:reindex'); },
      search: function(q){ return inv('vault:search', q); },
      open: function(){ return inv('vault:open'); },
      openNote: function(rel){ return inv('vault:openNote', rel); },
      writeMemory: function(m){ return inv('vault:writeMemory', m); },
      saveConversation: function(id){ return inv('vault:saveConversation', id); },
      graphExport: function(){ return inv('vault:graphExport'); },
      onProgress: function(cb){ return subscribe('vault:progress', cb); }
    },
    notion: {
      status: function(){ return inv('notion:status'); },
      connect: function(token){ return inv('notion:connect', token); },
      test: function(){ return inv('notion:test'); },
      sync: function(){ return inv('notion:sync'); },
      search: function(q){ return inv('notion:search', q); },
      open: function(url){ return inv('notion:open', url); },
      disconnect: function(){ return inv('notion:disconnect'); },
      onProgress: function(cb){ return subscribe('notion:progress', cb); }
    },
    conv: {
      list: function(){ return inv('conv:list'); },
      search: function(q){ return inv('conv:search', q); },
      get: function(id){ return inv('conv:get', id); },
      create: function(opts){ return inv('conv:create', opts); },
      update: function(id, patch){ return inv('conv:update', id, patch); },
      remove: function(id){ return inv('conv:delete', id); }
    },
    chat: {
      send: function(p){ return inv('chat:send', p); },
      regenerate: function(p){ return inv('chat:regenerate', p); },
      stop: function(p){ return inv('chat:stop', p); },
      onToken: function(cb){ return subscribe('chat:token', cb); },
      onDone: function(cb){ return subscribe('chat:done', cb); },
      onError: function(cb){ return subscribe('chat:error', cb); },
      onStatus: function(cb){ return subscribe('chat:status', cb); },
      onToolRequest: function(cb){ return subscribe('chat:tool-request', cb); },
      resolveTool: function(callId, approved){ return inv('chat:tool-resolve', { callId: callId, approved: approved }); }
    },
    memory: {
      list: function(){ return inv('memory:list'); },
      add: function(content, type){ return inv('memory:add', { content: content, type: type }); },
      update: function(id, patch){ return inv('memory:update', id, patch); },
      remove: function(id){ return inv('memory:remove', id); },
      clear: function(){ return inv('memory:clear'); }
    },
    fileAgent: {
      undo: function(){ return inv('fileagent:undo'); },
      openDownloads: function(){ return inv('fileagent:openDownloads'); },
      scan: function(p){ return inv('fileagent:scan', p); }
    },
    companion: {
      status: function(){ return inv('companion:status'); },
      setEnabled: function(enabled){ return inv('companion:setEnabled', enabled); },
      setPort: function(port){ return inv('companion:setPort', port); },
      regeneratePin: function(){ return inv('companion:regeneratePin'); },
      firewall: function(){ return inv('companion:firewall'); }
    },
    vision: {
      available: function(){ return inv('vision:available'); },
      cameras: function(){ return inv('vision:cameras'); },
      start: function(){ return inv('vision:start'); },
      stop: function(){ return inv('vision:stop'); },
      status: function(){ return inv('vision:status'); },
      detections: function(){ return inv('vision:detections'); },
      context: function(){ return inv('vision:context'); },
      ocr: function(){ return inv('vision:ocr'); },
      forget: function(){ return inv('vision:forget'); },
      snapshot: function(annotated){ return inv('vision:snapshot', annotated); },
      frame: function(){ return inv('vision:frame'); }
    },
    graph: {
      get: function(){ return inv('graph:get'); },
      rebuild: function(){ return inv('graph:rebuild'); },
      node: function(id){ return inv('graph:node', id); }
    },
    settings: {
      get: function(){ return inv('settings:get'); },
      save: function(patch){ return inv('settings:save', patch); }
    },
    logs: {
      get: function(){ return inv('logs:get'); },
      clear: function(){ return inv('logs:clear'); },
      onNew: function(cb){ return subscribe('log:new', cb); }
    },
    // On the phone, "open external" means open a browser tab here (not on the PC).
    openExternal: function(url){ try { window.open(url, '_blank'); } catch(e){} return Promise.resolve(); }
  };

  // --- make DAWN's desktop layout usable on a phone: turn the sidebar into a drawer ---
  // NOTE: no full-screen backdrop element — the app renders in a low-z stacking
  // context, so a body-level overlay would cover (and block taps on) the whole UI.
  // We close the drawer with a click listener instead.
  function mobileAdapt(){
    if(document.getElementById('dawn-hamburger')) return;
    var ham = document.createElement('button');
    ham.id = 'dawn-hamburger'; ham.setAttribute('aria-label','Menu'); ham.innerHTML = '&#9776;';
    document.body.appendChild(ham);
    ham.addEventListener('click', function(e){ e.stopPropagation(); document.body.classList.toggle('nav-open'); });
    // Any tap outside the hamburger closes the drawer (a nav item also navigates first).
    document.addEventListener('click', function(e){
      if(!document.body.classList.contains('nav-open')) return;
      if(e.target === ham || (ham.contains && ham.contains(e.target))) return;
      document.body.classList.remove('nav-open');
    });
  }
  if(document.readyState !== 'loading') mobileAdapt(); else document.addEventListener('DOMContentLoaded', mobileAdapt);
})();`;
