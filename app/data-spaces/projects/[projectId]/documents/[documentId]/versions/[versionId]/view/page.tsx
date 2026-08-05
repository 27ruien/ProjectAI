import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout";
import { DocumentViewer } from "@/components/document-viewer/DocumentViewer";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/auth/session";
import { buildViewerContext } from "@/lib/auth/viewer-context";
import { requireProjectDocumentVersionResource } from "@/lib/files/authorization";
import { serializeProjectDocument, serializeDocumentVersion } from "@/lib/files/serialization";

type Props = {
  params: Promise<{ projectId: string; documentId: string; versionId: string }>;
};

export default async function DocumentViewerPage({ params }: Props) {
  const { projectId, documentId, versionId } = await params;
  const returnTo = `/data-spaces/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}/versions/${encodeURIComponent(versionId)}/view`;
  const principal = await requireAuthenticatedUser(returnTo);
  const requestHeaders = await headers();
  const data = await (async () => {
    try {
    const access = await requireProjectAccess(principal, projectId, requestHeaders);
    const viewer = await buildViewerContext(principal);
    const project = viewer.projects.find((item) => item.id === access.id);
    if (!project) notFound();
    const resource = await requireProjectDocumentVersionResource(
      principal,
      projectId,
      documentId,
      versionId,
      requestHeaders,
      "view",
    );
    const document = await serializeProjectDocument(
      resource.document,
      principal,
      access.projectRole,
      resource.version,
    );
      return {
        viewer,
        project,
        document,
        version: serializeDocumentVersion(resource.version, principal.user.displayName),
      };
    } catch (error) {
      if (error instanceof AuthorizationError) notFound();
      throw error;
    }
  })();
  return (
    <AppShell
      viewer={data.viewer}
      currentProject={data.project}
      currentPath={returnTo}
      featureFlags={{ pmDailyReport: false, wecomTimesheetSync: false }}
    >
      <DocumentViewer project={data.project} document={data.document} version={data.version} />
    </AppShell>
  );
}
