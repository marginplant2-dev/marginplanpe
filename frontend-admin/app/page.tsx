import { redirect } from "next/navigation";
import { BrandedLogin } from "@/components/auth/BrandedLogin";

// On the tenant path-prefix build (basePath=/admin) this app root is the URL
// the tenant hits — `marginx.in/admin` — so it IS the branded admin login.
// On the platform instance (no basePath) it keeps redirecting to the panel.
export default function Index() {
  if (process.env.NEXT_PUBLIC_ADMIN_BASE_PATH) {
    return <BrandedLogin variant="admin" />;
  }
  redirect("/dashboard");
}
