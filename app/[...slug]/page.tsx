import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/auth/session";
import { buildViewerContext } from "@/lib/auth/viewer-context";

type Props = { params: Promise<{ slug: string[] }> };

export default async function CatchAllPage({ params }: Props) {
  const { slug } = await params;
  const route = slug.length ? slug : ["assistant"];
  const [section, area, entityId, child] = route;
  if (section === "dashboard") redirect("/assistant");
  if (section === "projects") redirect(`/data-spaces/projects/${route.slice(1).map(encodeURIComponent).join("/")}`.replace(/\/$/u, ""));
  if (section === "chat") redirect("/assistant");
  if (section === "company-knowledge") redirect("/data-spaces/company");
  if (section === "knowledge") redirect(`/data-spaces/${route.slice(1).map(encodeURIComponent).join("/")}`.replace(/\/$/u, ""));
  if (section === "data-spaces" && !area) redirect("/data-spaces/projects");
  if (section === "data-spaces" && area === "projects" && entityId && child === "documents") redirect(`/data-spaces/projects/${encodeURIComponent(entityId)}/files`);
  if (section === "data-spaces" && area === "projects" && entityId && child === "requirements") redirect(`/data-spaces/projects/${encodeURIComponent(entityId)}/artifacts`);
  const allowedRoot = ["assistant", "data-spaces", "organization", "settings"];
  if (!allowedRoot.includes(section)) notFound();
  if (section === "assistant" && area) notFound();
  if (section === "data-spaces" && !["projects", "company"].includes(area)) notFound();
  if (section === "data-spaces" && area === "company" && entityId) notFound();
  if (section === "data-spaces" && area === "projects" && entityId && entityId !== "new" && child && !["overview", "files", "artifacts", "members"].includes(child)) notFound();
  if (section === "organization" && area) notFound();
  if (section === "settings" && area && area !== "ai-models") notFound();
  const returnTo = `/${route.join("/")}`;
  const principal = await requireAuthenticatedUser(returnTo);
  const viewer = await buildViewerContext(principal);
  if (section === "organization" && principal.user.productRole !== "super_admin") notFound();
  if (section === "settings" && principal.user.productRole === "member") notFound();
  if (section === "data-spaces" && area === "projects" && entityId === "new" && !viewer.canCreateProject) notFound();
  let currentProject;
  if (section === "data-spaces" && area === "projects" && entityId && entityId !== "new") {
    try {
      const authorized = await requireProjectAccess(principal, entityId, await headers());
      currentProject = viewer.projects.find((item) => item.id === authorized.id);
      if (!currentProject) notFound();
    } catch (error) {
      if (error instanceof AuthorizationError && error.status === 404) notFound();
      throw error;
    }
  }
  return <Workspace route={route} viewer={viewer} currentProject={currentProject} />;
}
