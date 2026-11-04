import { createClient } from "https://esm.run/@supabase/supabase-js@2";

// VUL IN vanuit jouw Supabase project (Settings → API):
const SUPABASE_URL = "https://mftdqmdnkzpttyoiehqj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DTosIGRbW2TOBrButJxndQ_N_Typi0a";
const GUEST = new URLSearchParams(location.search).get("guest") === "1";
const GUEST_WORDS_KEY = "hippo-guest-words";
const GUEST_COLNAMES_KEY = "hippo-guest-colnames";
let lists = [];
let currentList = null;
const GUEST_LISTS_KEY = "hippo-guest-lists";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let words = []; // [{ id, a, b }]

  // ---------- Auth ----------
  function authMsg(text, ok) {
    const el = $("authMsg");
    el.textContent = text;
    el.classList.toggle("ok", !!ok);
  }

  const pass2Field = $("authPass2");

  async function handleAuth(mode) {
    const email = $("authEmail").value.trim();
    const pass = $("authPass").value;
    if (!email.includes("@")) return authMsg("Enter a valid email address");
    if (pass.length < 6) return authMsg("Password: at least 6 characters");
    if (mode === "register") {
      if (pass !== pass2Field.value) return authMsg("Passwords do not match");
      const { data, error } = await supabase.auth.signUp({ email, password: pass });
      if (error) return authMsg(error.message);
      if (!data.session) return authMsg("Account created — confirm it via the email we sent 📧", true);
      authMsg("Account created — you are logged in! 🦛", true);
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password: pass });
      if (error) {
        if (error.message.toLowerCase().includes("invalid login credentials")) {
          const { data: exists } = await supabase.rpc("email_exists", { p_email: email });
          if (exists) return authMsg("Wrong password");
          return authMsg("No account with this email yet — use Create account");
        }
        return authMsg(error.message);
      }
    }
  }

  $("btnLogin").addEventListener("click", () => {
    pass2Field.classList.add("hidden");
    handleAuth("login");
  });
  $("btnRegister").addEventListener("click", () => {
    pass2Field.classList.remove("hidden");
    pass2Field.focus();
    handleAuth("register");
  });

  $("btnLogout").addEventListener("click", async () => {
    if (GUEST) { location.href = location.pathname; return; }
    await supabase.auth.signOut();
  });

  // ---------- Data (Supabase) ----------
  function save() {
    if (GUEST) { localStorage.setItem(GUEST_WORDS_KEY, JSON.stringify(words)); return; }
  }
  
  async function loadWords() {
    if (GUEST) {
      let raw = null;
      try { raw = localStorage.getItem(GUEST_WORDS_KEY); } catch (e) {}
      words = (raw ? JSON.parse(raw) : [])
        .filter((w) => !currentList || w.listId === currentList.id)
        .map((w, i) => ({ id: w.id || "g" + i, listId: w.listId, a: w.a || "", b: w.b || "" }));
      return;
    }
    const { data, error } = await supabase
      .from("words")
      .select("id, lang1, lang2")
      .eq("list_id", currentList.id)
      .order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    words = data.map((r) => ({ id: r.id, a: r.lang1, b: r.lang2 }));
  }

  function loadColNames() {
    if (currentList) {
      $("col1name").value = currentList.col1 || "Language 1";
      $("col2name").value = currentList.col2 || "Language 2";
    }
    updateHeaders();
  }
  async function saveColNames() {
    if (!currentList) return;
    currentList.col1 = $("col1name").value;
    currentList.col2 = $("col2name").value;
    if (GUEST) { saveListsGuest(); return; }
    await supabase.from("lists").update({ col1: currentList.col1, col2: currentList.col2 }).eq("id", currentList.id);
  }

  function updateHeaders() {
    $("th1").textContent = $("col1name").value || "Language 1";
    $("th2").textContent = $("col2name").value || "Language 2";
  }

  function showModal({ title, text, inputPlaceholder, okText }) {
    return new Promise((resolve) => {
      const ov = $("modalOverlay");
      $("modalTitle").textContent = title;
      $("modalText").textContent = text || "";
      const inp = $("modalInput");
      if (inputPlaceholder) { inp.classList.remove("hidden"); inp.value = ""; inp.placeholder = inputPlaceholder; }
      else { inp.classList.add("hidden"); }
      $("modalMsg").textContent = "";
      $("modalOk").textContent = okText || "OK";
      ov.classList.remove("hidden");
      const done = (val) => { ov.classList.add("hidden"); resolve(val); };
      $("modalOk").onclick = () => {
        if (inputPlaceholder && !inp.value.trim()) { $("modalMsg").textContent = "Please enter a name"; return; }
        done(inputPlaceholder ? inp.value.trim() : true);
      };
      $("modalCancel").onclick = () => done(null);
      ov.onclick = (e) => { if (e.target === ov) done(null); };
      if (inputPlaceholder) inp.focus(); else $("modalOk").focus();
    });
  }
  
  // ---------- Tabs ----------
  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const panel = $("panel-" + name);
    if (panel) panel.classList.add("active");
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      if (tab.dataset.tab === "newlist") { newList(); return; }
      activateTab(tab.dataset.tab);
    });
  });

  $("backToOverview").addEventListener("click", () => { renderOverview(); activateTab("overview"); });

  async function loadLists() {
    if (GUEST) {
      try { lists = JSON.parse(localStorage.getItem(GUEST_LISTS_KEY)) || []; }
      catch (e) { lists = []; }
      if (!lists.length) {
        lists = [{ id: "g1", name: "My list", col1: "Language 1", col2: "Language 2" }];
        localStorage.setItem(GUEST_LISTS_KEY, JSON.stringify(lists));
      }
      return;
    }
    const { data, error } = await supabase
      .from("lists").select("id, name, col1, col2").order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    lists = data || [];
  }

  function saveListsGuest() {
    localStorage.setItem(GUEST_LISTS_KEY, JSON.stringify(lists));
  }

  function renderOverview() {
    const box = $("listsOverview");
    box.innerHTML = "";
    if (!lists.length) {
      box.innerHTML = '<p class="empty">No lists yet — create one with ➕ New list! 🦛</p>';
      return;
    }
    lists.forEach((l) => {
      const row = document.createElement("div");
      row.className = "list-item";
      const nameBtn = document.createElement("button");
      nameBtn.className = "list-name";
      nameBtn.textContent = "🗂️ " + l.name;
      nameBtn.addEventListener("click", () => openList(l.id));
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        const ok = await showModal({ title: "🗑️ Delete list", 
        text: "Delete list “" + l.name + "” and all its words?", okText: "Delete" }); 
        if (!ok) return;
        if (GUEST) {
          const w = (JSON.parse(localStorage.getItem(GUEST_WORDS_KEY) || "[]")).filter((x) => x.listId !== l.id);
          localStorage.setItem(GUEST_WORDS_KEY, JSON.stringify(w));
          lists = lists.filter((x) => x.id !== l.id);
          saveListsGuest();
        } else {
          supabase.from("words").delete().eq("list_id", l.id).then(() =>
            supabase.from("lists").delete().eq("id", l.id).then(() => {
              lists = lists.filter((x) => x.id !== l.id);
              renderOverview();
            })
          );
        }
        if (currentList && currentList.id === l.id) currentList = null;
        if (GUEST) renderOverview();
      });
      row.appendChild(nameBtn);
      row.appendChild(del);
      box.appendChild(row);
    });
  }

  async function newList() {
    const name = await showModal({ title: "➕ New list", text: "Name of the new list:", 
      inputPlaceholder: "New list", okText: "Create" }); 
    if (!name) return;
    if (GUEST) {
      const l = { id: "g" + Date.now(), name: name.trim(), col1: "Language 1", col2: "Language 2" };
      lists.push(l);
      saveListsGuest();
      renderOverview();
      openList(l.id);
      return;
    }
    const { data, error } = await supabase
      .from("lists").insert({ name: name.trim() }).select("id, name, col1, col2").single();
    if (error) { console.error(error); return; }
    lists.push(data);
    renderOverview();
    openList(data.id);
  }

  async function openList(id) {
    currentList = lists.find((l) => l.id === id) || null;
    if (!currentList) return;
    $("col1name").value = currentList.col1 || "Language 1";
    $("col2name").value = currentList.col2 || "Language 2";
    updateHeaders();
    await loadWords();
    renderList();
    activateTab("list");
  }
  
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
      in1.addEventListener("input", async () => {
        words[i].a = in1.value;
        if (GUEST) return save();
        await supabase.from("words").update({ lang1: in1.value }).eq("id", w.id);
      });
      in2.addEventListener("input", async () => {
        words[i].b = in2.value;
        if (GUEST) return save();
        await supabase.from("words").update({ lang2: in2.value }).eq("id", w.id);
      });
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        if (GUEST) { words.splice(i, 1); save(); renderList(); return; }
        await supabase.from("words").delete().eq("id", w.id);
        words.splice(i, 1);
        renderList();
      });
      td1.appendChild(in1); td2.appendChild(in2); tdDel.appendChild(del);
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(tdDel);
      body.appendChild(tr);
    });
    $("emptyMsg").style.display = words.length ? "none" : "block";
  }

  $("addRow").addEventListener("click", async () => {
    if (GUEST) {
      words.push({ id: "g" + Date.now(), listId: currentList.id, a: "", b: "" });
      save(); renderList();
      const inputs = $("listBody").querySelectorAll("tr:last-child input");
      if (inputs[0]) inputs[0].focus();
      return;
    }
    const { data, error } = await supabase
      .from("words")
      .insert({ lang1: "", lang2: "", list_id: currentList.id })
      .select("id, lang1, lang2")
      .single();
    if (error) { console.error(error); return; }
    words.push({ id: data.id, a: data.lang1, b: data.lang2 });
    renderList();
    const inputs = $("listBody").querySelectorAll("tr:last-child input");
    if (inputs[0]) inputs[0].focus();
  });

  $("clearList").addEventListener("click", async () => {
    const ok = await showModal({ title: "🧹 Clear list", text: "Remove all words from this list?", okText: "Clear" }); 
    if (words.length && ok) {
      if (GUEST) {
        const all = JSON.parse(localStorage.getItem(GUEST_WORDS_KEY) || "[]");
        localStorage.setItem(GUEST_WORDS_KEY, JSON.stringify(all.filter((w) => w.listId !== currentList.id)));
        words = [];
        renderList();
        return;
      }
      await supabase.from("words").delete().eq("list_id", currentList.id);
      words = [];
      renderList();
    }
  });

  $("col1name").addEventListener("input", () => { saveColNames(); updateHeaders(); });
  $("col2name").addEventListener("input", () => { saveColNames(); updateHeaders(); });

  // ---------- Quiz helpers (ongewijzigd) ----------
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function normalize(s) { return s.trim().toLowerCase().replace(/\s+/g, " "); }
  function acceptedAnswers(answer) {
    return answer.split(";").map((s) => normalize(s)).filter(Boolean);
  }
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

  // ---------- Multiple choice (ongewijzigd) ----------
  let mc = { queue: [], idx: 0, score: 0, locked: false };
  function mcStart() {
    if (!currentList) { $("mcPrompt").textContent = "🦛 Open a list first (🗂️ My lists)"; return; }
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

  // ---------- Typing (ongewijzigd) ----------
  let ty = { queue: [], idx: 0, score: 0 };
  function typeStart() {
    if (!currentList) { $("typePrompt").textContent = "🦛 Open a list first (🗂️ My lists)"; return; }
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
    if (acceptedAnswers(item.answer).includes(normalize(given))) {
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

  // ---------- Flashcards (ongewijzigd) ----------
  let fl = { queue: [], idx: 0 };
  function flashStart() {
    if (!currentList) { $("flashFront").textContent = "🦛 Open a list first (🗂️ My lists)"; return; }
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

  // ---------- Importeren ----------
  $("importBtn").addEventListener("click", () => $("importFile").click());

  $("importFile").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (!currentList) {
      await showModal({ title: "📥 Import", text: "Open a list first (🗂️ My lists)", okText: "OK" });
      return;
    }
    let rows = [];
    try {
      if (file.name.toLowerCase().endsWith(".csv")) {
        const text = await file.text();
        rows = text.split(/\r?\n/).map((l) => l.split(/[;,\t]/));
      } else {
        const mod = await import("https://esm.sh/xlsx@0.18.5");
        const XLSX = mod.default || mod.XLSX || mod;
        const wb = XLSX.read(await file.arrayBuffer());
        rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
      }
    } catch (err) {
      console.error(err);
      await showModal({ title: "📥 Import failed", text: "Could not read that file. Use .csv or .xlsx with columns A and B.", okText: "OK" });
      return;
    }
    const clean = rows
      .map((r) => [String(r[0] ?? "").trim(), String(r[1] ?? "").trim()])
      .filter((r) => r[0] || r[1]);
    if (!clean.length) {
      await showModal({ title: "📥 Import", text: "No words found in columns A and B.", okText: "OK" });
      return;
    }
    if (GUEST) {
      const all = JSON.parse(localStorage.getItem(GUEST_WORDS_KEY) || "[]");
      clean.forEach((r, i) => all.push({ id: "g" + Date.now() + "_" + i, listId: currentList.id, a: r[0], b: r[1] }));
      localStorage.setItem(GUEST_WORDS_KEY, JSON.stringify(all));
    } else {
      for (let i = 0; i < clean.length; i += 500) {
        const batch = clean.slice(i, i + 500)
          .map((r) => ({ lang1: r[0], lang2: r[1], list_id: currentList.id }));
        const { error } = await supabase.from("words").insert(batch);
        if (error) { console.error(error); }
      }
    }
    await loadWords();
    renderList();
    await showModal({ title: "📥 Import done", text: clean.length + " words added to “" + currentList.name + "”!", okText: "OK" });
  });
  
  // ---------- Init ----------
  async function startGuest() {
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("loggedInUser").textContent = "🦛 Guest (local only)";
    await loadLists();
    if (!currentList && lists.length) currentList = lists[0];
    loadColNames();
    renderOverview();
    activateTab("overview");
  }

  if (GUEST) {
    startGuest();
  } else {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        $("loginScreen").classList.add("hidden");
        $("app").classList.remove("hidden");
        $("loggedInUser").textContent = "🦛 " + session.user.email;
        await loadLists();
        if (!currentList && lists.length) currentList = lists[0];
        loadColNames();
        renderOverview();
        activateTab("overview");
      } else {
        words = [];
        $("app").classList.add("hidden");
        $("loginScreen").classList.remove("hidden");
        $("authPass").value = "";
        pass2Field.value = "";
        pass2Field.classList.add("hidden");
        authMsg("", false);
      }
    });
  }
})();
