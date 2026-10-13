-- Caller-scoped checks stay in function bodies; definer matches existing RPC error helpers.

alter function public.list_coach_campaigns(text,text,public.campaign_stage,text,integer) security definer;
alter function public.get_coach_campaign_context(uuid) security definer;
alter function public.list_coach_roster(uuid,text,text,text,text,integer) security definer;
alter function public.get_coach_player_context(uuid,uuid,text,text,text) security definer;
alter function public.get_coach_roster_neighbors(uuid,uuid,text,text,text) security definer;
alter function public.list_coach_feedback_history(uuid,uuid,text,text,text,integer) security definer;
alter function public.get_coach_feedback_entry(uuid,uuid,uuid) security definer;
