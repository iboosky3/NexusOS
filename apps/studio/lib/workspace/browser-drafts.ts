import { createComponentId } from "../browser-crypto";
import { DraftStore } from "./draft-store";

let store: DraftStore | undefined;
export function browserDrafts(): DraftStore {
  return store ||= new DraftStore(window.localStorage, window.sessionStorage, createComponentId);
}
