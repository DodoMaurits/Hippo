(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ACCOUNTS_KEY = "hippo-accounts-v1";
  const SESSION_KEY = "hippo-session-v1";

  let currentUser = null;
  let words = [];

  // ---------- Accounts (demo: lokaal in browser, niet echt beveiligd) ----------
  function getAccounts() {
    try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || {}; }
    catch (e) { return {}; }
  }
  function setAccounts(acc) {
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(acc));
  }
  async function hashPassword(password, salt) {
    if (crypto.subtle) {
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + password));
      return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
    }
    // fallback voor niet-beveiligde context (bijv. file://)
    let h = 5381;
    const s = salt + password;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }
  function authMsg(text, ok) {
    const el = $("authMsg");
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
  }

  $("btnRegister").addEventListener("click", async () => {
    const user = $("authUser").value.trim();
    const pass = $("authPass").value;
    const pass2 = $("authPass2").value;
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(user)) return authMsg("Username: 3-20 letters, numbers or _");
    if (pass.length < 4) return authMsg("Password: at least 4 characters");
    if (pass !== pass2) return authMsg("Passwords do not match");
    const acc = getAccounts();
    if (acc[user]) return authMsg("That username already exists");
    const salt = Math.random().toString(36).slice(2);
    acc[user] = { salt, hash: await hashPassword(pass, salt) };
    setAccounts(acc);
    startSession(user);
  });

  $("btnLogin").addEventListener("click", async () => {
    const user = $("authUser").value.trim();
    const pass = $("authPass").value;
    const acc = getAccounts();
    if (!acc[user]) return authMsg("Unknown username or wrong password");
    const hash = await hashPassword(pass, acc[user].salt);
    if (hash !== acc[user].hash) return authMsg("Unknown username or wrong password");
    startSession(user);
  });

  function startSession(user) {
    currentUser = user;
    localStorage.setItem(SESSION_KEY, user);
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("loggedInUser").textContent = "🦛 " + user;
    loadColNames();
    loadWords();
    renderList();
  }

  $("btnLogout").addEventListener("click", () => {
    localStorage.removeItem(SESSION_KEY);
    currentUser = null;
    words = [];
    $("app").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
    $("authPass").value = "";
    $("authPass2").value = "";
    authMsg("", false);
  });

  // ---------- Data per gebruiker ----------
  function wordsKey() { return "hippo-words-" + currentUser; }
  function colnamesKey() { return "hippo-colnames-" + currentUser; }

  function loadWords() {
    try {
      const raw = localStorage.getItem(wordsKey());
      words = raw ? JSON.parse(raw) : [];
    } catch (e) { words = []; }
  }
  function save() { localStorage.setItem(wordsKey(), JSON.stringify(words)); }
  function saveColNames() {
    localStorage.setItem(colnamesKey(), JSON.stringify({
      c1: $("col1name").value, c2: $("col2name").value
    }));
  }
  function loadColNames() {
    try {
      const raw = localStorage.getItem(colnamesKey());
      if (raw) {
        const n = JSON.parse(raw);
        $("col1name").value = n.c1 || "Language 1";
        $("col2name").value = n.c2 || "Language 2";
      }
    } catch (e) {}
    updateHeaders();
  }
  function updateHeaders() {
    $("th1").textContent = $("col1name").value || "Language 1";
    $("th2").textContent = $("col2name").value || "Language 2";
  }

  // ---------- Tabs ----------
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $("panel-" + tab.dataset.tab).classList.add("active");
    });
  });

  // ---------- List ----------
  function renderList() {
    const body = $("listBody");
    body.innerHTML = "";
    words.forEach((w, i) => {
      const tr = document.createElement("tr");
      const td1 = document.createElement("td");
      const td2 = document.createElement("td");
      const tdDel = document.createElement("td");
      const in1 = document.createElement("input");
      const in2 = document.createElement("input");
      in1.type = "text"; in1.value = w.a; in1.placeholder = "word in language 1";
      in2.type = "text"; in2.value = w.b; in2.placeholder = "word in language 2";
      in1.addEventListener("input", () => { words[i].a = in1.value; save(); });
      in2.addEventListener("input", () => { words[i].b = in2.value; save(); });
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "✕";
      del.addEventListener("click", () => { words.splice(i, 1); save(); renderList(); });
      td1.appendChild(in1); td2.appendChild(in2); tdDel.appendChild(del);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(tdDel);
      body.appendChild(tr);
    });
    $("emptyMsg").style.display = words.length ? "none" : "block";
  }

  $("addRow").addEventListener("click", () => {
    words.push({ a: "", b: "" });
    save(); renderList();
    const inputs = $("listBody").querySelectorAll("tr:last-child input");
    if (inputs[0]) inputs[0].focus();
  });
  $("clearList").addEventListener("click", () => {
    if (words.length && confirm("Are you sure you want to clear the whole pool? 🦛")) {
      words = []; save(); renderList();
    }
  });
  $("col1name").addEventListener("input", () => { saveColNames(); updateHeaders(); });
  $("col2name").addEventListener("input", () => { saveColNames(); updateHeaders(); });

  // ---------- Quiz helpers ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function normalize(s) { return s.trim().toLowerCase().replace(/\s+/g, " "); }
  function getPairs(direction) {
    return words
      .filter((w) => w.a.trim() && w.b.trim())
      .map((w) => direction === "2to1" ? { prompt: w.b, answer: w.a } : { prompt: w.a, answer: w.b });
  }
  function updateScore(progressEl, scoreEl, countEl, total, done, score) {
    scoreEl.textContent = "Score: " + score + "/" + done;
    countEl.textContent = done + "/" + total;
    progressEl.style.width = total ? (done / total * 100) + "%" : "0%";
  }

  // ---------- Multiple choice ----------
  let mc = { queue: [], idx: 0, score: 0, locked: false };
  function mcStart() {
    const dir = $("mcDirection").value;
    let pool = getPairs(dir);
    if (!pool.length) { $("mcPrompt").textContent = "🦛 The pool is empty! Add words first."; return; }
    if ($("mcShuffle").checked) pool = shuffle(pool);
    mc = { queue: pool, idx: 0, score: 0, locked: false };
    mcNext();
  }
  function mcNext() {
    $("mcFeedback").textContent = "";
    $("mcFeedback").className = "feedback";
    if (mc.idx >= mc.queue.length) {
      const pct = mc.queue.length ? Math.round(mc.score / mc.queue.length * 100) : 0;
      $("mcPrompt").textContent = "🦛🎉 Done! Your score: " + mc.score + "/" + mc.queue.length + " (" + pct + "%)";
      $("mcHint").textContent = pct >= 80 ? "Splashing great! 🌟" : pct >= 50 ? "Good job, keep going! 💪" : "Tip: flip through the flashcards first 🃏";
      $("mcChoices").innerHTML = "";
      updateScore($("mcProgress"), $("mcScore"), $("mcCount"), mc.queue.length, mc.queue.length, mc.score);
      return;
    }
    mc.locked = false;
    const item = mc.queue[mc.idx];
    $("mcPrompt").textContent = item.prompt;
    $("mcHint").textContent = "Pick the correct translation";
    const wrong = shuffle(mc.queue.filter((x) => x.answer !== item.answer)).slice(0, 3).map((x) => x.answer);
    const options = shuffle([item.answer, ...wrong]);
    const box = $("mcChoices");
    box.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.textContent = opt;
      btn.addEventListener("click", () => {
        if (mc.locked) return;
        mc.locked = true;
        if (normalize(opt) === normalize(item.answer)) {
          btn.classList.add("correct");
          mc.score++;
          $("mcFeedback").textContent = "✔ Correct!";
          $("mcFeedback").classList.add("good");
        } else {
          btn.classList.add("wrong");
          $("mcFeedback").textContent = "✘ Oops! It was: " + item.answer;
          $("mcFeedback").classList.add("bad");
          box.querySelectorAll(".choice").forEach((b) => {
            if (normalize(b.textContent) === normalize(item.answer)) b.classList.add("correct");
          });
        }
        updateScore($("mcProgress"), $("mcScore"), $("mcCount"), mc.queue.length, mc.idx + 1, mc.score);
        mc.idx++;
        setTimeout(mcNext, 1200);
      });
      box.appendChild(btn);
    });
    updateScore($("mcProgress"), $("mcScore"), $("mcCount"), mc.queue.length, mc.idx, mc.score);
  }
  $("mcStart").addEventListener("click", mcStart);

  // ---------- Typing ----------
  let ty = { queue: [], idx: 0, score: 0 };
  function typeStart() {
    const dir = $("typeDirection").value;
    let pool = getPairs(dir);
    if (!pool.length) { $("typePrompt").textContent = "🦛 The pool is empty! Add words first."; return; }
    if ($("typeShuffle").checked) pool = shuffle(pool);
    ty = { queue: pool, idx: 0, score: 0 };
    typeNext();
  }
  function typeNext() {
    $("typeFeedback").textContent = "";
    $("typeFeedback").className = "feedback";
    $("typeInput").value = "";
    if (ty.idx >= ty.queue.length) {
      const pct = ty.queue.length ? Math.round(ty.score / ty.queue.length * 100) : 0;
      $("typePrompt").textContent = "🦛🎉 Done! Your score: " + ty.score + "/" + ty.queue.length + " (" + pct + "%)";
      $("typeHint").textContent = "";
      $("typeInput").style.display = "none";
      updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.queue.length, ty.score);
      return;
    }
    $("typeInput").style.display = "inline-block";
    const item = ty.queue[ty.idx];
    $("typePrompt").textContent = item.prompt;
    $("typeHint").textContent = "Type the translation and press Enter";
    updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.idx, ty.score);
    $("typeInput").focus();
  }
  function typeCheck() {
    const item = ty.queue[ty.idx];
    if (!item) return;
    const given = $("typeInput").value;
    if (!given.trim()) return;
    if (normalize(given) === normalize(item.answer)) {
      ty.score++;
      $("typeFeedback").textContent = "✔ Correct!";
      $("typeFeedback").classList.add("good");
    } else {
      $("typeFeedback").textContent = "✘ Almost! It was: " + item.answer;
      $("typeFeedback").classList.add("bad");
    }
    ty.idx++;
    updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.idx, ty.score);
    setTimeout(typeNext, 1200);
  }
  $("typeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") typeCheck(); });
  $("typeStart").addEventListener("click", typeStart);

  // ---------- Flashcards ----------
  let fl = { queue: [], idx: 0 };
  function flashStart() {
    let pool = getPairs("1to2");
    if (!pool.length) { $("flashFront").textContent = "🦛 Add words first!"; return; }
    if ($("flashShuffle").checked) pool = shuffle(pool);
    fl = { queue: pool, idx: 0 };
    flashShow();
  }
  function flashShow() {
    $("flashCard").classList.remove("flipped");
    const item = fl.queue[fl.idx];
    $("flashFront").textContent = item ? item.prompt : "🦛";
    $("flashBack").textContent = item ? item.answer : "…";
    $("flashCount").textContent = "Card " + (fl.idx + 1) + "/" + fl.queue.length;
  }
  $("flashCard").addEventListener("click", () => $("flashCard").classList.toggle("flipped"));
  $("flashNext").addEventListener("click", () => {
    if (fl.queue.length) { fl.idx = (fl.idx + 1) % fl.queue.length; flashShow(); }
  });
  $("flashPrev").addEventListener("click", () => {
    if (fl.queue.length) { fl.idx = (fl.idx - 1 + fl.queue.length) % fl.queue.length; flashShow(); }
  });
  $("flashStart").addEventListener("click", flashStart);

  // ---------- Init: sessie herstellen of login tonen ----------
  const session = localStorage.getItem(SESSION_KEY);
  if (session && getAccounts()[session]) {
    startSession(session);
  } else {
    loadColNames(); // alleen om defaults te tonen achter login
  }
})();
