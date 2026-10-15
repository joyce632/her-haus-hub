/* Her Haus Hub — Office: a walkable pixel office that shows where everyone is and what they're working on.
   Characters follow each person's Hub clock (off shift = drove home, Break/Lunch = Break room/Lunch room) and
   act out their In Progress task. Talks to /api/office/* (see office.py). Loaded after app.js, uses its helpers. */
'use strict';

const OFFICE_CSS = "/* Layout: game client. HUD bar on top; left rail = you + roster by room; right = the walkable office, chat bar, activity log. Stacks map-first on phones. Single committed dark look. */\n/* Her Haus brand: navy #0C2E60 \u00b7 red #CB252B \u00b7 white \u00b7 mist #EDF2F8 (from the Hub). Single committed navy look. */\n.office-app {--bg: #081f42;\n  --panel: #0C2E60;\n  --panel-2: #143b75;\n  --ink: #FFFFFF;\n  --muted: #b8c7de;\n  --line: rgba(237, 242, 248, .16);\n  --accent: #CB252B;\n  --accent-ink: #ff6b70;\n  --accent-soft: rgba(203, 37, 43, .28);\n  --mist: #EDF2F8;\n  --live: #4ade80;\n  --danger: #ff8a8e;\n  --font-display: \"Montserrat\", system-ui, -apple-system, \"Segoe UI\", sans-serif;\n  --font-body: \"VT323\", ui-monospace, \"SF Mono\", Menlo, monospace;\n  color-scheme: dark; container: office / inline-size; background: var(--bg); border-radius: 16px; padding: 12px; box-shadow: 0 20px 50px -24px rgba(8, 31, 66, .55); }\n.office-app * {box-sizing: border-box; }\n.office-app {background: var(--bg); }\n.office-app {color: var(--ink); font-family: var(--font-body); font-size: 19px; line-height: 1.2; }\n.office-app .wrap { display: grid; gap: 12px; }\n.office-app .hud {display: flex; flex-wrap: wrap; align-items: stretch; gap: 8px; }\n.office-app .brand {display: flex; align-items: center; gap: 10px; padding: 6px 14px 6px 10px; background: #fff; border: 1px solid #fff; border-radius: 6px; }\n.office-app .brand svg {width: 38px; height: 26px; flex: none; }\n.office-app .brand h1 .her {color: var(--accent); }\n.office-app .brand h1 {color: var(--panel); }\n.office-app .brand small {color: #4a6286 !important; }\n.office-app .brand h1 {margin: 0; font-family: var(--font-display); font-weight: 800; font-size: 20px; letter-spacing: .04em; line-height: 1; text-transform: uppercase; }\n.office-app .brand small {display: block; font-family: var(--font-body); font-size: 15px; color: var(--muted); }\n.office-app .stat {display: grid; align-content: center; min-width: 74px; padding: 4px 12px; background: var(--panel); border: 1px solid var(--line); border-radius: 6px; font-variant-numeric: tabular-nums; }\n.office-app .stat b {font-family: var(--font-display); font-size: 20px; font-weight: 700; line-height: 1.1; }\n.office-app .stat span {color: var(--muted); font-size: 15px; }\n.office-app .stat.live b {color: var(--live); }\n.office-app .stat.clock {margin-left: auto; }\n.office-app .main {display: grid; grid-template-columns: 320px minmax(0, 1fr); grid-template-areas: \"side map\"; gap: 12px; align-items: start; }\n.office-app .side {grid-area: side; display: grid; gap: 12px; min-width: 0; }\n.office-app .mapcol {grid-area: map; display: grid; gap: 10px; min-width: 0; }\n@container office (max-width: 900px) {.office-app .main {grid-template-columns: minmax(0, 1fr); grid-template-areas: \"map\" \"side\"; }\n}\n.office-app .card {background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 12px; display: grid; gap: 10px; min-width: 0; }\n.office-app .card h2 {margin: 0; font-family: var(--font-display); font-size: 14px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }\n.office-app .screen {position: relative; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; background: #000; min-width: 0; }\n.office-app canvas#of-office {display: block; width: 100%; height: auto; image-rendering: pixelated; image-rendering: crisp-edges; cursor: pointer; }\n.office-app canvas#of-office:focus-visible {outline: 2px solid #fff; outline-offset: -2px; }\n.office-app .overlay {position: absolute; inset: 0; pointer-events: none; overflow: hidden; }\n.office-app .sign {position: absolute; transform: translate(-50%, -50%); font-family: var(--font-display); font-weight: 700; font-size: clamp(8px, 1vw, 13px);\n  color: #fff; background: rgba(12, 46, 96, .92); border: 1px solid #081f42; border-radius: 3px; padding: 1px 6px; white-space: nowrap; letter-spacing: .03em; }\n.office-app .tag {position: absolute; transform: translate(-50%, -100%); pointer-events: auto; cursor: pointer; font: inherit; font-size: clamp(11px, 1.1vw, 15px); line-height: 1;\n  padding: 1px 5px 2px; white-space: nowrap; background: rgba(8, 31, 66, .88); color: #fff; border: 1px solid #081f42; border-radius: 3px; }\n.office-app .tag.live::before {content: \"\"; display: inline-block; width: 5px; height: 5px; border-radius: 50%; background: var(--live); margin-right: 4px; vertical-align: 2px; }\n.office-app .tag.me {background: var(--accent); color: #fff; }\n.office-app .tag.sel {outline: 2px solid #fff; z-index: 3; }\n.office-app .tag.hide {display: none; }\n.office-app .tag small {display: block; max-width: 11em; overflow: hidden; text-overflow: ellipsis; font-size: .82em; color: #c9d6e8; margin-top: 1px; }\n.office-app .tag.me small {color: #ffe0e1; }\n.office-app .bubble {position: absolute; transform: translate(-50%, -100%); max-width: 34%; padding: 3px 7px 4px; background: #fff; color: #0C2E60; border: 1px solid #0C2E60;\n  border-radius: 6px; font-size: clamp(12px, 1.2vw, 16px); line-height: 1.05; z-index: 4; overflow-wrap: anywhere; text-align: center; }\n.office-app .bubble::after {content: \"\"; position: absolute; left: 50%; bottom: -5px; width: 8px; height: 8px; background: #fff; border-right: 1px solid #0C2E60; border-bottom: 1px solid #0C2E60; transform: translateX(-50%) rotate(45deg); }\n.office-app .chatbar {display: flex; gap: 8px; }\n.office-app .chatbar input {flex: 1; min-width: 0; font: inherit; font-size: 20px; color: var(--ink); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 6px 10px; }\n.office-app .hint {color: var(--muted); font-size: 16px; }\n.office-app .banner {background: var(--panel-2); border: 1px dashed rgba(237, 242, 248, .35); border-radius: 6px; padding: 8px 12px; color: var(--muted); }\n.office-app .banner b {color: var(--accent-ink); font-weight: 400; }\n.office-app .btn {font-family: var(--font-display); font-weight: 700; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; cursor: pointer; padding: 8px 12px; border-radius: 5px; border: 1px solid #081f42; box-shadow: 0 2px 0 #051632; }\n.office-app .btn.primary {background: var(--accent); color: #fff; border-color: #8f1a1f; }\n.office-app .btn.primary:hover {background: #e03a40; }\n.office-app .btn.ghost {background: var(--panel-2); color: var(--ink); border-color: var(--line); }\n.office-app .btn:active {transform: translateY(2px); box-shadow: none; }\n.office-app .btn:disabled {opacity: .45; cursor: not-allowed; }\n.office-app button:focus-visible, .office-app input:focus-visible, .office-app summary:focus-visible {outline: 2px solid #fff; outline-offset: 2px; }\n.office-app .me-row {display: flex; align-items: center; gap: 10px; min-width: 0; }\n.office-app .me-row img {width: 32px; height: 48px; image-rendering: pixelated; flex: none; background: var(--panel-2); border-radius: 4px; }\n.office-app .me-row div {min-width: 0; }\n.office-app .me-row strong {display: block; font-weight: 400; font-size: 21px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.office-app .me-row span {color: var(--muted); font-size: 16px; }\n.office-app .picks {display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px; }\n.office-app .pick {font: inherit; font-size: 17px; text-align: left; color: var(--ink); background: var(--panel-2); border: 1px solid var(--line); border-radius: 5px;\n  padding: 4px 8px; cursor: pointer; display: grid; grid-template-columns: 9px minmax(0, 1fr); column-gap: 7px; align-items: center; min-width: 0; line-height: 1; }\n.office-app .pick i {width: 9px; height: 9px; border-radius: 2px; grid-row: span 2; }\n.office-app .pick small {color: var(--muted); font-size: 14px; }\n.office-app .pick[aria-pressed=\"true\"] {border-color: var(--accent); background: var(--accent-soft); }\n.office-app .lbl {display: grid; gap: 4px; color: var(--muted); font-size: 16px; }\n.office-app .lbl input {font: inherit; font-size: 19px; color: var(--ink); background: var(--bg); border: 1px solid var(--line); border-radius: 5px; padding: 5px 8px; width: 100%; }\n.office-app .row {display: flex; flex-wrap: wrap; gap: 8px; }\n.office-app .chips {display: flex; flex-wrap: wrap; gap: 4px; }\n.office-app .chips button {font: inherit; font-size: 15px; color: var(--ink); background: transparent; border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; cursor: pointer; }\n.office-app .chips button:hover {border-color: var(--accent); background: var(--accent-soft); }\n.office-app .detect {font-size: 16px; color: var(--muted); min-height: 1.2em; }\n.office-app .detect b {color: var(--ink); font-weight: 400; }\n.office-app .msg {min-height: 1.2em; color: var(--muted); font-size: 16px; }\n.office-app .msg.err {color: var(--danger); }\n.office-app details.editor {border-top: 1px solid var(--line); padding-top: 8px; }\n.office-app details.editor summary {cursor: pointer; font-family: var(--font-display); font-weight: 700; font-size: 13px; letter-spacing: .03em; list-style: none; display: flex; justify-content: space-between; }\n.office-app details.editor summary::after {content: \"+\"; color: var(--muted); }\n.office-app details.editor[open] summary::after {content: \"\u2013\"; }\n.office-app .edit-body {display: grid; gap: 8px; margin-top: 10px; }\n.office-app #of-preview {width: 100%; max-width: 260px; height: auto; image-rendering: pixelated; background: var(--panel-2); border-radius: 5px; justify-self: center; }\n.office-app .opt {display: grid; gap: 3px; }\n.office-app .opt > span {color: var(--muted); font-size: 15px; }\n.office-app .opts {display: flex; flex-wrap: wrap; gap: 4px; }\n.office-app .sw {width: 22px; height: 22px; border-radius: 4px; border: 2px solid transparent; cursor: pointer; padding: 0; box-shadow: inset 0 0 0 1px rgba(0,0,0,.5); }\n.office-app .sw[aria-pressed=\"true\"] {border-color: #fff; box-shadow: 0 0 0 2px var(--accent); }\n.office-app .word {font: inherit; font-size: 15px; color: var(--ink); background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px; padding: 2px 7px; cursor: pointer; }\n.office-app .word[aria-pressed=\"true\"] {border-color: var(--accent); color: #fff; background: var(--accent-soft); }\n.office-app .group {display: grid; gap: 2px; }\n.office-app .group h3 {margin: 4px 0 2px; font-family: var(--font-display); font-weight: 700; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); display: flex; justify-content: space-between; }\n.office-app .person {font: inherit; color: inherit; width: 100%; text-align: left; background: transparent; border: 1px solid transparent; border-radius: 5px; cursor: pointer;\n  display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 0 9px; align-items: center; padding: 4px 6px; }\n.office-app .person:hover {background: var(--panel-2); }\n.office-app .person.sel {border-color: var(--accent); background: var(--panel-2); }\n.office-app .person img {width: 22px; height: 33px; image-rendering: pixelated; grid-row: span 2; }\n.office-app .person .nm {overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 19px; }\n.office-app .person .nm.live::before {content: \"\"; display: inline-block; width: 6px; height: 6px; border-radius: 50%; background: var(--live); margin-right: 5px; vertical-align: 3px; }\n.office-app .person .ago {color: var(--muted); font-size: 15px; font-variant-numeric: tabular-nums; }\n.office-app .person .st {grid-column: 2 / 4; color: var(--muted); font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.office-app .person .st i {display: inline-block; width: 7px; height: 7px; border-radius: 2px; margin-right: 5px; }\n.office-app .feed {max-height: 230px; overflow-y: auto; display: grid; gap: 0; align-content: start; }\n.office-app .feed .ln {display: grid; grid-template-columns: 70px 16px minmax(60px, 120px) minmax(0, 1fr); gap: 8px; align-items: center; padding: 3px 2px; border-bottom: 1px solid rgba(237, 242, 248, .08); font-size: 17px; }\n.office-app .feed .ln time {color: var(--muted); font-variant-numeric: tabular-nums; }\n.office-app .feed .ln img {width: 16px; height: 24px; image-rendering: pixelated; }\n.office-app .feed .ln b {font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.office-app .feed .ln span {color: #dbe4f1; overflow-wrap: anywhere; }\n.office-app .feed .ln span.say {color: #fff; }\n.office-app .feed .ln span.say::before {content: \"\u201c\"; }\n.office-app .feed .ln span.say::after {content: \"\u201d\"; }\n.office-app .empty {color: var(--muted); }\n@container office (max-width: 560px) {.office-app .feed .ln {grid-template-columns: 58px 14px minmax(0, 1fr); }\n.office-app .feed .ln b {display: none; }\n}\n/* arcade */\n.office-app .games {display: grid; gap: 6px; }\n.office-app .game {font: inherit; color: var(--ink); text-align: left; background: var(--panel-2); border: 1px solid var(--line); border-radius: 5px; padding: 6px 8px; cursor: pointer;\n  display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 8px; align-items: baseline; }\n.office-app .game:hover {border-color: var(--accent); }\n.office-app .game b {font-family: var(--font-display); font-weight: 700; font-size: 14px; }\n.office-app .game em {font-style: normal; color: var(--accent-ink); font-variant-numeric: tabular-nums; font-size: 17px; }\n.office-app .game span {grid-column: 1 / 3; color: var(--muted); font-size: 15px; }\n.office-app .tabs {display: flex; gap: 4px; flex-wrap: wrap; }\n.office-app .tabs button {font: inherit; font-size: 16px; color: var(--muted); background: transparent; border: 1px solid var(--line); border-radius: 4px; padding: 1px 8px; cursor: pointer; }\n.office-app .tabs button[aria-selected=\"true\"] {color: var(--ink); border-color: var(--accent); }\n.office-app .lb {list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }\n.office-app .lb li {display: grid; grid-template-columns: 20px 14px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: 18px; }\n.office-app .lb li .rk {color: var(--muted); font-variant-numeric: tabular-nums; }\n.office-app .lb li img {width: 14px; height: 21px; image-rendering: pixelated; }\n.office-app .lb li .n {overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.office-app .lb li .v {color: var(--accent-ink); font-variant-numeric: tabular-nums; }\n.office-app .lb li.me .n {color: var(--accent-ink); }\n.office-app .arcade {position: fixed; inset: 0; z-index: 50; background: rgba(5, 18, 40, .8); display: flex; align-items: center; justify-content: center; padding-inline: 16px; padding-block: 16px; }\n.office-app .cab {width: min(520px, 100%); max-height: 100%; overflow-y: auto; background: var(--panel); border: 2px solid #081f42; border-radius: 10px; box-shadow: 0 0 0 4px var(--accent), 0 18px 40px rgba(0,0,0,.6); padding: 12px; display: grid; gap: 10px; }\n.office-app .cab header {display: flex; align-items: center; gap: 10px; }\n.office-app .cab h2 {margin: 0; font-family: var(--font-display); font-weight: 800; font-size: 18px; text-transform: uppercase; letter-spacing: .04em; flex: 1; min-width: 0; }\n.office-app .cab #of-ag-score {font-family: var(--font-display); font-weight: 700; color: var(--accent-ink); font-size: 18px; font-variant-numeric: tabular-nums; }\n.office-app #of-agc {width: 100%; height: auto; aspect-ratio: 1; image-rendering: pixelated; background: #081f42; border-radius: 6px; touch-action: none; cursor: pointer; }\n.office-app #of-ag-msg {margin: 0; color: var(--muted); font-size: 18px; min-height: 1.2em; }\n.office-app #of-ag-msg b {color: var(--ink); font-weight: 400; }\n.office-app .pad {display: grid; grid-template-columns: repeat(3, 56px); grid-template-rows: repeat(2, 44px); gap: 6px; justify-content: center; }\n.office-app .pad button {font-family: var(--font-display); font-size: 18px; color: var(--ink); background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; cursor: pointer; touch-action: manipulation; }\n.office-app .pad button:active {background: var(--accent-soft); }\n.office-app .pad .u {grid-column: 2; grid-row: 1; }\n.office-app .pad .l {grid-column: 1; grid-row: 2; }\n.office-app .pad .d {grid-column: 2; grid-row: 2; }\n.office-app .pad .r {grid-column: 3; grid-row: 2; }\n.office-app .pad.flap {grid-template-columns: 1fr; grid-template-rows: 52px; }\n.office-app .pad.flap button {width: 100%; }\n.office-app #of-ag-panel {display: grid; gap: 10px; }\n.office-app .duel-score {display: flex; justify-content: center; gap: 18px; font-family: var(--font-display); font-size: 26px; font-variant-numeric: tabular-nums; }\n.office-app .duel-score span {color: var(--muted); font-size: 15px; font-family: var(--font-body); display: block; text-align: center; }\n.office-app .duel-picks {display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }\n.office-app .duel-picks button {font: inherit; font-size: 18px; color: var(--ink); background: var(--panel-2); border: 1px solid var(--line); border-radius: 8px; padding: 8px 4px; cursor: pointer; display: grid; justify-items: center; gap: 4px; }\n.office-app .duel-picks button img {width: 48px; height: 48px; image-rendering: pixelated; }\n.office-app .duel-picks button[aria-pressed=\"true\"] {border-color: var(--accent); background: var(--accent-soft); }\n.office-app .duel-picks button:disabled {cursor: default; }\n.office-app .duel-picks button:disabled:not([aria-pressed=\"true\"]) {opacity: .45; }\n.office-app .reveal {text-align: center; font-size: 20px; min-height: 1.3em; }\n.office-app .opps {display: grid; gap: 4px; }\n.office-app .opps .person {grid-template-columns: 22px minmax(0, 1fr) auto; }\n.office-app .toasts {position: fixed; left: 50%; bottom: calc(16px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 60; display: grid; gap: 8px; width: min(420px, calc(100% - 32px)); }\n.office-app .toast {background: var(--panel); border: 2px solid var(--accent); border-radius: 8px; padding: 10px 12px; display: grid; gap: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.5); }\n\n/* Hub page integration */\n.office-app .clockrow { display: flex; flex-wrap: wrap; gap: 6px; }\n.office-app .shiftline { font-size: 16px; color: var(--muted); }\n.office-app .shiftline b { color: var(--ink); font-weight: 400; }\n.office-app .pick small { color: var(--muted); }\n\n/* the Hub has no global [hidden] reset; the Office relies on it */\n.office-app [hidden] { display: none !important; }\n/* the Hub colours headings navy; on the Office's navy panels they need the light ink */\n.office-app h1, .office-app h2, .office-app h3 { color: var(--ink); letter-spacing: normal; }\n.office-app .group h3 { color: var(--muted); }\n\n/* Deadline Race */\n.office-app .race h2 .race-day { color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; }\n.office-app .race-note { color: var(--muted); font-size: 16px; }\n.office-app .race-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }\n.office-app .race-list li.row-r { display: grid; grid-template-columns: 30px minmax(110px, 170px) minmax(0, 1fr) minmax(86px, auto); gap: 4px 10px; align-items: center; padding: 6px 8px; background: var(--panel-2); border: 1px solid var(--line); border-radius: 6px; }\n.office-app .race-list li.row-r.me { border-color: var(--accent); }\n.office-app .medal { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; font-family: var(--font-display); font-weight: 800; font-size: 13px; color: #081f42; background: #b8c7de; box-shadow: inset 0 -2px 0 rgba(0,0,0,.25); }\n.office-app .medal.g1 { background: #f2c94c; } .office-app .medal.g2 { background: #d5dbe3; } .office-app .medal.g3 { background: #d08a4a; }\n.office-app .rname { min-width: 0; }\n.office-app .rname b { display: block; font-weight: 400; font-size: 19px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.office-app .rname span { display: block; color: var(--muted); font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.office-app .race-list canvas { width: 100%; height: auto; image-rendering: pixelated; border-radius: 4px; display: block; }\n.office-app .rstat { text-align: right; font-variant-numeric: tabular-nums; line-height: 1.1; }\n.office-app .rstat b { display: block; font-weight: 400; font-size: 18px; }\n.office-app .rstat span { font-size: 15px; color: var(--muted); }\n.office-app .rstat .ahead { color: var(--live); } .office-app .rstat .behind { color: var(--danger); }\n@container office (max-width: 560px) { .office-app .race-list li.row-r { grid-template-columns: 30px minmax(0, 1fr) auto; } .office-app .race-list li.row-r canvas { grid-column: 1 / -1; grid-row: 2; } }\n\n/* Type Race */\n.office-app .tr-count { text-align: center; font-family: var(--font-display); font-weight: 800; font-size: 40px; color: var(--accent-ink); min-height: 1.1em; }\n.office-app .tr-phrase { font-size: 22px; line-height: 1.35; background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 10px 12px; overflow-wrap: anywhere; }\n.office-app .tr-phrase .ok { color: #4ade80; }\n.office-app .tr-phrase .cur { background: var(--accent); color: #fff; }\n.office-app .tr-phrase .rest { color: var(--muted); }\n.office-app .tr-input { font: inherit; font-size: 22px; width: 100%; color: var(--ink); background: var(--bg); border: 2px solid var(--line); border-radius: 6px; padding: 8px 10px; }\n.office-app .tr-input.bad { border-color: var(--danger); background: rgba(203, 37, 43, .18); }\n.office-app .tr-rows { display: grid; gap: 4px; }\n.office-app .tr-row { display: grid; grid-template-columns: minmax(60px, 90px) minmax(0, 1fr) minmax(90px, auto); gap: 8px; align-items: center; }\n.office-app .tr-row b { font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.office-app .tr-row.me b { color: var(--accent-ink); }\n.office-app .tr-row canvas { width: 100%; height: auto; image-rendering: pixelated; border-radius: 4px; }\n.office-app .tr-stat { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }\n";
const OFFICE_HTML = "<div class=\"wrap\">\n  <header class=\"hud\">\n        <div class=\"stat\"><b id=\"of-s-in\">0</b><span>in office</span></div>\n    <div class=\"stat\"><b id=\"of-s-meet\">0</b><span>in meetings</span></div>\n    <div class=\"stat\"><b id=\"of-s-break\">0</b><span>on break</span></div>\n    <div class=\"stat\"><b id=\"of-s-out\">0</b><span>out of office</span></div>\n    <div class=\"stat live\"><b id=\"of-s-live\">0</b><span>here now</span></div>\n    \n  </header>\n\n  <div class=\"main\">\n    <section class=\"mapcol\" aria-label=\"Office\">\n      <div class=\"screen\">\n        <canvas id=\"of-office\" width=\"688\" height=\"304\" tabindex=\"0\" role=\"img\" aria-label=\"Pixel office map. Click the floor to walk your character there; arrow keys also move.\"></canvas>\n        <div class=\"overlay\" id=\"of-overlay\"></div>\n      </div>\n      <div class=\"banner\" id=\"of-banner\" hidden></div>\n      <form class=\"chatbar\" id=\"of-chatform\" autocomplete=\"off\">\n        <input id=\"of-say\" type=\"text\" maxlength=\"120\" placeholder=\"Say something\u2026 (press Enter)\" aria-label=\"Say something\">\n        <button class=\"btn primary\" type=\"submit\" id=\"of-saybtn\">Say</button>\n      </form>\n      <div class=\"hint\">Click the floor to walk. Arrow keys or WASD work when the map is focused. Your character follows your Hub clock and your In Progress task.</div>\n      <section class=\"card\" aria-labelledby=\"of-h-feed\">\n        <h2 id=\"of-h-feed\">Activity</h2>\n        <div class=\"feed\" id=\"of-feed\"><div class=\"empty\">Nothing yet. Status changes, chat and room moves show up here.</div></div>\n      </section>\n      <section class=\"card race\" aria-labelledby=\"of-h-race\">\n        <h2 id=\"of-h-race\">Deadline Race <span class=\"race-day\" id=\"of-race-day\">\u00b7 today</span></h2>\n        <div class=\"race-note\">Everyone with time blocks today. The runner shows how much of their blocked time is done; the white flag is where their schedule says they should be. Finishing ahead of your deadlines puts you in front.</div>\n        <ol class=\"race-list\" id=\"of-race\"><li class=\"empty\">Loading the race\u2026</li></ol>\n      </section>\n    </section>\n\n    <aside class=\"side\">\n      <section class=\"card\" aria-labelledby=\"of-h-me\">\n        <h2 id=\"of-h-me\">You</h2>\n        <div class=\"me-row\" id=\"of-merow\"><img id=\"of-meimg\" alt=\"\"><div><strong id=\"of-mename\">Connecting\u2026</strong><span id=\"of-mesub\"></span></div></div>\n        <div class=\"picks\" id=\"of-picks\" role=\"group\" aria-label=\"Status\"></div>\n        <div class=\"shiftline\" id=\"of-shiftline\"></div>\n        <div class=\"clockrow\" id=\"of-clockrow\"></div>\n        <label class=\"lbl\" for=\"of-note\">Note (optional, shows instead of your Hub task)\n          <input id=\"of-note\" type=\"text\" maxlength=\"80\" placeholder=\"e.g. Calling sellers, showing 88 Elm St\">\n        </label>\n        <div class=\"chips\" id=\"of-chips\" aria-label=\"Quick tasks\"></div>\n        <div class=\"detect\" id=\"of-detect\"></div>\n        <div class=\"row\">\n          <button class=\"btn primary\" id=\"of-save\" type=\"button\">Save</button>\n        </div>\n        <div class=\"msg\" id=\"of-msg\" role=\"status\"></div>\n        <details class=\"editor\" id=\"of-editor\">\n          <summary>Customize character</summary>\n          <div class=\"edit-body\">\n            <canvas id=\"of-preview\" width=\"48\" height=\"16\" aria-label=\"Character preview from four sides\"></canvas>\n            <div id=\"of-optrows\"></div>\n            <div class=\"row\">\n              <button class=\"btn primary\" id=\"of-savelook\" type=\"button\">Save character</button>\n              <button class=\"btn ghost\" id=\"of-randlook\" type=\"button\">Shuffle</button>\n            </div>\n          </div>\n        </details>\n      </section>\n\n      <section class=\"card\" aria-labelledby=\"of-h-arcade\">\n        <h2 id=\"of-h-arcade\">Arcade <span style=\"color:var(--muted);font-weight:500\">\u00b7 Break room</span></h2>\n        <div class=\"games\" id=\"of-games\"></div>\n        <div class=\"tabs\" id=\"of-lbtabs\" role=\"tablist\" aria-label=\"Leaderboard\"></div>\n        <ol class=\"lb\" id=\"of-lb\"></ol>\n      </section>\n\n      <section class=\"card\" aria-labelledby=\"of-h-roster\">\n        <h2 id=\"of-h-roster\">Who's where</h2>\n        <div id=\"of-roster\"></div>\n      </section>\n    </aside>\n  </div>\n</div>\n\n<div class=\"arcade\" id=\"of-arcade\" hidden role=\"dialog\" aria-modal=\"true\" aria-labelledby=\"of-ag-title\">\n  <div class=\"cab\">\n    <header><h2 id=\"of-ag-title\">Arcade</h2><span id=\"of-ag-score\"></span><button class=\"btn ghost\" id=\"of-ag-close\" type=\"button\">Close</button></header>\n    <canvas id=\"of-agc\" width=\"240\" height=\"240\" tabindex=\"0\" aria-label=\"Game screen\"></canvas>\n    <div id=\"of-ag-panel\" hidden></div>\n    <p id=\"of-ag-msg\" role=\"status\"></p>\n    <div class=\"pad\" id=\"of-ag-pad\"></div>\n  </div>\n</div>\n<div class=\"toasts\" id=\"of-toasts\" aria-live=\"polite\"></div>";

// eslint-disable-next-line no-unused-vars
async function pageOffice(page) {
  setTitle('Office', 'Where everyone is and what they’re working on');
  if (!document.getElementById('office-css')) {
    const st = document.createElement('style'); st.id = 'office-css'; st.textContent = OFFICE_CSS; document.head.appendChild(st);
  }
  page.innerHTML = '<div class="office-app" id="of-root">' + OFFICE_HTML + '</div>';

  // ================= Hub bridge =================
  // The office game was first written against claude.ai's storage/presence API. This small adapter gives it the
  // same shape backed by the Hub: /api/office/state is polled every second for people, positions, chat and duels.
  const HUB = (() => {
    let last = null, seq = 0, timer = null, stopped = false, first = true;
    const subs = { desks: [], scores: [], config: [], peers: [], say: [], duel: [], type: [] };
    const pres = { x: null, y: null, g: null }; let presTimer = null;
    const statusOf = (p) => p.shift === 'off' ? 'out' : p.shift === 'lunch' ? 'lunch' : p.shift === 'break' ? 'break'
      : p.mode === 'meeting' ? 'meeting' : p.mode === 'social' ? 'social' : (p.note || p.task) ? 'focus' : 'available';
    function deliver(kind) {
      if (!last || stopped) return;
      const s = last;
      if (kind === 'desks' || !kind) { const docs = s.people.map((p) => ({ id: p.id, exists: true, data: () => ({ status: statusOf(p), note: p.note || (p.task ? p.task.title : ''), updatedAt: Date.now(), joinedAt: p.id, look: p.look, hub: p }) })); subs.desks.forEach((f) => f({ docs })); }
      if (kind === 'scores' || !kind) { const docs = Object.entries(s.scores).map(([id, v]) => ({ id: Number(id), exists: true, data: () => v })); subs.scores.forEach((f) => f({ docs })); }
      if (kind === 'config' || !kind) subs.config.forEach((f) => f({ exists: true, data: () => ({ ownerId: s.owner_id, execIds: s.exec_ids || [] }) }));
      if (kind === 'peers' || !kind) { const peers = s.people.filter((p) => p.pos).map((p) => ({ kind: 'viewer', isMe: p.id === s.me, sameTab: p.id === s.me, by: p.id, peer: 'u' + p.id, guest: false, presence: p.pos })); subs.peers.forEach((f) => f({ peers, joined: [], left: [], updated: [] })); }
    }
    async function poll() {
      if (stopped) return;
      clearTimeout(timer);
      try {
        const s = await api('GET', '/api/office/state?since=' + seq);
        if (stopped) return;
        last = s; deliver();
        if (!first) {
          for (const e of s.events) {
            if (e.kind === 'type') subs.type.forEach((f) => f(e, s.me));
            else if (e.uid !== s.me) subs.say.forEach((f) => f({ by: e.uid, isMe: false, data: { text: e.text } }));
          }
          for (const m of s.inbox) subs.duel.forEach((f) => f({ by: m.from, isMe: false, data: { ...m.data, to: s.me } }));
        }
        first = false; seq = Math.max(seq, s.seq || 0);
      } catch (_) { /* network hiccup: try again on the next tick */ }
      if (!stopped) timer = setTimeout(poll, document.hidden ? 5000 : 1000);
    }
    const sub = (k, f) => { subs[k].push(f); deliver(k); return () => {}; };
    const db = {
      collection: (path) => ({ onSnapshot: (f) => sub(path === 'scores' ? 'scores' : 'desks', f) }),
      doc: () => ({ onSnapshot: (f) => sub('config', f), set: async () => {} }),
    };
    const user = {
      id: async () => S.me.id, can: async () => true, isOwner: async () => !!last && last.owner_id === S.me.id,
      profiles: async (ids) => Object.fromEntries([].concat(ids).map((id) => [id, { id, name: (last && last.people.find((p) => p.id === id) || {}).name || '' }])),
    };
    const room = {
      presence: (patch) => {
        Object.assign(pres, patch);
        if (pres.x == null || stopped) return Promise.resolve();
        if (!presTimer) presTimer = setTimeout(() => { presTimer = null; if (!stopped) api('POST', '/api/office/move', { x: pres.x, y: pres.y, g: pres.g }).catch(() => {}); }, 150);
        return Promise.resolve();
      },
      emit: (topic, data) => topic === 'say' ? api('POST', '/api/office/say', { text: data.text }) : api('POST', '/api/office/duel', data),
      on: (topic, f) => { (subs[topic] || (subs[topic] = [])).push(f); return () => {}; },
      onPeers: (f) => sub('peers', f),
    };
    setTimeout(poll, 0);
    return {
      use: async (name) => ({ db, user, room }[name] || null),
      refresh: () => poll(),
      stop: () => { stopped = true; clearTimeout(timer); clearTimeout(presTimer); api('POST', '/api/office/move', { leave: true }).catch(() => {}); },
    };
  })();

  // ================= constants =================
  const TS = 8, MW = 86, MH = 38, W = MW * TS, H = MH * TS;
  const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById('of-' + id);
  const cv = $('office'), ctx = cv.getContext('2d');
  const root = $('root');
  ctx.imageSmoothingEnabled = false;
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  let NOW = performance.now();

  const STATUSES = {
    focus:     { label: 'Heads down',     room: 'Data Room',         color: '#7fe0ff' },
    available: { label: 'Available',      room: 'Data Room',         color: '#9be36b' },
    meeting:   { label: 'In a meeting',   room: 'Meeting room',      color: '#c792ff' },
    social:    { label: 'Making content', room: 'Social Media room', color: '#ff6fb5' },
    break:     { label: 'On break',       room: 'Break room',        color: '#ffb44c' },
    lunch:     { label: 'At lunch',       room: 'Lunch room',        color: '#ff8a7a' },
    out:       { label: 'Off shift',      room: 'Parking lot',       color: '#8a80a0' },
    visiting:  { label: 'Just looking',   room: 'Hallway',           color: '#d6cfe3' },
  };
  const PICKS = ['focus', 'meeting', 'social'];
  const PICK_TEXT = { focus: ['Working', 'Hub task decides'], meeting: ['In a meeting', 'Meeting room'], social: ['Making content', 'Social Media room'] };
  // What people type in "What are you working on?" decides where they go and what they do.
  // Checked in order; the first match wins.
  const TASKS = [
    // scheduling is desk work even when it mentions showings or appointments, so it is checked first
    { id: 'mail',    label: 'Scheduling',        room: 'desk',    does: 'handles scheduling in the Ops Assistant Office', words: ['schedul', 'calendar', 'booking', 'book a', 'reschedul', 'confirm the appointment', 'confirming appointments'] },
    { id: 'field',   label: 'In the field',      room: 'field',   does: 'drives out to the property',          words: ['showing', 'walkthrough', 'walk-through', 'walk through', 'site visit', 'property visit', 'driving', 'drive to', 'inspection', 'appraisal', 'in the field', 'door knock', 'knocking doors', 'photos at', 'meeting a seller', 'meeting the seller', 'seller appointment', 'appointment', 'at the property', 'closing table', 'd4d', 'driving for dollars'] },
    { id: 'meeting', label: 'In a meeting',      room: 'meeting', does: 'heads to the meeting room',           words: ['meeting', 'sync', 'standup', 'stand-up', 'huddle', 'interview', 'training', '1:1', 'one on one', 'one-on-one', 'zoom', 'team call', 'review with'] },
    { id: 'call',    label: 'On the phone',      room: 'desk',    does: 'gets on the phone at the desk',       words: ['call', 'dial', 'phone', 'follow up', 'follow-up', 'followup', 'voicemail', 'negotiat', 'talking to', 'speaking with'] },
    { id: 'paper',   label: 'Doing paperwork',   room: 'desk',    does: 'stamps contracts at the desk',        words: ['contract', 'offer', 'paperwork', 'docs', 'document', 'sign', 'closing', 'title', 'escrow', 'assignment', 'purchase agreement', 'psa', 'loi', 'addendum', 'disclosure', 'emd'] },
    { id: 'mail',    label: 'Messaging',         room: 'desk',    does: 'answers messages in the Ops Assistant Office', words: ['schedul', 'calendar', 'admin', 'data entry', 'filing', 'organiz', 'email', 'e-mail', 'inbox', 'text', 'sms', 'ghl', 'gohighlevel', 'high level', 'campaign', 'newsletter', 'message', 'dm', 'replying', 'respond'] },
    { id: 'data',    label: 'Crunching numbers', room: 'desk',    does: 'crunches numbers at the desk',        words: ['comp', 'arv', 'number', 'spreadsheet', 'report', 'data', 'crm', 'lead', 'skip trac', 'list', 'underwrit', 'analy', 'budget', 'bookkeep', 'invoice', 'payroll', 'pipeline', 'repair estimate', 'rehab', 'zillow', 'propstream', 'mls', 'deal analysis'] },
    { id: 'content', label: 'Making content',    room: 'social',  does: 'films in the Social Media room',      words: ['instagram', 'insta', 'tiktok', 'reel', 'post', 'content', 'film', 'video', 'youtube', 'facebook', 'social', 'story', 'stories', 'photo', 'marketing', 'shoot', 'livestream', 'podcast'] },
    { id: 'design',  label: 'Designing',         room: 'social',  does: 'paints at the easel',                 words: ['design', 'canva', 'logo', 'flyer', 'graphic', 'thumbnail', 'paint', 'brochure', 'mailer', 'postcard', 'branding', 'banner'] },
    { id: 'lunch',   label: 'At lunch',          room: 'lunch',   does: 'eats in the Lunch room',              words: ['lunch', 'eating', 'food', 'dinner', 'breakfast', 'brunch'] },
    { id: 'break',   label: 'On break',          room: 'break',   does: 'takes a break',                       words: ['break', 'coffee', 'snack', 'nap', 'stretch', 'breather', 'recharg'] },
  ];
  TASKS.forEach((t) => { t.re = new RegExp('(^|[^a-z0-9])(' + t.words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i'); });
  const taskCache = new Map();
  const detectTask = (note) => {
    const n = String(note || '').toLowerCase().trim(); if (!n) return null;
    if (!taskCache.has(n)) taskCache.set(n, TASKS.find((t) => t.re.test(n)) || null);
    return taskCache.get(n);
  };
  const DESK_STATUSES = ['focus', 'available', 'social'];
  const STALE_MS = 12 * 3600 * 1000;

  const LOOKS = {
    skin: ['#f1c7a5', '#e0a983', '#c68863', '#a0674a', '#7a4b33', '#5a3726'],
    hairStyle: ['Short', 'Long', 'Bun', 'Buzz', 'Curly'],
    hair: ['#2b1d16', '#5b3a22', '#a8642c', '#d9b25f', '#1f1f2e', '#8e3b46', '#c9c2b8', '#e86a92'],
    shirt: ['#e86a92', '#5aa9e6', '#f2c14e', '#7bd389', '#b48cf2', '#f08a4b', '#4ecdc4', '#e5e5e5', '#CB252B', '#0C2E60'],
    pants: ['#2c2a3a', '#3b5b8c', '#6b4f3a', '#5a5a66', '#8a7a5a'],
    acc: ['None', 'Glasses', 'Cap', 'Headphones'],
  };
  const LOOK_KEYS = ['skin', 'hairStyle', 'hair', 'shirt', 'pants', 'acc'];
  const LOOK_LABEL = { skin: 'Skin', hairStyle: 'Hair', hair: 'Hair color', shirt: 'Top', pants: 'Bottoms', acc: 'Extra' };
  const CAR_COLORS = ['#CB252B', '#0C2E60', '#f4f7fb', '#9aa3ad', '#1B4BA8', '#2b2b33', '#e03a40', '#143b75', '#c9d6e8', '#081f42'];

  const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  const defaultLook = (id) => { const h = hash(id); const o = {}; LOOK_KEYS.forEach((k, i) => { o[k] = (h >>> (i * 4)) % LOOKS[k].length; }); if (o.acc === 3 && h % 3) o.acc = 0; return o; };
  const parseLook = (v, id) => { const d = defaultLook(id); if (!v || typeof v !== 'object') return d; const o = {}; for (const k of LOOK_KEYS) { const n = Number(v[k]); o[k] = Number.isInteger(n) && n >= 0 && n < LOOKS[k].length ? n : d[k]; } return o; };

  // ================= tiny pixel font (3x5) =================
  const FONT = {
    '!': '010010010000010', '?': '111001011000010', '#': '101111101111101', '@': '111101111100111', '%': '101001010100101',
    '&': '010101010101011', '*': '000101010101000', '$': '011110010011110', '.': '000000000000010', '_': '000000000000111',
    A: '010101111101101', B: '110101110101110', C: '111100100100111', D: '110101101101110', E: '111100110100111', F: '111100110100100',
    G: '111100101101111', H: '101101111101101', I: '111010010010111', K: '101110100110101', L: '100100100100111', M: '101111111101101',
    N: '111101101101101', O: '111101101101111', P: '110101110100100', R: '110101110101101', S: '111100111001111', T: '111010010010010',
    U: '101101101101111', V: '101101101101010', W: '101101101111101', X: '101101010101101', Y: '101101010010010', Z: '111001010100111',
  };
  function ptext(str, x, y, col) {
    let cx = x;
    for (const ch of str) { const g = FONT[ch]; if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') R(cx + (i % 3), y + ((i / 3) | 0), 1, 1, col); cx += 4; }
  }
  function wordBubble(cx, bottom, str, col) {
    const w = str.length * 4 + 3, x = Math.round(cx - w / 2), y = Math.round(bottom - 11);
    R(x - 1, y - 1, w + 2, 11, '#000'); R(x, y, w, 9, '#fff');
    R(Math.round(cx) - 1, y + 9, 3, 1, '#fff'); R(Math.round(cx) - 2, y + 9, 1, 1, '#000'); R(Math.round(cx) + 2, y + 9, 1, 1, '#000'); R(Math.round(cx), y + 10, 1, 1, '#000');
    ptext(str, x + 2, y + 2, col);
  }

  // ================= particles =================
  const parts = [];
  const chance = (perSec, dt) => !RM && Math.random() < perSec * dt;
  function spawn(x, y, vx, vy, life, col, g = 60, shape = 'px') { if (parts.length < 500) parts.push({ x, y, vx, vy, life, col, g, shape }); }
  function stepParts(dt) {
    for (let i = parts.length - 1; i >= 0; i--) { const p = parts[i]; p.life -= dt; if (p.life <= 0) { parts.splice(i, 1); continue; } p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  }
  function drawParts() {
    for (const p of parts) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (p.shape === 'heart') { R(x, y, 1, 1, p.col); R(x + 2, y, 1, 1, p.col); R(x, y + 1, 3, 1, p.col); R(x + 1, y + 2, 1, 1, p.col); }
      else if (p.shape === 'note') { R(x + 1, y, 1, 3, p.col); R(x + 2, y, 1, 1, p.col); R(x, y + 2, 2, 1, p.col); }
      else if (p.shape === 'big') R(x, y, 2, 2, p.col);
      else if (p.shape === 'mail') { R(x, y, 6, 4, '#ffffff'); R(x, y, 6, 1, '#0C2E60'); R(x + 1, y + 1, 1, 1, '#0C2E60'); R(x + 4, y + 1, 1, 1, '#0C2E60'); R(x + 2, y + 2, 2, 1, '#0C2E60'); }
      else if (p.shape === 'house') { R(x + 2, y, 3, 1, '#0C2E60'); R(x + 1, y + 1, 5, 1, '#0C2E60'); R(x, y + 2, 7, 1, '#0C2E60'); R(x + 1, y + 3, 5, 3, '#EDF2F8'); R(x + 3, y + 4, 1, 2, '#CB252B'); }
      else if (p.shape === 'glyph') ptext(p.col.t, x, y, p.col.c);
      else R(x, y, 1, 1, p.col);
    }
  }

  // ================= map =================
  const idx = (x, y) => y * MW + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
  const SOLID = new Uint8Array(MW * MH), WALL = new Uint8Array(MW * MH);
  const FLOOR = new Array(MW * MH).fill('grass');
  const SEATS = new Map(); // idx -> facing
  const rect = (x0, y0, x1, y1, fn) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (inb(x, y)) fn(idx(x, y), x, y); };
  const floor = (x0, y0, x1, y1, f) => rect(x0, y0, x1, y1, (i) => { FLOOR[i] = f; });
  const solid = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, (i) => { SOLID[i] = 1; });
  const wall = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, (i) => { WALL[i] = 1; SOLID[i] = 1; });
  const gap = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, (i) => { WALL[i] = 0; SOLID[i] = 0; FLOOR[i] = 'hall'; });
  const seat = (x, y, dir) => SEATS.set(idx(x, y), dir);

  const ZONES = [
    { id: 'social',  name: 'Social Media room', x0: 5,  y0: 4,  x1: 20, y1: 13, floor: 'studio' },
    { id: 'lunch',   name: 'Lunch room',        x0: 22, y0: 4,  x1: 37, y1: 13, floor: 'checker' },
    { id: 'meeting', name: 'Meeting room',      x0: 39, y0: 4,  x1: 54, y1: 13, floor: 'carpet' },
    { id: 'hall',    name: 'Hallway',           x0: 5,  y0: 15, x1: 82, y1: 17, floor: 'hall' },
    { id: 'exec',    name: 'Executive Office',  x0: 56, y0: 4,  x1: 68, y1: 13, floor: 'exec' },
    { id: 'exec2',   name: 'Executive Office 2', x0: 70, y0: 4, x1: 82, y1: 13, floor: 'exec' },
    { id: 'ops',     name: 'Ops Assistant Office', x0: 56, y0: 19, x1: 82, y1: 28, floor: 'ops' },
    { id: 'data',    name: 'Data Room',         x0: 5,  y0: 19, x1: 29, y1: 28, floor: 'data' },
    { id: 'break',   name: 'Break room',        x0: 31, y0: 19, x1: 54, y1: 28, floor: 'break' },
    { id: 'parking', name: 'Parking lot',       x0: 0,  y0: 31, x1: 85, y1: 36, floor: 'asphalt' },
  ];
  const zoneAt = (x, y) => ZONES.find((z) => x >= z.x0 && x <= z.x1 && y >= z.y0 && y <= z.y1) || { id: 'outside', name: 'Outside' };

  floor(1, 15, 3, 30, 'path');
  ZONES.forEach((z) => floor(z.x0, z.y0, z.x1, z.y1, z.floor));
  wall(4, 3, 83, 3); wall(4, 29, 83, 29); wall(4, 3, 4, 29); wall(83, 3, 83, 29);
  wall(55, 4, 55, 13); wall(55, 19, 55, 29); wall(69, 4, 69, 13);
  wall(5, 14, 82, 14); wall(5, 18, 82, 18);
  wall(21, 4, 21, 13); wall(38, 4, 38, 13); wall(30, 19, 30, 28);
  gap(4, 15, 4, 17);
  gap(12, 14, 13, 14); gap(29, 14, 30, 14); gap(46, 14, 47, 14); gap(61, 14, 62, 14); gap(75, 14, 76, 14);
  gap(16, 18, 17, 18); gap(36, 18, 37, 18); gap(49, 18, 50, 18); gap(68, 18, 69, 18);
  const STALLS = []; for (let x = 6; x <= 78; x += 2) STALLS.push(x);
  const DOOR_Y = 34;

  // ================= furniture (depth-sorted objects) =================
  const FURN = [];
  const add = (x, y, w, h, isSolid, draw, z) => { if (isSolid) solid(x, y, x + w - 1, y + h - 1); FURN.push({ z: z ?? (y + h) * TS, draw }); };
  const plant = (x, y) => add(x, y, 1, 1, true, () => {
    const X = x * TS, Y = y * TS;
    R(X + 2, Y + 3, 4, 5, '#c0603a'); R(X + 2, Y + 3, 4, 1, '#d97a52');
    R(X + 1, Y - 4, 6, 7, '#3f8f4f'); R(X, Y - 2, 2, 3, '#2f6e3c'); R(X + 6, Y - 2, 2, 3, '#2f6e3c'); R(X + 3, Y - 6, 2, 3, '#57a862');
  });
  const chair = (x, y, dir, col = '#0C2E60') => add(x, y, 1, 1, false, () => {
    const X = x * TS, Y = y * TS;
    if (dir === 'down') { R(X + 1, Y - 3, 6, 4, col); R(X + 1, Y + 1, 6, 4, '#1B4BA8'); }
    else { R(X + 1, Y + 2, 6, 4, '#1B4BA8'); R(X + 1, Y + 5, 6, 3, col); }
  }, y * TS + 1);
  const anyoneIn = (zid) => { for (const c of chars.values()) if (c.zone === zid && !c.path.length) return true; return false; };

  // --- Social Media room
  add(8, 4, 7, 1, true, () => {
    R(64, 16, 56, 24, '#0C2E60'); for (let k = 0; k < 6; k++) R(64, 18 + k * 4, 56, 2, '#143b75'); R(64, 38, 56, 2, '#081f42');
    const live = anyoneIn('social'), on = live && Math.floor(NOW / 600) % 2 === 0;
    R(82, 18, 19, 9, '#000'); R(83, 19, 17, 7, '#2b2b33'); ptext('LIVE', 84, 20, on ? '#ff4d6d' : (live ? '#a03050' : '#5a4a5a'));
  });
  const ringLight = (x, y) => add(x, y, 1, 1, true, () => {
    const X = x * TS, Y = y * TS, on = anyoneIn('social');
    R(X + 3, Y - 6, 2, 13, '#0C2E60'); R(X + 1, Y + 6, 6, 2, '#0C2E60');
    if (on) { ctx.fillStyle = 'rgba(255,247,224,.22)'; ctx.fillRect(X - 6, Y - 20, 20, 18); }
    R(X - 1, Y - 18, 10, 2, '#fff7e0'); R(X - 1, Y - 8, 10, 2, '#fff7e0'); R(X - 2, Y - 16, 2, 8, '#fff7e0'); R(X + 8, Y - 16, 2, 8, '#fff7e0');
  });
  ringLight(7, 5); ringLight(15, 5);
  add(11, 10, 1, 1, true, () => { const X = 88, Y = 80;
    R(X + 1, Y + 1, 1, 7, '#2b2b33'); R(X + 6, Y + 1, 1, 7, '#2b2b33'); R(X + 3, Y - 1, 2, 9, '#2b2b33');
    R(X, Y - 6, 8, 6, '#1d1626'); R(X + 2, Y - 8, 4, 2, '#0C2E60'); R(X + 6, Y - 5, 1, 1, Math.floor(NOW / 500) % 2 ? '#ff3b3b' : '#5a1a1a'); });
  add(8, 11, 1, 1, true, () => { const X = 64, Y = 88;
    R(X + 3, Y - 4, 2, 12, '#2b2b33'); R(X + 1, Y + 6, 6, 2, '#2b2b33'); R(X + 1, Y - 11, 6, 8, '#1d1626'); R(X + 2, Y - 10, 4, 6, anyoneIn('social') ? '#ff6fb5' : '#0C2E60'); });
  const easel = (x, y, seed) => add(x, y, 1, 1, true, () => {
    const X = x * TS, Y = y * TS;
    R(X + 1, Y - 3, 1, 11, '#8a5c3b'); R(X + 6, Y - 3, 1, 11, '#8a5c3b'); R(X + 3, Y - 5, 2, 13, '#8a5c3b');
    R(X - 1, Y - 13, 10, 10, '#fbf8f0'); R(X - 1, Y - 4, 10, 1, '#8a5c3b');
    const n = RM ? 18 : Math.floor((NOW / 450 + seed * 7) % 40);
    const pal = ['#e86a92', '#5aa9e6', '#f2c14e', '#7bd389', '#b48cf2', '#f08a4b'];
    for (let k = 0; k < n; k++) { const h = hash(seed * 100 + k); R(X + (h % 8), Y - 12 + ((h >> 4) % 8), 1 + ((h >> 8) % 2), 1, pal[(h >> 10) % pal.length]); }
  });
  easel(17, 8, 1); easel(19, 11, 2);
  plant(5, 4); plant(5, 13); plant(20, 4);

  // --- Lunch room
  const FOOD = [
    (x, y) => { R(x, y + 1, 6, 4, '#f2c14e'); R(x + 1, y, 4, 6, '#f2c14e'); R(x + 1, y + 2, 1, 1, '#d94a4a'); R(x + 4, y + 1, 1, 1, '#d94a4a'); R(x + 3, y + 4, 1, 1, '#d94a4a'); }, // pizza
    (x, y) => { R(x, y, 6, 2, '#c98a3c'); R(x, y + 2, 6, 1, '#7bd389'); R(x, y + 3, 6, 1, '#6b3a22'); R(x, y + 4, 6, 1, '#c98a3c'); }, // burger
    (x, y) => { R(x + 1, y + 1, 4, 3, '#a8642c'); R(x + 4, y + 3, 2, 1, '#f1e8da'); R(x + 5, y + 4, 1, 1, '#f1e8da'); }, // drumstick
    (x, y) => { R(x, y + 1, 6, 4, '#f6f3ee'); R(x, y + 1, 6, 1, '#e86a92'); R(x + 2, y, 1, 1, '#d94a4a'); }, // cake
    (x, y) => { R(x, y + 2, 6, 3, '#e5e5e5'); R(x + 1, y + 1, 4, 2, '#f08a4b'); }, // bowl
    (x, y) => { R(x, y + 2, 2, 2, '#f6f3ee'); R(x + 2, y + 2, 2, 2, '#f08a4b'); R(x + 4, y + 2, 2, 2, '#f6f3ee'); R(x, y + 4, 6, 1, '#2b2b33'); }, // sushi
    (x, y) => { R(x, y + 1, 6, 4, '#3f8f4f'); R(x + 1, y + 1, 4, 3, '#ff6f7a'); R(x + 2, y + 2, 1, 1, '#1d1626'); }, // watermelon
    (x, y) => { R(x + 1, y + 2, 4, 3, '#d94a4a'); R(x + 1, y, 1, 2, '#f2c14e'); R(x + 3, y, 1, 2, '#f2c14e'); R(x + 2, y + 1, 1, 1, '#f2c14e'); }, // fries
  ];
  add(22, 4, 11, 2, true, () => { const X = 176, Y = 32;
    R(X, Y - 4, 88, 8, '#efe9df'); R(X, Y + 4, 88, 12, '#8c9bb0'); R(X, Y + 4, 88, 1, '#6f7d92');
    for (let i = 0; i < 11; i++) R(X + i * 8 + 3, Y + 8, 2, 1, '#dfe5ee');
    for (let i = 0; i < 10; i++) FOOD[(i * 3) % FOOD.length](X + 2 + i * 8 + 1, Y - 4);
    if (!RM && Math.floor(NOW / 300) % 2) { R(X + 20, Y - 8, 1, 2, 'rgba(255,255,255,.7)'); R(X + 52, Y - 9, 1, 2, 'rgba(255,255,255,.7)'); } });
  add(35, 4, 2, 2, true, () => { R(280, 22, 16, 26, '#e5e5e5'); R(280, 34, 16, 1, '#b8b8b8'); R(292, 26, 2, 5, '#9aa3ad'); R(292, 37, 2, 8, '#9aa3ad'); R(280, 47, 16, 1, '#b8b8b8'); });
  add(24, 8, 12, 2, true, () => { R(192, 61, 96, 15, '#efe9df'); R(192, 74, 96, 3, '#c4bdac');
    for (let i = 0; i < 12; i++) { FOOD[i % FOOD.length](193 + i * 8, 62); FOOD[(i + 4) % FOOD.length](193 + i * 8, 68); } });
  for (let x = 24; x <= 35; x++) { seat(x, 7, 'down'); chair(x, 7, 'down', '#CB252B'); seat(x, 10, 'up'); chair(x, 10, 'up', '#CB252B'); }
  add(36, 11, 1, 2, true, () => { R(287, 80, 10, 24, '#d94a4a'); R(289, 83, 6, 10, '#2b2b33'); R(290, 85, 1, 1, '#f2c14e'); R(292, 87, 1, 1, '#7bd389'); R(290, 96, 4, 3, '#2b2b33'); });
  plant(22, 13); plant(37, 8);

  // --- Meeting room
  add(41, 4, 5, 1, true, () => { R(328, 26, 40, 12, '#f6f3ee'); R(328, 26, 40, 1, '#9aa3ad'); ptext('NO!', 331, 29, '#d94a4a'); R(346, 30, 8, 1, '#d94a4a'); R(347, 32, 6, 1, '#d94a4a'); ptext('?!', 357, 29, '#3b5b8c'); });
  add(41, 7, 12, 3, true, () => { const shake = !RM && anyoneIn('meeting') && Math.floor(NOW / 160) % 7 === 0 ? 1 : 0;
    R(328 + shake, 54, 96, 26, '#7a5a36'); R(329 + shake, 54, 94, 22, '#a0744a'); R(329 + shake, 54, 94, 2, '#b98a52');
    for (let i = 0; i < 12; i++) { const h = hash('m' + i); R(331 + i * 8 + (h % 3), 58 + ((h >> 3) % 10), 5, 3, '#f6f3ee'); if (h % 3 === 0) R(333 + i * 8, 66 + (h >> 5) % 6, 3, 3, '#e5e5e5'); } });
  for (let x = 41; x <= 52; x++) { seat(x, 6, 'down'); chair(x, 6, 'down'); seat(x, 10, 'up'); chair(x, 10, 'up'); }
  add(54, 7, 1, 3, true, () => { R(434, 52, 5, 24, '#2b2b33'); R(435, 54, 3, 20, '#3b5b8c'); R(435, 60, 3, 1, '#d94a4a'); R(435, 64, 2, 1, '#d94a4a'); });
  plant(39, 4); plant(39, 13); plant(54, 13);

  // --- Executive Offices: one each for the first two executive accounts (the second is 14 tiles to the right)
  const EXEC_SEATS = [];
  function execOffice(ox) {
    const dx = ox * TS, n = EXEC_SEATS.length;
    FURN.push({ z: 4 * TS + 0.5, draw: () => { // framed Her Haus logo on the wall
      const X = 470 + dx, Y = 15;
      R(X, Y, 60, 16, '#d4af37'); R(X + 1, Y + 1, 58, 14, '#ffffff');
      for (let i = 0; i < 5; i++) R(X + 20 - i * 2, Y + 2 + i, 8 + i * 4 + 6, 1, '#0C2E60');
      for (let i = 0; i < 4; i++) { R(X + 33 - i, Y + 3 + i, 1, 1, '#CB252B'); R(X + 34 + i, Y + 3 + i, 1, 1, '#CB252B'); }
      ptext('HER', X + 6, Y + 9, '#CB252B'); ptext('HAUS', X + 20, Y + 9, '#0C2E60'); ptext('LLC', X + 39, Y + 9, '#0C2E60');
    } });
    add(56 + ox, 4, 2, 1, true, () => { R(448 + dx, 18, 16, 22, '#3d2416'); for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) R(450 + dx + k * 3, 20 + r * 7, 2, 6, ['#CB252B', '#0C2E60', '#EDF2F8', '#d4af37'][(k + r + n) % 4]); });
    add(60 + ox, 7, 5, 2, true, () => {
      const X = 480 + dx, Y = 56;
      R(X, Y - 3, 40, 16, '#4a2116'); R(X, Y - 3, 40, 10, '#7a3a28'); R(X, Y - 3, 40, 1, '#94503a'); R(X, Y + 6, 40, 1, '#d4af37');
      R(X + 26, Y - 13, 12, 9, '#e5e5e5'); R(X + 27, Y - 12, 10, 6, '#0C2E60');
      for (let i = 0; i < 9; i++) R(X + 28 + i, Y - 8 - Math.round((Math.sin(NOW / 600 + i + n * 2) * 0.5 + 0.5) * 3), 1, 1, '#CB252B');
      R(X + 31, Y - 4, 2, 2, '#c9c2b8');
      R(X + 3, Y + 7, 13, 7, '#0C2E60'); ptext('EXEC', X + 2, Y + 8, '#d4af37');
      R(X + 19, Y - 1, 5, 3, '#2b2b33'); R(X + 3, Y - 2, 3, 3, '#f4f7fb'); R(X + 4, Y - 3, 1, 1, 'rgba(255,255,255,.7)');
    });
    add(61 + ox, 6, 1, 1, false, () => { const X = 488 + dx, Y = 48; R(X - 1, Y - 7, 10, 8, '#CB252B'); R(X, Y - 6, 8, 1, '#e03a40'); R(X, Y + 1, 8, 4, '#8f1a1f'); }, 6 * TS + 1);
    seat(61 + ox, 6, 'down');
    for (const x of [61, 63]) { seat(x + ox, 10, 'up'); chair(x + ox, 10, 'up'); }
    add(64 + ox, 12, 4, 1, false, () => { const X = 512 + dx, Y = 96; R(X - 2, Y - 6, 36, 7, '#0C2E60'); R(X - 2, Y - 6, 36, 2, '#1B4BA8'); R(X, Y + 1, 32, 5, '#143b75'); R(X - 3, Y - 4, 3, 10, '#081f42'); R(X + 32, Y - 4, 3, 10, '#081f42'); }, 12 * TS + 2);
    for (let x = 64; x <= 67; x++) seat(x + ox, 12, 'down');
    add(65 + ox, 9, 2, 1, true, () => { R(520 + dx, 74, 16, 5, '#2b2b33'); R(520 + dx, 74, 16, 1, '#5a5a66'); R(524 + dx, 72, 3, 3, '#d4af37'); });
    add(68 + ox, 6, 1, 2, true, () => { R(544 + dx, 42, 8, 22, '#2b2b33'); R(545 + dx, 44, 6, 8, '#3a3a44'); R(546 + dx, 45, 1, 3, '#CB252B'); R(548 + dx, 45, 1, 3, '#d4af37'); R(550 + dx, 45, 1, 3, '#7bd389'); });
    plant(56 + ox, 13); plant(68 + ox, 4); plant(68 + ox, 13);
    EXEC_SEATS.push([61 + ox, 6]);
  }
  execOffice(0); execOffice(14);

  // --- Hallway
  add(54, 15, 1, 1, true, () => { R(434, 112, 6, 8, '#d6dde6'); R(435, 104, 4, 8, '#7fd3ff'); R(435, 104, 4, 2, '#bfe8ff'); });
  plant(21, 15); plant(38, 15); plant(5, 17);

  // --- Data Room
  const DESKS = [];
  const deskDraw = (x, y, w, i) => () => {
    const X = x * TS, Y = y * TS, owner = state.deskOwners[i];
    R(X, Y - 3, w * 8, 8, '#d8dde6'); R(X, Y + 5, w * 8, 3, '#8c9bb0');
    R(X + w * 8 - 12, Y - 11, 10, 8, '#2b2b33'); R(X + w * 8 - 8, Y - 3, 2, 1, '#2b2b33');
    R(X + 6, Y - 1, 8, 2, '#0C2E60'); R(X + 16, Y - 4, 5, 3, '#f6f3ee'); R(X + 16, Y - 5, 5, 1, '#e5e5e5');
    const c = owner && chars.get(owner.id);
    const atDesk = c && !c.path.length && c.tx === x + 1 && c.ty === y - 1;
    if (atDesk) R(X + w * 8 - 12, Y - 11, 1, 8, Math.floor(NOW / 120 + i) % 2 ? '#7fe0ff' : '#9be36b');
    else if (owner) R(X + 2, Y - 2, 3, 3, '#f1e8da');
  };
  for (const y of [21, 24, 27]) for (const x of [6, 12, 18, 24]) {
    const i = DESKS.length; DESKS.push([x + 1, y - 1]);
    add(x, y, 4, 1, true, deskDraw(x, y, 4, i)); seat(x + 1, y - 1, 'down'); chair(x + 1, y - 1, 'down');
  }
  FURN.push({ z: 19 * TS + 0.5, draw: () => { // wall dashboards
    for (const [sx, kind] of [[48, 'bars'], [96, 'line'], [152, 'bars'], [184, 'pie']]) {
      R(sx - 1, 137, 26, 12, '#000'); R(sx, 138, 24, 10, '#12202e');
      if (kind === 'bars') for (let i = 0; i < 6; i++) { const v = RM ? 4 : 2 + Math.round((Math.sin(NOW / 300 + i * 1.7 + sx) * 0.5 + 0.5) * 6); R(sx + 2 + i * 4, 146 - v, 3, v, i % 2 ? '#7fe0ff' : '#9be36b'); }
      if (kind === 'line') for (let i = 0; i < 22; i++) { const v = Math.round((Math.sin(NOW / 500 + i * 0.6) * 0.5 + 0.5) * 6); R(sx + 1 + i, 145 - v, 1, 1, '#ffb44c'); }
      if (kind === 'pie') { R(sx + 3, 140, 6, 6, '#e86a92'); R(sx + 6, 140, 3, 3, '#7fe0ff'); ptext(Math.floor(NOW / 700) % 2 ? '$$' : '%%', sx + 12, 141, '#9be36b'); }
    }
  } });
  add(29, 20, 1, 3, true, () => { R(232, 150, 8, 32, '#2b2b33'); for (let r = 0; r < 7; r++) { R(233, 153 + r * 4, 6, 2, '#0C2E60'); R(237, 153 + r * 4, 1, 1, (Math.floor(NOW / 150) + r * 3) % 4 ? '#7cf29a' : '#ff6f7a'); } });
  add(28, 28, 1, 1, true, () => { R(224, 220, 8, 10, '#d6d0c4'); R(225, 218, 6, 3, '#2b2b33'); R(225, 226, 6, 1, '#7fe0ff'); });
  plant(5, 19); plant(5, 28);

  // --- Break room
  add(32, 27, 1, 1, false, () => { R(256, 218, 8, 6, '#CB252B'); R(257, 217, 6, 2, '#e03a40'); }, 27 * TS + 2); seat(32, 27, 'down');
  add(34, 27, 1, 1, false, () => { R(272, 218, 8, 6, '#0C2E60'); R(273, 217, 6, 2, '#1B4BA8'); }, 27 * TS + 2); seat(34, 27, 'down');
  add(33, 28, 1, 1, false, () => { R(265, 228, 6, 3, '#e5e5e5'); R(267, 226, 2, 2, '#fff'); }, 28 * TS + 1);
  add(41, 22, 1, 1, true, () => { R(328, 174, 9, 6, '#2b2b33'); R(329, 175, 3, 3, '#5a5a66'); R(333, 175, 3, 3, '#5a5a66'); R(330, 172, 5, 2, '#0C2E60'); });
  add(44, 19, 1, 1, true, () => { R(354, 160, 6, 8, '#d6dde6'); R(355, 152, 4, 8, '#7fd3ff'); });
  add(51, 19, 1, 2, true, () => { const X = 408, Y = 152, hit = !RM && anyoneIn('break') && Math.floor(NOW / 250) % 2 ? 1 : 0;
    R(X - 1 + hit, Y - 6, 10, 22, '#5a2a3c'); R(X + 1 + hit, Y - 4, 6, 10, '#9ad0e6');
    R(X + 2 + hit, Y - 3, 1, 3, '#fff'); R(X + 3 + hit, Y, 2, 1, '#fff'); R(X + 5 + hit, Y + 1, 1, 3, '#fff'); R(X + 1 + hit, Y + 8, 6, 3, '#3a1a2a');
    R(X - 4, Y + 16, 2, 1, '#f2c14e'); R(X + 10, Y + 15, 2, 1, '#7bd389'); R(X + 3, Y + 17, 2, 1, '#e86a92'); });
  add(53, 23, 1, 1, true, () => { const X = 424, Y = 184; R(X, Y - 3, 8, 9, '#d6d0c4'); R(X + 1, Y - 5, 6, 3, '#2b2b33'); R(X + 2, Y - 1, 4, 1, '#0C2E60'); R(X + 5, Y - 3, 1, 4, '#0C2E60'); R(X - 3, Y + 6, 2, 1, '#f6f3ee'); R(X + 9, Y + 5, 2, 1, '#f6f3ee'); });
  add(42, 27, 5, 1, false, () => { const X = 336, Y = 216; R(X - 2, Y - 6, 44, 7, '#CB252B'); R(X - 2, Y - 6, 44, 2, '#e03a40'); R(X, Y + 1, 40, 5, '#b5222a'); R(X - 3, Y - 4, 3, 10, '#8f1a1f'); R(X + 40, Y - 4, 3, 10, '#8f1a1f'); }, 27 * TS + 2);
  for (let x = 42; x <= 46; x++) seat(x, 27, 'down');
  add(54, 26, 1, 2, true, () => { R(432, 202, 8, 22, '#3b5b8c'); R(433, 205, 6, 10, '#bfe8ff'); for (let k = 0; k < 3; k++) { R(434, 206 + k * 3, 1, 2, '#f2c14e'); R(436, 206 + k * 3, 1, 2, '#d94a4a'); } });
  plant(31, 19); plant(54, 28); plant(31, 23);
  // arcade cabinets (walk up and click to play)
  const ARCADES = [[32, 'type'], [33, 'snake'], [34, 'dash'], [35, 'duel']];
  ARCADES.forEach(([x, key], i) => add(x, 19, 1, 1, true, () => {
    const X = x * 8, Y = 19 * 8, f = Math.floor(NOW / 200);
    R(X, Y - 13, 8, 21, ['#143b75', '#0C2E60', '#CB252B', '#1B4BA8'][i]); R(X, Y - 13, 8, 3, '#f4f7fb'); R(X + 2, Y - 12, 4, 1, i === 2 ? '#0C2E60' : '#CB252B'); R(X, Y - 13, 1, 21, 'rgba(0,0,0,.3)');
    R(X + 1, Y - 9, 6, 6, '#0b1020');
    if (key === 'type') { R(X + 1, Y - 7, 1 + (f % 4), 2, '#4ade80'); if (f % 2) R(X + 2 + (f % 4), Y - 7, 1, 2, '#ffffff'); }
    if (key === 'snake') { R(X + 1 + (f % 4), Y - 6, 2, 1, '#7cf29a'); R(X + 5, Y - 8, 1, 1, '#f2c14e'); }
    if (key === 'dash') { R(X + 2, Y - 7 + (f % 3), 2, 2, '#ffb44c'); R(X + 6 - (f % 5), Y - 9, 1, 2, '#9aa3ad'); R(X + 6 - (f % 5), Y - 5, 1, 2, '#9aa3ad'); }
    if (key === 'duel') { R(X + 2, Y - 7, 1, 3, f % 2 ? '#ff6f7a' : '#7fe0ff'); R(X + 5, Y - 7, 1, 3, f % 2 ? '#7fe0ff' : '#ff6f7a'); }
    R(X, Y - 2, 8, 3, '#2b2b33'); R(X + 2, Y - 2, 1, 1, '#d94a4a'); R(X + 5, Y - 2, 1, 1, '#f2c14e');
    R(X, Y + 7, 8, 1, 'rgba(0,0,0,.35)');
  }));
  const arcadeAt = (x, y) => (y === 20 ? ARCADES.find(([ax]) => ax === x)?.[1] : null);

  // --- Ops Assistant Office: where messaging and admin work happens
  const OPS_DESKS = [];
  for (const y of [22, 26]) for (const x of [58, 64, 71, 77]) {
    OPS_DESKS.push([x + 1, y - 1]);
    add(x, y, 4, 1, true, deskDraw(x, y, 4, -1)); seat(x + 1, y - 1, 'down'); chair(x + 1, y - 1, 'down', '#1B4BA8');
  }
  FURN.push({ z: 19 * TS + 0.5, draw: () => { // sticky-note board and a "messages sent" screen on the back wall
    R(455, 137, 58, 12, '#0C2E60'); R(456, 138, 56, 10, '#f4f7fb');
    ptext('TO DO', 458, 140, '#0C2E60'); ptext('DONE', 494, 140, '#2f6e3c');
    const notes = ['#f2c94c', '#ff9eb5', '#9ad0e6', '#b6e3a1'];
    for (let k = 0; k < 6; k++) R(480 + (k % 3) * 4, 139 + Math.floor(k / 3) * 4, 3, 3, notes[k % 4]);
    R(587, 137, 50, 12, '#000'); R(588, 138, 48, 10, '#12202e');
    ptext('SENT ' + (120 + Math.floor(NOW / 2500) % 880), 591, 140, '#4ade80');
  } });
  add(81, 19, 2, 1, true, () => { for (const k of [0, 1]) { const X = 648 + k * 8; R(X, 148, 7, 16, '#9aa3ad'); R(X, 148, 7, 1, '#b8c0c8'); R(X + 2, 152, 3, 1, '#5a5a66'); R(X + 2, 158, 3, 1, '#5a5a66'); } });
  add(56, 23, 1, 2, true, () => { R(448, 178, 8, 14, '#d6d0c4'); R(449, 176, 6, 3, '#2b2b33'); R(450, 184, 4, 1, '#7fe0ff'); R(449, 188, 6, 1, '#f6f3ee'); });
  plant(56, 19); plant(56, 28); plant(82, 28); plant(82, 23);

  // --- outside
  add(5, 30, 78, 1, true, () => { for (let x = 5; x < 83; x++) { R(x * 8, 240, 8, 7, '#3f7a3a'); R(x * 8 + 1, 238, 6, 4, '#4f8f45'); R(x * 8 + 2, 239, 2, 1, '#67a85a'); } });
  FURN.push({ z: 31 * TS + 1, draw: () => {
    const X = 216, Y = 226;
    R(X + 2, Y + 16, 2, 6, '#0C2E60'); R(X + 44, Y + 16, 2, 6, '#0C2E60');
    for (let i = 0; i < 9; i++) R(X + 15 - i * 1.5, Y - 1 + i, 18 + i * 3, 1, '#0C2E60');
    for (let i = 0; i < 6; i++) { R(X + 23 - i, Y + 3 + i, 1, 1, '#CB252B'); R(X + 24 + i, Y + 3 + i, 1, 1, '#CB252B'); }
    R(X + 21, Y + 5, 2, 2, '#0C2E60'); R(X + 24, Y + 5, 2, 2, '#0C2E60');
    R(X - 1, Y + 8, 50, 11, '#0C2E60'); R(X, Y + 9, 48, 9, '#f4f7fb');
    ptext('HER', X + 3, Y + 11, '#CB252B'); ptext('HAUS', X + 17, Y + 11, '#0C2E60'); ptext('HQ', X + 36, Y + 11, '#CB252B');
  } });
  const TREES = [[1, 1], [7, 1], [14, 2], [26, 1], [33, 2], [41, 1], [49, 2], [57, 1], [64, 2], [71, 1], [78, 2], [85, 1], [85, 8], [84, 13], [85, 19], [84, 24], [85, 29], [0, 5], [2, 10], [0, 19], [0, 27], [5, 37], [16, 37], [29, 37], [44, 37], [55, 37], [68, 37], [80, 37]];
  TREES.forEach(([x, y]) => { const pine = hash(x + ':' + y) % 2;
    add(x, y, 1, 1, true, () => { const X = x * 8, Y = y * 8;
      R(X - 1, Y + 6, 10, 2, 'rgba(0,0,0,.2)'); R(X + 3, Y + 1, 2, 7, '#6b4a2e');
      if (pine) { R(X - 2, Y - 2, 12, 4, '#2f6e3c'); R(X - 1, Y - 6, 10, 4, '#357a42'); R(X, Y - 10, 8, 4, '#3f8f4f'); R(X + 2, Y - 13, 4, 3, '#4a9a58'); }
      else { R(X - 3, Y - 12, 14, 12, '#2f6e3c'); R(X - 2, Y - 13, 12, 9, '#3f8f4f'); R(X, Y - 12, 5, 4, '#57a862'); }
    }); });
  const LAMPS = [3, 12, 21, 30, 39, 48, 57, 65, 74, 83];
  LAMPS.forEach((x) => add(x, 37, 1, 1, true, () => { const X = x * 8, Y = 37 * 8; R(X + 3, Y - 12, 2, 18, '#0C2E60'); R(X + 1, Y - 14, 6, 3, '#2b2b33'); R(X + 2, Y - 12, 4, 1, night() ? '#ffe9a8' : '#c9c2b8'); }));

  // --- cars
  function carV(x, y, col) { // parked, nose up
    R(x - 1, y + 2, 1, 4, '#1d1626'); R(x + 12, y + 2, 1, 4, '#1d1626'); R(x - 1, y + 12, 1, 4, '#1d1626'); R(x + 12, y + 12, 1, 4, '#1d1626');
    R(x, y, 12, 18, col); R(x, y + 17, 12, 1, 'rgba(0,0,0,.35)');
    R(x + 2, y + 4, 8, 3, '#bfe8ff'); R(x + 2, y + 7, 8, 6, col); R(x + 2, y + 7, 8, 6, 'rgba(0,0,0,.18)'); R(x + 2, y + 13, 8, 2, '#9ad0e6');
    R(x + 1, y, 2, 1, '#ffe9a8'); R(x + 9, y, 2, 1, '#ffe9a8'); R(x + 1, y + 17, 2, 1, '#ff4d4d'); R(x + 9, y + 17, 2, 1, '#ff4d4d');
  }
  function carH(x, y, col, right) {
    x = Math.round(x); y = Math.round(y);
    R(x + 2, y - 1, 4, 1, '#1d1626'); R(x + 12, y - 1, 4, 1, '#1d1626'); R(x + 2, y + 12, 4, 1, '#1d1626'); R(x + 12, y + 12, 4, 1, '#1d1626');
    R(x, y, 18, 12, col); R(x, y + 11, 18, 1, 'rgba(0,0,0,.35)');
    const f = right ? x + 11 : x + 4, b = right ? x + 3 : x + 13;
    R(f, y + 2, 3, 8, '#bfe8ff'); R(right ? x + 5 : x + 7, y + 2, 6, 8, 'rgba(0,0,0,.18)'); R(b, y + 2, 2, 8, '#9ad0e6');
    R(right ? x + 17 : x, y + 1, 1, 2, '#ffe9a8'); R(right ? x + 17 : x, y + 9, 1, 2, '#ffe9a8');
  }
  const carColor = (id) => CAR_COLORS[hash('car' + id) % CAR_COLORS.length];
  const moving = []; // cars driving in/out
  FURN.push({ z: DOOR_Y * TS, draw: () => {
    for (const p of state.staff) {
      const si = state.stalls.get(p.id); if (si === undefined) continue;
      if (moving.some((m) => m.id === p.id)) continue;
      if (isGone(p) && !exiting.has(p.id)) continue;
      carV(STALLS[si] * 8 + 2, 31 * 8 + 3, carColor(p.id));
    }
  } });
  FURN.push({ z: 36 * TS + 2, draw: () => {
    const t = NOW;
    for (let i = moving.length - 1; i >= 0; i--) {
      const m = moving[i], el = (t - m.t0) / 1000, sx = STALLS[m.si] * 8, col = carColor(m.id);
      if (m.kind === 'out') {
        if (el < 0.8) carV(sx + 2, 251 + (el / 0.8) * 12, col);
        else { const x = sx - 1 + (el - 0.8) * 95; carH(x, 276, col, true); if (chance(25, 1 / 60)) spawn(x - 1, 284, -12, -6, 0.6, 'rgba(200,200,200,.6)', 0, 'big');
          if (x > W + 10) { moving.splice(i, 1); exiting.delete(m.id); renderRoster(true); } }
      } else {
        const x0 = W + 10, xs = sx - 1, d1 = (x0 - xs) / 95;
        if (el < d1) carH(x0 - el * 95, 276, col, false);
        else { const e2 = el - d1; carV(sx + 2, 263 - Math.min(1, e2 / 0.8) * 12, col);
          if (e2 >= 0.8) { moving.splice(i, 1); arriving.delete(m.id); spawnAt.set(m.id, [STALLS[m.si], DOOR_Y]); reconcile(); } }
      }
    }
  } });

  const night = () => { const h = new Date().getHours(); return h < 7 || h >= 19; };

  // ================= static ground layer =================
  const bg = document.createElement('canvas'); bg.width = W; bg.height = H;
  (function paintGround() {
    const g = bg.getContext('2d');
    const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const f = FLOOR[idx(x, y)], X = x * 8, Y = y * 8, h = hash(x * 131 + y * 7);
      switch (f) {
        case 'grass': P(X, Y, 8, 8, '#5d8c3a'); if (h % 3 === 0) P(X + (h % 6), Y + ((h >> 3) % 6), 1, 2, '#6a9a44'); if (h % 5 === 0) P(X + ((h >> 4) % 7), Y + ((h >> 6) % 7), 1, 1, '#4f7a30'); break;
        case 'path': P(X, Y, 8, 8, '#c9a27a'); P(X, Y + (y % 2 ? 3 : 7), 8, 1, '#b38a63'); P(X + (y % 2 ? 4 : 0), Y, 1, 8, '#b38a63'); break;
        case 'asphalt': P(X, Y, 8, 8, '#4a4950'); if (h % 7 === 0) P(X + (h % 7), Y + ((h >> 3) % 7), 1, 1, '#55545c'); break;
        case 'studio': P(X, Y, 8, 8, '#f7f9fc'); P(X + 7, Y, 1, 8, '#e3eaf4'); P(X, Y + 7, 8, 1, '#e3eaf4'); break;
        case 'checker': P(X, Y, 8, 8, (x + y) % 2 ? '#f4f7fb' : '#d3deec'); break;
        case 'carpet': P(X, Y, 8, 8, '#1B4BA8'); if ((x + y) % 2) P(X + 3, Y + 3, 2, 2, '#173f8f'); break;
        case 'hall': P(X, Y, 8, 8, '#EDF2F8'); if (y === 16) P(X, Y + 2, 8, 4, '#c9d6e8'); break;
        case 'data': P(X, Y, 8, 8, '#0f2c58'); P(X, Y + 7, 8, 1, '#0b2550'); P(X + 7, Y, 1, 8, '#0b2550'); break;
        case 'break': P(X, Y, 8, 8, (x + y) % 2 ? '#d3deec' : '#c4d2e6'); break;
        case 'ops': P(X, Y, 8, 8, '#e3eaf4'); P(X + 7, Y, 1, 8, '#d3deec'); P(X, Y + 7, 8, 1, '#d3deec'); break;
        case 'exec': P(X, Y, 8, 8, '#6b4a2e'); P(X, Y + 7, 8, 1, '#5b3d24'); if ((x * 3 + y) % 4 === 0) P(X + 7, Y, 1, 7, '#5b3d24'); break;
      }
    }
    // dance floor
    for (let y = 6; y <= 8; y++) for (let x = 9; x <= 13; x++) P(x * 8, y * 8, 8, 8, (x + y) % 2 ? '#CB252B' : '#f4f7fb');
    // meeting rug
    P(40 * 8, 5 * 8 + 4, 14 * 8, 6 * 8, '#173f8f');
    // executive rug
    P(58 * 8, 5 * 8, 9 * 8, 7 * 8, '#d4af37'); P(58 * 8 + 2, 5 * 8 + 2, 9 * 8 - 4, 7 * 8 - 4, '#a01e23'); P(58 * 8 + 5, 5 * 8 + 5, 9 * 8 - 10, 7 * 8 - 10, '#CB252B');
    P(72 * 8, 5 * 8, 9 * 8, 7 * 8, '#d4af37'); P(72 * 8 + 2, 5 * 8 + 2, 9 * 8 - 4, 7 * 8 - 4, '#a01e23'); P(72 * 8 + 5, 5 * 8 + 5, 9 * 8 - 10, 7 * 8 - 10, '#CB252B');
    P(61 * 8, 14 * 8 + 1, 16, 6, '#CB252B'); P(75 * 8, 14 * 8 + 1, 16, 6, '#CB252B'); P(68 * 8, 18 * 8 + 1, 16, 6, '#0C2E60');
    // breakdance cardboard
    P(37 * 8, 23 * 8, 4 * 8, 3 * 8, '#c49a6c'); P(37 * 8 + 2, 23 * 8 + 2, 4 * 8 - 4, 3 * 8 - 4, '#b88d5f'); P(37 * 8, 24 * 8 + 4, 4 * 8, 1, '#a07a50');
    // break room mess
    [[47, 27], [49, 22], [40, 20], [52, 26]].forEach(([x, y]) => { P(x * 8 + 1, y * 8 + 5, 3, 1, '#f6f3ee'); P(x * 8 + 5, y * 8 + 3, 2, 2, '#7a5a36'); });
    // door mats
    [[12, 14, 2], [29, 14, 2], [46, 14, 2], [16, 18, 2], [36, 18, 2], [49, 18, 2]].forEach(([x, y, w]) => P(x * 8, y * 8 + 1, w * 8, 6, '#0C2E60'));
    P(3 * 8, 15 * 8, 2 * 8, 3 * 8, '#CB252B'); P(3 * 8 + 2, 15 * 8 + 2, 2 * 8 - 4, 3 * 8 - 4, '#e03a40');
    // parking lot markings
    P(0, 31 * 8, W, 1, '#8f8676');
    for (const sx of STALLS) { P(sx * 8, 31 * 8 + 2, 1, 22, '#e9e4da'); }
    P((STALLS[STALLS.length - 1] + 2) * 8, 31 * 8 + 2, 1, 22, '#e9e4da');
    for (let x = 0; x < W; x += 16) P(x + 2, 35 * 8 + 3, 8, 1, '#e8d27a');
    P(W - 20, 33 * 8 + 3, 10, 2, '#e9e4da'); P(W - 12, 33 * 8 + 1, 2, 6, '#e9e4da'); P(W - 10, 33 * 8 + 2, 1, 4, '#e9e4da');
    P(0, 36 * 8 + 7, W, 1, '#8f8676');
  })();

  for (let y = 0; y < MH; y++) {
    const xs = []; for (let x = 0; x < MW; x++) if (WALL[idx(x, y)]) xs.push(x);
    if (!xs.length) continue;
    FURN.push({ z: (y + 1) * TS, draw: () => {
      for (const x of xs) {
        const X = x * 8, Y = y * 8, below = y + 1 < MH && WALL[idx(x, y + 1)];
        R(X, Y - 6, 8, 8, '#f4f7fb');
        if (!below) { R(X, Y + 2, 8, 6, '#b8c7de'); R(X, Y + 7, 8, 1, '#0C2E60'); }
        if (!WALL[idx(x - 1, y)]) R(X, Y - 6, 1, below ? 8 : 14, '#0C2E60');
        if (!WALL[idx(x + 1, y)]) R(X + 7, Y - 6, 1, below ? 8 : 14, '#0C2E60');
        if (y === 0 || !WALL[idx(x, y - 1)]) R(X, Y - 6, 8, 1, '#0C2E60');
      }
    } });
  }

  // ================= spots (x, y, activity, facing) =================
  const order = (xs, y1, y2, role) => { const o = []; for (const x of xs) { o.push([x, y1, role]); o.push([x, y2, role]); } return o; };
  const SPOTS = {
    meeting: order([46, 47, 45, 48, 44, 49, 43, 50, 42, 51, 41, 52], 6, 10, 'argue'),
    lunch: order([29, 30, 28, 31, 27, 32, 26, 33, 25, 34, 24, 35], 7, 10, 'eat'),
    social: [[11, 11, 'film', 'up'], [10, 7, 'dance', 'down'], [17, 9, 'paint', 'up'], [12, 7, 'dance', 'down'], [11, 8, 'dance', 'down'],
             [8, 12, 'film', 'up'], [19, 12, 'paint', 'up'], [9, 8, 'dance', 'down'], [13, 8, 'dance', 'down']],
    break: [[32, 27, 'cry'], [38, 24, 'breakdance'], [46, 21, 'panic'], [51, 21, 'smash', 'up'], [43, 27, 'snack'],
            [34, 27, 'cry'], [40, 25, 'breakdance'], [47, 25, 'panic'], [53, 24, 'smash', 'up'], [45, 27, 'snack']],
    visit: [[7, 16], [9, 16], [11, 16], [19, 16], [23, 16], [26, 16], [33, 16], [40, 16]],
    over: [],
  };
  for (let x = 8; x < 81; x += 3) if (!SOLID[idx(x, 15)]) SPOTS.over.push([x, 15]);
  SPOTS.ops = OPS_DESKS.slice();

  // ================= state =================
  const SAMPLE = [];

  const state = {
    real: [], profiles: {}, myId: null,
    peerPos: new Map(), peerGame: new Map(), online: new Set(), watching: 0, scores: new Map(),
    selected: null, deskOwners: [], spots: new Map(), stalls: new Map(), staff: [], sample: false, ownerId: null, execIds: [],
  };
  const chars = new Map();
  const exiting = new Set(), arriving = new Set(), spawnAt = new Map(), lastEff = new Map();
  let db = null, user = null, room = null;
  let pick = 'focus', touched = false, prefilled = false, readOnly = false;
  let draftLook = null;

  const effective = (p) => (p.status !== 'visiting' && Date.now() - (p.updatedAt || 0) > STALE_MS ? 'out' : p.status);
  const isStale = () => false;   // the Hub clock is the source of truth
  const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - t) / 60000)); if (m < 1) return 'now'; if (m < 60) return m + 'm'; const h = Math.round(m / 60); return h < 48 ? h + 'h' : Math.round(h / 24) + 'd'; };
  const myDoc = () => state.real.find((p) => p.id === state.myId);
  // the task only steers people whose status leaves room for it; meeting, lunch, break and out are explicit choices
  const taskOf = (p) => (DESK_STATUSES.includes(effective(p)) || p.visitor ? detectTask(p.note) : null);
  const placeOf = (p) => { const st = effective(p); if (st === 'out') return 'out'; return taskOf(p)?.room === 'field' ? 'field' : 'in'; };
  const isGone = (p) => placeOf(p) !== 'in';
  const labelOf = (p) => { const pl = placeOf(p); if (pl === 'field') return 'In the field'; return taskOf(p)?.label || STATUSES[effective(p)].label; };
  const colorOf = (p) => (placeOf(p) === 'field' ? '#4ade80' : STATUSES[effective(p)].color);
  const roomFor = (p) => {
    const st = effective(p);
    if (st === 'meeting' || st === 'lunch' || st === 'break') return st;
    const t = taskOf(p);
    if (t && t.room !== 'desk') return t.room;
    if (t) return 'desk';
    return st === 'social' ? 'social' : 'desk';
  };

  function people() {
    const base = state.real.slice();
    const ids = new Set(base.map((p) => p.id));
    const extra = [...state.online];
    if (state.myId) extra.push(state.myId);
    for (const id of extra) if (!ids.has(id)) { ids.add(id); base.push({ id, status: 'visiting', note: '', updatedAt: Date.now(), joinedAt: Infinity, visitor: true }); }
    return base;
  }
  const personById = (id) => people().find((p) => p.id === id);
  const lookOf = (p) => (p.id === state.myId && draftLook && $('editor').open) ? draftLook : (p.sample ? p.look : parseLook(p.look, p.id));
  const nameOf = (p) => {
    if (p.sample) return p.name;
    const n = p.hub?.name || state.profiles[p.id]?.name;
    if (p.id === state.myId) return n || 'You';
    return n || 'Someone';
  };
  const firstName = (p) => nameOf(p).split(' ')[0];

  // ================= sprites =================
  function drawChar(g, x, fy, L, dir, pose, step, fx = {}) {
    const sit = pose === 'sit';
    const y = fy - 12 + (sit ? 2 : 0);
    const r = (a, b, w, h, c) => { g.fillStyle = c; g.fillRect(x + a, y + b, w, h); };
    const skin = LOOKS.skin[L.skin], hair = LOOKS.hair[L.hair], shirt = LOOKS.shirt[L.shirt], pants = LOOKS.pants[L.pants];
    const Hh = (a, b, w, h) => r(a, b, w, h, hair);
    if (!sit && !fx.noShadow) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x, fy - 1, 8, 2); }
    if (!sit) {
      const a = pose === 'walk' && step % 2 === 1 ? 1 : 0, b = pose === 'walk' && step % 2 === 0 ? 1 : 0;
      r(1, 10, 2, 2 - a, pants); r(5, 10, 2, 2 - b, pants);
      r(1, 11 - a, 2, 1, '#1d1626'); r(5, 11 - b, 2, 1, '#1d1626');
    }
    r(0, 5, 8, 4, shirt); r(1, 9, 6, 1, pants);
    r(0, 5, 1, 4, 'rgba(0,0,0,.22)'); r(7, 5, 1, 4, 'rgba(0,0,0,.22)');
    if (fx.armsUp) { r(-1, 1, 1, 4, skin); r(8, 1, 1, 4, skin); r(-1, 5, 1, 1, shirt); r(8, 5, 1, 1, shirt); }
    else if (fx.handMouth) { r(5, 4, 2, 1, skin); }
    else if (dir !== 'up') { r(0, 8, 1, 1, skin); r(7, 8, 1, 1, skin); }
    r(1, 1, 6, 4, skin);
    if (fx.red) r(1, 2, 6, 3, 'rgba(255,40,40,.45)');
    if (fx.pale) r(1, 2, 6, 3, 'rgba(150,220,170,.45)');
    const st = L.hairStyle;
    if (dir === 'up') {
      Hh(1, 0, 6, 5);
      if (st === 1) Hh(1, 5, 6, 2); if (st === 2) Hh(3, -2, 2, 2); if (st === 4) Hh(0, -1, 8, 5);
    } else {
      if (st === 0) { Hh(1, 0, 6, 2); Hh(1, 2, 1, 1); Hh(6, 2, 1, 1); }
      if (st === 1) { Hh(1, 0, 6, 2); Hh(1, 2, 1, 5); Hh(6, 2, 1, 5); }
      if (st === 2) { Hh(1, 0, 6, 2); Hh(3, -2, 2, 2); Hh(1, 2, 1, 1); Hh(6, 2, 1, 1); }
      if (st === 3) Hh(1, 0, 6, 1);
      if (st === 4) { Hh(1, -1, 6, 1); Hh(0, 0, 8, 2); Hh(0, 2, 1, 2); Hh(7, 2, 1, 2); }
      if (dir === 'left') Hh(5, 1, 2, 3); if (dir === 'right') Hh(1, 1, 2, 3);
      const eye = '#1d1626';
      if (fx.angry && dir === 'down') { r(2, 2, 1, 1, eye); r(5, 2, 1, 1, eye); }
      if (dir === 'down') { r(2, 3, 1, 1, eye); r(5, 3, 1, 1, eye); }
      if (dir === 'left') r(2, 3, 1, 1, eye);
      if (dir === 'right') r(5, 3, 1, 1, eye);
      if (fx.mouth && dir === 'down') r(3, 4, 2, 1, '#6b1d2a');
    }
    if (L.acc === 1 && dir !== 'up') {
      if (dir === 'down') { r(1, 3, 6, 1, '#1d1626'); r(2, 3, 1, 1, '#9ad0e6'); r(5, 3, 1, 1, '#9ad0e6'); }
      else if (dir === 'left') { r(1, 3, 3, 1, '#1d1626'); r(2, 3, 1, 1, '#9ad0e6'); }
      else { r(4, 3, 3, 1, '#1d1626'); r(5, 3, 1, 1, '#9ad0e6'); }
    }
    if (L.acc === 2) {
      r(1, -1, 6, 2, '#d94a4a');
      if (dir === 'down') r(1, 1, 6, 1, '#a83434'); if (dir === 'left') r(-1, 1, 4, 1, '#a83434'); if (dir === 'right') r(5, 1, 4, 1, '#a83434');
    }
    if (L.acc === 3) { r(2, -1, 4, 1, '#2b2b33'); r(0, 2, 1, 3, '#2b2b33'); r(7, 2, 1, 3, '#2b2b33'); }
  }
  const avatarCache = new Map();
  function avatarURL(L) {
    const key = LOOK_KEYS.map((k) => L[k]).join('.');
    if (avatarCache.has(key)) return avatarCache.get(key);
    const c = document.createElement('canvas'); c.width = 8; c.height = 14;
    const g = c.getContext('2d'); drawChar(g, 0, 14, L, 'down', 'stand', 0);
    const u = c.toDataURL(); avatarCache.set(key, u); return u;
  }

  // ================= movement =================
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const DIR4 = ['down', 'right', 'up', 'left'];
  const walkable = (x, y) => inb(x, y) && !SOLID[idx(x, y)];
  function nearestWalkable(x, y) {
    for (let r = 0; r < 5; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (walkable(x + dx, y + dy)) return [x + dx, y + dy];
    return null;
  }
  function findPath(sx, sy, tx, ty) {
    if (!walkable(tx, ty)) { const n = nearestWalkable(tx, ty); if (!n) return null; [tx, ty] = n; }
    const start = idx(sx, sy), goal = idx(tx, ty);
    if (start === goal) return [];
    const prev = new Int32Array(MW * MH).fill(-1); prev[start] = start;
    const q = [start];
    for (let h = 0; h < q.length; h++) {
      const c = q[h]; if (c === goal) break;
      const cx = c % MW, cy = (c / MW) | 0;
      for (const [dx, dy] of DIRS) { const nx = cx + dx, ny = cy + dy; if (!walkable(nx, ny)) continue; const n = idx(nx, ny); if (prev[n] !== -1) continue; prev[n] = c; q.push(n); }
    }
    if (prev[goal] === -1) return null;
    const path = []; for (let c = goal; c !== start; c = prev[c]) path.push([c % MW, (c / MW) | 0]);
    return path.reverse();
  }
  function newChar(id, at) {
    const [x, y] = at || [6, 16];
    return { id, tx: x, ty: y, px: x * TS, py: y * TS, path: [], dir: 'down', walkT: 0, goal: x + ',' + y, zone: zoneAt(x, y).id, live: false, spot: null, role: null, exit: null };
  }
  function setGoal(c, at) {
    if (!at) return;
    const key = at[0] + ',' + at[1];
    if (c.goal === key) return;
    c.goal = key;
    const from = c.path.length ? c.path[0] : [c.tx, c.ty];
    const rest = findPath(from[0], from[1], at[0], at[1]);
    if (!rest) { snap(c, at); return; }
    c.path = c.path.length ? [c.path[0], ...rest] : rest;
  }
  function snap(c, at) { c.tx = at[0]; c.ty = at[1]; c.px = at[0] * TS; c.py = at[1] * TS; c.path = []; c.zone = zoneAt(at[0], at[1]).id; }
  const SPEED = 62;
  function stepChar(c, dt) {
    if (!c.path.length) return;
    const [nx, ny] = c.path[0];
    const tx = nx * TS, ty = ny * TS, dx = tx - c.px, dy = ty - c.py;
    if (Math.abs(dx) > Math.abs(dy)) c.dir = dx > 0 ? 'right' : 'left'; else if (dy) c.dir = dy > 0 ? 'down' : 'up';
    const d = Math.hypot(dx, dy), mv = SPEED * dt * (c.exit ? 1.15 : 1);
    c.walkT += dt;
    if (d <= mv) { c.px = tx; c.py = ty; c.tx = nx; c.ty = ny; c.path.shift(); arrived(c); }
    else { c.px += dx / d * mv; c.py += dy / d * mv; }
  }
  function arrived(c) {
    const z = zoneAt(c.tx, c.ty);
    if (z.id !== c.zone) {
      c.zone = z.id;
      if (c.live && !c.exit && z.id !== 'hall') { const p = personById(c.id); if (p) log(p, z.id === 'outside' ? 'stepped outside' : 'walked into the ' + z.name); }
    }
    if (c.id === state.myId && room) room.presence({ x: c.tx, y: c.ty }).catch(() => {});
    if (c.exit && !c.path.length && c.tx === c.exit[0] && c.ty === c.exit[1]) getInCar(c);
    if (c.id === state.myId && pendingGame && !c.path.length) {
      if (arcadeAt(c.tx, c.ty) === pendingGame) openGame(pendingGame);
      pendingGame = null;
    }
  }

  // ================= parking: leave and arrive =================
  function startExit(p, kind) {
    const si = state.stalls.get(p.id);
    const c = chars.get(p.id);
    log(p, kind === 'field' ? 'headed out to the field · ' + (p.note || 'property visit') : 'logged out and headed to the car');
    if (si === undefined) { if (c) chars.delete(p.id); return; }
    exiting.add(p.id);
    if (c) { c.exit = [STALLS[si], DOOR_Y]; c.goal = null; setGoal(c, c.exit); if (!c.path.length) getInCar(c); }
    else moving.push({ id: p.id, si, kind: 'out', t0: NOW });
  }
  function getInCar(c) {
    const si = state.stalls.get(c.id);
    chars.delete(c.id); buildTags();
    if (si === undefined) { exiting.delete(c.id); return; }
    moving.push({ id: c.id, si, kind: 'out', t0: NOW });
    const p = personById(c.id); if (p) log(p, 'drove away');
  }
  function startArrive(p, from) {
    const si = state.stalls.get(p.id);
    exiting.delete(p.id);
    for (let i = moving.length - 1; i >= 0; i--) if (moving[i].id === p.id) moving.splice(i, 1);
    log(p, from === 'field' ? 'is back from the field' : 'pulled into the parking lot');
    if (si === undefined) return;
    if (chars.has(p.id)) return;
    arriving.add(p.id);
    moving.push({ id: p.id, si, kind: 'in', t0: NOW });
  }

  // ================= placement =================
  function reconcile() {
    if (!root.isConnected) return;
    const list = people();
    const staff = list.filter((p) => !p.visitor).sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0) || String(a.id).localeCompare(String(b.id)));
    const pools = Object.fromEntries(Object.entries(SPOTS).map(([k, v]) => [k, v.slice()]));
    const spots = new Map(), stalls = new Map();
    const deskers = staff.filter((p) => !state.execIds.includes(p.id));
    const isOps = (p) => /operation|\bops\b/i.test((p.hub && p.hub.position) || '');
    const deskIdx = new Map(deskers.map((p, i) => [p.id, i]));
    const deskAnim = (p) => ({ call: 'call', paper: 'paper', mail: 'mail', data: 'data' }[taskOf(p)?.id] || null);
    const place = (p) => {
      if (isGone(p)) return null;
      const room = roomFor(p);
      if (room === 'desk') {
        const ei = state.execIds.indexOf(p.id);
        if (ei >= 0 && ei < EXEC_SEATS.length) return [...EXEC_SEATS[ei], deskAnim(p) || 'boss'];
        if (taskOf(p)?.id === 'mail' || isOps(p)) {          // messaging work and ops assistants: Ops Assistant Office
          const o = pools.ops.shift(); if (o) return [...o, deskAnim(p) || 'mail'];
        }
        if (p.visitor) return pools.visit.shift() || pools.over.shift();
        const i = deskIdx.get(p.id);
        return i < DESKS.length ? [...DESKS[i], deskAnim(p) || 'type'] : pools.over.shift();
      }
      if (room === 'social') {
        const wantPaint = taskOf(p)?.id === 'design';
        let k = pools.social.findIndex((sp) => (sp[2] === 'paint') === wantPaint); if (k < 0) k = 0;
        return pools.social.splice(k, 1)[0] || pools.over.shift();
      }
      return pools[room]?.shift() || pools.over.shift();
    };
    staff.forEach((p, i) => { if (i < STALLS.length) stalls.set(p.id, i); spots.set(p.id, place(p)); });
    list.filter((p) => p.visitor).forEach((p) => spots.set(p.id, place(p)));
    state.spots = spots; state.stalls = stalls; state.staff = staff; state.deskOwners = deskers.slice(0, DESKS.length);

    for (const p of staff) {
      const e = placeOf(p), prev = lastEff.get(p.id);
      lastEff.set(p.id, e);
      if (prev === undefined || prev === e) continue;
      if (prev === 'in') startExit(p, e);
      else if (e === 'in') startArrive(p, prev);
      else if (e === 'out') { const pp = p; log(pp, 'called it a day from the field'); }
    }

    const seen = new Set();
    for (const p of list) {
      const isMe = p.id === state.myId;
      if (exiting.has(p.id)) { if (chars.has(p.id)) seen.add(p.id); continue; }
      if (arriving.has(p.id) || isGone(p)) continue;
      const peer = state.peerPos.get(p.id);
      const spot = spots.get(p.id);
      let c = chars.get(p.id);
      const spawn = spawnAt.get(p.id);
      if (!c) {
        const start = spawn || (isMe ? (spot || [6, 16]) : (peer || spot));
        if (!start) continue;
        c = newChar(p.id, start); chars.set(p.id, c);
        if (spawn) { spawnAt.delete(p.id); c.dir = 'up'; if (spot) setGoal(c, spot); }
        if (isMe && room) room.presence({ x: c.tx, y: c.ty }).catch(() => {});
      } else if (!isMe && !p.sample) setGoal(c, peer || spot);
      c.spot = spot || null; c.role = spot ? spot[2] || null : null; c.face = spot ? spot[3] || null : null;
      c.live = isMe || !!peer || !!p.sample;
      seen.add(p.id);
    }
    for (const id of [...chars.keys()]) if (!seen.has(id)) chars.delete(id);
    // when the Hub changes where *you* belong (lunch, break, a new task, the office owner), walk there yourself
    const mySpot = state.spots.get(state.myId), myKey = mySpot ? mySpot[0] + ',' + mySpot[1] : '';
    if (myKey !== state.mySpotKey) {
      const had = state.mySpotKey !== undefined; state.mySpotKey = myKey;
      const c = chars.get(state.myId);
      if (c && mySpot && had && !c.exit && !pendingGame && !arcade.open) { c.goal = null; setGoal(c, mySpot); }
      else if (c && mySpot && !had && !c.path.length) { c.goal = null; setGoal(c, mySpot); }
    }
    buildTags(); renderRoster(true); renderStats(); renderMe();
  }

  // ================= activities =================
  const ARGUE = ['NO!', '#@%!', 'WHY?', '!!', '?!', 'STOP', 'MINE', 'NOPE', 'BUT', '$$$'];
  const EAT = ['NOM', 'CHOMP', 'MORE', 'NOM'];
  function activity(c, p, role, t, dt) {
    const h = (hash(c.id) % 997) / 97;
    const o = { dx: 0, dy: 0, dir: null, flip: false, fx: {}, post: null };
    const X = Math.round(c.px), FY = Math.round(c.py) + TS;
    if (RM) return o;
    const sk = () => LOOKS.skin[lookOf(p).skin];
    const typing = (ms) => { const k = Math.floor(t / ms); R(X + 1 + (k % 2), FY + 2, 2, 1, sk()); R(X + 5 - (k % 2), FY + 2, 2, 1, sk()); };
    switch (role) {
      case 'call': {
        const talking = (t / 1000 + h) % 2.4 < 1.6;
        o.fx = { mouth: talking && Math.floor(t / 140) % 2 === 0 };
        o.post = () => {
          const y = FY - 10;
          R(X + 7, y, 2, 4, '#0C2E60'); R(X + 7, y + 3, 1, 2, sk());
          if (talking) { const k = Math.floor(t / 200) % 3; R(X - 1, FY - 6 - k, 1, 2, sk()); for (let i = 0; i <= k; i++) R(X + 10 + i * 2, y + 1 - i, 1, 2 + i * 2, 'rgba(255,255,255,.65)'); }
          else R(X + 1, FY + 2, 2, 1, sk());
          if ((t / 1000 + h) % 5 < 1.3) wordBubble(X + 4, FY - 13, ['HELLO?', 'CASH OFFER', 'AS-IS?', 'DEAL!', 'CALL ME', 'HOW MUCH?'][Math.floor(t / 5000 + h) % 6], '#0C2E60');
        };
        break;
      }
      case 'paper': {
        const k = Math.floor(t / 380 + h) % 2;
        o.post = () => {
          const stack = 2 + Math.floor((t / 1500 + h) % 5);
          for (let i = 0; i < stack; i++) R(X - 7, FY + 1 - i, 6, 1, i % 2 ? '#EDF2F8' : '#ffffff');
          R(X + 5, FY - 1 - k * 4, 3, 2, '#CB252B'); R(X + 6, FY - 3 - k * 4, 1, 2, '#2b2b33'); R(X + 1, FY + 2, 2, 1, sk());
          if (k === 0 && chance(2.5, dt)) spawn(X + 6, FY, (Math.random() - 0.5) * 16, -16, 0.8, '#CB252B', 20);
          if ((t / 1000 + h) % 4.5 < 1) wordBubble(X + 4, FY - 13, (t / 4500 + h) % 2 < 1 ? 'SIGNED' : 'UNDER CONTRACT', '#CB252B');
          if (chance(0.3, dt)) spawn(X - 4, FY - 2, -10, -22, 1.2, '#ffffff', 40, 'big');
        };
        break;
      }
      case 'mail': {
        o.post = () => {
          typing(110);
          if (chance(1.3, dt)) spawn(X + 10, FY - 10, 14 + Math.random() * 10, -16 - Math.random() * 8, 1.6, '#fff', -4, 'mail');
          if ((t / 1000 + h) % 5 < 0.8) wordBubble(X + 4, FY - 13, 'SENT', '#0C2E60');
        };
        break;
      }
      case 'data': {
        o.post = () => {
          typing(70);
          if (chance(0.45, dt)) spawn(X + 2, FY - 14, (Math.random() - 0.5) * 6, -10, 1.4, { t: ['$', '%', '#'][Math.floor(Math.random() * 3)], c: '#4ade80' }, -2, 'glyph');
          if (chance(0.5, dt)) spawn(X + 8, FY - 12, (Math.random() - 0.3) * 8, -9, 1.8, '#fff', -2, 'house');
          if ((t / 1000 + h) % 6 < 0.9) wordBubble(X + 4, FY - 13, ['ARV?', 'COMPS', '$$$'][Math.floor(t / 6000 + h) % 3], '#0C2E60');
        };
        break;
      }
      case 'boss': {
        const sip = (t / 1000 + h) % 7 < 1.4;
        o.fx = { armsUp: !sip && (t / 1000 + h) % 7 > 4.5 };
        o.post = () => {
          if (sip) { R(X + 6, FY - 8, 3, 3, '#f4f7fb'); R(X + 6, FY - 6, 1, 1, sk()); R(X + 7, FY - 10, 1, 1, 'rgba(255,255,255,.7)'); }
          else if (!o.fx.armsUp) typing(260);
          if ((t / 1000 + h) % 9 < 1.1) wordBubble(X + 4, FY - 13, ['SHIP IT', 'NICE', 'LETS GO', 'CLOSE IT'][Math.floor(t / 9000 + h) % 4], '#CB252B');
        };
        break;
      }
      case 'arcade': {
        o.dir = 'up';
        const k = Math.floor(t / 90);
        o.post = () => {
          const sk = LOOKS.skin[lookOf(p).skin];
          R(X + (k % 2), FY - 5, 2, 1, sk); R(X + 6 - (k % 2), FY - 5, 2, 1, sk);
          const g = c.id === state.myId ? arcade.open : state.peerGame.get(c.id);
          if ((t / 1000 + h) % 4 < 1.2) wordBubble(X + 4, FY - 13, { snake: 'SNAKE', dash: 'DASH', duel: 'DUEL', type: 'TYPE' }[g] || 'GAME', '#0C2E60');
        };
        break;
      }
      case 'type': {
        const fast = effective(p) === 'focus';
        o.post = () => {
          const sk = LOOKS.skin[lookOf(p).skin], k = Math.floor(t / (fast ? 70 : 220));
          R(X + 1 + (k % 2), FY + 2, 2, 1, sk); R(X + 5 - (k % 2), FY + 2, 2, 1, sk);
          if (fast && chance(0.5, dt)) spawn(X + 6, FY - 10, 4, -6, 0.9, '#7fd3ff', 30);
          if (chance(fast ? 0.35 : 0.1, dt)) spawn(X + 2, FY - 14, (Math.random() - 0.5) * 6, -10, 1.4, { t: ['$', '%', '#', '!'][Math.floor(Math.random() * 4)], c: '#9be36b' }, -2, 'glyph');
          if (fast && chance(0.12, dt)) spawn(X + 10, FY - 4, 14, -18, 1.2, '#f6f3ee', 40, 'big');
        };
        break;
      }
      case 'argue': {
        const ph = (t / 1000 + h) % 3.2, yelling = ph < 1.3;
        o.fx = { red: yelling, angry: true, mouth: yelling, armsUp: yelling && Math.floor(t / 180) % 2 === 0 };
        o.dy = yelling && Math.floor(t / 120) % 2 ? -1 : 0;
        o.post = () => {
          if (yelling) wordBubble(X + 4, FY - 13 + o.dy, ARGUE[Math.floor(t / 3200 + h * 3) % ARGUE.length], '#d94a4a');
          if (yelling && chance(2, dt)) spawn(X + 3 + Math.random() * 3, FY - 14, (Math.random() - 0.5) * 8, -14, 0.6, 'rgba(255,255,255,.7)', 0, 'big');
        };
        break;
      }
      case 'eat': {
        const k = Math.floor(t / 110 + h);
        o.dy = k % 2; o.fx = { mouth: true };
        o.post = () => {
          const foods = ['#f2c14e', '#d94a4a', '#a8642c', '#7bd389', '#f08a4b', '#e86a92', '#f1e8da'];
          if (chance(9, dt)) spawn(X + 4, FY - 8, (Math.random() - 0.5) * 50, -30 - Math.random() * 30, 1, foods[Math.floor(Math.random() * foods.length)], 120);
          if (chance(0.25, dt)) spawn(X + 4, FY - 9, (Math.random() - 0.5) * 30, -50, 1.2, '#f6f3ee', 120, 'big');
          if ((t / 1000 + h) % 4 < 0.9) wordBubble(X + 4, FY - 13, EAT[Math.floor(t / 4000 + h) % EAT.length], '#a8642c');
        };
        break;
      }
      case 'dance': {
        const k = Math.floor(t / 230 + h * 4) % 4;
        o.dir = ['down', 'left', 'down', 'right'][k]; o.fx = { armsUp: k % 2 === 0, mouth: true }; o.dy = k % 2 ? -2 : 0;
        o.post = () => { if (chance(1.4, dt)) spawn(X + 2 + Math.random() * 4, FY - 14, (Math.random() - 0.5) * 6, -12, 1.6, '#ff6fb5', -1, 'heart'); };
        break;
      }
      case 'film': {
        o.dir = 'up';
        o.post = () => { R(X + 2, FY - 18, 4, 5, '#1d1626'); R(X + 3, FY - 17, 2, 3, '#7fe0ff'); R(X + 3, FY - 13, 2, 2, LOOKS.skin[lookOf(p).skin]); if (Math.floor(t / 500) % 2) R(X + 5, FY - 18, 1, 1, '#ff3b3b'); };
        break;
      }
      case 'paint': {
        o.dir = 'up';
        o.post = () => { const k = Math.floor(t / 200) % 3; R(X + 6 + k, FY - 16 + k, 1, 4, '#8a5c3b'); R(X + 6 + k, FY - 17 + k, 1, 1, ['#e86a92', '#5aa9e6', '#f2c14e'][Math.floor(t / 1400) % 3]); };
        break;
      }
      case 'cry': {
        o.fx = { mouth: true };
        o.post = () => {
          const y = FY - 12 + 2 + 3, k = Math.floor(t / 150) % 3;
          R(X + 2, y + 1 + k, 1, 1, '#7fd3ff'); R(X + 5, y + 1 + ((k + 1) % 3), 1, 1, '#7fd3ff');
          if (chance(5, dt)) spawn(X + (Math.random() < 0.5 ? 2 : 5), y + 1, (Math.random() - 0.5) * 20, -10, 0.9, '#7fd3ff', 80);
          const pud = 4 + Math.floor((t / 2000 + h) % 6);
          ctx.fillStyle = 'rgba(127,211,255,.45)'; ctx.fillRect(X + 4 - pud, FY + 1, pud * 2, 2);
          if ((t / 1000 + h) % 5 < 1.2) wordBubble(X + 4, FY - 13, 'WAAH', '#0C2E60');
        };
        break;
      }
      case 'breakdance': {
        const cyc = (t / 1000 + h) % 4;
        if (cyc < 1.4) { o.flip = true; o.dir = DIR4[Math.floor(t / 70) % 4]; o.fx = { armsUp: true, noShadow: true }; }
        else { o.dir = DIR4[Math.floor(t / 140) % 4]; o.dy = -(Math.floor(t / 140) % 2) * 2; o.fx = { armsUp: Math.floor(t / 280) % 2 === 0 }; o.dx = Math.floor(t / 560) % 2 ? 1 : -1; }
        o.post = () => {
          if (chance(6, dt)) spawn(X + 4 + (Math.random() - 0.5) * 14, FY - 6 - Math.random() * 8, 0, 0, 0.25, '#ffffff', 0);
          if (chance(1.5, dt)) spawn(332, 168, (Math.random() - 0.5) * 10, -14, 1.5, ['#f2c14e', '#ff6fb5', '#7fe0ff'][Math.floor(Math.random() * 3)], -1, 'note');
        };
        break;
      }
      case 'panic': {
        const sw = Math.sin(t / 260 + h);
        o.dx = Math.round(sw * 7) + (Math.random() < 0.5 ? -1 : 1) * (Math.random() < 0.5 ? 1 : 0);
        o.dir = Math.cos(t / 260 + h) > 0 ? 'right' : 'left';
        o.fx = { pale: true, armsUp: Math.floor(t / 300) % 2 === 0, mouth: true };
        o.post = () => {
          if (chance(4, dt)) spawn(X + o.dx + 4 + (Math.random() - 0.5) * 6, FY - 13, (Math.random() - 0.5) * 16, -8, 0.8, '#7fd3ff', 60);
          if ((t / 1000 + h) % 3 < 1) wordBubble(X + o.dx + 4, FY - 13, (t / 3000 + h) % 2 < 1 ? 'AAA' : '!!!', '#d94a4a');
        };
        break;
      }
      case 'smash': {
        o.dir = 'up';
        const sw = Math.floor(t / 250 + h) % 2;
        o.fx = { armsUp: sw === 0 };
        o.post = () => {
          if (sw === 0) R(X + 3, FY - 21, 2, 7, '#8a5c3b'); else R(X + 1, FY - 16, 6, 2, '#8a5c3b');
          if (sw === 1 && chance(12, dt)) spawn(X + 4, FY - 16, (Math.random() - 0.5) * 70, -40 - Math.random() * 30, 0.9, ['#f2c14e', '#9ad0e6', '#ffffff', '#5a2a3c'][Math.floor(Math.random() * 4)], 140);
          if ((t / 1000 + h) % 2.6 < 0.7) wordBubble(X + 4, FY - 22, (t / 2600 + h) % 2 < 1 ? 'CRASH' : 'SMASH', '#d94a4a');
        };
        break;
      }
      case 'snack': {
        const k = Math.floor(t / 300 + h) % 2;
        o.fx = { handMouth: k === 0 }; o.dy = 0;
        o.post = () => {
          const y = FY - 12 + 2; R(X + 6, y + 5, 3, 4, '#f2c14e'); R(X + 6, y + 5, 3, 1, '#d94a4a');
          if (k === 0 && chance(6, dt)) spawn(X + 5, y + 4, (Math.random() - 0.5) * 20, -10, 0.7, '#e0b050', 80);
          if ((t / 1000 + h) % 5 < 0.8) wordBubble(X + 4, FY - 11, 'NOM', '#a8642c');
        };
        break;
      }
    }
    return o;
  }

  // ================= rendering =================
  let lastT = performance.now();
  function loop(t) {
    if (!root.isConnected) { cleanup(); return; }
    NOW = t;
    const dt = Math.min(0.1, (t - lastT) / 1000); lastT = t;
    chars.forEach((c) => stepChar(c, dt));
    stepParts(dt);
    sim(dt);
    if (arcade.game) { arcade.game.update(dt); arcade.game.draw(); }
    if (RACE.rows.size) drawRace(t);
    if (arcade.open === 'type') { drawTypeLanes(t); if (TR.race && TR.race.state === 'countdown') { const c = $('ag-panel').querySelector('.tr-count'); if (c) c.textContent = String(Math.max(1, Math.ceil(TR.race.start_at - trNow()))); } }
    draw(t, dt);
    positionOverlay();
    requestAnimationFrame(loop);
  }
  function draw(t, dt) {
    ctx.drawImage(bg, 0, 0);
    const items = FURN.map((f) => ({ z: f.z, k: 0, f }));
    chars.forEach((c) => items.push({ z: c.py + TS, k: 1, c }));
    items.sort((a, b) => a.z - b.z || a.k - b.k);
    const posts = [];
    for (const it of items) {
      if (it.k === 0) { it.f.draw(); continue; }
      const c = it.c, p = personById(c.id); if (!p) continue;
      const moving = c.path.length > 0;
      const atSpot = !moving && c.spot && c.tx === c.spot[0] && c.ty === c.spot[1];
      const seatDir = !moving && SEATS.get(idx(c.tx, c.ty));
      const pose = moving ? 'walk' : seatDir ? 'sit' : 'stand';
      const gameHere = !moving && arcadeAt(c.tx, c.ty) && (c.id === state.myId ? arcade.open : state.peerGame.get(c.id));
      const a = gameHere ? activity(c, p, 'arcade', t, dt) : atSpot && c.role ? activity(c, p, c.role, t, dt) : { dx: 0, dy: 0, dir: null, flip: false, fx: {}, post: null };
      const dir = a.dir || seatDir || (atSpot && c.face) || c.dir;
      const X = Math.round(c.px) + a.dx, FY = Math.round(c.py) + TS + a.dy;
      if (a.flip) {
        ctx.save(); ctx.translate(0, 2 * (FY - 6)); ctx.scale(1, -1);
        drawChar(ctx, X, FY, lookOf(p), dir, 'stand', 0, a.fx); ctx.restore();
      } else drawChar(ctx, X, FY, lookOf(p), dir, pose, Math.floor(c.walkT / 0.13), a.fx);
      if (a.post) posts.push(a.post);
      if (state.selected === c.id) {
        const b = RM ? 0 : (Math.floor(t / 180) % 4 < 2 ? 0 : 1), ax = X + 4, ay = FY - 15 - b;
        R(ax - 3, ay - 4, 7, 1, '#CB252B'); R(ax - 2, ay - 3, 5, 1, '#CB252B'); R(ax - 1, ay - 2, 3, 1, '#CB252B'); R(ax, ay - 1, 1, 1, '#CB252B');
      }
    }
    drawParts();
    posts.forEach((f) => f());
    if (night()) {
      ctx.fillStyle = 'rgba(16,20,56,.32)'; ctx.fillRect(0, 0, W, H);
      for (const x of LAMPS) { const gr = ctx.createRadialGradient(x * 8 + 4, 288, 0, x * 8 + 4, 292, 24); gr.addColorStop(0, 'rgba(255,233,168,.35)'); gr.addColorStop(1, 'rgba(255,233,168,0)'); ctx.fillStyle = gr; ctx.fillRect(x * 8 - 22, 266, 52, 38); }
    }
  }

  // ---- overlay
  const overlay = $('overlay');
  const tags = new Map(), bubbles = new Map();
  ZONES.filter((z) => z.id !== 'hall').forEach((z) => {
    const s = document.createElement('div'); s.className = 'sign'; s.textContent = z.name;
    s.style.left = (((z.x0 + z.x1 + 1) / 2) * TS / W * 100) + '%';
    s.style.top = ((z.y0 * TS - (z.id === 'parking' ? 4 : 6)) / H * 100) + '%';
    overlay.appendChild(s);
  });
  { const s = document.createElement('div'); s.className = 'sign'; s.textContent = 'Arcade'; s.style.left = (34 * TS / W * 100) + '%'; s.style.top = ((19 * TS - 16) / H * 100) + '%'; overlay.appendChild(s); }
  const execSigns = EXEC_SEATS.map((_, k) => {
    const el = document.createElement('div'); el.className = 'sign'; el.style.background = '#CB252B';
    el.style.left = ((62.5 + 14 * k) * TS / W * 100) + '%'; el.style.top = ((14 * TS + 4) / H * 100) + '%';
    overlay.appendChild(el); return el;
  });
  function renderExecSign() {
    execSigns.forEach((el, k) => {
      const id = state.execIds[k], o = id && personById(id);
      el.textContent = o ? (o.id === state.myId ? 'Your office' : firstName(o) + '’s office') : 'Executive Office';
    });
  }
  function buildTags() {
    tags.forEach((el) => el.remove()); tags.clear();
    const narrow = overlay.clientWidth < 600, crowd = chars.size > 14;
    chars.forEach((c) => {
      const p = personById(c.id); if (!p) return;
      const b = document.createElement('button'); b.type = 'button';
      const me = c.id === state.myId, sel = state.selected === c.id;
      b.className = 'tag' + (state.online.has(c.id) || me ? ' live' : '') + (me ? ' me' : '') + (sel ? ' sel' : '') + ((narrow || crowd) && !me && !sel && !state.online.has(c.id) ? ' hide' : '');
      const nm = document.createElement('span'); nm.textContent = me ? 'You' : firstName(p);
      b.appendChild(nm);
      if (p.note && !narrow) { const tk = document.createElement('small'); tk.textContent = p.note; b.appendChild(tk); }
      b.title = nameOf(p) + ' · ' + labelOf(p) + (p.note ? ' · ' + p.note : '');
      b.addEventListener('click', () => select(c.id));
      overlay.appendChild(b); tags.set(c.id, b);
    });
  }
  function positionOverlay() {
    chars.forEach((c) => {
      const moving = c.path.length > 0, sit = !moving && SEATS.has(idx(c.tx, c.ty));
      const x = (c.px + 4) / W * 100, top = c.py + TS - 15 + (sit ? 2 : 0);
      const t = tags.get(c.id);
      if (t) { t.style.left = x + '%'; t.style.top = (top / H * 100) + '%'; }
      const b = bubbles.get(c.id);
      if (b) { b.el.style.left = x + '%'; b.el.style.top = ((top - 9) / H * 100) + '%'; }
    });
  }
  function bubble(id, text) {
    const old = bubbles.get(id); if (old) { old.el.remove(); clearTimeout(old.t); }
    const el = document.createElement('div'); el.className = 'bubble'; el.textContent = text;
    overlay.appendChild(el);
    bubbles.set(id, { el, t: setTimeout(() => { el.remove(); bubbles.delete(id); }, 6500) });
    positionOverlay();
  }
  const ro = new ResizeObserver(() => buildTags()); ro.observe(overlay);

  // ================= side panels =================
  let rosterSig = '';
  function renderRoster(force) {
    const list = people();
    const where = (p) => {
      if (exiting.has(p.id) || arriving.has(p.id)) return 'parking';
      const c = chars.get(p.id); if (!c) return placeOf(p) === 'field' ? 'field' : effective(p) === 'out' ? 'out' : 'away';
      return c.zone;
    };
    const sig = list.map((p) => p.id + ':' + where(p) + ':' + labelOf(p) + ':' + p.note + ':' + (state.ownerId || '') + ':' + (state.online.has(p.id) ? 1 : 0) + ':' + (state.selected === p.id ? 1 : 0) + ':' + nameOf(p) + ':' + ago(p.updatedAt)).join('|');
    if (sig === rosterSig && !force) return; rosterSig = sig;
    const box = $('roster'); box.textContent = '';
    const order = ['exec', 'exec2', 'ops', 'data', 'meeting', 'social', 'lunch', 'break', 'hall', 'parking', 'field', 'outside', 'out'];
    const names = { out: 'Drove home', field: 'In the field', ...Object.fromEntries(ZONES.map((z) => [z.id, z.name])), outside: 'Outside' };
    for (const zid of order) {
      const ps = list.filter((p) => where(p) === zid).sort((a, b) => firstName(a).localeCompare(firstName(b)));
      if (!ps.length) continue;
      const g = document.createElement('div'); g.className = 'group';
      const h = document.createElement('h3'); const hn = document.createElement('span'); hn.textContent = names[zid];
      const hc = document.createElement('span'); hc.textContent = ps.length; h.append(hn, hc); g.appendChild(h);
      for (const p of ps) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'person' + (state.selected === p.id ? ' sel' : '');
        const img = document.createElement('img'); img.alt = ''; img.src = avatarURL(lookOf(p));
        const nm = document.createElement('span'); nm.className = 'nm' + (state.online.has(p.id) || p.id === state.myId ? ' live' : '');
        nm.textContent = nameOf(p) + (p.id === state.myId && nameOf(p) !== 'You' ? ' (you)' : '');
        const ag = document.createElement('span'); ag.className = 'ago'; ag.textContent = p.visitor ? '' : ago(p.updatedAt);
        const line = document.createElement('span'); line.className = 'st';
        const dot = document.createElement('i'); dot.style.background = colorOf(p);
        line.append(dot, document.createTextNode(labelOf(p) + (isStale(p) ? ' · no update today' : p.note ? ' · ' + p.note : '')));
        b.append(img, nm, ag, line);
        b.addEventListener('click', () => select(p.id));
        g.appendChild(b);
      }
      box.appendChild(g);
    }
  }
  function renderStats() {
    const st = people().filter((p) => !p.visitor).map(effective);
    $('s-in').textContent = st.filter((s) => s !== 'out').length;
    $('s-meet').textContent = st.filter((s) => s === 'meeting').length;
    $('s-break').textContent = st.filter((s) => s === 'break').length;
    $('s-out').textContent = people().filter((p) => !p.visitor && isGone(p)).length;
    $('s-in').textContent = people().filter((p) => !p.visitor && !isGone(p)).length;
    renderExecSign();
    $('s-live').textContent = state.watching;
    const banner = $('banner'), mine = myDoc();
    if (mine && mine.hub && mine.hub.shift === 'off') { banner.hidden = false; banner.innerHTML = '<b>You’re off shift,</b> so your character is at home. Clock in and you’ll drive into the office.'; }
    else banner.hidden = true;
  }
  function tickClock() {}
  function select(id) {
    state.selected = state.selected === id ? null : id;
    buildTags(); renderRoster(true);
    if (state.selected) { const el = root.querySelector('.person.sel'); if (el) el.scrollIntoView({ block: 'nearest' }); }
  }

  // ---- activity feed
  const feed = [];
  function log(p, text, kind, at) {
    feed.unshift({ t: at || Date.now(), p, text, kind });
    feed.sort((a, b) => b.t - a.t); feed.length = Math.min(feed.length, 40);
    const box = $('feed'); box.textContent = '';
    for (const e of feed) {
      const ln = document.createElement('div'); ln.className = 'ln';
      const tm = document.createElement('time'); tm.textContent = new Date(e.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const img = document.createElement('img'); img.alt = ''; img.src = avatarURL(lookOf(e.p));
      const b = document.createElement('b'); b.textContent = e.p.id === state.myId ? 'You' : firstName(e.p);
      const s = document.createElement('span'); if (e.kind === 'say') s.className = 'say';
      s.textContent = e.text;
      ln.append(tm, img, b, s); box.appendChild(ln);
    }
  }

  // ---- you card
  const picks = $('picks');
  PICKS.forEach((k) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pick'; b.id = 'pick-' + k; b.dataset.k = k;
    const i = document.createElement('i'); i.style.background = STATUSES[k].color;
    const lb = document.createElement('span'); lb.textContent = PICK_TEXT[k][0];
    const sm = document.createElement('small'); sm.textContent = PICK_TEXT[k][1];
    b.append(i, lb, sm);
    b.addEventListener('click', () => { pick = k; touched = true; syncPicks(); renderDetect(); });
    picks.appendChild(b);
  });
  const syncPicks = () => { for (const b of picks.children) b.setAttribute('aria-pressed', String(b.dataset.k === pick)); };
  syncPicks();
  $('note').addEventListener('input', () => { touched = true; renderDetect(); });
  const CHIPS = ['Calling sellers', 'Comping a property', 'Writing a contract', 'Answering emails', 'Skip tracing a list', 'Filming a reel', 'Designing a flyer', 'Showing a property'];
  CHIPS.forEach((c) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = c; b.addEventListener('click', () => { $('note').value = c; touched = true; const t = detectTask(c); pick = t && t.id === 'meeting' ? 'meeting' : t && ['content', 'design'].includes(t.id) ? 'social' : 'focus'; syncPicks(); renderDetect(); }); $('chips').appendChild(b); });
  function renderDetect() {
    const typed = $('note').value.trim(), hubTask = myDoc()?.hub?.task;
    const src = typed || (hubTask ? hubTask.title : '');
    const t = detectTask(src);
    const el = $('detect'); el.textContent = '';
    if (!DESK_STATUSES.includes(pick)) { el.textContent = 'You picked “' + PICK_TEXT[pick][0] + '”, so you go to the ' + PICK_TEXT[pick][1] + '.'; return; }
    if (!src) { el.textContent = 'No In Progress task in the Hub, so you work at your desk.'; return; }
    const b = document.createElement('b'); b.textContent = t ? t.label : 'Working';
    el.append(document.createTextNode((typed ? 'Your note' : 'Your Hub task “' + hubTask.title + '”') + ' → '), b,
      document.createTextNode(t ? ': your character ' + t.does + '.' : ': your character works at the desk.'));
  }
  renderDetect();
  const msg = (t, err) => { const m = $('msg'); m.textContent = t; m.className = 'msg' + (err ? ' err' : ''); };

  function renderClock() {
    const h = myDoc()?.hub; const row = $('clockrow'), line = $('shiftline');
    if (!h) { row.textContent = ''; line.textContent = ''; return; }
    const sig = h.shift + ':' + (h.task ? h.task.id : '');
    if (row.dataset.sig === sig) return; row.dataset.sig = sig; row.textContent = '';
    const b = (label, cls, action, extra) => { const x = document.createElement('button'); x.type = 'button'; x.className = 'btn ' + cls; x.textContent = label;
      x.addEventListener('click', async () => { x.disabled = true; await clockAction(action, extra); HUB.refresh(); }); row.appendChild(x); };
    if (h.shift === 'off') b('Clock in', 'primary', 'clock-in');
    else if (h.shift === 'on') { b('Break', 'ghost', 'break-start', { kind: 'Break' }); b('Lunch', 'ghost', 'break-start', { kind: 'Lunch' }); b('Clock out', 'ghost', 'clock-out'); }
    else b('End ' + h.shift, 'primary', 'break-end');
    line.textContent = '';
    const st = document.createElement('b'); st.textContent = { off: 'Off shift', on: 'On shift', break: 'On break', lunch: 'At lunch' }[h.shift];
    line.append(st, document.createTextNode(h.task ? ' · Hub task: ' + h.task.title + (h.task.client ? ' (' + h.task.client + ')' : '') : ' · no In Progress task'));
  }
  function renderMe() {
    renderClock();
    const meP = state.myId ? personById(state.myId) : null;
    const L = meP ? lookOf(meP) : (draftLook || defaultLook('guest'));
    $('meimg').src = avatarURL(L);
    $('mename').textContent = meP ? nameOf(meP) : (db ? 'Not signed in' : 'Preview mode');
    const c = state.myId && chars.get(state.myId);
    $('mesub').textContent = meP ? (labelOf(meP) + (c ? ' · ' + zoneAt(c.tx, c.ty).name : placeOf(meP) === 'field' ? ' · out in your car' : '')) : 'Open on claude.ai to join in';
  }
  function setReadOnly(text) {
    readOnly = true;
    for (const id of ['save', 'savelook', 'note']) $(id).disabled = true;
    for (const b of picks.children) b.disabled = true;
    msg(text);
  }
  let writeChain = Promise.resolve();
  function writeMine(patch) {
    const cur = myDoc()?.hub || {};
    const body = {
      note: 'note' in patch ? patch.note : (cur.note || ''),
      mode: 'status' in patch ? (patch.status === 'meeting' ? 'meeting' : patch.status === 'social' ? 'social' : '') : (cur.mode || ''),
    };
    if (patch.look) body.look = patch.look;
    writeChain = writeChain.catch(() => {}).then(() => api('POST', '/api/office/profile', body)).then(() => HUB.refresh());
    return writeChain;
  }
  function failed(e) { msg((e && e.message) || 'Could not save just now. Try again in a moment.', true); }
  async function saveStatus(status) {
    if (readOnly) return;

    $('save').disabled = true; msg('Saving…');
    try {
      const pr = writeMine({ status, note: $('note').value.trim().slice(0, 80), updatedAt: Date.now() });
      if (status !== 'out') pick = status; syncPicks(); touched = false;
      await pr;
      const tk = status !== 'out' && DESK_STATUSES.includes(status) ? detectTask($('note').value) : null;
      msg(tk?.room === 'field' ? 'Heading out to the field. Walking you to your car.' : 'Saved. Walking you over.');
      if (status !== 'out') { const c = chars.get(state.myId), sp = state.spots.get(state.myId); if (c && sp) { c.goal = null; setGoal(c, sp); } }
    } catch (e) { failed(e); }
    finally { if (!readOnly) $('save').disabled = false; }
  }
  $('save').addEventListener('click', () => saveStatus(pick));

  // ---- character editor
  const pv = $('preview'), pg = pv.getContext('2d'); pg.imageSmoothingEnabled = false;
  function renderPreview() { pg.clearRect(0, 0, 48, 16); ['down', 'left', 'up', 'right'].forEach((d, i) => drawChar(pg, 2 + i * 12, 15, draftLook, d, 'stand', 0)); }
  function buildEditor() {
    const box = $('optrows'); box.textContent = '';
    for (const k of LOOK_KEYS) {
      const row = document.createElement('div'); row.className = 'opt';
      const lab = document.createElement('span'); lab.textContent = LOOK_LABEL[k];
      const opts = document.createElement('div'); opts.className = 'opts'; opts.setAttribute('role', 'group'); opts.setAttribute('aria-label', LOOK_LABEL[k]);
      LOOKS[k].forEach((v, i) => {
        const b = document.createElement('button'); b.type = 'button';
        const isColor = v.startsWith('#');
        b.className = isColor ? 'sw' : 'word';
        if (isColor) { b.style.background = v; b.setAttribute('aria-label', LOOK_LABEL[k] + ' ' + (i + 1)); } else b.textContent = v;
        b.setAttribute('aria-pressed', String(draftLook[k] === i));
        b.addEventListener('click', () => { draftLook = { ...draftLook, [k]: i }; for (const s of opts.children) s.setAttribute('aria-pressed', String(s === b)); renderPreview(); renderMe(); });
        opts.appendChild(b);
      });
      row.append(lab, opts); box.appendChild(row);
    }
    renderPreview();
  }
  $('editor').addEventListener('toggle', () => {
    if ($('editor').open) { const meP = state.myId && personById(state.myId); draftLook = { ...(meP ? parseLook(meP.look, meP.id) : defaultLook(state.myId || 'guest')) }; buildEditor(); }
    renderMe(); renderRoster(true);
  });
  $('randlook').addEventListener('click', () => { const o = {}; for (const k of LOOK_KEYS) o[k] = Math.floor(Math.random() * LOOKS[k].length); draftLook = o; buildEditor(); renderMe(); });
  $('savelook').addEventListener('click', async () => {
    if (readOnly) return;

    $('savelook').disabled = true; msg('Saving character…');
    try { await writeMine({ look: { ...draftLook } }); msg('Character saved.'); $('editor').open = false; }
    catch (e) { failed(e); }
    finally { if (!readOnly) $('savelook').disabled = false; }
  });

  // ---- chat
  $('chatform').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('say').value.trim().slice(0, 120);
    if (!text) return;
    if (!state.myId) return;
    if (!chars.has(state.myId)) { msg('Clock in first. Your character is at home while you’re off shift.', true); return; }
    $('say').value = '';
    const meP = personById(state.myId);
    if (chars.has(state.myId)) bubble(state.myId, text);
    if (meP) log(meP, text, 'say');
    if (room) room.emit('say', { text }).catch((err) => msg(err.message || 'Message not sent', true));
    cv.focus();
  });

  // ---- map input
  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    const lx = (e.clientX - r.left) / r.width * W, ly = (e.clientY - r.top) / r.height * H;
    let hit = null;
    chars.forEach((c) => { if (lx >= c.px - 1 && lx <= c.px + 9 && ly >= c.py - 5 && ly <= c.py + 8) hit = c; });
    if (hit && hit.id !== state.myId) return select(hit.id);
    const cab = ARCADES.find(([x]) => lx >= x * TS && lx < x * TS + TS && ly >= 19 * TS - 13 && ly < 20 * TS + 2);
    if (cab) { goPlay(cab[1]); return; }
    const me = chars.get(state.myId);
    if (!me || me.exit) { if (state.selected) select(state.selected); return; }
    me.goal = null; setGoal(me, [Math.floor(lx / TS), Math.floor(ly / TS)]);
  });
  const onKey = (e) => {
    if (arcade.open) { arcadeKey(e); return; }
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape' && state.selected) { select(state.selected); return; }
    if (e.key === 'Enter' && document.activeElement === cv) { $('say').focus(); e.preventDefault(); return; }
    const k = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] }[e.key];
    if (!k || document.activeElement !== cv) return;
    e.preventDefault();
    const me = chars.get(state.myId); if (!me || me.exit || me.path.length > 1) return;
    const from = me.path.length ? me.path[me.path.length - 1] : [me.tx, me.ty];
    const nx = from[0] + k[0], ny = from[1] + k[1];
    if (walkable(nx, ny)) { me.path.push([nx, ny]); me.goal = nx + ',' + ny; }
    else me.dir = k[0] > 0 ? 'right' : k[0] < 0 ? 'left' : k[1] > 0 ? 'down' : 'up';
  };
  window.addEventListener('keydown', onKey);

  // ================= sample crew simulation =================
  const LINES = ['Who moved my spreadsheet', 'Budget is NOT fine', 'Going viral, hold on', 'Pizza is gone already??', 'I need a minute', 'The printer started it', 'Q4 is looking wild', 'Anyone seen my charger'];
  let simT = 3, chatT = 5, quinnT = 6;
  function sim(dt) {
    if (!state.sample || RM) return;
    simT -= dt; chatT -= dt; quinnT -= dt;
    if (simT <= 0) {
      simT = 3 + Math.random() * 3;
      const movers = SAMPLE.filter((p) => p.status === 'available' && chars.has(p.id));
      const p = movers[Math.floor(Math.random() * movers.length)];
      const c = p && chars.get(p.id), home = p && state.spots.get(p.id);
      if (c && home && !c.path.length) {
        c.goal = null;
        if (c.tx === home[0] && c.ty === home[1]) setGoal(c, [33 + Math.floor(Math.random() * 3), 12]); else setGoal(c, home);
      }
    }
    if (chatT <= 0) {
      chatT = 8 + Math.random() * 8;
      const ps = SAMPLE.filter((p) => chars.has(p.id));
      const p = ps[Math.floor(Math.random() * ps.length)];
      if (p) { const line = LINES[Math.floor(Math.random() * LINES.length)]; bubble(p.id, line); log(p, line, 'say'); }
    }
    if (quinnT <= 0) {
      quinnT = 24;
      const q = SAMPLE.find((p) => p.id === 's23'), j = SAMPLE.find((p) => p.id === 's24');
      q.note = q.note.startsWith('Walkthrough') ? 'Follow-up calls with buyers' : 'Walkthrough at 12 Pine St'; q.updatedAt = Date.now();
      j.note = j.note.startsWith('Showing') ? 'Writing the offer for 88 Elm' : 'Showing 88 Elm St'; j.updatedAt = Date.now();
      reconcile();
    }
  }

  // ================= arcade =================
  const GAMES = {
    snake: { name: 'Data Snake',    blurb: 'Eat the coins. Don’t hit the walls or yourself.', unit: 'coins' },
    dash:  { name: 'Deadline Dash', blurb: 'Flap through the filing cabinets.',               unit: 'cabinets' },
    duel:  { name: 'Office Duel',   blurb: 'Stapler, Memo, Scissors. First to 3.',            unit: 'wins' },
    type:  { name: 'Type Race',     blurb: 'Race your teammates typing a seller script. 2+ players.', unit: 'WPM' },
  };
  const arcade = { open: null, game: null };
  let pendingGame = null, lbTab = 'snake';
  const ag = $('agc'), agx = ag.getContext('2d'); agx.imageSmoothingEnabled = false;
  const A = (x, y, w, h, c) => { agx.fillStyle = c; agx.fillRect(x, y, w, h); };
  const AT = (str, x, y, col, s = 2) => { let cx = x; for (const ch of str) { const g = FONT[ch]; if (g) for (let i = 0; i < 15; i++) if (g[i] === '1') A(cx + (i % 3) * s, y + ((i / 3) | 0) * s, s, s, col); cx += 4 * s; } };
  const ATc = (str, y, col, s = 2) => AT(str, Math.round(120 - (str.length * 4 * s - s) / 2), y, col, s);
  const agMsg = (html) => { $('ag-msg').innerHTML = html; };
  const setScore = (v) => { $('ag-score').textContent = v; };
  const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.floor(Number(v)) : 0);
  const myBest = (k) => num(state.scores.get(state.myId)?.[k]);
  const myLook = () => { const meP = state.myId && personById(state.myId); return meP ? lookOf(meP) : defaultLook('guest'); };

  function goPlay(key) {
    const me = chars.get(state.myId);
    const x = ARCADES.find(([, k]) => k === key)[0];
    if (me && !me.exit) {
      if (me.tx === x && me.ty === 20 && !me.path.length) { openGame(key); return; }
      pendingGame = key; me.goal = null; setGoal(me, [x, 20]);
      msg('Walking to the ' + GAMES[key].name + ' machine…');
    } else openGame(key);
  }
  function openGame(key) {
    if (arcade.game?.stop) arcade.game.stop();
    arcade.open = key;
    $('arcade').hidden = false;
    $('ag-title').textContent = GAMES[key].name;
    setScore('');
    const pad = $('ag-pad'); pad.textContent = ''; pad.className = 'pad';
    const isDuel = key === 'duel' || key === 'type';   // panel games (no canvas, no d-pad)
    ag.hidden = isDuel; $('ag-panel').hidden = !isDuel;
    if (key === 'snake') {
      [['u', '▲', 'up'], ['l', '◀', 'left'], ['d', '▼', 'down'], ['r', '▶', 'right']].forEach(([c, t, k]) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = c; b.textContent = t; b.setAttribute('aria-label', k);
        b.addEventListener('pointerdown', (e) => { e.preventDefault(); arcade.game?.key(k); }); pad.appendChild(b);
      });
      arcade.game = Snake();
    } else if (key === 'dash') {
      pad.className = 'pad flap';
      const b = document.createElement('button'); b.type = 'button'; b.textContent = 'FLAP';
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); arcade.game?.key('action'); }); pad.appendChild(b);
      arcade.game = Dash();
    } else if (key === 'type') { arcade.game = null; typeOpen(); } else { arcade.game = null; duelReset(); }
    pad.hidden = isDuel;
    if (room) room.presence({ g: key }).catch(() => {});
    (isDuel ? $('ag-close') : ag).focus();
  }
  function closeGame() {
    if (arcade.open === 'type') typeClose();
    if (arcade.open === 'duel' && duel.view === 'match' && !duel.cpu) duelSend('bye');
    if (arcade.open === 'duel' && duel.view === 'waiting') duelSend('bye');
    arcade.open = null; arcade.game = null; duel.view = 'lobby';
    $('arcade').hidden = true;
    if (room) room.presence({ g: null }).catch(() => {});
    cv.focus();
  }
  $('ag-close').addEventListener('click', closeGame);
  $('arcade').addEventListener('pointerdown', (e) => { if (e.target === $('arcade')) closeGame(); });
  function arcadeKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); closeGame(); return; }
    const k = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right', ' ': 'action', Enter: 'action' }[e.key];
    if (!k || !arcade.game) return;
    if (e.target && e.target.tagName === 'BUTTON' && k === 'action') return;
    e.preventDefault(); arcade.game.key(k);
  }
  // swipe + tap on the game screen
  let swipe = null;
  ag.addEventListener('pointerdown', (e) => { swipe = { x: e.clientX, y: e.clientY }; ag.focus(); if (arcade.game && arcade.open === 'dash') arcade.game.key('action'); });
  ag.addEventListener('pointerup', (e) => {
    if (!swipe || !arcade.game || arcade.open !== 'snake') { swipe = null; return; }
    const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) { arcade.game.key('action'); return; }
    arcade.game.key(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
  });

  function finish(key, score) {
    const best = myBest(key);
    const rec = topScores(key)[0];
    let line = '<b>Game over.</b> ' + score + ' ' + GAMES[key].unit + '.';
    if (!state.myId) line += '';
    else if (score > best) { line += ' <b>New personal best!</b>'; writeScore(key, score); }
    else line += ' Your best is ' + best + '.';
    if (rec && rec.v > 0) line += ' Office record: ' + rec.v + '.';
    agMsg(line + ' Press Space or tap to play again.');
  }

  function Snake() {
    const N = 20, C = 12;
    let s, dir, next, food, score, acc, speed, dead, started;
    const rand = (n) => Math.floor(Math.random() * n);
    function place() { do { food = [rand(N), rand(N)]; } while (s.some(([x, y]) => x === food[0] && y === food[1])); }
    function reset() { s = [[9, 10], [8, 10], [7, 10]]; dir = [1, 0]; next = [1, 0]; score = 0; acc = 0; speed = 7; dead = false; started = false; place(); setScore(0); agMsg('Press an arrow key, swipe, or tap a direction to start. Best: ' + myBest('snake') + '.'); }
    reset();
    return {
      update(dt) {
        if (dead || !started) return;
        acc += dt; const step = 1 / speed;
        while (acc >= step) {
          acc -= step; dir = next;
          const hd = [s[0][0] + dir[0], s[0][1] + dir[1]];
          if (hd[0] < 0 || hd[1] < 0 || hd[0] >= N || hd[1] >= N || s.some(([x, y]) => x === hd[0] && y === hd[1])) { dead = true; finish('snake', score); return; }
          s.unshift(hd);
          if (hd[0] === food[0] && hd[1] === food[1]) { score++; setScore(score); speed = Math.min(16, 7 + score * 0.4); place(); } else s.pop();
        }
      },
      draw() {
        A(0, 0, 240, 240, '#0b1020');
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) A(x * C + 5, y * C + 5, 2, 2, '#16203a');
        const fx = food[0] * C, fy = food[1] * C, bob = Math.floor(NOW / 250) % 2;
        A(fx + 2, fy + 2 - bob, 8, 8, '#f2c14e'); A(fx + 3, fy + 1 - bob, 6, 10, '#f2c14e'); A(fx + 4, fy + 3 - bob, 4, 6, '#d9a020'); A(fx + 5, fy + 4 - bob, 2, 4, '#f2c14e');
        s.forEach(([x, y], i) => { A(x * C + 1, y * C + 1, C - 2, C - 2, i === 0 ? '#9be36b' : (i % 2 ? '#5cb85c' : '#4fa84f')); });
        const [hx, hy] = s[0];
        const ex = dir[0] === 0 ? [3, 7] : [dir[0] > 0 ? 7 : 3, dir[0] > 0 ? 7 : 3], ey = dir[1] === 0 ? [3, 7] : [dir[1] > 0 ? 7 : 3, dir[1] > 0 ? 7 : 3];
        A(hx * C + ex[0], hy * C + ey[0], 2, 2, '#0b1020'); A(hx * C + ex[1], hy * C + ey[1], 2, 2, '#0b1020');
        if (!started && !dead) ATc('DATA SNAKE', 96, '#f2c14e', 3);
        if (dead) { agx.fillStyle = 'rgba(11,16,32,.75)'; agx.fillRect(0, 0, 240, 240); ATc('GAME OVER', 96, '#ff6f7a', 3); ATc(String(score), 124, '#f2c14e', 3); }
      },
      key(k) {
        if (dead) { if (k === 'action') reset(); return; }
        const d = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[k];
        if (!d) return;
        if (started && d[0] === -dir[0] && d[1] === -dir[1]) return;
        next = d; started = true;
      },
    };
  }

  function Dash() {
    const PX = 64, GAP = 78, PW = 28, GRAV = 560, FLAP = -175;
    let y, vy, pipes, score, dead, started, spawnT, t0;
    function reset() { y = 110; vy = 0; pipes = []; score = 0; dead = false; started = false; spawnT = 0; t0 = 0; setScore(0); agMsg('Press Space, click or tap FLAP. Best: ' + myBest('dash') + '.'); }
    reset();
    const cabinet = (x, top, h) => {
      A(x, top, PW, h, '#9aa3ad'); A(x, top, 2, h, '#b8c0c8'); A(x + PW - 2, top, 2, h, '#7c858f');
      for (let yy = top + 6; yy < top + h - 4; yy += 16) { A(x + 3, yy, PW - 6, 12, '#aab2ba'); A(x + PW / 2 - 4, yy + 5, 8, 2, '#5a5a66'); }
    };
    return {
      update(dt) {
        if (!started || dead) return;
        t0 += dt; vy += GRAV * dt; y += vy * dt;
        spawnT -= dt;
        if (spawnT <= 0) { spawnT = 1.5; pipes.push({ x: 244, gy: 36 + Math.random() * (240 - 36 - GAP - 44), passed: false }); }
        const sp = 92 + score * 2;
        for (const p of pipes) {
          p.x -= sp * dt;
          if (!p.passed && p.x + PW < PX - 6) { p.passed = true; score++; setScore(score); }
          if (PX + 6 > p.x && PX - 6 < p.x + PW && (y - 10 < p.gy || y + 10 > p.gy + GAP)) dead = true;
        }
        pipes = pipes.filter((p) => p.x > -40);
        if (y > 222 || y < -10) dead = true;
        if (dead) finish('dash', score);
      },
      draw() {
        A(0, 0, 240, 240, '#f4f7fb');
        for (let x = 0; x < 240; x += 40) A((x - (t0 * 30) % 40 + 240) % 240, 30, 24, 16, '#bfe8ff');
        A(0, 222, 240, 18, '#cf9d6c'); for (let x = 0; x < 240; x += 12) A((x - (t0 * 92) % 12 + 240) % 240, 222, 1, 18, '#bf8d5c');
        for (const p of pipes) { cabinet(p.x, 0, p.gy); cabinet(p.x, p.gy + GAP, 222 - p.gy - GAP); }
        agx.save(); agx.scale(2, 2);
        drawChar(agx, (PX - 8) / 2, (y + 12) / 2, myLook(), dead ? 'down' : 'right', started && !dead ? 'walk' : 'stand', Math.floor(t0 / 0.08), { armsUp: vy < 0 && !dead, noShadow: true, mouth: dead });
        agx.restore();
        if (!started) ATc('DEADLINE DASH', 70, '#CB252B', 3);
        AT(String(score), 10, 10, '#2b2b33', 3);
        if (dead) { agx.fillStyle = 'rgba(20,18,24,.6)'; agx.fillRect(0, 0, 240, 240); ATc('MISSED IT', 96, '#ff6f7a', 3); ATc(String(score), 124, '#f2c14e', 3); }
      },
      key(k) {
        if (k !== 'action' && k !== 'up') return;
        if (dead) { reset(); return; }
        started = true; vy = FLAP;
      },
    };
  }

  // ---- Office Duel (rock-paper-scissors over the room, or vs the computer)
  const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const PICK = { rock: { name: 'Stapler', verb: 'crushes' }, paper: { name: 'Memo', verb: 'covers' }, scissors: { name: 'Scissors', verb: 'cut' } };
  const pickIcon = (() => { const cache = {}; return (k) => {
    if (cache[k]) return cache[k];
    const c = document.createElement('canvas'); c.width = 16; c.height = 16; const g = c.getContext('2d');
    const P = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    if (k === 'rock') { P(2, 9, 12, 4, '#5a5a66'); P(2, 5, 12, 4, '#d94a4a'); P(3, 6, 10, 1, '#f08a8a'); P(12, 8, 2, 2, '#9aa3ad'); }
    if (k === 'paper') { P(3, 2, 10, 12, '#f6f3ee'); P(3, 2, 10, 1, '#c4bdac'); for (let i = 0; i < 4; i++) P(5, 5 + i * 2, 6 - (i % 2) * 2, 1, '#5aa9e6'); P(10, 2, 3, 3, '#e5e0d5'); }
    if (k === 'scissors') { P(7, 2, 1, 8, '#c9c2b8'); P(8, 2, 1, 8, '#9aa3ad'); P(4, 9, 4, 4, '#e86a92'); P(8, 9, 4, 4, '#e86a92'); P(5, 10, 2, 2, '#1d1626'); P(9, 10, 2, 2, '#1d1626'); }
    return (cache[k] = c.toDataURL());
  }; })();
  const duel = { view: 'lobby', opp: null, gid: null, cpu: false, round: 1, me: 0, them: 0, myPick: null, oppPick: null, myLocked: false, oppLocked: false, sentReveal: false, resolved: false, oppLocks: new Set(), oppPicks: new Map(), last: '', note: '' };
  let inviteTimer = null;
  const oppName = () => duel.cpu ? 'The computer' : (personById(duel.opp) ? firstName(personById(duel.opp)) : 'Someone');
  function duelSend(t, extra = {}) { if (!room || duel.cpu || !duel.opp) return; room.emit('duel', { t, to: duel.opp, g: duel.gid, ...extra }).catch((e) => { if (e && e.code === 'not_permitted') { duel.note = 'Only Contributors and up can duel other people.'; duel.view = 'lobby'; renderDuel(); } }); }
  function duelReset() { duel.view = 'lobby'; duel.note = ''; renderDuel(); }
  function challenge(id) {
    Object.assign(duel, { opp: id, gid: Math.random().toString(36).slice(2, 10), cpu: false, view: 'waiting', note: '' });
    duelSend('inv'); renderDuel();
    clearTimeout(inviteTimer);
    inviteTimer = setTimeout(() => { if (duel.view === 'waiting') { duel.view = 'lobby'; duel.note = oppName() + ' didn’t answer.'; renderDuel(); } }, 30000);
  }
  function startMatch(cpu) {
    clearTimeout(inviteTimer);
    Object.assign(duel, { view: 'match', cpu: !!cpu, round: 1, me: 0, them: 0, oppLocks: new Set(), oppPicks: new Map(), last: '' });
    newRound();
  }
  function newRound() {
    Object.assign(duel, { myPick: null, oppPick: duel.oppPicks.get(duel.round) || null, myLocked: false, oppLocked: duel.oppLocks.has(duel.round), sentReveal: false, resolved: false });
    renderDuel();
  }
  function choose(p) {
    if (duel.view !== 'match' || duel.myLocked) return;
    duel.myPick = p; duel.myLocked = true;
    if (duel.cpu) setTimeout(() => { duel.oppPick = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)]; resolveRound(); }, 650);
    else { duelSend('lock', { r: duel.round }); if (duel.oppLocked) reveal(); }
    renderDuel();
  }
  function reveal() { if (duel.sentReveal) return; duel.sentReveal = true; duelSend('rev', { r: duel.round, p: duel.myPick }); if (duel.oppPick) resolveRound(); }
  function resolveRound() {
    if (duel.resolved || !duel.myPick || !duel.oppPick) return;
    duel.resolved = true;
    const a = duel.myPick, b = duel.oppPick;
    if (a === b) duel.last = 'Both picked ' + PICK[a].name + '. Tie.';
    else if (BEATS[a] === b) { duel.me++; duel.last = 'Your ' + PICK[a].name + ' ' + PICK[a].verb + ' their ' + PICK[b].name + '. Point to you!'; }
    else { duel.them++; duel.last = 'Their ' + PICK[b].name + ' ' + PICK[b].verb + ' your ' + PICK[a].name + '. Point to ' + oppName() + '.'; }
    duel.lastPicks = [a, b];
    if (duel.me >= 3 || duel.them >= 3) {
      duel.view = 'done';
      if (duel.me >= 3 && !duel.cpu) writeScore('duel', myBest('duel') + 1);
      const meP = state.myId && personById(state.myId), oP = personById(duel.opp);
      if (meP && !duel.cpu && duel.me >= 3 && oP) log(meP, 'won Office Duel against ' + firstName(oP) + ' ' + duel.me + '–' + duel.them);
    } else { const r = duel.round; setTimeout(() => { if (duel.view === 'match' && duel.round === r) { duel.round++; newRound(); } }, 1700); }
    renderDuel();
  }
  function renderDuel() {
    if (arcade.open !== 'duel') return;
    const box = $('ag-panel'); box.textContent = '';
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (label, cls, fn) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    if (duel.view === 'lobby') {
      setScore('');
      box.appendChild(el('div', '', 'Pick someone who’s online right now, or warm up against the computer.'));
      const list = el('div', 'opps');
      const others = [...state.online].filter((id) => id !== state.myId);
      if (!others.length) list.appendChild(el('div', 'empty', 'Nobody else has the Office page open right now.'));
      for (const id of others) {
        const p = personById(id); if (!p) continue;
        const b = el('button', 'person'); b.type = 'button';
        const img = el('img'); img.alt = ''; img.src = avatarURL(lookOf(p));
        const nm = el('span', 'nm live', nameOf(p));
        const go = el('span', 'ago', 'Challenge');
        b.append(img, nm, go); b.addEventListener('click', () => challenge(id)); list.appendChild(b);
      }
      box.appendChild(list);
      box.appendChild(btn('Play the computer', 'ghost', () => startMatch(true)));
      agMsg(duel.note || 'Stapler crushes Scissors, Scissors cut Memo, Memo covers Stapler.');
      return;
    }
    if (duel.view === 'waiting') {
      box.appendChild(el('div', 'reveal', 'Waiting for ' + oppName() + ' to accept…'));
      box.appendChild(btn('Cancel', 'ghost', () => { duelSend('bye'); duelReset(); }));
      agMsg('They get a pop-up with your challenge.');
      return;
    }
    const sc = el('div', 'duel-score');
    const left = el('div'); left.append(document.createTextNode(duel.me), el('span', '', 'You'));
    const right = el('div'); right.append(document.createTextNode(duel.them), el('span', '', oppName()));
    sc.append(left, el('div', '', '–'), right); box.appendChild(sc);
    setScore('Round ' + duel.round);
    const picks = el('div', 'duel-picks');
    for (const k of ['rock', 'paper', 'scissors']) {
      const b = el('button'); b.type = 'button'; b.disabled = duel.myLocked || duel.view === 'done';
      b.setAttribute('aria-pressed', String(duel.myPick === k));
      const img = el('img'); img.alt = ''; img.src = pickIcon(k);
      b.append(img, el('span', '', PICK[k].name)); b.addEventListener('click', () => choose(k)); picks.appendChild(b);
    }
    box.appendChild(picks);
    box.appendChild(el('div', 'reveal', duel.resolved || duel.view === 'done' ? duel.last : duel.myLocked ? 'Locked in. Waiting for ' + oppName() + '…' : (duel.oppLocked ? oppName() + ' has picked. Your move.' : 'Make your pick.')));
    if (duel.view === 'done') {
      box.appendChild(el('div', 'reveal', duel.me >= 3 ? 'You win the match!' : oppName() + ' wins the match.'));
      const row = el('div', 'row');
      row.append(btn(duel.cpu ? 'Play again' : 'Rematch', 'primary', () => duel.cpu ? startMatch(true) : challenge(duel.opp)), btn('Back', 'ghost', duelReset));
      box.appendChild(row);
      agMsg(duel.cpu ? 'Wins against the computer don’t count toward the leaderboard.' : 'Match wins count toward the Office Duel leaderboard.');
    } else agMsg('First to 3 wins.');
  }
  function onDuelMsg(m) {
    if (m.isMe || !m.by || !state.myId) return;
    const d = m.data || {};
    if (d.to !== state.myId || typeof d.g !== 'string' || d.g.length > 12) return;
    const from = m.by, same = duel.opp === from && duel.gid === d.g;
    if (d.t === 'inv') {
      if (duel.view === 'match' || duel.view === 'waiting') { room.emit('duel', { t: 'dec', to: from, g: d.g }).catch(() => {}); return; }
      inviteToast(from, d.g); return;
    }
    if (!same) return;
    if (d.t === 'acc' && duel.view === 'waiting') startMatch(false);
    else if (d.t === 'dec' && duel.view === 'waiting') { duel.view = 'lobby'; duel.note = oppName() + ' passed this time.'; renderDuel(); }
    else if (d.t === 'bye' && (duel.view === 'match' || duel.view === 'waiting')) { duel.view = 'lobby'; duel.note = oppName() + ' left the duel.'; renderDuel(); }
    else if (d.t === 'lock' && duel.view === 'match' && Number.isInteger(d.r)) {
      duel.oppLocks.add(d.r);
      if (d.r === duel.round) { duel.oppLocked = true; if (duel.myLocked) reveal(); renderDuel(); }
    } else if (d.t === 'rev' && duel.view === 'match' && Number.isInteger(d.r) && BEATS[d.p]) {
      duel.oppPicks.set(d.r, d.p); duel.oppLocks.add(d.r);
      if (d.r === duel.round) { duel.oppPick = d.p; duel.oppLocked = true; if (duel.myLocked) { if (!duel.sentReveal) reveal(); else resolveRound(); } renderDuel(); }
    }
  }
  function inviteToast(from, gid) {
    const p = personById(from); if (!p) return;
    const t = document.createElement('div'); t.className = 'toast';
    const tx = document.createElement('div'); tx.textContent = nameOf(p) + ' challenges you to Office Duel.';
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn primary'; ok.textContent = 'Accept';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost'; no.textContent = 'Decline';
    const done = () => { clearTimeout(timer); t.remove(); };
    ok.addEventListener('click', () => { done(); openGame('duel'); Object.assign(duel, { opp: from, gid, cpu: false }); room.emit('duel', { t: 'acc', to: from, g: gid }).catch(() => {}); startMatch(false); });
    no.addEventListener('click', () => { done(); room.emit('duel', { t: 'dec', to: from, g: gid }).catch(() => {}); });
    row.append(ok, no); t.append(tx, row); $('toasts').appendChild(t);
    const timer = setTimeout(done, 25000);
  }

  // ---- Type Race: everyone types the same seller script; the server keeps the race and the results
  const TR = { race: null, offset: 0, key: '', poll: null, sentPos: 0, pending: 0, sendTimer: null, rows: new Map(), err: '' };
  async function trCall(method, url, body) {
    try { const r = await api(method, url, body); TR.offset = r.now - Date.now() / 1000; TR.race = r.race; TR.err = ''; return r; }
    catch (e) { TR.err = e.message || 'Connection problem'; return null; }
  }
  const trNow = () => Date.now() / 1000 + TR.offset;
  const trMine = () => TR.race && TR.race.players.find((p) => p.id === state.myId);
  async function typeOpen() {
    TR.key = ''; TR.sentPos = 0; TR.pending = 0; $('ag-panel').textContent = '';
    agMsg('Joining the race…');
    await trCall('POST', '/api/office/type/join', {});
    renderType();
    clearInterval(TR.poll);
    TR.poll = setInterval(async () => {
      if (arcade.open !== 'type' || cleaned) { clearInterval(TR.poll); return; }
      await trCall('GET', '/api/office/type'); renderType();
    }, 450);
  }
  function typeClose() {
    clearInterval(TR.poll); clearTimeout(TR.sendTimer); TR.sendTimer = null;
    const mine = trMine();
    if (mine && !mine.done) api('POST', '/api/office/type/leave', {}).catch(() => {});
    TR.key = '';
  }
  function sendPos(pos) {
    TR.pending = pos;
    const go = async () => {
      TR.sendTimer = null;
      if (TR.pending <= TR.sentPos) return;
      TR.sentPos = TR.pending;
      const r = await trCall('POST', '/api/office/type/progress', { pos: TR.sentPos });
      if (r) { renderType(); if (r.won) toast('You won the Type Race!', 'ok'); }
    };
    if (TR.race && pos >= TR.race.length) { clearTimeout(TR.sendTimer); go(); return; }   // the last key goes out at once
    if (!TR.sendTimer) TR.sendTimer = setTimeout(go, 160);
  }
  function renderType() {
    if (arcade.open !== 'type') return;
    const r = TR.race, mine = trMine(), box = $('ag-panel');
    const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
    const btn = (label, cls, fn) => { const b = el('button', 'btn ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
    const key = r ? r.id + ':' + r.state + ':' + !!mine : 'none:' + TR.err;
    const rebuild = key !== TR.key; TR.key = key;
    if (!r) {
      if (rebuild) { box.textContent = ''; box.append(el('div', 'reveal', TR.err || 'No race right now.'), btn('Open a new race', 'primary', typeOpen)); }
      agMsg(TR.err ? '' : 'Open a race and everyone in the Office gets an invite.'); setScore(''); return;
    }
    if (rebuild) {
      box.textContent = ''; TR.rows.clear();
      if (r.state === 'lobby') {
        box.append(el('div', 'reveal', 'Waiting for racers…'));
        box.append(el('div', 'tr-rows', null));
        const row = el('div', 'row');
        if (mine) row.append(btn('Start race', 'primary', async () => { await trCall('POST', '/api/office/type/start', {}); renderType(); }));
        row.append(btn('Leave', 'ghost', closeGame));
        box.append(row);
      } else if (r.state === 'countdown' || r.state === 'racing') {
        box.append(el('div', 'tr-count', ''));
        if (mine) {
          const ph = el('div', 'tr-phrase'); ph.id = 'of-tr-phrase'; box.append(ph);
          const inp = el('input', 'tr-input'); inp.id = 'of-tr-input'; inp.type = 'text'; inp.autocomplete = 'off'; inp.spellcheck = false;
          inp.setAttribute('autocapitalize', 'off'); inp.setAttribute('aria-label', 'Type the script'); inp.placeholder = 'Get ready…';
          inp.disabled = r.state !== 'racing';
          inp.addEventListener('paste', (e) => e.preventDefault());
          inp.addEventListener('input', () => {
            const ph2 = TR.race && TR.race.phrase; if (!ph2) return;
            const v = inp.value, ok = ph2.startsWith(v);
            inp.classList.toggle('bad', !ok);
            let n = 0; while (n < v.length && v[n] === ph2[n]) n++;
            drawPhrase(n);
            if (n > TR.sentPos || n > TR.pending) sendPos(n);           // the correctly typed part counts, even with a typo after it
            if (ok && v.length >= ph2.length) inp.disabled = true;
          });
          box.append(inp);
          if (r.state === 'racing') setTimeout(() => inp.focus(), 0);
        } else box.append(el('div', 'reveal', 'This race already started. Watch, then join the next one.'));
        box.append(el('div', 'tr-rows', null));
      } else {
        box.append(el('div', 'reveal', 'Results'));
        box.append(el('div', 'tr-rows', null));
        box.append(el('div', 'row', null));
        box.lastChild.append(btn('Race again', 'primary', typeOpen), btn('Close', 'ghost', closeGame));
      }
    }
    // live bits
    const rowsBox = box.querySelector('.tr-rows');
    const players = r.state === 'done' ? r.players.slice().sort((a, b) => (a.place || 99) - (b.place || 99) || b.pos - a.pos) : r.players;
    const sig = players.map((p) => p.id).join(',');
    if (rowsBox && rowsBox.dataset.sig !== sig) {
      rowsBox.dataset.sig = sig; rowsBox.textContent = ''; TR.rows.clear();
      players.forEach((p) => {
        const person = personById(p.id);
        const row = el('div', 'tr-row' + (p.id === state.myId ? ' me' : ''));
        const nm = el('b', null, p.id === state.myId ? 'You' : person ? firstName(person) : 'Someone');
        const cvs = el('canvas'); cvs.width = 200; cvs.height = 24; cvs.setAttribute('aria-hidden', 'true');
        const st = el('span', 'tr-stat', '');
        row.append(nm, cvs, st); rowsBox.append(row);
        TR.rows.set(p.id, { g: cvs.getContext('2d'), st });
      });
    }
    const t = trNow();
    players.forEach((p) => {
      const row = TR.rows.get(p.id); if (!row) return;
      const live = r.state === 'racing' && !p.done ? Math.round((p.pos / 5) / Math.max(1 / 60, (t - r.start_at) / 60)) : p.wpm;
      row.st.textContent = p.done ? (p.place === 1 ? '1st · ' : p.place === 2 ? '2nd · ' : p.place === 3 ? '3rd · ' : '#' + p.place + ' · ') + p.wpm + ' WPM'
        : r.state === 'lobby' ? (p.id === r.host ? 'host' : 'ready') : r.state === 'done' ? 'did not finish' : (live || 0) + ' WPM';
      row.p = p;
    });
    const cnt = box.querySelector('.tr-count');
    if (cnt) cnt.textContent = r.state === 'countdown' ? String(Math.max(1, Math.ceil(r.start_at - t))) : r.state === 'racing' ? 'GO!' : '';
    const inp = $('tr-input');
    if (inp && r.state === 'racing' && inp.disabled && !(mine && mine.done) && inp.value.length < r.length) { inp.disabled = false; inp.placeholder = 'Type here'; inp.focus(); }
    if ($('tr-phrase') && !$('tr-phrase').dataset.ready && r.phrase) { $('tr-phrase').dataset.ready = '1'; drawPhrase(0); }
    setScore(r.state === 'lobby' ? r.players.length + ' in' : r.state === 'done' ? 'Finished' : mine ? Math.round((mine.pos / Math.max(1, r.length)) * 100) + '%' : '');
    agMsg(r.state === 'lobby' ? (mine && r.players.length < 2 ? 'Everyone with the Office open got an invite. You can start alone, but it’s more fun with 2+.' : 'Start when everyone’s in.')
      : r.state === 'done' ? 'Best WPM goes on the Type Race leaderboard.' : 'Type the script exactly. Mistakes turn the box red until you fix them.');
  }
  function drawPhrase(n) {
    const el = $('tr-phrase'), ph = TR.race && TR.race.phrase; if (!el || !ph) return;
    el.textContent = '';
    const a = document.createElement('span'); a.className = 'ok'; a.textContent = ph.slice(0, n);
    const c = document.createElement('span'); c.className = 'cur'; c.textContent = ph.slice(n, n + 1);
    const b = document.createElement('span'); b.className = 'rest'; b.textContent = ph.slice(n + 1);
    el.append(a, c, b);
  }
  function drawTypeLanes(t) {
    const r = TR.race; if (!r) return;
    TR.rows.forEach((row, id) => {
      const p = row.p; if (!p) return;
      const g = row.g; g.imageSmoothingEnabled = false;
      const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
      P(0, 0, 200, 24, '#0b2550'); P(0, 3, 200, 18, '#143b75'); P(0, 3, 200, 1, '#f4f7fb'); P(0, 20, 200, 1, '#f4f7fb');
      for (let x = 14; x < 186; x += 12) P(x, 11, 5, 1, 'rgba(255,255,255,.3)');
      P(10, 3, 1, 18, '#f4f7fb');
      for (let y = 3; y < 21; y += 2) { P(186, y, 2, 2, (y / 2) % 2 ? '#fff' : '#111'); P(188, y, 2, 2, (y / 2) % 2 ? '#111' : '#fff'); }
      const frac = Math.min(1, p.pos / Math.max(1, r.length)), x = Math.round(6 + frac * 170);
      const person = personById(id), L = person ? lookOf(person) : defaultLook(id);
      const running = r.state === 'racing' && !p.done && !RM;
      drawChar(g, x, 21 + (p.done && !RM && Math.floor(t / 300) % 2 ? -1 : 0), L, p.done ? 'down' : 'right', running ? 'walk' : 'stand', Math.floor(t / 90), { armsUp: p.done, mouth: p.done });
      if (p.place === 1) { P(x + 10, 6, 5, 4, '#f2c94c'); P(x + 11, 10, 3, 2, '#f2c94c'); P(x + 10, 12, 5, 1, '#d4af37'); }
    });
  }
  function typeToast(from) {
    const p = personById(from); if (!p || arcade.open === 'type') return;
    const t = document.createElement('div'); t.className = 'toast';
    const tx = document.createElement('div'); tx.textContent = firstName(p) + ' opened a Type Race. Want in?';
    const row = document.createElement('div'); row.className = 'row';
    const ok = document.createElement('button'); ok.type = 'button'; ok.className = 'btn primary'; ok.textContent = 'Join race';
    const no = document.createElement('button'); no.type = 'button'; no.className = 'btn ghost'; no.textContent = 'Not now';
    const done = () => { clearTimeout(timer); t.remove(); };
    ok.addEventListener('click', () => { done(); goPlay('type'); });
    no.addEventListener('click', done);
    row.append(ok, no); t.append(tx, row); $('toasts').appendChild(t);
    const timer = setTimeout(done, 30000);
  }

  // ---- scores + leaderboard
  let scoreChain = Promise.resolve();
  function writeScore(key, value) {
    if (!state.myId) return;
    const cur = { snake: 0, dash: 0, duel: 0, ...(state.scores.get(state.myId) || {}) };
    cur[key] = key === 'duel' ? cur.duel + 1 : Math.max(cur[key], num(value));
    state.scores.set(state.myId, cur); renderArcade();
    scoreChain = scoreChain.catch(() => {}).then(() => api('POST', '/api/office/score', { game: key, value })).catch(() => {});
  }
  const topScores = (key) => [...state.scores.entries()].map(([id, s]) => ({ id, v: num(s[key]) })).filter((r) => r.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
  function renderArcade() {
    if (!root.isConnected) return;   // a late update for an Office page that's already closed
    const gbox = $('games'); gbox.textContent = '';
    for (const [, key] of ARCADES) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'game';
      const n = document.createElement('b'); n.textContent = GAMES[key].name;
      const e = document.createElement('em'); e.textContent = state.myId ? 'best ' + myBest(key) : '';
      const s = document.createElement('span'); s.textContent = GAMES[key].blurb;
      b.append(n, e, s); b.addEventListener('click', () => goPlay(key)); gbox.appendChild(b);
    }
    const tabs = $('lbtabs'); tabs.textContent = '';
    for (const [, key] of ARCADES) {
      const t = document.createElement('button'); t.type = 'button'; t.setAttribute('role', 'tab'); t.setAttribute('aria-selected', String(lbTab === key));
      t.textContent = GAMES[key].name; t.addEventListener('click', () => { lbTab = key; renderArcade(); }); tabs.appendChild(t);
    }
    const lb = $('lb'); lb.textContent = '';
    const rows = topScores(lbTab);
    if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.style.display = 'block'; li.textContent = 'No scores yet. Be the first on the board.'; lb.appendChild(li); return; }
    rows.forEach((r, i) => {
      const p = personById(r.id) || { id: r.id, look: null };
      const li = document.createElement('li'); if (r.id === state.myId) li.className = 'me';
      const rk = document.createElement('span'); rk.className = 'rk'; rk.textContent = i + 1;
      const img = document.createElement('img'); img.alt = ''; img.src = avatarURL(lookOf(p));
      const n = document.createElement('span'); n.className = 'n'; n.textContent = r.id === state.myId ? 'You' : (personById(r.id) ? nameOf(personById(r.id)) : 'Someone');
      const v = document.createElement('span'); v.className = 'v'; v.textContent = r.v;
      li.append(rk, img, n, v); lb.appendChild(li);
    });
  }
  renderArcade();

  // ================= live data =================
  function parseDoc(d) {
    const v = d.data() || {};
    let status = v.status === 'call' ? 'social' : v.status;
    if (!Object.prototype.hasOwnProperty.call(STATUSES, status) || status === 'visiting') status = 'available';
    return {
      id: d.id, status,
      note: typeof v.note === 'string' ? v.note.slice(0, 80) : '',
      updatedAt: Number(v.updatedAt) || 0,
      joinedAt: Number(v.joinedAt) || 0,
      look: parseLook(v.look, d.id),
      hub: v.hub || null,
    };
  }
  async function resolveProfiles() {
    if (!user) return;
    const ids = [...new Set([...state.real.map((p) => p.id), ...state.online, ...state.scores.keys(), ...(state.myId ? [state.myId] : []), ...(state.ownerId ? [state.ownerId] : [])])];
    if (!ids.length) return;
    try { state.profiles = await user.profiles(ids); } catch (_) {}
    renderArcade();
  }
  const prevStatus = new Map();
  function diffForFeed(first) {
    if (first) {
      [...state.real].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6).reverse()
        .forEach((p) => log(p, STATUSES[effective(p)].label + (p.note ? ' · ' + p.note : ''), 'status', p.updatedAt));
    } else {
      for (const p of state.real) {
        const prev = prevStatus.get(p.id), cur = p.status + '|' + p.note;
        if (prev === undefined) log(p, 'moved in · ' + STATUSES[p.status].label);
        else if (prev !== cur && p.status !== 'out') log(p, STATUSES[p.status].label + (p.note ? ' · ' + p.note : ''));
      }
    }
    prevStatus.clear(); state.real.forEach((p) => prevStatus.set(p.id, p.status + '|' + p.note));
  }

  async function boot() {
    tickClock();
    reconcile();
    requestAnimationFrame((t) => { lastT = t; requestAnimationFrame(loop); });

    const C = HUB;
    if (!C || typeof C.use !== 'function') { renderMe(); return; }
    const [dbNs, userNs, roomNs] = await Promise.all(['db', 'user', 'room'].map((n) => C.use(n).catch(() => null)));
    db = dbNs; user = userNs; room = roomNs;
    if (user) {
      state.myId = await user.id();
      const can = await user.can('data.write');
      if (can === false) setReadOnly('You can watch but not post. Ask the owner for Contributor access.');
    }
    await resolveProfiles();
    reconcile();
    if (db) {
      let first = true;
      db.collection('desks').onSnapshot(async (snap) => {
        state.real = snap.docs.filter((d) => d.exists).map(parseDoc);
        const wasSample = false;
        if (wasSample) {
          feed.length = 0; bubbles.forEach((b) => b.el.remove()); bubbles.clear(); parts.length = 0; moving.length = 0;
          SAMPLE.forEach((p) => { chars.delete(p.id); lastEff.delete(p.id); exiting.delete(p.id); arriving.delete(p.id); });
        }
        const mine = myDoc();
        if (mine && !prefilled && !touched) { prefilled = true; pick = mine.hub && PICKS.includes(mine.hub.mode) ? mine.hub.mode : 'focus'; syncPicks(); $('note').value = mine.hub ? mine.hub.note : ''; renderDetect(); }
        await resolveProfiles();
        if (!state.sample) diffForFeed(first);
        first = false;
        reconcile();
      }, (e) => { if (e && e.code !== 'revoked') msg('Live updates stopped. Reload the page to reconnect.', true); });
      db.doc('config/office').onSnapshot((d) => {
        const id = d.data()?.ownerId, ex = d.data()?.execIds || [];
        if (id !== state.ownerId || ex.join() !== state.execIds.join()) { state.ownerId = id; state.execIds = ex; reconcile(); }
      });
      db.collection('scores').onSnapshot(async (snap) => {
        const m = new Map();
        for (const d of snap.docs) if (d.exists) { const v = d.data() || {}; m.set(d.id, { snake: num(v.snake), dash: num(v.dash), duel: num(v.duel), type: num(v.type) }); }
        state.scores = m;
        await resolveProfiles();
        renderArcade();
      }, () => {});
    }
    if (room) {
      room.onPeers((ch) => {
        const viewers = ch.peers.filter((p) => p.kind === 'viewer' && !p.isMe && p.by);
        const pos = new Map(), games = new Map();
        for (const p of viewers) {
          const x = Number(p.presence?.x), y = Number(p.presence?.y);
          if (Number.isInteger(x) && Number.isInteger(y) && walkable(x, y)) pos.set(p.by, [x, y]);
          if (GAMES[p.presence?.g]) games.set(p.by, p.presence.g);
        }
        state.peerGame = games;
        const online = new Set(viewers.map((p) => p.by));
        const changed = online.size !== state.online.size || [...online].some((id) => !state.online.has(id));
        state.online = online; state.peerPos = pos;
        state.watching = new Set(ch.peers.filter((p) => p.kind === 'viewer').map((p) => p.by || p.peer)).size;
        if (changed) resolveProfiles().then(reconcile);
        else pos.forEach((at, id) => { const c = chars.get(id); if (c && !c.exit) { c.live = true; setGoal(c, at); } });
        renderStats();
        if (arcade.open === 'duel' && duel.view === 'lobby') renderDuel();
      }, () => {});
      room.on('duel', onDuelMsg, () => {});
      room.on('type', (e, me) => { const p = personById(e.uid); if (!p) return; log(p, e.text); if (e.what === 'open' && e.uid !== me) typeToast(e.uid); if (e.what === 'win') HUB.refresh(); }, () => {});
      room.on('say', (m) => {
        if (m.isMe || !m.by) return;
        const text = String(m.data?.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
        if (!text) return;
        const p = personById(m.by); if (!p) return;
        if (chars.has(m.by)) bubble(m.by, text);
        log(p, text, 'say');
      }, () => {});
      const meC = chars.get(state.myId); if (meC) room.presence({ x: meC.tx, y: meC.ty }).catch(() => {});
    }
  }


  // ================= Deadline Race =================
  const RACE = { data: null, rows: new Map(), timer: null, prev: new Map() };
  const hm = (v) => { if (!v) return ''; const [h, mm] = v.split(':').map(Number); return ((h % 12) || 12) + ':' + String(mm).padStart(2, '0') + (h < 12 ? ' AM' : ' PM'); };
  const mins = (m) => { m = Math.abs(m); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
  async function loadRace() {
    if (cleaned) return;
    try {
      const d = await api('GET', '/api/office/race');
      for (const r of d.racers) {   // announce finishers in the activity feed
        const was = RACE.prev.get(r.id);
        if (RACE.data && was && was !== 'finished' && r.state === 'finished') { const p = personById(r.id); if (p) log(p, 'crossed the Deadline Race finish line' + (r.ahead_min > 0 ? ', ' + mins(r.ahead_min) + ' ahead' : '')); }
        RACE.prev.set(r.id, r.state);
      }
      RACE.data = d; renderRace();
    } catch (_) { /* try again next round */ }
    if (!cleaned) RACE.timer = setTimeout(loadRace, 20000);
  }
  function renderRace() {
    const box = $('race'); box.textContent = ''; RACE.rows.clear();
    const d = RACE.data;
    try { $('race-day').textContent = '· ' + new Date(d.date + 'T12:00:00').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); } catch (_) { /* keep "today" */ }
    if (!d.racers.length) {
      const li = document.createElement('li'); li.className = 'empty';
      li.textContent = 'Nobody has time blocks today. Add a time block to a task (open the task, set the date and start and end time) to join the race.';
      box.appendChild(li); return;
    }
    for (const r of d.racers) {
      const li = document.createElement('li'); li.className = 'row-r' + (r.id === state.myId ? ' me' : '');
      const medal = document.createElement('span'); medal.className = 'medal' + (r.rank <= 3 ? ' g' + r.rank : ''); medal.textContent = r.rank;
      const nm = document.createElement('div'); nm.className = 'rname';
      const b = document.createElement('b'); b.textContent = r.id === state.myId ? 'You' : r.name;
      const sub = document.createElement('span');
      sub.textContent = r.state === 'finished' ? 'All ' + r.blocks + ' blocks done' : r.now ? 'Now: ' + r.now.title + ' (' + hm(r.now.start) + '–' + hm(r.now.end) + ')' : r.next ? 'Next: ' + r.next.title + ' at ' + hm(r.next.start) : 'Between blocks';
      sub.title = sub.textContent; nm.append(b, sub);
      const cvs = document.createElement('canvas'); cvs.width = 200; cvs.height = 24; cvs.setAttribute('aria-hidden', 'true');
      const st = document.createElement('div'); st.className = 'rstat';
      const top = document.createElement('b'); top.textContent = r.done + '/' + r.blocks + ' blocks';
      const ah = document.createElement('span');
      if (r.ahead_min > 0) { ah.className = 'ahead'; ah.textContent = mins(r.ahead_min) + ' ahead'; }
      else if (r.ahead_min < 0) { ah.className = 'behind'; ah.textContent = mins(r.ahead_min) + ' behind'; }
      else ah.textContent = r.state === 'finished' ? 'right on time' : 'on schedule';
      st.append(top, ah);
      li.append(medal, nm, cvs, st);
      li.title = (r.id === state.myId ? 'You' : r.name) + ': ' + Math.round(r.progress * 100) + '% of today’s blocked time done, plan says ' + Math.round(r.pace * 100) + '% by now';
      li.addEventListener('click', () => { if (chars.has(r.id) || personById(r.id)) select(r.id); });
      box.appendChild(li);
      RACE.rows.set(r.id, { r, g: cvs.getContext('2d') });
    }
  }
  function drawRace(t) {
    RACE.rows.forEach(({ r, g }) => {
      g.imageSmoothingEnabled = false;
      const P = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
      P(0, 0, 200, 24, '#9c2a26'); P(0, 3, 200, 18, '#b8322d'); P(0, 3, 200, 1, '#f4f7fb'); P(0, 20, 200, 1, '#f4f7fb');
      for (let x = 14; x < 186; x += 12) P(x, 11, 5, 1, 'rgba(255,255,255,.35)');
      P(10, 3, 1, 18, '#f4f7fb');                                     // start line
      for (let y = 3; y < 21; y += 2) { P(186, y, 2, 2, (y / 2) % 2 ? '#fff' : '#111'); P(188, y, 2, 2, (y / 2) % 2 ? '#111' : '#fff'); }   // finish
      const span = 170, x0 = 10;
      const px = Math.round(x0 + Math.min(1, r.pace) * span);            // where the plan says they should be
      if (r.state !== 'finished') { P(px, 3, 1, 9, '#fff'); P(px + 1, 3, 4, 3, '#fff'); }
      const p = personById(r.id), L = p ? lookOf(p) : defaultLook(r.id);
      const x = Math.round(x0 - 4 + Math.min(1, r.progress) * span);
      const running = r.state !== 'finished' && !!r.now && !RM;
      const hop = r.state === 'finished' && !RM && Math.floor(t / 300) % 2 ? -1 : 0;
      drawChar(g, x, 21 + hop, L, r.state === 'finished' ? 'down' : 'right', running ? 'walk' : 'stand', Math.floor(t / 110), { armsUp: r.state === 'finished', mouth: r.state === 'finished', pale: r.state === 'late', noShadow: false });
      if (r.state === 'finished' && r.rank === 1) { P(x + 10, 6, 5, 4, '#f2c94c'); P(x + 11, 10, 3, 2, '#f2c94c'); P(x + 10, 12, 5, 1, '#d4af37'); }
      if (r.state === 'late' && Math.floor(t / 400) % 2) { P(x + 9, 5, 1, 4, '#ff6b70'); P(x + 9, 10, 1, 1, '#ff6b70'); }
    });
  }
  const tick = setInterval(() => { if (!root.isConnected) return cleanup(); renderRoster(); renderStats(); renderMe(); }, 2000);
  let cleaned = false;
  function cleanup() { if (cleaned) return; cleaned = true; HUB.stop(); window.removeEventListener('keydown', onKey); clearInterval(tick); clearTimeout(RACE.timer); ro.disconnect(); }
  boot();
  loadRace();
}
