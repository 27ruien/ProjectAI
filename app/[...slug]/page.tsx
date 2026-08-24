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
  const [section, entityId, child, extra] = route;
  if (section === "projects" && entityId && entityId !== "new" && !child) {
    redirect(`/projects/${encodeURIComponent(entityId)}/knowledge`);
  }
  if (!["projects", "organization", "settings"].includes(section)) notFound();
  if (extra) notFound();
  if (section === "projects") {
    if (entityId === "new" && child) notFound();
    if (entityId && entityId !== "new" && !["knowledge", "members"].includes(child ?? "")) notFound();
  }
  if (section === "organization" && entityId && !["structure", "members"].includes(entityId)) notFound();
  if (section === "settings" && entityId) notFound();

  const principal = await requireAuthenticatedUser(`/${route.join("/")}`);
  const viewer = await buildViewerContext(principal);
  if (["organization", "settings"].includes(section) && principal.user.productRole === "member") notFound();
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
