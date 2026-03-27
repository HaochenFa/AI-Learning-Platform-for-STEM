import { redirect } from "next/navigation";
import { requireAuthenticatedUser } from "@/lib/activities/access";

export default async function ClassChatCompatibilityPage({
  params,
}: {
  params: Promise<{ classId: string }>;
}) {
  const { classId } = await params;
  const { supabase, user, authError, isGuest, guestRole, guestClassId } =
    await requireAuthenticatedUser();

  if (!user) {
    redirect("/login");
  }
  if (authError) {
    redirect(`/classes/${classId}?error=${encodeURIComponent(authError)}`);
  }
  if (isGuest && guestClassId && guestClassId !== classId) {
    redirect(`/classes/${guestClassId}?view=chat`);
  }
  if (isGuest) {
    if (guestRole === "teacher") {
      redirect(`/classes/${classId}#teacher-chat-monitor`);
    }
    redirect(`/classes/${classId}?view=chat`);
  }

  const { data: classRow } = await supabase
    .from("classes")
    .select("id,owner_id")
    .eq("id", classId)
    .single();

  if (!classRow) {
    redirect("/dashboard");
  }

  const { data: enrollment } = await supabase
    .from("enrollments")
    .select("role")
    .eq("class_id", classId)
    .eq("user_id", user.id)
    .single();

  const isTeacher =
    classRow.owner_id === user.id || enrollment?.role === "teacher" || enrollment?.role === "ta";
  const isMember = isTeacher || Boolean(enrollment);

  if (!isMember) {
    redirect("/dashboard");
  }

  if (isTeacher) {
    redirect(`/classes/${classId}#teacher-chat-monitor`);
  }

  redirect(`/classes/${classId}?view=chat`);
}
