"use client";

import { AppShell } from "@/components/layout";
import { CreateProjectPage } from "@/components/project/CreateProjectPage";
import { ProjectKnowledgePage } from "@/components/project/ProjectKnowledgePage";
import { ProjectMembersPage } from "@/components/project/ProjectMembersPage";
import { ProjectsPage } from "@/components/project/ProjectsPage";
import { OrganizationPage } from "@/components/organization";
import { AccessDeniedPage, NotFoundPage, SettingsPage } from "@/components/system";
import type { AuthorizedProjectSummary, ViewerContext } from "@/lib/auth/ui-types";

function StandardPage({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 lg:px-6 lg:py-7 xl:px-8">{children}</div>;
}

export function Workspace({
  route,
  viewer,
  currentProject,
}: {
  route: string[];
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
}) {
  const [section, entityId, child] = route;
  const path = `/${route.join("/")}`;
  const project = section === "projects" && entityId && entityId !== "new" && currentProject?.id === entityId
    ? currentProject
    : undefined;
  let page: React.ReactNode;
  if (section === "projects" && !entityId) page = <ProjectsPage viewer={viewer} />;
  else if (section === "projects" && entityId === "new")
    page = viewer.canCreateProject ? <CreateProjectPage managerName={viewer.user.displayName} /> : <AccessDeniedPage />;
  else if (section === "projects" && entityId && !project)
    page = <AccessDeniedPage obscureResource />;
  else if (project && child === "knowledge") page = <ProjectKnowledgePage project={project} />;
  else if (project && child === "members") page = <ProjectMembersPage key={project.id} project={project} />;
  else if (section === "organization" && viewer.user.productRole !== "member")
    page = <StandardPage><OrganizationPage mode={entityId === "members" ? "members" : "structure"} /></StandardPage>;
  else if (section === "settings" && viewer.user.productRole !== "member")
    page = <StandardPage><SettingsPage /></StandardPage>;
  else page = <StandardPage><NotFoundPage path={path} /></StandardPage>;
  return (
    <AppShell
      viewer={viewer}
      currentProject={project}
      currentPath={path}
    >
      {page}
    </AppShell>
  );
}
