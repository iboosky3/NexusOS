import type { ResourcePayload } from "../plugin-sdk/types";

export interface SaveSubmission { expectedRevision: number; payload: ResourcePayload; clientRequestId: string }
export interface ResourceDraft { baseRevision: number; payload: ResourcePayload; submission?: SaveSubmission }
const object = (value: unknown): value is ResourcePayload => Boolean(value && typeof value === "object" && !Array.isArray(value));
export function resourceDraft(value: unknown): ResourceDraft {
  const draft = value as ResourceDraft | null;
  if (!draft || !Number.isSafeInteger(draft.baseRevision) || draft.baseRevision < 1 || !object(draft.payload) ||
      (draft.submission && (!Number.isSafeInteger(draft.submission.expectedRevision) || draft.submission.expectedRevision < 1 ||
        !object(draft.submission.payload) || typeof draft.submission.clientRequestId !== "string" || !draft.submission.clientRequestId))) {
    throw new Error("资源草稿格式损坏，原始记录已保留，可下载备份");
  }
  return draft;
}
