(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const STORAGE_KEY = "woordenlijst-data-v1";
  const COLNAMES_KEY = "woordenlijst-colnames-v1";

  let words = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(words)); }
  function saveColNames() {
    localStorage.setItem(COLNAMES_KEY, JSON.stringify({
      c1: $("col1name").value, c2: $("col2name").value
    }));
  }
  function loadColNames() {
    try {
      const raw = localStorage.getItem(COLNAMES_KEY);
      if (raw) {
        const n = JSON.parse(raw);
        $("col1name").value = n.c1 || "Nederlands";
        $("col2name").value = n.c2 || "Engels";
      }
    } catch (e) {}
    updateHeaders();
  }
  function updateHeaders() {
    $("th1").textContent = $("col1name").value || "Taal 1";
    $("th2").textContent = $("col2name").value || "Taal 2";
  }

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
      tab.classList.add("active");
      $("panel-" + tab.dataset.tab).classList.add("active");
    });
  });

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
      in1.type = "text"; in1.value = w.a; in1.placeholder = "woord in taal 1";
      in2.type = "text"; in2.value = w.b; in2.placeholder = "woord in taal 2";
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
    if (words.length && confirm("Weet je zeker dat je de hele poel wilt legen? 🦛")) {
      words = []; save(); renderList();
    }
  });
  $("col1name").addEventListener("input", () => { saveColNames(); updateHeaders(); });
  $("col2name").addEventListener("input", () => { saveColNames(); updateHeaders(); });

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

  let mc = { queue: [], idx: 0, score: 0, locked: false };
  function mcStart() {
    const dir = $("mcDirection").value;
    let pool = getPairs(dir);
    if (!pool.length) { $("mcPrompt").textContent = "🦛 De poel is leeg! Voeg eerst woorden toe."; return; }
    if ($("mcShuffle").checked) pool = shuffle(pool);
    mc = { queue: pool, idx: 0, score: 0, locked: false };
    mcNext();
  }
  function mcNext() {
    $("mcFeedback").textContent = "";
    $("mcFeedback").className = "feedback";
    if (mc.idx >= mc.queue.length) {
      const pct = mc.queue.length ? Math.round(mc.score / mc.queue.length * 100) : 0;
      $("mcPrompt").textContent = "🦛🎉 Klaar! Je score: " + mc.score + "/" + mc.queue.length + " (" + pct + "%)";
      $("mcHint").textContent = pct >= 80 ? "Spattend goed! 🌟" : pct >= 50 ? "Goed bezig, ga zo door! 💪" : "Tip: dobber eerst door de flashcards 🃏";
      $("mcChoices").innerHTML = "";
      updateScore($("mcProgress"), $("mcScore"), $("mcCount"), mc.queue.length, mc.queue.length, mc.score);
      return;
    }
    mc.locked = false;
    const item = mc.queue[mc.idx];
    $("mcPrompt").textContent = item.prompt;
    $("mcHint").textContent = "Kies de juiste vertaling";
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
          $("mcFeedback").textContent = "✔ Spattend goed!";
          $("mcFeedback").classList.add("good");
        } else {
          btn.classList.add("wrong");
          $("mcFeedback").textContent = "✘ Oeps! Het was: " + item.answer;
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

  let ty = { queue: [], idx: 0, score: 0 };
  function typeStart() {
    const dir = $("typeDirection").value;
    let pool = getPairs(dir);
    if (!pool.length) { $("typePrompt").textContent = "🦛 De poel is leeg! Voeg eerst woorden toe."; return; }
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
      $("typePrompt").textContent = "🦛🎉 Klaar! Je score: " + ty.score + "/" + ty.queue.length + " (" + pct + "%)";
      $("typeHint").textContent = "";
      $("typeInput").style.display = "none";
      updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.queue.length, ty.score);
      return;
    }
    $("typeInput").style.display = "inline-block";
    const item = ty.queue[ty.idx];
    $("typePrompt").textContent = item.prompt;
    $("typeHint").textContent = "Typ de vertaling en druk op Enter";
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
      $("typeFeedback").textContent = "✔ Spattend goed!";
      $("typeFeedback").classList.add("good");
    } else {
      $("typeFeedback").textContent = "✘ Bijna! Het was: " + item.answer;
      $("typeFeedback").classList.add("bad");
    }
    ty.idx++;
    updateScore($("typeProgress"), $("typeScore"), $("typeCount"), ty.queue.length, ty.idx, ty.score);
    setTimeout(typeNext, 1200);
  }
  $("typeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") typeCheck(); });
  $("typeStart").addEventListener("click", typeStart);

  let fl = { queue: [], idx: 0 };
  function flashStart() {
    let pool = getPairs("1to2");
    if (!pool.length) { $("flashFront").textContent = "🦛 Voeg eerst woorden toe!"; return; }
    if ($("flashShuffle").checked) pool = shuffle(pool);
    fl = { queue: pool, idx: 0 };
    flashShow();
  }
  function flashShow() {
    $("flashCard").classList.remove("flipped");
    const item = fl.queue[fl.idx];
    $("flashFront").textContent = item ? item.prompt : "🦛";
    $("flashBack").textContent = item ? item.answer : "…";
    $("flashCount").textContent = "Kaart " + (fl.idx + 1) + "/" + fl.queue.length;
  }
  $("flashCard").addEventListener("click", () => $("flashCard").classList.toggle("flipped"));
  $("flashNext").addEventListener("click", () => {
    if (fl.queue.length) { fl.idx = (fl.idx + 1) % fl.queue.length; flashShow(); }
  });
  $("flashPrev").addEventListener("click", () => {
    if (fl.queue.length) { fl.idx = (fl.idx - 1 + fl.queue.length) % fl.queue.length; flashShow(); }
  });
  $("flashStart").addEventListener("click", flashStart);

  loadColNames();
  renderList();
})();
