import { AppShell } from "./ui/app-shell";
import { isOwner } from "@/src/lib/auth";
import { LoginForm } from "./ui/login-form";
export const dynamic = "force-dynamic";
export default async function Home() {
    const demo = process.env.DEMO_MODE === "true";
    if (!demo && !(await isOwner()))
        return <LoginForm configured={Boolean(process.env.OWNER_PASSWORD_HASH && (process.env.SESSION_SECRET?.length||0)>=32)}/>;
    return <AppShell live={!demo}/>;
}
