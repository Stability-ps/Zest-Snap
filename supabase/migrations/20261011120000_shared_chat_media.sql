-- Private Shared chat attachments and voice notes.
alter table public.shared_plan_messages add column if not exists attachment jsonb;
alter table public.shared_plan_messages drop constraint if exists shared_plan_messages_attachment_shape;
alter table public.shared_plan_messages add constraint shared_plan_messages_attachment_shape check (
 attachment is null or (
   attachment ? 'path' and attachment ? 'kind' and attachment ? 'name'
   and attachment->>'kind' in ('photo','file','voice')
   and char_length(attachment->>'path') between 1 and 500
   and char_length(attachment->>'name') between 1 and 255
 )
);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('shared-chat','shared-chat',false,25000000,array[
 'image/jpeg','image/png','image/webp','image/heic','image/heif',
 'application/pdf','text/plain','text/csv',
 'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'audio/webm','audio/mp4','audio/mpeg','audio/ogg','audio/wav'
])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists shared_chat_objects_read on storage.objects;
create policy shared_chat_objects_read on storage.objects for select to authenticated
using (bucket_id='shared-chat' and private.is_shared_plan_member(((storage.foldername(name))[1])::uuid,null));

drop policy if exists shared_chat_objects_insert on storage.objects;
create policy shared_chat_objects_insert on storage.objects for insert to authenticated
with check (
 bucket_id='shared-chat'
 and (storage.foldername(name))[2]=(select auth.uid())::text
 and private.is_shared_plan_member(((storage.foldername(name))[1])::uuid,null)
);

drop policy if exists shared_chat_objects_delete on storage.objects;
create policy shared_chat_objects_delete on storage.objects for delete to authenticated
using (
 bucket_id='shared-chat'
 and (storage.foldername(name))[2]=(select auth.uid())::text
 and private.is_shared_plan_member(((storage.foldername(name))[1])::uuid,null)
);