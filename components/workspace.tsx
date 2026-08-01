"use client";

import { AppShell } from "@/components/layout";
import { FocusedChatPage } from "@/components/knowledge/FocusedChatPage";
import { CompanyKnowledgePage } from "@/components/knowledge/CompanyKnowledgePage";
import { KnowledgeModuleNav } from "@/components/knowledge/KnowledgeModuleNav";
import { CreateProjectPage } from "@/components/project/CreateProjectPage";
import { DocumentsPage } from "@/components/project/DocumentsPage";
import { ProjectMembersPage } from "@/components/project/ProjectMembersPage";
import { ProjectOverviewPage } from "@/components/project/ProjectOverviewPage";
import { ProjectsPage } from "@/components/project/ProjectsPage";
import { RequirementDocumentsPage } from "@/components/project/RequirementDocumentsPage";
import { OrganizationPage } from "@/components/organization";
import { AccessDeniedPage, NotFoundPage, SettingsPage } from "@/components/system";
import { AiModelManagementPage } from "@/components/system/AiModelManagementPage";
import type { AuthorizedProjectSummary, ViewerContext } from "@/lib/auth/ui-types";

function StandardPage({ children }: { children: React.ReactNode }) {
  return <div className="px-4 py-6 lg:px-6 lg:py-7 xl:px-8">{children}</div>;
}

export function Workspace({ route, viewer, currentProject }: {
  route: string[];
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
}) {
  const [section, area, entityId, child] = route;
  const path = `/${route.join("/")}`;
  const isKnowledge = section === "knowledge";
  const isProjectDetail = isKnowledge && area === "projects" && Boolean(entityId) && entityId !== "new";
  const project = isProjectDetail && currentProject?.id === entityId ? currentProject : undefined;
  let page: React.ReactNode;
  if (isKnowledge && area === "projects" && !entityId) page = <ProjectsPage viewer={viewer} />;
  else if (isKnowledge && area === "projects" && entityId === "new") page = viewer.canCreateProject ? <CreateProjectPage managerName={viewer.user.displayName} /> : <AccessDeniedPage />;
  else if (isProjectDetail && !project) page = <AccessDeniedPage obscureResource />;
  else if (project && (!child || child === "overview")) page = <ProjectOverviewPage project={project} />;
  else if (project && child === "files") page = <DocumentsPage key={project.id} project={project} />;
  else if (project && child === "artifacts") page = <RequirementDocumentsPage key={project.id} project={project} />;
  else if (project && child === "members") page = <ProjectMembersPage key={project.id} project={project} />;
  else if (isKnowledge && area === "sessions" && !entityId) page = <FocusedChatPage viewer={viewer} />;
  else if (isKnowledge && area === "templates" && !entityId) page = <CompanyKnowledgePage />;
  else if (section === "organization" && viewer.user.productRole === "super_admin") page = <StandardPage><OrganizationPage /></StandardPage>;
  else if (section === "settings" && area === "ai-models" && viewer.user.productRole !== "member") page = <StandardPage><AiModelManagementPage organizationId={viewer.projects[0]?.organizationId ?? "org-legacy-default"} verificationProjectId={viewer.projects[0]?.id ?? null} /></StandardPage>;
  else if (section === "settings" && viewer.user.productRole !== "member") page = <StandardPage><SettingsPage /></StandardPage>;
  else page = <StandardPage><NotFoundPage path={path} /></StandardPage>;
  const knowledgePage = isKnowledge ? <><KnowledgeModuleNav activeArea={area as "projects" | "templates" | "sessions"} />{page}</> : page;
  return <AppShell viewer={viewer} currentProject={project} currentPath={path} featureFlags={{ pmDailyReport: false, wecomTimesheetSync: false }}>{knowledgePage}</AppShell>;
}
