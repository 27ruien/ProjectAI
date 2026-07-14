import { AccessDeniedPage } from "@/components/system/access-denied-page";

export default function NotFound() {
  return <main className="min-h-screen bg-background"><AccessDeniedPage obscureResource /></main>;
}
