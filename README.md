# Chess

Local two-player chess in three static files — no build step, no dependencies.

Open `index.html` in a browser (or serve the folder: `python3 -m http.server`) and play.

- Full rules: castling, en passant, promotion (dialog with keyboard shortcuts), check / checkmate / stalemate, fifty-move rule, insufficient-material draws
- UX: turn status with check alerts, legal-move dots, last-move and check highlights, undo, board flip, captured trays with material score, auto-scrolling move list in SAN, Esc to deselect, confirm before abandoning a game
