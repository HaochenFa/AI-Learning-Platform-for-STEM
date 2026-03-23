-- Class teaching brief snapshots: cached AI-synthesized teaching brief payload per class.

CREATE TABLE IF NOT EXISTS class_teaching_brief_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  generated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('empty', 'ready', 'generating', 'error', 'no_data')),
  payload jsonb,
  error_message text,
  UNIQUE (class_id)
);

ALTER TABLE class_teaching_brief_snapshots ENABLE ROW LEVEL SECURITY;

-- Teachers and TAs of the class can read snapshots.
CREATE POLICY "class_teaching_brief_snapshots_select" ON class_teaching_brief_snapshots
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM enrollments
      WHERE enrollments.class_id = class_teaching_brief_snapshots.class_id
        AND enrollments.user_id = public.requesting_user_id()
        AND enrollments.role IN ('teacher', 'ta')
    )
  );

-- Only the service role (backend) can insert/update snapshots.
-- No user-facing write policy is created intentionally.
