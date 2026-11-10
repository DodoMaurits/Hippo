import { createClient } from "https://esm.run/@supabase/supabase-js@2";

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

  let words = [];
  let lastRowIdx = -1;
  let quizOpts = { caseSensitive: false, fuzzy: false, help: "normal", feedback: "brief", punct: true };
  let activeQuiz = null;

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
      if (!data.session) {
        await showModal({
          title: "Check your inbox",
          text: "A confirmation e-mail has been sent to " + email + ". Click the link in it to activate your account, then log in.",
          okText: "OK"
        });
        return;
      }
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
    let all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("words")
        .select("id, lang1, lang2")
        .eq("list_id", currentList.id)
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (error) { console.error(error); break; }
      all = all.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    words = all.map((r) => ({ id: r.id, a: r.lang1, b: r.lang2 }));
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
    const c1 = $("col1name").value || "Language 1";
    const c2 = $("col2name").value || "Language 2";
    $("col1name").placeholder = c1;
    $("col2name").placeholder = c2;
    document.querySelectorAll("#mcDirection option, #typeDirection option, #flashDirection option").forEach((o) => {
      if (o.value === "1to2") o.textContent = c1 + " → " + c2;
      else if (o.value === "2to1") o.textContent = c2 + " → " + c1;
    });
  }

  function showModal({ title, text, inputPlaceholder, okText, extraButton, hideCancel }) {
    return new Promise((resolve) => {
      const ov = $("modalOverlay");
      $("modalTitle").textContent = title;
      $("modalText").textContent = text || "";
      const inp = $("modalInput");
      if (inputPlaceholder) { inp.classList.remove("hidden"); inp.value = ""; inp.placeholder = inputPlaceholder; }
      else { inp.classList.add("hidden"); }
      $("modalMsg").textContent = "";
      $("modalCancel").classList.add("hidden");
      $("modalOk").textContent = okText || "OK";
      let extra = null;
      if (extraButton) {
        document.querySelectorAll(".modal-extra").forEach((b) => b.remove());
        extra = document.createElement("button");
        extra.className = "btn secondary modal-extra";
        extra.textContent = extraButton.label;
        extra.onclick = () => done(extraButton.value);
        $("modalOk").after(extra);
      }
      ov.classList.remove("hidden");
      const done = (val) => { if (extra) extra.remove(); ov.classList.add("hidden"); resolve(val); };
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
    updateNewlistTab();
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      if (tab.dataset.tab === "newlist") { newList(); return; }
      if (["quiz-mc", "quiz-type", "flash"].includes(tab.dataset.tab) && currentList && !getPairs("1to2").length) {
        showModal({ title: "🦛 The pool is empty!", text: "Add words first!", okText: "OK" });
        return;
      }
      const cur = currentQuizMode();
      if (cur) {
        if (!(await confirmLeaveQuiz(cur))) return;
      }
      if (tab.dataset.tab === "overview") { currentList = null; renderOverview(); activateTab("overview"); return; }
      activateTab(tab.dataset.tab);
    });
  });

  $("backToOverview").addEventListener("click", async () => {
    if (currentQuizMode() && !(await confirmLeaveQuiz(currentQuizMode()))) return;
    currentList = null;
    renderOverview(); activateTab("overview");
  });
  
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
    setQuizTabs(!!currentList);
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
    if (!words.length) {
      if (GUEST) {
        words.push({ id: "g" + Date.now(), listId: currentList.id, a: "", b: "" });
        save();
      } else {
        const { data, error } = await supabase
          .from("words")
          .insert({ lang1: "", lang2: "", list_id: currentList.id })
          .select("id").single();
        if (!error && data) words.push({ id: data.id, listId: currentList.id, a: "", b: "" });
      }
    }
    renderList();
    $("mcMax").value = words.length;
    $("typeMax").value = words.length;
    $("flashMax").value = words.length;
    updateImgBtn();
    activateTab("list");
    setQuizTabs(true);
  }

  function updateImgBtn() {
    const on = currentList && currentList.imgMode;
    $("imgModeBtn").textContent = on ? "🖼️ Image ✅" : "🖼️ Image";
    $("imgModeBtn").style.color = on ? "#43d17c" : "";
    $("autoImgBtn").classList.toggle("hidden", !on);
    $("typeDirection").disabled = !!on;
    if (on) $("typeDirection").value = "1to2";
  }
  $("imgModeBtn").addEventListener("click", () => {
    if (!currentList) return;
    currentList.imgMode = !currentList.imgMode;
    if (GUEST) saveListsGuest();
    updateImgBtn();
    renderList();
  });
  $("autoImgBtn").addEventListener("click", async () => {
    if (!currentList) return;
    if (!currentList.imgMode) {
      currentList.imgMode = true;
      if (GUEST) saveListsGuest();
      updateImgBtn();
    }
    const todo = words.map((w, i) => ({ w, i })).filter((x) => x.w.b.trim() && !x.w.a.trim());
    if (!todo.length) {
      await showModal({ title: "🤖 Automatic images", text: "No words without an image yet.", okText: "OK" });
      return;
    }
    const btn = $("autoImgBtn");
    btn.disabled = true;
    btn.textContent = "🤖 Searching images…";
    let found = 0, failed = 0;
    for (const { w, i } of todo) {
      try {
        const res = await fetch("https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=" + encodeURIComponent(w.b.trim() + " filetype:bitmap") + "&gsrlimit=5&prop=imageinfo&iiprop=url&iiurlwidth=400&format=json&origin=*");
        if (!res.ok) { failed++; continue; }
        const data = await res.json();
        const pages = Object.values((data.query && data.query.pages) || {});
        const pick = pages.map((p) => p.imageinfo && p.imageinfo[0] && (p.imageinfo[0].thumburl || p.imageinfo[0].url)).find((u) => u && u.startsWith("http"));
        if (pick) {
          words[i].a = pick.url;
          found++;
          if (GUEST) save();
          else await supabase.from("words").update({ lang1: pick.url }).eq("id", w.id);
        }
      } catch (e) { failed++; }
    }
    renderList();
    btn.disabled = false;
    btn.textContent = "🤖 Automatic images";
    await showModal({
      title: "🤖 Automatic images",
      text: found ? found + " images added" + (failed ? " (" + failed + " failed/rate-limited)" : "") + "!" : 
        "No images found — maybe rate-limited (max 200/day anonymous). Try again later.",
      okText: "OK"
    });
  });
  
  function setQuizTabs(show) {
    document.querySelectorAll('.tab[data-tab="quiz-mc"], .tab[data-tab="quiz-type"], .tab[data-tab="flash"]')
      .forEach((t) => t.classList.toggle("hidden", !show));
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
      if (currentList.imgMode) {
        const td1img = document.createElement("img");
        td1img.style.cssText = "max-width:80px;max-height:60px;border-radius:8px;vertical-align:middle;";
        if (w.a) td1img.src = w.a;
        const file = document.createElement("input");
        file.type = "file"; file.accept = "image/*"; file.className = "hidden";
        file.addEventListener("change", () => {
          const f = file.files[0]; if (!f) return;
          const r = new FileReader();
          r.onload = async () => {
            words[i].a = r.result;
            if (GUEST) save();
            else await supabase.from("words").update({ lang1: r.result }).eq("id", w.id);
            renderList();
          };
          r.readAsDataURL(f);
        });
        const up = document.createElement("button");
        up.className = "btn secondary"; up.textContent = w.a ? "🖼️" : "＋🖼️";
        up.addEventListener("click", () => file.click());
        td1.appendChild(td1img); td1.appendChild(up); td1.appendChild(file);
      }
      const in1 = currentList.imgMode ? null : document.createElement("input");
      const in2 = document.createElement("input");
      if (in1) { in1.type = "text"; in1.value = w.a; in1.placeholder = "word in language 1"; }
      in2.type = "text"; in2.value = w.b; in2.placeholder = "word in language 2";
      const tabGo = (e) => {
        if (e.key === "Tab" && i === words.length - 1) {
          e.preventDefault();
          $("addRow").click();
        }
      };
      if (in1) {
        in1.addEventListener("input", async () => {
          words[i].a = in1.value;
          if (GUEST) return save();
          await supabase.from("words").update({ lang1: in1.value }).eq("id", w.id);
        });
        in1.addEventListener("focus", () => { lastRowIdx = i; });
      }
      in2.addEventListener("input", async () => {
        words[i].b = in2.value;
        if (GUEST) return save();
        await supabase.from("words").update({ lang2: in2.value }).eq("id", w.id);
      });
      in2.addEventListener("focus", () => { lastRowIdx = i; });
      in2.addEventListener("keydown", tabGo);
      const del = document.createElement("button");
      del.className = "btn danger row-del";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        if (GUEST) { words.splice(i, 1); save(); renderList(); return; }
        await supabase.from("words").delete().eq("id", w.id);
        words.splice(i, 1);
        renderList();
      });
      if (in1) td1.appendChild(in1); td2.appendChild(in2); tdDel.appendChild(del);
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
    $("delRowBtn").addEventListener("click", async () => {
    if (lastRowIdx < 0 || !words[lastRowIdx]) {
      await showModal({ title: "🗑️ Delete row", text: "Tap a word row first, then Delete row.", okText: "OK" });
      return;
    }
    const ok = await showModal({ title: "🗑️ Delete row", text: "Delete this word pair?", okText: "Delete" });
    if (!ok) return;
    const i = lastRowIdx;
    if (GUEST) { words.splice(i, 1); save(); renderList(); return; }
    await supabase.from("words").delete().eq("id", words[i].id);
    words.splice(i, 1);
    renderList();
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

  // ---------- Quiz helpers ----------
  function gradeFeedback(grade) {
    if (grade < 5.5) return "Keep going — don't give up! 💪";
    if (grade < 7.5) return "Splashing great! You are on the right path! 🌱";
    if (grade < 9.5) return "Awesome! One more? Practice makes perfect 🌟";
    return "You nailed it! 🦛👑";
  }
  async function confirmLeaveQuiz(mode) {
    if (!mode) return true;
    const res = await showModal({
      title: "Leave quiz?",
      text: "Are you sure you want to leave?",
      okText: "End Quiz",
      extraButton: { label: "Leave but save", value: "save" }
    });
    if (res === "save") { saveQuiz(mode); return true; }
    if (res === true) { clearSavedQuiz(); activeQuiz = null; resetQuizUI(mode); return true; }
    return false;
  }
  function resetQuizUI(mode) {
    if (mode === "mc") {
      mc = { queue: [], total: 0, idx: 0, score: 0, locked: false };
      $("mcChoices").innerHTML = ""; $("mcFeedback").textContent = ""; $("mcPrompt").textContent = "";
      setQuizChrome("panel-quiz-mc", true);
    }
    if (mode === "ty") {
      ty = { queue: [], total: 0, idx: 0, score: 0 };
      $("typeInput").classList.add("hidden"); $("typeFeedback").textContent = ""; $("typePrompt").textContent = ""; $("typeHint").textContent = "";
      setQuizChrome("panel-quiz-type", true);
    }
    if (mode === "fl") {
      fl = { queue: [], idx: 0 };
      $("flashFront").textContent = "🦛"; $("flashBack").textContent = "…";
      $("panel-flash").querySelector(".flash-nav").classList.add("hidden");
      setQuizChrome("panel-flash", true);
    }
    updateNewlistTab();
  }
  function setQuizChrome(panelId, show) {
    const p = $(panelId);
    p.querySelector(".quiz-controls").classList.toggle("hidden", !show);
    const o = p.querySelector(".quiz-options");
    if (o) o.classList.toggle("hidden", !show);
  }
  function currentQuizMode() {
    const t = document.querySelector(".tab.active");
    if (!t) return null;
    const tab = t.dataset.tab;
    if (tab === "quiz-mc" && mc.queue.length > mc.idx) return "mc";
    if (tab === "quiz-type" && ty.queue.length > ty.idx) return "ty";
    if (tab === "flash" && fl.queue.length > fl.idx) return "fl";
    return null;
  }
  function updateNewlistTab() {
    const t = document.querySelector('.tab[data-tab="newlist"]');
    if (t) t.classList.toggle("hidden", !!currentQuizMode());
  }
  const QUIZ_SAVE_KEY = "hippo-quiz-save";
  function saveQuiz(mode) {
    if (!mode) return;
    const st = mode === "mc" ? mc : mode === "ty" ? ty : fl;
    localStorage.setItem(QUIZ_SAVE_KEY, JSON.stringify({ mode, state: st, opts: quizOpts }));
  }
  function loadSavedQuiz() {
    try { return JSON.parse(localStorage.getItem(QUIZ_SAVE_KEY)); } catch (e) { return null; }
  }
  function clearSavedQuiz() { localStorage.removeItem(QUIZ_SAVE_KEY); }
  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function normalize(s) {
    s = s.trim().toLowerCase().replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();
    if (quizOpts.punct === false) s = s.replace(/[.,!?;:"'«»“”‘’…—–-]/g, "");
    return s;
  }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function diffHighlight(given, target) {
    const n = Math.max(given.length, target.length);
    let html = "";
    for (let i = 0; i < n; i++) {
      const g = i < given.length ? given[i] : "";
      const t = i < target.length ? target[i] : "";
      if (g === t) html += '<span class="ok">' + esc(t) + "</span>";
      else html += '<span class="err">' + esc(t || "·") + "</span>";
    }
    return html;
  }
  function acceptedAnswers(answer) {
    return answer.split(";")
      .map((s) => (quizOpts.caseSensitive ? s.trim() : normalize(s)))
      .filter(Boolean);
  }
  function levenshtein(a, b) {
    const m = a.length, n = b.length;
    const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 1; j <= n; j++) d[0][j] = j;
    for (let i = 1; i <= m; i++)
      for (let j = 1; j <= n; j++)
        d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
    return d[m][n];
  }
  function shuffleLetters(text) {
    return text.split(" ").map((word) => {
      const arr = word.split("");
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      const s = arr.join("");
      return (s === word && word.length > 1) ? shuffleLetters(word) : s;
    }).join(" ");
  }
  function getPairs(direction) {
    return words
      .filter((w) => w.a.trim() && w.b.trim())
      .map((w) => {
        const img = !!(currentList && currentList.imgMode);
        if (direction === "both") {
          return Math.random() < 0.5
            ? { prompt: w.a, answer: w.b, answerImg: false }
            : { prompt: w.b, answer: w.a, answerImg: img };
        }
        return direction === "2to1"
          ? { prompt: w.b, answer: w.a, answerImg: img }
          : { prompt: w.a, answer: w.b, answerImg: false };
      });
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
    if (!pool.length) { 
      showModal({ title: "🦛 The pool is empty!", text: "Add words first!", okText: "OK" }); activateTab("list"); return; 
    }
    if ($("mcShuffle").checked) pool = shuffle(pool);
    const max = parseInt($("mcMax").value, 10) || pool.length;
    pool = pool.slice(0, Math.min(max, pool.length));
    mc = { queue: pool, total: pool.length, idx: 0, score: 0, locked: false };
    setQuizChrome("panel-quiz-mc", false);
    activeQuiz = "mc";
    updateNewlistTab();
    clearSavedQuiz();
    mcNext();
  }
  function mcNext() {
    $("mcFeedback").textContent = "";
    $("mcFeedback").className = "feedback";
    if (mc.idx >= mc.queue.length) {
      const pct = mc.total ? Math.round(mc.score / mc.total * 100) : 0;
      const grade = Math.max(1, Math.min(10, Math.round((1 + 9 * (mc.score / mc.total)) * 10) / 10));
      $("mcPrompt").style.fontSize = "4.5rem";
      $("mcPrompt").textContent = grade.toFixed(1);
      $("mcHint").textContent = "Score " + mc.score + "/" + mc.total + " — " + gradeFeedback(grade);
      clearSavedQuiz();
      activeQuiz = null;
      updateNewlistTab();
      $("mcChoices").innerHTML = "";
      setQuizChrome("panel-quiz-mc", true);
      updateScore($("mcProgress"), $("mcScore"), $("mcCount"), mc.total, mc.total, mc.score);
      return;
    }
    mc.locked = false;
    const item = mc.queue[mc.idx];
    if (typeof item.prompt === "string" && (item.prompt.startsWith("data:image") || item.prompt.startsWith("http")))
      $("mcPrompt").innerHTML = 
        '<img src="' + item.prompt + '" style="max-width:220px;max-height:170px;border-radius:12px;">';
    else $("mcPrompt").textContent = item.prompt;
    $("mcPrompt").style.fontSize = "";
    $("mcHint").textContent = "Pick the correct translation";
    saveQuiz("mc");
    const wrong = shuffle(mc.queue.filter((x) => x.answer !== item.answer)).slice(0, 3).map((x) => x.answer);
    const options = shuffle([item.answer, ...wrong]);
    const box = $("mcChoices");
    box.innerHTML = "";
    options.forEach((opt) => {
      const btn = document.createElement("button");
      btn.className = "choice";
      btn.dataset.opt = opt;
      if (item.answerImg) btn.innerHTML = 
        '<img src="' + opt + '" style="max-width:130px;max-height:95px;border-radius:10px;">';
      else btn.textContent = opt;
      btn.addEventListener("click", () => {
        if (mc.locked) return;
        mc.locked = true;
        if (normalize(opt) === normalize(item.answer)) {
          btn.classList.add("correct");
          if (!item.missed) mc.score++;
          $("mcFeedback").textContent = "✔ Correct!";
          $("mcFeedback").classList.add("good");
        } else {
          btn.classList.add("wrong");
          item.missed = true;
          const back = 2 + Math.floor(Math.random() * 3); // 2, 3 of 4
          mc.queue.splice(Math.min(mc.idx + back, mc.queue.length), 0, item);
          $("mcFeedback").textContent = "✘ Oops! It was: " + item.answer;
          $("mcFeedback").classList.add("bad");
          box.querySelectorAll(".choice").forEach((b) => {
            if (normalize(b.dataset.opt) === normalize(item.answer)) b.classList.add("correct");
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
    quizOpts.caseSensitive = $("typeCase").checked;
    quizOpts.help = document.querySelector('input[name="typeHelp"]:checked').value;
    quizOpts.fuzzy = $("typeFuzzy").checked;
    quizOpts.punct = $("typePunct").checked;
    quizOpts.feedback = document.querySelector('input[name="typeFeedback"]:checked').value;
    const dir = currentList.imgMode ? "1to2" : $("typeDirection").value;
    let pool = getPairs(dir);
    if (!pool.length) {
      showModal({ title: "🦛 The pool is empty!", text: "Add words first!", okText: "OK" }); activateTab("list"); return; 
    }
    if ($("typeShuffle").checked) pool = shuffle(pool);
    const max = parseInt($("typeMax").value, 10) || pool.length;
    pool = pool.slice(0, Math.min(max, pool.length));
    ty = { queue: pool, total: pool.length, idx: 0, score: 0 };
    setQuizChrome("panel-quiz-type", false);
    activeQuiz = "ty";
    updateNewlistTab();
    clearSavedQuiz();
    typeNext();
  }
  function typeAdvance(immediate) {
    ty.locked = true;
    ty.idx++;
    updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.idx, ty.score);
    saveQuiz("ty");
    if (immediate) typeNext();
    else setTimeout(typeNext, 1200);
  }
  function typeNext() {
    $("typeFeedback").textContent = "";
    $("typeFeedback").className = "feedback";
    $("typeContinue").classList.add("hidden"); ty.awaitContinue = false;
    ty.locked = false;
    if (ty.idx >= ty.queue.length) {
      const pct = ty.total ? Math.round(ty.score / ty.total * 100) : 0;
      const grade = Math.max(1, Math.min(10, Math.round((1 + 9 * (ty.score / ty.total)) * 10) / 10));
      $("typePrompt").style.fontSize = "4.5rem";
      $("typePrompt").textContent = grade.toFixed(1);
      $("typeHint").textContent = "Score " + ty.score + "/" + ty.total + " — " + gradeFeedback(grade);
      clearSavedQuiz();
      activeQuiz = null;
      updateNewlistTab();
      $("typeInput").classList.add("hidden");
      setQuizChrome("panel-quiz-type", true);
      updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.total, ty.total, ty.score);
      return;
    }
    $("typeInput").classList.remove("hidden");
    const item = ty.queue[ty.idx];
    $("typeInput").value = quizOpts.help === "hint" && item.answer ? item.answer[0] : "";
    $("typePrompt").style.fontSize = "";
    if (currentList.imgMode) $("typePrompt").innerHTML = '<img src="' + item.prompt + '" style="max-width:220px;max-height:170px;border-radius:12px;">';
    else $("typePrompt").textContent = item.prompt;
    $("typeHint").textContent = quizOpts.help === "scrambled" && item.answer ? "" + shuffleLetters(item.answer) : "";
    updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.idx, ty.score);
    $("typeInput").focus();
    saveQuiz("ty");
  }
  function typeCheck() {
    if (ty.awaitContinue) {
      ty.awaitContinue = false;
      $("typeContinue").classList.add("hidden");
      typeAdvance(true);
      return;
    }
    if (ty.locked) return;
    const item = ty.queue[ty.idx];
    if (!item) return;
    const given = $("typeInput").value;
    if (!given.trim()) return;
    const givenN = quizOpts.caseSensitive ? given.trim() : normalize(given);
    const ok = acceptedAnswers(item.answer).includes(givenN)
      || (quizOpts.fuzzy && acceptedAnswers(item.answer).some((a) => levenshtein(givenN, a) <= 1));
    if (ok) {
      if (!item.missed) ty.score++;
      $("typeFeedback").textContent = "✔ Correct!";
      $("typeFeedback").classList.add("good");
      $("typeFeedback").classList.remove("bad");
      typeAdvance();
    } else {
      item.missed = true;
      const back = 2 + Math.floor(Math.random() * 3);
      ty.queue.splice(Math.min(ty.idx + back, ty.queue.length), 0, item);
      $("typeFeedback").classList.add("bad");
      $("typeFeedback").classList.remove("good");
      if (quizOpts.feedback === "never") {
        $("typeFeedback").textContent = "✘ Wrong";
      } else {
        const target = acceptedAnswers(item.answer)[0] || normalize(item.answer);
        $("typeFeedback").innerHTML = "✘ Almost! It was: " + diffHighlight(givenN, target);
      }
      if (quizOpts.feedback === "click") {
        ty.awaitContinue = true;
        $("typeContinue").classList.remove("hidden");
        return;
      }
      typeAdvance();
    }
  }
  $("typeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") typeCheck(); });
  $("typeStart").addEventListener("click", typeStart);
  $("typeContinue").addEventListener("click", typeCheck);

  // ---------- Flashcards ----------
  let fl = { queue: [], idx: 0 };
  function flashStart() {
    if (!currentList) { $("flashFront").textContent = "🦛 Open a list first (🗂️ My lists)"; return; }
    let pool = getPairs($("flashDirection").value);
    if (!pool.length) { 
      showModal({ title: "🦛 The pool is empty!", text: "Add words first!", okText: "OK" }); activateTab("list"); return; 
    }
    if ($("flashShuffle").checked) pool = shuffle(pool);
    const max = parseInt($("flashMax").value, 10) || pool.length;
    pool = pool.slice(0, Math.min(max, pool.length));
    fl = { queue: pool, idx: 0 };
    setQuizChrome("panel-flash", false);
    activeQuiz = "fl";
    updateNewlistTab();
    clearSavedQuiz();
    $("panel-flash").querySelector(".flash-nav").classList.remove("hidden");
    flashShow();
  }
  function flashShow() {
    $("flashCard").classList.remove("flipped");
    const item = fl.queue[fl.idx];
    const p = item ? item.prompt : "🦛";
    const a = item ? item.answer : "…";
    if (typeof p === "string" && (p.startsWith("data:image") || p.startsWith("http"))) $("flashFront").innerHTML = 
      '<img src="' + p + '" style="max-height:180px;border-radius:12px;">';
    else $("flashFront").textContent = p;
    if (typeof a === "string" && (a.startsWith("data:image") || a.startsWith("http"))) $("flashBack").innerHTML = 
      '<img src="' + a + '" style="max-height:180px;border-radius:12px;">';
    else $("flashBack").textContent = a;
    $("flashCount").textContent = "Card " + (fl.idx + 1) + "/" + fl.queue.length;
    saveQuiz("fl");
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
    await showModal({ 
      title: "📥 Import done", text: clean.length + " words added to “" + currentList.name + "”!", okText: "OK" 
    });
  });

  let tipMode = null;
  function showTip(mode) {
    const note = $("tipNote");
    if (tipMode === mode) { tipMode = null; note.classList.add("hidden"); note.textContent = ""; return; }
    tipMode = mode;
    note.innerHTML = mode === "semi"
      ? 'Use <b>;</b> for multiple accepted answers, for example: hey; hi.'
      : 'Anything in <b>(parentheses)</b> will be ignored.';
    note.classList.remove("hidden");
  }
  $("tipSemi").addEventListener("click", () => showTip("semi"));
  $("tipParen").addEventListener("click", () => showTip("paren"));
  $("toggleDelBtn").addEventListener("click", () => {
    $("panel-list").classList.toggle("show-del");
  });
  
  // ---------- Init ----------
  async function startGuest() {
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("loggedInUser").textContent = "🦛 Guest (local only)";
    await loadLists();
    loadColNames();
    renderOverview();
    activateTab("overview");
    setQuizTabs(true);
    const saved = loadSavedQuiz();
    if (saved && saved.state && (saved.state.queue || []).length > saved.state.idx) {
      const res = await showModal({
        title: "🦛 Unfinished quiz",
        text: "You have a quiz in progress. Resume it or start fresh?",
        okText: "Resume",
        extraButton: { label: "Discard", value: "discard" },
        hideCancel: true
      });
      if (res === true || res === "save") {
        activeQuiz = saved.mode;
        if (saved.mode === "mc") mc = saved.state; else if (saved.mode === "ty") ty = saved.state; else fl = saved.state;
        quizOpts = saved.opts || quizOpts;
        if (saved.mode === "mc") { activateTab("quiz-mc"); mcNext(); }
        else if (saved.mode === "ty") { activateTab("quiz-type"); typeNext(); }
        else { activateTab("flash"); flashShow(); }
        setQuizChrome(saved.mode === "mc" ? "panel-quiz-mc" : saved.mode === "ty" ? "panel-quiz-type" : "panel-flash", false);
      } else {
        clearSavedQuiz();
      }
    }
    await showModal({
      title: "Guest mode",
      text: "Guest lists are stored in your browser cache — clearing browsing data deletes them.",
      okText: "OK"
    });
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
        loadColNames();
        renderOverview();
        activateTab("overview");
        setQuizTabs(true);
        const saved = loadSavedQuiz();
        if (saved && saved.state && (saved.state.queue || []).length > saved.state.idx) {
          const res = await showModal({
          title: "🦛 Unfinished quiz",
          text: "You have a quiz in progress. Resume it or start fresh?",
          okText: "Resume",
          extraButton: { label: "Discard", value: "discard" },
          hideCancel: true
        });
        if (res === true || res === "save") {
        activeQuiz = saved.mode;
        if (saved.mode === "mc") mc = saved.state; else if (saved.mode === "ty") ty = saved.state; else fl = saved.state;
        quizOpts = saved.opts || quizOpts;
        if (saved.mode === "mc") { activateTab("quiz-mc"); mcNext(); }
        else if (saved.mode === "ty") { activateTab("quiz-type"); typeNext(); }
        else { activateTab("flash"); flashShow(); }
        setQuizChrome(saved.mode === "mc" ? "panel-quiz-mc" : saved.mode === "ty" ? "panel-quiz-type" : "panel-flash", false);
      } else {
        clearSavedQuiz();
      }
    }
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
