import { createClient } from "https://esm.run/@supabase/supabase-js@2";

const SUPABASE_URL = "https://mftdqmdnkzpttyoiehqj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_DTosIGRbW2TOBrButJxndQ_N_Typi0a";
const GUEST = new URLSearchParams(location.search).get("guest") === "1";
const GUEST_WORDS_KEY = "hippo-guest-words";
const GUEST_COLNAMES_KEY = "hippo-guest-colnames";
let lists = [];
let folders = []; const openFolders = new Set();
let currentList = null;
const GUEST_LISTS_KEY = "hippo-guest-lists";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let wordStats = {};
try { wordStats = JSON.parse(localStorage.getItem("hippo-word-stats") || "{}"); } catch (e) {}
function bumpStat(id, key) {
  if (!id) return;
  if (!wordStats[id]) wordStats[id] = { wrong: 0, right: 0 };
  wordStats[id][key]++;
  try { localStorage.setItem("hippo-word-stats", JSON.stringify(wordStats)); } catch (e) {}
}

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let words = [];
  let lastRowIdx = -1;
  let dragIdx = -1;
  let dragOvType = null, dragOvId = null;
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
  async function flushList() {
    if (!currentList) return;
    if (GUEST) { save(); return; }
    for (const w of words) {
      await supabase.from("words").update({ lang1: w.a, lang2: w.b, hidden: !!w.hidden }).eq("id", w.id);
    }
  }
  
  async function loadWords() {
    if (GUEST) {
      let raw = null;
      try { raw = localStorage.getItem(GUEST_WORDS_KEY); } catch (e) {}
      words = (raw ? JSON.parse(raw) : [])
        .filter((w) => !currentList || w.listId === currentList.id)
        .map((w, i) => ({ id: w.id || "g" + i, listId: w.listId, a: w.a || "", b: w.b || "", hidden: !!w.hidden }));
      return;
    }
    let all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from("words")
        .select("id, lang1, lang2, hidden")
        .eq("list_id", currentList.id)
        .order("created_at", { ascending: true })
        .range(from, from + 999);
      if (error) { console.error(error); break; }
      all = all.concat(data || []);
      if (!data || data.length < 1000) break;
    }
    words = all.map((r) => ({ id: r.id, a: r.lang1, b: r.lang2, hidden: !!r.hidden }));
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

  function showModal({ title, text, inputPlaceholder, okText, extraButton, hideCancel, prefill }) {
    return new Promise((resolve) => {
      const ov = $("modalOverlay");
      $("modalTitle").textContent = title;
      $("modalText").textContent = text || "";
      const inp = $("modalInput");
      if (inputPlaceholder) { inp.classList.remove("hidden"); inp.value = prefill || ""; inp.placeholder = inputPlaceholder; }
      else { inp.classList.add("hidden"); }
      $("modalMsg").textContent = "";
      $("modalCancel").classList.toggle("hidden", !!hideCancel);
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
    try { localStorage.setItem("hippo-tab", name); } catch (e) {}
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      if (tab.dataset.tab === "newlist") { newList(); return; }
      const fromList = document.querySelector(".tab.active") && 
        document.querySelector(".tab.active").dataset.tab === "list";
      if (fromList && currentList) await flushList();
      if (["quiz-mc", "quiz-type", "flash"].includes(tab.dataset.tab) && currentList && !getPairs("1to2").length) {
        showModal({ title: "🦛 The pool is empty!", text: "Add words first!", okText: "OK" });
        return;
      }
      const cur = currentQuizMode();
      if (cur) {
        if (!(await confirmLeaveQuiz(cur))) return;
        if (currentList) { activateTab("list"); return; }
      }
      if (tab.dataset.tab === "overview") { 
        currentList = null; try { 
          localStorage.removeItem("hippo-list"); 
        } catch (e) {} renderOverview(); activateTab("overview"); return; 
      }
      activateTab(tab.dataset.tab);
      const modeMap = { "quiz-mc": "mc", "quiz-type": "ty", "flash": "fl" };
      const m = modeMap[tab.dataset.tab];
      if (m) {
        if (currentList) await flushList();
        const filled = words.filter((w) => w.a.trim() || w.b.trim()).length;
        $("mcMax").value = filled; $("typeMax").value = filled; $("flashMax").value = filled;
        if (!currentQuizMode()) resetQuizUI(m);
      }
    });
  });

  $("backToOverview").addEventListener("click", async () => {
    if (currentList) await flushList();
    if (currentQuizMode() && !(await confirmLeaveQuiz(currentQuizMode()))) return;
    try { localStorage.removeItem("hippo-list"); } catch (e) {}
    currentList = null;
    renderOverview(); activateTab("overview");
  });
  
  async function loadLists() {
    if (GUEST) {
      try { lists = JSON.parse(localStorage.getItem(GUEST_LISTS_KEY)) || []; } catch (e) { lists = []; }
      try { folders = JSON.parse(localStorage.getItem("hippo-guest-folders")) || []; } catch (e) { folders = []; }
      if (!lists.length) {
        lists = [{ id: "g1", name: "My list", col1: "Language 1", col2: "Language 2" }];
        localStorage.setItem(GUEST_LISTS_KEY, JSON.stringify(lists));
      }
      return;
    }
    const { data, error } = await supabase
      .from("lists").select("id, name, col1, col2, folder").order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    lists = data || [];
    folders = [...new Set(lists.map((l) => l.folder).filter(Boolean))].map((name) => ({ id: name, name }));
  }

  function saveFoldersGuest() { localStorage.setItem("hippo-guest-folders", JSON.stringify(folders)); }
  async function newFolder() {
    const name = await showModal({ title: "📁 Create map", inputPlaceholder: "New map", okText: "Create" });
    if (!name || !name.trim()) return;
    folders.unshift({ id: "f" + Date.now(), name: name.trim() });
    if (GUEST) saveFoldersGuest();
    renderOverview();
  }
  $("newFolderBtn").addEventListener("click", newFolder);

  async function addListsToFolder(f) {
    if (!lists.length) { await showModal({ title: "📁 " + f.name, text: "Er zijn nog geen lijsten.", okText: "OK" }); return; }
    const ov = $("modalOverlay");
    $("modalTitle").textContent = "📁 Manage lists in " + f.name;
    $("modalInput").classList.add("hidden");
    $("modalMsg").textContent = "";
    $("modalCancel").classList.remove("hidden");
    $("modalOk").textContent = "Save";
    document.querySelectorAll(".modal-checks").forEach((d) => d.remove());
    const wrap = document.createElement("div");
    wrap.className = "modal-checks";
    wrap.style.cssText = "text-align:left; max-height:220px; overflow:auto; margin-bottom:10px;";
    lists.forEach((l) => {
      const lab = document.createElement("label");
      lab.className = "opt-pill";
      lab.style.cssText = "display:inline-flex; margin-bottom:6px;";
      lab.innerHTML = '<input type="checkbox" value="' + l.id + '"' + (l.folder === f.id ? " checked" : "") + ' style="display:none"> ' + l.name;
      wrap.appendChild(lab);
    });
    $("modalMsg").after(wrap);
    ov.classList.remove("hidden");
    const picked = await new Promise((resolve) => {
      const done = (val) => { wrap.remove(); ov.classList.add("hidden"); resolve(val); };
      $("modalOk").onclick = () => done([...wrap.querySelectorAll("input")].map((c) => ({ id: c.value, on: c.checked })));
      $("modalCancel").onclick = () => done(null);
      ov.onclick = (e) => { if (e.target === ov) done(null); };
    });
    if (!picked) return;
    for (const { id, on } of picked) {
      const l = lists.find((x) => x.id === id);
      if (!l) continue;
      const newFolder = on ? f.id : (l.folder === f.id ? null : l.folder);
      if (newFolder !== l.folder) {
        l.folder = newFolder;
        if (!GUEST) await supabase.from("lists").update({ folder: newFolder }).eq("id", l.id);
      }
    }
    if (GUEST) saveListsGuest();
    renderOverview();
  }
  
  async function pickFolder(l) {
    const names = folders.map((f) => f.name);
    const label = names.length ? names.map((n, i) => (i + 1) + ") " + n).join(", ") : "(geen mappen)";
    const ans = await showModal({ title: "📁 Verplaats “" + l.name + "” naar map", text: "Kies: " + label + ". Leeg = uit map halen.", inputPlaceholder: "Naam of nummer", okText: "Verplaats" });
    if (ans === null || ans === true || !String(ans).trim()) return;
    const q = String(ans).trim().toLowerCase();
    const f = folders.find((fo, i) => fo.name.toLowerCase() === q || String(i + 1) === q);
    l.folder = f ? f.id : null;
    if (GUEST) saveListsGuest();
    else await supabase.from("lists").update({ folder: l.folder }).eq("id", l.id);
    renderOverview();
  }
  
  function saveListsGuest() {
    localStorage.setItem(GUEST_LISTS_KEY, JSON.stringify(lists));
  }

  function renderOverview() {
    const box = $("listsOverview");
    box.innerHTML = "";
    if (!lists.length && !folders.length) {
      box.innerHTML = '<p class="empty">The pool is empty — start with ➕ New list! 🦛</p>';
      setQuizTabs(!!currentList);
      return;
    }
    const addListRow = (l) => {
      const row = document.createElement("div");
      row.className = "list-item" + (l.folder ? " in-folder" : "");
      const nameBtn = document.createElement("button");
      nameBtn.className = "list-name";
      nameBtn.textContent = "📋 " + l.name;
      nameBtn.addEventListener("click", () => openList(l.id));
      const del = document.createElement("button");
      del.className = "btn danger ov-del";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
        const ok = await showModal({ title: "🗑️ Delete list", text: "Delete list “" + l.name + "” and all its words?", okText: "Delete" });
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
      const edit = document.createElement("button");
      edit.className = "btn secondary ov-edit";
      edit.textContent = "✏️";
      edit.addEventListener("click", async () => {
        const name = await showModal({ title: "Rename list", inputPlaceholder: "New name", prefill: l.name, okText: "Save"});
        if (!name || !name.trim()) return;
        l.name = name.trim();
        if (GUEST) saveListsGuest();
        else await supabase.from("lists").update({ name: l.name }).eq("id", l.id);
        renderOverview();
      });
      row.appendChild(nameBtn); row.appendChild(edit); row.appendChild(del);
            const ord = document.createElement("span");
      ord.className = "row-order";
      ord.textContent = "☰";
      row.insertBefore(ord, row.firstChild);
      row.draggable = $("panel-overview").classList.contains("show-ov-order");
      row.addEventListener("dragstart", (e) => { dragOvType = "list"; dragOvId = l.id; e.dataTransfer.effectAllowed = "move"; });
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        if (dragOvType !== "list" || dragOvId === l.id) return;
        const from = lists.findIndex((x) => x.id === dragOvId);
        const [m] = lists.splice(from, 1);
        lists.splice(lists.indexOf(l), 0, m);
        if (GUEST) saveListsGuest();
        else for (let k = 0; k < lists.length; k++) await supabase.from("lists").update({ created_at: new Date(1700000000000 + k * 1000).toISOString() }).eq("id", lists[k].id);
        renderOverview();
      });
      box.appendChild(row);
    };
    folders.forEach((f) => {
      const row = document.createElement("div");
      row.className = "list-item folder-item";
      const nameBtn = document.createElement("button");
      nameBtn.className = "list-name";
      nameBtn.textContent = "📁 " + f.name;
      if (openFolders.has(f.id)) row.classList.add("folder-open");
      nameBtn.addEventListener("click", () => { openFolders.has(f.id) ? openFolders.delete(f.id) : openFolders.add(f.id); renderOverview(); });
      row.appendChild(nameBtn);
            const fedit = document.createElement("button");
      fedit.className = "btn secondary ov-edit";
      fedit.textContent = "✏️";
      fedit.addEventListener("click", async (e) => {
        e.stopPropagation();
        const name = await showModal({ title: "✏️ Rename map", inputPlaceholder: "New name", prefill: f.name, okText: "Save"});
        if (!name || !name.trim()) return;
        const oldId = f.id;
        f.name = name.trim();
        f.id = f.name;
        for (const l of lists) {
          if (l.folder === oldId) {
            l.folder = f.id;
            if (!GUEST) await supabase.from("lists").update({ folder: f.id }).eq("id", l.id);
          }
        }
        if (GUEST) { saveListsGuest(); saveFoldersGuest(); }
        renderOverview();
      });
            const fdel = document.createElement("button");
      fdel.className = "btn danger ov-del";
      fdel.textContent = "✕";
      fdel.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showModal({ title: "🗑️ Delete map", text: "Delete map “" + f.name + "”? The lists inside are kept.", okText: "Delete" });
        if (!ok) return;
        for (const l of lists) {
          if (l.folder === f.id) {
            l.folder = null;
            if (!GUEST) await supabase.from("lists").update({ folder: null }).eq("id", l.id);
          }
        }
        folders = folders.filter((x) => x.id !== f.id);
        if (GUEST) { saveListsGuest(); saveFoldersGuest(); }
        renderOverview();
      });
      row.appendChild(fedit);
      row.appendChild(fdel);
      const sA = document.createElement("button");
      sA.className = "btn secondary row-order-btn";
      sA.textContent = "A-Z";
      sA.addEventListener("click", (e) => { e.stopPropagation(); sortFolderLists(f, "a"); });
      const sZ = document.createElement("button");
      sZ.className = "btn secondary row-order-btn";
      sZ.textContent = "Z-A";
      sZ.addEventListener("click", (e) => { e.stopPropagation(); sortFolderLists(f, "z"); });
      row.appendChild(sA); row.appendChild(sZ);
      const addBtn = document.createElement("button");
      addBtn.className = "btn secondary";
      addBtn.textContent = "Manage lists";
      addBtn.addEventListener("click", (e) => { e.stopPropagation(); addListsToFolder(f); });
      row.appendChild(addBtn);
            const ford = document.createElement("span");
      ford.className = "row-order";
      ford.textContent = "☰";
      row.insertBefore(ford, row.firstChild);
      row.draggable = $("panel-overview").classList.contains("show-ov-order");
      row.addEventListener("dragstart", (e) => { dragOvType = "folder"; dragOvId = f.id; e.dataTransfer.effectAllowed = "move"; });
      row.addEventListener("dragover", (e) => e.preventDefault());
      row.addEventListener("drop", (e) => {
        e.preventDefault();
        if (dragOvType !== "folder" || dragOvId === f.id) return;
        const from = folders.findIndex((x) => x.id === dragOvId);
        const [m] = folders.splice(from, 1);
        folders.splice(folders.indexOf(f), 0, m);
        if (GUEST) saveFoldersGuest();
        else localStorage.setItem("hippo-folder-order", JSON.stringify(folders.map((x) => x.id)));
        renderOverview();
      });
      box.appendChild(row);
      if (openFolders.has(f.id)) lists.filter((l) => l.folder === f.id).forEach(addListRow);
    });
    lists.filter((l) => !l.folder).forEach(addListRow);
    setQuizTabs(!!currentList);
  }

  async function newList(folderId) {
    const name = await showModal({ title: "➕ New list", text: "Name of the new list:", inputPlaceholder: "New list", okText: "Create" });
    if (!name) return;
    if (GUEST) {
      const l = { id: "g" + Date.now(), name: name.trim(), col1: "Language 1", col2: "Language 2", folder: folderId || null };
      lists.push(l);
      saveListsGuest();
      renderOverview();
      openList(l.id);
      return;
    }
    const { data, error } = await supabase
      .from("lists").insert({ name: name.trim(), folder: folderId || null }).select("id, name, col1, col2").single();
    if (error) { console.error(error); return; }
    lists.push(data);
    renderOverview();
    openList(data.id);
  }

  async function openList(id) {
    currentList = lists.find((l) => l.id === id) || null;
    try { localStorage.setItem("hippo-list", id); } catch (e) {}
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
    $("panel-list").classList.remove("show-del");
    updateDelBtn();
    $("panel-list").classList.remove("show-order"); updateOrderBtn();
    $("panel-list").classList.remove("show-hide"); updateHideBtn();
    $("panel-list").classList.remove("show-stats"); updateStatsBtn();
    const filled = words.filter((w) => w.a.trim() || w.b.trim()).length;
    $("mcMax").value = filled;
    $("typeMax").value = filled;
    $("flashMax").value = filled;
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
    btn.textContent = "🤖 Adding images…";
    let found = 0;
    for (const { w, i } of todo) {
      const q = encodeURIComponent(w.b.trim().split(" ")[0]);
      let url = "https://picsum.photos/seed/" + q + "/400/300";
      try {
        const res = await fetch("https://api.openverse.org/v1/images/?q=" + q + "&per_page=5");
        if (res.ok) {
          const data = await res.json();
          const pick = (data.results || []).map((r) => r.url).find((u) => u && u.startsWith("http"));
          if (pick) url = pick;
        }
      } catch (e) {}
      words[i].a = url;
      found++;
      if (GUEST) save();
      else await supabase.from("words").update({ lang1: url }).eq("id", w.id);
    }
    renderList();
    btn.disabled = false;
    btn.textContent = "🤖 Automatic images";
    await showModal({ title: "🤖 Automatic images", text: found + " images added!", okText: "OK" });
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
      if (w.hidden) tr.classList.add("row-hidden");
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
      if (in1) { in1.type = "text"; in1.value = w.a; in1.placeholder = "Enter here, press tab to move next"; }
      in2.type = "text"; in2.value = w.b; in2.placeholder = "Enter here, press tab to add row";
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
      const ord = document.createElement("span");
      ord.className = "row-order";
      ord.textContent = "☰";
      const eye = document.createElement("span");
      eye.className = "row-eye" + (w.hidden ? " closed" : "");
      eye.textContent = w.hidden ? "🙈" : "👁️";
      eye.addEventListener("click", async () => {
        w.hidden = !w.hidden;
        if (GUEST) save();
        else await supabase.from("words").update({ hidden: w.hidden }).eq("id", w.id);
        renderList();
      });
      const st = wordStats[w.id] || { wrong: 0, right: 0 };
      const stEl = document.createElement("span");
      stEl.className = "row-stats";
      stEl.textContent = "✘ " + st.wrong + " ✔ " + st.right;
      tdDel.insertBefore(ord, del);
      tdDel.insertBefore(eye, ord);
      tdDel.insertBefore(stEl, eye);
      const diff = st.wrong - st.right;
      if ($("panel-list").classList.contains("show-stats")) {
        if (diff > 0) tr.style.background = "rgba(255,123,123," + (0.12 + 0.28 * Math.min(1, diff / 10)).toFixed(2) + ")";
        else if (diff < 0) tr.style.background = "rgba(126,231,135," + (0.12 + 0.28 * Math.min(1, -diff / 10)).toFixed(2) + ")";
        else if (st.wrong > 0) tr.style.background = "rgba(244,201,93,0.28)";
      } else tr.style.background = "";
      tr.draggable = $("panel-list").classList.contains("show-order");
      tr.addEventListener("dragstart", (e) => { dragIdx = i; e.dataTransfer.effectAllowed = "move"; });
      tr.addEventListener("dragover", (e) => e.preventDefault());
      tr.addEventListener("drop", async (e) => {
        e.preventDefault();
        if (dragIdx < 0 || dragIdx === i) return;
        const [moved] = words.splice(dragIdx, 1);
        words.splice(i, 0, moved);
        if (GUEST) save();
        else for (let k = 0; k < words.length; k++) {
          await supabase.from("words").update({ created_at: new Date(1700000000000 + k * 1000).toISOString() }).eq("id", words[k].id);
        }
        renderList();
      });
      tr.appendChild(td1); tr.appendChild(td2); tr.appendChild(tdDel);
      body.appendChild(tr);
    });
    $("emptyMsg").style.display = words.length ? "none" : "block";
  }

  function updateHideBtn() {
    const on = $("panel-list").classList.contains("show-hide");
    const b = $("hideBtn");
    b.textContent = on ? "👁️ Hide ✅" : "👁️ Hide";
    b.style.color = on ? "#43d17c" : "";
  }
  $("hideBtn").addEventListener("click", () => {
    $("panel-list").classList.toggle("show-hide");
    updateHideBtn();
    renderList();
  });

  function updateStatsBtn() {
    const on = $("panel-list").classList.contains("show-stats");
    const b = $("statsBtn");
    b.textContent = on ? "📊 Stats ✅" : "📊 Stats";
    b.style.color = on ? "#43d17c" : "";
  }
  $("statsBtn").addEventListener("click", () => {
    $("panel-list").classList.toggle("show-stats");
    updateStatsBtn();
    renderList();
  });

  async function sortByScore(bestFirst) {
    const key = (w) => { const s = wordStats[w.id] || { wrong: 0, right: 0 }; return s.wrong - s.right; };
    words.sort((a, b) => bestFirst ? key(a) - key(b) : key(b) - key(a));
    if (GUEST) save();
    else for (let k = 0; k < words.length; k++) await supabase.from("words").update({ created_at: new Date(1700000000000 + k * 1000).toISOString() }).eq("id", words[k].id);
    renderList();
  }
  $("sortWorst").addEventListener("click", () => sortByScore(false));
  $("sortBest").addEventListener("click", () => sortByScore(true));
  
  function updateOvOrderBtn() {
    const on = $("panel-overview").classList.contains("show-ov-order");
    const b = $("ovOrderBtn");
    b.textContent = on ? "☰ Order ✅" : "☰ Order";
    b.style.color = on ? "#43d17c" : "";
  }
  $("ovOrderBtn").addEventListener("click", () => { $("panel-overview").classList.toggle("show-ov-order"); updateOvOrderBtn(); renderOverview(); });

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
      fl = { queue: [], idx: 0, marks: {} };
      $("flashFront").textContent = "🦛"; $("flashBack").textContent = "…";
      $("panel-flash").querySelector(".flash-nav").classList.add("hidden");
      setQuizChrome("panel-flash", true);
    }
    $("mcScore").textContent = "Score: 0/0"; $("mcCount").textContent = ""; $("mcProgress").style.width = "0%";
    $("typeScore").textContent = "Score: 0/0"; $("typeCount").textContent = ""; $("typeProgress").style.width = "0%";
    $("flashCount").textContent = "Card 0/0";
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
  function quizSaveKey() { return QUIZ_SAVE_KEY + "-" + (currentList ? currentList.id : "none"); }
  function saveQuiz(mode) {
    if (!mode) return;
    const st = mode === "mc" ? mc : mode === "ty" ? ty : fl;
    localStorage.setItem(quizSaveKey(), JSON.stringify({ mode, state: st, opts: quizOpts }));
  }
  function loadSavedQuiz() {
    try { return JSON.parse(localStorage.getItem(quizSaveKey())); } catch (e) { return null; }
  }
  function clearSavedQuiz() { localStorage.removeItem(quizSaveKey()); }
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
    const cmpT = quizOpts.caseSensitive ? target.trim() : normalize(target);
    const n = Math.max(given.length, cmpT.length);
    let html = "";
    for (let i = 0; i < n; i++) {
      const g = i < given.length ? given[i] : "";
      const t = i < cmpT.length ? cmpT[i] : "";
      const orig = target[i] || t || "·";
      if (g === t) html += '<span class="ok">' + esc(orig) + "</span>";
      else html += '<span class="err">' + esc(orig) + "</span>";
    }
    html += '<span class="ok">' + esc(target.slice(n)) + "</span>";
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
      .filter((w) => w.a.trim() && w.b.trim() && !w.hidden)
      .map((w) => {
        const img = !!(currentList && currentList.imgMode);
        if (direction === "both") {
          return Math.random() < 0.5
            ? { id: w.id, prompt: w.a, answer: w.b, answerImg: false }
            : { id: w.id, prompt: w.b, answer: w.a, answerImg: img };
        }
        return direction === "2to1"
          ? { id: w.id, prompt: w.b, answer: w.a, answerImg: img }
          : { id: w.id, prompt: w.a, answer: w.b, answerImg: false };
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
          bumpStat(item.id, "right");
          $("mcFeedback").textContent = "✔ Correct!";
          $("mcFeedback").classList.add("good");
        } else {
          btn.classList.add("wrong");
          item.missed = true;
          bumpStat(item.id, "wrong");
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
      bumpStat(item.id, "right");
      $("typeFeedback").textContent = "✔ Correct!";
      $("typeFeedback").classList.add("good");
      $("typeFeedback").classList.remove("bad");
      typeAdvance();
    } else {
      item.missed = true;
      bumpStat(item.id, "wrong");
      const back = 2 + Math.floor(Math.random() * 3);
      ty.queue.splice(Math.min(ty.idx + back, ty.queue.length), 0, item);
      $("typeFeedback").classList.add("bad");
      $("typeFeedback").classList.remove("good");
      if (quizOpts.feedback === "never") {
        $("typeFeedback").textContent = "✘ Wrong";
      } else {
        const target = String(item.answer).split(";")[0].trim();
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
  
  function updateOvBtns() {
    const e = $("panel-overview").classList.contains("show-ov-edit");
    const d = $("panel-overview").classList.contains("show-ov-del");
    const eb = $("ovEditBtn"), db = $("ovDelBtn");
    eb.textContent = e ? "✏️ Edit title ✅" : "✏️ Edit title";
    eb.style.color = e ? "#43d17c" : "";
    db.textContent = d ? "🗑️ Delete ✅" : "🗑️ Delete";
    db.style.color = d ? "#43d17c" : "";
  }
  $("ovEditBtn").addEventListener("click", () => { $("panel-overview").classList.toggle("show-ov-edit"); updateOvBtns(); });
  $("ovDelBtn").addEventListener("click", () => { $("panel-overview").classList.toggle("show-ov-del"); updateOvBtns(); });

  // ---------- Flashcards ----------
  let fl = { queue: [], idx: 0, marks: {} };
  function flashStart() {
    if (!currentList) { $("flashFront").textContent = "🦛 Open a list first (🗂️ My lists)"; return; }
    let pool = getPairs($("flashDirection").value);
    if (!pool.length) { 
      showModal({ title: "🦛 The pool is empty!", text: "Add words first!", okText: "OK" }); activateTab("list"); return; 
    }
    if ($("flashShuffle").checked) pool = shuffle(pool);
    const max = parseInt($("flashMax").value, 10) || pool.length;
    pool = pool.slice(0, Math.min(max, pool.length));
    fl = { queue: pool, idx: 0, marks: {} };
    setQuizChrome("panel-flash", false);
    activeQuiz = "fl";
    updateNewlistTab();
    clearSavedQuiz();
    $("panel-flash").querySelector(".flash-nav").classList.remove("hidden");
    flashShow();
  }
  function flashShow() {
    $("flashCard").classList.remove("flipped");
    setTimeout(() => {
    const item = fl.queue[fl.idx];
    const p = item ? item.prompt : "🦛";
    const a = item ? item.answer : "…";
    if (typeof p === "string" && (p.startsWith("data:image") || p.startsWith("http"))) $("flashFront").innerHTML = 
      '<img src="' + p + '" style="max-height:180px;border-radius:12px;">';
    else $("flashFront").textContent = p;
    if (typeof a === "string" && (a.startsWith("data:image") || a.startsWith("http"))) $("flashBack").innerHTML = 
      '<img src="' + a + '" style="max-height:180px;border-radius:12px;">';
    else $("flashBack").textContent = a;
    const vals = Object.values(fl.marks);
    const good = vals.filter((v) => v === "good").length;
    const bad = vals.filter((v) => v === "bad").length;
    $("flashCount").textContent = "Card " + (fl.idx + 1) + "/" + fl.queue.length
      + (fl.marks[fl.idx] === "good" ? " ✔" : fl.marks[fl.idx] === "bad" ? " ✘" : "")
      + (vals.length ? " — ✔" + good + " ✘" + bad : "");
  saveQuiz("fl");
  }, 250);
  }
  $("flashGood").addEventListener("click", () => { fl.marks[fl.idx] = "good"; saveQuiz("fl"); flashShow(); bumpStat(fl.queue[fl.idx].id, "right");});
  $("flashBad").addEventListener("click", () => { fl.marks[fl.idx] = "bad"; saveQuiz("fl"); flashShow(); bumpStat(fl.queue[fl.idx].id, "wrong");});
  $("flashDone").addEventListener("click", async () => {
    const vals = Object.values(fl.marks);
    const good = vals.filter((v) => v === "good").length;
    const total = vals.length;
    const grade = total ? Math.max(1, Math.min(10, Math.round((1 + 9 * (good / total)) * 10) / 10)) : 0;
    clearSavedQuiz(); activeQuiz = null;
    await showModal({ title: "🏁 Flashcards done", text: "Score: " + good + "/" + total + (total ? " — grade " + grade.toFixed(1) + " — " + gradeFeedback(grade) : " (no cards marked)"), okText: "OK" });
    resetQuizUI("fl");
  });
  $("flashCard").addEventListener("click", () => $("flashCard").classList.toggle("flipped"));
  $("flashNext").addEventListener("click", () => {
    if (fl.queue.length) { fl.idx = (fl.idx + 1) % fl.queue.length; flashShow(); }
  });
  $("flashPrev").addEventListener("click", () => {
    if (fl.queue.length) { fl.idx = (fl.idx - 1 + fl.queue.length) % fl.queue.length; flashShow(); }
  });
  $("flashStart").addEventListener("click", flashStart);
  document.addEventListener("keydown", (e) => {
    const t = document.querySelector(".tab.active");
    if (!t || t.dataset.tab !== "flash" || !fl.queue.length) return;
    if (e.key === "ArrowRight") { fl.idx = (fl.idx + 1) % fl.queue.length; flashShow(); }
    if (e.key === "ArrowLeft") { fl.idx = (fl.idx - 1 + fl.queue.length) % fl.queue.length; flashShow(); }
  });

  // ---------- Go back ----------
  async function backToList() {
    if (currentList) await flushList();
    const cur = currentQuizMode();
    if (cur && !(await confirmLeaveQuiz(cur))) return;
    if (currentList) activateTab("list");
  }
  $("mcBack").addEventListener("click", backToList);
  $("typeBack").addEventListener("click", backToList);
  $("flashBackBtn").addEventListener("click", backToList);
  
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
      const emptyIdx = all.findIndex((w) => w.listId === currentList.id && !w.a.trim() && !w.b.trim());
      clean.forEach((r, i) => {
        if (i === 0 && emptyIdx >= 0) { all[emptyIdx].a = r[0]; all[emptyIdx].b = r[1]; }
        else all.push({ id: "g" + Date.now() + "_" + i, listId: currentList.id, a: r[0], b: r[1] });
      });
      localStorage.setItem(GUEST_WORDS_KEY, JSON.stringify(all));
    } else {
      const rows = clean.map((r) => ({ lang1: r[0], lang2: r[1], list_id: currentList.id }));
      const emptyRow = words.find((w) => !w.a.trim() && !w.b.trim());
      if (emptyRow && rows.length) {
        await supabase.from("words").update({ lang1: rows[0].lang1, lang2: rows[0].lang2 }).eq("id", emptyRow.id);
        rows.shift();
      }
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from("words").insert(rows.slice(i, i + 500));
        if (error) { console.error(error); }
      }
    }
    await loadWords();
    renderList();
    activateTab("list");
    await showModal({
      title: "📥 Import done", text: clean.length + " words added to “" + currentList.name + "”!", okText: "OK" });
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
  function updateDelBtn() {
    const on = $("panel-list").classList.contains("show-del");
    const desk = window.matchMedia("(min-width: 561px)").matches;
    $("clearList").classList.toggle("hidden", desk && !on);
    const b = $("toggleDelBtn");
    b.textContent = on ? "🗑️ Delete ✅" : "🗑️ Delete";
    b.style.color = on ? "#43d17c" : "";
  }
  $("toggleDelBtn").addEventListener("click", () => {
    $("panel-list").classList.toggle("show-del");
    updateDelBtn();
  });
    function updateOrderBtn() {
    const on = $("panel-list").classList.contains("show-order");
    const b = $("orderBtn");
    b.textContent = on ? "☰ Order ✅" : "☰ Order";
    b.style.color = on ? "#43d17c" : "";
  }
  $("orderBtn").addEventListener("click", () => {
    $("panel-list").classList.toggle("show-order");
    updateOrderBtn();
    renderList();
  });
  async function sortWords(col) {
    words.sort((x, y) => String(x[col]).localeCompare(String(y[col]), "nl"));
    if (GUEST) save();
    else for (let k = 0; k < words.length; k++) {
      await supabase.from("words").update({ created_at: new Date(1700000000000 + k * 1000).toISOString() }).eq("id", words[k].id);
    }
    renderList();
  }
  $("sortA").addEventListener("click", () => sortWords("a"));
  $("sortB").addEventListener("click", () => sortWords("b"));
  async function sortFolderLists(f, dir) {
    const inFolder = lists.filter((l) => l.folder === f.id);
    inFolder.sort((x, y) => dir === "a" ? x.name.localeCompare(y.name, "nl") : y.name.localeCompare(x.name, "nl"));
    let j = 0;
    lists = lists.map((l) => l.folder === f.id ? inFolder[j++] : l);
    if (GUEST) saveListsGuest();
    else for (let k = 0; k < lists.length; k++) await supabase.from("lists").update({ created_at: new Date(1700000000000 + k * 1000).toISOString() }).eq("id", lists[k].id);
    renderOverview();
  }
  
  // ---------- Init ----------
  async function startGuest() {
    $("loginScreen").classList.add("hidden");
    $("app").classList.remove("hidden");
    $("loggedInUser").textContent = "🦛 Guest (local only)";
    await loadLists();
    loadColNames();
    renderOverview();
    try {
      const lt = localStorage.getItem("hippo-tab");
      const ll = localStorage.getItem("hippo-list");
      if (lt === "list" && ll) { openList(ll); }
      else activateTab(lt && $("panel-" + lt) && !lt.startsWith("quiz") && lt !== "flash" ? lt : "overview");
    } catch (e) { activateTab("overview"); }
    setQuizTabs(false);
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
        setQuizTabs(true);
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
        try {
          const lt = localStorage.getItem("hippo-tab");
          const ll = localStorage.getItem("hippo-list");
          if (lt === "list" && ll) { openList(ll); }
          else activateTab(lt && $("panel-" + lt) && !lt.startsWith("quiz") && lt !== "flash" ? lt : "overview");
        } catch (e) { activateTab("overview"); }
        setQuizTabs(false);
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
        setQuizTabs(true);
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
