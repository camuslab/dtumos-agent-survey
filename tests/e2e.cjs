/*
 * 설문 화면 동작 확인 (Playwright).
 *
 * Supabase 요청은 브라우저 안에서 가로채므로 실제 저장소에는 아무것도 쓰지 않는다.
 * 확인하는 것: 임시 저장과 복원, 순위 중복 방지, 빠진 항목 안내, 제출 요청의 형식,
 *             제출 실패 시 응답 보존, 수정 후 재제출(revision 2), 미리보기 모드의 파일 내려받기.
 *
 * 실행:
 *   python3 -m http.server 8765 --directory docs &
 *   node tests/e2e.cjs            # SURVEY_URL로 주소를 바꿀 수 있다
 *   SHOTS=/어떤/폴더 node tests/e2e.cjs   # 화면 캡처도 남긴다
 */
const { chromium } = require("playwright");
const assert = require("assert");
const path = require("path");

const URL_BASE = process.env.SURVEY_URL || "http://localhost:8765/index.html";
const SHOTS = process.env.SHOTS || "";
const FAKE = "https://example-project.supabase.co";
const KEY = "sb_publishable_test_key";

const CONFIGURED = `window.SURVEY_CONFIG = { supabaseUrl: "${FAKE}", supabaseKey: "${KEY}", table: "survey_responses", contact: "lab@example.org" };`;

async function shot(page, name, selector) {
  if (!SHOTS) return;
  const file = path.join(SHOTS, name + ".png");
  if (selector) await page.locator(selector).screenshot({ path: file });
  else await page.screenshot({ path: file });
}

async function openConfigured(context, respond) {
  const page = await context.newPage();
  const posts = [];
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/config.js", (route) => route.fulfill({ contentType: "text/javascript", body: CONFIGURED }));
  await page.route(FAKE + "/**", async (route) => {
    const req = route.request();
    posts.push({ url: req.url(), method: req.method(), headers: req.headers(), body: req.postDataJSON() });
    const r = respond(posts.length);
    await route.fulfill({ status: r.status, contentType: "application/json", body: r.body || "" });
  });
  await page.goto(URL_BASE + "?code=pilot-01");
  await page.waitForSelector("#part1");
  return { page, posts, errors };
}

async function fillAll(page) {
  // 1부
  await page.fill("#p1-field", "교통 시뮬레이션 연구");
  await page.fill("#p1-years", "12");
  await page.locator('input[name="p1-sim_experience"][value="run_directly"]').check({ force: true });
  await page.fill("#p1-tools", "SUMO, MATSim");
  await page.locator('input[name="p1-ai_experience"][value="often"]').check({ force: true });

  // 2부 질문 1: 항목 선택과 순위
  await page.locator("#q1-item-1").check();
  await page.locator("#q1-item-4").check();
  await page.selectOption("#q1-rank-1", "5"); // 순위를 주면 항목도 함께 선택된다
  await page.selectOption("#q1-rank-2", "1");
  await page.selectOption("#q1-rank-3", "4");
  assert.strictEqual(await page.locator("#q1-item-5").isChecked(), true, "순위를 준 항목이 자동으로 선택되어야 한다");
  // 이미 쓴 항목은 다른 순위에서 고를 수 없다
  assert.strictEqual(await page.locator('#q1-rank-2 option[value="5"]').isDisabled(), true, "같은 항목을 두 순위에 넣을 수 없어야 한다");

  // 질문 2
  await page.selectOption("#q2-rank-1", "5");
  await page.selectOption("#q2-rank-2", "1");
  await page.selectOption("#q2-rank-3", "9");
  await page.locator("#q2 .other-input").fill("단위를 바꿔서 보고한다");

  // 질문 3: 순위 없이 여러 개 선택
  for (const no of [1, 5, 8]) await page.locator(`#q3-item-${no}`).check();
  await page.fill("#q3-other", "시간대별 공차 대기 위치");

  // 3부
  await page.fill("#q4-input", "민감도 분석 설계");
  await page.fill("#q5-input", "난수 시드에 따라 결과가 달라지는 경우");

  // 4부: 3번은 현실성 2점, 16번은 기대 행동 1점, 나머지는 4점과 3점
  for (let no = 1; no <= 18; no++) {
    const realistic = no === 3 ? "2" : "4";
    const expected = no === 16 ? "1" : "3";
    await page.locator(`input[name="item-${no}-realistic"][value="${realistic}"]`).check({ force: true });
    await page.locator(`input[name="item-${no}-expected"][value="${expected}"]`).check({ force: true });
  }
  await page.fill("#item-16-comment", "DRT는 합승이 전제이므로 최대 우회 허용시간을 묻는 편이 낫다");

  // 5부
  await page.fill("#q6-input", "요청한 날짜와 다른 날짜의 수요가 적용됨");
  const q7 = { region: "must_ask", date: "must_ask", time_window: "assume_disclose", service_type: "must_ask", fleet_size: "assume_disclose", dispatch: "agent_decides", metric: "assume_disclose" };
  for (const [k, v] of Object.entries(q7)) await page.locator(`input[name="q7-${k}"][value="${v}"]`).check({ force: true });
  await page.locator("#q8-item-2").check();
  await page.selectOption("#q8-rank-1", "2");
  await page.selectOption("#q8-rank-2", "3");
  await page.selectOption("#q8-rank-3", "5");
  const q9 = { lookup_wait: "10s", run_wait: "10m", clarify_count: "1" };
  for (const [k, v] of Object.entries(q9)) await page.locator(`input[name="q9-${k}"][value="${v}"]`).check({ force: true });
  await page.fill("#q10-input", "수고하셨습니다");
  return { q7, q9 };
}

(async () => {
  const browser = await chromium.launch();

  // ---- 1. 저장소가 연결된 경우 ----
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    // 첫 제출은 실패(500), 그다음부터 성공(201)
    const { page, posts, errors } = await openConfigured(context, (n) => (n === 1 ? { status: 500, body: '{"message":"boom"}' } : { status: 201 }));

    assert.strictEqual(await page.locator("html.on-cover").count(), 1, "처음에는 표지가 보여야 한다");
    await page.click("#cover-start");
    await page.waitForFunction(() => !document.documentElement.classList.contains("on-cover"));

    // 소개의 시뮬레이션 화면이 재생되고 시각이 표시된다
    await page.locator("#intro .sim-screen").scrollIntoViewIfNeeded();
    await page.waitForSelector("#intro canvas.flow.on");
    await page.waitForFunction(() => /^18:[0-3]\d$/.test(document.querySelector(".sim-clock-time").textContent));
    assert.strictEqual(await page.locator("#intro .toolcall").count(), 4);

    // 아무것도 답하지 않고 제출하면 빠진 항목을 안내하고 보내지 않는다
    await page.click("#submit-button");
    await page.waitForSelector(".missing-list");
    assert.strictEqual(posts.length, 0, "빠진 항목 안내 단계에서는 전송하지 않는다");
    assert.strictEqual(await page.locator(".item.missing").count(), 18);
    await shot(page, "submit_missing", "#submit");

    const { q7, q9 } = await fillAll(page);
    assert.strictEqual(await page.locator(".item.missing").count(), 0, "답한 문항의 표시는 지워져야 한다");
    assert.strictEqual(await page.locator("#progress-text").innerText(), "53 / 53");

    // 임시 저장 뒤 새로 열어도 그대로 남아 있다
    await page.waitForTimeout(600);
    await page.reload();
    await page.waitForSelector("#part1");
    assert.strictEqual(await page.inputValue("#p1-field"), "교통 시뮬레이션 연구");
    assert.strictEqual(await page.inputValue("#q1-rank-1"), "5");
    assert.strictEqual(await page.locator('input[name="item-16-expected"][value="1"]').isChecked(), true);
    assert.strictEqual(await page.locator('input[name="q9-run_wait"][value="10m"]').isChecked(), true);
    assert.strictEqual(await page.locator("#progress-text").innerText(), "53 / 53");
    assert.strictEqual(await page.locator("#cover-start").innerText(), "이어서 작성");
    if (SHOTS) {
      await shot(page, "part2", "#part2");
      await shot(page, "part3", "#part3");
      await shot(page, "item16", "#item-16");
      await shot(page, "part5", "#part5");
      await shot(page, "intro", "#intro");
    }

    // 첫 제출은 실패: 오류를 보이고 응답은 그대로 둔다
    await page.click("#submit-button");
    await page.waitForSelector(".notice-error");
    assert.strictEqual(posts.length, 1);
    assert.strictEqual(await page.inputValue("#p1-field"), "교통 시뮬레이션 연구");
    await shot(page, "submit_error", "#submit");

    // 다시 제출하면 성공
    await page.click("#submit-button");
    await page.waitForSelector("#done");
    assert.strictEqual(posts.length, 2);
    await shot(page, "done");

    const p = posts[1];
    assert.strictEqual(p.method, "POST");
    assert.strictEqual(p.url, FAKE + "/rest/v1/survey_responses");
    assert.strictEqual(p.headers["apikey"], KEY);
    assert.strictEqual(p.headers["authorization"], "Bearer " + KEY);
    assert.strictEqual(p.headers["prefer"], "return=minimal");
    const row = p.body;
    assert.deepStrictEqual(Object.keys(row).sort(), ["answers", "invite_code", "respondent_id", "revision", "started_at", "submitted_at", "survey_id", "survey_version"]);
    assert.strictEqual(row.survey_id, "dtumos-agent-benchmark-expert-review");
    assert.strictEqual(row.revision, 1);
    assert.strictEqual(row.invite_code, "pilot-01");
    assert.match(row.respondent_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(Date.parse(row.started_at) <= Date.parse(row.submitted_at));
    const a = row.answers;
    assert.deepStrictEqual(a.p1, { field: "교통 시뮬레이션 연구", years: 12, sim_experience: "run_directly", tools: "SUMO, MATSim", ai_experience: "often" });
    assert.deepStrictEqual(a.q1, { selected: [1, 4, 5], ranks: { 1: 5, 2: 1, 3: 4 }, other: "" });
    assert.deepStrictEqual(a.q2, { ranks: { 1: 5, 2: 1, 3: 9 }, other: "단위를 바꿔서 보고한다" });
    assert.deepStrictEqual(a.q3, { selected: [1, 5, 8], other: "시간대별 공차 대기 위치" });
    assert.strictEqual(Object.keys(a.items).length, 18);
    assert.deepStrictEqual(a.items["3"], { realistic: 2, expected_ok: 3, comment: "" });
    assert.deepStrictEqual(a.items["1"], { realistic: 4, expected_ok: 3, comment: "" });
    assert.strictEqual(a.items["16"].expected_ok, 1);
    assert.ok(a.items["16"].comment.startsWith("DRT는"));
    assert.deepStrictEqual(a.q7, q7);
    assert.deepStrictEqual(a.q8, { selected: [2, 3, 5], ranks: { 1: 2, 2: 3, 3: 5 }, other: "" });
    assert.strictEqual(a.q4, "민감도 분석 설계");
    assert.deepStrictEqual(a.q9, q9);
    assert.strictEqual(a.q10, "수고하셨습니다");

    // 수정 후 다시 제출하면 같은 응답자 번호로 revision 2
    await page.click("text=응답 수정하기");
    await page.waitForSelector("#part1");
    await page.locator('input[name="item-3-realistic"][value="4"]').check({ force: true });
    await page.click("#submit-button");
    await page.waitForSelector("#done");
    assert.strictEqual(posts.length, 3);
    assert.strictEqual(posts[2].body.revision, 2);
    assert.strictEqual(posts[2].body.respondent_id, row.respondent_id);
    assert.strictEqual(posts[2].body.answers.items["3"].realistic, 4);

    assert.deepStrictEqual(errors, [], "페이지 오류가 없어야 한다");
    await context.close();
    console.log("ok  저장소 연결: 임시 저장, 빠진 항목 안내, 실패 후 재제출, 저장 형식, 수정 재제출");
  }

  // ---- 2. 미리보기 모드(config.js가 비어 있음): 파일로 내려받는다 ----
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => { if (!r.url().startsWith(new URL(URL_BASE).origin) && !r.url().startsWith("blob:")) external.push(r.url()); });
    await page.goto(URL_BASE);
    await page.waitForSelector("#part1");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, "좁은 화면에서 가로로 넘치지 않아야 한다 (" + overflow + "px)");
    assert.strictEqual(await page.locator(".notice-warn").first().isVisible(), true, "미리보기 안내가 보여야 한다");
    await shot(page, "mobile_cover");
    await page.fill("#p1-field", "서비스 운영");
    await page.click("#submit-button");
    await page.waitForSelector(".missing-list");
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#submit-button")]);
    assert.match(download.suggestedFilename(), /^dtumos-agent-review-[0-9a-f]{8}\.json$/);
    await page.waitForSelector("#done");
    assert.deepStrictEqual(external, [], "미리보기 모드에서는 외부로 아무것도 보내지 않는다");
    assert.deepStrictEqual(errors, []);
    await context.close();
    console.log("ok  미리보기 모드: 좁은 화면, 파일 내려받기, 외부 요청 없음");
  }

  await browser.close();
  console.log("모든 확인 통과");
})().catch((e) => { console.error(e); process.exit(1); });
