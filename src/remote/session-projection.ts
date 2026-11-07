import { createHash } from "node:crypto";
import type { Session } from "../shared/types.js";
import type { ActivityEntry, ActivityPage, ActivityTextPage, Route, SessionSummary, Workflow } from "./protocol.js";

const DETAIL_CHARS = 2000;
const ARTIFACT = /^(?:artifacts|\.pace\/artifacts)\/[^/\\]+\.md$/;
type TurnRevision = { prompt: string; displayPrompt?: string; result: string; metadata: string; digest: string };
const transcriptCache = new WeakMap<Session, { turns: TurnRevision[]; revision: string }>();

export function wireRoute(route: Session["route"]): Route {
  const efforts = ["minimal", "low", "medium", "high", "xhigh", "ultra", "persistent"];
  return { ...(route.model ? { model: route.model.slice(0, 120) } : {}), ...(route.effort && efforts.includes(route.effort) ? { effort: route.effort as Route["effort"] } : {}) };
}

/** Hash only the public transcript, so progress notifications do not invalidate text pages. */
export function transcriptRevision(session: Session): string {
  const previous = transcriptCache.get(session);
  let changed = previous?.turns.length !== session.turns.length;
  const turns = session.turns.map((turn, index): TurnRevision => {
    const metadata = JSON.stringify({ at: turn.at, fileEdits: turn.fileEdits, artifacts: turn.artifacts, failed: turn.failed, cancelled: turn.cancelled, route: turn.route, durationMs: turn.durationMs, usage: turn.usage });
    const cached = previous?.turns[index];
    if (cached && cached.prompt === turn.prompt && cached.displayPrompt === turn.displayPrompt && cached.result === turn.result && cached.metadata === metadata) return cached;
    changed = true;
    const hash = createHash("sha256");
    for (const field of [turn.prompt, turn.displayPrompt, turn.result]) {
      hash.update(field === undefined ? "-:" : `${Buffer.byteLength(field)}:`);
      if (field !== undefined) hash.update(field);
    }
    hash.update(metadata);
    return { prompt: turn.prompt, displayPrompt: turn.displayPrompt, result: turn.result, metadata, digest: hash.digest("hex") };
  });
  if (!changed && previous) return previous.revision;
  const hash = createHash("sha256");
  for (const turn of turns) hash.update(turn.digest);
  const revision = hash.digest("hex");
  transcriptCache.set(session, { turns, revision });
  return revision;
}

export function workflowProjection(session: Session): Workflow | undefined {
  const workflow = session.activeTask?.workflow;
  return workflow ? { generation: workflow.generation, shape: workflow.shape, stage: workflow.stage, ...(workflow.status ? { status: workflow.status } : {}), ...(session.activeTask?.id ? { taskId: session.activeTask.id } : {}) } : undefined;
}

export function sessionTitle(session: Session, activePrompt?: string): string | undefined {
  for (const candidate of [session.title, session.turns[0]?.displayPrompt, session.turns[0]?.prompt, activePrompt]) {
    const title = candidate?.trimStart().slice(0, 240).replace(/\s+/g, " ").trim().slice(0, 120);
    if (title) return title;
  }
  return undefined;
}

type ActivitySource = { id: string; at: string; read: () => ActivityEntry };

/** Keep references until paging; large historical outputs are never copied into list/snapshot payloads. */
function activitySources(session: Session, live: ActivityEntry[] = []): ActivitySource[] {
  const sources: ActivitySource[] = [];
  const add = (id: string, at: string, read: () => Omit<ActivityEntry, "id" | "at">) => sources.push({ id, at, read: () => ({ id, at, ...read() }) });
  const attempts = new Set((session.attempts ?? []).map(item => item.id));
  for (const attempt of session.attempts ?? []) {
    const context = { attemptId: attempt.id, role: attempt.role, route: wireRoute(attempt.route) };
    add(`attempt:${attempt.id}`, attempt.startedAt, () => ({ ...context, kind: "attempt", title: `${attempt.role} · ${attempt.stage}`, status: attempt.status, text: attempt.error ?? attempt.result ?? attempt.handoff }));
    attempt.observations.forEach((observation, index) => {
      add(`attempt:${attempt.id}:observation:${index}`, attempt.startedAt, () => ({
        ...context, kind: observation.kind, title: observation.kind === "activity" ? observation.text?.split("\n", 1)[0] || "Activity" : observation.kind === "tasks" ? "Tasks updated" : observation.kind === "answer" ? "Agent response" : "Artifacts created",
        text: observation.kind === "tasks" ? observation.items?.map(item => `${item.completed ? "[x]" : "[ ]"} ${item.text}`).join("\n") : observation.text,
        ...(observation.paths ? { paths: observation.paths.filter(path => ARTIFACT.test(path)) } : {}),
      }));
    });
  }
  session.turns.forEach((turn, turnIndex) => {
    if (Array.isArray(turn.questions)) turn.questions.forEach((question, index) => {
      if (question && typeof question.question === "string" && typeof question.answer === "string") add(`turn:${turnIndex}:question:${index}`, turn.at, () => ({ kind: "answer", title: question.question, text: question.answer, status: "answered" }));
    });
    // Newer sessions already retain the same tool activity on their attempts.
    if (turn.memoryAttemptIds?.some(id => attempts.has(id)) || (turn.memoryAttemptId && attempts.has(turn.memoryAttemptId))) return;
    turn.activities?.forEach((activity, index) => add(`turn:${turnIndex}:activity:${index}`, turn.at, () => ({ kind: "activity", title: activity.text, text: activity.detail, status: activity.outcome })));
    turn.stages?.forEach((stage, index) => add(`turn:${turnIndex}:stage:${index}`, turn.at, () => ({ kind: "attempt", title: stage.objective, text: stage.handoff, route: wireRoute(stage.route) })));
    if (!session.controlDecisions?.length) turn.routing?.forEach((decision, index) => add(`turn:${turnIndex}:routing:${index}`, turn.at, () => ({ kind: "decision", title: decision.choiceLabel ?? decision.choice, text: decision.objective })));
  });
  for (const decision of session.controlDecisions ?? []) add(`decision:${decision.id}`, decision.at, () => ({ kind: "decision", title: `${decision.source} · ${decision.choice}`, text: decision.error ?? decision.objective, role: decision.role, attemptId: decision.attemptId, status: decision.failed ? "failed" : "completed" }));
  for (const steering of session.steeringRecords ?? []) add(`steering:${steering.id}`, steering.createdAt, () => ({ kind: "steering", title: "Steering instruction", text: steering.text + (steering.error ? `\n${steering.error}` : ""), role: steering.role, attemptId: steering.attemptId, status: steering.inactive ? "inactive" : steering.state }));
  for (const side of session.sideAnswers ?? []) add(`side:${side.id}`, side.snapshotAt, () => ({ kind: "side-answer", title: side.question, text: side.error ?? side.result, role: "aside", attemptId: side.attemptId, route: wireRoute(side.route), status: side.error ? "failed" : side.adopted ? "adopted" : side.result !== undefined ? "completed" : "running" }));
  const workflow = workflowProjection(session);
  if (workflow) add(`workflow:${workflow.generation}:${workflow.stage}`, session.updatedAt, () => ({ kind: "workflow", title: `${workflow.shape} · ${workflow.stage}`, status: workflow.status }));
  if (live.length) {
    const persistedText = new Set((session.attempts ?? []).flatMap(attempt => attempt.observations.filter(item => item.kind === "activity" || item.kind === "answer").map(item => item.text)));
    for (const entry of live) if (entry.kind !== "activity" && entry.kind !== "answer" || !persistedText.has(entry.text)) sources.push({ id: entry.id, at: entry.at, read: () => entry });
  }
  return sources.sort((a, b) => a.at.localeCompare(b.at));
}

function boundedEntry(entry: ActivityEntry): ActivityEntry {
  const truncated = entry.title.length > 200 || (entry.text?.length ?? 0) > DETAIL_CHARS || (entry.paths?.length ?? 0) > 30;
  return { ...entry, title: entry.title.slice(0, 200), ...(entry.text !== undefined ? { text: entry.text.slice(0, DETAIL_CHARS) } : {}), ...(entry.paths ? { paths: entry.paths.slice(0, 30).map(path => path.slice(0, 1024)) } : {}), ...(truncated ? { truncated: true } : {}) };
}

export function activityPage(session: Session, offset?: number, limit = 40, live: ActivityEntry[] = [], budgetBytes = 600 * 1024): ActivityPage {
  const sources = activitySources(session, live);
  let start = Math.min(offset ?? Math.max(0, sources.length - limit), sources.length);
  const items: ActivityEntry[] = [];
  let size = 0;
  const page = sources.slice(start, start + Math.min(limit, 100));
  if (offset === undefined) page.reverse();
  for (const source of page) {
    const entry = boundedEntry(source.read());
    const bytes = Buffer.byteLength(JSON.stringify(entry));
    if (items.length && size + bytes > budgetBytes) break;
    items.push(entry); size += bytes;
  }
  if (offset === undefined) { items.reverse(); start = sources.length - items.length; }
  const next = start + items.length;
  return { items, offset: start, nextOffset: next < sources.length ? next : null, total: sources.length };
}

export function activityText(session: Session, activityId: string, offset: number, live: ActivityEntry[] = []): ActivityTextPage {
  const source = activitySources(session, live).find(item => item.id === activityId);
  if (!source) throw new Error("Activity no longer available. Refresh this session.");
  const entry = source.read();
  const value = [entry.title, entry.text, entry.paths?.join("\n")].filter(Boolean).join("\n\n");
  const text = value.slice(offset, offset + 100_000);
  const next = offset + text.length;
  return { activityId, offset, nextOffset: next < value.length ? next : null, totalChars: value.length, text };
}

export function sessionSummary(session: Session, live: { running?: boolean; waiting?: boolean; error?: string; prompt?: string } = {}): SessionSummary {
  const attempt = session.attempts?.at(-1);
  const lastTurn = session.turns.at(-1);
  const waiting = live.waiting || session.deferredTurn || (attempt && ["awaiting_user", "running", "pending"].includes(attempt.status));
  const failed = live.error || (lastTurn?.failed && !lastTurn.cancelled) || (attempt?.status === "failed" && (!lastTurn || attempt.startedAt >= lastTurn.at));
  const latest = session.attempts?.at(-1)?.observations.at(-1);
  const latestActivity = live.error ?? (live.running ? latest?.text?.slice(0, 200) : lastTurn?.cancelled ? "Cancelled" : lastTurn?.result?.slice(0, 200));
  const title = sessionTitle(session, live.prompt);
  return { id: session.id, ...(title ? { title } : {}), pinned: !!session.pinned, archived: !!session.archived, ...(session.kind ? { kind: session.kind } : {}), projectPath: session.projectPath, routingMode: session.routingMode, route: wireRoute(session.route), updatedAt: session.updatedAt, totalTurns: session.turns.length,
    state: live.waiting ? "waiting" : live.running ? "running" : waiting ? "waiting" : failed ? "failed" : lastTurn?.cancelled ? "cancelled" : lastTurn ? "completed" : "idle", ...(latestActivity ? { latestActivity: latestActivity.slice(0, 200) } : {}) };
}
