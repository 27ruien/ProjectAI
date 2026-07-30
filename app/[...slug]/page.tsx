import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { requireProjectAccess } from "@/lib/auth/authorization";
import { AuthorizationError, requireAuthenticatedUser } from "@/lib/auth/session";
import { buildViewerContext } from "@/lib/auth/viewer-context";

type Props = { params: Promise<{ slug: string[] }> };

export default async function CatchAllPage({ params }: Props) {
  const { slug } = await params;
  const route = slug.length ? slug : ["projects"];
  const [section, entityId, child] = route;
  if (section === "dashboard") redirect("/projects");
  if (section === "projects" && entityId && child === "documents") redirect(`/projects/${encodeURIComponent(entityId)}/files`);
  const allowedRoot = ["projects", "chat", "company-knowledge", "organization", "settings"];
  if (!allowedRoot.includes(section)) notFound();
  if ((section === "chat" || section === "company-knowledge" || section === "organization" || section === "settings") && entityId) notFound();
  if (section === "projects" && entityId && entityId !== "new" && child && !["overview", "files", "requirements", "members"].includes(child)) notFound();
  const returnTo = `/${route.join("/")}`;
  const principal = await requireAuthenticatedUser(returnTo);
  const viewer = await buildViewerContext(principal);
  if (section === "organization" && principal.user.productRole !== "super_admin") notFound();
  if (section === "settings" && principal.user.productRole === "member") notFound();
  if (section === "projects" && entityId === "new" && !viewer.canCreateProject) notFound();
  let currentProject;
  if (section === "projects" && entityId && entityId !== "new") {
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
