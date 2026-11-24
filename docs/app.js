/*
 * DTUMOS Agent 벤치마크 문항 전문가 검토 — 화면과 저장
 *
 * survey-content.js의 window.SURVEY를 읽어 설문을 그리고,
 * 작성 중인 응답은 브라우저(localStorage)에 임시 저장하며,
 * 제출하면 config.js의 Supabase 테이블에 한 행을 추가한다.
 */
(function () {
  "use strict";

  var S = window.SURVEY;
  var CONFIG = window.SURVEY_CONFIG || {};
  var DRAFT_KEY = "survey-draft:" + S.id + ":" + S.version;
  var RANKS = [1, 2, 3];
  var CHIP = { "실험 실행": "run", "결과 조회": "read", "결과 비교와 진단": "diag", "DRT": "drt" };

  var configured = !!(CONFIG.supabaseUrl && CONFIG.supabaseKey);
  var app = document.getElementById("app");
  var state = loadDraft() || newState();
  var view = state.submittedAt && !state.editing ? "done" : "form";
  var saveTimer = null;
  var refreshers = [];

  // ---------- 상태 ----------

  function newState() {
    return {
      respondentId: uuid(),
      revision: 0,
      startedAt: null,
      submittedAt: null,
      editing: false,
      answers: emptyAnswers()
    };
  }

  function emptyAnswers() {
    return {
      p1: {},
      q1: { selected: [], ranks: [null, null, null], other: "" },
      q2: { ranks: [null, null, null], other: "" },
      q3: { selected: [], other: "" },
      q4: "",
      q5: "",
      items: {},
      q6: "",
      q7: {},
      q8: { selected: [], ranks: [null, null, null], other: "" },
      q9: {},
      q10: ""
    };
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || !d.respondentId || !d.answers) return null;
      // 버전이 올라가며 생긴 빈 칸을 채운다
      var base = emptyAnswers();
      Object.keys(base).forEach(function (k) { if (d.answers[k] === undefined) d.answers[k] = base[k]; });
      return d;
    } catch (e) {
      return null;
    }
  }

  function saveDraftNow() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      setSaveStatus("이 브라우저에 임시 저장됨 · " + timeText(new Date()));
    } catch (e) {
      setSaveStatus("임시 저장을 쓸 수 없는 브라우저입니다. 창을 닫기 전에 제출해 주십시오.");
    }
  }

  function touch() {
    if (!state.startedAt) state.startedAt = new Date().toISOString();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveDraftNow, 400);
    refresh();
  }

  function timeText(d) {
    return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
  }

  function setSaveStatus(text) {
    var nodes = document.querySelectorAll(".save-status");
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = text;
  }

  // ---------- DOM 도우미 ----------

  function h(tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k.slice(0, 2) === "on") el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, "");
        else el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) { child.forEach(function (c) { append(el, c); }); return; }
    el.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }

  function paragraphs(list) {
    return list.map(function (t) { return h("p", { text: t }); });
  }

  function table(headers, rows, nowrapFirst) {
    return h("div", { class: "table-wrap" },
      h("table", null,
        headers ? h("thead", null, h("tr", null, headers.map(function (t) { return h("th", { text: t }); }))) : null,
        h("tbody", null, rows.map(function (r) {
          return h("tr", null, r.map(function (c, i) {
            return h(i === 0 && !headers ? "th" : "td", { class: i === 0 && nowrapFirst ? "nowrap" : null }, c);
          }));
        }))));
  }

  function chip(name) {
    return h("span", { class: "chip " + (CHIP[name] || "run"), text: name });
  }

  // ---------- 입력 위젯 ----------

  function textInput(get, set, opts) {
    opts = opts || {};
    var el = h(opts.multiline ? "textarea" : "input", {
      type: opts.multiline ? null : (opts.type || "text"),
      id: opts.id, class: opts.class, placeholder: opts.placeholder,
      min: opts.type === "number" ? "0" : null, max: opts.type === "number" ? "70" : null,
      inputmode: opts.type === "number" ? "numeric" : null,
      "aria-label": opts.ariaLabel,
      maxlength: opts.multiline ? "4000" : "300"
    });
    el.value = get() || "";
    el.addEventListener("input", function () { set(el.value); touch(); });
    return el;
  }

  function segmented(name, options, get, set, extraClass) {
    var box = h("div", { class: "seg" + (extraClass ? " " + extraClass : ""), role: "radiogroup" });
    options.forEach(function (o) {
      var input = h("input", { type: "radio", name: name, value: o[0] });
      input.checked = String(get()) === String(o[0]);
      input.addEventListener("change", function () { if (input.checked) { set(o[0]); touch(); } });
      box.appendChild(h("label", null, input, h("span", { text: o[1] })));
    });
    return box;
  }

  /*
   * 순위 선택. model.ranks = [1순위 항목 번호, 2순위, 3순위] (없으면 null).
   * 같은 항목을 두 순위에 넣을 수 없다. model.selected가 있으면 순위를 준 항목을 함께 선택한다.
   */
  function rankPicker(key, model, items, otherNo) {
    var selects = [];
    var all = items.concat([[otherNo, "기타 (직접 기재)"]]);
    var box = h("div", { class: "ranks" });
    RANKS.forEach(function (r, idx) {
      var sel = h("select", { id: key + "-rank-" + r, "aria-label": r + "순위" });
      sel.appendChild(h("option", { value: "", text: "선택 안 함" }));
      all.forEach(function (it) {
        sel.appendChild(h("option", { value: String(it[0]), text: it[0] + ". " + it[1] }));
      });
      sel.addEventListener("change", function () {
        var v = sel.value ? Number(sel.value) : null;
        model.ranks[idx] = v;
        if (v !== null && model.selected && model.selected.indexOf(v) < 0) model.selected.push(v);
        touch();
      });
      selects.push(sel);
      box.appendChild(h("div", { class: "rank-row" },
        h("label", { class: "rank-name", for: key + "-rank-" + r, text: r + "순위" }), sel));
    });
    refreshers.push(function () {
      selects.forEach(function (sel, idx) {
        sel.value = model.ranks[idx] === null || model.ranks[idx] === undefined ? "" : String(model.ranks[idx]);
        for (var i = 1; i < sel.options.length; i++) {
          var n = Number(sel.options[i].value);
          var usedElsewhere = model.ranks.some(function (x, j) { return j !== idx && x === n; });
          sel.options[i].disabled = usedElsewhere;
        }
      });
    });
    return box;
  }

  /* 번호 붙은 목록. selectable이면 체크박스를 붙이고, 순위를 받은 항목에는 순위 표시를 단다. */
  function itemList(key, model, items, otherNo, selectable) {
    var ul = h("ul", { class: "checklist" + (selectable ? "" : " plain") });
    var tags = {};
    var boxes = {};

    function row(no, labelNode) {
      var tag = h("span", { class: "rank-tag", hidden: true });
      tags[no] = tag;
      if (!selectable) return h("li", null, h("span", { class: "num", text: no + "" }), labelNode, tag);
      var cb = h("input", { type: "checkbox", id: key + "-item-" + no });
      boxes[no] = cb;
      cb.addEventListener("change", function () {
        var i = model.selected.indexOf(no);
        if (cb.checked && i < 0) model.selected.push(no);
        if (!cb.checked && i >= 0) {
          model.selected.splice(i, 1);
          model.ranks = model.ranks.map(function (x) { return x === no ? null : x; });
        }
        touch();
      });
      return h("li", null, h("label", null, cb, h("span", { class: "num", text: no + "" }), labelNode, tag));
    }

    items.forEach(function (it) { ul.appendChild(row(it[0], h("span", { text: it[1] }))); });

    var otherLi = row(otherNo, h("span", { text: "기타 (직접 기재)" }));
    var otherInput = textInput(
      function () { return model.other; },
      function (v) {
        model.other = v;
        if (selectable && v.trim() && model.selected.indexOf(otherNo) < 0) model.selected.push(otherNo);
      },
      { class: "other-input", placeholder: "직접 적어 주십시오", ariaLabel: "기타 내용" });
    otherLi.appendChild(otherInput);
    ul.appendChild(otherLi);

    refreshers.push(function () {
      Object.keys(tags).forEach(function (no) {
        var r = model.ranks.indexOf(Number(no));
        tags[no].hidden = r < 0;
        tags[no].textContent = r < 0 ? "" : (r + 1) + "순위";
      });
      Object.keys(boxes).forEach(function (no) {
        boxes[no].checked = model.selected.indexOf(Number(no)) >= 0;
      });
    });
    return ul;
  }

  /* 묶음 제목이 있는 선택 목록. 순위 없이 여러 개를 고른다. */
  function groupedChecklist(key, model, groups, otherLabel) {
    var ul = h("ul", { class: "checklist grouped" });
    groups.forEach(function (g) {
      ul.appendChild(h("li", { class: "group-head", text: g.name }));
      g.items.forEach(function (it) {
        var cb = h("input", { type: "checkbox", id: key + "-item-" + it[0] });
        cb.checked = model.selected.indexOf(it[0]) >= 0;
        cb.addEventListener("change", function () {
          var i = model.selected.indexOf(it[0]);
          if (cb.checked && i < 0) model.selected.push(it[0]);
          if (!cb.checked && i >= 0) model.selected.splice(i, 1);
          touch();
        });
        ul.appendChild(h("li", null, h("label", null, cb, h("span", { text: it[1] }))));
      });
    });
    return [ul,
      h("div", { class: "field" },
        h("label", { for: key + "-other", text: otherLabel }),
        textInput(function () { return model.other; }, function (v) { model.other = v; },
          { multiline: true, class: "short", id: key + "-other" }))];
  }

  function question(q, id) {
    var body = Array.prototype.slice.call(arguments, 2);
    return h("div", { class: "question", id: id },
      h("p", { class: "q-text" }, h("span", { class: "q-label", text: q.label + "." }), q.text),
      body);
  }

  function freeText(q, id, get, set) {
    return question(q, id, textInput(get, set, { multiline: true, id: id + "-input", ariaLabel: q.label }));
  }

  // ---------- 지도 재생에 쓰는 라이브러리 ----------

  var simHandle = null;
  var mapLibraries = null;

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var el = document.createElement("script");
      el.src = src;
      el.onload = resolve;
      el.onerror = function () { reject(new Error(src)); };
      document.head.appendChild(el);
    });
  }

  /* 설문 본문과 상관없는 2MB가량의 파일이라, 시뮬레이션 화면이 가까워졌을 때 한 번만 불러온다. */
  function loadMapLibraries() {
    if (!mapLibraries) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "vendor/maplibre-gl.css";
      document.head.appendChild(css);
      mapLibraries = loadScript("vendor/maplibre-gl.js")
        .then(function () { return loadScript("vendor/deck.gl.min.js"); })
        .then(function () { return loadScript("sim-map.js"); });
    }
    return mapLibraries;
  }

  /* el이 화면 가까이에 오면 fn을 한 번 부른다. */
  function whenNear(el, fn) {
    if (!window.IntersectionObserver) { fn(); return; }
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) { io.disconnect(); fn(); }
    }, { rootMargin: "800px 0px" });
    io.observe(el);
  }

  // ---------- 각 부분 ----------

  function renderHero() {
    return h("section", { class: "card hero", id: "guide" },
      h("h2", null, S.title, h("span", { class: "badge", text: S.subtitle })),
      h("div", { class: "meta", text: S.date + " · " + S.author }),
      CONFIG.previewOnly
        ? h("p", { class: "notice notice-warn", text: "화면 확인용 미리보기입니다. 제출해도 응답이 저장되지 않습니다." })
        : (!configured ? h("p", { class: "notice notice-warn", text: "미리보기 모드입니다. 응답 저장소가 연결되어 있지 않아, 제출하면 응답이 파일로 내려받아집니다." }) : null),
      state.revision > 0 ? h("p", { class: "notice notice-info", text: "이미 제출한 응답을 수정하고 있습니다. 다시 제출하면 마지막 제출본이 반영됩니다." }) : null,
      paragraphs(S.guide.lead),
      h("dl", { class: "facts" }, S.guide.facts.map(function (f) {
        return [h("dt", { text: f[0] }), h("dd", { text: f[1] })];
      })));
  }

  function renderIntro() {
    var I = S.intro;

    // 시뮬레이션 화면: 지도 위에 실제 실행을 재생한다. 지도를 쓸 수 없으면 canvas 재생을 그대로 둔다.
    var canvas = h("canvas", { class: "flow", "aria-hidden": "true" });
    var mapBox = h("div", { class: "sim-map", hidden: true });
    var clock = h("span", { class: "sim-clock-time", text: "--:--" });
    var lastClock = "";
    function showTime(minute) {
      var m = Math.floor(minute) % 1440;
      var text = ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2);
      if (text !== lastClock) { lastClock = text; clock.textContent = text; }
    }

    var playButton = h("button", { type: "button", class: "sim-play", "aria-label": "재생 멈춤", text: "멈춤" });
    var slider = h("input", { type: "range", class: "sim-slider", min: "0", max: "30", step: "0.1", value: "0", "aria-label": "시뮬레이션 시각" });
    var speeds = h("div", { class: "seg sim-speed", role: "radiogroup", "aria-label": "재생 속도" },
      [1, 2, 4].map(function (v) {
        var input = h("input", { type: "radio", name: "sim-speed", value: String(v) });
        input.checked = v === 1;
        input.addEventListener("change", function () { if (simHandle) simHandle.setSpeed(v); });
        return h("label", null, input, h("span", { text: v + "배속" }));
      }));
    var controls = h("div", { class: "sim-controls", hidden: true }, playButton, slider, speeds);
    var sliding = false;
    playButton.addEventListener("click", function () { if (simHandle) simHandle.toggle(); });
    slider.addEventListener("pointerdown", function () { sliding = true; });
    slider.addEventListener("pointerup", function () { sliding = false; });
    slider.addEventListener("input", function () { if (simHandle) simHandle.seek(Number(slider.value)); });

    var screenBox = h("div", { class: "sim-screen" },
      canvas,
      mapBox,
      h("div", { class: "sim-badge", text: I.screen.badge }),
      h("div", { class: "sim-clock" }, h("span", { class: "sim-clock-label", text: I.screen.clockLabel }), clock),
      h("ul", { class: "sim-legend" }, I.screen.legend.map(function (l) {
        return h("li", null, h("i", { class: "sim-key " + l[0] }), l[1]);
      })));
    var screen = h("figure", { class: "sim" }, screenBox, controls, h("figcaption", { text: I.screen.caption }));

    if (window.startFlow) window.startFlow(canvas, "assets/flow.json", { onTime: showTime });
    if (simHandle) { simHandle.destroy(); simHandle = null; }
    whenNear(screenBox, function () {
      loadMapLibraries().then(function () {
        mapBox.hidden = false; // 지도는 크기가 있는 상자에 만들어야 한다
        return window.startSimMap(mapBox, "assets/flow.json", {
          onTime: showTime,
          onState: function (st) {
            playButton.textContent = st.playing ? "멈춤" : "재생";
            playButton.setAttribute("aria-label", st.playing ? "재생 멈춤" : "재생");
            slider.max = String(st.length);
            if (!sliding) slider.value = String(st.position);
          }
        });
      }).then(function (handle) {
        if (!screenBox.isConnected) { handle.destroy(); return; }
        simHandle = handle;
        canvas.hidden = true; // 화면 밖으로 나간 canvas는 flow.js가 그리지 않는다
        controls.hidden = false;
        screenBox.classList.add("has-map");
      }).catch(function () {
        mapBox.hidden = true; // canvas 재생을 그대로 둔다
      });
    });

    // 사용자 ↔ Agent ↔ DTUMOS
    var link = h("div", { class: "link" });
    I.link.nodes.forEach(function (n, i) {
      link.appendChild(h("div", { class: "link-node" + (i === 1 ? " agent" : "") },
        h("strong", { text: n[0] }), h("span", { text: n[1] })));
      if (I.link.edges[i]) {
        link.appendChild(h("div", { class: "link-edge" },
          h("span", { class: "go", text: I.link.edges[i][0] }),
          h("span", { class: "back", text: I.link.edges[i][1] })));
      }
    });

    return h("section", { class: "card", id: "intro" },
      h("h2", { text: I.title }),
      paragraphs(I.what),
      h("h3", { text: I.screen.title }),
      screen,
      h("h3", { text: I.flowTitle }),
      h("div", { class: "flow-steps" }, I.flow.map(function (f) {
        return h("div", { class: "flow-step" },
          h("h4", { text: f.step }),
          h("ul", null, f.items.map(function (t) { return h("li", { text: t }); })));
      })),
      table(null, I.table, true),
      h("h3", { text: I.exampleTitle }),
      h("p", { class: "example", text: I.example }),
      h("h3", { text: I.agentTitle }),
      paragraphs(I.agentText),
      link,
      h("h3", { text: I.dialogTitle }),
      h("div", { class: "dialog" }, I.dialog.map(function (d) {
        if (d[0] === "tool") {
          return h("div", { class: "toolcall" }, h("code", { text: d[1] }), h("span", { text: d[2] }));
        }
        return h("div", { class: "bubble " + d[0] },
          h("span", { class: "who", text: d[0] === "user" ? "사용자" : "Agent" }), d[1]);
      })),
      h("p", { class: "small muted", text: I.dialogNote }),
      h("h3", { text: I.premiseTitle }),
      h("p", { text: I.premise }),
      h("details", { class: "glossary" },
        h("summary", { text: I.glossaryTitle }),
        h("dl", null, I.glossary.map(function (g) {
          return [h("dt", { text: g[0] }), h("dd", { text: g[1] })];
        }))));
  }

  function renderPart1() {
    var a = state.answers.p1;
    return h("section", { class: "card", id: "part1" },
      h("h2", { text: S.part1.title }),
      S.part1.fields.map(function (f) {
        var id = "p1-" + f.key;
        var get = function () { return a[f.key]; };
        var set = function (v) { a[f.key] = v; };
        var control = f.type === "choice"
          ? segmented(id, f.options, get, set)
          : textInput(get, set, { id: id, type: f.type });
        return h("div", { class: "field", id: "field-" + id },
          h(f.type === "choice" ? "div" : "label", { class: "label", for: f.type === "choice" ? null : id },
            f.label, f.required ? h("span", { class: "req", text: "*", title: "필수" }) : null),
          f.hint ? h("div", { class: "hint", text: f.hint }) : null,
          control);
      }));
  }

  function renderPart2() {
    var P = S.part2, a = state.answers;
    return h("section", { class: "card", id: "part2" },
      h("h2", { text: P.title }),
      h("p", { text: P.lead }),
      question(P.q1, "q1",
        itemList("q1", a.q1, P.q1.items, P.q1.otherNo, true),
        h("p", { class: "small muted", text: "가장 필요한 세 가지" }),
        rankPicker("q1", a.q1, P.q1.items, P.q1.otherNo)),
      question(P.q2, "q2",
        itemList("q2", a.q2, P.q2.items, P.q2.otherNo, false),
        h("p", { class: "small muted", text: "가장 곤란한 세 가지" }),
        rankPicker("q2", a.q2, P.q2.items, P.q2.otherNo)),
      question(P.q3, "q3", groupedChecklist("q3", a.q3, P.q3.groups, P.q3.otherLabel)));
  }

  function renderPart3() {
    var P = S.part3, a = state.answers;
    return h("section", { class: "card", id: "part3" },
      h("h2", { text: P.title }),
      h("p", { text: P.lead }),
      table(["범주", "Agent가 갖춰야 할 기능", "요청 예"], P.functions.map(function (r) {
        return [chip(r[0]), r[1], "“" + r[2] + "”"];
      }), true),
      P.scopeNote ? h("p", { class: "notice notice-info", text: P.scopeNote }) : null,
      h("p", { text: P.situationsLead }),
      table(["범주", "상황"], P.situations.map(function (r) { return [chip(r[0]), r[1]]; }), true),
      freeText(P.q4, "q4", function () { return a.q4; }, function (v) { a.q4 = v; }),
      freeText(P.q5, "q5", function () { return a.q5; }, function (v) { a.q5 = v; }));
  }

  function renderItem(it) {
    var items = state.answers.items;
    var key = String(it.no);
    function ans() { if (!items[key]) items[key] = {}; return items[key]; }
    var scale = S.part4.scale.map(function (o) { return [o[0], o[0] + "\n" + o[1]]; });
    var card = h("article", { class: "item", id: "item-" + it.no },
      h("div", { class: "item-head" },
        h("span", { class: "item-no", text: String(it.no) }),
        h("span", { class: "item-situation", text: it.situation })),
      h("dl", { class: "item-body" },
        h("dt", { text: "사용자 요청" }),
        h("dd", { class: "request" }, "“" + it.request + "”",
          it.requestNote ? h("span", { class: "request-note", text: "(" + it.requestNote + ")" }) : null),
        it.given ? [h("dt", { text: "주어진 조건" }), h("dd", { text: it.given })] : null,
        h("dt", { text: "기대 행동" }),
        h("dd", null, h("div", { class: "expected", text: it.expected }))),
      h("div", { class: "item-rate" },
        h("div", { class: "rate" },
          h("div", { class: "rate-label", text: "현실성" }),
          h("div", { class: "rate-help", text: "실제로 나올 법한 요청이다" }),
          segmented("item-" + it.no + "-realistic", scale,
            function () { return (items[key] || {}).realistic; },
            function (v) { ans().realistic = v; }, "scale")),
        h("div", { class: "rate" },
          h("div", { class: "rate-label", text: "기대 행동" }),
          h("div", { class: "rate-help", text: "이 통과 기준은 적절하다" }),
          segmented("item-" + it.no + "-expected", scale,
            function () { return (items[key] || {}).expected_ok; },
            function (v) { ans().expected_ok = v; }, "scale")),
        h("div", { class: "item-comment" },
          h("label", { for: "item-" + it.no + "-comment", text: "고칠 점 (선택. 2점 이하를 주셨다면 적어 주십시오)" }),
          textInput(function () { return (items[key] || {}).comment; },
            function (v) { ans().comment = v; },
            { multiline: true, class: "short", id: "item-" + it.no + "-comment" }))));
    return card;
  }

  function renderPart4() {
    var P = S.part4;
    return h("section", { class: "card", id: "part4" },
      h("h2", { text: P.title }),
      h("p", { text: P.lead }),
      table(null, P.criteria, true),
      P.groups.map(function (g) {
        return [
          h("div", { class: "group-title" }, chip(g.name),
            h("span", { class: "muted small", text: "문항 " + g.items[0].no + "~" + g.items[g.items.length - 1].no })),
          g.items.map(renderItem)
        ];
      }));
  }

  function renderPart5() {
    var P = S.part5, a = state.answers;
    return h("section", { class: "card", id: "part5" },
      h("h2", { text: P.title }),
      freeText(P.q6, "q6", function () { return a.q6; }, function (v) { a.q6 = v; }),
      question(P.q7, "q7",
        h("div", { class: "matrix" }, P.q7.rows.map(function (r) {
          return h("div", { class: "matrix-row", id: "q7-" + r[0] },
            h("div", { class: "row-name", text: r[1] }),
            segmented("q7-" + r[0], P.q7.options,
              function () { return a.q7[r[0]]; },
              function (v) { a.q7[r[0]] = v; }));
        }))),
      question(P.q8, "q8",
        itemList("q8", a.q8, P.q8.items, P.q8.otherNo, true),
        h("p", { class: "small muted", text: "가장 필요한 세 가지" }),
        rankPicker("q8", a.q8, P.q8.items, P.q8.otherNo)),
      question(P.q9, "q9",
        h("div", { class: "matrix stack" }, P.q9.rows.map(function (r) {
          return h("div", { class: "matrix-row", id: "q9-" + r.key },
            h("div", { class: "row-name", text: r.label }),
            segmented("q9-" + r.key, r.options,
              function () { return a.q9[r.key]; },
              function (v) { a.q9[r.key] = v; }));
        }))),
      freeText(P.q10, "q10", function () { return a.q10; }, function (v) { a.q10 = v; }));
  }

  // ---------- 진행 상황과 빠진 항목 ----------

  function rankCount(m) { return m.ranks.filter(function (x) { return x !== null && x !== undefined; }).length; }

  /* 반환: [{part, id, label, done}] — 진행률과 제출 전 확인에 쓴다. 자유 서술은 선택 사항이라 넣지 않는다. */
  function checklist() {
    var a = state.answers, out = [];
    S.part1.fields.forEach(function (f) {
      if (!f.required) return;
      out.push({ part: "part1", id: "field-p1-" + f.key, label: "1부 · " + f.label, done: !!(a.p1[f.key] && String(a.p1[f.key]).trim()) });
    });
    out.push({ part: "part2", id: "q1", label: "질문 1 · 순위 세 가지", done: rankCount(a.q1) === 3 });
    out.push({ part: "part2", id: "q2", label: "질문 2 · 순위 세 가지", done: rankCount(a.q2) === 3 });
    out.push({ part: "part2", id: "q3", label: "질문 3 · 하나 이상 선택", done: a.q3.selected.length > 0 || !!trimmed(a.q3.other) });
    S.part4.groups.forEach(function (g) {
      g.items.forEach(function (it) {
        var x = a.items[String(it.no)] || {};
        out.push({ part: "part4", id: "item-" + it.no, label: "문항 " + it.no + " · 현실성", done: !!x.realistic });
        out.push({ part: "part4", id: "item-" + it.no, label: "문항 " + it.no + " · 기대 행동", done: !!x.expected_ok });
      });
    });
    S.part5.q7.rows.forEach(function (r) {
      out.push({ part: "part5", id: "q7-" + r[0], label: "질문 7 · " + r[1], done: !!a.q7[r[0]] });
    });
    out.push({ part: "part5", id: "q8", label: "질문 8 · 순위 세 가지", done: rankCount(a.q8) === 3 });
    S.part5.q9.rows.forEach(function (r) {
      out.push({ part: "part5", id: "q9-" + r.key, label: "질문 9 · " + r.label.replace(/ \(.*$/, ""), done: !!a.q9[r.key] });
    });
    return out;
  }

  var NAV = [["intro", "소개"], ["part1", "1부"], ["part2", "2부"], ["part3", "3부"], ["part4", "4부"], ["part5", "5부"], ["submit", "제출"]];

  function renderNav() {
    var nav = document.getElementById("topnav");
    nav.textContent = "";
    NAV.forEach(function (n) { nav.appendChild(h("a", { href: "#" + n[0], "data-part": n[0], text: n[1] })); });
  }

  function refresh() {
    refreshers.forEach(function (f) { f(); });
    var list = checklist();
    var done = list.filter(function (x) { return x.done; }).length;
    var pt = document.getElementById("progress-text");
    var pf = document.getElementById("progress-fill");
    if (pt) pt.textContent = done + " / " + list.length;
    if (pf) pf.style.width = (list.length ? Math.round((done / list.length) * 100) : 0) + "%";
    var links = document.querySelectorAll("#topnav a");
    for (var i = 0; i < links.length; i++) {
      var part = links[i].getAttribute("data-part");
      var mine = list.filter(function (x) { return x.part === part; });
      links[i].classList.toggle("done", mine.length > 0 && mine.every(function (x) { return x.done; }));
    }
    // 4부 카드의 빠진 표시는 답하면 바로 지운다
    var marked = document.querySelectorAll(".item.missing");
    for (var j = 0; j < marked.length; j++) {
      var no = marked[j].id.replace("item-", "");
      var x = state.answers.items[no] || {};
      if (x.realistic && x.expected_ok) marked[j].classList.remove("missing");
    }
  }

  // ---------- 제출 ----------

  function inviteCode() {
    try {
      var c = new URLSearchParams(location.search).get("code") || "";
      return /^[A-Za-z0-9_-]{1,40}$/.test(c) ? c : null;
    } catch (e) { return null; }
  }

  function rankMap(ranks) {
    var o = {};
    ranks.forEach(function (v, i) { if (v !== null && v !== undefined) o[String(i + 1)] = v; });
    return o;
  }

  function trimmed(s) { return (s || "").trim(); }

  /* 저장 형식. 순위는 {"1": 항목 번호, "2": …, "3": …}로 바꾼다. */
  function buildAnswers() {
    var a = state.answers;
    var p1 = {};
    S.part1.fields.forEach(function (f) {
      var v = a.p1[f.key];
      if (v === undefined || v === null || trimmed(String(v)) === "") return;
      p1[f.key] = f.type === "number" ? Number(v) : trimmed(String(v));
    });
    var items = {};
    S.part4.groups.forEach(function (g) {
      g.items.forEach(function (it) {
        var x = a.items[String(it.no)] || {};
        items[String(it.no)] = {
          realistic: x.realistic || null,
          expected_ok: x.expected_ok || null,
          comment: trimmed(x.comment)
        };
      });
    });
    function sorted(list) { return list.slice().sort(function (x, y) { return x - y; }); }
    return {
      p1: p1,
      q1: { selected: sorted(a.q1.selected), ranks: rankMap(a.q1.ranks), other: trimmed(a.q1.other) },
      q2: { ranks: rankMap(a.q2.ranks), other: trimmed(a.q2.other) },
      q3: { selected: sorted(a.q3.selected), other: trimmed(a.q3.other) },
      q4: trimmed(a.q4),
      q5: trimmed(a.q5),
      items: items,
      q6: trimmed(a.q6),
      q7: Object.assign({}, a.q7),
      q8: { selected: sorted(a.q8.selected), ranks: rankMap(a.q8.ranks), other: trimmed(a.q8.other) },
      q9: Object.assign({}, a.q9),
      q10: trimmed(a.q10)
    };
  }

  function buildRow() {
    return {
      survey_id: S.id,
      survey_version: S.version,
      respondent_id: state.respondentId,
      revision: state.revision + 1,
      invite_code: inviteCode(),
      started_at: state.startedAt,
      submitted_at: new Date().toISOString(),
      answers: buildAnswers()
    };
  }

  function sendRow(row) {
    var url = CONFIG.supabaseUrl.replace(/\/+$/, "") + "/rest/v1/" + (CONFIG.table || "survey_responses");
    return fetch(url, {
      method: "POST",
      headers: {
        "apikey": CONFIG.supabaseKey,
        "Authorization": "Bearer " + CONFIG.supabaseKey,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify(row)
    }).then(function (res) {
      if (res.ok) return;
      return res.text().then(function (t) {
        var err = new Error("저장소가 요청을 받지 않았습니다 (HTTP " + res.status + ")");
        err.detail = t.slice(0, 300);
        throw err;
      });
    });
  }

  function download(row) {
    var blob = new Blob([JSON.stringify(row, null, 2)], { type: "application/json" });
    var a = h("a", { href: URL.createObjectURL(blob), download: "dtumos-agent-review-" + row.respondent_id.slice(0, 8) + ".json" });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function renderSubmit() {
    var box = h("div", { id: "submit-status" });
    var button = h("button", { class: "primary", type: "button", id: "submit-button", text: state.revision > 0 ? "수정한 응답 제출" : "제출" });
    var confirmed = false;

    function showMissing(missing) {
      box.textContent = "";
      var labels = [];
      missing.forEach(function (m) {
        // 문항 하나에 빠진 것이 둘이면 한 줄로 묶는다
        var prev = labels[labels.length - 1];
        if (prev && prev.id === m.id) prev.label = prev.label.replace(/ · .*$/, "");
        else labels.push({ id: m.id, label: m.label });
        var el = document.getElementById(m.id);
        if (el && el.classList.contains("item")) el.classList.add("missing");
      });
      box.appendChild(h("div", { class: "notice notice-warn" },
        h("strong", { text: "아직 답하지 않은 항목이 " + labels.length + "개 있습니다." }),
        " 눌러서 이동할 수 있습니다. 답하기 어려운 항목은 비워 두고 제출해도 됩니다.",
        h("ul", { class: "missing-list" }, labels.map(function (m) {
          return h("li", null, h("a", { href: "#" + m.id, text: m.label }));
        }))));
      button.textContent = "빠진 항목이 있어도 제출";
    }

    function submit() {
      var missing = checklist().filter(function (x) { return !x.done; });
      if (missing.length && !confirmed) { confirmed = true; showMissing(missing); return; }
      var row = buildRow();
      button.disabled = true;
      box.textContent = "";
      box.appendChild(h("p", { class: "notice notice-info", text: "제출하는 중입니다…" }));

      var finish = function () {
        state.revision = row.revision;
        state.submittedAt = row.submitted_at;
        state.editing = false;
        state.lastRow = row;
        saveDraftNow();
        view = "done";
        render();
        window.scrollTo(0, 0);
      };

      if (CONFIG.previewOnly) { finish(); return; }
      if (!configured) { download(row); finish(); return; }

      sendRow(row).then(finish).catch(function (err) {
        button.disabled = false;
        box.textContent = "";
        box.appendChild(h("div", { class: "notice notice-error" },
          h("strong", { text: "제출하지 못했습니다. " }),
          "작성한 내용은 이 브라우저에 그대로 남아 있습니다. 잠시 뒤 다시 제출해 주십시오. 계속 실패하면 아래에서 응답 파일을 내려받아 " +
          (CONFIG.contact ? CONFIG.contact + "(으)로 " : "담당자에게 ") + "보내 주십시오.",
          h("div", { class: "small muted", text: (err && err.message ? err.message : String(err)) + (err && err.detail ? " · " + err.detail : "") }),
          h("div", { class: "actions" },
            h("button", { type: "button", text: "응답 파일 내려받기", onclick: function () { download(row); } }))));
      });
    }

    button.addEventListener("click", submit);

    return h("section", { class: "card submit-card", id: "submit" },
      h("h2", { text: "제출" }),
      h("p", { text: "제출한 뒤에도 같은 브라우저에서 응답을 수정해 다시 제출할 수 있습니다." }),
      box,
      h("div", { class: "actions" }, button, h("span", { class: "save-status" })),
      h("div", { class: "actions" },
        h("button", {
          class: "link", type: "button", text: "작성한 내용을 모두 지우고 처음부터 다시 작성",
          onclick: function () {
            if (!window.confirm("이 브라우저에 임시 저장된 응답을 모두 지웁니다. 계속할까요?")) return;
            try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* 무시 */ }
            state = newState();
            view = "form";
            render();
            window.scrollTo(0, 0);
          }
        })));
  }

  function renderDone() {
    return h("section", { class: "card done", id: "done" },
      h("h2", { text: S.closing }),
      h("p", { text: CONFIG.previewOnly ? "화면 확인용 미리보기라 응답을 저장하지 않았습니다."
        : (configured ? "응답이 저장되었습니다." : "미리보기 모드라 응답을 저장소에 보내지 않고 파일로 내려받았습니다.") }),
      h("p", { class: "muted small", text: "제출 " + state.revision + "회차 · " + new Date(state.submittedAt).toLocaleString("ko-KR") }),
      h("div", { class: "actions" },
        state.lastRow && !CONFIG.previewOnly ? h("button", { type: "button", text: "내 응답 사본 내려받기", onclick: function () { download(state.lastRow); } }) : null,
        h("button", {
          type: "button", text: "응답 수정하기",
          onclick: function () { state.editing = true; saveDraftNow(); view = "form"; render(); window.scrollTo(0, 0); }
        })));
  }

  // ---------- 표지 ----------

  var flowStarted = false;

  /* 표지 문구는 index.html에 있다. 여기서는 날짜, 이어 쓰기 안내, 배경 움직임만 채운다. */
  function renderCover() {
    document.getElementById("cover-date").textContent = S.date;
    var resuming = !!state.startedAt;
    document.getElementById("cover-resume").hidden = !resuming;
    var label = state.revision > 0 ? "응답 수정하기" : (resuming ? "이어서 작성" : "설문 시작");
    var starts = document.querySelectorAll("[data-start]");
    for (var i = 0; i < starts.length; i++) starts[i].textContent = label;
    if (!flowStarted && window.startFlow) {
      flowStarted = true;
      window.startFlow(document.querySelector("#cover .flow"), "assets/flow.json");
    }
    syncCover();
  }

  /* 표지가 상단바 아래에 걸쳐 있는 동안에는 상단바를 어둡게 하고 진행 표시 대신 시작 버튼을 보인다. */
  function syncCover() {
    var cover = document.getElementById("cover");
    var on = view === "form" && !cover.hidden && cover.getBoundingClientRect().bottom > 72;
    document.documentElement.classList.toggle("on-cover", on);
  }

  var coverTick = false;
  window.addEventListener("scroll", function () {
    if (coverTick) return;
    coverTick = true;
    window.requestAnimationFrame(function () { coverTick = false; syncCover(); });
  }, { passive: true });
  window.addEventListener("resize", syncCover);

  // ---------- 그리기 ----------

  function render() {
    refreshers = [];
    app.textContent = "";
    var topbar = document.getElementById("topbar");
    var cover = document.getElementById("cover");
    if (view === "done") {
      topbar.hidden = true;
      cover.hidden = true;
      document.documentElement.classList.remove("on-cover");
      app.appendChild(renderDone());
      return;
    }
    topbar.hidden = false;
    cover.hidden = false;
    renderCover();
    renderNav();
    [renderHero(), renderIntro(), renderPart1(), renderPart2(), renderPart3(), renderPart4(), renderPart5(), renderSubmit()]
      .forEach(function (el) { app.appendChild(el); });
    refresh();
  }

  window.addEventListener("beforeunload", function () {
    if (saveTimer) { clearTimeout(saveTimer); saveDraftNow(); }
  });

  render();
})();
