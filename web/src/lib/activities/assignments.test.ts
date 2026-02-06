import { describe, expect, it, vi } from "vitest";
import { createWholeClassAssignment } from "@/lib/activities/assignments";

function makeBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};
  const resolveResult = () => result;
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(async () => resolveResult());
  builder.insert = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.then = (
    onFulfilled: (value: unknown) => unknown,
    onRejected: (reason: unknown) => unknown,
  ) => Promise.resolve(resolveResult()).then(onFulfilled, onRejected);
  return builder as unknown as {
    select: () => typeof builder;
    eq: () => typeof builder;
    single: () => Promise<unknown>;
    insert: () => typeof builder;
    delete: () => typeof builder;
    then: (
      onFulfilled: (value: unknown) => unknown,
      onRejected: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  };
}

describe("createWholeClassAssignment", () => {
  it("rolls back assignment creation when recipients insert fails", async () => {
    const fromMock = vi.fn();
    const assignmentInsertBuilder = makeBuilder({ data: { id: "assignment-1" }, error: null });
    const studentsBuilder = makeBuilder({
      data: [{ user_id: "student-1" }, { user_id: "student-2" }],
      error: null,
    });
    const recipientsBuilder = makeBuilder({ error: { message: "recipient insert failed" } });
    const rollbackBuilder = makeBuilder({ error: null });

    let assignmentsCalls = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "assignments") {
        assignmentsCalls += 1;
        return assignmentsCalls === 1 ? assignmentInsertBuilder : rollbackBuilder;
      }
      if (table === "enrollments") {
        return studentsBuilder;
      }
      if (table === "assignment_recipients") {
        return recipientsBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    await expect(
      createWholeClassAssignment({
        supabase: { from: fromMock } as never,
        classId: "class-1",
        activityId: "activity-1",
        teacherId: "teacher-1",
        dueAt: null,
      }),
    ).rejects.toThrow("recipient insert failed");

    expect(rollbackBuilder.delete).toHaveBeenCalled();
    expect(rollbackBuilder.eq).toHaveBeenCalledWith("id", "assignment-1");
  });

  it("rolls back assignment creation when student lookup fails", async () => {
    const fromMock = vi.fn();
    const assignmentInsertBuilder = makeBuilder({ data: { id: "assignment-1" }, error: null });
    const studentsBuilder = makeBuilder({ data: null, error: { message: "student lookup failed" } });
    const rollbackBuilder = makeBuilder({ error: null });

    let assignmentsCalls = 0;
    fromMock.mockImplementation((table: string) => {
      if (table === "assignments") {
        assignmentsCalls += 1;
        return assignmentsCalls === 1 ? assignmentInsertBuilder : rollbackBuilder;
      }
      if (table === "enrollments") {
        return studentsBuilder;
      }
      return makeBuilder({ data: null, error: null });
    });

    await expect(
      createWholeClassAssignment({
        supabase: { from: fromMock } as never,
        classId: "class-1",
        activityId: "activity-1",
        teacherId: "teacher-1",
        dueAt: null,
      }),
    ).rejects.toThrow("student lookup failed");

    expect(rollbackBuilder.delete).toHaveBeenCalled();
    expect(rollbackBuilder.eq).toHaveBeenCalledWith("id", "assignment-1");
  });
});
