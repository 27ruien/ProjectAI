"use client";

import { useRouter } from "next/navigation";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { AppShell } from "@/components/layout";
import { CreateProjectPage } from "@/components/project/CreateProjectPage";
import { DocumentsPage } from "@/components/project/DocumentsPage";
import { ProjectContextHeader, type ProjectTab } from "@/components/project/ProjectContextHeader";
import { ProjectOverviewPage } from "@/components/project/ProjectOverviewPage";
import { ProjectsPage } from "@/components/project/ProjectsPage";
import { ProjectKnowledgePage } from "@/components/knowledge/ProjectKnowledgePage";
import { RequirementsPage } from "@/components/requirement";
import { WorkflowsPage, RequirementExtractionPage } from "@/components/workflow";
import { ReviewsPage } from "@/components/review";
import { ScopePage } from "@/components/scope";
import { ActionsPage } from "@/components/action-plan";
import { MeetingsPage } from "@/components/meeting";
import { RisksPage } from "@/components/risk";
import { SkillsPage } from "@/components/skill";
import { AIModelsPage } from "@/components/model-management";
import { AccessDeniedPage, AnalyticsPage, GlobalKnowledgePage, NotFoundPage, SettingsPage } from "@/components/system";
import type {
  AuthorizedProjectSummary,
  ProjectMockPayload,
  ViewerContext,
  WorkspaceMockPayload,
} from "@/lib/auth/ui-types";

function ProjectSection({ project, tab, children }: { project: AuthorizedProjectSummary; tab: ProjectTab; children: React.ReactNode }) {
  return <div className="min-h-full bg-background"><ProjectContextHeader project={project} activeTab={tab} /><div className="px-4 py-6 lg:px-8">{children}</div></div>;
}

function StandardPage({ children, flush = false }: { children: React.ReactNode; flush?: boolean }) {
  return <div className={flush ? "p-4 lg:p-6" : "px-4 py-6 lg:px-6 lg:py-7 xl:px-8"}>{children}</div>;
}

export interface WorkspaceProps {
  route: string[];
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
  projectData?: ProjectMockPayload;
  workspaceData: WorkspaceMockPayload;
}

export function Workspace({ route, viewer, currentProject, projectData, workspaceData }: WorkspaceProps) {
  const router = useRouter();
  const [section = "dashboard", entityId, child] = route;
  const path = `/${route.join("/")}`;
  const isProjectDetail = section === "projects" && Boolean(entityId) && entityId !== "new";
  const exactProject = isProjectDetail && currentProject?.id === entityId ? currentProject : undefined;
  const exactProjectData = exactProject && projectData?.projectId === exactProject.id ? projectData : undefined;
  const editableProject = viewer.projects.find((project) => project.permissions.canEditProject);
  const canUseWriteWorkflows = Boolean(editableProject);

  let page: React.ReactNode;
  if (section === "dashboard") page = <DashboardPage viewer={viewer} />;
  else if (section === "projects" && !entityId) page = <ProjectsPage viewer={viewer} />;
  else if (section === "projects" && entityId === "new") page = viewer.canCreateProject ? <CreateProjectPage /> : <AccessDeniedPage />;
  else if (isProjectDetail && (!exactProject || !exactProjectData)) page = <AccessDeniedPage obscureResource />;
  else if (exactProject && exactProjectData && (!child || child === "overview")) page = <ProjectOverviewPage project={exactProject} data={exactProjectData} />;
  else if (exactProject && exactProjectData && child === "documents") page = <DocumentsPage project={exactProject} data={exactProjectData} />;
  else if (exactProject && exactProjectData && child === "knowledge") page = <ProjectKnowledgePage project={exactProject} data={exactProjectData} />;
  else if (exactProject && exactProjectData && child === "requirements") page = <RequirementsPage project={exactProject} data={exactProjectData} />;
  else if (exactProject && exactProjectData && child === "scope") page = <ProjectSection project={exactProject} tab="scope"><ScopePage project={exactProject} data={exactProjectData} /></ProjectSection>;
  else if (exactProject && exactProjectData && child === "actions") page = <ProjectSection project={exactProject} tab="actions"><ActionsPage project={exactProject} data={exactProjectData} /></ProjectSection>;
  else if (exactProject && exactProjectData && child === "meetings") page = <ProjectSection project={exactProject} tab="meetings"><MeetingsPage project={exactProject} data={exactProjectData} /></ProjectSection>;
  else if (exactProject && exactProjectData && child === "risks") page = <ProjectSection project={exactProject} tab="risks"><RisksPage project={exactProject} data={exactProjectData} /></ProjectSection>;
  else if (section === "workflows" && !canUseWriteWorkflows) page = <StandardPage><AccessDeniedPage /></StandardPage>;
  else if (section === "workflows" && entityId === "requirement-extraction" && editableProject) page = <StandardPage><RequirementExtractionPage editableProject={editableProject} onBack={() => router.push("/workflows")} onOpenReviews={() => router.push("/reviews")} /></StandardPage>;
  else if (section === "workflows") page = <StandardPage><WorkflowsPage data={workspaceData} editableProject={editableProject} onOpenReviews={() => router.push("/reviews")} /></StandardPage>;
  else if (section === "reviews") page = <StandardPage flush><ReviewsPage data={workspaceData} projects={viewer.projects} /></StandardPage>;
  else if (section === "skills") page = <StandardPage><SkillsPage data={workspaceData} initialSkillId={entityId} /></StandardPage>;
  else if (section === "knowledge") page = <StandardPage><GlobalKnowledgePage /></StandardPage>;
  else if (section === "analytics") page = <StandardPage><AnalyticsPage projects={viewer.projects} /></StandardPage>;
  else if (section === "settings" && viewer.user.systemRole !== "system_admin") page = <StandardPage><AccessDeniedPage /></StandardPage>;
  else if (section === "settings" && entityId === "ai-models") page = <StandardPage><AIModelsPage data={workspaceData} initialProfileId={child} /></StandardPage>;
  else if (section === "settings") page = <StandardPage><SettingsPage /></StandardPage>;
  else page = <StandardPage><NotFoundPage path={path} /></StandardPage>;

  return <AppShell viewer={viewer} currentProject={exactProject} currentPath={path}>{page}</AppShell>;
}
