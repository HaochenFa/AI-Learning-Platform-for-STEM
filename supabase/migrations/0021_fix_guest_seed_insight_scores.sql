-- Fix guest seed insight scores: convert whole-number percentages to 0-1 decimals.
-- The frontend pct() helper does `Math.round(value * 100)` so values must be 0-1.
-- Original migration 0016 stored them as 89, 100, 84, 75 etc.

update public.class_insights_snapshots
set payload = jsonb_set(
  jsonb_set(
    jsonb_set(
      jsonb_set(
        jsonb_set(
          jsonb_set(
            payload,
            -- class_summary.avg_score: 89 -> 0.89
            '{class_summary,avg_score}', '0.89'::jsonb
          ),
          -- class_summary.completion_rate: 100 -> 1.0
          '{class_summary,completion_rate}', '1.0'::jsonb
        ),
        -- topics[0].avg_score: 100 -> 1.0
        '{topics,0,avg_score}', '1.0'::jsonb
      ),
      -- topics[1].avg_score: 84 -> 0.84
      '{topics,1,avg_score}', '0.84'::jsonb
    ),
    -- students[0].avg_score: 89 -> 0.89
    '{students,0,avg_score}', '0.89'::jsonb
  ),
  -- students[0].completion_rate: 100 -> 1.0
  '{students,0,completion_rate}', '1.0'::jsonb
)
where sandbox_id is not null;

-- Also fix activity_breakdown scores inside students[0]
update public.class_insights_snapshots
set payload = jsonb_set(
  jsonb_set(
    payload,
    -- students[0].activity_breakdown[0].score: 100 -> 1.0
    '{students,0,activity_breakdown,0,score}', '1.0'::jsonb
  ),
  -- students[0].activity_breakdown[1].score: 75 -> 0.75
  '{students,0,activity_breakdown,1,score}', '0.75'::jsonb
)
where sandbox_id is not null;
