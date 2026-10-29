import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { newSession, PaceStore, projectKey } from "../src/core/sessions.js";
import type { Orchestrator } from "../src/core/orchestrator.js";
import type { Config, Session, StageAttempt } from "../src/shared/types.js";
import { RemoteDomain } from "../src/remote/domain.js";
import { RemoteInteractionHistory } from "../src/remote/interaction-history.js";
import { activityPage, activityText, sessionSummary, transcriptRevision } from "../src/remote/session-projection.js";
import { parseRequest, type ActivityPage, type ActivityTextPage, type Method, type Request, type SessionSummary, type Snapshot, type TurnTextPage } from "../src/remote/protocol.js";

const at = "2026-10-29T12:00:00.000Z";
const config: Config = { routingMode: "manual", defaultRoute: { model: "gpt-6.1-sol", effort: "medium" }, models: [{ model: "gpt-6.1-sol", efforts: ["medium"] }], skillFolder: null };
function attempt(overrides: Partial<StageAttempt> = {}): StageAttempt {
  return { id: "attempt-1", taskId: "task-1", generation: 1, stage: "final", role: "main", status: "completed", route: config.defaultRoute, startedAt: at, observations: [], ...overrides };
}
function session(): Session {
  const value = newSession("/tmp/project", "manual");
  value.createdAt = at; value.updatedAt = at;
  value.turns = [{ at, prompt: "Change this", result: "Done" }];
  return value;
}

it("keeps transcript hashes stable across activity and plan changes, but catches same-length text and metadata edits", () => {
  const value = session(); const initial = transcriptRevision(value);
  value.attempts = [attempt({ observations: [{ kind: "activity", text: "command: npm test" }] })];
  value.plan = "Revised plan"; value.updatedAt = "2026-10-29T12:01:00.000Z";
  expect(transcriptRevision(value)).toBe(initial);
  value.turns[0]!.result = "Fail";
  const changed = transcriptRevision(value); expect(changed).not.toBe(initial);
  value.turns[0]!.failed = true;
  expect(transcriptRevision(value)).not.toBe(changed);
  expect(transcriptRevision(structuredClone(value))).toBe(transcriptRevision(value));
});

it("projects all persisted mirror sources without leaking internal prompts, provenance or execution state", () => {
  const value = session();
  value.attempts = [attempt({ result: "Final outcome", memoryProvenance: { projectId: "private-provenance" }, observations: [
    { kind: "activity", text: "command: npm test\nAll tests passed\nOutcome: success" },
    { kind: "tasks", items: [{ text: "Run tests", completed: true }] },
    { kind: "answer", text: "Agent intermediate answer" },
    { kind: "artifacts", paths: ["artifacts/result.md", ".env", "../../secrets.md"] },
  ] })];
  value.activeTask = { originalRequest: "private-original-request", instructions: ["private-system-instructions"], workflow: { version: 1, generation: 1, shape: "scout_plan", stage: "final", source: "vex", status: "completed", scoutHandoff: "private-handoff" } };
  value.controlDecisions = [{ id: "decision-1", objective: "Choose route", choice: "continue", confidence: 1, probabilities: { continue: 1 }, durationMs: 10, at, source: "vex", contextAction: "continue", role: "main" }];
  value.steeringRecords = [{ version: 1, id: "steer-1", sessionId: value.id, turnKey: "private-turn-key", role: "main", text: "Also run lint", state: "delivered", createdAt: at, deliveredAt: at }];
  value.sideAnswers = [{ id: "side-1", attemptId: "attempt-1", question: "Why this design?", result: "Because it fits", snapshotAt: at, route: config.defaultRoute, adopted: true }];
  const page = activityPage(value, 0, 100);
  expect(new Set(page.items.map(item => item.kind))).toEqual(new Set(["attempt", "activity", "tasks", "answer", "artifacts", "decision", "steering", "side-answer", "workflow"]));
  expect(page.items.find(item => item.kind === "artifacts")?.paths).toEqual(["artifacts/result.md"]);
  expect(page.items.find(item => item.kind === "activity")?.text).toContain("All tests passed");
  const text = JSON.stringify(page);
  for (const secret of ["private-provenance", "private-original-request", "private-system-instructions", "private-handoff", "private-turn-key", ".env", "secrets.md"]) expect(text).not.toContain(secret);
});

it("pages bounded previews and preserves the full Unicode tool output through detail pages", () => {
  const value = session(); const output = "command: npm test\n" + "🧪".repeat(160_000);
  value.attempts = [attempt({ observations: Array.from({ length: 123 }, (_, index) => ({ kind: "activity", text: `${index === 122 ? output : "🧪".repeat(2000)}\n${index}` })) })];
  const tail = activityPage(value);
  expect(tail.total).toBe(124); expect(tail.offset).toBe(84); expect(tail.items).toHaveLength(40);
  const all: string[] = []; let offset = 0;
  do {
    const page = activityPage(value, offset, 100);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(1024 * 1024);
    all.push(...page.items.map(item => item.id));
    if (page.nextOffset === null) break; offset = page.nextOffset;
  } while (true);
  expect(new Set(all).size).toBe(124);
  const item = tail.items.at(-1)!; expect(item.truncated).toBe(true);
  const detail: string[] = []; offset = 0;
  do {
    const page = activityText(value, item.id, offset);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(1024 * 1024);
    detail.push(page.text);
    if (page.nextOffset === null) break; offset = page.nextOffset;
  } while (true);
  expect(detail.join("")).toContain(`${output}\n122`);
});

it("retains legacy tool activity and avoids duplicates from persisted attempts and live callbacks", () => {
  const value = session(); value.turns[0]!.activities = [{ category: "command", text: "npm test", detail: "Passed", outcome: "success" }];
  expect(activityPage(value).items[0]).toMatchObject({ title: "npm test", text: "Passed" });
  value.attempts = [attempt({ observations: [{ kind: "activity", text: "command: npm test\nPassed" }] })];
  value.turns[0]!.memoryAttemptId = "attempt-1";
  const live = { id: "live:1", at, kind: "activity" as const, title: "npm test", text: "command: npm test\nPassed" };
  const page = activityPage(value, 0, 100, [live]);
  expect(page.items.filter(item => item.kind === "activity")).toHaveLength(1);
  expect(page.items.some(item => item.id.startsWith("turn:"))).toBe(false);
});

it("mirrors legacy stages, routing and answered questions without inventing unavailable statuses", () => {
  const value = session();
  value.turns[0]!.stages = [{ objective: "Scout repository", route: config.defaultRoute, durationMs: 10, handoff: "Relevant files found" }];
  value.turns[0]!.routing = [{ objective: "Select model", choice: "continue", choiceLabel: "Continue current thread", confidence: 1, probabilities: { continue: 1 }, attempts: 1 }];
  value.turns[0]!.questions = [{ question: "Which target?", answer: "Android" }];
  const items = activityPage(value).items;
  expect(items.find(item => item.kind === "attempt")).toMatchObject({ title: "Scout repository", text: "Relevant files found" });
  expect(items.find(item => item.kind === "attempt")).not.toHaveProperty("status");
  expect(items.find(item => item.kind === "decision")?.title).toBe("Continue current thread");
  expect(items.find(item => item.status === "answered")).toMatchObject({ title: "Which target?", text: "Android" });
});

it("computes lightweight session state with waiting interactions taking precedence over running", () => {
  const value = session(); value.attempts = [attempt({ result: "huge".repeat(100_000) })];
  expect(sessionSummary(value).state).toBe("idle");
  expect(sessionSummary(value, { running: true }).state).toBe("running");
  expect(sessionSummary(value, { running: true, waiting: true }).state).toBe("waiting");
  value.attempts[0]!.status = "awaiting_user"; expect(sessionSummary(value).state).toBe("waiting");
  value.attempts[0]!.status = "failed"; expect(sessionSummary(value).state).toBe("failed");
  value.attempts[0]!.status = "awaiting_user";
  value.attempts.push(attempt({ id: "attempt-2", status: "completed" }));
  expect(sessionSummary(value).state).toBe("idle");
  expect(Buffer.byteLength(JSON.stringify(sessionSummary(value)))).toBeLessThan(1024);
  expect(sessionSummary(value)).not.toHaveProperty("turns");
});

const roots: string[] = []; const domains: RemoteDomain[] = [];
afterEach(async () => { await Promise.all(domains.splice(0).map(domain => domain.close())); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture(run?: Orchestrator["turn"]) {
  const root = await mkdtemp(join(tmpdir(), "pace-projection-")); roots.push(root);
  const store = new PaceStore(join(root, "store")); await store.saveConfig(config);
  const value = newSession(root, "manual");
  value.turns = Array.from({ length: 25 }, (_, index) => ({ at: new Date(Date.parse(at) + index * 1000).toISOString(), prompt: `Prompt ${index}`, result: "x".repeat(100_000) }));
  value.attempts = [attempt({ observations: [{ kind: "activity", text: "command: npm test\nPassed" }] })];
  await store.save(value);
  const orchestrator = { turn: run ?? (async () => ({ result: "Done" })) } as unknown as Orchestrator;
  const domain = new RemoteDomain(store, orchestrator, [root]); domains.push(domain);
  const request = (method: Method, params: Record<string, unknown> = {}) => domain.handle(parseRequest({ v: 1, id: randomUUID(), method, params: { ...(method === "sessions.list" ? {} : { sessionId: value.id }), projectId: projectKey(root), ...params } }), "device");
  return { domain, store, value, request, orchestrator };
}

it("lists accurate turn totals with a bounded summary and pages retained activities over the protocol", async () => {
  const { request } = await fixture();
  const list = await request("sessions.list") as SessionSummary[];
  expect(list[0]?.totalTurns).toBe(25);
  expect(Buffer.byteLength(JSON.stringify(list))).toBeLessThan(4096);
  expect(list[0]).not.toHaveProperty("attempts"); expect(list[0]).not.toHaveProperty("turns");
  const activity = await request("sessions.activity", { limit: 1 }) as ActivityPage;
  expect(activity.total).toBe(2); expect(activity.nextOffset).toBe(1);
  const second = await request("sessions.activity", { offset: 1 }) as ActivityPage;
  const detail = await request("sessions.activityText", { activityId: second.items[0]!.id }) as ActivityTextPage;
  expect(detail.text).toContain("Passed");
});

it("distinguishes unnamed sessions using public prompts consistently in list and snapshot titles", async () => {
  const { store, value, request } = await fixture();
  const second = newSession(value.projectPath, "manual");
  second.turns = [{ at, prompt: "Internal routed request", displayPrompt: "Investigate login failures", result: "Done" }];
  await store.save(second);
  const summaries = await request("sessions.list") as SessionSummary[];
  expect(summaries.find(item => item.id === value.id)?.title).toBe("Prompt 0");
  expect(summaries.find(item => item.id === second.id)?.title).toBe("Investigate login failures");
  expect((await request("sessions.snapshot") as Snapshot).session.title).toBe("Prompt 0");
  expect((await request("sessions.snapshot", { sessionId: second.id }) as Snapshot).session.title).toBe("Investigate login failures");
  const fresh = session(); fresh.turns = [];
  expect(sessionSummary(fresh, { running: true, prompt: "New task\n" + "x".repeat(500) }).title).toHaveLength(120);
  fresh.title = "Named session";
  expect(sessionSummary(fresh, { prompt: "Different prompt" }).title).toBe("Named session");
});

it("keeps revisions across progress-only saves, returns newest metadata on request, and rejects mixed transcript pages", async () => {
  const { store, value, request } = await fixture();
  const loads = vi.spyOn(store, "load");
  const initial = await request("sessions.snapshot") as Snapshot;
  expect(initial.activity?.total).toBe(2);
  const latest = await request("sessions.snapshot", { latest: true, transcriptRevision: initial.transcriptRevision }) as Snapshot;
  expect(latest.turnOffset).toBe(24); expect(latest.session.turns[0]?.at).toBe(value.turns[24]!.at);
  await request("sessions.turnText", { turnIndex: 0, field: "result", transcriptRevision: initial.transcriptRevision });
  expect(loads).toHaveBeenCalledTimes(1);
  await store.update(value, current => { current.attempts![0]!.observations.push({ kind: "activity", text: "Next command" }); });
  const progressed = await request("sessions.snapshot") as Snapshot;
  expect(progressed.transcriptRevision).toBe(initial.transcriptRevision); expect(progressed.activity?.total).toBe(3);
  const text = await request("sessions.turnText", { turnIndex: 0, field: "result", transcriptRevision: initial.transcriptRevision }) as TurnTextPage;
  expect(text.transcriptRevision).toBe(initial.transcriptRevision); expect(text.text.length).toBe(100_000);
  await store.update(value, current => { current.turns[0]!.result = "y".repeat(100_000); });
  await expect(request("sessions.turnText", { turnIndex: 0, field: "result", transcriptRevision: initial.transcriptRevision })).rejects.toThrow("Transcript changed");
  await expect(request("sessions.snapshot", { transcriptRevision: initial.transcriptRevision })).rejects.toThrow("Transcript changed");
});

it("mirrors live tools beyond four chat rows and reports running versus waiting for an approval", async () => {
  let progress!: Parameters<Orchestrator["turn"]>[3];
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const run: Orchestrator["turn"] = async (_prompt, current, _config, callback) => {
    progress = callback;
    await hold;
    return { session: current, result: "Done", note: "", route: {}, durationMs: 1, artifacts: [], stages: [], routing: [] };
  };
  const { request, orchestrator, value } = await fixture(run);
  const running = orchestrator.turn("Build", value, config, () => {});
  try {
    for (let index = 0; index < 7; index++) progress({ kind: "activity", id: `tool-${index}`, category: "command", title: `Build step ${index}`, detail: `Output ${index}`, completed: false });
    progress({ kind: "activity", id: "tool-0", category: "command", title: "Build step 0", detail: "Passed", completed: true, outcome: "success" });
    const snapshot = await request("sessions.snapshot") as Snapshot;
    expect(snapshot.activity?.items.filter(item => item.id.startsWith("live:"))).toHaveLength(7);
    expect(snapshot.activity?.items.find(item => item.id === "live:tool-0")?.text).toContain("Passed");
    expect((await request("sessions.list") as SessionSummary[])[0]?.state).toBe("running");
    progress({ kind: "approval", command: "npm run build", respond: () => {} });
    expect((await request("sessions.list") as SessionSummary[])[0]?.state).toBe("waiting");
    expect((await request("sessions.snapshot") as Snapshot).transcriptRevision).toBe(snapshot.transcriptRevision);
  } finally { release(); await running; }
});

it("retains approval/question resolutions and expiry after restart without journaling private questions or answers", async () => {
  let progress!: Parameters<Orchestrator["turn"]>[3];
  let local!: Parameters<Orchestrator["turn"]>[3] extends (event: infer Event) => void ? Event : never;
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const run: Orchestrator["turn"] = async (_prompt, current, _config, callback) => {
    progress = callback; await hold;
    return { session: current, result: "Done", note: "", route: {}, durationMs: 1, artifacts: [], stages: [], routing: [] };
  };
  const { domain, store, value, request, orchestrator } = await fixture(run);
  const running = orchestrator.turn("Build", value, config, event => { local = event; });
  try {
    progress({ kind: "approval", command: "npm test", respond: () => {} });
    let snapshot = await request("sessions.snapshot") as Snapshot;
    await request("interaction.answer", { interactionId: snapshot.interactions[0]!.id, decision: "accept" });
    progress({ kind: "question", questions: [{ id: "private", header: "Private header", question: "Private question text", options: [], isOther: true, isSecret: true }], respond: () => {} });
    snapshot = await request("sessions.snapshot") as Snapshot;
    await request("interaction.answer", { interactionId: snapshot.interactions[0]!.id, answers: { private: { answers: ["secret-answer-token"] } } });
    progress({ kind: "approval", command: "npm run build", respond: () => {} });
    if (local.kind !== "approval") throw new Error("Missing local approval callback");
    local.respond("decline");
    progress({ kind: "approval", command: "npm run pending", respond: () => {} });
  } finally { release(); await running; }
  await domain.close();
  const reopened = new RemoteDomain(store, orchestrator, [value.projectPath]); domains.push(reopened);
  const page = await reopened.handle(parseRequest({ v: 1, id: randomUUID(), method: "sessions.activity", params: { projectId: projectKey(value.projectPath), sessionId: value.id, limit: 100 } }), "device") as ActivityPage;
  const history = page.items.filter(item => item.id.startsWith("interaction:"));
  expect(history).toHaveLength(8);
  expect(history.filter(item => item.id.endsWith(":resolved")).map(item => item.status).sort()).toEqual(["accepted", "answered", "declined", "expired"]);
  expect(new Set(history.map(item => item.id)).size).toBe(8);
  const raw = await readFile(join(store.conversationDir(value.projectPath, value.id), "remote-interactions.json"), "utf8");
  expect(raw).toContain("[Private question]");
  for (const secret of ["secret-answer-token", "Private question text", "Private header"]) { expect(raw).not.toContain(secret); expect(JSON.stringify(history)).not.toContain(secret); }
});

it("surfaces interaction-history disk failures on reads and shutdown", async () => {
  const root = await mkdtemp(join(tmpdir(), "pace-history-failure-")); roots.push(root);
  const blocked = join(root, "blocked"); await writeFile(blocked, "not a directory");
  const logs: string[] = [];
  const history = new RemoteInteractionHistory(new PaceStore(blocked), message => logs.push(message));
  const value = session();
  history.requested(value, { id: randomUUID(), kind: "approval", command: "npm test" });
  await expect(history.read(value)).rejects.toThrow("Remote interaction history unavailable");
  await expect(history.close()).rejects.toThrow("Remote interaction history unavailable");
  expect(logs[0]).toContain("Remote interaction history unavailable");
});

it("stops journaling after host shutdown while the terminal-owned turn continues", async () => {
  let progress!: Parameters<Orchestrator["turn"]>[3];
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const run: Orchestrator["turn"] = async (_prompt, current, _config, callback) => {
    progress = callback; await hold;
    return { session: current, result: "Done", note: "", route: {}, durationMs: 1, artifacts: [], stages: [], routing: [] };
  };
  const { domain, store, value, orchestrator } = await fixture(run);
  const visible = vi.fn();
  const running = orchestrator.turn("Keep working locally", value, config, visible);
  await domain.close();
  try {
    progress({ kind: "approval", command: "local-only command", respond: () => {} });
    expect(visible).toHaveBeenCalledOnce();
    const history = new RemoteInteractionHistory(store, () => {});
    expect(await history.read(value)).toEqual([]); await history.close();
  } finally { release(); await running; }
});
