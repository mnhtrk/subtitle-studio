import { invoke } from '@tauri-apps/api/core';
import type { SubtitleSegment, GlossaryEntry } from './projectService';

export interface SubtitleFileContext {
  file_id: string;
  file_name: string;
  segments: SubtitleSegment[];
}

export type AgentEditScope = 'active_episode' | 'whole_project';

export interface AgentContext {
  project_id?: string | null;
  current_segments?: SubtitleSegment[] | null;
  current_glossary?: GlossaryEntry[] | null;
  target_language?: string | null;
  active_subtitle_file_id?: string | null;
  active_subtitle_file_name?: string | null;
  edit_scope?: AgentEditScope | null;
  subtitle_files?: SubtitleFileContext[];
  /** Реплика из Спросить агента в промпт попадёт окно соседей. */
  focus_segment_id?: number | null;
  /** Сколько сегментов до/после focus включить полным текстом (по умолчанию 5) */
  neighbor_radius?: number;
  /** Пакетная обработка всего файла только эти id в полном виде */
  batch_segment_ids?: number[] | null;
  batch_index?: number | null;
  batch_total?: number | null;
  /** Режим задачи (определяет ии) general  bulk_replace  proofread  translation_fix  answer_only */
  task_mode?: string | null;
  replace_from?: string | null;
  replace_to?: string | null;
  translation_only?: boolean;
}

export interface AgentIntent {
  task_mode: string;
  replace_from?: string | null;
  replace_to?: string | null;
  translation_only?: boolean;
}

export type AgentAction =
  | { EditSegments: { file_id?: string | null; segments: SubtitleSegment[] } }
  | { DeleteSegments: { file_id?: string | null; segment_ids: number[] } }
  | { UpdateGlossary: { entries: GlossaryEntry[] } }
  | { GenerateText: { text: string } }
  | { ExplainIssue: { issue: string; solution: string } };

export interface AgentResponse {
  message: string;
  actions?: AgentAction[];
  suggestions?: string[] | null;
  task_mode?: string | null;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentChatOptions {
  sessionId: string;
  conversationHistory?: ConversationTurn[];
}

export const agentService = {
  classifyIntent: async (
    message: string,
    options: AgentChatOptions
  ): Promise<AgentIntent> => {
    return await invoke<AgentIntent>('classify_agent_intent_command', {
      message,
      conversationHistory: options.conversationHistory ?? []
    });
  },

  chat: async (
    message: string,
    context: AgentContext,
    options: AgentChatOptions
  ): Promise<AgentResponse> => {
    console.log('[agent][debug] invoke chat_with_agent', {
      episode: context.active_subtitle_file_name,
      fileId: context.active_subtitle_file_id,
      editScope: context.edit_scope,
      batch: context.batch_index
        ? `${context.batch_index}/${context.batch_total}`
        : null,
      batchSegmentIds: context.batch_segment_ids,
      segments: context.current_segments?.length ?? 0,
      userMessageChars: message.length
    });
    for (let p = 0; p * 3500 < message.length; p++) {
      console.log(
        `[agent][debug] invoke_user[${p}]=${message.slice(p * 3500, (p + 1) * 3500)}`
      );
    }
    const response = await invoke<AgentResponse>('chat_with_agent', {
      request: {
        message,
        context,
        session_id: options.sessionId,
        conversation_history: options.conversationHistory ?? []
      }
    });
    const actionsJson = JSON.stringify(response.actions ?? []);
    console.log('[agent][debug] invoke chat_with_agent done', {
      episode: context.active_subtitle_file_name,
      message: response.message ?? '',
      actionsCount: response.actions?.length ?? 0,
      actionsChars: actionsJson.length
    });
    for (let p = 0; p * 3500 < actionsJson.length; p++) {
      console.log(
        `[agent][debug] invoke_actions[${p}]=${actionsJson.slice(p * 3500, (p + 1) * 3500)}`
      );
    }
    return response;
  }
};

export function agentSessionIdForProject(projectId: string | null | undefined): string {
  if (projectId && projectId.trim().length > 0) {
    return `project-${projectId.trim()}`;
  }
  return `session-${crypto.randomUUID()}`;
}
