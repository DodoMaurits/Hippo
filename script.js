import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2";

// VUL IN vanuit jouw Supabase project (Settings → API):
const SUPABASE_URL = "https://JOUW-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "JOUW-ANON-PUBLIC-KEY";

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

  $("btnRegister").addEventListener("click", async () => {
    const email = $("authEmail").value.trim();
    const pass = $("authPass").value;
    const pass2 = $("authPass2").value;
    if (!email.includes("@")) return authMsg("Enter a valid email address");
    if (pass.length < 6) return authMsg("Password: at least 6 characters");
    if (pass !== pass2) return authMsg("Passwords do not match");
    const { error } = await supabase.auth.signUp({ email, password: pass });
    if (error) return authMsg(error.message);
    authMsg("Account created — you are logged in! 🦛", true);
  });

  $("btnLogin").addEventListener("click", async () => {
    const { error } = await supabase.auth.signInWithPassword({
      email: $("authEmail").value.trim(),
      password: $("authPass").value
    });
    if (error) return authMsg("Wrong email or password");
  });

  $("btnLogout").addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  supabase.auth.onAuthStateChange(async (event, session) => {
    if (session) {
      $("loginScreen").classList.add("hidden");
      $("app").classList.remove("hidden");
      $("loggedInUser").textContent = "🦛 " + session.user.email;
      await loadColNames();
      await loadWords();
      renderList();
    } else {
      words = [];
      $("app").classList.add("hidden");
      $("loginScreen").classList.remove("hidden");
      $("authPass").value = "";
      $("authPass2").value = "";
      authMsg("", false);
    }
  });

  // ---------- Data (Supabase) ----------
  async function loadWords() {
    const { data, error } = await supabase
      .from("words")
      .select("id, lang1, lang2")
      .order("created_at", { ascending: true });
    if (error) { console.error(error); return; }
    words = data.map((r) => ({ id: r.id, a: r.lang1, b: r.lang2 }));
  }

  async function loadColNames() {
    const { data } = await supabase
      .from("user_settings")
      .select("col1, col2")
      .maybeSingle();
    $("col1name").value = (data && data.col1) || "Language 1";
    $("col2name").value = (data && data.col2) || "Language 2";
    updateHeaders();
  }

  async function saveColNames() {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;
    await supabase.from("user_settings").upsert({
      user_id: user.user.id,
      col1: $("col1name").value,
      col2: $("col2name").value
    });
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
      in1.addEventListener("input", async () => {
        words[i].a = in1.value;
        await supabase.from("words").update({ lang1: in1.value }).eq("id", w.id);
      });
      in2.addEventListener("input", async () => {
        words[i].b = in2.value;
        await supabase.from("words").update({ lang2: in2.value }).eq("id", w.id);
      });
      const del = document.createElement("button");
      del.className = "btn danger";
      del.textContent = "✕";
      del.addEventListener("click", async () => {
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
    const { data, error } = await supabase
      .from("words")
      .insert({ lang1: "", lang2: "" })
      .select("id, lang1, lang2")
      .single();
    if (error) { console.error(error); return; }
    words.push({ id: data.id, a: data.lang1, b: data.lang2 });
    renderList();
    const inputs = $("listBody").querySelectorAll("tr:last-child input");
    if (inputs[0]) inputs[0].focus();
  });

  $("clearList").addEventListener("click", async () => {
    if (words.length && confirm("Are you sure you want to clear the whole pool? 🦛")) {
      await supabase.from("words").delete().neq("id", "00000000-0000-0000-0000-000000000000");
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

  // ---------- Flashcards (ongewijzigd) ----------
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
})();
