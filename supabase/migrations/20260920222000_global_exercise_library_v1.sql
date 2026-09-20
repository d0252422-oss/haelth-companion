-- Canonical shared exercise library. Custom exercise rows remain owner-scoped.
create or replace function private.exercise_normalized_name(p_name text)
returns text language sql immutable strict parallel safe set search_path='' as $$
  select lower(regexp_replace(normalize(btrim(p_name), NFC), '[[:space:]]+', ' ', 'g'))
$$;
revoke all on function private.exercise_normalized_name(text) from public,anon,authenticated;
grant execute on function private.exercise_normalized_name(text) to service_role,health_manual_api;

do $constraints$
begin
  if not exists(select 1 from pg_constraint where conname='manual_exercise_global_id_format' and conrelid='public.manual_exercise_catalog'::regclass) then
    alter table public.manual_exercise_catalog add constraint manual_exercise_global_id_format
      check(owner_user_id is not null or exercise_id ~ '^global:[a-z0-9]+(-[a-z0-9]+)*$');
  end if;
  if not exists(select 1 from pg_constraint where conname='manual_exercise_global_category' and conrelid='public.manual_exercise_catalog'::regclass) then
    alter table public.manual_exercise_catalog add constraint manual_exercise_global_category
      check(owner_user_id is not null or muscle_group in ('CHEST','BACK','SHOULDERS','BICEPS','TRICEPS','LEGS','GLUTES','CORE','CARDIO','FULL_BODY','OTHER'));
  end if;
end $constraints$;

create unique index if not exists manual_exercise_global_normalized_name_unique
  on public.manual_exercise_catalog(private.exercise_normalized_name(exercise_name))
  where owner_user_id is null;
create unique index if not exists manual_exercise_owner_normalized_name_unique
  on public.manual_exercise_catalog(owner_user_id,private.exercise_normalized_name(exercise_name))
  where owner_user_id is not null;

create temporary table global_exercise_seed_v1(
  exercise_id text primary key,
  exercise_name text not null,
  muscle_group text not null
) on commit drop;

insert into global_exercise_seed_v1(exercise_id,exercise_name,muscle_group) values
('global:barbell-bench-press','槓鈴臥推','CHEST'),
('global:dumbbell-bench-press','啞鈴臥推','CHEST'),
('global:incline-barbell-bench-press','上斜槓鈴臥推','CHEST'),
('global:incline-dumbbell-bench-press','上斜啞鈴臥推','CHEST'),
('global:chest-press-machine','胸推機','CHEST'),
('global:pec-deck-fly','飛鳥機','CHEST'),
('global:cable-chest-fly','滑輪夾胸','CHEST'),
('global:push-up','伏地挺身','CHEST'),
('global:lat-pulldown','滑輪下拉','BACK'),
('global:pull-up','引體向上','BACK'),
('global:barbell-row','槓鈴划船','BACK'),
('global:dumbbell-row','啞鈴划船','BACK'),
('global:seated-cable-row','坐姿划船','BACK'),
('global:t-bar-row','T 槓划船','BACK'),
('global:straight-arm-pulldown','直臂下拉','BACK'),
('global:reverse-fly','反向飛鳥','BACK'),
('global:barbell-overhead-press','槓鈴肩推','SHOULDERS'),
('global:dumbbell-shoulder-press','啞鈴肩推','SHOULDERS'),
('global:shoulder-press-machine','肩推機','SHOULDERS'),
('global:dumbbell-lateral-raise','啞鈴側平舉','SHOULDERS'),
('global:cable-lateral-raise','滑輪側平舉','SHOULDERS'),
('global:dumbbell-front-raise','啞鈴前平舉','SHOULDERS'),
('global:face-pull','面拉','SHOULDERS'),
('global:bent-over-lateral-raise','俯身側平舉','SHOULDERS'),
('global:barbell-curl','槓鈴彎舉','BICEPS'),
('global:dumbbell-curl','啞鈴彎舉','BICEPS'),
('global:hammer-curl','槌式彎舉','BICEPS'),
('global:preacher-curl','牧師椅彎舉','BICEPS'),
('global:cable-curl','滑輪彎舉','BICEPS'),
('global:rope-pushdown','繩索下壓','TRICEPS'),
('global:straight-bar-pushdown','直桿下壓','TRICEPS'),
('global:overhead-triceps-extension','過頭三頭伸展','TRICEPS'),
('global:close-grip-bench-press','窄握臥推','TRICEPS'),
('global:parallel-bar-dip','雙槓撐體','TRICEPS'),
('global:barbell-back-squat','槓鈴深蹲','LEGS'),
('global:front-squat','前蹲','LEGS'),
('global:leg-press','腿推','LEGS'),
('global:leg-extension','腿伸展','LEGS'),
('global:leg-curl','腿彎舉','LEGS'),
('global:romanian-deadlift','羅馬尼亞硬舉','LEGS'),
('global:conventional-deadlift','傳統硬舉','LEGS'),
('global:lunge','弓箭步','LEGS'),
('global:bulgarian-split-squat','保加利亞分腿蹲','LEGS'),
('global:calf-raise','小腿提踵','LEGS'),
('global:hip-thrust','臀推','GLUTES'),
('global:glute-bridge','臀橋','GLUTES'),
('global:cable-glute-kickback','滑輪後踢','GLUTES'),
('global:hip-abduction-machine','髖外展機','GLUTES'),
('global:plank','棒式','CORE'),
('global:crunch','捲腹','CORE'),
('global:sit-up','仰臥起坐','CORE'),
('global:hanging-leg-raise','懸垂抬腿','CORE'),
('global:russian-twist','俄羅斯轉體','CORE'),
('global:cable-woodchop','滑輪伐木','CORE'),
('global:treadmill','跑步機','CARDIO'),
('global:stationary-bike','室內腳踏車','CARDIO'),
('global:elliptical','橢圓機','CARDIO'),
('global:rowing-machine','划船機','CARDIO'),
('global:stair-climber','登階機','CARDIO'),
('global:kettlebell-swing','壺鈴擺盪','FULL_BODY'),
('global:burpee','波比跳','FULL_BODY');

insert into public.manual_exercise_catalog(exercise_id,owner_user_id,exercise_name,muscle_group)
select exercise_id,null,exercise_name,muscle_group from global_exercise_seed_v1
on conflict(exercise_id) do nothing;

do $validate$
begin
  if (select count(*) from global_exercise_seed_v1)<>61 then raise exception 'GLOBAL_EXERCISE_V1_COUNT_INVALID'; end if;
  if exists(
    select 1 from global_exercise_seed_v1 s
    left join public.manual_exercise_catalog c using(exercise_id)
    where c.exercise_id is null or c.owner_user_id is not null
      or c.exercise_name is distinct from s.exercise_name
      or c.muscle_group is distinct from s.muscle_group
  ) then raise exception 'GLOBAL_EXERCISE_V1_CONFLICT'; end if;
end $validate$;

comment on function private.exercise_normalized_name(text) is 'NFC, trimmed, case-insensitive, whitespace-collapsed exercise name key.';
comment on index public.manual_exercise_global_normalized_name_unique is 'Canonical global exercise names are unique after normalization.';
comment on index public.manual_exercise_owner_normalized_name_unique is 'Each owner has unique custom exercise names after normalization; cross-owner duplicates remain allowed.';
