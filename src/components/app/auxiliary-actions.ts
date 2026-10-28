import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Config, Session } from "../../shared/types.js";
import type { Orchestrator } from "../../core/orchestrator.js";
import type { Progress } from "../../integrations/codex.js";
import { modelName } from "../turn-format.js";
import type { Line } from "../Transcript.js";

type AuxiliaryOptions = {
  session: Session | undefined;
  config: Config | undefined;
  orchestrator: Orchestrator;
  sideBusy: boolean;
  sideAbort: RefObject<AbortController | undefined>;
  turnSequence: RefObject<number>;
  activeSessionId: RefObject<string | undefined>;
  handleRemote: (text: string) => Promise<void>;
  setSideBusy: Dispatch<SetStateAction<boolean>>;
  setSession: Dispatch<SetStateAction<Session | undefined>>;
  rememberSession: (session: Session) => void;
  activity: (progress: Extract<Progress, { kind: "activity" }>) => void;
  add: (role: Line["role"], text: string) => void;
};

export function createAuxiliaryActions({
  session, config, orchestrator, sideBusy, sideAbort, turnSequence, activeSessionId, handleRemote, setSideBusy, setSession, rememberSession, activity, add
}: AuxiliaryOptions) {
  const askBtw = async (question: string) => {
    if (!session || !config) return;
    if (!question.trim()) { add("error", "Type /btw <question> to ask a side question."); return; }
    if (sideBusy) { add("info", "A side question is already running."); return; }
    const controller = new AbortController();
    const sideId = ++turnSequence.current;
    sideAbort.current = controller;
    setSideBusy(true);
    add("you", `/btw ${question}`);
    try {
      const result = await orchestrator.aside(question, session, config, progress => {
        if (sideAbort.current !== controller) return;
        if (progress.kind === "activity") activity({ ...progress, id: `side-${sideId}-${progress.id}` });
        if (progress.kind === "error") add("error", progress.text);
      }, controller.signal, () => activeSessionId.current === session.id);
      rememberSession(result.session);
      if (activeSessionId.current === session.id) setSession({ ...session });
      if (sideAbort.current === controller) {
        const record = session.sideAnswers?.at(-1);
        add("side", result.result);
        add("meta", `Side: ${modelName(result.route)} ${result.route.effort ?? "default"} · Main: ${modelName(session.route)} ${session.route.effort ?? "default"}${record ? ` · /adopt ${record.id}` : ""}`);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        add("meta", "Side question cancelled");
      } else if (sideAbort.current === controller) {
        add("error", `Side question failed: ${String(error)}`);
      }
    } finally {
      if (sideAbort.current === controller) { sideAbort.current = undefined; setSideBusy(false); }
    }
  };

  return { askBtw, handleRemote };
}
