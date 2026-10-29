import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { atomicJson, PaceStore, projectKey } from "../core/sessions.js";
import type { Session } from "../shared/types.js";
import type { ActivityEntry, PendingInteraction } from "./protocol.js";

const entrySchema = z.object({ id: z.string().max(300), at: z.string(), kind: z.enum(["decision", "answer"]), title: z.string().max(200), text: z.string().max(16000).optional(), status: z.enum(["pending", "accepted", "declined", "answered", "expired"]) }).strict();
const historySchema = z.object({ version: z.literal(1), projectId: z.string(), sessionId: z.string(), entries: z.array(entrySchema) }).strict();
type Entry = z.infer<typeof entrySchema>;
export type InteractionResolution = Exclude<Entry["status"], "pending">;

/** Remote-only interaction audit; answers to questions are deliberately never persisted. */
export class RemoteInteractionHistory {
  private readonly entries = new Map<string, Promise<Entry[]>>();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly errors = new Map<string, Error>();
  constructor(private readonly store: PaceStore, private readonly log: (message: string) => void) {}

  requested(session: Session, interaction: PendingInteraction) {
    const text = interaction.kind === "approval" ? interaction.command : interaction.questions?.map(question => question.isSecret ? "[Private question]" : question.question).join("\n");
    this.append(session, { id: `interaction:${interaction.id}:requested`, at: new Date().toISOString(), kind: interaction.kind === "approval" ? "decision" : "answer", title: interaction.kind === "approval" ? "Approval requested" : "Question requested", ...(text ? { text: text.slice(0, 16000) } : {}), status: "pending" });
  }
  resolved(session: Session, interaction: PendingInteraction, status: InteractionResolution) {
    this.append(session, { id: `interaction:${interaction.id}:resolved`, at: new Date().toISOString(), kind: interaction.kind === "approval" ? "decision" : "answer", title: `${interaction.kind === "approval" ? "Approval" : "Question"} ${status}`, status });
  }
  private file(session: Session) { return join(this.store.conversationDir(session.projectPath, session.id), "remote-interactions.json"); }
  private async load(session: Session): Promise<Entry[]> {
    const cached = this.entries.get(session.id);
    if (cached) return cached;
    const pending = (async () => {
      try {
        const history = historySchema.parse(JSON.parse(await readFile(this.file(session), "utf8")));
        if (history.projectId !== projectKey(session.projectPath) || history.sessionId !== session.id) throw new Error("Interaction history belongs to another session.");
        return history.entries;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        return [];
      }
    })();
    this.entries.set(session.id, pending);
    return pending;
  }
  private append(session: Session, entry: Entry) {
    const previous = this.writes.get(session.id) ?? Promise.resolve();
    const write = previous.then(async () => {
      const entries = await this.load(session);
      if (!entries.some(item => item.id === entry.id)) entries.push(entry);
      await atomicJson(this.file(session), { version: 1, projectId: projectKey(session.projectPath), sessionId: session.id, entries });
      this.errors.delete(session.id);
    }).catch(error => {
      const failure = new Error(`Remote interaction history unavailable: ${String(error)}`);
      this.errors.set(session.id, failure); this.log(failure.message);
    });
    this.writes.set(session.id, write);
  }
  async read(session: Session): Promise<ActivityEntry[]> {
    await this.writes.get(session.id);
    const error = this.errors.get(session.id);
    if (error) throw error;
    try { return await this.load(session); }
    catch (error) { throw new Error(`Remote interaction history unavailable: ${String(error)}`); }
  }
  async close() {
    await Promise.all(this.writes.values());
    if (this.errors.size) throw new Error([...this.errors.values()].map(error => error.message).join("\n"));
  }
}
