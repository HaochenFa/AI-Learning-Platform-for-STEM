-- Remove legacy publish_blueprint overload that allowed spoofing published_by.
drop function if exists public.publish_blueprint(uuid, uuid, uuid);
