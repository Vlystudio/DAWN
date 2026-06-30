/** Shared renderer types. window.dawn is the preload bridge. */

export type BrainStateName =
  | 'OFF' | 'BOOTING' | 'IDLE' | 'LISTENING' | 'THINKING'
  | 'RETRIEVING_MEMORY' | 'READING_LOCAL_FILES' | 'SEARCHING_WEB'
  | 'SYNTHESIZING' | 'CITING_SOURCES'
  | 'INDEXING' | 'RESPONDING' | 'LOOKING' | 'ERROR';

export interface GraphNode {
  id: string;
  type: string;
  title: string;
  summary: string;
  source_id: string | null;
  created_at: number;
  updated_at: number;
  importance: number;
  confidence: number;
  position_x: number;
  position_y: number;
  position_z: number;
  color_group: string;
  metadata_json: string;
}
export interface GraphEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: string;
  strength: number;
}
export interface Graph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface Conversation {
  id: string;
  title: string;
  model: string;
  system_prompt: string;
  use_rag: number;
  use_web: number;
  use_memory: number;
  pinned: number;
  created_at: number;
  updated_at: number;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  citations: any[] | null;
  created_at: number;
}

export interface Memory {
  id: string;
  type: string;
  content: string;
  source: string;
  importance: number;
  confidence: number;
  pinned: number;
  last_used_at: number | null;
  created_at: number;
}

declare global {
  interface Window {
    dawn: any;
  }
}
