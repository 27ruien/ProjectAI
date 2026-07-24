import { Workspace } from "@/components/workspace";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/auth/session";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { buildViewerContext } from "@/lib/auth/viewer-context";
import {
  getAuthorizedMockProjectPayload,
  getAuthorizedWorkspaceMockPayload,
} from "@/lib/project-data/mock-project-service";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { getTimesheetFeatureConfig } from "@/lib/timesheets/config";
import { isAiProviderConfigured } from "@/lib/ai/project-assistant/config";

type CatchAllPageProps = {
  params: Promise<{ slug: string[] }>;
  searchParams: Promise<{ debug?: string | string[] }>;
};

export default async function CatchAllPage({ params, searchParams }: CatchAllPageProps) {
  const { slug } = await params;
  const query = await searchParams;
  const debug = Array.isArray(query.debug) ? query.debug[0] : query.debug;
  const route = slug.length > 0 ? slug : ["dashboard"];
  const [section, entityId, child] = route;
  const returnTo = `/${route.join("/")}`;
  if (debug === "admin") {
    redirect(`/login?debug=admin&returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (section === "dashboard") redirect("/daily-report");
  if (section === "projects") {
    redirect(entityId && entityId !== "new" ? `/knowledge?projectId=${encodeURIComponent(entityId)}` : "/knowledge");
  }
  if (section === "reviews" || section === "skills") redirect("/workflows");
  if (section === "analytics") redirect("/knowledge");
  const principal = await requireAuthenticatedUser(returnTo);
  const viewer = await buildViewerContext(principal);
  const workspaceData = getAuthorizedWorkspaceMockPayload(
    viewer.projects.map((project) => ({
      id: project.id,
      canReview: project.permissions.canEditProject,
    })),
  );
  const requestHeaders = await headers();
  const featureFlags = getTimesheetFeatureConfig();
  let timesheetAiProviderConfigured = false;

  if (section === "daily-report" && !featureFlags.dailyReportEnabled) {
    notFound();
  }
  if (section === "daily-report") {
    timesheetAiProviderConfigured = await isAiProviderConfigured();
  }

  if (section === "organization" && principal.user.productRole !== "super_admin") {
    notFound();
  }
  if (section === "settings" && principal.user.productRole !== "super_admin") {
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
      // Project files are real in v0.5. Do not serialize the old Mock document
      // payload into the browser on the documents route. The knowledge page
      // receives only same-project Mock module counts alongside real search.
      if (child !== "documents") {
        const payload = getAuthorizedMockProjectPayload(authorizedProject.id);
        projectData =
          child === "knowledge"
            ? { ...payload, documents: [], citations: [] }
            : payload;
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
      featureFlags={{
        pmDailyReport: featureFlags.dailyReportEnabled,
        wecomTimesheetSync: featureFlags.wecomSyncEnabled,
        timesheetAiMode: featureFlags.aiMode,
        timesheetAiProvider: featureFlags.aiProvider,
        timesheetAiProviderConfigured,
        timesheetAiModelProfileId: featureFlags.aiModelProfileId,
        timesheetSyncProvider: featureFlags.syncProvider,
      }}
    />
  );
}
