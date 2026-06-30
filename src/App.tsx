import React, { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import LogsView from './components/LogsView';
import SettingsView from './components/SettingsView';
import MemoryManager from './components/MemoryManager';
import ModelManager from './components/ModelManager';
import ModelHub from './components/ModelHub';
import ModelOptimizer from './components/ModelOptimizer';
import ResearchView from './components/ResearchView';
import CompareView from './components/CompareView';
import DocumentsView from './components/DocumentsView';
import NotesView from './components/NotesView';
import TasksView from './components/TasksView';
import CalendarView from './components/CalendarView';
import SkillsView from './components/SkillsView';
import ApprovalModal from './components/ApprovalModal';
import SecurityView from './components/SecurityView';
import LockScreen from './components/LockScreen';
import EmailView from './components/EmailView';
import BackupView from './components/BackupView';
import DashboardView from './components/DashboardView';
import FeatureMaturityView from './components/FeatureMaturityView';
import CommandPalette from './components/CommandPalette';
import GlobalSearch from './components/GlobalSearch';
import WorkspaceView from './components/WorkspaceView';
import ObsidianView from './components/ObsidianView';
import NotionView from './components/NotionView';
import KnowledgeView from './components/KnowledgeView';
import LocalKnowledgePanel from './components/LocalKnowledgePanel';
import CodingPanel from './components/CodingPanel';
import LiveVisionView from './components/LiveVisionView';
import FirstRunSetup from './components/FirstRunSetup';
import UpdateToast from './components/UpdateToast';
import BrainExplorer from './brain/BrainExplorer';
import BrainProvider from './brain/BrainProvider';
import HudBackdrop from './components/HudBackdrop';
import { useBrainStore } from './state/brainStore';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [view, setView] = useState('dashboard');
  const [convs, setConvs] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [firstRun, setFirstRun] = useState<boolean | null>(null);

  const setBrain = useBrainStore((s) => s.setBrain);
  const loadPerf = useBrainStore((s) => s.loadPerf);
  const loadGraph = useBrainStore((s) => s.loadGraph);

  const refreshConvs = async (q = search) => setConvs(await window.dawn.conv.search(q));

  // Navigate when a desktop notification (e.g. a task reminder) is clicked.
  useEffect(() => window.dawn.onNav?.((v: string) => setView(v)), []);

  // Auth/lock state (Secure mode). Polls so session-expiry locks the app.
  const [authStatus, setAuthStatus] = useState<any>(null);
  const refreshAuth = () => window.dawn.auth?.status?.().then(setAuthStatus);
  useEffect(() => {
    refreshAuth();
    const id = setInterval(refreshAuth, 20000);
    const off = window.dawn.auth?.onLock?.(refreshAuth);
    const onFocus = () => refreshAuth();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); off?.(); window.removeEventListener('focus', onFocus); };
  }, []);
  const locked = !!authStatus?.authEnabled && !!authStatus?.locked;

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
          {view === 'dashboard' && <DashboardView onNav={setView} onNewChat={onNewChat} />}
          {view === 'chat' && (
            <ChatView
              selectedId={selectedId}
              setSelectedId={setSelectedId}
              onConvChange={() => refreshConvs()}
              onOpenExplorer={() => setView('explorer')}
            />
          )}
          {view === 'explorer' && <BrainExplorer onOpenConversation={openConversation} />}
          {view === 'coding' && <CodingPanel />}
          {view === 'research' && <ResearchView />}
          {view === 'compare' && <CompareView />}
          {view === 'documents' && <DocumentsView />}
          {view === 'notes' && <NotesView />}
          {view === 'tasks' && <TasksView />}
          {view === 'calendar' && <CalendarView />}
          {view === 'email' && <EmailView />}
          {view === 'skills' && <SkillsView />}
          {view === 'security' && <SecurityView />}
          {view === 'backup' && <BackupView />}
          {view === 'vision' && <LiveVisionView />}
          {view === 'memory' && <MemoryManager />}
          {view === 'obsidian' && <ObsidianView />}
          {view === 'notion' && <NotionView />}
          {view === 'hub' && <ModelHub />}
          {view === 'optimizer' && <ModelOptimizer />}
          {view === 'models' && <ModelManager />}
          {view === 'knowledge' && <KnowledgeView />}
          {view === 'localknowledge' && <LocalKnowledgePanel />}
          {view === 'workspace' && <WorkspaceView />}
          {view === 'health' && <FeatureMaturityView onNav={setView} />}
          {view === 'logs' && <LogsView />}
          {view === 'settings' && <SettingsView />}
        </main>
      </div>

      <div className="scanlines" aria-hidden />
      {firstRun ? <FirstRunSetup onDone={() => setFirstRun(false)} /> : null}
      <UpdateToast />
      <CommandPalette onNav={setView} onNewChat={onNewChat} />
      <GlobalSearch onNav={setView} />
      <ApprovalModal />
      {locked ? <LockScreen totpEnabled={!!authStatus?.totpEnabled} onUnlocked={refreshAuth} /> : null}
    </>
  );
}
