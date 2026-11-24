#!/usr/bin/env bash
# supabase/schema.sql 을 임시 PostgreSQL에 올려 권한이 의도대로인지 확인한다.
# Supabase의 역할(anon, authenticated)을 흉내 내어, 공개용 키로는 추가만 되고
# 조회·수정·삭제와 분석용 보기 접근은 막히는지 본다. 실제 Supabase에는 접속하지 않는다.
#
# 필요: PostgreSQL 서버 실행 파일(initdb, pg_ctl). root로 실행하면 postgres 계정으로 바꿔 실행한다.
#   bash tests/schema_check.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCHEMA="$HERE/../supabase/schema.sql"
BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$BIN" ] && PATH="$BIN:$PATH"
command -v initdb >/dev/null || { echo "initdb가 없습니다. PostgreSQL 서버를 설치해 주십시오."; exit 2; }

if [ "$(id -u)" = "0" ]; then
  WORK="$(mktemp -d)"; cp "$SCHEMA" "$0" "$WORK/"; chmod -R a+rX "$WORK"
  exec runuser -u postgres -- env SCHEMA_OVERRIDE="$WORK/schema.sql" bash "$WORK/$(basename "$0")"
fi
SCHEMA="${SCHEMA_OVERRIDE:-$SCHEMA}"

DATA="$(mktemp -d)"; PORT=54329
trap 'pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA"' EXIT
initdb -D "$DATA" -A trust -U postgres >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -c listen_addresses='' -k $DATA" -w start >/dev/null
P() { psql -h "$DATA" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

P -c "create role anon nologin; create role authenticated nologin;"
# Supabase는 public 스키마의 새 객체에 anon 권한을 기본으로 준다. 같은 조건에서 확인한다.
P -c "grant usage on schema public to anon, authenticated;
      alter default privileges in schema public grant all on tables to anon, authenticated;"
P -f "$SCHEMA"
P -f "$SCHEMA"   # 두 번 실행해도 되어야 한다

ROW="'dtumos-agent-benchmark-expert-review','v1','11111111-1111-4111-8111-111111111111'"
ITEMS='{"p1":{"field":"교통계획"},"items":{"1":{"realistic":4,"expected_ok":2,"comment":"범위 명시"},"2":{"realistic":3,"expected_ok":null,"comment":""}}}'

fail=0
expect_ok()   { if P -c "set role anon; $2" >/dev/null 2>&1; then echo "ok    $1"; else echo "FAIL  $1 (거부됨)"; fail=1; fi; }
expect_deny() { if P -c "set role anon; $2" >/dev/null 2>&1; then echo "FAIL  $1 (허용됨)"; fail=1; else echo "ok    $1"; fi; }

expect_ok   "공개용 키: 응답 추가"            "insert into survey_responses (survey_id, survey_version, respondent_id, revision, answers) values ($ROW, 1, '$ITEMS');"
expect_ok   "공개용 키: 수정본 추가"          "insert into survey_responses (survey_id, survey_version, respondent_id, revision, invite_code, answers) values ($ROW, 2, 'pilot-01', '$ITEMS');"
expect_deny "공개용 키: 조회 불가"            "select count(*) from survey_responses;"
expect_deny "공개용 키: 추가 후 되읽기 불가"  "insert into survey_responses (survey_id, survey_version, respondent_id, answers) values ($ROW, '{}') returning id;"
expect_deny "공개용 키: 수정 불가"            "update survey_responses set answers = '{}';"
expect_deny "공개용 키: 삭제 불가"            "delete from survey_responses;"
expect_deny "공개용 키: 분석용 보기 불가"     "select * from survey_item_summary;"
expect_deny "공개용 키: 최신본 보기 불가"     "select * from survey_responses_latest;"
expect_deny "다른 설문 이름 거부"             "insert into survey_responses (survey_id, survey_version, respondent_id, answers) values ('other','v1','11111111-1111-4111-8111-111111111111','{}');"
expect_deny "객체가 아닌 응답 거부"           "insert into survey_responses (survey_id, survey_version, respondent_id, answers) values ($ROW, '[1,2]');"
expect_deny "지나치게 큰 응답 거부"           "insert into survey_responses (survey_id, survey_version, respondent_id, answers) select $ROW, jsonb_build_object('x', string_agg(md5(g::text), '')) from generate_series(1, 20000) g;"
expect_deny "형식에 맞지 않는 초대 코드 거부" "insert into survey_responses (survey_id, survey_version, respondent_id, invite_code, answers) values ($ROW, 'a b;c', '{}');"

n="$(P -c "select count(*) from survey_responses;")"
latest="$(P -c "select count(*) || '/' || max(revision) from survey_responses_latest;")"
summary="$(P -c "select item_no || ':' || realistic_mean || ':' || realistic_agreement || ':' || coalesce(expected_agreement::text, '-') || ':' || n_comments from survey_item_summary order by item_no;" | paste -sd' ')"
[ "$n" = "2" ]              && echo "ok    관리자: 저장된 행 2개" || { echo "FAIL  행 수 $n"; fail=1; }
[ "$latest" = "1/2" ]       && echo "ok    관리자: 응답자당 마지막 제출본만 집계" || { echo "FAIL  최신본 $latest"; fail=1; }
[ "$summary" = "1:4.00:1.00:0.00:1 2:3.00:1.00:-:0" ] && echo "ok    관리자: 문항별 집계 ($summary)" || { echo "FAIL  집계 $summary"; fail=1; }

[ "$fail" = "0" ] && echo "모든 확인 통과" || { echo "실패한 확인이 있습니다"; exit 1; }
