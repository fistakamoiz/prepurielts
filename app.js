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
  let spKind = "speaking";      // the video page shows Speaking or Writing lessons (same player, same notes)
  let spAdminKind = "speaking"; // the admin video form adds Speaking or Writing lessons

  const todayStr = () => new Date().toISOString().slice(0, 10);
  const fmtDate = d => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const preview = p => p.body ? p.body.slice(0, 190).trim() + "…" : (p.kind === "listening" ? "Listening test with audio and questions. Open it to start." : "Interactive passage with questions. Open it to start.");
  // newest first: by date, then by number in the title (#11 before #10), then by upload time
  const newestFirst = (a, b) => b.publish_date.localeCompare(a.publish_date) || (b.title || "").localeCompare(a.title || "", undefined, { numeric: true }) || (b.created_at || "").localeCompare(a.created_at || "");

  /* ---------- locks: unlock date/time + "only after solving ..." ---------- */
  const LOCK_VERB = { reading: "solving", listening: "completing", speaking: "watching", writing: "watching" };
  const fmtDT = iso => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const toLocalInput = iso => { if (!iso) return ""; const d = new Date(iso), z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "T" + z(d.getHours()) + ":" + z(d.getMinutes()); };
  function lockInfo(p, pool) {
    if (profile?.role === "admin") return null;
    if (p.only_after && !doneIds.has(p.only_after)) {
      const pre = pool.find(x => x.id === p.only_after);
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
    if (view === "writing" || view === "speaking") { setSpKind(view); view = "speaking"; }
    if ((view === "dashboard" || view === "reader" || view === "board" || view === "speaking") && !profile) view = "landing";
    if (view !== "speaking") spPause();
    if (view !== "reader") { openToken++; pauseAttempt(); $$("#textHost audio").forEach(a => a.pause()); }
    if (view === "admin" && profile?.role !== "admin") view = profile ? "dashboard" : "landing";
    $$(".view").forEach(v => v.classList.add("hidden"));
    $("#view-" + view).classList.remove("hidden");
    document.body.classList.toggle("reading-html", view === "reader" && readerIsHtml);
    window.scrollTo(0, 0);
    if (view === "dashboard") loadPassages();
    if (view === "board") loadBoard();
    if (view === "speaking") loadSpeaking();
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
    let q = sb.from("attempts").select("user_id,passage_id,full_name,score,total,elapsed_seconds,finished_at").eq("finished", true).not("kind", "in", "(speaking,writing)");
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
    if (t.dataset.spk) {
      if ($("#spId").value && spAdminKind !== t.dataset.spk) resetSpForm(); // switching section cancels an edit
      spAdminKind = t.dataset.spk; applySpAdmin(); fillAfter();
    }
    $$(".tab").forEach(x => x.classList.toggle("active", x === t));
    $$(".tabpane").forEach(p => p.classList.toggle("hidden", p.id !== t.dataset.tab));
  });
  $("#pDate").value = todayStr();

  let adminAll = [];   // all passages, to fill the "Only after ..." list
  const AFTER_LABEL = { reading: "Only after solving", listening: "Only after completing" };
  function fillAfterIn(s, kind, me, cur) {
    s.replaceChildren(new Option("— No requirement —", ""));
    adminAll.filter(p => (p.kind || "reading") === kind && p.id !== me).sort(newestFirst).forEach(p => s.add(new Option(p.title, p.id)));
    s.value = [...s.options].some(o => o.value === cur) ? cur : "";
  }
  function fillAfter(sel) {
    fillAfterIn($("#pAfter"), $("#pKind").value, $("#pId").value, sel !== undefined ? sel : $("#pAfter").value);
    fillAfterIn($("#spFAfter"), spAdminKind, $("#spId").value, $("#spFAfter").value);
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
    $("#pAfterLbl").textContent = AFTER_LABEL[listening ? "listening" : "reading"];
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
      unlock_at: $("#pUnlock").value ? new Date($("#pUnlock").value).toISOString() : null, only_after: $("#pAfter").value || null };
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
      g.append(el("b", "", p.title), el("span", "muted mono", (p.kind || "reading").toUpperCase() + " · " + fmtDate(p.publish_date) + (p.kind === "speaking" || p.kind === "writing" ? "" : " · " + p.level) + (p.publish_date > todayStr() ? " · SCHEDULED" : "")));
      const a = el("div", "acts"); const ed = el("button", "btn sm", "Edit"), del = el("button", "btn sm danger", "Delete");
      ed.onclick = () => {
        if (p.kind === "speaking" || p.kind === "writing") { editSpeaking(p); return; }
        $(`.tab[data-kind="${p.kind === "listening" ? "listening" : "reading"}"]`).click();
        $("#pId").value = p.id; $("#pTitle").value = p.title; $("#pTopic").value = p.topic || ""; $("#pLevel").value = p.level; $("#pDate").value = p.publish_date;
        $("#pHtml").value = p.html || ""; $("#pBody").value = p.body || ""; $("#pQuestions").value = p.questions || ""; $("#pAnswers").value = p.answers || "";
        $("#pKind").value = p.kind || "reading"; $("#pAudio").value = p.audio_url || "";
        $("#pUnlock").value = toLocalInput(p.unlock_at); fillAfter(p.only_after || "");
        setMode(p.html ? "html" : "text");
        $("#pSubmit").textContent = "Save changes"; $("#pCancel").hidden = false;
        window.scrollTo(0, 0);
      };
      del.onclick = async () => { if (!confirm("Delete this passage?")) return; const { error } = await sb.from("passages").delete().eq("id", p.id); if (error) return toast(error.message, true); if (p.video_path) sb.storage.from("speaking").remove([p.video_path]); if (p.notes_path) dropNotesIfUnused(p.notes_path); toast("Deleted"); loadAdminPassages(); };
      a.append(ed, del); r.append(g, a); box.appendChild(r);
    });
  }

  /* ---------- speaking (video lessons) ---------- */
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
    vol: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9z" fill="currentColor"/><path d="M17 9l5 6M22 9l-5 6"/></svg>'
  };
  const fmtT = s => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = String(s % 60).padStart(2, "0"); return h ? h + ":" + String(m).padStart(2, "0") + ":" + x : m + ":" + x; };
  const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
  const spName = () => spKind === "writing" ? "Writing" : "Speaking";
  function setSpKind(k) {
    if (spKind === k) return;
    spKind = k; spPause(); spOpenTok++; spCur = null; spItems = [];
    $("#view-speaking").classList.toggle("kind-writing", k === "writing"); // Writing videos are shown without the zoom
    $("#spStage").classList.add("hidden"); $("#spPlayer").classList.remove("loading"); $("#spSearch").value = "";
    const n = spName();
    $("#spHead").replaceChildren(document.createTextNode(n.slice(0, -3)), el("span", "serif", "ing"));
    $("#spLeave").setAttribute("aria-label", "Back to " + n);
    $("#spEmpty").textContent = "No " + n.toLowerCase() + " videos yet. Check back soon.";
    $("#spList").replaceChildren();
  }
  let spItems = [], spCur = null, spOpenTok = 0, spSeeking = false, spHideId = null;
  const vidEl = $("#spVideo");
  let spEng = vidEl;                       // current engine: the <video> tag, or the YouTube facade below
  const spv = () => spEng;
  // ----- YouTube: played through the YouTube player API, but without YouTube's own buttons, title or logo.
  // The page draws its own controls and a transparent shield on top, so students only see the video.
  const ytId = u => {
    try {
      const x = new URL(u), h = x.hostname.replace(/^(www|m)\./, ""); let id = null;
      if (h === "youtu.be") id = x.pathname.slice(1).split("/")[0];
      else if (h === "youtube.com" || h === "youtube-nocookie.com") {
        if (x.pathname === "/watch") id = x.searchParams.get("v");
        else { const m = x.pathname.match(/^\/(embed|shorts|live|v)\/([\w-]+)/); id = m && m[2]; }
      }
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    } catch (e) { return null; }
  };
  const ytEng = (() => {
    const f = new EventTarget(); let pl = null, st = -1, poll = null, lastDur = 0;
    const ev = n => f.dispatchEvent(new Event(n));
    const api = () => new Promise((res, rej) => {
      if (window.YT && window.YT.Player) return res();
      const prev = window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady = () => { if (prev) prev(); res(); };
      if (!document.getElementById("ytapi")) { const s = document.createElement("script"); s.id = "ytapi"; s.src = "https://www.youtube.com/iframe_api"; s.onerror = () => rej(new Error("The video player could not be loaded")); document.head.appendChild(s); }
    });
    function onState(e) {
      st = e.data;
      if (st === 1) { ev("play"); ev("playing"); } else if (st === 2) ev("pause"); else if (st === 0) { ev("pause"); ev("ended"); } else if (st === 3) ev("waiting"); else if (st === 5) ev("canplay");
      ev("timeupdate");
    }
    Object.defineProperties(f, {
      paused: { get: () => !(st === 1 || st === 3) },
      ended: { get: () => st === 0 },
      currentTime: { get: () => (pl && pl.getCurrentTime && pl.getCurrentTime()) || 0, set: t => { if (pl) { pl.seekTo(t, true); ev("timeupdate"); } } },
      duration: { get: () => (pl && pl.getDuration && pl.getDuration()) || 0 },
      playbackRate: { get: () => (pl && pl.getPlaybackRate && pl.getPlaybackRate()) || 1, set: r => { if (pl && pl.setPlaybackRate) pl.setPlaybackRate(r); } },
      muted: { get: () => !!(pl && pl.isMuted && pl.isMuted()), set: m => { if (!pl) return; if (m) pl.mute(); else pl.unMute(); ev("volumechange"); } },
      volume: { get: () => (pl && pl.getVolume ? pl.getVolume() / 100 : 1) },
      src: { get: () => (pl ? "yt" : "") }
    });
    f.play = () => { if (pl && pl.playVideo) pl.playVideo(); return Promise.resolve(); };
    f.pause = () => { if (pl && pl.pauseVideo) pl.pauseVideo(); };
    f.stop = () => { if (pl && pl.stopVideo) { try { pl.stopVideo(); } catch (e) {} } st = -1; };
    f.load = async (id, start) => {
      await api(); st = -1;
      const vars = { controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0, iv_load_policy: 3, cc_load_policy: 0, playsinline: 1, autoplay: 1, enablejsapi: 1, origin: location.origin };
      if (pl) { pl.loadVideoById({ videoId: id, startSeconds: start || 0 }); return; }
      await new Promise(resolve => {
        pl = new YT.Player("spYTfr", { videoId: id, host: "https://www.youtube-nocookie.com", playerVars: Object.assign({ start: Math.floor(start || 0) }, vars),
          events: { onReady: () => resolve(), onStateChange: onState, onError: () => { ev("ytError"); } } });
      });
      poll = setInterval(() => {
        const d = f.duration; if (d !== lastDur) { lastDur = d; ev("durationchange"); }
        if (st === 1) { if (d && f.currentTime >= d - 0.4) f.pause(); /* stop before YouTube's end-screen suggestions appear */ ev("timeupdate"); }
      }, 250);
    };
    return f;
  })();
  function spPause() { try { vidEl.pause(); ytEng.pause(); } catch (e) {} }
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };

  // a lesson counts as "watched" once the student reaches 90% of it (this unlocks "Only after watching ...")
  async function markWatched() {
    const p = spCur; if (!p || !profile || doneIds.has(p.id)) return;
    doneIds.add(p.id);
    const name = (profile.full_name || "").trim() || (profile.email || "").split("@")[0];
    const { error } = await sb.from("attempts").insert({ passage_id: p.id, user_id: profile.id, full_name: name, kind: spKind, finished: true, finished_at: new Date().toISOString() });
    if (error) { doneIds.delete(p.id); console.error(error); } else { toast("Lesson completed"); renderSpeaking(); }
  }
  async function loadSpeaking() {
    const kind = spKind;
    const [res, done] = await Promise.all([
      sb.from("passages").select("*").eq("kind", kind).lte("publish_date", todayStr()).order("publish_date", { ascending: false }),
      sb.from("attempts").select("passage_id").eq("user_id", profile.id).eq("finished", true)
    ]);
    if (res.error) { toast("Could not load videos: " + res.error.message, true); return; }
    if (kind !== spKind) return; // the student switched page while this was loading
    doneIds = new Set((done.data || []).map(x => x.passage_id));
    spItems = res.data.sort(newestFirst); renderSpeaking();
  }
  function renderSpeaking() {
    const q = $("#spSearch").value.trim().toLowerCase();
    const list = $("#spList"); list.replaceChildren();
    const items = spItems.filter(p => !q || (p.title + " " + (p.topic || "")).toLowerCase().includes(q));
    $("#spEmpty").classList.toggle("hidden", spItems.length > 0);
    $("#spSub").classList.toggle("hidden", !items.length);
    items.forEach(p => {
      const it = el("div", "item sp-item" + (spCur && spCur.id === p.id ? " playing" : ""));
      const ic = el("div", "sp-ic"); ic.innerHTML = ICON.play;
      const l = el("div", "grow"); l.appendChild(el("h4", "", p.title));
      const m = el("div", "meta"); m.append(el("span", "chip", fmtDate(p.publish_date)), el("span", "chip", p.topic || spName())); l.appendChild(m);
      it.append(ic, l, el("span", "mono muted", spCur && spCur.id === p.id ? "NOW PLAYING" : "WATCH →"));
      const lk = lockInfo(p, spItems);
      if (lk) { it.classList.add("locked"); it.appendChild(lockGlass(lk)); it.onclick = () => toast(lk, true); }
      else it.onclick = () => openSpeaking(p);
      list.appendChild(it);
    });
  }
  $("#spSearch").addEventListener("input", renderSpeaking);

  async function openSpeaking(p) {
    const lk = lockInfo(p, spItems); if (lk) return toast(lk, true);
    const tok = ++spOpenTok;
    spPause();
    spCur = p; $("#spStage").classList.remove("hidden");
    $("#spTitle").textContent = p.title;
    const m = $("#spMeta"); m.replaceChildren(el("span", "chip", fmtDate(p.publish_date)), el("span", "chip", p.topic || spName()));
    $("#spNotes").textContent = p.notes || p.body || ""; $("#spNotes").classList.toggle("hidden", !(p.notes || p.body));
    setupNotes(p);
    const pl = $("#spPlayer"), yid = p.video_url ? ytId(p.video_url) : null;
    spEng = yid ? ytEng : vidEl; pl.classList.toggle("yt", !!yid);
    pl.classList.add("loading"); setSpUI();
    const saved = parseFloat(lsGet("spPos:" + p.id)), rate = +lsGet("spSpeed") || 1;
    $("#spSpeed").textContent = rate + "×"; renderSpeaking(); $("#spStage").scrollIntoView({ behavior: "smooth", block: "start" });
    if (yid) {
      const start = saved > 5 ? saved : 0;
      ytEng.addEventListener("playing", () => { ytEng.playbackRate = rate; }, { once: true });
      try { await ytEng.load(yid, start); } catch (err) { pl.classList.remove("loading"); toast(err.message, true); }
      return;
    }
    let url = p.video_url || null;
    if (!url && p.video_path) {
      const r = await sb.storage.from("speaking").createSignedUrl(p.video_path, 6 * 3600);
      if (tok !== spOpenTok) return;
      if (r.error) { toast("Could not load the video: " + r.error.message, true); pl.classList.remove("loading"); return; }
      url = r.data.signedUrl;
    }
    if (!url) { toast("This lesson has no video attached", true); pl.classList.remove("loading"); return; }
    const v = vidEl; v.src = url; v.playbackRate = rate; v.load();
    v.addEventListener("loadedmetadata", () => { if (saved > 5 && saved < v.duration - 5) v.currentTime = saved; }, { once: true });
    v.play().catch(() => {});
  }
  function setSpUI() {
    const v = spv(), playing = !v.paused && !v.ended;
    $("#spPlay").innerHTML = playing ? ICON.pause : ICON.play;
    $("#spPlayer").classList.toggle("playing", playing);
    $("#spMute").innerHTML = v.muted || v.volume === 0 ? ICON.mute : ICON.vol;
    const d = v.duration || 0, c = v.currentTime || 0;
    $("#spTime").textContent = fmtT(c) + " / " + fmtT(d);
    if (!spSeeking) { const pc = d ? c / d * 1000 : 0; $("#spSeek").value = pc; $("#spSeek").style.setProperty("--p", (pc / 10) + "%"); }
  }
  function spFlash(txt) { const f = $("#spFlash"); f.textContent = txt; f.classList.remove("on"); void f.offsetWidth; f.classList.add("on"); }
  function spSkip(sec) { const v = spv(); if (!v.duration) return; v.currentTime = Math.min(v.duration, Math.max(0, v.currentTime + sec)); spFlash((sec > 0 ? "+" : "−") + Math.abs(sec) + "s"); setSpUI(); spWake(); }
  function spToggle() { const v = spv(); if (!v.src) return; if (v.paused) v.play().catch(() => {}); else v.pause(); spWake(); }
  function spWake() { const p = $("#spPlayer"); p.classList.add("awake"); clearTimeout(spHideId); spHideId = setTimeout(() => { if (!spv().paused) p.classList.remove("awake"); }, 2600); }
  (() => {
    const pl = $("#spPlayer"), shield = $("#spShield");
    const attach = v => {
      ["play", "pause", "ended", "timeupdate", "volumechange", "durationchange"].forEach(ev => v.addEventListener(ev, () => { if (v === spEng) setSpUI(); }));
      v.addEventListener("playing", () => pl.classList.remove("loading")); v.addEventListener("canplay", () => pl.classList.remove("loading"));
      v.addEventListener("waiting", () => pl.classList.add("loading"));
      v.addEventListener("error", () => { pl.classList.remove("loading"); if (v.src && v === vidEl) toast("The video could not be played", true); });
      v.addEventListener("ytError", () => { pl.classList.remove("loading"); toast("This video can't be played right now. Ask your teacher to check the link.", true); });
      v.addEventListener("pause", () => { spWake(); pl.classList.add("awake"); });
      let lastSave = 0;
      v.addEventListener("timeupdate", () => { if (v === spEng && spCur && Date.now() - lastSave > 4000) { lastSave = Date.now(); lsSet("spPos:" + spCur.id, v.currentTime); } });
      v.addEventListener("ended", () => { if (v === spEng && spCur) { lsSet("spPos:" + spCur.id, 0); markWatched(); } });
      v.addEventListener("timeupdate", () => { if (v === spEng && v.duration > 0 && v.currentTime / v.duration >= 0.9) markWatched(); });
    };
    attach(vidEl); attach(ytEng);
    $("#spLeave").onclick = () => {   // back to the list of Speaking lessons
      const fs = document.fullscreenElement || document.webkitFullscreenElement;
      if (fs) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      spPause(); spOpenTok++; spCur = null; $("#spStage").classList.add("hidden"); $("#spPlayer").classList.remove("loading");
      renderSpeaking(); window.scrollTo({ top: 0, behavior: "smooth" });
    };
    $("#spPlay").onclick = spToggle; $("#spBig").onclick = spToggle;
    $("#spBack").onclick = () => spSkip(-10); $("#spFwd").onclick = () => spSkip(10);
    $("#spSpeed").onclick = () => { const v = spv(); const i = SPEEDS.indexOf(v.playbackRate); const n = SPEEDS[(i + 1) % SPEEDS.length]; v.playbackRate = n; lsSet("spSpeed", n); $("#spSpeed").textContent = n + "×"; spFlash(n + "×"); };
    $("#spMute").onclick = () => { const v = spv(); v.muted = !v.muted; };
    const seek = $("#spSeek");
    seek.addEventListener("input", () => { const v = spv(); spSeeking = true; if (v.duration) v.currentTime = seek.value / 1000 * v.duration; seek.style.setProperty("--p", (seek.value / 10) + "%"); $("#spTime").textContent = fmtT(v.currentTime) + " / " + fmtT(v.duration); });
    seek.addEventListener("change", () => { spSeeking = false; });
    const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
    $("#spFull").onclick = () => {
      if (fsEl()) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      const req = pl.requestFullscreen || pl.webkitRequestFullscreen;
      if (req) req.call(pl); else if (vidEl.webkitEnterFullscreen && spEng === vidEl) vidEl.webkitEnterFullscreen(); else toast("Full screen is not supported on this device", true);
    };
    // click on the picture: play/pause; double click left / right side: -10s / +10s
    let tapT = null;
    shield.addEventListener("click", e => {
      if (wasHidden) { wasHidden = false; return; } // first tap on a phone only shows the controls
      const r = shield.getBoundingClientRect(), x = (e.clientX - r.left) / r.width;
      if (tapT) { clearTimeout(tapT); tapT = null; if (x < 0.35) spSkip(-10); else if (x > 0.65) spSkip(10); else $("#spFull").click(); return; }
      tapT = setTimeout(() => { tapT = null; spToggle(); }, 260);
    });
    let wasHidden = false;
    pl.addEventListener("pointerdown", e => { wasHidden = e.pointerType === "touch" && pl.classList.contains("playing") && !pl.classList.contains("awake"); }, true);
    pl.addEventListener("mousemove", spWake); pl.addEventListener("touchstart", spWake, { passive: true });
    document.addEventListener("keydown", e => {
      if ($("#view-speaking").classList.contains("hidden") || !spCur) return;
      const t = e.target.tagName; if (t === "INPUT" && e.target.type !== "range" || t === "TEXTAREA" || t === "SELECT" || e.target.isContentEditable) return;
      if (e.key === " " || e.key === "k") { e.preventDefault(); spToggle(); }
      else if (e.key === "ArrowLeft" || e.key === "j") { e.preventDefault(); spSkip(-10); }
      else if (e.key === "ArrowRight" || e.key === "l") { e.preventDefault(); spSkip(10); }
      else if (e.key === "f") $("#spFull").click();
      else if (e.key === "m") { const v = spv(); v.muted = !v.muted; }
    });
    setSpUI();
  })();

  /* ----- speaking: lesson notes file (download) + student notes editor (PDF) ----- */
  const NOTE_COLORS = ["#111111", "#e5484d", "#f08a24", "#30a46c", "#0091ff", "#8e4ec6", "#e93d82"];
  const NOTE_MARKS = ["#fff176", "#b9f6ca", "#b3e5fc", "#f8bbd0", "transparent"];
  let noteRange = null, noteKey = null, pdfLoading = null;
  const noteEd = () => $("#spNoteEd");
  const noteSave = () => { if (noteKey) lsSet(noteKey, noteEd().innerHTML); };
  function noteRun(cmd, val) {
    const ed = noteEd(); ed.focus();
    if (noteRange) { const s = getSelection(); s.removeAllRanges(); s.addRange(noteRange); }
    try { document.execCommand("styleWithCSS", false, true); } catch (e) {}
    document.execCommand(cmd, false, val == null ? null : val);
    noteSave();
  }
  function setupNotes(p) {
    noteKey = "spNote:" + (profile ? profile.id : "") + ":" + p.id; noteRange = null;
    noteEd().innerHTML = lsGet(noteKey) || "";
    $("#spDlNotes").classList.toggle("hidden", !p.notes_path);
  }
  const loadPdfLib = () => window.html2pdf ? Promise.resolve() : (pdfLoading = pdfLoading || new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js";
    s.onload = res; s.onerror = () => { pdfLoading = null; rej(new Error("The PDF tool could not be loaded. Check your internet and try again.")); }; document.head.appendChild(s);
  }));
  (() => {
    const ed = noteEd();
    const swatch = (box, list, cmd) => list.forEach(c => {
      const b = el("button", "nt-c"); b.type = "button"; b.title = c === "transparent" ? "No highlight" : c;
      b.style.background = c === "transparent" ? "#fff" : c; if (c === "transparent") b.classList.add("none");
      b.addEventListener("mousedown", e => e.preventDefault());
      b.onclick = () => noteRun(cmd, c); box.appendChild(b);
    });
    swatch($("#spNoteColors"), NOTE_COLORS, "foreColor");
    swatch($("#spNoteMarks"), NOTE_MARKS, "hiliteColor");
    $$("#spNotesBox .nt-b").forEach(b => { b.addEventListener("mousedown", e => e.preventDefault()); b.onclick = () => noteRun(b.dataset.cmd); });
    $("#spNoteFont").onchange = e => noteRun("fontName", e.target.value);
    $("#spNoteSize").onchange = e => noteRun("fontSize", e.target.value);
    $("#spNoteColorPick").addEventListener("input", e => noteRun("foreColor", e.target.value));
    document.addEventListener("selectionchange", () => { const s = getSelection(); if (s.rangeCount && ed.contains(s.anchorNode)) noteRange = s.getRangeAt(0).cloneRange(); });
    ed.addEventListener("input", noteSave);
    ed.addEventListener("paste", e => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, t); });
    ed.addEventListener("drop", e => e.preventDefault());

    $("#spDlNotes").onclick = async () => {
      const p = spCur; if (!p || !p.notes_path) return;
      const r = await sb.storage.from("speaking").createSignedUrl(p.notes_path, 600, { download: p.notes_name || true });
      if (r.error) return toast("Could not download the notes: " + r.error.message, true);
      const l = document.createElement("a"); l.href = r.data.signedUrl; l.download = p.notes_name || ""; document.body.appendChild(l); l.click(); l.remove();
    };

    $("#spNotePdf").onclick = async () => {
      if (!ed.textContent.trim()) return toast("Write some notes first", true);
      const btn = $("#spNotePdf"); btn.disabled = true;
      try {
        await loadPdfLib();
        // html2pdf's canvas capture comes out blank when the page is scrolled down (the notes box is far down the page)
        // and the site uses smooth scrolling, so jump to the top instantly first and put the scroll back afterwards.
        const y0 = window.scrollY, root = document.documentElement, oldSB = root.style.scrollBehavior;
        root.style.scrollBehavior = "auto"; window.scrollTo(0, 0);
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const wrap = document.createElement("div");
        wrap.style.cssText = "width:700px;background:#fff;color:#111;font-family:'Space Grotesk',Arial,sans-serif;font-size:14px;line-height:1.6";
        const h = document.createElement("h2"); h.textContent = spCur ? spCur.title : "Notes"; h.style.cssText = "margin:0 0 4px;font-size:22px;color:#111";
        const d = document.createElement("div"); d.textContent = spName() + " notes · " + fmtDate(todayStr()); d.style.cssText = "margin:0 0 16px;padding-bottom:10px;border-bottom:1px solid #ddd;color:#777;font-size:12px";
        const body = document.createElement("div"); body.innerHTML = ed.innerHTML;
        body.querySelectorAll("ul,ol").forEach(u => { u.style.margin = "0 0 0 4px"; u.style.paddingLeft = "22px"; });
        body.querySelectorAll("li").forEach(li => { li.style.display = "list-item"; });
        wrap.append(h, d, body);
        const base = ((spCur ? spCur.title : "notes").replace(/[^\p{L}\p{N}\- ]+/gu, "").trim().replace(/\s+/g, "-")) || "notes";
        await html2pdf().set({ margin: [14, 14, 14, 14], filename: base + "-notes.pdf", image: { type: "jpeg", quality: 0.98 },
          html2canvas: { scale: 2, backgroundColor: "#ffffff", scrollX: 0, scrollY: 0, useCORS: true, logging: false }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" } }).from(wrap).save();
        root.style.scrollBehavior = oldSB; window.scrollTo(0, y0);
      } catch (err) { document.documentElement.style.scrollBehavior = ""; toast(err.message || "Could not create the PDF", true); }
      btn.disabled = false;
    };
  })();

  /* ----- admin: add / edit speaking ----- */
  let spMode = "file", spPicked = [], spEditing = null;
  let spNotesFile = null, spNotesKeep = null;   // newly chosen notes file / notes file already saved on the lesson
  function renderSpNotesFile() {
    const box = $("#spNotesFiles"); box.replaceChildren();
    const name = spNotesFile ? spNotesFile.name : spNotesKeep ? (spNotesKeep.name || "notes file") : null;
    if (!name) return;
    const r = el("div", "fitem"); const x = el("button", "x", "✕"); x.type = "button";
    x.onclick = () => { spNotesFile = null; spNotesKeep = null; renderSpNotesFile(); };
    r.append(el("span", "grow", name), el("span", "muted mono", spNotesFile ? fmtSize(spNotesFile.size) : "saved"), x); box.appendChild(r);
  }
  $("#spNotesBtn").onclick = () => $("#spNotesPick").click();
  $("#spNotesPick").onchange = e => { if (e.target.files[0]) { spNotesFile = e.target.files[0]; renderSpNotesFile(); } e.target.value = ""; };
  async function dropNotesIfUnused(path) {
    const { count, error } = await sb.from("passages").select("id", { count: "exact", head: true }).eq("notes_path", path);
    if (!error && count === 0) sb.storage.from("speaking").remove([path]);
  }
  const nameToTitle = n => n.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) || "Speaking video";
  const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(b / 1024)) + " KB";
  function setSpMode(m) {
    spMode = m;
    $$("#spMode button").forEach(b => b.classList.toggle("active", b.dataset.spmode === m));
    $("#spFileBlock").classList.toggle("hidden", m !== "file"); $("#spLinkBlock").classList.toggle("hidden", m !== "link");
  }
  $$("#spMode button").forEach(b => b.onclick = () => setSpMode(b.dataset.spmode));
  function renderSpPicked() {
    const box = $("#spFiles"); box.replaceChildren();
    spPicked.forEach((f, i) => {
      const r = el("div", "fitem"); const x = el("button", "x", "✕"); x.type = "button";
      x.onclick = () => { spPicked.splice(i, 1); renderSpPicked(); };
      const nm = el("span", "grow", f.name); r.append(nm, el("span", "muted mono", fmtSize(f.size)), x); box.appendChild(r);
    });
  }
  function addSpFiles(list) {
    [...list].forEach(f => { if (/^video\//.test(f.type) || /\.(mp4|mov|webm|m4v|mkv)$/i.test(f.name)) spPicked.push(f); else toast(f.name + " is not a video file", true); });
    renderSpPicked();
  }
  $("#spFile").onchange = e => { addSpFiles(e.target.files); e.target.value = ""; };
  const sdz = $("#spDrop");
  ["dragenter", "dragover"].forEach(ev => sdz.addEventListener(ev, e => { e.preventDefault(); sdz.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => sdz.addEventListener(ev, e => { e.preventDefault(); sdz.classList.remove("over"); }));
  sdz.addEventListener("drop", e => addSpFiles(e.dataTransfer.files));
  function resetSpForm() {
    spPicked = []; spEditing = null; spNotesFile = null; spNotesKeep = null; renderSpNotesFile(); renderSpPicked(); setSpMode("file"); $("#spForm").reset();
    $("#spId").value = ""; $("#spFDate").value = todayStr(); fillAfter(); applySpAdmin();
    $("#spCancel").hidden = true; $("#spProg").classList.add("hidden");
  }
  function applySpAdmin() {
    const w = spAdminKind === "writing", editing = !!$("#spId").value;
    $("#spFormTitle").textContent = (editing ? "Edit " : "Add a ") + (w ? "writing" : "speaking") + " video";
    $("#spSubmit").textContent = editing ? "Save changes" : "Publish video";
    $("#spFTitle").placeholder = w ? "e.g. Task 2: Opinion essay structure" : "e.g. Part 2: Describe a place you visited";
    $("#spFTopic").placeholder = w ? "Task 1, Task 2, Tips…" : "Part 1, Part 2, Part 3, Tips…";
    // Writing has no teacher notes: students write their own in the "My notes" box
    $("#spNotesTxtLbl").classList.toggle("hidden", w); $("#spNotesFileRow").classList.toggle("hidden", w);
  }
  $("#spCancel").onclick = resetSpForm;
  $("#spFDate").value = todayStr();
  function editSpeaking(p) {
    $(`.tab[data-spk="${p.kind === "writing" ? "writing" : "speaking"}"]`).click(); resetSpForm(); spEditing = p;
    $("#spId").value = p.id; $("#spFTitle").value = p.title; $("#spFTopic").value = p.topic || ""; $("#spFDate").value = p.publish_date; $("#spFUnlock").value = toLocalInput(p.unlock_at); fillAfterIn($("#spFAfter"), spAdminKind, p.id, p.only_after || ""); $("#spNotes2").value = p.notes || p.body || "";
    spNotesKeep = p.notes_path ? { path: p.notes_path, name: p.notes_name } : null; renderSpNotesFile();
    if (p.video_url) { setSpMode("link"); $("#spLink").value = p.video_url; }
    applySpAdmin(); $("#spCancel").hidden = false;
    window.scrollTo(0, 0);
  }
  // upload with progress (supabase-js has no progress callback, so use XHR on the storage endpoint)
  async function uploadVideo(file, onProg, prefix = "") {
    const { data: { session } } = await sb.auth.getSession();
    const ext = (file.name.match(/\.([a-z0-9]+)$/i) || [, "mp4"])[1].toLowerCase();
    const path = prefix + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)) + "." + ext;
    await new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open("POST", SUPABASE_URL + "/storage/v1/object/speaking/" + path);
      x.setRequestHeader("Authorization", "Bearer " + session.access_token); x.setRequestHeader("apikey", SUPABASE_ANON_KEY);
      x.setRequestHeader("x-upsert", "false"); x.setRequestHeader("Content-Type", file.type || "video/mp4");
      x.upload.onprogress = e => { if (e.lengthComputable) onProg(e.loaded / e.total); };
      x.onload = () => { if (x.status >= 200 && x.status < 300) return resolve(); let msg = "Upload failed (" + x.status + ")"; try { msg = JSON.parse(x.responseText).message || msg; } catch (e) {} if (x.status === 413) msg = "File is too large for your Supabase plan (free: 50 MB)"; reject(new Error(msg)); };
      x.onerror = () => reject(new Error("Network error while uploading")); x.send(file);
    });
    return path;
  }
  $("#spForm").addEventListener("submit", async e => {
    e.preventDefault();
    const id = $("#spId").value, date = $("#spFDate").value, topic = $("#spFTopic").value.trim() || null, notes = $("#spNotes2").value.trim() || null, titleIn = $("#spFTitle").value.trim();
    const common = { kind: spAdminKind, level: "Medium", topic, notes, unlock_at: $("#spFUnlock").value ? new Date($("#spFUnlock").value).toISOString() : null, only_after: $("#spFAfter").value || null, body: null, questions: null, answers: null, html: null, audio_url: null };
    let link = null;
    if (spMode === "link") { link = $("#spLink").value.trim(); if (!/^https:\/\//i.test(link)) return toast("Video link must start with https://", true); }
    else if (!spPicked.length && !id) return toast("Choose a video file first", true);
    if (id && spPicked.length > 1) return toast("Choose just one file when editing", true);
    if (!id && spMode === "link" && !titleIn) return toast("Add a title for the video", true);
    if (id && !titleIn) return toast("Add a title for the video", true);
    const btn = $("#spSubmit"); btn.disabled = true;
    const prog = $("#spProg"), bar = $("#spBar"), ptxt = $("#spProgTxt"); prog.classList.remove("hidden");
    const uploaded = [];
    try {
      let notesPatch = {};
      if (spNotesFile) {
        const nl = "Uploading notes · " + spNotesFile.name; ptxt.textContent = nl; bar.style.width = "0%";
        const np = await uploadVideo(spNotesFile, fr => { bar.style.width = Math.round(fr * 100) + "%"; ptxt.textContent = nl + " · " + Math.round(fr * 100) + "%"; }, "notes-");
        uploaded.push(np); notesPatch = { notes_path: np, notes_name: spNotesFile.name };
      } else if (id && spEditing?.notes_path && !spNotesKeep) notesPatch = { notes_path: null, notes_name: null };
      if (spMode === "link") {
        const row = { ...common, ...notesPatch, title: titleIn, publish_date: date, video_url: link, video_path: null };
        const r = id ? await sb.from("passages").update(row).eq("id", id) : await sb.from("passages").insert(row);
        if (r.error) throw r.error;
        if (id && spEditing?.video_path) sb.storage.from("speaking").remove([spEditing.video_path]);
      } else if (id && !spPicked.length) {
        const r = await sb.from("passages").update({ ...common, ...notesPatch, title: titleIn, publish_date: date }).eq("id", id);
        if (r.error) throw r.error;
      } else {
        for (let i = 0; i < spPicked.length; i++) {
          const f = spPicked[i];
          const label = (spPicked.length > 1 ? "Uploading " + (i + 1) + " of " + spPicked.length + " · " : "Uploading · ") + f.name;
          ptxt.textContent = label; bar.style.width = "0%";
          const path = await uploadVideo(f, fr => { bar.style.width = Math.round(fr * 100) + "%"; ptxt.textContent = label + " · " + Math.round(fr * 100) + "%"; });
          uploaded.push(path);
          const row = { ...common, ...notesPatch, title: (spPicked.length === 1 && titleIn) || nameToTitle(f.name), publish_date: addDays(date, i), video_path: path, video_url: null };
          const r = id ? await sb.from("passages").update(row).eq("id", id) : await sb.from("passages").insert(row);
          if (r.error) throw r.error;
        }
        if (id && spEditing?.video_path) sb.storage.from("speaking").remove([spEditing.video_path]);
      }
      if (id && spEditing?.notes_path && "notes_path" in notesPatch) dropNotesIfUnused(spEditing.notes_path);
      toast(id ? "Video updated" : spPicked.length > 1 ? spPicked.length + " videos published" : "Video published");
      resetSpForm(); loadAdminPassages();
    } catch (err) {
      if (uploaded.length) sb.storage.from("speaking").remove(uploaded);
      toast(err.message || String(err), true);
    }
    btn.disabled = false; prog.classList.add("hidden");
  });

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
