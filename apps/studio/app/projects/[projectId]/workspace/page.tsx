import { WorkspaceStudio } from "@/components/workspace/workspace-studio";

export default async function ProjectWorkspacePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <WorkspaceStudio projectId={projectId} />;
}
