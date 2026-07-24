import { redirect } from "next/navigation";

type HomeProps = {
  searchParams: Promise<{ debug?: string | string[] }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const debug = Array.isArray(params.debug) ? params.debug[0] : params.debug;
  if (debug === "admin") {
    redirect("/login?debug=admin&returnTo=%2Fdaily-report");
  }
  redirect("/daily-report");
}
