-- Prevent duplicate question slots when draft edits update by activity/order index.
create unique index if not exists quiz_questions_activity_order_index_unique
on quiz_questions(activity_id, order_index);

-- Guard quiz attempts from duplicate attempt numbers under concurrent submissions.
create unique index if not exists submissions_quiz_attempt_number_unique
on submissions (
  assignment_id,
  student_id,
  (
    case
      when (content ->> 'attemptNumber') ~ '^[0-9]+$'
        then (content ->> 'attemptNumber')::int
      else null
    end
  )
)
where (content ->> 'mode') = 'quiz_attempt';

-- Improve paginated assignment review queries.
create index if not exists assignment_recipients_assignment_assigned_at_idx
on assignment_recipients(assignment_id, assigned_at);

create index if not exists submissions_assignment_student_submitted_at_idx
on submissions(assignment_id, student_id, submitted_at);
