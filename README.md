# DTUMOS Agent 벤치마크 문항 전문가 검토 설문

벤치마크 문항을 확정하기 전에 전문가에게 문항의 현실성과 기대 행동의 적절성을 묻는 웹 설문이다. 빌드 과정이 없는 정적 페이지이고, 제출한 응답은 Supabase 테이블에 한 행씩 쌓인다.

## 구성

| 경로 | 내용 |
| --- | --- |
| `docs/index.html` | 표지와 페이지 뼈대 |
| `docs/survey-content.js` | 설문 문구 전체. **문항을 고칠 때는 이 파일만 수정한다** |
| `docs/app.js` | 화면 구성, 임시 저장, 제출 |
| `docs/config.js` | Supabase 주소와 공개용 키 |
| `docs/styles.css`, `docs/flow.js`, `docs/assets/` | 모양, 표지 배경 |
| `docs/sim-map.js`, `docs/vendor/` | 소개의 시뮬레이션 화면(지도 위 재생)과 지도 라이브러리 |
| `supabase/schema.sql` | 테이블, 권한, 분석용 보기 |
| `tests/e2e.cjs`, `tests/schema_check.sh` | 화면 동작과 권한 확인 |

## 미리 보기

```bash
python3 -m http.server 8765 --directory docs
```

브라우저에서 `http://localhost:8765`를 연다. `config.js`가 비어 있으면 미리보기 모드로 동작하고, 제출하면 응답이 JSON 파일로 내려받아진다.

## Supabase 연결

1. Supabase 프로젝트를 만들고, SQL Editor에 `supabase/schema.sql`을 붙여 넣어 실행한다.
2. 프로젝트의 API 설정에서 프로젝트 주소와 공개용 키(anon 또는 publishable)를 복사해 `docs/config.js`의 `supabaseUrl`, `supabaseKey`에 넣는다. `contact`에는 제출 오류 때 안내할 연락처를 넣는다.
3. 페이지를 열어 한 번 제출해 보고, 대시보드 Table Editor의 `survey_responses`에 행이 생겼는지 확인한 뒤 시험 행을 지운다.

공개용 키는 페이지 소스에 그대로 보인다. `schema.sql`은 이 키로 **응답 추가만** 할 수 있게 하고 조회·수정·삭제는 막는다. service_role(secret) 키는 어디에도 넣지 않는다.

## 배포

GitHub Pages로 배포한다. 저장소의 Settings → Pages에서 Source를 "Deploy from a branch", 브랜치를 `main`, 폴더를 `/docs`로 정하면 `main`에 푸시할 때마다 `docs/`가 그대로 올라간다. 폴더 안의 상대 경로만 쓰므로 다른 정적 호스팅에 올려도 된다.

응답자에게 보내는 주소 끝에 `?code=…`를 붙이면 그 값이 `invite_code` 열에 기록된다. 예: `https://…/index.html?code=A01`. 누가 응답했는지 구분해야 할 때만 쓴다. 코드를 붙이지 않으면 응답은 무작위 번호(`respondent_id`)로만 구분된다.

## 응답 확인

대시보드 SQL Editor에서 본다.

```sql
-- 응답자마다 마지막 제출본
select created_at, invite_code, answers -> 'p1' as respondent, answers from survey_responses_latest;

-- 4부: 문항별 평균, 3점 이상 비율, 의견 수
select * from survey_item_summary;

-- 4부: 고칠 점으로 적힌 의견
select item_no, respondent_field, realistic, expected_ok, comment
from survey_item_ratings where comment is not null order by item_no;
```

같은 응답자가 수정해 다시 제출하면 새 행이 추가되고 `revision`이 올라간다. 분석에는 `survey_responses_latest`를 쓴다.

### 저장 형식 (`answers`)

| 키 | 내용 |
| --- | --- |
| `p1` | 1부. `field`, `years`, `sim_experience`(none / use_results / run_directly), `tools`, `ai_experience`(none / sometimes / often) |
| `q1`, `q8` | `selected`(고른 항목 번호), `ranks`(`{"1": 항목 번호, "2": …, "3": …}`), `other`(기타 내용) |
| `q2` | `ranks`, `other` |
| `q3` | 시뮬레이션으로 답을 얻고 싶은 운영 질문. `selected`(고른 질문 번호 1~13, `survey-content.js`에 적힌 순서), `other` |
| `items` | 4부. 문항 번호마다 `realistic`, `expected_ok`(1~4 또는 null. 1 전혀 아니다, 2 아니다, 3 그렇다, 4 매우 그렇다), `comment` |
| `q7` | 조건마다 must_ask / assume_disclose / agent_decides. 키는 region, date, time_window, service_type, fleet_size, dispatch, metric |
| `q9` | `lookup_wait`(10s / 1m / 5m / longer), `run_wait`(1m / 10m / 1h / longer), `clarify_count`(0 / 1 / 2_3 / any) |
| `q4`, `q5`, `q6`, `q10` | 자유 서술 |

키의 번호는 화면의 질문 번호와 같다. 기타 항목의 번호는 질문 1·2에서 9, 질문 8에서 6이다.

질문 3의 응답 수는 다음처럼 센다.

```sql
select (q.value)::int as question_no, count(*) as n
from survey_responses_latest r
cross join lateral jsonb_array_elements(r.answers -> 'q3' -> 'selected') as q(value)
group by 1 order by 2 desc, 1;
```

`survey_item_summary`의 `realistic_agreement`, `expected_agreement`는 답한 사람 가운데 3점 이상을 준 비율이다. 문항 내용 타당도 지수(I-CVI)와 같은 계산이다. 논문에 기준값과 함께 보고하려면 Lynn (1986), Polit & Beck (2006)의 원문에서 전문가 수에 따른 기준을 확인한다.

## 문항 수정

`docs/survey-content.js`의 문구를 고친다. 응답을 받기 시작한 뒤에는 문항 번호와 키를 바꾸지 않는다. 문항을 더하거나 빼면 `version`을 올린다. 그러면 저장된 행의 `survey_version`으로 판을 구분할 수 있고, 응답자의 임시 저장도 새 판에서 새로 시작한다.

## 확인

```bash
python3 -m http.server 8765 --directory docs &
node tests/e2e.cjs          # Playwright 필요. Supabase 요청은 가로채므로 실제 저장소에 쓰지 않는다
bash tests/schema_check.sh  # PostgreSQL 서버 필요. 임시 DB에서 권한을 확인한다
```

실제 Supabase 프로젝트에 대한 제출은 위 "Supabase 연결" 3번에서 직접 확인한다.

## 시뮬레이션 화면

소개의 시뮬레이션 화면은 DTUMOS의 Simulation 탭과 같은 방식으로, 지도 위에 deck.gl로 차량의 이동을 재생한다. 자료는 `docs/assets/flow.json` 하나다. 서울에서 택시 1,000대와 승객 10,000명으로 18~19시를 실행한 결과에서 도심 구간의 30분을 추린 것이다. 다른 실행으로 바꾸려면 `camuslab/dtumos-lecture`의 `frontend/scripts/landing_flow.py`로 그 실행의 결과 폴더에서 같은 형식의 파일을 만들어 넣고, 지역이 다르면 `docs/sim-map.js`의 좌표 상자를 그 스크립트의 값과 맞춘다.

지도 바탕은 CARTO의 타일을 쓴다(토큰 없음, 출처 표기 포함). 타일을 받지 못하면 간선도로 윤곽 위에 재생하고, 지도 라이브러리나 WebGL을 쓸 수 없으면 `flow.js`의 canvas 재생이 그대로 보인다. `docs/vendor/`에는 MapLibre GL JS 4.7.1(BSD-3-Clause)과 deck.gl 9.0.38(MIT)의 배포 파일과 라이선스가 들어 있다.

## 표지 출처

표지는 `camuslab/dtumos-lecture`의 프론트엔드 첫 화면 구성을 따랐다. `docs/flow.js`와 `docs/assets/flow.json`(서울 도심 실행을 다시 그리는 배경), `docs/assets/scity-logo.png`는 그 저장소(Apache-2.0)에서 가져왔다. `flow.js`는 모듈 구문을 일반 스크립트로 바꾸고 색 변수를 읽는 위치 한 줄만 고쳤다. 제목 글꼴 Asta Sans의 라틴 부분은 `@fontsource-variable/asta-sans`에서 가져왔고 라이선스(SIL OFL 1.1)는 `docs/assets/asta-sans-OFL.txt`에 있다.
