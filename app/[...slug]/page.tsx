import { Workspace } from "@/components/workspace";

type CatchAllPageProps = {
  params: Promise<{ slug: string[] }>;
};

export default async function CatchAllPage({ params }: CatchAllPageProps) {
  const { slug } = await params;
  return <Workspace route={slug} />;
}
