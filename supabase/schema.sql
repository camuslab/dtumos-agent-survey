-- DTUMOS Agent 벤치마크 문항 전문가 검토 — 응답 저장소
--
-- Supabase 대시보드의 SQL Editor에 통째로 붙여 넣고 한 번 실행한다. 여러 번 실행해도 된다.
--
-- 권한 설계
--   설문 페이지는 공개용 키(anon / publishable)로 접속한다. 이 키는 페이지 소스에 그대로 보이므로
--   "응답 한 행 추가"만 허용하고 조회·수정·삭제는 모두 막는다.
--   응답 열람과 내려받기는 대시보드(Table Editor, SQL Editor)에서 한다.

create table if not exists public.survey_responses (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),   -- 서버가 받은 시각
  survey_id       text not null,
  survey_version  text not null,                        -- 문항 구성 판. survey-content.js의 version
  respondent_id   uuid not null,                        -- 브라우저가 만든 무작위 번호. 개인을 식별하지 않는다
  revision        integer not null default 1,           -- 같은 응답자의 몇 번째 제출인지
  invite_code     text,                                 -- 주소에 ?code=… 를 붙여 보낸 경우에만 기록
  started_at      timestamptz,                          -- 첫 입력 시각 (응답자 기기 기준)
  submitted_at    timestamptz,                          -- 제출 시각 (응답자 기기 기준)
  answers         jsonb not null,

  constraint survey_responses_survey_id_check
    check (survey_id = 'dtumos-agent-benchmark-expert-review'),
  constraint survey_responses_version_check
    check (char_length(survey_version) between 1 and 40),
  constraint survey_responses_revision_check
    check (revision between 1 and 50),
  constraint survey_responses_invite_code_check
    check (invite_code is null or invite_code ~ '^[A-Za-z0-9_-]{1,40}$'),
  constraint survey_responses_answers_check
    check (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 100000)
);

create index if not exists survey_responses_respondent_idx
  on public.survey_responses (respondent_id, created_at desc);

-- 행 수준 보안: 정책이 없는 동작은 모두 거부된다.
alter table public.survey_responses enable row level security;

drop policy if exists "survey page can add a response" on public.survey_responses;
create policy "survey page can add a response"
  on public.survey_responses
  for insert
  to anon, authenticated
  with check (true);
-- select / update / delete 정책은 일부러 만들지 않는다.

revoke all on public.survey_responses from anon, authenticated;
grant insert on public.survey_responses to anon, authenticated;


-- ---------------------------------------------------------------------------
-- 분석용 보기. 대시보드에서만 쓴다 (공개용 키로는 읽을 수 없다).
-- security_invoker = true 이므로 보기를 통해서도 위의 행 수준 보안이 그대로 적용된다.
-- ---------------------------------------------------------------------------

-- 응답자마다 마지막 제출본 한 행
create or replace view public.survey_responses_latest
with (security_invoker = true) as
select distinct on (respondent_id) *
from public.survey_responses
order by respondent_id, revision desc, created_at desc;

-- 보기의 열 구성이 바뀔 수 있으므로 지우고 다시 만든다 (의존 순서의 역순)
drop view if exists public.survey_item_summary;
drop view if exists public.survey_item_ratings;

-- 4부: 응답자 × 문항. 평가는 4점 척도(1 전혀 아니다 ~ 4 매우 그렇다)
create view public.survey_item_ratings
with (security_invoker = true) as
select
  r.respondent_id,
  r.answers -> 'p1' ->> 'field'           as respondent_field,
  (i.key)::int                            as item_no,
  (i.value ->> 'realistic')::int          as realistic,     -- 1~4 또는 null
  (i.value ->> 'expected_ok')::int        as expected_ok,   -- 1~4 또는 null
  nullif(i.value ->> 'comment', '')       as comment
from public.survey_responses_latest r
cross join lateral jsonb_each(r.answers -> 'items') as i(key, value);

-- 4부: 문항별 집계.
-- *_agreement는 답한 사람 가운데 3점 이상을 준 비율이다 (문항 내용 타당도 지수 I-CVI와 같은 계산).
create view public.survey_item_summary
with (security_invoker = true) as
select
  item_no,
  count(realistic)                                                   as n_realistic,
  round(avg(realistic), 2)                                           as realistic_mean,
  round(count(*) filter (where realistic >= 3)::numeric
        / nullif(count(realistic), 0), 2)                            as realistic_agreement,
  count(expected_ok)                                                 as n_expected,
  round(avg(expected_ok), 2)                                         as expected_mean,
  round(count(*) filter (where expected_ok >= 3)::numeric
        / nullif(count(expected_ok), 0), 2)                          as expected_agreement,
  count(comment)                                                     as n_comments
from public.survey_item_ratings
group by item_no
order by item_no;

revoke all on public.survey_responses_latest from anon, authenticated;
revoke all on public.survey_item_ratings     from anon, authenticated;
revoke all on public.survey_item_summary     from anon, authenticated;
