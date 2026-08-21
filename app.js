// ============================================================
// CONFIGURE THIS BEFORE YOU DEPLOY — see README.md for setup.
// ============================================================
const CONFIG = {
  WORKER_URL: "https://flashcard-proxy.tarush888.workers.dev", // your Cloudflare Worker's base URL, no trailing slash
};
// ============================================================
// The PIN itself is NOT configured here anymore — it lives only
// as the APP_PIN secret on the Worker, and is checked there. See
// README.md for what this does and doesn't protect against.
// ============================================================

const SESSION_KEY = "indexSessionToken";
const MAX_PIN_LENGTH = 10;

// ---------- Lock screen ----------
const lockScreen = document.getElementById("lock-screen");
const appScreen = document.getElementById("app-screen");
const pinDotsEl = document.getElementById("pin-dots");
const lockError = document.getElementById("lock-error");
const keypad = document.getElementById("keypad");

let pinEntry = "";
let loggingIn = false;

function renderPinDots() {
  pinDotsEl.innerHTML = "";
  for (let i = 0; i < Math.max(pinEntry.length, 1); i++) {
    const dot = document.createElement("span");
    dot.className = "pin-dot" + (i < pinEntry.length ? " filled" : "");
    pinDotsEl.appendChild(dot);
  }
}

async function attemptLogin() {
  if (loggingIn || !pinEntry) return;
  loggingIn = true;
  lockError.textContent = "Checking…";

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin: pinEntry }),
    });
    const data = await res.json();

    if (!res.ok) {
      lockError.textContent = data.error || "Incorrect PIN, try again.";
      pinEntry = "";
      renderPinDots();
      return;
    }

    sessionStorage.setItem(SESSION_KEY, data.token);
    unlock();
  } catch (err) {
    lockError.textContent = "Couldn't reach the server. Check your connection.";
  } finally {
    loggingIn = false;
  }
}

function unlock() {
  lockScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  initApp();
}

keypad.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn || loggingIn) return;
  const key = btn.dataset.key;
  lockError.textContent = "";

  if (key === "clear") {
    pinEntry = "";
  } else if (key === "back") {
    pinEntry = pinEntry.slice(0, -1);
  } else if (key === "enter") {
    attemptLogin();
    return;
  } else if (pinEntry.length < MAX_PIN_LENGTH) {
    pinEntry += key;
  }

  renderPinDots();
});

const existingToken = sessionStorage.getItem(SESSION_KEY);
if (existingToken) {
  lockScreen.classList.add("hidden");
  appScreen.classList.remove("hidden");
  initApp();
} else {
  renderPinDots();
}

// ---------- Main app ----------
let decks = {};
let currentDeckName = null;
let currentCards = [];
let currentIndex = 0;
let appInitialized = false;

async function initApp() {
  if (appInitialized) return;
  appInitialized = true;

  const select = document.getElementById("deck-select");
  select.innerHTML = '<option value="">Loading decks…</option>';
  decks = await loadDecksFromServer();
  refreshDeckSelect();

  document.getElementById("generate-btn").addEventListener("click", handleGenerate);
  document.getElementById("deck-select").addEventListener("change", handleDeckSelect);
  document.getElementById("delete-deck-btn").addEventListener("click", handleDeleteDeck);
  document.getElementById("save-deck-btn").addEventListener("click", handleSaveDeck);
  document.getElementById("shuffle-btn").addEventListener("click", handleShuffle);
  document.getElementById("prev-btn").addEventListener("click", () => stepCard(-1));
  document.getElementById("next-btn").addEventListener("click", () => stepCard(1));
  document.getElementById("flashcard").addEventListener("click", () => {
    document.getElementById("flashcard").classList.toggle("flipped");
  });
}

async function loadDecksFromServer() {
  const token = sessionStorage.getItem(SESSION_KEY);
  if (!token) return {};

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/decks`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      return {};
    }
    if (!res.ok) return {};

    const data = await res.json();
    const map = {};
    (data.decks || []).forEach((d) => {
      map[d.name] = d.cards;
    });
    return map;
  } catch {
    document.getElementById("generate-status").textContent =
      "Couldn't load saved decks — check your connection and reload.";
    return {};
  }
}

function refreshDeckSelect() {
  const select = document.getElementById("deck-select");
  const current = select.value;
  select.innerHTML = '<option value="">— New deck —</option>';
  Object.keys(decks).sort().forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = `${name} (${decks[name].length})`;
    select.appendChild(opt);
  });
  select.value = current;
}

function handleDeckSelect(e) {
  const name = e.target.value;
  if (!name) {
    currentDeckName = null;
    currentCards = [];
    renderStage();
    return;
  }
  currentDeckName = name;
  currentCards = decks[name].slice();
  currentIndex = 0;
  renderStage();
}

async function handleDeleteDeck() {
  if (!currentDeckName) return;
  if (!confirm(`Delete deck "${currentDeckName}"? This can't be undone.`)) return;

  const token = sessionStorage.getItem(SESSION_KEY);
  const nameToDelete = currentDeckName;

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/decks/${encodeURIComponent(nameToDelete)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      document.getElementById("generate-status").textContent = "Session expired — please reload and log in again.";
      return;
    }
    if (!res.ok) throw new Error("Delete failed");

    delete decks[nameToDelete];
    currentDeckName = null;
    currentCards = [];
    refreshDeckSelect();
    renderStage();
  } catch {
    alert("Couldn't delete the deck — check your connection and try again.");
  }
}

async function handleGenerate() {
  const text = document.getElementById("source-text").value.trim();
  const status = document.getElementById("generate-status");
  const count = document.getElementById("card-count").value || 10;
  const btn = document.getElementById("generate-btn");

  if (!text) {
    status.textContent = "Paste some text first.";
    return;
  }

  const token = sessionStorage.getItem(SESSION_KEY);
  if (!token) {
    status.textContent = "Session expired — please reload and log in again.";
    return;
  }

  btn.disabled = true;
  status.textContent = "Generating flashcards…";

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ text, count }),
    });

    const data = await res.json();

    if (res.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      status.textContent = "Session expired — please reload and log in again.";
      return;
    }
    if (!res.ok) throw new Error(data.error || "Request failed");

    currentCards = data.flashcards || [];
    currentDeckName = null;
    currentIndex = 0;
    status.textContent = `Generated ${currentCards.length} cards. Review, then "Save deck" to keep them.`;
    document.getElementById("deck-select").value = "";
    renderStage();
  } catch (err) {
    status.textContent = `Couldn't generate cards: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

async function handleSaveDeck() {
  if (!currentCards.length) return;
  const name = prompt("Name this deck:", currentDeckName || "");
  if (!name) return;

  const token = sessionStorage.getItem(SESSION_KEY);
  const saveBtn = document.getElementById("save-deck-btn");
  saveBtn.disabled = true;

  try {
    const res = await fetch(`${CONFIG.WORKER_URL}/decks`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ name, cards: currentCards }),
    });
    if (res.status === 401) {
      sessionStorage.removeItem(SESSION_KEY);
      document.getElementById("generate-status").textContent = "Session expired — please reload and log in again.";
      return;
    }
    if (!res.ok) throw new Error("Save failed");

    decks[name] = currentCards;
    currentDeckName = name;
    refreshDeckSelect();
    document.getElementById("deck-select").value = name;
  } catch {
    alert("Couldn't save the deck — check your connection and try again.");
  } finally {
    saveBtn.disabled = false;
  }
}

function handleShuffle() {
  if (currentCards.length < 2) return;
  for (let i = currentCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [currentCards[i], currentCards[j]] = [currentCards[j], currentCards[i]];
  }
  currentIndex = 0;
  renderStage();
}

function stepCard(delta) {
  if (!currentCards.length) return;
  document.getElementById("flashcard").classList.remove("flipped");
  currentIndex = (currentIndex + delta + currentCards.length) % currentCards.length;
  renderCardFace();
}

function renderStage() {
  const empty = document.getElementById("empty-state");
  const stage = document.getElementById("card-stage");

  if (!currentCards.length) {
    empty.classList.remove("hidden");
    stage.classList.add("hidden");
    return;
  }

  empty.classList.add("hidden");
  stage.classList.remove("hidden");
  document.getElementById("flashcard").classList.remove("flipped");
  renderCardFace();
}

function renderCardFace() {
  const card = currentCards[currentIndex];
  document.getElementById("question-text").textContent = card.question;
  document.getElementById("answer-text").textContent = card.answer;
  document.getElementById("card-position").textContent = `${currentIndex + 1} / ${currentCards.length}`;
}
