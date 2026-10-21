import { useCallback, useEffect, useRef, useState } from "react";
import {
  collaborationSnapshotSchema,
  type CollaborationChallenge,
  type CollaborationSave,
  type CollaborationSnapshot,
  type CollaborationVerification,
} from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";

const errorKey = (error: unknown, fallback: string) => {
  const message = error instanceof Error ? error.message : "";
  return (
    [
      "busy",
      "stale",
      "duplicateRole",
      "identityUnavailable",
      "workspaceUnavailable",
      "groupUnavailable",
      "unavailable",
    ].find((key) => message.includes(`collaboration.${key}`)) ?? fallback
  );
};
/** 界面只保存未提交草稿；版本与 busy 均以服务快照为准。 */
export function useCollaborationSettings() {
  const { botsService, broadcastService } = useServices();
  const [snapshot, setSnapshot] = useState<CollaborationSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState<
    (CollaborationChallenge & CollaborationVerification & { name: string }) | null
  >(null);
  const alive = useRef(false),
    generation = useRef(0),
    writing = useRef(false);
  const reload = useCallback(async () => {
    const requested = ++generation.current;
    try {
      const result = await botsService.getCollaborationSettings?.();
      if (alive.current && requested === generation.current) {
        setSnapshot(result ? collaborationSnapshotSchema.parse(result) : null);
        setError(null);
      }
    } catch (cause) {
      if (alive.current && requested === generation.current)
        setError(errorKey(cause, "loadFailed"));
    }
  }, [botsService]);
  useEffect(() => {
    alive.current = true;
    void reload();
    const subscription = broadcastService.onMessage((message) => {
      if (["bots:collaboration-settings", "bots:group-state"].includes(message.channel))
        void reload();
    });
    return () => {
      alive.current = false;
      ++generation.current;
      subscription.dispose();
    };
  }, [reload, broadcastService]);
  const save = async (request: CollaborationSave) => {
    if (writing.current || !botsService.saveCollaborationSettings) return;
    writing.current = true;
    setPending(true);
    setError(null);
    const requested = ++generation.current;
    try {
      const result = collaborationSnapshotSchema.parse(
        await botsService.saveCollaborationSettings(request),
      );
      if (alive.current && requested === generation.current) setSnapshot(result);
    } catch (cause) {
      if (alive.current) setError(errorKey(cause, "saveFailed"));
    } finally {
      writing.current = false;
      if (alive.current) setPending(false);
    }
  };
  const verify = async (request: CollaborationVerification, name: string) => {
    if (writing.current || !botsService.beginCollaborationVerification) return;
    writing.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await botsService.beginCollaborationVerification(request);
      if (alive.current) setChallenge({ ...result, ...request, name });
    } catch (cause) {
      if (alive.current) setError(errorKey(cause, "verificationFailed"));
    } finally {
      writing.current = false;
      if (alive.current) setPending(false);
    }
  };
  const clearChallenge = useCallback(() => setChallenge(null), []);
  return { snapshot, error, pending, challenge, reload, save, verify, clearChallenge };
}
