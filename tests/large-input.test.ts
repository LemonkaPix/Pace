import { readFile, stat } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { AppServerRunner } from "../src/integrations/app-server-runner.js";
import type { RunnerMode } from "../src/integrations/codex-types.js";
import { newSession } from "../src/core/sessions.js";
import { retainedConversationPrompt } from "../src/core/orchestrator-helpers.js";

for (const mode of ["main", "side", "planning"] as RunnerMode[]) it(`sends oversized ${mode} input without losing the full request or overflowing transport`, async () => {
  const session = newSession(process.cwd(), "manual");
  session.turns = [{ prompt: "Earlier request", result: "x".repeat(1_048_576), at: "earlier" }];
  const prompt = retainedConversationPrompt("Continue [Pace image: /tmp/image.png]", session);
  let inputFile = "";
  const runner = new AppServerRunner(emit => ({
    setRequestHandler() {}, notify() {}, respond() {}, kill() {},
    async request(method, params) {
      if (method === "thread/start") return { thread: { id: "thread" } };
      if (method === "turn/start") {
        const { input } = params as { input: { type: string; text?: string; path?: string }[] };
        expect(input[0]!.text!.length).toBeLessThan(1_048_576);
        inputFile = JSON.parse(input[0]!.text!.match(/Pace full input file: (.+)/)![1]!);
        expect(await readFile(inputFile, "utf8")).toBe(prompt);
        expect((await stat(inputFile)).mode & 0o777).toBe(0o600);
        if (mode === "main") expect(input).toContainEqual({ type: "localImage", path: "/tmp/image.png" });
        emit({ method: "turn/completed", params: { threadId: "thread", turn: { id: "turn", status: "completed" } } });
        return { turn: { id: "turn" } };
      }
      return {};
    },
  }));
  expect((await runner.run(prompt, process.cwd(), {}, undefined, () => {}, undefined, mode, [], "request-approval", process.cwd())).completed).toBe(true);
  await expect(stat(inputFile)).rejects.toMatchObject({ code: "ENOENT" });
  expect(session.turns[0]?.result.length).toBe(1_048_576);
});

it("keeps an oversized steering input available until cancellation and then removes it", async () => {
  let inputFile = "";
  let steer: ((prompt: string) => Promise<void>) | undefined;
  const controller = new AbortController();
  const runner = new AppServerRunner(() => ({
    setRequestHandler() {}, notify() {}, respond() {}, kill() {},
    async request(method, params) {
      if (method === "thread/start") return { thread: { id: "thread" } };
      if (method === "turn/start") return { turn: { id: "turn" } };
      if (method === "turn/steer") {
        const text = (params as { input: { text: string }[] }).input[0]!.text;
        expect(text.length).toBeLessThan(1_048_576);
        inputFile = JSON.parse(text.match(/Pace full input file: (.+)/)![1]!);
        expect(await readFile(inputFile, "utf8")).toBe("z".repeat(1_048_577));
        return { turnId: "turn" };
      }
      return {};
    },
  }));
  const done = runner.run("Work", process.cwd(), {}, undefined, event => { if (event.kind === "steering") steer = event.steer; }, controller.signal);
  const rejected = expect(done).rejects.toThrow();
  try {
    await vi.waitFor(() => expect(steer).toBeTypeOf("function"));
    await steer!("z".repeat(1_048_577));
    expect(await stat(inputFile)).toBeDefined();
  } finally { controller.abort(); await rejected; }
  await expect(stat(inputFile)).rejects.toMatchObject({ code: "ENOENT" });
});

it("removes the full input file when App Server rejects turn start", async () => {
  let inputFile = "";
  const runner = new AppServerRunner(() => ({
    setRequestHandler() {}, notify() {}, respond() {}, kill() {},
    async request(method, params) {
      if (method === "thread/start") return { thread: { id: "thread" } };
      if (method === "turn/start") {
        const text = (params as { input: { text: string }[] }).input[0]!.text;
        inputFile = JSON.parse(text.match(/Pace full input file: (.+)/)![1]!);
        expect(await stat(inputFile)).toBeDefined();
        throw new Error("Model unavailable");
      }
      return {};
    },
  }));
  await expect(runner.run("z".repeat(1_048_577), process.cwd(), {}, undefined, () => {})).rejects.toThrow("Model unavailable");
  await expect(stat(inputFile)).rejects.toMatchObject({ code: "ENOENT" });
});
