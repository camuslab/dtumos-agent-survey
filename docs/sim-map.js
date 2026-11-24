/*
 * 소개의 시뮬레이션 화면: DTUMOS 실행 결과를 지도 위에 재생한다.
 *
 * DTUMOS의 Simulation 탭과 같은 방식으로 그린다. 지도(MapLibre) 위에 deck.gl의 TripsLayer로
 * 차량마다 방금 지나온 길을 꼬리로 남기고, 수단별 색을 쓴다. 지도를 끌어 옮기고 확대할 수 있다.
 *
 * 자료는 assets/flow.json이다. camuslab/dtumos-lecture의 frontend/scripts/landing_flow.py가
 * 실제 실행 한 번에서 만든 파일로, 그 실행의 조건은 다음과 같다.
 *   서울, 택시 1,000대, 승객 10,000명, 18:00~19:00, 택시와 대중교통을 함께 실행 (난수 시드 7)
 * 파일에는 서울 도심 상자 안의 18:05~18:35 구간만, 일부 차량을 추려 담겨 있다.
 * 좌표는 상자 남서쪽 모서리에서 동·북으로 잰 미터 값이라 아래 상수로 경위도로 되돌린다.
 *
 * 필요: window.maplibregl, window.deck (vendor/ 폴더의 파일). 없거나 WebGL을 쓸 수 없으면
 * startSimMap이 거부(reject)되고, 부르는 쪽은 canvas 재생(flow.js)을 그대로 둔다.
 */
(function () {
  "use strict";

  // landing_flow.py의 BOX와 같은 값
  var BOX = { lon0: 126.905, lon1: 127.075, lat0: 37.505, lat1: 37.600 };
  var LAT_M = 111320.0;
  var LON_M = 111320.0 * Math.cos(((BOX.lat0 + BOX.lat1) / 2) * Math.PI / 180);

  // 수단: 0 승객을 태우러 가는 택시, 1 승객을 태운 택시, 2 버스, 3 지하철, 4 철도
  var COLORS = [[255, 79, 163], [255, 130, 40], [114, 211, 95], [91, 140, 255], [192, 122, 232]];
  var WIDTHS = [2.2, 3, 2.6, 3.2, 3.6];
  var TRAIL = 1.2; // 꼬리 길이(분)

  // 지도 바탕. 토큰 없이 쓸 수 있는 CARTO의 어두운 래스터 타일
  var STYLE = {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: ["a", "b", "c", "d"].map(function (s) {
          return "https://" + s + ".basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png";
        }),
        tileSize: 256,
        maxzoom: 19,
        attribution: "© OpenStreetMap contributors © CARTO"
      }
    },
    layers: [
      { id: "ground", type: "background", paint: { "background-color": "#0a0a0a" } },
      { id: "carto", type: "raster", source: "carto", paint: { "raster-opacity": 0.9 } }
    ]
  };

  function lon(x, q) { return BOX.lon0 + (x * q) / LON_M; }
  function lat(y, q) { return BOX.lat0 + (y * q) / LAT_M; }

  function decode(data) {
    var q = data.q;
    var trips = data.trips.map(function (raw) {
      var n = (raw.length - 1) / 3;
      var path = new Array(n), times = new Array(n);
      var ax = 0, ay = 0, at = 0;
      for (var i = 0; i < n; i++) {
        ax += raw[1 + i * 3]; ay += raw[2 + i * 3]; at += raw[3 + i * 3];
        path[i] = [lon(ax, q), lat(ay, q)];
        times[i] = at / 10; // 창 시작부터의 분
      }
      return { mode: raw[0], path: path, times: times };
    });
    // 간선도로: 지도 타일을 받지 못해도 도로 윤곽이 보이도록 옅게 깔아 둔다
    var roads = data.roads.map(function (r) {
      return { cls: r[0], path: [[lon(r[1], q), lat(r[2], q)], [lon(r[3], q), lat(r[4], q)]] };
    });
    return { t0: data.t0 || 0, L: data.L, trips: trips, roads: roads };
  }

  function webglOk() {
    try {
      var c = document.createElement("canvas");
      return !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch (e) { return false; }
  }

  /*
   * container 안에 지도를 만들고 재생을 시작한다.
   * opts.onTime(자정부터의 분), opts.onState({ playing, speed, position })
   * 반환: Promise<{ play, pause, toggle, setSpeed, seek, destroy }>
   */
  window.startSimMap = function (container, flowUrl, opts) {
    opts = opts || {};
    if (!window.maplibregl || !window.deck || !window.deck.TripsLayer || !window.deck.MapboxOverlay) {
      return Promise.reject(new Error("지도 라이브러리를 불러오지 못했습니다"));
    }
    if (!webglOk()) return Promise.reject(new Error("WebGL을 쓸 수 없습니다"));

    return fetch(flowUrl).then(function (r) { return r.json(); }).then(function (data) {
      var flow = decode(data);
      var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      var map = new maplibregl.Map({
        container: container,
        style: STYLE,
        center: [(BOX.lon0 + BOX.lon1) / 2, (BOX.lat0 + BOX.lat1) / 2],
        zoom: 11.4,
        minZoom: 10,
        maxZoom: 16,
        maxBounds: [[BOX.lon0 - 0.12, BOX.lat0 - 0.09], [BOX.lon1 + 0.12, BOX.lat1 + 0.09]],
        attributionControl: { compact: true },
        cooperativeGestures: true, // 휠은 페이지를 넘기고, Ctrl+휠이나 두 손가락으로 지도를 확대한다
        dragRotate: false,
        pitchWithRotate: false
      });
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");
      // 출처 표기는 ⓘ 단추로 접어 둔다 (누르면 펼쳐진다). 좁은 화면에서 범례를 가리지 않게 하기 위해서다.
      var attrib = container.querySelector(".maplibregl-ctrl-attrib");
      if (attrib) { attrib.classList.remove("maplibregl-compact-show"); attrib.removeAttribute("open"); }
      map.fitBounds([[BOX.lon0, BOX.lat0], [BOX.lon1, BOX.lat1]], { padding: 0, animate: false });

      var overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
      map.addControl(overlay);

      var roadLayer = new deck.PathLayer({
        id: "roads",
        data: flow.roads,
        getPath: function (d) { return d.path; },
        getColor: function (d) { return d.cls === 3 ? [244, 244, 245, 46] : [244, 244, 245, 26]; },
        getWidth: function (d) { return d.cls === 3 ? 1.6 : 1; },
        widthUnits: "pixels",
        capRounded: true
      });

      function tripLayer(id, now) {
        return new deck.TripsLayer({
          id: id,
          data: flow.trips,
          getPath: function (d) { return d.path; },
          getTimestamps: function (d) { return d.times; },
          getColor: function (d) { return COLORS[d.mode] || COLORS[1]; },
          getWidth: function (d) { return WIDTHS[d.mode] || 3; },
          widthUnits: "pixels",
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
          fadeTrail: true,
          trailLength: TRAIL,
          currentTime: now,
          opacity: 0.9
        });
      }

      var playing = !still, speed = 1, pos = still ? flow.L / 2 : 0;
      var last = 0, raf = 0, onScreen = true, dead = false;

      function draw() {
        // 자료가 창의 앞뒤로 조금 더 있으므로 한 바퀴 앞뒤의 같은 순간도 함께 그려 이음매를 가린다
        overlay.setProps({ layers: [
          roadLayer, tripLayer("trips", pos), tripLayer("trips-next", pos + flow.L), tripLayer("trips-prev", pos - flow.L)
        ] });
        if (opts.onTime) opts.onTime(flow.t0 + pos);
      }
      function report() {
        if (opts.onState) opts.onState({ playing: playing, speed: speed, position: pos, length: flow.L });
      }
      function tick(ts) {
        if (dead) return;
        if (!last) last = ts;
        var dt = Math.min(0.25, (ts - last) / 1000); // 탭을 떠났다 돌아와도 건너뛰지 않게
        last = ts;
        if (playing && onScreen && !document.hidden) {
          pos = (pos + dt * speed) % flow.L; // 1배속은 1초에 시뮬레이션 1분
          draw();
          report();
        }
        raf = requestAnimationFrame(tick);
      }

      var io = null;
      if (window.IntersectionObserver) {
        io = new IntersectionObserver(function (entries) {
          onScreen = entries[entries.length - 1].isIntersecting;
        });
        io.observe(container);
      }

      draw();
      report();
      raf = requestAnimationFrame(tick);

      return {
        play: function () { playing = true; report(); },
        pause: function () { playing = false; report(); },
        toggle: function () { playing = !playing; report(); },
        setSpeed: function (s) { speed = s; report(); },
        seek: function (p) { pos = Math.max(0, Math.min(flow.L - 0.001, p)); draw(); report(); },
        destroy: function () {
          dead = true;
          cancelAnimationFrame(raf);
          if (io) io.disconnect();
          try { map.remove(); } catch (e) { /* 이미 지워진 경우 */ }
        }
      };
    });
  };
})();
