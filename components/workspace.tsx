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
import { AnalyticsPage, GlobalKnowledgePage, NotFoundPage, SettingsPage } from "@/components/system";

function ProjectSection({ projectId, tab, children }: { projectId: string; tab: ProjectTab; children: React.ReactNode }) {
  return <div className="min-h-full bg-background"><ProjectContextHeader projectId={projectId} activeTab={tab} /><div className="px-4 py-6 lg:px-8">{children}</div></div>;
}

function StandardPage({ children, flush = false }: { children: React.ReactNode; flush?: boolean }) {
  return <div className={flush ? "p-4 lg:p-6" : "px-4 py-6 lg:px-6 lg:py-7 xl:px-8"}>{children}</div>;
}

export function Workspace({ route }: { route: string[] }) {
  const router = useRouter();
  const [section = "dashboard", entityId, child] = route;
  const path = `/${route.join("/")}`;
  const projectId = entityId ?? "project-001";

  let page: React.ReactNode;
  if (section === "dashboard") page = <DashboardPage />;
  else if (section === "projects" && !entityId) page = <ProjectsPage />;
  else if (section === "projects" && entityId === "new") page = <CreateProjectPage />;
  else if (section === "projects" && (!child || child === "overview")) page = <ProjectOverviewPage projectId={projectId} />;
  else if (section === "projects" && child === "documents") page = <DocumentsPage projectId={projectId} />;
  else if (section === "projects" && child === "knowledge") page = <ProjectKnowledgePage projectId={projectId} />;
  else if (section === "projects" && child === "requirements") page = <RequirementsPage projectId={projectId} />;
  else if (section === "projects" && child === "scope") page = <ProjectSection projectId={projectId} tab="scope"><ScopePage projectId={projectId} /></ProjectSection>;
  else if (section === "projects" && child === "actions") page = <ProjectSection projectId={projectId} tab="actions"><ActionsPage projectId={projectId} /></ProjectSection>;
  else if (section === "projects" && child === "meetings") page = <ProjectSection projectId={projectId} tab="meetings"><MeetingsPage projectId={projectId} /></ProjectSection>;
  else if (section === "projects" && child === "risks") page = <ProjectSection projectId={projectId} tab="risks"><RisksPage projectId={projectId} /></ProjectSection>;
  else if (section === "workflows" && entityId === "requirement-extraction") page = <StandardPage><RequirementExtractionPage onBack={() => router.push("/workflows")} onOpenReviews={() => router.push("/reviews")} /></StandardPage>;
  else if (section === "workflows") page = <StandardPage><WorkflowsPage onOpenReviews={() => router.push("/reviews")} /></StandardPage>;
  else if (section === "reviews") page = <StandardPage flush><ReviewsPage /></StandardPage>;
  else if (section === "skills") page = <StandardPage><SkillsPage initialSkillId={entityId} /></StandardPage>;
  else if (section === "knowledge") page = <StandardPage><GlobalKnowledgePage /></StandardPage>;
  else if (section === "analytics") page = <StandardPage><AnalyticsPage /></StandardPage>;
  else if (section === "settings" && entityId === "ai-models") page = <StandardPage><AIModelsPage initialProfileId={child} /></StandardPage>;
  else if (section === "settings") page = <StandardPage><SettingsPage /></StandardPage>;
  else page = <StandardPage><NotFoundPage path={path} /></StandardPage>;

  return <AppShell>{page}</AppShell>;
}
