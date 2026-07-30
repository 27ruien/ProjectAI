import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/auth/session";
import { buildViewerContext } from "@/lib/auth/viewer-context";

type Props = { params: Promise<{ slug: string[] }> };

export default async function CatchAllPage({ params }: Props) {
  const { slug } = await params;
  const route = slug.length ? slug : ["knowledge", "projects"];
  const [section, area, entityId, child] = route;
  if (section === "dashboard") redirect("/knowledge/projects");
  if (section === "projects") redirect(`/knowledge/projects/${route.slice(1).map(encodeURIComponent).join("/")}`.replace(/\/$/u, ""));
  if (section === "chat") redirect("/knowledge/sessions");
  if (section === "company-knowledge") redirect("/knowledge/templates");
  if (section === "knowledge" && !area) redirect("/knowledge/projects");
  if (section === "knowledge" && area === "projects" && entityId && child === "documents") redirect(`/knowledge/projects/${encodeURIComponent(entityId)}/files`);
  if (section === "knowledge" && area === "projects" && entityId && child === "requirements") redirect(`/knowledge/projects/${encodeURIComponent(entityId)}/artifacts`);
  const allowedRoot = ["knowledge", "organization", "settings"];
  if (!allowedRoot.includes(section)) notFound();
  if (section === "knowledge" && !["projects", "templates", "sessions"].includes(area)) notFound();
  if (section === "knowledge" && (area === "templates" || area === "sessions") && entityId) notFound();
  if (section === "knowledge" && area === "projects" && entityId && entityId !== "new" && child && !["overview", "files", "artifacts", "members"].includes(child)) notFound();
  if ((section === "organization" || section === "settings") && area) notFound();
  const returnTo = `/${route.join("/")}`;
  const principal = await requireAuthenticatedUser(returnTo);
  const viewer = await buildViewerContext(principal);
  if (section === "organization" && principal.user.productRole !== "super_admin") notFound();
  if (section === "settings" && principal.user.productRole === "member") notFound();
  if (section === "knowledge" && area === "projects" && entityId === "new" && !viewer.canCreateProject) notFound();
  let currentProject;
  if (section === "knowledge" && area === "projects" && entityId && entityId !== "new") {
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
