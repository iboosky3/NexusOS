import type { ComponentType } from "react";
import type { ActivationContext, Disposable } from "../extension-host/lifecycle";

export type ResourcePayload = Record<string, unknown>;
export interface StudioResource {
  id: string; workspaceId: string; resourceType: string; schemaVersion: number;
  revision: number; payload: ResourcePayload; deleted: boolean;
}
export interface ResourceEditorProps {
  resource: StudioResource;
  disabled: boolean;
  onChange(payload: ResourcePayload): void;
  onSave(payload?: ResourcePayload): Promise<StudioResource>;
  onPublish(resource: StudioResource): Promise<void>;
  onSelection(value: unknown): void;
  onError(message: string): void;
}
export interface PluginContext extends ActivationContext {
  resources: { create(payload: ResourcePayload): Promise<StudioResource> };
  editors: { open(resource: StudioResource): void };
}
export interface PluginViewProps {
  resources: readonly StudioResource[];
  onOpen(resource: StudioResource): void;
}
export interface StudioPlugin {
  views?: readonly { id: string; label: string; icon: string; load(): Promise<{ default: ComponentType<PluginViewProps> }> }[];
  schemaVersion: 1; hostApiVersion: "1"; dependencies: readonly string[];
  commands: readonly { id: string; label: string; menu: "file" | "view" | "editor.toolbar" | "resource.context"; validate(args: unknown): void }[];
  id: string; name: string; resourceType: string; icon: string;
  capabilities: { id: string; label: string }[];
  acceptsArtifacts?: string[];
  initialPayload(): ResourcePayload;
  title(payload: ResourcePayload): string;
  load(): Promise<{ default: ComponentType<ResourceEditorProps> }>;
  activate(context: PluginContext): Promise<Disposable | void> | Disposable | void;
}
