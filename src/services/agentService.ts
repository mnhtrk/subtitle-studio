import { invoke } from '@tauri-apps/api/core';
import type { SubtitleSegment, GlossaryEntry } from './projectService';

export interface AgentContext {
  project_id?: string | null;
  current_segments?: SubtitleSegment[] | null;
  current_glossary?: GlossaryEntry[] | null;
  target_language?: string | null;
}

export type AgentAction =
  | { EditSegments: { segments: SubtitleSegment[] } }
  | { UpdateGlossary: { entries: GlossaryEntry[] } }
  | { GenerateText: { text: string } }
  | { ExplainIssue: { issue: string; solution: string } };

export interface AgentResponse {
  message: string;
  action?: AgentAction | null;
  suggestions?: string[] | null;
}

export interface AgentRequest {
  message: string;
  context: AgentContext;
}

export const agentService = {
  chat: async (message: string, context: AgentContext): Promise<AgentResponse> => {
    return await invoke<AgentResponse>('chat_with_agent', {
      request: { message, context }
    });
  }
};
