import { Workspace } from "@/components/workspace";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { buildViewerContext } from "@/lib/auth/viewer-context";
import {
  getAuthorizedMockProjectPayload,
  getAuthorizedWorkspaceMockPayload,
} from "@/lib/project-data/mock-project-service";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

type CatchAllPageProps = {
  params: Promise<{ slug: string[] }>;
};

export default async function CatchAllPage({ params }: CatchAllPageProps) {
  const { slug } = await params;
  const route = slug.length > 0 ? slug : ["dashboard"];
  const returnTo = `/${route.join("/")}`;
  const principal = await requireAuthenticatedUser(returnTo);
  const viewer = await buildViewerContext(principal);
  const workspaceData = getAuthorizedWorkspaceMockPayload(
    viewer.projects.map((project) => ({
      id: project.id,
      canReview: project.permissions.canEditProject,
    })),
  );
  const requestHeaders = await headers();
  const [section, entityId, child] = route;

  if (
    (section === "settings" || section === "analytics") &&
    principal.user.systemRole !== "system_admin"
  ) {
    notFound();
  }

  if (section === "projects" && entityId === "new" && !viewer.canCreateProject) {
    notFound();
  }

  let currentProject;
  let projectData;
  if (section === "projects" && entityId && entityId !== "new") {
    try {
      const authorizedProject = await requireProjectAccess(
        principal,
        entityId,
        requestHeaders,
      );
      currentProject = viewer.projects.find(
        (project) => project.id === authorizedProject.id,
      );
      if (!currentProject) notFound();
      // Project files are real in v0.4. Do not serialize the old Mock document
      // payload into the browser on the documents route. Other project areas
      // intentionally remain project-filtered Mock capabilities this round.
      if (child !== "documents") {
        projectData = getAuthorizedMockProjectPayload(authorizedProject.id);
      }
    } catch (error) {
      if (error instanceof AuthorizationError && error.status === 404) notFound();
      throw error;
    }
  }

  return (
    <Workspace
      route={route}
      viewer={viewer}
      currentProject={currentProject}
      projectData={projectData}
      workspaceData={workspaceData}
    />
  );
}
