import Link from "next/link";
import { redirect } from "next/navigation";
import BrandMark from "@/app/components/BrandMark";
import { AppIcons } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createServerSupabaseClient } from "@/lib/supabase/server";

type SearchParams = {
  type?: string;
};

type Feature = {
  icon: keyof typeof AppIcons;
  title: string;
  description: string;
};

export default async function WelcomePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const accountType = resolvedSearchParams?.type ?? "teacher";

  const features: Feature[] =
    accountType === "teacher"
      ? [
          {
            icon: "upload",
            title: "Upload Materials",
            description: "Share PDFs, DOCX, and PPTX files. Our AI extracts the key concepts.",
          },
          {
            icon: "sparkles",
            title: "Generate Blueprints",
            description: "AI transforms your materials into structured course blueprints.",
          },
          {
            icon: "quiz",
            title: "Create Activities",
            description: "Generate quizzes, flashcards, and AI chat assignments from blueprints.",
          },
          {
            icon: "classes",
            title: "Assign to Students",
            description: "Share a join code so students can access AI-powered activities.",
          },
        ]
      : [
          {
            icon: "classes",
            title: "Join Classes",
            description: "Use your teacher's join code to access their class materials.",
          },
          {
            icon: "chat",
            title: "AI Chat",
            description: "Get help from an AI tutor trained on your course materials.",
          },
          {
            icon: "quiz",
            title: "Take Quizzes",
            description: "Test your knowledge with AI-generated quizzes based on class content.",
          },
          {
            icon: "flashcards",
            title: "Study Flashcards",
            description: "Review key concepts with AI-generated flashcards.",
          },
        ];

  const dashboardHref = accountType === "teacher" ? "/teacher/dashboard" : "/student/dashboard";

  return (
    <div className="min-h-screen bg-[var(--surface-muted)]">
      <div className="mx-auto flex min-h-screen max-w-4xl flex-col items-center justify-center px-6 py-16">
        <div className="w-full text-center">
          <div className="mb-8 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--foreground)] text-white shadow-lg">
              <BrandMark className="h-9 w-9" />
            </div>
          </div>

          <h1 className="text-4xl font-bold text-ui-primary">
            Welcome to Learning Platform
          </h1>
          <p className="mt-4 text-lg text-ui-muted">
            {accountType === "teacher"
              ? "Your AI-powered teaching assistant is ready."
              : "Your AI-powered learning experience awaits."}
          </p>
        </div>

        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {features.map((feature, index) => {
            const Icon = AppIcons[feature.icon];
            return (
              <Card key={index} className="flex gap-4 rounded-2xl p-6">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-muted)] text-ui-muted">
                  <Icon className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="font-semibold text-ui-primary">{feature.title}</h3>
                  <p className="mt-1 text-sm text-ui-muted">{feature.description}</p>
                </div>
              </Card>
            );
          })}
        </div>

        <div className="mt-12 flex flex-col items-center gap-4">
          <Button asChild variant="warm" size="lg">
            <Link href={dashboardHref}>Go to Dashboard</Link>
          </Button>
          <Link
            href={dashboardHref}
            className="text-sm text-ui-muted hover:text-ui-subtle"
          >
            Skip for now
          </Link>
        </div>
      </div>
    </div>
  );
}
