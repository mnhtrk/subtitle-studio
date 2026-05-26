import {
	agentService,
	type AgentAction,
	type AgentContext,
	type AgentEditScope,
	type AgentIntent,
	type ConversationTurn,
	type SubtitleFileContext
} from '../services/agentService';
import { projectService, type GlossaryEntry, type SubtitleSegment } from '../services/projectService';
import { deleteSegmentsByIdsWithRemoved } from './subtitleSegmentsLocal';
import {
	AGENT_BATCH_SIZE,
	AGENT_NEIGHBOR_RADIUS,
	chunkSubtitleSegments,
	isWholeFileAgentRequest
} from './agentChat';
import { agentContextFromIntent } from './agentTask';
import { isProjectWideAgentRequest, type SubtitleFileBundle } from './agentProject';

export function buildSubtitleFileContexts(files: SubtitleFileBundle[]): SubtitleFileContext[] {
	return files.map((f) => ({
		file_id: f.id,
		file_name: f.name,
		segments: f.segments,
		summary: f.summary ?? null
	}));
}

// гарантирует что у эпизода есть пересказ
// если уже есть - вернёт его как есть; если нет - сгенерит через gpt и вернёт
// вызывающий код должен сам сохранить summary в проект (callback onSummaryReady)
export async function ensureEpisodeSummary(
	file: SubtitleFileBundle,
	targetLanguage: string | null,
	onSummaryReady?: (fileId: string, summary: string) => void | Promise<void>
): Promise<string | null> {
	const existing = (file.summary ?? '').trim();
	if (existing) return existing;
	if (!file.segments || file.segments.length === 0) return null;
	try {
		const summary = (await projectService.summarizeEpisode(file.segments, targetLanguage)).trim();
		if (!summary) return null;
		file.summary = summary;
		if (onSummaryReady) {
			await onSummaryReady(file.id, summary);
		}
		return summary;
	} catch (e) {
		console.warn('[agent] не удалось сгенерировать пересказ эпизода', file.name, e);
		return null;
	}
}

export function agentContextForEpisode(params: {
	projectId: string | null;
	file: SubtitleFileBundle;
	allFiles: SubtitleFileBundle[];
	glossary: GlossaryEntry[] | null;
	targetLanguage: string | null;
	intent: AgentIntent;
	editScope: AgentEditScope;
	focusSegmentId?: number | null;
	neighborRadius?: number;
	batchSegmentIds?: number[] | null;
	batchIndex?: number | null;
	batchTotal?: number | null;
}): AgentContext {
	const intentCtx = agentContextFromIntent(params.intent);
	const neighborRadius =
		params.neighborRadius ??
		(params.focusSegmentId != null ? AGENT_NEIGHBOR_RADIUS : 0);
	return {
		project_id: params.projectId,
		current_segments: params.file.segments,
		current_glossary: params.glossary,
		target_language: params.targetLanguage,
		active_subtitle_file_id: params.file.id,
		active_subtitle_file_name: params.file.name,
		edit_scope: params.editScope,
		subtitle_files: buildSubtitleFileContexts(params.allFiles),
		focus_segment_id: params.focusSegmentId ?? null,
		neighbor_radius: neighborRadius,
		batch_segment_ids: params.batchSegmentIds ?? null,
		batch_index: params.batchIndex ?? null,
		batch_total: params.batchTotal ?? null,
		...intentCtx
	};
}

export async function runAgentChatOnSubtitleFile(params: {
	messageForAgent: string;
	file: SubtitleFileBundle;
	allFiles: SubtitleFileBundle[];
	intent: AgentIntent;
	editScope: AgentEditScope;
	projectId: string | null;
	glossary: GlossaryEntry[] | null;
	targetLanguage: string | null;
	sessionId: string;
	conversationHistory: ConversationTurn[];
	hasAttachedSegment: boolean;
	focusSegmentId?: number | null;
	onBatchProgress?: (current: number, total: number) => void;
	// колбэк для сохранения сгенеренного пересказа в проект (state + project.json на диске)
	onSummaryReady?: (fileId: string, summary: string) => void | Promise<void>;
}): Promise<{ actions: AgentAction[]; message: string }> {
	const {
		messageForAgent,
		file,
		allFiles,
		intent,
		editScope,
		projectId,
		glossary,
		targetLanguage,
		sessionId,
		conversationHistory,
		hasAttachedSegment,
		focusSegmentId,
		onBatchProgress,
		onSummaryReady
	} = params;

	// гарантируем что у активного эпизода есть пересказ (фолбэк если не сгенерили после перевода)
	await ensureEpisodeSummary(file, targetLanguage, onSummaryReady);
	// для остальных эпизодов проекта тоже подтягиваем пересказы (нужны для общего контекста)
	// делаем параллельно и не падаем при ошибках отдельных эпизодов; один раз - потом в project.json
	const otherWithoutSummary = allFiles.filter(
		(f) => f.id !== file.id && !(f.summary ?? '').trim() && (f.segments?.length ?? 0) > 0
	);
	if (otherWithoutSummary.length > 0) {
		await Promise.allSettled(
			otherWithoutSummary.map((f) => ensureEpisodeSummary(f, targetLanguage, onSummaryReady))
		);
	}

	const neighborRadius = hasAttachedSegment || focusSegmentId != null ? AGENT_NEIGHBOR_RADIUS : 0;

	const useBatch =
		!hasAttachedSegment &&
		focusSegmentId == null &&
		file.segments.length > AGENT_BATCH_SIZE &&
		intent.task_mode !== 'answer_only' &&
		(isWholeFileAgentRequest(messageForAgent) ||
			isProjectWideAgentRequest(messageForAgent) ||
			intent.task_mode === 'bulk_replace' ||
			intent.task_mode === 'proofread' ||
			intent.task_mode === 'translation_fix' ||
			intent.task_mode === 'glossary_sync');

	if (!useBatch) {
		console.log('[agent][debug] request', {
			episode: file.name,
			segments: file.segments.length,
			batch: false,
			task_mode: intent.task_mode,
			editScope
		});
		const response = await agentService.chat(
			messageForAgent,
			agentContextForEpisode({
				projectId,
				file,
				allFiles,
				glossary,
				targetLanguage,
				intent,
				editScope,
				focusSegmentId,
				neighborRadius
			}),
			{ sessionId, conversationHistory }
		);
		return {
			actions: tagActionsWithFileId(response.actions ?? [], file.id),
			message: response.message ?? ''
		};
	}

	// размер пачки одинаковый для всех режимов агента - так быстрее и предсказуемо
	const batches = chunkSubtitleSegments(file.segments, AGENT_BATCH_SIZE);
	const collected: AgentAction[] = [];
	let working = file.segments;
	let lastMessage = '';

	for (let i = 0; i < batches.length; i++) {
		const batch = batches[i];
		const ids = batch.map((s) => s.id);
		onBatchProgress?.(i + 1, batches.length);

		// подсказка для пачки. для всех режимов одинаковая структура - чтобы модель работала
		// только по запросу пользователя и не правила "заодно" посторонние реплики
		const proofreadBatchHint =
			intent.task_mode === 'proofread'
				? `\n\nПакет ${i + 1}/${batches.length}: ${ids.length} реплик. Применяй ТОЛЬКО запрошенную пользователем правку (опечатки/пунктуация/точка в конце). Если в пакете нет реплик попадающих под запрос - actions: []. Не правь по своему усмотрению.\nfile_id для edit_segments: "${file.id}".`
				: intent.task_mode === 'translation_fix'
					? `\n\nПакет ${i + 1}/${batches.length}: ${ids.length} реплик. Применяй ТОЛЬКО ту правку перевода, что просил пользователь в сообщении. Не правь другие реплики "заодно". Если в пакете нет реплик попадающих под запрос - actions: [].\nfile_id для edit_segments: "${file.id}".`
					: `\n\nПакет ${i + 1}/${batches.length} (${ids.length} реплик, id: ${ids.join(', ')}). Полный текст этих реплик дан в системном контексте под заголовком «Пакет ${i + 1}/${batches.length} - полный текст ВСЕХ реплик».\nРаботай ТОЛЬКО с этими id и ТОЛЬКО с тем, что просил пользователь. file_id для edit_segments: "${file.id}".`;

		const batchPrompt = `${messageForAgent}${proofreadBatchHint}`;

		console.log('[agent][debug] request', {
			episode: file.name,
			batch: `${i + 1}/${batches.length}`,
			segmentIds: ids,
			task_mode: intent.task_mode,
			editScope,
			userMessageChars: batchPrompt.length
		});
		for (let p = 0; p * 3500 < batchPrompt.length; p++) {
			console.log(
				`[agent][debug] request_body[${p}]=${batchPrompt.slice(p * 3500, (p + 1) * 3500)}`
			);
		}

		const response = await agentService.chat(
			batchPrompt,
			agentContextForEpisode({
				projectId,
				file: { ...file, segments: working },
				allFiles,
				glossary,
				targetLanguage,
				intent,
				editScope,
				batchSegmentIds: ids,
				batchIndex: i + 1,
				batchTotal: batches.length
			}),
			{ sessionId, conversationHistory }
		);

		if (response.message?.trim()) {
			lastMessage = response.message.trim();
		}

		const actionsJson = JSON.stringify(response.actions ?? []);
		console.log('[agent][debug] response', {
			episode: file.name,
			batch: `${i + 1}/${batches.length}`,
			message: response.message ?? '',
			actionsCount: response.actions?.length ?? 0,
			actionsChars: actionsJson.length
		});
		for (let p = 0; p * 3500 < actionsJson.length; p++) {
			console.log(
				`[agent][debug] response_actions[${p}]=${actionsJson.slice(p * 3500, (p + 1) * 3500)}`
			);
		}

		for (const action of tagActionsWithFileId(response.actions ?? [], file.id)) {
			if ('EditSegments' in action) {
				working = mergeSegmentList(working, action.EditSegments.segments);
			} else if ('DeleteSegments' in action) {
				working = deleteSegmentsByIdsWithRemoved(working, action.DeleteSegments.segment_ids)
					.segments;
			}
			collected.push(action);
		}
	}

	return { actions: collected, message: lastMessage };
}

export function tagActionsWithFileId(actions: AgentAction[], fileId: string): AgentAction[] {
	return actions.map((action) => {
		if ('EditSegments' in action) {
			return {
				EditSegments: {
					file_id: action.EditSegments.file_id ?? fileId,
					segments: action.EditSegments.segments
				}
			};
		}
		if ('DeleteSegments' in action) {
			return {
				DeleteSegments: {
					file_id: action.DeleteSegments.file_id ?? fileId,
					segment_ids: action.DeleteSegments.segment_ids
				}
			};
		}
		return action;
	});
}

export function mergeSegmentList(
	baseList: SubtitleSegment[],
	patches: SubtitleSegment[]
): SubtitleSegment[] {
	if (patches.length === 0) return baseList;
	const map = new Map(baseList.map((s) => [s.id, s] as const));
	for (const patch of patches) {
		const prev = map.get(patch.id);
		if (!prev) continue;
		map.set(patch.id, {
			...prev,
			text: patch.text ?? prev.text,
			translation: patch.translation ?? prev.translation
		});
	}
	return baseList.map((s) => map.get(s.id) ?? s);
}

export function groupEditActionsByFile(
	actions: AgentAction[],
	fallbackFileId: string | null
): Map<string, AgentAction[]> {
	const map = new Map<string, AgentAction[]>();
	for (const action of actions) {
		if ('EditSegments' in action) {
			const fid = action.EditSegments.file_id ?? fallbackFileId;
			if (!fid) continue;
			const list = map.get(fid) ?? [];
			list.push(action);
			map.set(fid, list);
		} else if ('DeleteSegments' in action) {
			const fid = action.DeleteSegments.file_id ?? fallbackFileId;
			if (!fid) continue;
			const list = map.get(fid) ?? [];
			list.push(action);
			map.set(fid, list);
		}
	}
	return map;
}
