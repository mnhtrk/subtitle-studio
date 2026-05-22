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
  actions?: AgentAction[];
  suggestions?: string[] | null;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentChatOptions {
  sessionId: string;
  conversationHistory?: ConversationTurn[]; // без текущего msg
}

export const agentService = {
  chat: async (
    message: string,
    context: AgentContext,
    options: AgentChatOptions
  ): Promise<AgentResponse> => {
    return await invoke<AgentResponse>('chat_with_agent', {
      request: {
        message,
        context,
        session_id: options.sessionId,
        conversation_history: options.conversationHistory ?? []
      }
    });
  }
};

export function agentSessionIdForProject(projectId: string | null | undefined): string {
  if (projectId && projectId.trim().length > 0) {
    return `project-${projectId.trim()}`;
  }
  return `session-${crypto.randomUUID()}`;
}
