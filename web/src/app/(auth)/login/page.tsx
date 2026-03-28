import AuthShell from "@/app/(auth)/AuthShell";
import AuthSurface from "@/components/auth/AuthSurface";
import type { AuthSearchParams } from "@/lib/auth/ui";

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<AuthSearchParams>;
}) {
  const resolvedSearchParams = await searchParams;

  return (
    <AuthShell>
      <AuthSurface
        mode="sign-in"
        presentation="page"
        searchParams={resolvedSearchParams}
      />
    </AuthShell>
  );
}
