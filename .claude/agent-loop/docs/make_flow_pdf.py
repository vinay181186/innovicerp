# Builds "agentic ai/agent loop - full flow.pdf" — one user request followed through every
# Coursera loop step, with one table per step and the DC Vehicle No example throughout.
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
                                Preformatted, PageBreak, KeepTogether)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

F = 'C:/Windows/Fonts/'
pdfmetrics.registerFont(TTFont('A', F + 'arial.ttf'))
pdfmetrics.registerFont(TTFont('AB', F + 'arialbd.ttf'))
pdfmetrics.registerFont(TTFont('M', F + 'consola.ttf'))
pdfmetrics.registerFont(TTFont('MB', F + 'consolab.ttf'))
from reportlab.lib.fonts import addMapping
addMapping('A', 0, 0, 'A'); addMapping('A', 1, 0, 'AB'); addMapping('A', 0, 1, 'A'); addMapping('A', 1, 1, 'AB')

INK = colors.HexColor('#1f2937'); MUTED = colors.HexColor('#6b7280')
BLUE = colors.HexColor('#1d4ed8'); HEAD = colors.HexColor('#e8eefc'); LINE = colors.HexColor('#c7d2e5')
RED = colors.HexColor('#b91c1c'); ORANGE = colors.HexColor('#c2410c'); GREEN = colors.HexColor('#15803d')
CODEBG = colors.HexColor('#f4f6fa')

st = {
    'title': ParagraphStyle('t', fontName='AB', fontSize=20, leading=25, textColor=INK, spaceAfter=4),
    'sub': ParagraphStyle('s', fontName='A', fontSize=10.5, leading=14, textColor=MUTED, spaceAfter=10),
    'h1': ParagraphStyle('h1', fontName='AB', fontSize=14.5, leading=19, textColor=BLUE, spaceBefore=8, spaceAfter=4),
    'h2': ParagraphStyle('h2', fontName='AB', fontSize=11, leading=15, textColor=INK, spaceBefore=6, spaceAfter=3),
    'p': ParagraphStyle('p', fontName='A', fontSize=9.6, leading=13.2, textColor=INK, spaceAfter=4),
    'cell': ParagraphStyle('c', fontName='A', fontSize=8.6, leading=11, textColor=INK),
    'cellb': ParagraphStyle('cb', fontName='AB', fontSize=8.6, leading=11, textColor=INK),
    'code': ParagraphStyle('code', fontName='M', fontSize=8, leading=10.4, textColor=INK),
    'note': ParagraphStyle('n', fontName='A', fontSize=8.6, leading=11.5, textColor=MUTED, spaceAfter=4),
}
LOCK = '<font name="AB" color="#b91c1c">[LOCKED]</font>'
RULE = '<font name="AB" color="#c2410c">[RULE]</font>'
BUILT = '<font name="AB" color="#15803d">[BUILT-IN]</font>'

def P(t, s='p'): return Paragraph(t, st[s])
def code(t):
    return Table([[Preformatted(t, st['code'])]], colWidths=[180 * mm],
                 style=TableStyle([('BACKGROUND', (0, 0), (-1, -1), CODEBG), ('BOX', (0, 0), (-1, -1), 0.5, LINE),
                                   ('LEFTPADDING', (0, 0), (-1, -1), 7), ('TOPPADDING', (0, 0), (-1, -1), 5),
                                   ('BOTTOMPADDING', (0, 0), (-1, -1), 5)]))
def table(head, rows, widths):
    data = [[Paragraph(h, st['cellb']) for h in head]] + [[Paragraph(str(c), st['cell']) for c in r] for r in rows]
    t = Table(data, colWidths=[w * mm for w in widths], repeatRows=1)
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HEAD), ('GRID', (0, 0), (-1, -1), 0.4, LINE),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'), ('LEFTPADDING', (0, 0), (-1, -1), 4), ('RIGHTPADDING', (0, 0), (-1, -1), 4),
        ('TOPPADDING', (0, 0), (-1, -1), 3), ('BOTTOMPADDING', (0, 0), (-1, -1), 3)]))
    return t
def gap(h=4): return Spacer(1, h * mm)

S = []
# ---------------- cover ----------------
S += [P('The Agent Loop — full flow', 'title'),
      P('One request, followed from the moment you type it until the answer comes back. '
        'Each Coursera loop step is explained in plain words, with a table and the same example throughout. '
        'Innovic ERP &middot; 25-Nov-2026 &middot; approved by the owner', 'sub')]
S += [P('How to read the tags', 'h2'),
      table(['Tag', 'Meaning'], [
          [LOCK, 'Enforced automatically by a check script (hook) or by Claude Code. The agent cannot skip it.'],
          [RULE, 'Written instruction in the agent file. The agent is told to follow it; nothing forces it.'],
          [BUILT, 'Claude Code already does this for every agent. Nobody had to build it.'],
      ], [30, 150])]
S += [P('The example used on every page', 'h2'),
      P('You type: <b>"Add Vehicle No column to the Delivery Challan list."</b> '
        'The main Claude session plans it, then hands the work to the <b>erp-frontend</b> agent.')]
S += [P('The whole flow on one page', 'h2'),
      code('  YOU type the request\n'
           '     |\n'
           '  A. Main session plans  ->  you approve the plan\n'
           '  B. Main session writes the brief with the 5-line task card\n'
           '  C. Door check  ............................ [LOCKED] no card = agent not started\n'
           '     |\n'
           '  +-------------------- THE AGENT LOOP (repeats) --------------------+\n'
           '  | 1. Construct prompt   rules + task card + memory                  |\n'
           '  | 2. Generate response  the agent decides the next action           |\n'
           '  | 3. Parse response     Claude Code reads the tool call             |\n'
           '  | 4. Execute action     check script first, then the tool runs      |\n'
           '  | 5. Update memory      the result is saved, OK / ERROR             |\n'
           '  | 6. Continue?          DONE / BLOCKED / SAME ERROR / BUDGET -> stop |\n'
           '  +----------------------- else back to step 1 -----------------------+\n'
           '     |\n'
           '  D. Exit check  ............................ [LOCKED] LOOP block + proof\n'
           '  E. Main session checks, deploy gate, push to TEST, erp-test\n'
           '     |\n'
           '  YOU get the answer: what changed, where to look, what you must do'),
      gap(2),
      P('<b>Key idea:</b> the loop itself is built into Claude Code. What we added are the <b>rules</b> the agent '
        'follows inside the loop (its agent file) and the <b>locks</b> around it (check scripts). '
        'Like a car: Claude Code is the engine; we added the driving rules, brakes and seat belts.', 'p')]
S += [PageBreak()]

# ---------------- A, B, C ----------------
S += [P('A. You type the request &rarr; the main session plans', 'h1'),
      P('Nothing is built yet. The main Claude session (the one you talk to) reads the code, finds the right '
        'file and field, and shows you a plan. Owner rule: no code until you approve the plan.'),
      table(['What happens', 'Who', 'Tag'], [
          ['You type the request in plain words', 'You', '-'],
          ['Read the DC list file, check the vehicle_no field in the database', 'Main session', RULE],
          ['Show the plan (6 points) and wait', 'Main session', RULE + ' owner rule in CLAUDE.md'],
          ['You say "approve"', 'You', '-'],
      ], [105, 35, 40]),
      gap(),
      P('B. The main session writes the brief (the 5-line task card)', 'h1'),
      P('The brief is the job sheet handed to the agent. It always starts with five lines, so the agent '
        'knows exactly what, where, and when it is finished.'),
      table(['Line', 'What it says', 'Example'], [
          ['GOAL', 'What you want, in one sentence', 'Add Vehicle No column to DC list'],
          ['FILES', 'The exact files it may change', 'apps/web/src/modules/dc/dc-list.tsx'],
          ['WORKTREE', 'Which copy of the code to work in', 'C:/Innovic_projects/innovic-erp/wt-layout'],
          ['DONE TEST', 'How we know it works', 'Vehicle No column shows on DC list on TEST'],
          ['LIMITS', 'What it must not touch', 'No backend, no other screens'],
      ], [24, 60, 96]),
      P('Where defined: owner rule in <b>CLAUDE.md</b> (every session reads it) and <b>_workflow.md</b> step 3.', 'note'),
      gap(),
      P('C. Door check — before the agent starts', 'h1'),
      P('A check script reads the brief before the agent is allowed to start.'),
      table(['Check', 'If it fails', 'Tag'], [
          ['All 5 card lines present?', 'Agent not started. The main session is told which lines are missing.', LOCK],
          ['WORKTREE is not innovicerp (the main copy the other terminal uses)?', 'Agent not started', LOCK],
          ['Remember the WORKTREE for this agent', 'Used later in step 4 to block edits outside it', LOCK],
      ], [70, 85, 25]),
      code('Example of a refusal (seen live on 25-Nov):\n'
           'ERP agent "erp-deploy-gate" not started: the brief is missing the task-card\n'
           'line(s) GOAL, FILES, WORKTREE, DONE TEST, LIMITS.'),
      P('Script: <b>~/.claude/hooks/erp-agent-guard.mjs</b> (mode "card"). Only the 11 ERP agents are checked.', 'note'),
      PageBreak()]

# ---------------- Step 1 ----------------
S += [P('Step 1 — Construct prompt', 'h1'),
      P('<b>What it does:</b> builds everything the AI reads before it decides. '
        'Coursera: <font name="M">prompt = agent_rules + memory</font>. Claude Code builds it automatically '
        'before every single step; we decide what goes into it.'),
      table(['Piece of the prompt', 'Coursera', 'ERP — what we defined', 'Where it lives', 'Tag'], [
          ['Who you are', '"You are an AI agent…"', 'Role: erp-frontend builds the web UI, only apps/web', 'erp-frontend.md', BUILT + ' sent every step'],
          ['Loop rules', 'Rules in the system message', 'STEP 0b: check brief, how to decide, retries, stop, report', 'all 11 agent files', RULE],
          ['Thinking rules', '"List files before reading"', 'The 9 "how to decide" rules (table below)', 'STEP 0b', RULE],
          ['Shared house rules', '-', 'No git, never PROD, folder ownership', '_house-rules.md (read at start)', RULE],
          ['Tool list', 'list_files, read_file, terminate', 'Read, Grep, Glob, Edit, Write, Bash', 'tools: line in agent file', BUILT],
          ['Answer format', '```action {json}```', 'Native tool call (no text format to get wrong)', 'Claude Code', BUILT],
          ['The task', 'user message', 'The 5-line task card', 'the brief', LOCK + ' card checked'],
          ['Memory', 'past actions + results', 'Every action and result, added automatically', 'Claude Code', BUILT],
      ], [27, 30, 52, 38, 33]),
      P('Example — what the erp-frontend prompt looks like on step 3 of the job', 'h2'),
      code('system:    [erp-frontend.md - role + STEP 0b loop + 9 thinking rules + tools]\n'
           'user:      GOAL / FILES / WORKTREE / DONE TEST / LIMITS     <- the task\n'
           'assistant: Read(_house-rules.md)                            <- action 1\n'
           'user:      [house rules text]                               <- result 1\n'
           'assistant: Read(dc-list.tsx)                                <- action 2\n'
           'user:      [file content]                                   <- result 2\n'
           '... the AI now decides action 3 from all of this'),
      P('The 9 thinking rules — and the real mistake each one stops', 'h2'),
      table(['#', 'Rule', 'Mistake it stops'], [
          ['1', 'Read before you change', 'Agent reported "DONE" with an edit that was never applied'],
          ['2', "Find, don't guess (names, fields, ids from the code)", 'Wrong field names written from memory'],
          ['3', 'Reuse first (DataTable, SearchableSelect, RowMenu…)', "A hand-built dropdown that wouldn't close"],
          ['4', 'Check look-alikes (Stop, Save, Qty…)', 'The Day Log "Stop" bug took 3 tries'],
          ['5', 'Numbers from the DB', 'Agents showed assumed quantities'],
          ['6', 'Smallest step', 'Big edits that break several things at once'],
          ['7', 'Stay in the brief', 'An agent touched files outside its job'],
          ['8', 'Names from docs/NAMING.md', 'New labels that clash with the naming standard'],
          ['9', 'Unsure &rarr; stop and ask', 'A wrong guess that costs a full redo'],
      ], [8, 72, 100]),
      PageBreak()]

# ---------------- Step 2 ----------------
S += [P('Step 2 — Generate response (the agent decides)', 'h1'),
      P('<b>What it does:</b> the prompt is sent to Claude, and Claude decides the next action. '
        'Coursera uses <font name="M">generate_response()</font> with LiteLLM; Claude Code does this itself '
        'through your Claude subscription (no extra API cost).'),
      table(['Item', 'Coursera', 'ERP', 'Tag'], [
          ['Who sends the prompt', 'generate_response() + LiteLLM', 'Claude Code, automatically', BUILT],
          ['Who decides', 'The LLM', 'Claude, using the rules + card + memory from step 1', BUILT],
          ['How it should decide', 'Rules in the prompt', '"Next: &lt;action&gt; because &lt;reason&gt;" + the 9 thinking rules', RULE],
          ['Can it be forced?', 'No', 'No — thinking happens inside the AI. We guide it with step 1 and guard step 4.', '-'],
      ], [32, 42, 80, 26]),
      P('Example', 'h2'),
      code('Next: read dc-list.tsx because I must see the existing columns first   (rule 1)\n'
           'Next: grep "DataTable" because a table component already exists           (rule 3)\n'
           'Next: add the Vehicle No column because that is the GOAL                   (rule 6)'),
      P('Why this step stays a written rule: you can lock the store room, but you cannot control what a worker '
        'is thinking. Coursera is the same — the model decides on its own; good rules go in, checks come after.', 'note'),
      gap(),
      # ---------------- Step 3 ----------------
      P('Step 3 — Parse response (read the decision)', 'h1'),
      P('<b>What it does:</b> turns the AI\'s answer into a tool call that can be run. '
        'Coursera cuts JSON out of a text block; Claude Code receives a structured tool call, so there is nothing to cut out.'),
      table(['Item', 'Coursera', 'ERP', 'Tag'], [
          ['Answer shape', 'Text with ```action {json}```', 'Native tool call: name + input', BUILT],
          ['Who parses', 'Your Python code', 'Nobody — it already arrives structured', BUILT],
          ['Bad format (bad JSON, wrong tool name)', 'Your code breaks', 'Cannot happen: each tool has a fixed schema', BUILT],
          ['Missing or wrong input (e.g. no file path)', 'You must catch it', 'Rejected; the AI is told the error and fixes it next step', BUILT],
      ], [40, 42, 72, 26]),
      P('Example', 'h2'),
      code('{ "type": "tool_use",\n  "name": "Read",\n  "input": { "file_path": "C:/.../wt-layout/apps/web/src/modules/dc/dc-list.tsx" } }\n'
           '-> schema check: file_path present and a string?  yes  -> go to step 4'),
      PageBreak()]

# ---------------- Step 4 ----------------
S += [P('Step 4 — Execute action (do the work)', 'h1'),
      P('<b>What it does:</b> runs the chosen tool — the real work. Coursera has 3 harmless tools and no checks. '
        'ERP tools can change code and databases, so <b>a check script looks at every action first</b>.'),
      P('Tools', 'h2'),
      table(['Coursera function', 'ERP tool', 'What it does'], [
          ['list_files()', 'Glob', 'Find files by name'],
          ['read_file(name)', 'Read', 'Open a file'],
          ['-', 'Grep', 'Search inside files'],
          ['-', 'Edit / Write', 'Change or create a file'],
          ['-', 'Bash', 'Run a command (build, query the TEST database)'],
          ['terminate(message)', 'Reply with no tool', 'End the job and give the report'],
      ], [40, 40, 100]),
      P('The guard before every action', 'h2'),
      table(['The agent tries…', 'Result', 'Tag'], [
          ['Read any file', 'Runs', '-'],
          ['Edit a file in its own folder inside the brief\'s WORKTREE', 'Runs', LOCK],
          ["Edit another agent's folder (frontend &rarr; apps/api, packages/shared, e2e)", 'Blocked', LOCK],
          ['Edit outside the WORKTREE, or in innovicerp', 'Blocked', LOCK],
          ['Edit Claude settings, hooks or agent files', 'Blocked', LOCK],
          ['git commit / push / stash / reset / checkout', 'Blocked (git status / diff / log are fine)', LOCK],
          ['PROD: DB_TARGET=PROD, PROD project, drizzle-kit migrate, db:push, release-prod.sh', 'Blocked', LOCK],
          ['A read-only agent (deploy-gate, mapper) tries to edit', 'Blocked', LOCK],
          ['apply-sql.ts on TEST, pnpm build, typecheck', 'Runs', '-'],
      ], [98, 55, 27]),
      P('Example', 'h2'),
      code('Agent:  Edit(dc-list.tsx, add Vehicle No column)\n'
           '  check: inside wt-layout? yes. inside apps/web? yes. -> RUNS -> "edit applied"\n\n'
           'Agent:  Bash(git commit -m "add column")\n'
           '  check: BLOCKED - "agents never run git that changes the repo. Leave the files\n'
           '         changed and say in your report what the main session must commit."'),
      P('A blocked action is not a crash: the message goes into memory (step 5) and the agent works around it. '
        'Tested: 56 of 56 sample actions behaved as expected.', 'note'),
      PageBreak()]

# ---------------- Step 5 ----------------
S += [P('Step 5 — Update memory (save the result)', 'h1'),
      P('<b>What it does:</b> the action and its result are added to memory, so the next prompt (step 1) '
        'includes them. The agent then labels the result and decides what that means.'),
      table(['Result', 'What the agent does', 'Tag'], [
          ['Saved into memory', 'Every action + result, automatically', BUILT],
          ['OK', 'Go on to the next step', RULE],
          ['ERROR', 'Change the approach — at most 2 retries for the same problem', RULE],
          ['UNEXPECTED', 'Stop and report — something is not as the brief said', RULE],
          ['Same error a 2nd time', 'Check script adds: "change your approach now"', LOCK],
          ['Same error a 3rd time', 'Check script adds: "SAME ERROR — STOP now, report it"', LOCK],
          ['Blocked by the guard', 'The "Blocked: …" message is saved; the agent must not work around it', LOCK],
      ], [40, 113, 27]),
      P('Example — memory growing during the job', 'h2'),
      code('action 4: Bash(pnpm --filter web build)\n'
           'result 4: ERROR  TS2304 cannot find name "vehicleNo"\n'
           '          -> ERROR: change approach -> read the type file first\n'
           'action 5: Read(packages/shared/src/dc.ts)        result 5: OK, field is "vehicle_no"\n'
           'action 6: Edit(dc-list.tsx, use vehicle_no)       result 6: OK\n'
           'action 7: Bash(pnpm --filter web build)           result 7: OK'),
      gap(),
      # ---------------- Step 6 ----------------
      P('Step 6 — Continue or stop?', 'h1'),
      P('<b>What it does:</b> after every result, decide: go round the loop again, or stop. '
        'Coursera stops on <font name="M">terminate</font> or at <font name="M">max_iterations</font>. '
        'The ERP has the same two ideas, sized for real ERP jobs.'),
      table(['Stop reason', 'When', 'Tag'], [
          ['DONE', 'The DONE TEST passed (or cannot be run here: "not run — needs …")', RULE + ' + exit check'],
          ['BLOCKED', 'Needs something outside its rights or the brief', RULE],
          ['SAME ERROR', 'Same failure 3 times', LOCK],
          ['UNCLEAR', 'Not sure what is wanted — ask instead of guessing', RULE],
          ['BUDGET (warning)', '150 actions (deploy-gate 80): "finish this step and report"', LOCK],
          ['Hard stop', '200 turns (deploy-gate 100): Claude Code stops the agent itself', LOCK + ' maxTurns'],
      ], [32, 115, 33]),
      P('Why 150 / 200 and not Coursera\'s 10: Coursera\'s example jobs take 2-5 steps. Past ERP jobs: erp-frontend '
        'needed about 77 actions, erp-backend 83, erp-test 81. The limit is a safety net for a stuck agent — a normal '
        'job finishes well before it. Work done before a stop stays saved; the main session continues the rest.', 'note'),
      code('Example:  action 7 build OK -> DONE TEST cannot run here (needs deploy to TEST)\n'
           '          -> Stopped: DONE, Proof: not run - needs deploy -> stop and report'),
      PageBreak()]

# ---------------- D, E ----------------
S += [P('D. Exit check — the report', 'h1'),
      P('Every agent ends its report with the LOOP block. A check script reads it before the main session accepts it.'),
      code('DONE: Vehicle No column added to the DC list\n'
           'LOOP\n'
           '  Actions used:   7 of 150\n'
           '  Retries:        1 - build failed on field name, read the type file, fixed\n'
           '  Stopped:        DONE\n'
           '  Proof:          not run - needs deploy to TEST\n'
           '  New rule found: none'),
      table(['Check', 'If it fails', 'Tag'], [
          ['LOOP block present?', 'Sent back once: "print the report again with the LOOP block"', LOCK],
          ['Stopped: DONE with empty Proof?', 'Sent back once: "DONE without proof is not done"', LOCK],
          ['Real action count', 'Logged next to the number the agent wrote (agents under-count)', LOCK],
      ], [55, 100, 25]),
      P('Script: ~/.claude/hooks/check-loop-block.mjs &middot; log: ~/.claude/agent-loop-log.tsv', 'note'),
      gap(),
      P('E. The main session finishes &rarr; the answer comes back to you', 'h1'),
      table(['Step', 'What happens', 'Tag'], [
          ['Check on disk', 'Open the file — is the edit really there? (agent "DONE" can hide an unapplied edit)', RULE],
          ['Deploy gate', 'erp-deploy-gate runs typecheck, lint, build — the same loop, steps C to D', LOCK + ' card + exit'],
          ['Commit + push to TEST', 'Done by the main session only (agents never run git)', LOCK],
          ['erp-test', 'Opens the DC list on TEST — the real DONE TEST', RULE],
          ['Answer to you', 'What was broken / what changed / what you must do', RULE],
      ], [35, 118, 27]),
      PageBreak()]

# ---------------- Mistakes each step stops ----------------
HB = '<font name="AB" color="#b91c1c">Happened before</font>'
CH = '<font name="AB" color="#c2410c">Could happen</font>'
S += [P('What mistakes each step stops', 'h1'),
      P('<b>Happened before</b> = this mistake really happened in our ERP work. '
        '<b>Could happen</b> = it has not happened yet, but it would be costly, so the step stops it before it ever does. '
        '(Like a factory: you check the drawing because a wrong part was cut last month, and you fit a machine guard '
        'before anyone gets hurt.)'),
      table(['Step', 'Mistake it stops', 'Example', 'Seen?'], [
          ['A. Plan first', 'Building the wrong thing and redoing it', 'Day Log "Stop" fix changed the wrong button twice; right on the 3rd try', HB],
          ['B. 5-line task card', 'Vague job: agent wanders and costs a lot', '"Find and fix every print button" cost 180k tokens; exact-file briefs cost 24k-53k', HB],
          ['C. Door check', 'Agent starts with no clear job or in the wrong code copy', '30 of 30 briefs without a card ran anyway; no agent said TASK UNCLEAR', HB],
          ['1. Rules in each agent file', 'Agent forgets the rules on long jobs', 'erp-deploy-gate skipped the LOOP report in 10 of 11 runs', HB],
          ['1. Thinking rules', 'Guessing, duplicate components, wrong control', "Hand-built dropdown that wouldn't close; assumed quantities shown", HB],
          ['2. "Next: … because …"', 'Random actions with no reason', 'Hard to see later why an agent changed something', CH],
          ['3. Parse', 'Badly formed action crashes the loop', "Coursera's text format can break; Claude Code's tool calls cannot", CH],
          ['4. Folder / worktree block', 'Two agents editing one file; work landing in the other terminal\'s copy', 'Agents hit forbidden shared files and stalled 3 times in one session', HB],
          ['4. Git block', "An agent commits files that aren't its own", 'One bare commit swept up 22 unrelated files', HB],
          ['4. PROD block', 'A change hits the live company database', 'One wrong DB_TARGET=PROD would change real data', CH],
          ['4. Settings block', 'An agent changes its own rules or checks', 'An agent could switch off its own guard', CH],
          ['5. Same-error check', 'Retrying the same failing step again and again', '5 of 5 agents that hit a missing file went searching other folders', HB],
          ['6. Stop rules + 150 / 200', 'An agent stuck in a loop, running forever', 'No limit before; the longest real run was 383 actions', CH],
          ['D. Exit check (LOOP + proof)', '"DONE" when it is not really done', 'An agent said DONE while its edit was never applied', HB],
          ['E. Check on disk + erp-test', "Code written but the screen doesn't work", '"Lint passed" treated as done while the owner\'s path was still broken', HB],
      ], [33, 47, 72, 28]),
      gap(2),
      P('<b>In short:</b> the early steps (A, B, C, 1) stop wrong or unclear work from starting; the middle steps '
        '(4, 5, 6) stop damage while working; the end steps (D, E) stop "done" claims that are not true.'),
      PageBreak()]

# ---------------- Summary ----------------
S += [P('Summary — every step on one page', 'h1'),
      table(['Step', 'What it does', 'Who does it', 'What we defined', 'Lock'], [
          ['A. Request + plan', 'Understand the job, plan, get approval', 'You + main session', 'Plan-first owner rule', RULE],
          ['B. Brief', 'Hand the job to the agent', 'Main session', '5-line task card', RULE],
          ['C. Door check', 'Refuse an unclear job', 'Check script', 'Card + WORKTREE check', LOCK],
          ['1. Construct prompt', 'Give the AI everything it needs', 'Claude Code', 'Agent file, STEP 0b, 9 thinking rules, card', RULE + ' / ' + BUILT],
          ['2. Generate', 'The AI decides the next action', 'Claude', '"Next: … because …"', RULE],
          ['3. Parse', 'Read the decision', 'Claude Code', 'nothing needed', BUILT],
          ['4. Execute', 'Run the tool', 'Claude Code + check script', 'git / PROD / folder / worktree blocks', LOCK],
          ['5. Update memory', 'Save the result', 'Claude Code + agent', 'OK / ERROR / UNEXPECTED, same-error check', BUILT + ' / ' + LOCK],
          ['6. Continue?', 'Loop again or stop', 'Agent + Claude Code', 'Stop reasons, 150 warning, 200 hard stop', LOCK],
          ['D. Exit check', 'Accept the report', 'Check script', 'LOOP block + proof', LOCK],
          ['E. Finish', 'Verify, deploy to TEST, answer you', 'Main session', 'Deploy gate, erp-test', RULE + ' / ' + LOCK],
      ], [27, 38, 30, 55, 30]),
      gap(),
      P('Where everything lives', 'h2'),
      table(['File', 'What is in it'], [
          ['.claude/agents/&lt;agent&gt;.md (11 files)', 'Role, STEP 0b loop + 9 thinking rules, tools, maxTurns 200 (deploy-gate 100)'],
          ['.claude/agents/_house-rules.md', 'THE AGENT LOOP in full, bans, folder ownership'],
          ['C:/Users/Asus/.claude/CLAUDE.md', 'Owner rule: every agent brief starts with the 5-line card'],
          ['~/.claude/hooks/erp-agent-guard.mjs', 'Door check, action guard, same-error check, budget warning'],
          ['~/.claude/hooks/check-loop-block.mjs', 'Exit check: LOOP block + proof'],
          ['~/.claude/settings.json', 'Switches the check scripts on'],
          ['~/.claude/agent-guard-log.tsv, agent-loop-log.tsv', 'Every block and every report check, for review'],
      ], [70, 110]),
      gap(),
      P('Not covered', 'h2'),
      P('The main session (the one you talk to) and Claude Code\'s built-in helpers (Explore, Plan, general-purpose) '
        'are not guarded by the check scripts — only the 11 ERP agents are. The loop changes apply to terminals '
        'started after 25-Nov-2026; restart older terminals.', 'p')]

def footer(c, d):
    c.saveState(); c.setFont('A', 7.5); c.setFillColor(MUTED)
    c.drawString(15 * mm, 9 * mm, 'Innovic ERP - The Agent Loop, full flow - 25-Nov-2026')
    c.drawRightString(195 * mm, 9 * mm, f'Page {d.page}'); c.restoreState()

out = 'C:/Innovic_projects/innovic-erp/agentic ai/agent loop - full flow.pdf'
doc = SimpleDocTemplate(out, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=14 * mm, bottomMargin=15 * mm,
                        title='The Agent Loop - full flow', author='Innovic ERP')
doc.build(S, onFirstPage=footer, onLaterPages=footer)
print(out)
