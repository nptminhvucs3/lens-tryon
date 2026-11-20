/*!
 * Lens Try-On – Thử lens trực tiếp (virtual contact-lens try-on)
 * Chạy hoàn toàn trên trình duyệt: MediaPipe Face Landmarker (478 điểm, có mống mắt) + WebGL.
 * Không gửi hình ảnh/video lên máy chủ.
 */
(function () {
  'use strict';

  var CFG = window.LensTryOnConfig || {};
  var TUNE = Object.assign({
    irisMM: 11.8,          // đường kính mống mắt trung bình (mm) – để quy đổi GDIA sản phẩm sang tỉ lệ
    maxScale: 1.12,        // giới hạn lens to hơn mống mắt (tránh tràn tròng trắng)
    // Bộ lọc One-Euro cho các điểm lưới mặt (đơn vị: chiều cao khung hình)
    meshMinCutoff: 1.5, meshBeta: 60, meshDCutoff: 3,
    // Bộ lọc cho vị trí mống mắt trong hệ toạ độ mắt (đơn vị: độ rộng mắt)
    gazeMinCutoff: 0.8, gazeBeta: 3, gazeDCutoff: 2,
    camWidth: 1280, camHeight: 720
  }, CFG.tuning || {});

  var VISION_URL = CFG.visionUrl || 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
  var WASM_URL = CFG.wasmUrl || 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
  var MODEL_URL = CFG.modelUrl || 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

  var T = Object.assign({
    title: 'Thử lens trực tiếp',
    consentTitle: 'Thử lens ngay trên khuôn mặt bạn',
    consentText: 'Tính năng cần quyền truy cập camera. Hình ảnh được xử lý ngay trên thiết bị của bạn, không ghi lại và không gửi lên máy chủ.',
    enableCamera: 'Bật camera',
    loading: 'Đang khởi động camera…',
    loadingModel: 'Đang tải bộ nhận diện khuôn mặt…',
    noFace: 'Đưa khuôn mặt vào giữa khung hình',
    tooFar: 'Lại gần camera hơn một chút',
    compare: 'Giữ để so sánh',
    capture: 'Chụp ảnh',
    addToCart: 'Thêm vào giỏ',
    adding: 'Đang thêm…',
    added: 'Đã thêm vào giỏ hàng',
    viewCart: 'Xem giỏ',
    outOfStock: 'Hết hàng',
    chooseOptions: 'Chọn tuỳ chọn',
    intensity: 'Độ đậm',
    download: 'Tải ảnh',
    share: 'Chia sẻ',
    retake: 'Chụp lại',
    close: 'Đóng',
    errDenied: 'Bạn đã từ chối quyền camera. Hãy cho phép camera trong cài đặt trình duyệt (biểu tượng ổ khoá cạnh thanh địa chỉ) rồi thử lại.',
    errNoCamera: 'Không tìm thấy camera trên thiết bị này.',
    errInsecure: 'Camera chỉ hoạt động trên trang HTTPS.',
    errBusy: 'Camera đang được ứng dụng khác sử dụng.',
    errGeneric: 'Không thể khởi động tính năng thử lens. Vui lòng tải lại trang và thử lại.',
    errModel: 'Không tải được bộ nhận diện khuôn mặt. Kiểm tra kết nối mạng và thử lại.',
    errAdd: 'Không thêm được vào giỏ hàng.',
    retry: 'Thử lại'
  }, CFG.i18n || {});

  /* ------------------------------------------------------------------ */
  /*  Landmark indices (MediaPipe Face Mesh, 478 điểm)                  */
  /* ------------------------------------------------------------------ */
  var EYES = [
    { contour: [33, 246, 161, 160, 159, 158, 157, 173, 133, 155, 154, 153, 145, 144, 163, 7], a: 33, b: 133, top: 159, bottom: 145 },
    { contour: [263, 466, 388, 387, 386, 385, 384, 398, 362, 382, 381, 380, 374, 373, 390, 249], a: 263, b: 362, top: 386, bottom: 374 }
  ];
  var IRISES = [[468, 469, 470, 471, 472], [473, 474, 475, 476, 477]];

  /* ------------------------------------------------------------------ */
  /*  One-Euro filter (giảm rung mà vẫn bám nhanh khi chuyển động)       */
  /* ------------------------------------------------------------------ */
  function OneEuro(minCutoff, beta, dCutoff) {
    this.minCutoff = minCutoff; this.beta = beta; this.dCutoff = dCutoff;
    this.reset();
  }
  OneEuro.prototype.reset = function () { this.x = null; this.dx = 0; this.t = null; };
  OneEuro.prototype.alpha = function (cutoff, dt) {
    var tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  };
  OneEuro.prototype.filter = function (v, t) {
    if (this.x === null || this.t === null) { this.x = v; this.t = t; this.dx = 0; return v; }
    var dt = t - this.t;
    if (dt <= 0) return this.x;
    if (dt > 0.5) { this.x = v; this.t = t; this.dx = 0; return v; }
    this.t = t;
    var d = (v - this.x) / dt;
    this.dx += this.alpha(this.dCutoff, dt) * (d - this.dx);
    var cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += this.alpha(cutoff, dt) * (v - this.x);
    return this.x;
  };

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function smoothstep(a, b, x) { var t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); }

  /* ------------------------------------------------------------------ */
  /*  Tracker: landmarks -> tham số hình học cho từng mắt               */
  /* ------------------------------------------------------------------ */
  function Tracker() {
    this.mesh = {};
    this.eyes = [this._eyeState(), this._eyeState()];
    this.lastSeen = 0;
  }
  Tracker.prototype._eyeState = function () {
    return {
      gx: new OneEuro(TUNE.gazeMinCutoff, TUNE.gazeBeta, TUNE.gazeDCutoff),
      gy: new OneEuro(TUNE.gazeMinCutoff, TUNE.gazeBeta, TUNE.gazeDCutoff),
      ratio: null, n: 0
    };
  };
  Tracker.prototype.lost = function (t) {
    if (t - this.lastSeen > 0.25) {
      for (var k in this.mesh) { this.mesh[k][0].reset(); this.mesh[k][1].reset(); }
      this.eyes.forEach(function (s) { s.gx.reset(); s.gy.reset(); });
    }
    if (t - this.lastSeen > 3) {
      this.eyes.forEach(function (s) { s.ratio = null; s.n = 0; });
    }
  };
  Tracker.prototype.update = function (lm, matrix, W, H, t) {
    var self = this;
    this.lastSeen = t;
    function P(i) { return [lm[i].x * W, lm[i].y * H]; }
    // Lọc trong đơn vị "chiều cao khung hình" để tham số không phụ thuộc độ phân giải.
    function F(i) {
      var f = self.mesh[i];
      if (!f) {
        f = self.mesh[i] = [
          new OneEuro(TUNE.meshMinCutoff, TUNE.meshBeta, TUNE.meshDCutoff),
          new OneEuro(TUNE.meshMinCutoff, TUNE.meshBeta, TUNE.meshDCutoff)
        ];
      }
      return [f[0].filter(lm[i].x * W / H, t) * H, f[1].filter(lm[i].y, t) * H];
    }

    // Tư thế đầu -> độ co hình elip của mống mắt (chỉ dùng độ lớn, không phụ thuộc quy ước dấu).
    var cosYaw = 1, cosPitch = 1;
    if (matrix) {
      var m = matrix.data || matrix;
      if (m && m.length >= 11) {
        var fx = m[8], fy = m[9], fz = m[10];
        var n = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        fx /= n; fy /= n;
        cosYaw = Math.sqrt(Math.max(0.36, 1 - fx * fx));
        cosPitch = Math.sqrt(Math.max(0.36, 1 - fy * fy));
      }
    }

    var irisCenters = IRISES.map(function (ir) { return P(ir[0]); });
    var out = [];
    for (var e = 0; e < 2; e++) {
      var E = EYES[e], st = this.eyes[e];
      var poly = E.contour.map(F);
      var A = F(E.a), B = F(E.b);
      var dx = B[0] - A[0], dy = B[1] - A[1];
      var D = Math.sqrt(dx * dx + dy * dy);
      if (D < 6) { out.push(null); continue; }
      var ux = dx / D, uy = dy / D;
      if (ux < 0) { ux = -ux; uy = -uy; }
      var vx = -uy, vy = ux;                       // vuông góc, hướng xuống dưới ảnh
      var mx = (A[0] + B[0]) / 2, my = (A[1] + B[1]) / 2;

      // Ghép mống mắt gần nhất với mắt này (không phụ thuộc quy ước trái/phải).
      var d0 = Math.hypot(irisCenters[0][0] - mx, irisCenters[0][1] - my);
      var d1 = Math.hypot(irisCenters[1][0] - mx, irisCenters[1][1] - my);
      var ir = d0 <= d1 ? IRISES[0] : IRISES[1];
      var C = d0 <= d1 ? irisCenters[0] : irisCenters[1];

      // Vị trí mống mắt trong hệ toạ độ của mắt -> lọc rung ánh nhìn,
      // còn chuyển động đầu được theo bằng khung mắt (không trễ).
      var lx = ((C[0] - mx) * ux + (C[1] - my) * uy) / D;
      var ly = ((C[0] - mx) * vx + (C[1] - my) * vy) / D;
      lx = st.gx.filter(lx, t);
      ly = st.gy.filter(ly, t);
      var cx = mx + (ux * lx + vx * ly) * D;
      var cy = my + (uy * lx + vy * ly) * D;

      // Độ mở mắt
      var tp = P(E.top), bt = P(E.bottom);
      var open = Math.hypot(tp[0] - bt[0], tp[1] - bt[1]) / D;

      // Bán kính mống mắt: tỉ lệ (bán kính / độ rộng mắt) gần như bất biến theo người -> lọc mạnh.
      var lo = Infinity, hi = -Infinity;
      for (var k = 1; k < 5; k++) {
        var p = P(ir[k]);
        var pr = (p[0] - C[0]) * ux + (p[1] - C[1]) * uy;
        if (pr < lo) lo = pr;
        if (pr > hi) hi = pr;
      }
      var meas = (hi - lo) / 2 / D;
      if (open > 0.17 && meas > 0.12 && meas < 0.32) {
        st.n++;
        var a = st.n < 15 ? 0.3 : 0.03;
        st.ratio = st.ratio === null ? meas : st.ratio + a * (meas - st.ratio);
      }
      var ratio = st.ratio === null ? clamp(meas, 0.16, 0.26) : st.ratio;
      var ru = ratio * D;
      var rv = clamp(ratio * D / cosYaw * cosPitch, ru * 0.6, ru * 1.5);

      out.push({
        cx: cx, cy: cy, ux: ux, uy: uy, vx: vx, vy: vy, ru: ru, rv: rv,
        poly: poly, D: D, fade: smoothstep(0.07, 0.14, open)
      });
    }
    return out;
  };

  /* ------------------------------------------------------------------ */
  /*  WebGL renderer                                                     */
  /* ------------------------------------------------------------------ */
  var VS = [
    'attribute vec2 aPos;',
    'uniform vec2 uSize;',
    'varying vec2 vPos;',
    'void main(){',
    '  vPos = aPos;',
    '  gl_Position = vec4(aPos.x / uSize.x * 2.0 - 1.0, 1.0 - aPos.y / uSize.y * 2.0, 0.0, 1.0);',
    '}'
  ].join('\n');

  var FS_VIDEO = [
    'precision highp float;',
    'varying vec2 vPos;',
    'uniform vec2 uSize;',
    'uniform sampler2D uVideo;',
    'void main(){ gl_FragColor = vec4(texture2D(uVideo, vPos / uSize).rgb, 1.0); }'
  ].join('\n');

  var FS_LENS = [
    'precision highp float;',
    'varying vec2 vPos;',
    'uniform vec2 uSize;',
    'uniform sampler2D uVideo;',
    'uniform sampler2D uLens;',
    'uniform vec2 uCenter;',
    'uniform mat2 uFwd;',      // toạ độ mống mắt -> pixel
    'uniform mat2 uInv;',      // pixel -> toạ độ mống mắt (|l| = 1 tại viền mống mắt)
    'uniform vec2 uPoly[17];', // viền mí mắt (điểm cuối = điểm đầu)
    'uniform float uFeather;',
    'uniform float uInset;',
    'uniform float uScale;',
    'uniform float uOpacity;',
    'uniform float uPupil;',
    'uniform float uFade;',
    'uniform float uTime;',
    '',
    'float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }',
    'vec3 vid(vec2 p){ return texture2D(uVideo, clamp(p, vec2(0.5), uSize - 0.5) / uSize).rgb; }',
    'vec3 vidL(vec2 l){ return vid(uCenter + uFwd * l); }',
    '',
    '// Khoảng cách có dấu tới viền mí mắt (dương = bên trong khe mắt)',
    'float polySD(vec2 p){',
    '  float d = 1e6; bool inside = false;',
    '  for (int i = 0; i < 16; i++) {',
    '    vec2 a = uPoly[i]; vec2 b = uPoly[i + 1];',
    '    vec2 e = b - a; vec2 w = p - a;',
    '    float h = clamp(dot(w, e) / max(dot(e, e), 1e-4), 0.0, 1.0);',
    '    d = min(d, length(w - e * h));',
    '    if ((a.y > p.y) != (b.y > p.y)) {',
    '      float xi = (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x;',
    '      if (p.x < xi) inside = !inside;',
    '    }',
    '  }',
    '  return inside ? d : -d;',
    '}',
    '',
    'void main(){',
    '  vec3 base = vid(vPos);',
    '  vec2 l = uInv * (vPos - uCenter);',
    '  float rr = length(l);',
    '  float rl = rr / uScale;',
    '  float inLens = 1.0 - smoothstep(0.965, 1.0, rl);',
    '  if (inLens <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }',
    '  float lid = smoothstep(uInset, uInset + uFeather, polySD(vPos));',
    '  if (lid <= 0.0) { gl_FragColor = vec4(base, 1.0); return; }',
    '  vec4 lens = texture2D(uLens, l / uScale * 0.5 + 0.5);',
    '  float pupil = smoothstep(uPupil * 0.8, uPupil * 1.15, rr);',
    '  float a = lens.a * inLens * lid * pupil * uOpacity * uFade;',
    '  if (a <= 0.002) { gl_FragColor = vec4(base, 1.0); return; }',
    '  vec3 lc = lens.rgb / max(lens.a, 0.001);', // texture premultiplied
    '',
    '  // Độ sáng trung bình mống mắt thật -> giữ lại chi tiết/bóng mí trên mống mắt',
    '  float meanL = 0.0;',
    '  for (int i = 0; i < 8; i++) {',
    '    float ang = float(i) * 0.7853982 + 0.39;',
    '    meanL += luma(vidL(vec2(cos(ang), sin(ang)) * 0.62));',
    '  }',
    '  meanL /= 8.0;',
    '',
    '  // Ánh sáng môi trường + cân bằng trắng: lấy mẫu tròng trắng hai bên, chọn bên sáng hơn',
    '  vec3 sR = (vidL(vec2(1.42, 0.10)) + vidL(vec2(1.42, -0.12)) + vidL(vec2(1.25, 0.25))) / 3.0;',
    '  vec3 sL = (vidL(vec2(-1.42, 0.10)) + vidL(vec2(-1.42, -0.12)) + vidL(vec2(-1.25, 0.25))) / 3.0;',
    '  vec3 sc = luma(sR) > luma(sL) ? sR : sL;',
    '  float sl = max(luma(sc), 0.04);',
    '  float light = clamp(sl / 0.62, 0.3, 1.25);',
    '  vec3 tint = mix(vec3(1.0), clamp(sc / sl, vec3(0.78), vec3(1.25)), 0.55);',
    '',
    '  float L = luma(base);',
    '  float detail = clamp(L / max(meanL, 0.03), 0.45, 1.7);',
    '  vec3 lit = lc * light * tint * mix(1.0, detail, 0.6);',
    '  lit *= mix(1.0, 0.88, smoothstep(0.6, 1.0, rl));',       // độ cong giác mạc: tối nhẹ ở rìa
    '  vec3 col = mix(base, lit, a);',
    '',
    '  // Giữ đốm phản chiếu (catchlight) trên giác mạc -> lens nằm "dưới" bề mặt mắt',
    '  float spec = smoothstep(meanL * 1.5 + 0.10, meanL * 1.5 + 0.32, L);',
    '  col = mix(col, max(col, base), spec);',
    '',
    '  // Hạt nhiễu nhẹ cho khớp với nhiễu camera',
    '  float nz = fract(sin(dot(vPos + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;',
    '  col += nz * 0.035 * a;',
    '  gl_FragColor = vec4(col, 1.0);',
    '}'
  ].join('\n');

  function compile(gl, type, src) {
    var s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(s);
      gl.deleteShader(s);
      throw new Error('Shader: ' + log);
    }
    return s;
  }
  function program(gl, vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
    var u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < n; i++) {
      var info = gl.getActiveUniform(p, i);
      var name = info.name.replace(/\[0\]$/, '');
      u[name] = gl.getUniformLocation(p, info.name);
    }
    return { p: p, u: u };
  }

  function Renderer(canvas) {
    var gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) ||
             canvas.getContext('experimental-webgl');
    if (!gl) throw new Error('WebGL không được hỗ trợ');
    this.gl = gl;
    this.canvas = canvas;
    this.pVideo = program(gl, VS, FS_VIDEO);
    this.pLens = program(gl, VS, FS_LENS);
    this.buf = gl.createBuffer();
    this.videoTex = this._tex(false);
    this.W = 0; this.H = 0;
    this.polyArr = new Float32Array(34);
    this.quad = new Float32Array(12);
  }
  Renderer.prototype._tex = function (mip) {
    var gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  /** Tạo texture lens từ canvas vuông 512px (premultiplied + mipmap -> viền mịn, không viền đen). */
  Renderer.prototype.createLensTexture = function (squareCanvas) {
    var gl = this.gl, t = this._tex(true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, squareCanvas);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  };
  Renderer.prototype.resize = function (W, H) {
    if (W === this.W && H === this.H) return;
    this.W = W; this.H = H;
    this.canvas.width = W; this.canvas.height = H;
    this.gl.viewport(0, 0, W, H);
  };
  Renderer.prototype._drawQuad = function (x0, y0, x1, y1) {
    var gl = this.gl, q = this.quad;
    q[0] = x0; q[1] = y0; q[2] = x1; q[3] = y0; q[4] = x0; q[5] = y1;
    q[6] = x0; q[7] = y1; q[8] = x1; q[9] = y0; q[10] = x1; q[11] = y1;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, q, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  };
  /**
   * Vẽ 1 khung: video + lens trên cùng một khung hình mà landmarks được tính
   * (không lệch thời gian giữa ảnh và lens).
   */
  Renderer.prototype.render = function (video, eyes, lens, time) {
    var gl = this.gl, W = this.W, H = this.H;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.videoTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video);

    var pv = this.pVideo;
    gl.useProgram(pv.p);
    gl.uniform2f(pv.u.uSize, W, H);
    gl.uniform1i(pv.u.uVideo, 0);
    this._drawQuad(0, 0, W, H);

    if (!eyes || !lens || !lens.tex) return;
    var pl = this.pLens, u = pl.u;
    gl.useProgram(pl.p);
    gl.uniform2f(u.uSize, W, H);
    gl.uniform1i(u.uVideo, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, lens.tex);
    gl.uniform1i(u.uLens, 1);
    gl.uniform1f(u.uScale, lens.scale);
    gl.uniform1f(u.uOpacity, lens.opacity);
    gl.uniform1f(u.uPupil, lens.pupil);
    gl.uniform1f(u.uTime, time % 97);

    for (var i = 0; i < eyes.length; i++) {
      var e = eyes[i];
      if (!e || e.fade <= 0.001) continue;
      var Ux = e.ux * e.ru, Uy = e.uy * e.ru, Vx = e.vx * e.rv, Vy = e.vy * e.rv;
      var det = Ux * Vy - Vx * Uy;
      if (Math.abs(det) < 1e-6) continue;
      gl.uniform2f(u.uCenter, e.cx, e.cy);
      gl.uniformMatrix2fv(u.uFwd, false, [Ux, Uy, Vx, Vy]);
      gl.uniformMatrix2fv(u.uInv, false, [Vy / det, -Uy / det, -Vx / det, Ux / det]);
      for (var k = 0; k < 17; k++) {
        var p = e.poly[k % 16];
        this.polyArr[k * 2] = p[0]; this.polyArr[k * 2 + 1] = p[1];
      }
      gl.uniform2fv(u.uPoly, this.polyArr);
      gl.uniform1f(u.uFeather, Math.max(1.0, e.D * 0.035));
      gl.uniform1f(u.uInset, e.D * 0.012);
      gl.uniform1f(u.uFade, e.fade);
      var half = Math.max(e.ru, e.rv) * Math.max(lens.scale, 1) * 1.08 + 2;
      this._drawQuad(e.cx - half, e.cy - half, e.cx + half, e.cy + half);
    }
  };

  /* ------------------------------------------------------------------ */
  /*  Tải ảnh lens: tự cắt viền trong suốt, đưa về canvas vuông 512px    */
  /* ------------------------------------------------------------------ */
  var imageCache = {};
  function loadLensCanvas(url) {
    if (imageCache[url]) return imageCache[url];
    imageCache[url] = new Promise(function (resolve, reject) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight;
        var bx = 0, by = 0, bw = w, bh = h;
        try {
          var sc = Math.min(1, 256 / Math.max(w, h));
          var tw = Math.max(1, Math.round(w * sc)), th = Math.max(1, Math.round(h * sc));
          var tc = document.createElement('canvas'); tc.width = tw; tc.height = th;
          var tx = tc.getContext('2d'); tx.drawImage(img, 0, 0, tw, th);
          var d = tx.getImageData(0, 0, tw, th).data;
          var x0 = tw, y0 = th, x1 = -1, y1 = -1;
          for (var y = 0; y < th; y++) for (var x = 0; x < tw; x++) {
            if (d[(y * tw + x) * 4 + 3] > 12) {
              if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
            }
          }
          if (x1 > x0 && y1 > y0) { bx = x0 / sc; by = y0 / sc; bw = (x1 - x0 + 1) / sc; bh = (y1 - y0 + 1) / sc; }
        } catch (err) { /* ảnh khác domain không có CORS: bỏ qua bước cắt viền */ }
        var S = 512, size = Math.max(bw, bh);
        var c = document.createElement('canvas'); c.width = S; c.height = S;
        var ctx = c.getContext('2d');
        var cx = bx + bw / 2, cy = by + bh / 2;
        ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size, 0, 0, S, S);
        resolve(c);
      };
      img.onerror = function () { delete imageCache[url]; reject(new Error('Không tải được ảnh lens: ' + url)); };
      img.src = url;
    });
    return imageCache[url];
  }

  /* ------------------------------------------------------------------ */
  /*  MediaPipe Face Landmarker (tải lười khi người dùng bấm bật camera) */
  /* ------------------------------------------------------------------ */
  var landmarkerPromise = null;
  function getLandmarker() {
    if (landmarkerPromise) return landmarkerPromise;
    landmarkerPromise = import(/* webpackIgnore: true */ VISION_URL).then(function (vision) {
      return vision.FilesetResolver.forVisionTasks(WASM_URL).then(function (fileset) {
        function create(delegate) {
          return vision.FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate: delegate },
            runningMode: 'VIDEO',
            numFaces: 1,
            outputFaceBlendshapes: false,
            outputFacialTransformationMatrixes: true,
            minFaceDetectionConfidence: 0.5,
            minFacePresenceConfidence: 0.5,
            minTrackingConfidence: 0.5
          });
        }
        return create('GPU').catch(function (err) {
          console.warn('[LensTryOn] GPU delegate lỗi, chuyển sang CPU', err);
          return create('CPU');
        });
      });
    });
    landmarkerPromise.catch(function () { landmarkerPromise = null; });
    return landmarkerPromise;
  }

  /* ------------------------------------------------------------------ */
  /*  Dữ liệu lens                                                       */
  /* ------------------------------------------------------------------ */
  function normalizeLens(l) {
    var gdia = parseFloat(l.gdia) || 0;
    var scale = gdia > 0 ? clamp(gdia / TUNE.irisMM, 0.85, TUNE.maxScale) : 1.0;
    return {
      id: String(l.id),
      productId: l.productId || l.product_id || 0,
      variationId: l.variationId || l.variation_id || 0,
      name: l.name || '',
      group: l.group || '',
      label: l.label || l.name || '',
      image: l.image,
      thumb: l.thumb || l.image,
      priceHtml: l.priceHtml || l.price_html || '',
      url: l.url || '',
      scale: scale,
      gdia: gdia,
      opacity: l.opacity != null && l.opacity !== '' ? clamp(parseFloat(l.opacity), 0.2, 1) : 0.92,
      pupil: l.pupil != null && l.pupil !== '' ? clamp(parseFloat(l.pupil), 0, 0.6) : 0.28,
      inStock: l.inStock !== false,
      needsOptions: !!l.needsOptions,
      attributes: l.attributes || null,
      current: !!l.current,
      tex: null
    };
  }

  /* ------------------------------------------------------------------ */
  /*  Giao diện                                                          */
  /* ------------------------------------------------------------------ */
  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    camera: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    eye: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
    compare: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M5 7h4v10H5zM15 7h4v10h-4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
    cart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4h2l2.4 11h10.2L20 7H6.3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/><circle cx="9" cy="19" r="1.4" fill="currentColor"/><circle cx="17" cy="19" r="1.4" fill="currentColor"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 018 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>'
  };

  function TryOn() {
    this.lenses = [];
    this.current = null;
    this.open_ = false;
    this.stream = null;
    this.renderer = null;
    this.tracker = new Tracker();
    this.landmarker = null;
    this.comparing = false;
    this.userOpacity = 1;
    this.shotRequested = false;
    this.lastVideoTime = -1;
    this.noFaceSince = 0;
    this.frameHandle = null;
    this.fps = { n: 0, t: 0, v: 0 };
    this.debug = /[?&]lensdebug\b/.test(location.search);
    this._loop = this._loop.bind(this);
    this._onKey = this._onKey.bind(this);
    this._onVis = this._onVis.bind(this);
    this.setLenses(CFG.lenses || []);
  }

  TryOn.prototype.setLenses = function (list) {
    this.lenses = (list || []).filter(function (l) { return l && l.image; }).map(normalizeLens);
    if (this.ui) this._renderList();
  };

  TryOn.prototype._build = function () {
    if (this.ui) return;
    var self = this;
    var root = el('div', 'lto-modal');
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', T.title);
    if (CFG.accent) root.style.setProperty('--lto-accent', CFG.accent);
    root.innerHTML =
      '<div class="lto-panel">' +
        '<div class="lto-stage">' +
          '<video class="lto-video" playsinline muted autoplay></video>' +
          '<canvas class="lto-canvas"></canvas>' +
          '<div class="lto-guide" hidden><div class="lto-oval"></div><p class="lto-guide-text"></p></div>' +
          '<div class="lto-status" hidden><div class="lto-spinner"></div><p class="lto-status-text"></p></div>' +
          '<div class="lto-consent">' +
            '<div class="lto-consent-icon">' + ICON.eye + '</div>' +
            '<h3>' + esc(T.consentTitle) + '</h3>' +
            '<p>' + esc(T.consentText) + '</p>' +
            '<button type="button" class="lto-btn lto-btn-primary lto-start">' + ICON.camera + '<span>' + esc(T.enableCamera) + '</span></button>' +
            '<p class="lto-privacy">' + ICON.lock + '<span>' + esc(CFG.privacyNote || 'Xử lý 100% trên thiết bị') + '</span></p>' +
          '</div>' +
          '<div class="lto-error" hidden><p class="lto-error-text"></p><button type="button" class="lto-btn lto-btn-primary lto-retry">' + esc(T.retry) + '</button></div>' +
          '<div class="lto-shot" hidden>' +
            '<img alt="">' +
            '<div class="lto-shot-actions">' +
              '<a class="lto-btn lto-btn-primary lto-download" download="thu-lens.jpg">' + esc(T.download) + '</a>' +
              '<button type="button" class="lto-btn lto-share" hidden>' + esc(T.share) + '</button>' +
              '<button type="button" class="lto-btn lto-retake">' + esc(T.retake) + '</button>' +
            '</div>' +
          '</div>' +
          '<button type="button" class="lto-icon-btn lto-close" aria-label="' + esc(T.close) + '">' + ICON.close + '</button>' +
          '<div class="lto-tools" hidden>' +
            '<button type="button" class="lto-icon-btn lto-compare" aria-label="' + esc(T.compare) + '" title="' + esc(T.compare) + '">' + ICON.compare + '</button>' +
            '<button type="button" class="lto-icon-btn lto-capture" aria-label="' + esc(T.capture) + '" title="' + esc(T.capture) + '">' + ICON.camera + '</button>' +
          '</div>' +
          '<div class="lto-toast" hidden></div>' +
          (this.debug ? '<div class="lto-debug"></div>' : '') +
        '</div>' +
        '<div class="lto-bar">' +
          '<div class="lto-list" role="listbox" aria-label="Mẫu lens"></div>' +
          '<div class="lto-row">' +
            '<div class="lto-info"><div class="lto-name"></div><div class="lto-meta"><span class="lto-price"></span><span class="lto-gdia"></span></div></div>' +
            '<label class="lto-intensity"><span>' + esc(T.intensity) + '</span><input type="range" min="40" max="100" value="100"></label>' +
            '<button type="button" class="lto-btn lto-btn-primary lto-add">' + ICON.cart + '<span>' + esc(T.addToCart) + '</span></button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(root);

    var q = function (s) { return root.querySelector(s); };
    this.ui = {
      root: root, video: q('.lto-video'), canvas: q('.lto-canvas'), consent: q('.lto-consent'),
      status: q('.lto-status'), statusText: q('.lto-status-text'), error: q('.lto-error'), errorText: q('.lto-error-text'),
      guide: q('.lto-guide'), guideText: q('.lto-guide-text'), tools: q('.lto-tools'), list: q('.lto-list'),
      name: q('.lto-name'), price: q('.lto-price'), gdia: q('.lto-gdia'), add: q('.lto-add'), range: q('.lto-intensity input'),
      shot: q('.lto-shot'), shotImg: q('.lto-shot img'), download: q('.lto-download'), share: q('.lto-share'),
      toast: q('.lto-toast'), debug: q('.lto-debug')
    };

    q('.lto-close').addEventListener('click', function () { self.close(); });
    q('.lto-start').addEventListener('click', function () { self.start(); });
    q('.lto-retry').addEventListener('click', function () { self.start(); });
    root.addEventListener('click', function (ev) { if (ev.target === root) self.close(); });
    q('.lto-capture').addEventListener('click', function () { self.shotRequested = true; });
    q('.lto-retake').addEventListener('click', function () { self._hideShot(); });
    this.ui.add.addEventListener('click', function () { self._addToCart(); });
    this.ui.range.addEventListener('input', function () { self.userOpacity = this.value / 100; });

    var cmp = q('.lto-compare');
    var on = function (ev) { ev.preventDefault(); self.comparing = true; cmp.classList.add('is-active'); };
    var off = function () { self.comparing = false; cmp.classList.remove('is-active'); };
    cmp.addEventListener('pointerdown', on);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (n) { cmp.addEventListener(n, off); });
    cmp.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });
    cmp.addEventListener('keydown', function (ev) { if (ev.key === ' ' || ev.key === 'Enter') on(ev); });
    cmp.addEventListener('keyup', off);

    this._renderList();
  };

  TryOn.prototype._renderList = function () {
    var self = this, list = this.ui.list;
    list.innerHTML = '';
    var lastGroup = null;
    this.lenses.forEach(function (l) {
      var b = el('button', 'lto-swatch');
      b.type = 'button';
      b.setAttribute('role', 'option');
      b.dataset.id = l.id;
      b.title = l.label;
      if (l.group && l.group !== lastGroup && lastGroup !== null) b.classList.add('lto-group-start');
      lastGroup = l.group;
      b.innerHTML = '<span class="lto-swatch-img"><img loading="lazy" alt="" src="' + esc(l.thumb) + '"></span><span class="lto-swatch-name">' + esc(l.name) + '</span>';
      b.addEventListener('click', function () { self.select(l.id); });
      list.appendChild(b);
    });
    if (this.pending || this.current) this._markSelected();
  };

  TryOn.prototype._markSelected = function (lens) {
    lens = lens || this.pending || this.current;
    var id = lens && lens.id;
    var items = this.ui.list.querySelectorAll('.lto-swatch');
    for (var i = 0; i < items.length; i++) {
      var on = items[i].dataset.id === id;
      items[i].classList.toggle('is-selected', on);
      items[i].setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && items[i].scrollIntoView) items[i].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    }
  };

  TryOn.prototype.select = function (id) {
    var self = this;
    var lens = this.lenses.filter(function (l) { return l.id === String(id); })[0] || this.lenses[0];
    if (!lens) return;
    this.pending = lens;
    // Cập nhật thông tin ngay; lens cũ vẫn hiển thị tới khi texture mới sẵn sàng (đổi mẫu tức thì).
    this._showInfo(lens);
    this._markSelected(lens);
    this._ensureTexture(lens).then(function () {
      if (self.pending === lens) self.current = lens;
    }).catch(function (err) { console.error('[LensTryOn]', err); });
    this._syncProductForm(lens);
    if (typeof CFG.onSelect === 'function') CFG.onSelect(lens);
  };

  TryOn.prototype._showInfo = function (lens) {
    var ui = this.ui;
    ui.name.textContent = lens.label;
    ui.price.innerHTML = lens.priceHtml || '';
    ui.gdia.textContent = lens.gdia ? 'GDIA ' + lens.gdia + 'mm' : '';
    var span = ui.add.querySelector('span');
    ui.add.disabled = false;
    ui.add.classList.remove('is-disabled');
    if (!lens.inStock) { span.textContent = T.outOfStock; ui.add.disabled = true; ui.add.classList.add('is-disabled'); }
    else if (lens.needsOptions) span.textContent = T.chooseOptions;
    else span.textContent = T.addToCart;
    if (!CFG.cartUrl && !CFG.addToCartUrl && typeof CFG.onAddToCart !== 'function') ui.add.hidden = true;
  };

  TryOn.prototype._ensureTexture = function (lens) {
    var self = this;
    if (lens.tex) return Promise.resolve(lens);
    if (lens._loading) return lens._loading;
    lens._loading = loadLensCanvas(lens.image).then(function (canvas) {
      if (!self.renderer) { lens._loading = null; return lens; }
      lens.tex = self.renderer.createLensTexture(canvas);
      lens._loading = null;
      return lens;
    }, function (err) { lens._loading = null; throw err; });
    return lens._loading;
  };

  TryOn.prototype._preloadAll = function () {
    var self = this, i = 0;
    var next = function () {
      if (!self.open_ || i >= self.lenses.length) return;
      var l = self.lenses[i++];
      self._ensureTexture(l).then(next, next);
    };
    setTimeout(next, 600);
  };

  /** Đồng bộ biến thể trên form WooCommerce của trang khi chọn trong giao diện thử. */
  TryOn.prototype._syncProductForm = function (lens) {
    if (!lens.attributes || !lens.current) return;
    var form = document.querySelector('form.variations_form');
    if (!form) return;
    Object.keys(lens.attributes).forEach(function (name) {
      var val = lens.attributes[name];
      if (!val) return;
      var sel = form.querySelector('[name="' + name.replace(/"/g, '') + '"]');
      if (sel && sel.value !== val) {
        sel.value = val;
        if (window.jQuery) window.jQuery(sel).trigger('change');
        else sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  };

  /* ----------------------------- open / close ----------------------------- */
  TryOn.prototype.open = function (opts) {
    opts = opts || {};
    if (!this.lenses.length) { console.warn('[LensTryOn] Chưa có lens nào có ảnh thử.'); return; }
    this._build();
    this.open_ = true;
    this.ui.root.classList.add('is-open');
    document.documentElement.classList.add('lto-lock');
    document.addEventListener('keydown', this._onKey);
    document.addEventListener('visibilitychange', this._onVis);

    var id = opts.lensId;
    if (!id) {
      var cur = this.lenses.filter(function (l) { return l.current; })[0];
      id = (cur || this.lenses[0]).id;
    }
    this.select(id);
    this.ui.root.querySelector(this.stream ? '.lto-close' : '.lto-start').focus();
    if (this.cameraGranted || opts.autostart) this.start();
  };

  TryOn.prototype.close = function () {
    if (!this.open_) return;
    this.open_ = false;
    this._stopCamera();
    this._hideShot();
    this.ui.root.classList.remove('is-open', 'is-running');
    document.documentElement.classList.remove('lto-lock');
    document.removeEventListener('keydown', this._onKey);
    document.removeEventListener('visibilitychange', this._onVis);
    if (this.opener && this.opener.focus) this.opener.focus();
  };

  TryOn.prototype._onKey = function (ev) { if (ev.key === 'Escape') this.close(); };
  TryOn.prototype._onVis = function () {
    if (document.hidden) this._stopCamera();
    else if (this.open_ && this.cameraGranted) this.start();
  };

  /* ----------------------------- camera ----------------------------- */
  TryOn.prototype._setStatus = function (text) {
    var ui = this.ui;
    ui.status.hidden = !text;
    ui.statusText.textContent = text || '';
  };
  TryOn.prototype._showError = function (text) {
    this._setStatus('');
    this.ui.consent.hidden = true;
    this.ui.error.hidden = false;
    this.ui.errorText.textContent = text;
  };

  TryOn.prototype.start = function () {
    var self = this, ui = this.ui;
    if (this.starting || this.stream) return;
    ui.consent.hidden = true;
    ui.error.hidden = true;
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      this._showError(window.isSecureContext === false ? T.errInsecure : T.errNoCamera);
      return;
    }
    this.starting = true;
    this._setStatus(T.loading);

    try {
      if (!this.renderer) this.renderer = new Renderer(ui.canvas);
    } catch (err) {
      this.starting = false;
      console.error(err);
      this._showError(T.errGeneric);
      return;
    }

    var lmP = getLandmarker();
    var camP = navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: 'user', width: { ideal: TUNE.camWidth }, height: { ideal: TUNE.camHeight }, frameRate: { ideal: 30 } }
    });

    camP.then(function (stream) {
      if (!self.open_) { stream.getTracks().forEach(function (t) { t.stop(); }); throw { silent: true }; }
      self.stream = stream;
      self.cameraGranted = true;
      ui.video.srcObject = stream;
      return ui.video.play().catch(function () {});
    }).then(function () {
      self._setStatus(T.loadingModel);
      return lmP;
    }).then(function (landmarker) {
      self.starting = false;
      if (!self.open_ || !self.stream) return;
      self.landmarker = landmarker;
      self._setStatus('');
      ui.root.classList.add('is-running');
      ui.tools.hidden = false;
      // Texture có thể đã được tải trước khi có renderer -> tạo lại.
      if (self.pending) self.select(self.pending.id);
      self._preloadAll();
      self.noFaceSince = performance.now();
      self._schedule();
    }).catch(function (err) {
      self.starting = false;
      if (err && err.silent) return;
      console.error('[LensTryOn]', err);
      self._stopCamera();
      var name = err && err.name;
      if (name === 'NotAllowedError' || name === 'SecurityError') self._showError(T.errDenied);
      else if (name === 'NotFoundError' || name === 'OverconstrainedError') self._showError(T.errNoCamera);
      else if (name === 'NotReadableError') self._showError(T.errBusy);
      else if (!self.stream && self.cameraGranted) self._showError(T.errModel);
      else self._showError(T.errGeneric);
    });
  };

  TryOn.prototype._stopCamera = function () {
    if (this.frameHandle != null) {
      var v = this.ui && this.ui.video;
      if (this.usingRVFC && v && v.cancelVideoFrameCallback) v.cancelVideoFrameCallback(this.frameHandle);
      else cancelAnimationFrame(this.frameHandle);
      this.frameHandle = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(function (t) { t.stop(); });
      this.stream = null;
    }
    if (this.ui) {
      this.ui.video.srcObject = null;
      this.ui.root.classList.remove('is-running');
      this.ui.tools.hidden = true;
      this.ui.guide.hidden = true;
    }
    this.lastVideoTime = -1;
  };

  TryOn.prototype._schedule = function () {
    var v = this.ui.video;
    this.usingRVFC = typeof v.requestVideoFrameCallback === 'function';
    this.frameHandle = this.usingRVFC ? v.requestVideoFrameCallback(this._loop) : requestAnimationFrame(this._loop);
  };

  /* ----------------------------- vòng lặp chính ----------------------------- */
  TryOn.prototype._loop = function () {
    this.frameHandle = null;
    if (!this.open_ || !this.stream) return;
    var v = this.ui.video;
    var now = performance.now();

    if (v.readyState >= 2 && v.videoWidth > 0 && (this.usingRVFC || v.currentTime !== this.lastVideoTime)) {
      this.lastVideoTime = v.currentTime;
      this.renderer.resize(v.videoWidth, v.videoHeight);
      var res = null;
      // MediaPipe yêu cầu timestamp (ms) tăng nghiêm ngặt, nếu trùng graph sẽ lỗi vĩnh viễn.
      var ts = Math.max(Math.round(now), (this.lastTs || 0) + 1);
      this.lastTs = ts;
      try { res = this.landmarker.detectForVideo(v, ts); } catch (err) { console.warn(err); }
      var t = now / 1000, eyes = null;
      var lm = res && res.faceLandmarks && res.faceLandmarks[0];
      if (lm && lm.length >= 478) {
        var mtx = res.facialTransformationMatrixes && res.facialTransformationMatrixes[0];
        eyes = this.tracker.update(lm, mtx, v.videoWidth, v.videoHeight, t);
        this.noFaceSince = 0;
      } else {
        this.tracker.lost(t);
        if (!this.noFaceSince) this.noFaceSince = now;
      }
      this._updateGuide(eyes, now);

      var lens = this.current, params = null;
      if (lens && lens.tex && !this.comparing) {
        params = { tex: lens.tex, scale: lens.scale, opacity: lens.opacity * this.userOpacity, pupil: lens.pupil };
      }
      this.renderer.render(v, eyes, params, t);

      if (this.shotRequested) { this.shotRequested = false; this._capture(); }
      this._tickFps(now);
    }
    this._schedule();
  };

  TryOn.prototype._updateGuide = function (eyes, now) {
    var msg = '';
    if (!eyes) { if (this.noFaceSince && now - this.noFaceSince > 800) msg = T.noFace; }
    else {
      var e = eyes[0] || eyes[1];
      if (e && e.D < this.renderer.H * 0.045) msg = T.tooFar;
    }
    if (msg !== this._guideMsg) {
      this._guideMsg = msg;
      this.ui.guide.hidden = !msg;
      this.ui.guideText.textContent = msg;
    }
  };

  TryOn.prototype._tickFps = function (now) {
    if (!this.debug) return;
    var f = this.fps;
    f.n++;
    if (now - f.t > 1000) {
      f.v = Math.round(f.n * 1000 / (now - f.t)); f.n = 0; f.t = now;
      this.ui.debug.textContent = f.v + ' fps · ' + this.renderer.W + '×' + this.renderer.H;
    }
  };

  /* ----------------------------- chụp ảnh ----------------------------- */
  TryOn.prototype._capture = function () {
    var self = this, src = this.ui.canvas, W = src.width, H = src.height;
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var ctx = c.getContext('2d');
    ctx.translate(W, 0); ctx.scale(-1, 1);           // ảnh soi gương như người dùng đang thấy
    ctx.drawImage(src, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    var label = (this.current ? this.current.label : '') + (CFG.watermark ? '  ·  ' + CFG.watermark : '');
    if (label) {
      var fs = Math.round(H * 0.03);
      ctx.font = '600 ' + fs + 'px system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,.45)';
      var tw = ctx.measureText(label).width;
      ctx.fillRect(fs * 0.6, H - fs * 2.4, tw + fs * 1.2, fs * 1.7);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, fs * 1.2, H - fs * 1.0);
    }
    c.toBlob(function (blob) {
      if (!blob) return;
      if (self._shotUrl) URL.revokeObjectURL(self._shotUrl);
      self._shotUrl = URL.createObjectURL(blob);
      self._shotBlob = blob;
      var ui = self.ui;
      ui.shotImg.src = self._shotUrl;
      ui.download.href = self._shotUrl;
      var file = new File([blob], 'thu-lens.jpg', { type: 'image/jpeg' });
      var canShare = navigator.canShare && navigator.canShare({ files: [file] });
      ui.share.hidden = !canShare;
      ui.share.onclick = function () { navigator.share({ files: [file], title: T.title }).catch(function () {}); };
      ui.shot.hidden = false;
    }, 'image/jpeg', 0.92);
  };
  TryOn.prototype._hideShot = function () {
    if (!this.ui) return;
    this.ui.shot.hidden = true;
  };

  /* ----------------------------- giỏ hàng ----------------------------- */
  TryOn.prototype._toast = function (html, ms) {
    var t = this.ui.toast;
    t.innerHTML = html;
    t.hidden = false;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(function () { t.hidden = true; }, ms || 3500);
  };

  TryOn.prototype._addToCart = function () {
    var self = this, lens = this.pending || this.current, btn = this.ui.add;
    if (!lens || btn.disabled) return;
    if (typeof CFG.onAddToCart === 'function') { CFG.onAddToCart(lens, this); return; }
    if (lens.needsOptions) {
      if (lens.current) { this.close(); var f = document.querySelector('form.cart, form.variations_form'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      else if (lens.url) location.href = lens.url;
      return;
    }
    var span = btn.querySelector('span'), prev = span.textContent;
    btn.disabled = true; span.textContent = T.adding;
    var fd = new FormData();
    fd.append('product_id', lens.productId);
    fd.append('variation_id', lens.variationId || 0);
    fd.append('quantity', 1);
    fetch(CFG.addToCartUrl, { method: 'POST', body: fd, credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || data.error) {
          self._toast(esc((data && data.message) || T.errAdd));
          if (data && data.product_url && !lens.current) setTimeout(function () { location.href = data.product_url; }, 1500);
          return;
        }
        // Cập nhật mini-cart của theme giống WooCommerce gốc.
        var $ = window.jQuery;
        if ($ && data.fragments) {
          $.each(data.fragments, function (key, value) { $(key).replaceWith(value); });
          $(document.body).trigger('added_to_cart', [data.fragments, data.cart_hash, $(btn)]);
        }
        self._toast(esc(T.added) + (CFG.cartUrl ? ' · <a href="' + esc(CFG.cartUrl) + '">' + esc(T.viewCart) + '</a>' : ''));
      })
      .catch(function (err) { console.error(err); self._toast(esc(T.errAdd)); })
      .then(function () { btn.disabled = !lens.inStock; span.textContent = prev; });
  };

  /* ------------------------------------------------------------------ */
  /*  Khởi tạo + API công khai                                           */
  /* ------------------------------------------------------------------ */
  var instance = null;
  function get() { return instance || (instance = new TryOn()); }

  window.LensTryOn = {
    open: function (opts) { get().open(opts); },
    close: function () { if (instance) instance.close(); },
    setLenses: function (list) { get().setLenses(list); },
    addLenses: function (list) { var i = get(); i.setLenses((CFG.lenses = (CFG.lenses || []).concat(list || []))); },
    _internals: { Tracker: Tracker, OneEuro: OneEuro, Renderer: Renderer, loadLensCanvas: loadLensCanvas }
  };

  // Biến thể đang chọn trên trang sản phẩm -> chọn sẵn khi mở.
  var currentVariation = 0;
  if (window.jQuery) {
    window.jQuery(document).on('found_variation', 'form.variations_form', function (ev, v) { currentVariation = v && v.variation_id; });
    window.jQuery(document).on('reset_data', 'form.variations_form', function () { currentVariation = 0; });
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest && ev.target.closest('[data-lens-tryon]');
    if (!btn) return;
    ev.preventDefault();
    var inst = get();
    inst.opener = btn;
    var id = btn.getAttribute('data-lens-id') || (currentVariation ? String(currentVariation) : null);
    if (id && !inst.lenses.some(function (l) { return l.id === String(id); })) id = null;
    inst.open({ lensId: id });
  });
})();
