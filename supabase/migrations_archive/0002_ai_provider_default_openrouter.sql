-- Update default AI provider for new classes
alter table classes
  alter column ai_provider set default 'openrouter';
