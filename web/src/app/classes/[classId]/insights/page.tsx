import { redirect } from "next/navigation";
import HeaderPageShell from "@/app/components/HeaderPageShell";
import EmptyStateCard from "@/app/components/EmptyStateCard";
import { requireGuestOrVerifiedUser } from "@/lib/auth/session";
import { getClassInsights } from "@/lib/actions/insights";
import InsightsHeader from "./InsightsHeader";
import InsightsSummaryCards from "./InsightsSummaryCards";
import AIInsightPanel from "./AIInsightPanel";
import TopicPerformanceChart from "./TopicPerformanceChart";
import BloomRadarChart from "./BloomRadarChart";
import StudentEngagementScatter from "./StudentEngagementScatter";
import InterventionSuggestions from "./InterventionSuggestions";
import StudentOverviewTable from "./StudentOverviewTable";
import DataQueryPanel from "./DataQueryPanel";

export default async function ClassInsightsPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;

  const { supabase, user } = await requireGuestOrVerifiedUser({ accountType: "teacher" });

  // Verify teacher/TA access
  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,title,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/teacher/dashboard");
  }

  const isTeacher =
    classRow.owner_id === user.id ||
    enrollment?.role === "teacher" ||
    enrollment?.role === "ta";

  if (!isTeacher) {
    redirect(`/classes/${classId}`);
  }

  const result = await getClassInsights(classId);

  return (
    <HeaderPageShell
      activeNav="dashboard"
      accountType="teacher"
      maxWidthClassName="max-w-6xl"
      classContext={{ classId, isTeacher }}
      breadcrumbs={[
        { label: "Dashboard", href: "/teacher/dashboard" },
        { label: classRow.title, href: `/classes/${classId}` },
        { label: "Insights" },
      ]}
    >
      {!result.ok ? (
        <>
          <header className="mb-8 space-y-2">
            <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
            <h1 className="text-3xl font-semibold">Class Intelligence</h1>
          </header>
          <EmptyStateCard
            icon="sparkles"
            title="Could not load insights"
            description={result.error}
            primaryAction={{ label: "Go back to class", href: `/classes/${classId}` }}
          />
        </>
      ) : result.data.class_summary.is_empty ? (
        <>
          <header className="mb-8 space-y-2">
            <p className="text-sm font-medium text-ui-muted">Teacher Studio</p>
            <h1 className="text-3xl font-semibold">Class Intelligence</h1>
          </header>
          <EmptyStateCard
            icon="quiz"
            title="No quiz data yet"
            description="Publish a quiz and have students submit attempts to see AI-powered insights about your class."
            primaryAction={{ label: "Create a quiz", href: `/classes/${classId}/activities/quiz/new` }}
            secondaryAction={{ label: "View blueprint", href: `/classes/${classId}/blueprint`, variant: "outline" }}
          />
        </>
      ) : (
        <>
          <InsightsHeader classId={classId} generatedAt={result.data.generated_at} />
          <div className="page-enter space-y-6">
            <InsightsSummaryCards summary={result.data.class_summary} />

            <div className="grid grid-cols-1 gap-6 stagger-children lg:grid-cols-2">
              <AIInsightPanel narrative={result.data.ai_narrative} classId={classId} />
              {result.data.ai_narrative?.interventions.length ? (
                <InterventionSuggestions
                  classId={classId}
                  interventions={result.data.ai_narrative.interventions}
                />
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-6 stagger-children lg:grid-cols-2">
              <TopicPerformanceChart topics={result.data.topics} />
              <BloomRadarChart bloom_breakdown={result.data.bloom_breakdown} />
            </div>

            <StudentEngagementScatter students={result.data.students} />

            <StudentOverviewTable students={result.data.students} />
            <DataQueryPanel classId={classId} />
          </div>
        </>
      )}
    </HeaderPageShell>
  );
}
