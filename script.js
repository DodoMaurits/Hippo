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

  let saveTimer = null;
  const saveTimers = {};
  const dirtyWords = new Set();
  function saveStatus(msg, ok) {
    const el = $("saveStatus");
    el.textContent = msg;
    el.style.color = ok ? "#43d17c" : "";
    el.classList.remove("hidden");
    clearTimeout(saveTimer);
    if (ok) saveTimer = setTimeout(() => el.classList.add("hidden"), 2000);
  }
  function saveWordRow(w) {
    if (GUEST) { save(); saveStatus("✅ Saved", true); return; }
    supabase.from("words").update({ lang1: w.a, lang2: w.b, hidden: !!w.hidden }).eq("id", w.id).then(() => { dirtyWords.delete(w.id); saveStatus("✅ Saved", true); });
  }

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
    const dirty = words.filter((w) => dirtyWords.has(w.id));
    if (!dirty.length) { saveStatus("✅ Saved", true); return; }
    saveStatus("⏳ Saving…");
    for (let i = 0; i < dirty.length; i += 100) {
      await Promise.all(dirty.slice(i, i + 100).map((w) =>
        supabase.from("words").update({ lang1: w.a, lang2: w.b, hidden: !!w.hidden }).eq("id", w.id).then(() => dirtyWords.delete(w.id))
      ));
    }
    saveStatus("✅ Saved", true);
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
    const tb = document.querySelector(".tabs");
    if (tb) tb.classList.toggle("in-list", name === "overview" || (!!currentList && ["list", "flash", "quiz-mc", "quiz-type"].includes(name)));
    const hd = document.querySelector(".hippo-header");
    if (hd) hd.classList.toggle("in-list", !!currentList && ["list", "flash", "quiz-mc", "quiz-type"].includes(name));
    try { localStorage.setItem("hippo-tab", name); } catch (e) {}
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", async () => {
      if (tab.dataset.tab === "newlist") { newList(); return; }
      if (tab.dataset.tab === "exam") { openExam(); return; }
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
    const { data: fdata } = await supabase.from("folders").select("id, name").order("ord", { ascending: true });
    folders = (fdata && fdata.length ? fdata : [...new Set(lists.map((l) => l.folder).filter(Boolean))].map((name) => ({ id: name, name })))
      .map((f) => ({ id: f.id, name: f.name }));
    const known = new Set(folders.map((f) => f.id));
    lists.forEach((l) => { if (l.folder && !known.has(l.folder)) folders.push({ id: l.folder, name: l.folder }); });
    if (!GUEST) {
      const uid = await myUid();
      for (let k = 0; k < folders.length; k++) {
        await supabase.from("folders").upsert({ id: folders[k].id, name: folders[k].name, ord: k, user_id: uid }, { onConflict: "id" });
      }
    }
  }

  function saveFoldersGuest() { localStorage.setItem("hippo-guest-folders", JSON.stringify(folders)); }
  async function myUid() {
    const { data } = await supabase.auth.getSession();
    return data.session && data.session.user ? data.session.user.id : null;
  }
  async function newFolder() {
    const name = await showModal({ title: "📁 Create folder", inputPlaceholder: "New folder", okText: "Create" });
    if (!name || !name.trim()) return;
    const f = { id: "f" + Date.now(), name: name.trim() };
    folders.unshift(f);
    if (GUEST) saveFoldersGuest();
    else await supabase.from("folders").insert({ id: f.id, name: f.name, ord: Date.now(), user_id: await myUid() });
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
    const label = names.length ? names.map((n, i) => (i + 1) + ") " + n).join(", ") : "(no folders)";
    const ans = await showModal({ title: "📁 Change order “" + l.name + "” to folder", text: "Choose: " + label + ". Empty = take from folder.", inputPlaceholder: "Title or number", okText: "Change order" });
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
        const name = await showModal({ title: "✏️ Rename folder", inputPlaceholder: "New title", prefill: f.name, okText: "Save"});
        if (!name || !name.trim()) return;
        f.name = name.trim();
        if (GUEST) { saveListsGuest(); saveFoldersGuest(); }
        else await supabase.from("folders").update({ name: f.name }).eq("id", f.id);
        renderOverview();
      });
            const fdel = document.createElement("button");
      fdel.className = "btn danger ov-del";
      fdel.textContent = "✕";
      fdel.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showModal({ title: "🗑️ Delete folder", text: "Delete folder “" + f.name + "”? The lists inside remain.", okText: "Delete" });
        if (!ok) return;
        for (const l of lists) {
          if (l.folder === f.id) {
            l.folder = null;
            if (!GUEST) await supabase.from("lists").update({ folder: null }).eq("id", l.id);
          }
        }
        folders = folders.filter((x) => x.id !== f.id);
        if (!GUEST) await supabase.from("folders").delete().eq("id", f.id);
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
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        if (dragOvType !== "folder" || dragOvId === f.id) return;
        const from = folders.findIndex((x) => x.id === dragOvId);
        const [m] = folders.splice(from, 1);
        folders.splice(folders.indexOf(f), 0, m);
        if (GUEST) saveFoldersGuest();
        else for (let k = 0; k < folders.length; k++) {
          const { error } = await supabase.from("folders").upsert({ id: folders[k].id, name: folders[k].name, ord: k, user_id: await myUid() }, { onConflict: "id" });
          if (error) console.error("folder ord save failed", folders[k].id, error);
        }
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
    $("listTitle").textContent = currentList.name;
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
    await maybeResumeQuiz();
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
        in1.addEventListener("input", () => {
          saveStatus("⏳ Saving…");
          words[i].a = in1.value;
          dirtyWords.add(w.id);
          clearTimeout(saveTimers[w.id]);
          saveTimers[w.id] = setTimeout(() => saveWordRow(w), 600);
        });
        in1.addEventListener("focus", () => { lastRowIdx = i; });
      }
      in2.addEventListener("input", () => {
        saveStatus("⏳ Saving…");
        words[i].b = in2.value;
        dirtyWords.add(w.id);
        clearTimeout(saveTimers[w.id]);
        saveTimers[w.id] = setTimeout(() => saveWordRow(w), 600);
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
  $("addRowBottom").addEventListener("click", () => $("addRow").click());

  $("saveListBtn").addEventListener("click", () => flushList());

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
    if (res === "save") { saveQuiz(mode); activeQuiz = null; resetQuizUI(mode); return true; }
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
    if (!t) return;
    const tab = document.querySelector(".tab.active");
    const inListView = !!currentList && tab && ["list", "flash", "quiz-mc", "quiz-type"].includes(tab.dataset.tab);
    t.classList.toggle("hidden", !!currentQuizMode() || inListView);
  }
  const QUIZ_SAVE_KEY = "hippo-quiz-save";
  function quizSaveKey() { return QUIZ_SAVE_KEY + "-" + (currentList ? currentList.id : "none"); }
  function saveQuiz(mode) {
    if (!mode) return;
    const st = mode === "mc" ? mc : mode === "ty" ? ty : fl;
    localStorage.setItem(quizSaveKey(), JSON.stringify({ mode, state: st, opts: quizOpts, listId: currentList ? currentList.id : null }));
  }
  function loadSavedQuiz() {
    try { return JSON.parse(localStorage.getItem(quizSaveKey())); } catch (e) { return null; }
  }
  async function maybeResumeQuiz() {
    const saved = loadSavedQuiz();
    if (!saved || !saved.state || !((saved.state.queue || []).length > saved.state.idx)) return;
    if (saved.listId && currentList && saved.listId !== currentList.id) return;
    if (currentQuizMode()) return;
    const res = await showModal({
      title: "🦛 Unfinished quiz",
      text: "This list has a saved quiz. Resume it or start fresh?",
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
  function stripEx(s) { return String(s).replace(/\(\s*EX:[^)]*\)/gi, " "); }
  function acceptedAnswers(answer) {
    return stripEx(answer).split(";")
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
    $("typeInput").value = quizOpts.help === "hint" && item.answer ? (stripEx(item.answer).trim()[0] || "") : "";
    $("typePrompt").style.fontSize = "";
    const exm = String(item.prompt).match(/\(\s*EX:([^)]*)\)/i);
    let ptext = String(item.prompt);
    if (exm) ptext = (ptext.slice(0, exm.index) + ptext.slice(exm.index + exm[0].length)).replace(/\s+/g, " ").trim();
    item.exLines = exm ? exm[1].split(";").map((s) => s.trim()).filter(Boolean) : [];
    if (currentList.imgMode) $("typePrompt").innerHTML = '<img src="' + item.prompt + '" style="max-width:220px;max-height:170px;border-radius:12px;">';
    else $("typePrompt").textContent = ptext;
    $("typeHint").textContent = quizOpts.help === "scrambled" && item.answer ? "" + shuffleLetters(item.answer) : "";
    updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.idx, ty.score);
    $("typeInput").focus();
    saveQuiz("ty");
  }
  function showTypeEx(item) {
    const old = $("typePrompt").querySelector(".type-ex");
    if (old) old.remove();
    if (!item || !item.exLines || !item.exLines.length) return;
    const ex = document.createElement("div");
    ex.className = "type-ex";
    item.exLines.forEach((line) => {
      const d = document.createElement("div");
      d.textContent = line;
      ex.appendChild(d);
    });
    $("typePrompt").appendChild(ex);
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
    showTypeEx(item);
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
        const target = stripEx(item.answer).split(";")[0].trim();
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
    $("clearList").classList.toggle("hidden", !on);
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

  // ---------- Exam ----------
  const EXAM_LANGS = ["French","Russian"];
  const CASE_SUBS = ["2","3","4","5","6"];
  const CASE_LABELS = { "1":"1 Nominative", "2":"2 Genitive", "3":"3 Dative", "4":"4 Accusative", "5":"5 Instrumental", "6":"6 Prepositional" };
  const VERB_SUBS = ["pres","past-impf","past-pf","fut-comp","fut-simple","imperative"];
  const VERB_LABELS = {
    pres: "1. Present (i)", 
    "past-impf": "2. Past imperfective", 
    "past-pf": "3. Past perfective",
    "fut-comp": "4. Compound future (i)", 
    "fut-simple": "5. Simple future (p)", 
    imperative: "6. Imperative"
  };
  const EXAM_PARTS_BY_LANG = {
    "Russian": [
      { id: "cases",    label: "Cases",              subs: CASE_SUBS, subLabels: CASE_LABELS },
      { id: "verbs",    label: "Verb conjugations",  subs: VERB_SUBS, subLabels: VERB_LABELS },
      { id: "pronouns", label: "Pronoun declension", subs: CASE_SUBS, subLabels: CASE_LABELS, needsPronouns: true }
    ],
    "French": [
      { 
        id: "grammar", label: "Grammar words", subs: ["articles","pronouns","poss","refl","ton","negation","questions","partitive"],
        subLabels: { 
          articles: "Articles", 
          pronouns: "Pronouns", 
          poss: "Possessive (mon/ton)", 
          refl: "Reflective (me/se)",
          ton: "Stressed (moi/toi)",
          negation: "Negation",
          questions: "Questions",
          partitive: "Partitive"
        } 
      },
      { 
        id: "tenses", label: "Verb tenses", subs: ["pres","impf","pc","fp","fs","imp","cond","subj"],
        subLabels: {
          pres: "Présent", 
          impf: "Imparfait",
          pc: "Passé composé",
          fp: "Futur proche", 
          fs: "Futur simple",
          imp: "Impératif", 
          cond: "Conditionnel", 
          subj: "Subjonctif" 
        } 
      },
      { 
        id: "adjectives", label: "Adjectives", subs: ["agree","place"], 
        subLabels: { 
          agree: "Accord (gender)", 
          place: "Place (avant/après)" 
        } 
      }
    ]
  };
  function examParts() { return EXAM_PARTS_BY_LANG[exam.lang] || []; }
  const EXAM_PRONOUNS = window.EXAM_PRONOUNS || {};
  const EXAM_QUESTION_COUNT = 30;
  const EXAM_BANK = window.EXAM_BANK || {};
  const EXAM_SUBJECTS = window.EXAM_SUBJECTS || {};
  let exam = { step: "pick", listIds: [], pool: [], queue: [], idx: 0, score: 0, locked: false, timer: null, lang: "", subs: {}, parts: [], includeWords: true };
  let examOptsFilled = false;

  function examStep(name) {
    exam.step = name;
    ["examPick", "examOpts", "examRun"].forEach((id) =>
      $(id).classList.toggle("hidden", id !== "exam" + name[0].toUpperCase() + name.slice(1)));
  }
  function partLabel(id, sub) {
    if (id === "words") return "Vocabulary from lists";
    const p = examParts().find((x) => x.id === id);
    if (!p) return id;
    let s = p.label;
    if (sub && p.subLabels && p.subLabels[sub]) s += " — " + p.subLabels[sub];
    return s;
  }
  function openExam() {
    activateTab("exam");
    fillExamOpts();
    examStep("opts");
  }
  function renderExamPick() {
    const box = $("examPickList");
    box.innerHTML = "";
    const mk = (attrs, label, onChange) => {
      const lab = document.createElement("label");
      lab.className = "opt-pill";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      Object.entries(attrs).forEach(([k, v]) => { cb.dataset[k] = v; });
      cb.addEventListener("change", onChange);
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + label));
      box.appendChild(lab);
      return cb;
    };
    folders.forEach((f) => {
      mk({ folder: f.id }, "📁 " + f.name + "  (all lists in this folder)", (e) => {
        const ids = lists.filter((l) => l.folder === f.id).map((l) => l.id);
        box.querySelectorAll("input[data-list]").forEach((cb) => { if (ids.includes(cb.dataset.list)) cb.checked = e.target.checked; });
      });
    });
    lists.forEach((l) => {
      const fname = l.folder ? ((folders.find((f) => f.id === l.folder) || {}).name || "") : "";
      mk({ list: l.id }, "📋 " + l.name + (fname ? "  —  in folder: " + fname : ""), () => {});
    });
    if (!lists.length) box.innerHTML = '<p class="empty">No lists yet — create one first with ➕ New list.</p>';
  }
  function fillExamOpts() {
    if (examOptsFilled) return;
    examOptsFilled = true;
    $("examLang").innerHTML = '<option value="">Choose a language</option>' + EXAM_LANGS.slice().sort((a, b) => a.localeCompare(b, "en")).map((l) => "<option>" + l + "</option>").join("");
    $("examLang").addEventListener("change", () => {
      const v = $("examLang").value;
      $("examPartsSection").classList.toggle("hidden", !v);
      if (v) { exam.lang = v; renderExamParts(); }
    });
  }
  function renderExamParts() {
    const pbox = $("examParts");
    pbox.innerHTML = "";
    exam.subs = {};
    const parts = examParts();
    if (!parts.length) { pbox.innerHTML = '<p class="hint">No exam components for this language yet — add them in its z-exam file.</p>'; return; }
    parts.forEach((p) => {
      if (p.needsPronouns && !(EXAM_PRONOUNS[exam.lang] || []).length) return;
      const wrap = document.createElement("div");
      wrap.className = "exam-part";
      const lab = document.createElement("label");
      lab.className = "opt-pill";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.value = p.id; cb.dataset.part = p.id; cb.checked = false;
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(" " + p.label));
      wrap.appendChild(lab);
      const subRow = document.createElement("div");
      subRow.className = "exam-subrow hidden";
      exam.subs[p.id] = [];
      (p.subs || []).forEach((s) => {
        const sl = document.createElement("label");
        sl.className = "opt-pill";
        const sc = document.createElement("input");
        sc.type = "checkbox"; sc.value = s; sc.checked = true;
        sl.appendChild(sc);
        sl.appendChild(document.createTextNode(" " + (p.subLabels[s] || s)));
        subRow.appendChild(sl);
        sc.addEventListener("change", () => {
          exam.subs[p.id] = [...subRow.querySelectorAll("input:checked")].map((x) => x.value);
          anum.min = Math.max(1, exam.subs[p.id].length);
          if (parseInt(anum.value, 10) < anum.min) anum.value = anum.min;
        });
        exam.subs[p.id].push(s);
      });
      const amtRow = document.createElement("div");
      amtRow.className = "exam-inline-row hidden";
      const alab = document.createElement("label");
      alab.className = "opt-pill";
      alab.appendChild(document.createTextNode("Question amount "));
      const anum = document.createElement("input");
      anum.addEventListener("change", () => { anum.value = Math.max(parseInt(anum.min, 10) || 1, Math.min(25, parseInt(anum.value, 10) || 1)); });
      anum.type = "number"; anum.min = (p.subs || []).length || 1; anum.max = 25; anum.value = Math.max(anum.min, 8); anum.className = "opt-max"; anum.dataset.amt = p.id;
      alab.appendChild(anum);
      amtRow.appendChild(alab);
      wrap.appendChild(subRow);
      wrap.appendChild(amtRow);
      pbox.appendChild(wrap);
      cb.addEventListener("change", () => {
        subRow.classList.toggle("hidden", !cb.checked);
        amtRow.classList.toggle("hidden", !cb.checked);
      });
    });
  }
  async function loadExamWords(listIds) {
    if (GUEST) {
      let all = [];
      try { all = JSON.parse(localStorage.getItem(GUEST_WORDS_KEY) || "[]"); } catch (e) {}
      return all.filter((w) => listIds.includes(w.listId) && w.a && w.b && w.a.trim() && w.b.trim() && !w.hidden)
        .map((w) => ({ id: w.id, a: w.a, b: w.b }));
    }
    const { data, error } = await supabase.from("words")
      .select("id, lang1, lang2, hidden, list_id").in("list_id", listIds);
    if (error) { console.error(error); return []; }
    return (data || []).filter((w) => w.lang1 && w.lang2 && w.lang1.trim() && w.lang2.trim() && !w.hidden)
      .map((w) => ({ id: w.id, a: w.lang1, b: w.lang2 }));
  }
  function buildExamQueue() {
    const bank = EXAM_BANK[exam.lang] || [];
    const compQs = [];
    exam.parts.forEach((pid) => {
      const p = examParts().find((x) => x.id === pid);
      const selSubs = exam.subs[pid] || [];
      const subs = selSubs.length ? selSubs : CASE_SUBS;
      bank.filter((e) => e && e[0] === pid).forEach((e) => {
        const sub = e[1] || "";
        if (sub && !selSubs.includes(sub)) return;
        if (String(e[3]).indexOf("{p") === 0) {
          const gm = String(e[3]).match(/\{p:?(m|f|n|pl)?\}/);
          const gi = gm && gm[1] ? { m: 0, f: 1, n: 2, pl: 3 }[gm[1]] : -1;
          const idx = parseInt(sub, 10) - 1;
          if (idx < 0 || idx > 5) return;
          (EXAM_PRONOUNS[exam.lang] || []).forEach((pr) => {
            if (pr.bare) return;
            let answer;
            if (pr.paradigm && pr.paradigm[sub] && gi >= 0) answer = pr.paradigm[sub][gi];
            else if (pr.forms) answer = pr.forms[idx];
            else return;
            compQs.push({ part: pid, sub, prompt: String(e[2]).replace("___", "___ (" + pr.name + ")"), answer });
          });
          return;
        }
        let prompt = String(e[2]), answer = e[3];
        if (prompt.indexOf("[subject]") >= 0) {
          const subs = EXAM_SUBJECTS[exam.lang] || ["я","ты","он","она","мы","вы","они"];
          const si = Math.floor(Math.random() * subs.length);
          prompt = prompt.split("[subject]").join(subs[si]);
          const forms = String(e[3]).split(",").map((s) => s.trim());
          answer = forms[si] || forms[forms.length - 1];
        }
        compQs.push({ part: pid, sub, prompt, answer });
      });
    });
    const wordQs = [];
    if (exam.includeWords && exam.pool.length) {
      const wdir = $("examWordsDir").value;
      exam.pool.forEach((w) => {
        [true, false].forEach((toB) => {
          if (wdir === "1to2" && !toB) return;
          if (wdir === "2to1" && toB) return;
          const prompt = toB ? w.a : w.b, answer = toB ? w.b : w.a;
          if (prompt === answer) return;
          wordQs.push({ part: "words", prompt, answer, id: w.id });
        });
      });
    }
    const seen = new Set();
    const byPart = {};
    shuffle(compQs.concat(wordQs)).forEach((q) => {
      const key = (q.prompt || "").trim().toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      (byPart[q.part] = byPart[q.part] || []).push(q);
    });
    const queue = [];
    Object.keys(byPart).forEach((part) => {
      const subs = exam.subs[part] || [];
      const minCap = part === "words" ? 1 : Math.max(1, subs.length);
      const cap = Math.max(minCap, Math.min(25, parseInt(exam.amounts[part], 10) || 8));
      const items = byPart[part];
      if (part === "words" || !subs.length) { queue.push(...items.slice(0, cap)); return; }
      const bySub = {};
      items.forEach((q) => { const k = q.sub || ""; (bySub[k] = bySub[k] || []).push(q); });
      const base = Math.floor(cap / subs.length);
      const picked = new Set();
      const out = [];
      subs.forEach((s) => {
        (bySub[s] || []).slice(0, Math.max(1, base)).forEach((q) => {
          if (out.length < cap && !picked.has(q)) { picked.add(q); out.push(q); }
        });
      });
      const need = cap - out.length;
      if (need > 0) shuffle(items.filter((q) => !picked.has(q))).slice(0, need).forEach((q) => { picked.add(q); out.push(q); });
      queue.push(...out);
    });
    return shuffle(queue);
  }
  function startExamTimer() {
    clearInterval(exam.timer);
    exam.timer = null;
    if (exam.noLimit) { $("examTimer").textContent = "∞"; return; }
    let secs = (exam.minutes || 30) * 60;
    $("examTimer").textContent = (exam.minutes || 30) + ":00";
    exam.timer = setInterval(() => {
      secs--;
      const m = Math.floor(Math.max(0, secs) / 60), s = Math.max(0, secs) % 60;
      $("examTimer").textContent = m + ":" + String(s).padStart(2, "0");
      if (secs <= 0) examSubmit();
    }, 1000);
  }
  function examUpdCount() {
    let n = 0;
    $("examQuestions").querySelectorAll(".exam-q").forEach((w) => {
      const inp = w.querySelector("input.exam-answer");
      if (inp && inp.value.trim()) n++;
    });
    $("examCount").textContent = "Answered: " + n + "/" + exam.queue.length;
    $("examProgress").style.width = (exam.queue.length ? (n / exam.queue.length * 100) : 0) + "%";
  }
  function examSortKey(item, idx) {
    const parts = examParts();
    const pi = item.part === "words" ? parts.length : parts.findIndex((p) => p.id === item.part);
    const p = parts.find((x) => x.id === item.part);
    const si = item.part === "words" || !p || !p.subs ? 0 : p.subs.indexOf(item.sub);
    return (pi === -1 ? parts.length - 1 : pi) * 10000 + (si < 0 ? 0 : si) * 100 + idx;
  }
  function renderExamQuestions() {
    const box = $("examQuestions");
    box.innerHTML = "";
    const ordered = exam.queue.map((q, i) => ({ q, i })).sort((a, b) => examSortKey(a.q, a.i) - examSortKey(b.q, b.i));
    let lastPart = null, num = 0;
    ordered.forEach(({ q: item, i }) => {
      if (item.part !== lastPart) {
        lastPart = item.part;
        const h = document.createElement("h3");
        h.className = "exam-cat";
        h.textContent = partLabel(item.part, "");
        box.appendChild(h);
      }
      num++;
      const wrap = document.createElement("div");
      wrap.className = "exam-q";
      wrap.dataset.qi = i;
      const pr = document.createElement("div");
      pr.className = "prompt exam-prompt";
      const inp = document.createElement("input");
      inp.type = "text";
      inp.className = "answer-input exam-answer";
      inp.addEventListener("input", examUpdCount);
      const ansLen = String(item.answer || "").split(";")[0].trim().length;
      inp.size = Math.round(Math.max(12, Math.min(30, ansLen + 4)) * 1.5);
      let text = String(item.prompt);
      let hint = "";
      const hm = text.match(/\(([^)]*)\)/);
      if (hm) { hint = " (" + hm[1] + ")"; text = (text.slice(0, hm.index) + text.slice(hm.index + hm[0].length)).replace(/\s+/g, " ").trim(); }
      const pos = text.indexOf("___");
      pr.appendChild(document.createTextNode(num + ". "));
      if (pos >= 0) {
        pr.appendChild(document.createTextNode(text.slice(0, pos)));
        pr.appendChild(inp);
        pr.appendChild(document.createTextNode(text.slice(pos + 3) + hint));
      } else {
        pr.appendChild(document.createTextNode(text + " "));
        pr.appendChild(inp);
        if (hint) pr.appendChild(document.createTextNode(hint));
      }
      wrap.appendChild(pr);
      box.appendChild(wrap);
    });
    examUpdCount();
  }
  function examSubmit() {
    if (exam.done) return;
    exam.done = true;
    clearInterval(exam.timer);
    exam.timer = null;
    let score = 0;
    $("examQuestions").querySelectorAll(".exam-q").forEach((wrap) => {
      const item = exam.queue[+wrap.dataset.qi];
      if (!item) return;
      const inp = wrap.querySelector("input.exam-answer");
      const given = inp ? inp.value.trim() : "";
      if (inp) inp.disabled = true;
      const ok = !!given && acceptedAnswers(item.answer).includes(normalize(given));
      if (ok) score++;
      if (item.id) bumpStat(item.id, ok ? "right" : "wrong");
      const fb = document.createElement("div");
      fb.className = "feedback " + (ok ? "good" : "bad");
      fb.textContent = ok ? "✔ Correct!" : "✘ Correct answer: " + item.answer;
      wrap.appendChild(fb);
      if (inp) inp.classList.add(ok ? "correct" : "wrong");
    });
    exam.score = score;
    const total = exam.queue.length;
    const grade = total ? Math.max(1, Math.min(10, Math.round((1 + 9 * (score / total)) * 10) / 10)) : 0;
    $("examResult").classList.remove("hidden");
    $("examGrade").style.fontSize = "4.5rem";
    $("examGrade").textContent = grade.toFixed(1);
    $("examResultText").textContent = "Score " + score + "/" + total + " — " + gradeFeedback(grade);
    $("examDoneBar").classList.remove("hidden");
    $("examSubmit").disabled = true;
    $("examSubmit2").disabled = true;
    $("examScore").textContent = "Score: " + score + "/" + total;
    $("examCount").textContent = total + "/" + total;
    $("examProgress").style.width = "100%";
  }
  $("examSubmit").addEventListener("click", examSubmit);
  $("examSubmit2").addEventListener("click", examSubmit);
  $("examToOpts").addEventListener("click", async () => {
    const ids = [...$("examPickList").querySelectorAll("input[data-list]:checked")].map((cb) => cb.dataset.list);
    if (!ids.length) { showModal({ title: "📝 Exam", text: "Check at least one list first.", okText: "OK" }); return; }
    exam.listIds = ids;
    await startExamRun();
  });
  $("examOptsBack").addEventListener("click", () => activateTab("overview"));
  $("examCancelBtn").addEventListener("click", () => examStep("opts"));
  $("examWords").addEventListener("change", () => {
    $("examWordsDirRow").classList.toggle("hidden", !$("examWords").checked);
    $("examWordsAmtRow").classList.toggle("hidden", !$("examWords").checked);
  });
  $("examWordsAmt").addEventListener("change", (e) => {
    e.target.value = Math.max(1, Math.min(25, parseInt(e.target.value, 10) || 1));
  });
  $("examTimeLimit").addEventListener("change", () => $("examTimeOptsRow").classList.toggle("hidden", !$("examTimeLimit").checked));
  async function startExamRun() {
    exam.pool = exam.includeWords ? await loadExamWords(exam.listIds) : [];
    if (exam.includeWords && !exam.pool.length) {
      showModal({ title: "📝 Exam", text: "The selected lists contain no words.", okText: "OK" });
      return;
    }
    exam.queue = buildExamQueue();
    if (!exam.queue.length) {
      showModal({ title: "📝 Exam", text: "No questions available for this combination.", okText: "OK" });
      return;
    }
    exam.idx = 0; exam.score = 0; exam.locked = false; exam.done = false;
    examStep("run");
    $("examResult").classList.add("hidden");
    $("examDoneBar").classList.add("hidden");
    $("examSubmit").disabled = false;
    $("examSubmit2").disabled = false;
    $("examScore").textContent = "Score: 0/0";
    $("examGrade").textContent = "";
    $("examResultText").textContent = "";
    startExamTimer();
    renderExamQuestions();
  }
  $("examStart").addEventListener("click", () => {
    const lang = $("examLang").value;
    if (!lang) { showModal({ title: "📝 Exam", text: "Choose a language first.", okText: "OK" }); return; }
    exam.noLimit = !$("examTimeLimit").checked;
    exam.lang = lang;
    exam.parts = [...$("examParts").querySelectorAll("input[data-part]:checked")].map((cb) => cb.value);
    exam.includeWords = $("examWords").checked;
    const t = document.querySelector('input[name="examTime"]:checked');
    exam.minutes = t ? parseInt(t.value, 10) : 30;
    exam.amounts = { words: $("examWordsAmt").value };
    $("examParts").querySelectorAll("input[data-amt]").forEach((n) => { exam.amounts[n.dataset.amt] = n.value; });
    if (!exam.parts.length && !exam.includeWords) {
      showModal({ title: "📝 Exam", text: "Choose at least one exam part or check 'Include words from lists'.", okText: "OK" });
      return;
    }
    if (exam.includeWords) {
      renderExamPick();
      examStep("pick");
      return;
    }
    startExamRun();
  });
  $("examQuit").addEventListener("click", async () => {
    if (exam.step === "run" && !exam.done) {
      const res = await showModal({
        title: "Leave exam?",
        text: "Are you sure you want to quit? Your answers will be lost.",
        okText: "Quit exam",
        extraButton: { label: "Stay in exam", value: "stay" },
        hideCancel: true
      });
      if (res !== true) return;
    }
    clearInterval(exam.timer); exam.timer = null; activateTab("overview");
  });  $("examToOverview").addEventListener("click", () => { clearInterval(exam.timer); exam.timer = null; activateTab("overview"); });
  
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
      else activateTab(lt && lt !== "exam" && $("panel-" + lt) && !lt.startsWith("quiz") && lt !== "flash" ? lt : "overview");
    } catch (e) { activateTab("overview"); }
    setQuizTabs(false);
    await maybeResumeQuiz();
    await showModal({
      title: "Guest mode",
      text: "Guest lists are stored in your browser cache — clearing browsing data deletes them.",
      okText: "OK"
    });
  }

  let authReady = false;
  if (GUEST) {
    startGuest();
  } else {
    supabase.auth.onAuthStateChange(async (event, session) => {
      if (session) {
        $("loginScreen").classList.add("hidden");
        $("app").classList.remove("hidden");
        $("loggedInUser").textContent = "🦛 " + session.user.email;
        if (authReady) return;
        authReady = true;
        await loadLists();
        loadColNames();
        renderOverview();
        try {
          const lt = localStorage.getItem("hippo-tab");
          const ll = localStorage.getItem("hippo-list");
          if (lt === "list" && ll) { openList(ll); }
          else activateTab(lt && lt !== "exam" && $("panel-" + lt) && !lt.startsWith("quiz") && lt !== "flash" ? lt : "overview");
        } catch (e) { activateTab("overview"); }
        setQuizTabs(false);
        await maybeResumeQuiz();
      } else {
        authReady = false;
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
