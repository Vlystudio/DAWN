import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import LogsView from './components/LogsView';
import SettingsView from './components/SettingsView';
import MemoryManager from './components/MemoryManager';
import ModelManager from './components/ModelManager';
import ModelHub from './components/ModelHub';
import ObsidianView from './components/ObsidianView';
import NotionView from './components/NotionView';
import KnowledgeView from './components/KnowledgeView';
import LiveVisionView from './components/LiveVisionView';
import FirstRunSetup from './components/FirstRunSetup';
import UpdateToast from './components/UpdateToast';
import BrainExplorer from './brain/BrainExplorer';
import BrainProvider from './brain/BrainProvider';
import HudBackdrop from './components/HudBackdrop';
import { useBrainStore } from './state/brainStore';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [view, setView] = useState('chat');
  const [convs, setConvs] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [firstRun, setFirstRun] = useState<boolean | null>(null);

  const setBrain = useBrainStore((s) => s.setBrain);
  const loadPerf = useBrainStore((s) => s.loadPerf);
  const loadGraph = useBrainStore((s) => s.loadGraph);

  const refreshConvs = async (q = search) => setConvs(await window.dawn.conv.search(q));

  // Initial load. The brain's live state is driven by the runtime via
  // BrainProvider (boot → ready → error reflect the real llama.cpp process).
  useEffect(() => {
    loadPerf();
    refreshConvs('');
    loadGraph();
    window.dawn.settings.get().then((s: any) => setFirstRun(!s.firstRunComplete));
    setBrain('OFF', 'Turn DAWN on to load your local model.');
  }, []);

  useEffect(() => {
    refreshConvs(search);
  }, [search]);

  const onNewChat = () => {
    setSelectedId(null);
    setView('chat');
  };
  const onSelectConv = (id: string) => {
    setSelectedId(id);
    setView('chat');
  };
  const onDeleteConv = async (id: string) => {
    await window.dawn.conv.remove(id);
    if (id === selectedId) setSelectedId(null);
    refreshConvs();
  };
  const openConversation = (id: string) => {
    setSelectedId(id);
    setView('chat');
  };

  return (
    <>
      <BrainProvider />
      <HudBackdrop />
      <div className="flex h-screen overflow-hidden relative z-10">
        <Sidebar
          view={view}
          setView={setView}
          convs={convs}
          selectedId={selectedId}
          onSelectConv={onSelectConv}
          onNewChat={onNewChat}
          search={search}
          setSearch={setSearch}
          onDeleteConv={onDeleteConv}
          onNeedsModel={() => setView('models')}
        />
        <main className="flex-1 min-w-0 relative">
          {view === 'chat' && (
            <ChatView
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              onConvChange={() => refreshConvs()}
              onOpenExplorer={() => setView('explorer')}
            />
          )}
          {view === 'explorer' && <BrainExplorer onOpenConversation={openConversation} />}
          {view === 'vision' && <LiveVisionView />}
          {view === 'memory' && <MemoryManager />}
          {view === 'obsidian' && <ObsidianView />}
          {view === 'notion' && <NotionView />}
          {view === 'hub' && <ModelHub />}
          {view === 'models' && <ModelManager />}
          {view === 'knowledge' && <KnowledgeView />}
          {view === 'logs' && <LogsView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      <div className="scanlines" aria-hidden />
      {firstRun ? <FirstRunSetup onDone={() => setFirstRun(false)} /> : null}
      <UpdateToast />
    </>
  );
}
