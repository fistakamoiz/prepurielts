(() => {
  /* ---------- intro animation ---------- */
  const WORD = "prepielts", GAP = 2, DOT = 0.8, HOLD = 150, DURATION = 1000, SHOW = 2900;
  try { if (localStorage.getItem("introSeen")) return; localStorage.setItem("introSeen", "1"); } catch (e) {}
  const box = document.createElement("div"); box.id = "intro";
  const cv = document.createElement("canvas"); box.appendChild(cv); document.body.appendChild(box);
  const ctx = cv.getContext("2d");
  let W, H, S = 1, parts = [], t0 = performance.now(), raf = 0, gone = false;
  const ease = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  const clamp = v => Math.max(0, Math.min(1, v));
  function build() {
    W = innerWidth; H = innerHeight; S = W * H < 2500000 ? 3 : 2;
    cv.width = W * S; cv.height = H * S; cv.style.width = W + "px"; cv.style.height = H + "px"; ctx.setTransform(S, 0, 0, S, 0, 0);
    const off = document.createElement("canvas"); off.width = W; off.height = H;
    const o = off.getContext("2d");
    o.fillStyle = "#fff"; o.font = "300 " + Math.min(W / 4.5, 220) + "px sans-serif"; o.textAlign = "center"; o.textBaseline = "middle";
    o.fillText(WORD, W / 2, H / 2);
    const d = o.getImageData(0, 0, W, H).data; parts = [];
    for (let y = 0; y < H; y += GAP) for (let x = 0; x < W; x += GAP)
      if (d[(y * W + x) * 4 + 3] > 128) parts.push({ sx: Math.random() * W, sy: Math.random() * H, tx: x, ty: y, delay: Math.random() * 1200, ph: Math.random() * 6.28 });
    const extra = Math.floor(W * H / 1200);
    for (let i = 0; i < extra; i++) parts.push({ sx: Math.random() * W, sy: Math.random() * H, tx: null, ph: Math.random() * 6.28 });
  }
  function frame(now) {
    if (gone) return;
    const time = now - t0; ctx.clearRect(0, 0, W, H); ctx.fillStyle = "#fff";
    for (const p of parts) {
      const w1 = Math.sin(time * 0.002 + p.ph), w2 = Math.cos(time * 0.0017 + p.ph);
      if (p.tx !== null) {
        const e = ease(clamp((time - HOLD - p.delay) / DURATION)), amp = 8 * (1 - e) + 0.6;
        ctx.globalAlpha = 1; ctx.fillRect(p.sx + (p.tx - p.sx) * e + w1 * amp, p.sy + (p.ty - p.sy) * e + w2 * amp, DOT, DOT);
      } else {
        const f = 1 - clamp((time - HOLD) / DURATION);
        if (f > 0) { ctx.globalAlpha = 0.7 * f; ctx.fillRect(p.sx + w1 * 8, p.sy + w2 * 8, DOT, DOT); }
      }
    }
    raf = requestAnimationFrame(frame);
  }
  function end() { if (gone) return; gone = true; cancelAnimationFrame(raf); box.classList.add("out"); setTimeout(() => box.remove(), 800); }
  build(); raf = requestAnimationFrame(frame);
  setTimeout(end, SHOW); box.addEventListener("click", end);
  addEventListener("resize", () => { if (!gone) build(); });
})();
(() => {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = window.APP_CONFIG;
  const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  let profile = null;
  let passages = [];
  let timerId = null;
  let readerIsHtml = false;
  let dashKind = "reading";
  let doneIds = new Set();   // ids of passages this student has finished

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const preview = p => p.body ? p.body.slice(0, 190).trim() + "…" : (p.kind === "listening" ? "Listening test with audio and questions. Open it to start." : "Interactive passage with questions. Open it to start.");
  // newest first: by date, then by number in the title (#11 before #10), then by upload time
  const newestFirst = (a, b) => b.publish_date.localeCompare(a.publish_date) || (b.title || "").localeCompare(a.title || "", undefined, { numeric: true }) || (b.created_at || "").localeCompare(a.created_at || "");

  /* ---------- locks: unlock date/time + "only after solving ..." ---------- */
  const LOCK_VERB = { reading: "solving", listening: "completing", speaking: "watching" };
  const fmtDT = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const toLocalInput = iso => { if (!iso) return ""; const d = new Date(iso), z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()); };
  function lockInfo(p, pool) {
    if (profile?.role === "admin") return null;
    if (p.unlock_after && !doneIds.has(p.unlock_after)) {
      const pre = pool.find(x => x.id === p.unlock_after);
      return "Only after " + (LOCK_VERB[p.kind || "reading"] || "solving") + " " + (pre ? pre.title : "the previous test");
    }
    if (p.unlock_at && new Date(p.unlock_at) > new Date()) return "Unlocks on " + fmtDT(p.unlock_at);
    return null;
  }
  const LOCK_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>';
  function lockGlass(text) { const g = el("div", "lock-glass"); g.innerHTML = LOCK_SVG; g.appendChild(el("span", "", text)); return g; }

  function toast(msg, err) {
    const t = $("#toast"); t.textContent = msg; t.classList.toggle("err", !!err); t.classList.remove("hidden");
    clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add("hidden"), 3200);
  }

  /* ---------- landing decorations ---------- */
  $("#yr").textContent = new Date().getFullYear();
  const wave = $("#wave");
  for (let i = 0; i < 42; i++) { const b = el("i"); b.style.animationDelay = (i * 0.07) + "s"; b.style.animationDuration = (0.8 + Math.random() * 0.9) + "s"; wave.appendChild(b); }
  const words = ["Listening", "Reading", "Band 7+", "Skimming", "Scanning", "Daily practice", "True / False / Not Given", "Matching headings", "Time yourself", "Keep going"];
  const mq = $("#marquee");
  [...words, ...words].forEach(w => mq.appendChild(el("span", "", w + " ·")));
  $$(".feat").forEach(f => f.addEventListener("pointermove", e => {
    const r = f.getBoundingClientRect(); f.style.setProperty("--x", (e.clientX - r.left) + "px"); f.style.setProperty("--y", (e.clientY - r.top) + "px");
  }));

  /* ---------- views ---------- */
  function show(view) {
    if (view === "tasks") view = "dashboard";
    if ((view === "dashboard" || view === "reader" || view === "board") && !profile) view = "landing";
    if (view !== "reader") { openToken++; pauseAttempt(); $$("#textHost audio").forEach(a => a.pause()); }
    if (view === "admin" && profile?.role !== "admin") view = profile ? "dashboard" : "landing";
    $$(".view").forEach(v => v.classList.add("hidden"));
    $("#view-" + view).classList.remove("hidden");
    document.body.classList.toggle("reading-html", view === "reader" && readerIsHtml);
    window.scrollTo(0, 0);
    if (view === "dashboard") loadPassages();
    if (view === "board") loadBoard();
    if (view === "admin") { loadAdminPassages(); loadUsers(); }
  }
  document.addEventListener("click", e => {
    const g = e.target.closest("[data-go]"); if (g) { e.preventDefault(); show(g.dataset.go); }
    if (e.target.closest("[data-open-login]")) openLogin();
  });

  function applyAuthUI() {
    const logged = !!profile;
    $("#btnLogin").hidden = logged; $("#btnLogout").hidden = !logged;
    $("#who").classList.toggle("hidden", !logged);
    $("#who").textContent = logged ? profile.full_name || profile.email : "";
    $$(".auth-only").forEach(n => n.classList.toggle("hidden", !logged));
    $$(".admin-only").forEach(n => n.classList.toggle("hidden", profile?.role !== "admin"));
  }

  /* ---------- auth ---------- */
  function openLogin() { $("#loginModal").classList.remove("hidden"); $("#lMsg").textContent = ""; setTimeout(() => $("#lEmail").focus(), 50); }
  function closeLogin() { $("#loginModal").classList.add("hidden"); }
  $("#btnLogin").onclick = openLogin;
  $("#closeLogin").onclick = closeLogin;
  $("#loginModal").addEventListener("click", e => { if (e.target.id === "loginModal") closeLogin(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeLogin(); });

  $("#loginForm").addEventListener("submit", async e => {
    e.preventDefault();
    const btn = $("#lSubmit"); btn.disabled = true; btn.textContent = "Logging in…"; $("#lMsg").textContent = "";
    const { error } = await sb.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
    btn.disabled = false; btn.textContent = "Log in";
    if (error) { console.error(error); $("#lMsg").textContent = error.message === "Invalid login credentials" ? "Incorrect email or password." : error.message; return; }
    closeLogin(); $("#loginForm").reset();
    await bootSession(true);
  });

  $("#togglePass").onclick = () => {
    const i = $("#lPass"), b = $("#togglePass"), show = i.type === "password";
    i.type = show ? "text" : "password"; b.classList.toggle("on", show);
    b.setAttribute("aria-label", show ? "Hide password" : "Show password"); i.focus();
  };

  $("#btnLogout").onclick = async () => { pauseAttempt(); await new Promise(r => setTimeout(r, 300)); frames.forEach(e => e.el.remove()); frames.clear(); activeEnt = att = null; await sb.auth.signOut(); profile = null; applyAuthUI(); show("landing"); toast("Logged out"); };

  async function bootSession(goDash) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { profile = null; applyAuthUI(); show("landing"); return; }
    const { data, error } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
    if (error || !data) { await sb.auth.signOut(); profile = null; applyAuthUI(); toast("Profile not found. Ask your teacher.", true); return; }
    profile = data; applyAuthUI();
    if (goDash) show(profile.role === "admin" ? "admin" : "dashboard");
    else if (!$("#view-landing").classList.contains("hidden")) show("dashboard");
  }

  /* ---------- dashboard ---------- */
  async function loadPassages() {
    $("#todayLabel").textContent = fmtDate(todayStr());
    $$("#taskKind button").forEach(b => b.classList.toggle("active", b.dataset.kind === dashKind));
    const [res, done] = await Promise.all([
      sb.from("passages").select("*").eq("kind", dashKind).lte("publish_date", todayStr()).order("publish_date", { ascending: false }),
      sb.from("attempts").select("passage_id").eq("user_id", profile.id).eq("finished", true)
    ]);
    if (res.error) { toast("Could not load passages: " + res.error.message, true); return; }
    doneIds = new Set((done.data || []).map(a => a.passage_id));
    passages = res.data.sort(newestFirst); renderPassages();
  }
  function renderPassages() {
    const q = $("#search").value.trim().toLowerCase();
    const filtered = passages.filter(p => !q || (p.title + " " + (p.topic || "")).toLowerCase().includes(q));
    const todayBox = $("#todayBox"), list = $("#passageList");
    todayBox.replaceChildren(); list.replaceChildren();
    $("#emptyMsg").classList.toggle("hidden", passages.length > 0);
    const today = filtered[0]; // newest passage = big card
    if (today) {
      const c = el("div", "today");
      const m = el("div", "meta"); m.append(el("span", "tag", (today.publish_date === todayStr() ? "TODAY'S " : "LATEST ") + (today.kind === "listening" ? "LISTENING" : "PASSAGE")), el("span", "chip lv-" + today.level, today.level), el("span", "chip", today.topic || "General"));
      c.append(m, el("h3", "", today.title), el("p", "", preview(today)), el("span", "btn primary", today.kind === "listening" ? "Start LISTENING →" : "Start reading →"));
      const lk = lockInfo(today, passages);
      if (lk) { c.classList.add("locked"); c.appendChild(lockGlass(lk)); c.onclick = () => toast(lk, true); }
      else c.onclick = () => openReader(today);
      todayBox.appendChild(c);
    }
    filtered.filter(p => p !== today).forEach(p => {
      const it = el("div", "item"); const l = el("div");
      l.append(el("h4", "", p.title));
      const m = el("div", "meta"); m.append(el("span", "chip", fmtDate(p.publish_date)), el("span", "chip lv-" + p.level, p.level), el("span", "chip", p.topic || "General")); l.appendChild(m);
      it.append(l, el("span", "mono muted", "OPEN →"));
      const lk = lockInfo(p, passages);
      if (lk) { it.classList.add("locked"); it.appendChild(lockGlass(lk)); it.onclick = () => toast(lk, true); }
      else it.onclick = () => openReader(p);
      list.appendChild(it);
    });
  }
  $("#search").addEventListener("input", renderPassages);
  $$("#taskKind button").forEach(b => b.onclick = () => { dashKind = b.dataset.kind; loadPassages(); });

  /* ---------- reader + stopwatch (leaderboard) ---------- */
  const frames = new Map();   // passage id -> { el, pid, sig, done, secs }
  let activeEnt = null, att = null, tickId = null, saveId = null, openToken = 0;

  // Small scripts injected into the pasted test HTML (it runs in a sandboxed iframe):
  // 1) lets us pause the test's own countdown, 2) reports the score when the test is submitted.
  const BRIDGE_HEAD = "<script>(function(){var p=false,o=window.setInterval;window.setInterval=function(f,t){var a=[].slice.call(arguments,2);return o(function(){if(!p)f.apply(null,a)},t)};window.addEventListener('message',function(e){var d=e.data;if(d&&d.uk==='pause'){p=true;try{[].forEach.call(document.querySelectorAll('audio,video'),function(m){m.pause()})}catch(x){}}if(d&&d.uk==='resume')p=false})})();</script>";
  const BRIDGE_BODY = "<script>(function(){var sent=false;function chk(){if(sent)return;var b=document.getElementById('deliver-button'),m=document.querySelector('#rv-modal .rv-score');if(b&&m&&b.classList.contains('rv-done')){var r=(m.textContent||'').match(/(\\d+)\\s*\\/\\s*(\\d+)/);if(r){sent=true;try{parent.postMessage({uk:'result',score:+r[1],total:+r[2]},'*')}catch(e){}}}}new MutationObserver(chk).observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['class']});})();</script>";
  function withBridge(html) {
    const h = html.search(/<head[^>]*>/i);
    if (h >= 0) { const end = html.indexOf(">", h) + 1; html = html.slice(0, end) + BRIDGE_HEAD + html.slice(end); }
    const i = html.toLowerCase().lastIndexOf("</body>");
    return i >= 0 ? html.slice(0, i) + BRIDGE_BODY + html.slice(i) : html + BRIDGE_BODY;
  }
  const postFrame = type => { try { activeEnt?.el.contentWindow?.postMessage({ uk: type }, "*"); } catch (e) {} };

  const mmss = s => { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0"); };
  const elapsed = () => att ? att.base + (att.t0 ? (Date.now() - att.t0) / 1000 : 0) : 0;
  function setClock(sec) { const t = mmss(sec); $("#timer").textContent = t; $("#fsTimer").textContent = t; }
  const paintClock = () => setClock(elapsed());
  function startTick() { stopTick(); tickId = setInterval(paintClock, 500); saveId = setInterval(() => saveAttempt(), 10000); }
  function stopTick() { clearInterval(tickId); clearInterval(saveId); tickId = saveId = null; }
  async function saveAttempt(extra = {}) {
    if (!att) return;
    const { error } = await sb.from("attempts").update({ elapsed_seconds: Math.round(elapsed()), updated_at: new Date().toISOString(), ...extra }).eq("id", att.id);
    if (error) console.error(error);
  }
  function pauseAttempt() {
    if (!att || att.finished || !att.t0) return;
    att.base = elapsed(); att.t0 = null; stopTick(); paintClock(); postFrame("pause"); saveAttempt();
  }
  async function beginAttempt(p, token) {
    att = null; setClock(0);
    const sel = await sb.from("attempts").select("*").eq("passage_id", p.id).eq("user_id", profile.id).eq("finished", false).order("created_at", { ascending: false }).limit(1);
    if (token !== openToken) return;
    if (sel.error) { toast("Leaderboard is not set up yet: " + sel.error.message, true); return; }
    let row = sel.data?.[0];
    if (!row) {
      const name = (profile.full_name || "").trim() || (profile.email || "").split("@")[0];
      const ins = await sb.from("attempts").insert({ passage_id: p.id, user_id: profile.id, full_name: name, kind: p.kind || "reading" }).select().single();
      if (token !== openToken) return;
      if (ins.error) { toast(ins.error.message, true); return; }
      row = ins.data;
    }
    att = { id: row.id, pid: p.id, base: row.elapsed_seconds || 0, t0: Date.now(), finished: false };
    postFrame("resume"); startTick(); paintClock();
  }

  // the test reports its score when the student submits -> stop the stopwatch and save
  window.addEventListener("message", async e => {
    const d = e.data; if (!d || d.uk !== "result") return;
    const ent = [...frames.values()].find(x => x.el.contentWindow === e.source);
    if (!ent || ent.done) return;
    ent.done = true;
    if (att && att.pid === ent.pid && !att.finished) {
      att.base = elapsed(); att.t0 = null; att.finished = true; ent.secs = att.base; stopTick(); paintClock();
      await saveAttempt({ score: +d.score, total: +d.total || 40, finished: true, finished_at: new Date().toISOString() });
      doneIds.add(ent.pid);
      toast("Result saved to the leaderboard");
    }
  });

  function openReader(p) {
    const lk = lockInfo(p, passages); if (lk) return toast(lk, true);
    $("#rTitle").textContent = p.title;
    const isHtml = !!p.html;
    readerIsHtml = isHtml;
    dashKind = p.kind === "listening" ? "listening" : "reading";
    $(".reader").classList.toggle("html-mode", isHtml);
    const host = $("#frameHost"), textHost = $("#textHost");
    $$(".html-frame", host).forEach(f => f.classList.remove("active"));
    textHost.replaceChildren();
    openToken++; const token = openToken;
    if (isHtml) {
      const sig = String(p.html.length);
      let ent = frames.get(p.id);
      if (ent && ent.sig !== sig) { ent.el.remove(); frames.delete(p.id); ent = null; }
      if (!ent) {
        const f = document.createElement("iframe");
        f.className = "html-frame";
        f.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-modals");
        f.setAttribute("allow", "fullscreen; autoplay");
        f.srcdoc = withBridge(p.html);
        host.appendChild(f);
        ent = { el: f, pid: p.id, sig, done: false, secs: 0 };
        frames.set(p.id, ent);
      }
      ent.el.classList.add("active"); activeEnt = ent;
      resetTimer(); show("reader");
      if (ent.done) { att = null; setClock(ent.secs); } else beginAttempt(p, token);
    } else {
      activeEnt = null; att = null;
      const h = el("h1", "", p.title); textHost.appendChild(h);
      const m = el("div", "meta"); m.style.marginBottom = "26px"; m.append(el("span", "chip", fmtDate(p.publish_date)), el("span", "chip lv-" + p.level, p.level), el("span", "chip", p.topic || "General")); textHost.appendChild(m);
      if (p.audio_url && /^https?:\/\//i.test(p.audio_url)) { const a = document.createElement("audio"); a.controls = true; a.src = p.audio_url; a.className = "audio"; textHost.appendChild(a); }
      (p.body || "").split(/\n\s*\n/).forEach(par => { if (par.trim()) textHost.appendChild(el("p", "", par.trim())); });
      $("#rQuestions").textContent = p.questions || "No questions for this passage.";
      $("#rAnswers").textContent = p.answers || "No answer key provided."; $("#rAnswers").classList.add("hidden");
      $("#btnReveal").classList.remove("hidden");
      resetTimer(); show("reader");
    }
  }
  $("#btnBack").onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); show("dashboard"); };
  $("#btnReveal").onclick = () => { $("#rAnswers").classList.remove("hidden"); $("#btnReveal").classList.add("hidden"); };

  function resetTimer() { clearInterval(timerId); timerId = null; $("#timer").textContent = "20:00"; $("#timer").classList.remove("low"); $("#btnTimer").textContent = "Start timer"; }
  $("#btnTimer").onclick = () => {
    if (timerId) { resetTimer(); return; }
    let left = 20 * 60; $("#btnTimer").textContent = "Reset";
    timerId = setInterval(() => {
      left--; const mm = String(Math.floor(left / 60)).padStart(2, "0"), ss = String(left % 60).padStart(2, "0");
      $("#timer").textContent = mm + ":" + ss; $("#timer").classList.toggle("low", left <= 120);
      if (left <= 0) { clearInterval(timerId); timerId = null; toast("Time is up!", true); }
    }, 1000);
  };

  /* ---------- leaderboard ---------- */
  let boardRange = "week";
  const weekStartISO = () => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString(); }; // Monday 00:00
  const loadBoard = () => renderBoard();
  const longTime = sec => { sec = Math.max(0, Math.round(sec)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return h ? h + "h " + m + "m" : m ? m + "m " + x + "s" : x + "s"; };
  async function renderBoard() {
    const list = $("#boardList"), empty = $("#boardEmpty");
    let q = sb.from("attempts").select("user_id,passage_id,full_name,score,total,elapsed_seconds,finished_at").eq("finished", true);
    if (boardRange === "week") q = q.gte("finished_at", weekStartISO());
    const { data, error } = await q;
    if (error) return toast(error.message, true);
    list.replaceChildren();
    // 1) best attempt per student per test  2) add up each student's tests
    const bestPerTest = new Map();
    (data || []).forEach(a => {
      const k = a.user_id + "|" + a.passage_id, cur = bestPerTest.get(k);
      if (!cur || a.score > cur.score || (a.score === cur.score && a.elapsed_seconds < cur.elapsed_seconds)) bestPerTest.set(k, a);
    });
    const users = new Map();
    bestPerTest.forEach(a => {
      const u = users.get(a.user_id) || { id: a.user_id, name: a.full_name, tests: 0, points: 0, secs: 0 };
      u.tests++; u.points += a.score; u.secs += a.elapsed_seconds; users.set(a.user_id, u);
    });
    const rows = [...users.values()].sort((a, b) => b.points - a.points || a.secs - b.secs);
    empty.classList.toggle("hidden", rows.length > 0);
    if (!rows.length) return;
    const head = el("div", "brow bhead"); head.append(el("span", "", "RANK"), el("span", "", "NAME"), el("span", "", "TIME")); list.appendChild(head);
    rows.forEach((u, i) => {
      const r = el("div", "brow" + (i < 3 ? " r" + (i + 1) : "") + (u.id === profile?.id ? " me" : ""));
      r.append(el("span", "rank", String(i + 1)), el("span", "nm", u.name || "Student"), el("span", "tm mono", longTime(u.secs)));
      list.appendChild(r);
    });
  }
  $$("#boardRange button").forEach(b => b.onclick = () => {
    boardRange = b.dataset.range;
    $$("#boardRange button").forEach(x => x.classList.toggle("active", x === b));
    renderBoard();
  });

  /* ---------- full screen ---------- */
  $("#btnFull").onclick = () => {
    const v = $("#view-reader");
    const req = v.requestFullscreen || v.webkitRequestFullscreen;
    if (req) req.call(v);
    else toast("Full screen is not supported on this device", true);
  };
  $("#btnExitFull").onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); };

  /* ---------- admin ---------- */
  $$(".tab").forEach(t => t.onclick = () => {
    if (t.dataset.kind) {
      if ($("#pId").value && $("#pKind").value !== t.dataset.kind) resetPassageForm(); // switching section cancels an edit
      $("#pKind").value = t.dataset.kind; applyKind();
    }
    $$(".tab").forEach(x => x.classList.toggle("active", x === t));
    $$(".tabpane").forEach(p => p.classList.toggle("hidden", p.id !== t.dataset.tab));
  });
  $("#pDate").value = todayStr();

  let adminAll = [];   // all passages, to fill the "Only after ..." list
  const AFTER_LABEL = { reading: "Only after solving", listening: "Only after completing" };
  function fillAfter(sel) {
    const s = $("#pAfter"), kind = $("#pKind").value, cur = sel !== undefined ? sel : s.value, me = $("#pId").value;
    s.replaceChildren(new Option("— No requirement —", ""));
    adminAll.filter(p => (p.kind || "reading") === kind && p.id !== me).sort(newestFirst).forEach(p => s.add(new Option(p.title, p.id)));
    s.value = [...s.options].some(o => o.value === cur) ? cur : "";
  }
  let mode = "file";
  let picked = []; // [{ name, html, title, size }]
  function setMode(m) {
    mode = m;
    $$("#passageForm .seg button").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
    $("#fileBlock").classList.toggle("hidden", m !== "file");
    $("#htmlBlock").classList.toggle("hidden", m !== "html");
    $("#textBlock").classList.toggle("hidden", m !== "text");
    $("#pHtml").required = m === "html"; $("#pTitle").required = m !== "file"; applyKind();
  }
  $$("#passageForm .seg button").forEach(b => b.onclick = () => setMode(b.dataset.mode));
  function applyKind() {
    const listening = $("#pKind").value === "listening";
    $("#formTitle").textContent = listening ? "Add a listening test" : "Add a reading passage";
    $("#pTitle").placeholder = listening ? "e.g. Listening Test 1" : "e.g. The Secret Life of Bees";
    $("#audioRow").classList.toggle("hidden", !listening);
    $("#pAfterLabel").textContent = AFTER_LABEL[listening ? "listening" : "reading"];
    fillAfter();
    $("#pBody").required = mode === "text" && !listening;
  }
  $("#pKind").addEventListener("change", applyKind);
  setMode("file");

  const htmlTitle = (html, fallback) => {
    const d = new DOMParser().parseFromString(html, "text/html");
    return ((d.querySelector("title")?.textContent || d.querySelector("h1")?.textContent || "").trim() || fallback).replace(/\s+/g, " ").slice(0, 120);
  };
  $("#pHtml").addEventListener("input", () => { if (!$("#pTitle").value.trim()) { const t = htmlTitle($("#pHtml").value, ""); if (t) $("#pTitle").value = t; } });

  // ----- upload HTML file(s): the site reads the HTML out of the files itself -----
  function renderPicked() {
    const box = $("#fileList"); box.replaceChildren();
    picked.forEach((f, i) => {
      const r = el("div", "fitem"); const g = el("div", "grow");
      g.append(el("b", "", f.title), el("span", "muted mono", f.name + " · " + Math.max(1, Math.round(f.size / 1024)) + " KB"));
      const x = el("button", "btn sm", "Remove"); x.type = "button"; x.onclick = () => { picked.splice(i, 1); renderPicked(); };
      r.append(g, x); box.appendChild(r);
    });
    const hint = $("#fileHint");
    hint.classList.toggle("hidden", picked.length < 2);
    hint.textContent = picked.length > 1 ? picked.length + " files: each one becomes its own passage, one per day, starting from the publish date above." : "";
    if (picked.length === 1 && !$("#pTitle").value.trim()) $("#pTitle").value = picked[0].title;
  }
  async function addFiles(list) {
    for (const f of list) {
      if (!/\.(html?|txt)$/i.test(f.name)) { toast(f.name + " is not an HTML file", true); continue; }
      const html = (await f.text()).trim();
      if (!/<\s*(html|body|div|script|p)\b/i.test(html)) { toast(f.name + " does not look like HTML", true); continue; }
      picked.push({ name: f.name, html, size: f.size, title: htmlTitle(html, f.name.replace(/\.[^.]+$/, "")) });
    }
    renderPicked();
  }
  $("#pFile").addEventListener("change", async e => { await addFiles([...e.target.files]); e.target.value = ""; });
  const dz = $("#dropZone");
  ["dragenter", "dragover"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove("over"); }));
  dz.addEventListener("drop", e => addFiles([...e.dataTransfer.files]));

  function resetPassageForm() { const keepKind = $("#pKind").value; picked = []; renderPicked(); setMode("file"); $("#passageForm").reset(); $("#pKind").value = keepKind; applyKind(); $("#pId").value = ""; $("#pDate").value = todayStr(); $("#pSubmit").textContent = "Publish passage"; $("#pCancel").hidden = true; }
  $("#pCancel").onclick = resetPassageForm;

  const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

  $("#passageForm").addEventListener("submit", async e => {
    e.preventDefault();
    const base = { kind: $("#pKind").value, audio_url: null, topic: $("#pTopic").value.trim() || null, level: $("#pLevel").value, body: null, questions: null, answers: null,
      unlock_at: $("#pUnlockAt").value ? new Date($("#pUnlockAt").value).toISOString() : null, unlock_after: $("#pAfter").value || null };
    const id = $("#pId").value;
    let rows;
    if (mode === "file") {
      if (!picked.length) return toast("Choose an HTML file first", true);
      if (id && picked.length > 1) return toast("Choose just one file when editing", true);
      rows = picked.map((f, i) => ({ ...base, title: (picked.length === 1 && $("#pTitle").value.trim()) || f.title, publish_date: addDays($("#pDate").value, i), html: f.html }));
    } else if (mode === "html") {
      const html = $("#pHtml").value.trim(); if (!html) return toast("Paste the passage HTML first", true);
      rows = [{ ...base, title: $("#pTitle").value.trim(), publish_date: $("#pDate").value, html }];
    } else {
      const audioUrl = base.kind === "listening" ? ($("#pAudio").value.trim() || null) : null;
      if (audioUrl && !/^https?:\/\//i.test(audioUrl)) return toast("Audio link must start with https://", true);
      rows = [{ ...base, audio_url: audioUrl, title: $("#pTitle").value.trim(), publish_date: $("#pDate").value, html: null, body: $("#pBody").value.trim(), questions: $("#pQuestions").value.trim() || null, answers: $("#pAnswers").value.trim() || null }];
    }
    const btn = $("#pSubmit"); btn.disabled = true;
    const { error } = id ? await sb.from("passages").update(rows[0]).eq("id", id) : await sb.from("passages").insert(rows);
    btn.disabled = false;
    if (error) { $("#pMsg").textContent = ""; return toast(error.message, true); }
    toast(id ? "Passage updated" : rows.length > 1 ? rows.length + " passages published" : "Passage published"); resetPassageForm(); loadAdminPassages();
  });

  let adminKind = "all";
  $$("#adminKind button").forEach(b => b.onclick = () => {
    adminKind = b.dataset.akind;
    $$("#adminKind button").forEach(x => x.classList.toggle("active", x === b));
    loadAdminPassages();
  });
  async function loadAdminPassages() {
    const res = await sb.from("passages").select("*").order("publish_date", { ascending: false });
    const box = $("#adminPassages"); box.replaceChildren();
    if (res.error) return toast(res.error.message, true);
    adminAll = res.data; fillAfter();
    const data = res.data.filter(p => adminKind === "all" || (p.kind || "reading") === adminKind).sort(newestFirst);
    if (!data.length) box.appendChild(el("p", "muted", "Nothing here yet."));
    data.forEach(p => {
      const r = el("div", "trow"); const g = el("div", "grow");
      g.append(el("b", "", p.title), el("span", "muted mono", (p.kind || "reading").toUpperCase() + " · " + fmtDate(p.publish_date) + " · " + p.level + (p.publish_date > todayStr() ? " · SCHEDULED" : "")));
      const a = el("div", "acts"); const ed = el("button", "btn sm", "Edit"), del = el("button", "btn sm danger", "Delete");
      ed.onclick = () => {
        $(`.tab[data-kind="${p.kind === "listening" ? "listening" : "reading"}"]`).click();
        $("#pId").value = p.id; $("#pTitle").value = p.title; $("#pTopic").value = p.topic || ""; $("#pLevel").value = p.level; $("#pDate").value = p.publish_date;
        $("#pHtml").value = p.html || ""; $("#pBody").value = p.body || ""; $("#pQuestions").value = p.questions || ""; $("#pAnswers").value = p.answers || "";
        $("#pKind").value = p.kind || "reading"; $("#pAudio").value = p.audio_url || "";
        $("#pUnlockAt").value = toLocalInput(p.unlock_at); fillAfter(p.unlock_after || "");
        setMode(p.html ? "html" : "text");
        $("#pSubmit").textContent = "Save changes"; $("#pCancel").hidden = false;
        window.scrollTo(0, 0);
      };
      del.onclick = async () => { if (!confirm("Delete this passage?")) return; const { error } = await sb.from("passages").delete().eq("id", p.id); if (error) return toast(error.message, true); toast("Deleted"); loadAdminPassages(); };
      a.append(ed, del); r.append(g, a); box.appendChild(r);
    });
  }

  async function callAdminFn(payload) {
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(SUPABASE_URL + "/functions/v1/dynamic-endpoint", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + session.access_token, apikey: SUPABASE_ANON_KEY }, body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "Request failed");
    return json;
  }

  $("#userForm").addEventListener("submit", async e => {
    e.preventDefault(); $("#uMsg").textContent = "Creating…";
    try {
      await callAdminFn({ action: "create", email: $("#uEmail").value.trim(), password: $("#uPass").value, full_name: $("#uName").value.trim(), role: $("#uRole").value });
      $("#uMsg").textContent = ""; toast("Profile created"); $("#userForm").reset(); loadUsers();
    } catch (err) { $("#uMsg").textContent = ""; toast(err.message, true); }
  });

  async function loadUsers() {
    const { data, error } = await sb.from("profiles").select("*").order("created_at", { ascending: false });
    const box = $("#adminUsers"); box.replaceChildren();
    if (error) return toast(error.message, true);
    data.forEach(u => {
      const r = el("div", "trow"); const g = el("div", "grow");
      g.append(el("b", "", u.full_name || "(no name)"), el("span", "muted mono", u.email + " · " + u.role.toUpperCase()));
      r.appendChild(g);
      if (u.id !== profile.id) {
        const del = el("button", "btn sm danger", "Remove");
        del.onclick = async () => { if (!confirm("Remove " + u.email + "?")) return; try { await callAdminFn({ action: "delete", user_id: u.id }); toast("User removed"); loadUsers(); } catch (err) { toast(err.message, true); } };
        r.appendChild(del);
      }
      box.appendChild(r);
    });
  }

  /* ---------- init ---------- */
  sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT") { profile = null; applyAuthUI(); } });
  bootSession(false);
})();
