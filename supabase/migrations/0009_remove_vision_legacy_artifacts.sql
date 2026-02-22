-- Retire legacy vision/OCR processing artifacts after moving to text-only ingestion.

-- 1) Normalize any legacy material status that depended on vision fallback.
update public.materials
set
  status = 'failed',
  metadata = case
    when coalesce(coalesce(metadata, '{}'::jsonb)->'warnings', '[]'::jsonb)
      @> jsonb_build_array('Vision/OCR extraction has been retired. Upload PDF, DOCX, or PPTX.')
      then coalesce(metadata, '{}'::jsonb)
    else coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'warnings',
      coalesce(coalesce(metadata, '{}'::jsonb)->'warnings', '[]'::jsonb)
        || jsonb_build_array('Vision/OCR extraction has been retired. Upload PDF, DOCX, or PPTX.')
    )
  end
where status = concat('needs', '_vision');

-- 2) Remove vision/OCR metadata keys if they exist.
update public.materials
set metadata = coalesce(metadata, '{}'::jsonb)
  - 'vision'
  - 'ocr'
  - 'vision_provider'
  - 'vision_model'
  - 'vision_prompt'
  - 'ocr_stats'
  - 'ocr_confidence'
where coalesce(metadata, '{}'::jsonb) ?| array[
  'vision',
  'ocr',
  'vision_provider',
  'vision_model',
  'vision_prompt',
  'ocr_stats',
  'ocr_confidence'
];

-- 3) Normalize legacy chunk extraction methods.
update public.material_chunks
set extraction_method = 'text'
where extraction_method in ('vision', 'ocr');

-- 4) Clean any legacy queue stage/status marker left by retired vision fallback.
update public.material_processing_jobs
set
  status = 'failed',
  stage = 'failed',
  locked_at = null,
  last_error = coalesce(
    nullif(last_error, ''),
    'Vision/OCR extraction has been retired. Upload PDF, DOCX, or PPTX.'
  )
where status = concat('needs', '_vision') or stage = concat('needs', '_vision');

-- 5) Remove optional Vault secrets that were only used by vision/OCR behavior.
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'vault'
      and table_name = 'secrets'
  ) then
    delete from vault.secrets
    where lower(name) = any (array[
      'openai_vision_model',
      'openrouter_vision_model',
      'gemini_vision_model',
      'vision_page_concurrency',
      'min_text_for_vision_fallback',
      'max_vision_bytes',
      'ocr_language',
      'ocr_max_pdf_pages',
      'ocr_min_text_length',
      'ocr_short_text_confidence'
    ]::text[]);
  end if;
end
$$;
