import { useApp } from "ink";
import type { ColorScheme } from "../../shared/colors.js";
import { useAppState } from "./useAppState.js";
import { useTerminalDimensions } from "./useTerminalDimensions.js";
import { useWorkingTip } from "./useWorkingTip.js";
import { useMemoryStatus } from './useMemoryStatus.js';
import { useConversations } from "./useConversations.js";
import { createTranscriptActions } from "./transcript-actions.js";
import { usePromptQueue } from "./usePromptQueue.js";
import { useModelRouting } from "./useModelRouting.js";
import { createInteractionActions } from "./interaction-actions.js";
import { createCommandCompletion } from "./command-completion.js";
import { useAppLifecycle } from "./useAppLifecycle.js";
import { useSessionActions } from "./useSessionActions.js";
import { createPlanningActions } from "./planning-actions.js";
import { useAppKeyboard } from "./useAppKeyboard.js";
import { createExecutionActions } from "./execution-actions.js";
import { createAuxiliaryActions } from "./auxiliary-actions.js";
import { useRemoteHost } from './useRemoteHost.js';
import { createSubmit } from "./submit.js";
import { useDeferredTurns } from "./useDeferredTurns.js";
import { store, project, orchestrator } from "./runtime.js";

export function useAppController(onClear: () => void) {
  const { exit } = useApp();
  const state = useAppState();
  const saveTheme = async (scheme: ColorScheme) => {
    const updated = { ...state.latestConfig.current!, colorScheme: scheme };
    await store.saveConfig(updated);
    state.latestConfig.current = updated;
    state.setConfig(updated);
  };
  const terminalDimensions = useTerminalDimensions(() => {
    onClear();
    state.setTranscriptRevision(value => value + 1);
  });
  const workingTip = useWorkingTip(state.busy, state.session?.id);
  const memoryStatus = useMemoryStatus(state.session?.projectPath, store.baseDir, state.memoryOpen, state.busy);
  const conversations = useConversations(state);
  const transcript = createTranscriptActions({ ...state, store });
  const queue = usePromptQueue({ state, transcript });
  const routing = useModelRouting({
    ...state, store, rememberSession: conversations.rememberSession, add: transcript.add,
  });
  const interactions = createInteractionActions({ state, transcript, routing });
  const completion = createCommandCompletion({
    state, transcript, rememberSession: conversations.rememberSession,
  });
  const usage = useAppLifecycle({ state, transcript, queue });
  const sessions = useSessionActions({
    state, transcript, queue, conversations, onClear, exit,
    setStatusFor: interactions.setStatusFor,
  });
  const planning = createPlanningActions({
    ...state, store, project, onClear,
    promptQueue: queue.promptQueue,
    stopSideQuestion: sessions.stopSideQuestion,
    showFreshSession: sessions.showFreshSession,
    rememberSession: conversations.rememberSession,
    add: transcript.add,
  });
  const keyboard = useAppKeyboard({
    state, transcript, queue, conversations, routing, sessions, planning, onClear,
  });
  const execution = createExecutionActions({
    state, transcript, queue, interactions,
    rememberSession: conversations.rememberSession,
    refreshUsage: usage.refreshUsage,
  });
  const remote = useRemoteHost({ state, promptQueue: queue.promptQueue,
    rememberSession: conversations.rememberSession, add: transcript.add });
  const auxiliary = createAuxiliaryActions({
    ...state, orchestrator,
    handleRemote: remote.handleRemote,
    rememberSession: conversations.rememberSession,
    activity: transcript.activity,
    add: transcript.add,
  });
  const { submit, submitReviewComment } = createSubmit({
    state, transcript, queue, routing, completion, sessions, planning, auxiliary, execution, exit, onClear, saveTheme,
  });
  useDeferredTurns({
    state, transcript, queue,
    rememberSession: conversations.rememberSession,
    runTurn: execution.runTurn,
  });

  return {
    ...state, ...routing, ...conversations, ...queue, ...completion, ...transcript, ...keyboard, ...usage,
    ...remote, terminalDimensions, workingTip, memoryStatus, submit, submitReviewComment, onClear, saveTheme,
  };
}

export type AppController = ReturnType<typeof useAppController>;
