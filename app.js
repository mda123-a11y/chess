"use strict";

const GLYPH = { k: "\u265A", q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F" };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const START = [
  ["r", "n", "b", "q", "k", "b", "n", "r"],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  [], [], [], [],
  ["p", "p", "p", "p", "p", "p", "p", "p"],
  ["r", "n", "b", "q", "k", "b", "n", "r"],
];

const $ = (id) => document.getElementById(id);
const boardEl = $("board"), statusEl = $("status"), hintEl = $("hint");
const movesEl = $("moves"), capWhiteEl = $("cap-by-white"), capBlackEl = $("cap-by-black");
const materialEl = $("material"), undoBtn = $("undo-btn"), newBtn = $("new-btn");
const flipBtn = $("flip-btn"), gameoverEl = $("gameover"), gameoverText = $("gameover-text");
const againBtn = $("again-btn"), promoDlg = $("promo");

let S;

function freshState() {
  const board = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => {
      const row = START[r];
      if (!row.length) return null;
      return { t: row[c], c: r < 2 ? "b" : "w" };
    })
  );
  return {
    board, turn: "w",
    castling: { wk: true, wq: true, bk: true, bq: true },
    ep: null, half: 0, full: 1,
    history: [], records: [],
    selected: null, targets: new Map(),
    flipped: S ? S.flipped : false,
    over: null,
  };
}

const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const opp = (c) => (c === "w" ? "b" : "w");
const sqName = (r, c) => "abcdefgh"[c] + (8 - r);

function findKing(b, color) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (p && p.t === "k" && p.c === color) return [r, c];
    }
  return null;
}

function attacked(b, r, c, by) {
  // Pawns
  const dir = by === "w" ? -1 : 1;
  for (const dc of [-1, 1]) {
    const p = b[r - dir]?.[c + dc];
    if (p && p.c === by && p.t === "p") return true;
  }
  // Knights
  for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
    const p = inB(r+dr, c+dc) ? b[r+dr][c+dc] : null;
    if (p && p.c === by && p.t === "n") return true;
  }
  // Sliders
  const rays = [
    [[-1,-1],[-1,1],[1,-1],[1,1], "bq"],
    [[-1,0],[1,0],[0,-1],[0,1], "rq"],
  ];
  for (const group of rays) {
    const kinds = group[group.length - 1];
    for (let i = 0; i < group.length - 1; i++) {
      let rr = r + group[i][0], cc = c + group[i][1];
      while (inB(rr, cc)) {
        const p = b[rr][cc];
        if (p) {
          if (p.c === by && (kinds.includes(p.t))) return true;
          break;
        }
        rr += group[i][0]; cc += group[i][1];
      }
    }
  }
  // King
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const p = inB(r+dr, c+dc) ? b[r+dr][c+dc] : null;
      if (p && p.c === by && p.t === "k") return true;
    }
  return false;
}

// Pseudo-legal moves for piece at r,c. Returns {r,c,promo,castle,ep}[].
function pseudo(b, r, c, castling, ep) {
  const p = b[r][c];
  if (!p) return [];
  const moves = [];
  const add = (rr, cc, extra = {}) => { if (inB(rr, cc)) moves.push({ r: rr, c: cc, ...extra }); };
  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      let rr = r + dr, cc = c + dc;
      while (inB(rr, cc)) {
        const q = b[rr][cc];
        if (!q) add(rr, cc);
        else { if (q.c !== p.c) add(rr, cc); break; }
        rr += dr; cc += dc;
      }
    }
  };
  const DIAG = [[-1,-1],[-1,1],[1,-1],[1,1]];
  const ORTH = [[-1,0],[1,0],[0,-1],[0,1]];
  if (p.t === "p") {
    const dir = p.c === "w" ? -1 : 1;
    const home = p.c === "w" ? 6 : 1;
    if (inB(r+dir, c) && !b[r+dir][c]) {
      add(r+dir, c);
      if (r === home && !b[r+2*dir][c]) add(r+2*dir, c, { double: true });
    }
    for (const dc of [-1, 1]) {
      const rr = r+dir, cc = c+dc;
      if (!inB(rr, cc)) continue;
      const q = b[rr][cc];
      if (q && q.c !== p.c) add(rr, cc);
      else if (!q && ep && ep.r === rr && ep.c === cc) {
        const victim = b[r][cc];
        if (victim && victim.t === "p" && victim.c !== p.c) add(rr, cc, { ep: true });
      }
    }
  } else if (p.t === "n") {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      if (!inB(r+dr, c+dc)) continue;
      const q = b[r+dr][c+dc];
      if (!q || q.c !== p.c) add(r+dr, c+dc);
    }
  } else if (p.t === "b") slide(DIAG);
  else if (p.t === "r") slide(ORTH);
  else if (p.t === "q") slide(DIAG.concat(ORTH));
  else if (p.t === "k") {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        if (!inB(r+dr, c+dc)) continue;
        const q = b[r+dr][c+dc];
        if (!q || q.c !== p.c) add(r+dr, c+dc);
      }
    // Castling
    const home = p.c === "w" ? 7 : 0;
    if (r === home && c === 4) {
      const rights = p.c === "w" ? ["wk", "wq"] : ["bk", "bq"];
      const enemy = opp(p.c);
      if (castling[rights[0]] && !b[home][5] && !b[home][6] &&
          b[home][7] && b[home][7].t === "r" && b[home][7].c === p.c &&
          !attacked(b, home, 4, enemy) && !attacked(b, home, 5, enemy) && !attacked(b, home, 6, enemy))
        add(home, 6, { castle: "k" });
      if (castling[rights[1]] && !b[home][3] && !b[home][2] && !b[home][1] &&
          b[home][0] && b[home][0].t === "r" && b[home][0].c === p.c &&
          !attacked(b, home, 4, enemy) && !attacked(b, home, 3, enemy) && !attacked(b, home, 2, enemy))
        add(home, 2, { castle: "q" });
    }
  }
  return moves;
}

function applyOn(b, move, r, c, promoPiece) {
  const p = b[r][c];
  const nb = b.map((row) => row.slice());
  let captured = null;
  if (move.ep) captured = nb[r][move.c];
  else if (nb[move.r][move.c]) captured = nb[move.r][move.c];
  nb[r][c] = null;
  if (move.ep) nb[r][move.c] = null;
  const lastRank = p.c === "w" ? 0 : 7;
  const promotes = p.t === "p" && move.r === lastRank;
  nb[move.r][move.c] = { t: promotes ? (promoPiece || "q") : p.t, c: p.c };
  if (move.castle) {
    const home = p.c === "w" ? 7 : 0;
    if (move.castle === "k") { nb[home][5] = nb[home][7]; nb[home][7] = null; }
    else { nb[home][3] = nb[home][0]; nb[home][0] = null; }
  }
  return { nb, captured, promotes };
}

function legalMovesFor(r, c, promoPiece) {
  const p = S.board[r][c];
  if (!p) return [];
  return pseudo(S.board, r, c, S.castling, S.ep).filter((m) => {
    const { nb } = applyOn(S.board, m, r, c, promoPiece || "q");
    const k = p.t === "k" ? [m.r, m.c] : findKing(nb, p.c);
    return k && !attacked(nb, k[0], k[1], opp(p.c));
  });
}

function allLegal(color) {
  const out = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = S.board[r][c];
      if (p && p.c === color)
        for (const m of pseudo(S.board, r, c, S.castling, S.ep)) {
          const { nb } = applyOn(S.board, m, r, c, "q");
          const k = p.t === "k" ? [m.r, m.c] : findKing(nb, color);
          if (k && !attacked(nb, k[0], k[1], opp(color))) out.push({ from: [r, c], m });
        }
    }
  return out;
}

function san(r, c, m, promoPiece) {
  if (m.castle) return m.castle === "k" ? "O-O" : "O-O-O";
  const p = S.board[r][c];
  const target = S.board[m.r][m.c] || (m.ep ? { t: "p" } : null);
  let s;
  if (p.t === "p") {
    s = target ? "abcdefgh"[c] + "x" + sqName(m.r, m.c) : sqName(m.r, m.c);
    if (m.r === (p.c === "w" ? 0 : 7)) s += "=" + (promoPiece || "q").toUpperCase();
  } else {
    let dis = "";
    for (let rr = 0; rr < 8; rr++)
      for (let cc = 0; cc < 8; cc++) {
        if ((rr === r && cc === c)) continue;
        const q = S.board[rr][cc];
        if (!q || q.c !== p.c || q.t !== p.t) continue;
        if (pseudo(S.board, rr, cc, S.castling, S.ep).some((x) => x.r === m.r && x.c === m.c)) {
          // keep only moves that are actually legal is overkill; pseudo is fine for disambiguation hint
          if (rr !== r && cc !== c) dis = "";
          else if (cc === c && rr !== r) dis = "abcdefgh"[c];
          else if (rr === r) dis = String(8 - r);
          else dis = sqName(r, c);
        }
      }
    s = p.t.toUpperCase() + dis + (target ? "x" : "") + sqName(m.r, m.c);
  }
  // check / mate suffix
  const { nb } = applyOn(S.board, m, r, c, promoPiece || "q");
  const enemy = opp(p.c);
  const k = p.t === "k" ? [m.r, m.c] : findKing(nb, enemy);
  if (k && attacked(nb, k[0], k[1], p.c)) {
    // Simulate the post-move position: the mover's non-double move clears
    // any en passant square, so stale ep cannot conjure phantom replies.
    const save = { board: S.board, castling: S.castling, ep: S.ep };
    S.board = nb;
    S.ep = m.double ? { r: (r + m.r) / 2, c } : null;
    const replies = allLegal(enemy);
    Object.assign(S, save);
    s += replies.length === 0 ? "#" : "+";
  }
  return s;
}

function bareMaterial() {
  // insufficient material: K vs K, K+minor vs K
  const rest = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = S.board[r][c];
      if (p && p.t !== "k") rest.push(p.t);
    }
  if (rest.length === 0) return true;
  if (rest.length === 1 && (rest[0] === "b" || rest[0] === "n")) return true;
  return false;
}

function doMove(r, c, m, promoPiece) {
  const p = S.board[r][c];
  const text = san(r, c, m, promoPiece);
  S.history.push({
    board: S.board.map((row) => row.slice()),
    castling: { ...S.castling }, ep: S.ep ? { ...S.ep } : null,
    half: S.half, full: S.full,
  });
  const { nb, captured } = applyOn(S.board, m, r, c, promoPiece);
  S.board = nb;
  // castling rights
  if (p.t === "k") {
    if (p.c === "w") { S.castling.wk = false; S.castling.wq = false; }
    else { S.castling.bk = false; S.castling.bq = false; }
  }
  if ((r === 7 && c === 0) || (m.r === 7 && m.c === 0)) S.castling.wq = false;
  if ((r === 7 && c === 7) || (m.r === 7 && m.c === 7)) S.castling.wk = false;
  if ((r === 0 && c === 0) || (m.r === 0 && m.c === 0)) S.castling.bq = false;
  if ((r === 0 && c === 7) || (m.r === 0 && m.c === 7)) S.castling.bk = false;
  S.ep = m.double ? { r: (r + m.r) / 2, c } : null;
  S.half = (p.t === "p" || captured) ? 0 : S.half + 1;
  if (S.turn === "b") S.full++;
  S.last = { from: [r, c], to: [m.r, m.c] };
  S.records.push({ text, by: p.c, captured });
  S.turn = opp(S.turn);
  S.selected = null; S.targets = new Map();
  updateOutcome();
  render();
}

function updateOutcome() {
  const moves = allLegal(S.turn);
  const king = findKing(S.board, S.turn);
  const check = king ? attacked(S.board, king[0], king[1], opp(S.turn)) : false;
  S.check = check;
  if (moves.length === 0) {
    S.over = check
      ? { result: S.turn === "w" ? "0-1" : "1-0", reason: "checkmate", winner: opp(S.turn) }
      : { result: "\u00BD-\u00BD", reason: "stalemate" };
  } else if (S.half >= 100) {
    S.over = { result: "\u00BD-\u00BD", reason: "fifty-move rule" };
  } else if (bareMaterial()) {
    S.over = { result: "\u00BD-\u00BD", reason: "insufficient material" };
  } else {
    S.over = null;
  }
}

function sideLabel(c) { return c === "w" ? "White" : "Black"; }

// ---------- rendering ----------

const squares = [];
function buildBoard() {
  boardEl.textContent = "";
  squares.length = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "square";
      b.dataset.r = r; b.dataset.c = c;
      b.addEventListener("click", () => onSquare(r, c));
      boardEl.appendChild(b);
      squares.push(b);
    }
}

function render() {
  const order = [];
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) order.push([r, c]);
  if (S.flipped) order.reverse();
  order.forEach(([r, c], i) => {
    const el = squares[i];
    el.dataset.r = r; el.dataset.c = c;
    const p = S.board[r][c];
    const light = (r + c) % 2 === 1;
    el.classList.toggle("light", light);
    el.classList.toggle("dark", !light);
    const sel = S.selected && S.selected[0] === r && S.selected[1] === c;
    el.classList.toggle("selected", !!sel);
    const lm = S.last;
    el.classList.toggle("lastmove",
      !!lm && ((lm.from[0] === r && lm.from[1] === c) || (lm.to[0] === r && lm.to[1] === c)));
    const isKing = p && p.t === "k" && p.c === S.turn && S.check;
    el.classList.toggle("in-check", !!isKing);
    const key = r + "," + c;
    const isTarget = S.targets.has(key);
    el.classList.toggle("target", isTarget);
    el.classList.toggle("capture", isTarget && (!!p || S.targets.get(key).ep));
    let label = p ? GLYPH[p.t] : "";
    let coord = "";
    const showRank = (S.flipped ? c === 7 : c === 0);
    const showFile = (S.flipped ? r === 0 : r === 7);
    if (showRank) coord += `<span class="coord rank">${8 - r}</span>`;
    if (showFile) coord += `<span class="coord file">${"abcdefgh"[c]}</span>`;
    el.innerHTML = (p ? `<span class="piece ${p.c}" aria-hidden="true">${label}</span>` : "") + coord;
    const name = p ? `${sideLabel(p.c)} ${pieceName(p.t)} on ${sqName(r, c)}` : `Empty square ${sqName(r, c)}`;
    el.setAttribute("aria-label", name + (isTarget ? ", legal move" : ""));
  });

  // status
  const dot = `<span class="turn-dot ${S.turn === "b" ? "black" : ""}" aria-hidden="true"></span>`;
  if (S.over) {
    const o = S.over;
    const winText = o.winner ? `${sideLabel(o.winner)} wins` : "Draw";
    statusEl.innerHTML = `${dot}${winText} — ${o.reason} (${o.result})`;
  } else {
    statusEl.innerHTML = `${dot}${sideLabel(S.turn)} to move` + (S.check ? " — check!" : "");
  }

  // hint
  if (S.over) {
    hintEl.textContent = "Game over. Start a new game to play again.";
  } else if (S.selected) {
    hintEl.textContent = `${S.targets.size} legal move${S.targets.size === 1 ? "" : "s"}. Choose a dotted square, or press Esc to deselect.`;
  } else {
    hintEl.textContent = `${sideLabel(S.turn)} to move — select a ${sideLabel(S.turn).toLowerCase()} piece.`;
  }

  // moves
  movesEl.textContent = "";
  S.records.forEach((rec) => {
    const li = document.createElement("li");
    li.textContent = rec.text;
    movesEl.appendChild(li);
  });
  if (movesEl.lastChild) movesEl.lastChild.scrollIntoView({ block: "nearest" });

  // captured + material
  const byWhite = [], byBlack = [];
  let score = 0;
  for (const rec of S.records) {
    if (!rec.captured) continue;
    (rec.by === "w" ? byWhite : byBlack).push(rec.captured.t);
    score += rec.by === "w" ? VALUE[rec.captured.t] : -VALUE[rec.captured.t];
  }
  const orderPieces = (arr) => arr.sort((a, b) => VALUE[b] - VALUE[a]).map((t) => GLYPH[t]).join(" ");
  const myColor = (el, glyphs, fallback) => {
    el.textContent = glyphs || fallback;
  };
  myColor(capWhiteEl, orderPieces(byWhite), "—");
  myColor(capBlackEl, orderPieces(byBlack), "—");
  capWhiteEl.style.color = "#111"; capBlackEl.style.color = "#111";
  materialEl.textContent = score === 0 ? "Material even" :
    score > 0 ? `White is up ${score} pawn${score === 1 ? "" : "s"}` :
    `Black is up ${-score} pawn${score === -1 ? "" : "s"}`;

  undoBtn.disabled = S.history.length === 0;
  flipBtn.setAttribute("aria-pressed", String(S.flipped));

  if (S.over) {
    gameoverText.textContent = statusEl.textContent;
    gameoverEl.hidden = false;
  } else {
    gameoverEl.hidden = true;
  }
}

function pieceName(t) {
  return { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" }[t];
}

// ---------- interaction ----------

function onSquare(r, c) {
  if (S.over) return;
  const key = r + "," + c;
  if (S.selected && S.targets.has(key)) {
    const [fr, fc] = S.selected;
    const m = S.targets.get(key);
    const p = S.board[fr][fc];
    if (p.t === "p" && (m.r === 0 || m.r === 7)) askPromo().then((choice) => {
      if (choice) doMove(fr, fc, m, choice);
      else { S.selected = null; S.targets = new Map(); render(); }
    });
    else doMove(fr, fc, m, null);
    return;
  }
  const p = S.board[r][c];
  if (p && p.c === S.turn) {
    if (S.selected && S.selected[0] === r && S.selected[1] === c) {
      S.selected = null; S.targets = new Map();
    } else {
      S.selected = [r, c];
      S.targets = new Map(legalMovesFor(r, c).map((m) => [m.r + "," + m.c, m]));
      if (S.targets.size === 0) {
        hintEl.textContent = `That ${pieceName(p.t)} has no legal moves. Try another piece.`;
      }
    }
    render();
  } else if (S.selected) {
    S.selected = null; S.targets = new Map();
    hintEl.textContent = "Deselected. Pick one of your pieces.";
    render();
  } else if (p) {
    hintEl.textContent = `It's ${sideLabel(S.turn)}'s turn — that ${pieceName(p.t)} belongs to ${sideLabel(p.c)}.`;
  }
}

function askPromo() {
  return new Promise((resolve) => {
    const onPick = (e) => {
      cleanup();
      resolve(e.target.closest("button") ? e.target.closest("button").dataset.piece : null);
    };
    const onCancel = () => { cleanup(); resolve(null); };
    const onKey = (e) => {
      const map = { q: "q", r: "r", b: "b", n: "n" };
      const k = e.key.toLowerCase();
      if (map[k]) { cleanup(); resolve(map[k]); }
    };
    function cleanup() {
      promoDlg.removeEventListener("click", onPick);
      promoDlg.removeEventListener("cancel", onCancel);
      promoDlg.removeEventListener("close", onCancel);
      document.removeEventListener("keydown", onKey, true);
      if (promoDlg.open) promoDlg.close();
    }
    promoDlg.addEventListener("click", onPick);
    promoDlg.addEventListener("cancel", onCancel);
    promoDlg.addEventListener("close", onCancel);
    document.addEventListener("keydown", onKey, true);
    if (typeof promoDlg.showModal === "function") promoDlg.showModal();
    const first = promoDlg.querySelector("button");
    if (first) first.focus();
  });
}

function reset() {
  const keepFlip = S ? S.flipped : false;
  S = freshState();
  S.flipped = keepFlip;
  updateOutcome();
  render();
}

newBtn.addEventListener("click", () => {
  if (S.records.length > 0 && !S.over) {
    if (!window.confirm("Start a new game? The current game will be lost.")) return;
  }
  reset();
});
againBtn.addEventListener("click", reset);
undoBtn.addEventListener("click", () => {
  const prev = S.history.pop();
  if (!prev) return;
  S.board = prev.board; S.castling = prev.castling; S.ep = prev.ep;
  S.half = prev.half; S.full = prev.full;
  S.records.pop();
  S.last = null;
  // Turn follows the move count: even ply means White to move.
  S.turn = S.records.length % 2 === 0 ? "w" : "b";
  S.selected = null; S.targets = new Map();
  S.over = null;
  updateOutcome();
  render();
});
flipBtn.addEventListener("click", () => {
  S.flipped = !S.flipped;
  render();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && S.selected && !promoDlg.open) {
    S.selected = null; S.targets = new Map();
    render();
  }
});

buildBoard();
S = freshState();
updateOutcome();
render();
