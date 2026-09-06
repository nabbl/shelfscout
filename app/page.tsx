import { AppShell } from "./ui/app-shell";
import { isOwner } from "@/src/lib/auth";
import { LoginForm } from "./ui/login-form";

export const dynamic="force-dynamic";
export default async function Home() {
  const demo=process.env.DEMO_MODE==="true"||process.env.NODE_ENV==="development";
  if(!demo&&!(await isOwner()))return <LoginForm configured={Boolean(process.env.OWNER_PASSWORD_HASH)}/>;
  return <AppShell live={!demo}/>;
}
