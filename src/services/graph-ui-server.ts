import { createRequire } from "node:module"
import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import { readFile } from "node:fs/promises"
import { spawn } from "node:child_process"

import { createId } from "../core/ids.js"
import type { RuntimeName } from "../runtime/shared/index.js"
import { runAgentFeedback, runAgentReadyTasks, type AgentDecisionPointV1 } from "./agent-service.js"
import { getGraphState, getGraphTask, getGraphView } from "./graph-view-service.js"

type PendingDecision = {
  id: string
  decisionPoint: AgentDecisionPointV1
  resolve: (optionId: string) => void
}

type UiOperation = {
  status: "idle" | "running" | "completed" | "failed"
  action: string | null
  summary: string | null
  error: string | null
  updatedAt: string
}

export type GraphUiServer = {
  url: string
  port: number
  close: () => Promise<void>
  resolveDecision: (input: { agentSessionId: string; decisionPoint: AgentDecisionPointV1 }) => Promise<string>
}

const require = createRequire(import.meta.url)

function html() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>XieZhi Graph Harness</title>
    <script src="/vendor/cytoscape.min.js"></script>
    <style>
      :root {
        color-scheme: dark;
        --bg: #0d0f12;
        --surface: #15181d;
        --surface-2: #1b2027;
        --surface-3: #202833;
        --line: #2b323c;
        --line-strong: #3a4655;
        --text: #f3f6f8;
        --muted: #9ba5b2;
        --faint: #687484;
        --blue: #4b8dff;
        --cyan: #30b8aa;
        --green: #3fb96b;
        --yellow: #d8a631;
        --orange: #ef7d35;
        --red: #e05b5b;
        --purple: #9a7cff;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: var(--bg);
        color: var(--text);
      }
      button, input { font: inherit; }
      .shell {
        height: 100vh;
        min-width: 980px;
        display: grid;
        grid-template-columns: 280px minmax(0, 1fr) 390px;
        grid-template-rows: 76px 46px minmax(0, 1fr) 210px;
      }
      header {
        grid-column: 1 / 4;
        display: grid;
        grid-template-columns: minmax(280px, 1fr) auto;
        gap: 18px;
        align-items: center;
        padding: 0 22px;
        border-bottom: 1px solid var(--line);
        background: #111418;
      }
      .brand { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .brand h1 { font-size: 16px; margin: 0; letter-spacing: 0; font-weight: 700; }
      .brand p { margin: 0; color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .top-stats { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
      .stat {
        min-width: 86px;
        display: grid;
        gap: 2px;
        padding: 8px 10px;
        border: 1px solid var(--line);
        background: #171b21;
        border-radius: 7px;
      }
      .stat strong { font-size: 15px; line-height: 1; }
      .stat span { color: var(--muted); font-size: 11px; text-transform: uppercase; }
      .activity {
        grid-column: 1 / 4;
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 0 22px;
        border-bottom: 1px solid var(--line);
        background: #14181d;
      }
      .activity-marker {
        width: 9px;
        height: 9px;
        border-radius: 99px;
        background: var(--faint);
        flex: 0 0 auto;
      }
      .activity.running .activity-marker { background: var(--yellow); box-shadow: 0 0 0 4px rgba(216, 166, 49, .14); }
      .activity.waiting .activity-marker { background: var(--blue); box-shadow: 0 0 0 4px rgba(75, 141, 255, .14); }
      .activity.blocked .activity-marker { background: var(--red); box-shadow: 0 0 0 4px rgba(224, 91, 91, .14); }
      .activity.completed .activity-marker { background: var(--green); box-shadow: 0 0 0 4px rgba(63, 185, 107, .14); }
      .activity strong { font-size: 13px; }
      .activity span { color: var(--muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .rail {
        border-right: 1px solid var(--line);
        background: #111418;
        overflow: auto;
        padding: 16px 14px;
      }
      .graph-wrap {
        min-width: 0;
        min-height: 0;
        position: relative;
        background: #0f1216;
      }
      #cy { position: absolute; inset: 0; }
      .graph-toolbar {
        position: absolute;
        top: 14px;
        left: 14px;
        right: 14px;
        z-index: 2;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 12px;
        pointer-events: none;
      }
      .toolbar-group {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
        pointer-events: auto;
      }
      .chip, .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        border: 1px solid var(--line);
        border-radius: 999px;
        padding: 4px 9px;
        color: var(--muted);
        background: rgba(17, 20, 24, .86);
        font-size: 12px;
      }
      .chip::before {
        content: "";
        width: 7px;
        height: 7px;
        border-radius: 99px;
        background: var(--faint);
      }
      .chip.ready::before { background: var(--blue); }
      .chip.running::before { background: var(--yellow); }
      .chip.blocked::before { background: var(--red); }
      .chip.done::before { background: var(--green); }
      .detail {
        border-left: 1px solid var(--line);
        background: var(--surface);
        padding: 16px;
        overflow: auto;
      }
      .panel-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        margin-bottom: 10px;
      }
      .panel-title h2, .detail h2 { font-size: 15px; margin: 0; line-height: 1.25; }
      .panel-title span { color: var(--muted); font-size: 12px; }
      .section { margin-bottom: 18px; }
      .section h3, .detail h3 {
        font-size: 11px;
        margin: 14px 0 8px;
        color: var(--muted);
        text-transform: uppercase;
        letter-spacing: 0;
      }
      .empty {
        color: var(--faint);
        font-size: 13px;
        line-height: 1.45;
        padding: 10px;
        border: 1px dashed var(--line);
        border-radius: 7px;
      }
      .queue { display: grid; gap: 8px; }
      .queue-item {
        display: grid;
        gap: 5px;
        padding: 10px;
        border: 1px solid var(--line);
        background: var(--surface);
        border-radius: 7px;
        cursor: pointer;
      }
      .queue-item:hover { border-color: var(--line-strong); background: var(--surface-2); }
      .queue-item strong { font-size: 13px; line-height: 1.25; }
      .queue-item small { color: var(--muted); font-size: 12px; line-height: 1.35; overflow-wrap: anywhere; }
      .queue-item em { color: var(--faint); font-size: 11px; font-style: normal; text-transform: uppercase; }
      .queue-item.ready { border-left: 3px solid var(--blue); }
      .queue-item.blocked { border-left: 3px solid var(--red); }
      .queue-item.blocked.recovering { border-left-color: var(--yellow); background: #1f1c15; }
      .queue-item.done { border-left: 3px solid var(--green); }
      .queue-item.skipped { border-left: 3px solid var(--yellow); }
      .status-note {
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: #11161c;
        color: var(--muted);
        font-size: 12px;
        line-height: 1.45;
      }
      .status-note.blocked { border-color: rgba(224, 91, 91, .45); color: #ffb0b0; }
      .status-note.running { border-color: rgba(216, 166, 49, .45); color: #f0d79b; }
      .status-note.completed { border-color: rgba(63, 185, 107, .45); color: #9fe3b8; }
      .subagents { display: grid; gap: 8px; }
      .subagent {
        display: grid;
        gap: 4px;
        padding: 9px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--surface);
      }
      .subagent strong { font-size: 13px; }
      .subagent small { color: var(--muted); line-height: 1.35; overflow-wrap: anywhere; }
      .action-box {
        display: grid;
        gap: 8px;
        padding: 10px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--surface);
      }
      .debug-controls {
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--surface);
        overflow: hidden;
      }
      .debug-controls summary {
        cursor: pointer;
        padding: 10px;
        color: var(--muted);
        font-size: 12px;
        user-select: none;
      }
      .debug-controls[open] summary { border-bottom: 1px solid var(--line); }
      .debug-controls .action-box { border: 0; border-radius: 0; background: transparent; }
      textarea {
        width: 100%;
        min-height: 72px;
        resize: vertical;
        padding: 9px;
        color: var(--text);
        background: #101419;
        border: 1px solid var(--line);
        border-radius: 7px;
        outline: none;
      }
      textarea:focus { border-color: var(--blue); }
      .button-row { display: flex; gap: 8px; flex-wrap: wrap; }
      .action-button {
        border: 1px solid var(--line-strong);
        color: var(--text);
        background: #242c37;
        border-radius: 7px;
        padding: 8px 10px;
        cursor: pointer;
      }
      .action-button:hover { border-color: var(--blue); background: #2a3543; }
      .action-button.primary { background: #1f4f9a; border-color: #3d78d8; }
      .action-button:disabled { cursor: wait; opacity: .62; }
      .operation {
        color: var(--muted);
        font-size: 12px;
        line-height: 1.4;
        overflow-wrap: anywhere;
      }
      .operation.failed { color: #ff9b9b; }
      .operation.completed { color: #83e0a4; }
      .detail p, .detail li { color: #cad2dd; font-size: 13px; line-height: 1.48; }
      .detail ul { margin: 6px 0; padding-left: 18px; }
      .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 12px 0; }
      .meta {
        padding: 9px;
        border: 1px solid var(--line);
        border-radius: 7px;
        background: var(--surface-2);
      }
      .meta span { display: block; color: var(--muted); font-size: 11px; text-transform: uppercase; margin-bottom: 3px; }
      .meta strong { font-size: 13px; overflow-wrap: anywhere; }
      footer {
        grid-column: 1 / 4;
        border-top: 1px solid var(--line);
        background: #111418;
        overflow: auto;
        padding: 12px 16px;
      }
      .timeline-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
      }
      .timeline-head h2 { font-size: 13px; margin: 0; }
      .events { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 8px; }
      .event {
        display: grid;
        gap: 4px;
        border: 1px solid var(--line);
        background: var(--surface);
        border-radius: 7px;
        padding: 9px 10px;
      }
      .event .type { color: #83b8ff; font-size: 12px; font-weight: 650; }
      .event .summary { color: #d7dde5; font-size: 12px; line-height: 1.35; }
      .event .time { color: var(--faint); font-size: 11px; }
      .event.problem .type, .event.blocked .type { color: #ff8b8b; }
      .event.solution .type { color: #65d8c9; }
      .event.decision .type { color: #d5b6ff; }
      .decision { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; background: rgba(0,0,0,.55); z-index: 10; }
      .decision.visible { display: flex; }
      .dialog { width: min(780px, calc(100vw - 32px)); background: #181d24; border: 1px solid #465365; border-radius: 8px; padding: 22px; box-shadow: 0 20px 70px rgba(0,0,0,.45); }
      .dialog h2 { margin: 0 0 10px; font-size: 20px; }
      .option { width: 100%; text-align: left; background: #202732; color: var(--text); border: 1px solid #3a4655; border-radius: 7px; padding: 13px; margin: 9px 0; cursor: pointer; }
      .option:hover { border-color: var(--blue); background: #25303d; }
      .option strong { display: block; margin-bottom: 4px; }
      .option small { color: var(--muted); display: block; line-height: 1.35; }
      @media (max-width: 1100px) {
        .shell { min-width: 0; grid-template-columns: 240px minmax(0, 1fr); grid-template-rows: 82px 54px minmax(0, 1fr) 260px; }
        header { grid-column: 1 / 3; }
        .activity { grid-column: 1 / 3; }
        .detail { grid-column: 1 / 3; border-left: 0; border-top: 1px solid var(--line); }
        footer { grid-column: 1 / 3; }
      }
    </style>
  </head>
  <body>
    <div class="shell">
      <header>
        <div class="brand">
          <h1>XieZhi Build Harness</h1>
          <p id="goal">Waiting for an agent build session.</p>
        </div>
        <div class="top-stats">
          <div class="stat"><strong id="statusValue">idle</strong><span>status</span></div>
          <div class="stat"><strong id="modelValue">default</strong><span>model</span></div>
          <div class="stat"><strong id="readyValue">0</strong><span>ready</span></div>
          <div class="stat"><strong id="activeValue">0</strong><span>agents</span></div>
          <div class="stat"><strong id="blockedValue">0</strong><span>blocked</span></div>
          <div class="stat"><strong id="doneValue">0</strong><span>done</span></div>
        </div>
      </header>
      <div class="activity" id="activity">
        <div class="activity-marker"></div>
        <strong id="activityTitle">Idle</strong>
        <span id="activityDetail">No build activity yet.</span>
      </div>
      <nav class="rail">
        <div class="section">
          <div class="panel-title"><h2>Build Activity</h2><span id="operationStatus">idle</span></div>
          <div class="status-note" id="operation">No active web action.</div>
          <h3>Supervisor</h3>
          <div class="status-note" id="supervisor">Waiting for supervisor progress.</div>
          <h3>Subagents</h3>
          <div class="subagents" id="subagents"><div class="empty">No subagents declared yet.</div></div>
          <details class="debug-controls">
            <summary>Advanced/debug controls</summary>
            <div class="action-box">
              <textarea id="feedbackText" placeholder="Debug feedback for the main agent."></textarea>
              <div class="button-row">
                <button class="action-button" id="runReady">Run ready wave</button>
                <button class="action-button primary" id="sendFeedback">Send feedback plan</button>
              </div>
            </div>
          </details>
        </div>
        <div class="section">
          <div class="panel-title"><h2>Ready Queue</h2><span id="readyCount">0</span></div>
          <div class="queue" id="readyList"><div class="empty">No ready tasks yet.</div></div>
        </div>
        <div class="section">
          <div class="panel-title"><h2>Blocked</h2><span id="blockedCount">0</span></div>
          <div class="queue" id="blockedList"><div class="empty">No blocked tasks.</div></div>
        </div>
        <div class="section">
          <div class="panel-title"><h2>Completed</h2><span id="doneCount">0</span></div>
          <div class="queue" id="doneList"><div class="empty">Nothing completed yet.</div></div>
        </div>
      </nav>
      <main class="graph-wrap">
        <div class="graph-toolbar">
          <div class="toolbar-group">
            <span class="chip ready">ready</span>
            <span class="chip running">running</span>
            <span class="chip blocked">blocked</span>
            <span class="chip done">promoted</span>
          </div>
          <div class="toolbar-group">
            <span class="pill" id="session">session: none</span>
            <span class="pill" id="feature">feature: none</span>
          </div>
        </div>
        <div id="cy"></div>
      </main>
      <aside class="detail" id="detail"><h2>No node selected</h2><p>Select a graph node to inspect scope, acceptance, patch evidence, and next action.</p></aside>
      <footer>
        <div class="timeline-head"><h2>Agent Timeline</h2><span class="pill" id="eventCount">0 events</span></div>
        <div class="events" id="events"></div>
      </footer>
    </div>
    <div class="decision" id="decision"></div>
    <script>
      const cy = cytoscape({
        container: document.getElementById('cy'),
        elements: [],
        layout: { name: 'breadthfirst', directed: true, padding: 70, spacingFactor: 1.35, avoidOverlap: true },
        style: [
          { selector: 'node', style: { label: 'data(label)', 'font-size': 11, color: '#eef3f7', 'text-outline-width': 3, 'text-outline-color': '#0f1216', width: 56, height: 56, 'background-color': '#687484', 'border-width': 1.5, 'border-color': '#202833', 'text-wrap': 'wrap', 'text-max-width': 112 } },
          { selector: ':selected', style: { 'border-width': 4, 'border-color': '#f3f6f8', 'overlay-color': '#4b8dff', 'overlay-opacity': .12 } },
          { selector: 'node[type = "feature"]', style: { shape: 'round-rectangle', width: 118, height: 52, 'background-color': '#8b73ff' } },
          { selector: 'node[type = "execution_group"]', style: { shape: 'round-rectangle', width: 100, height: 44, 'background-color': '#3f789d' } },
          { selector: 'node[type = "requirement"]', style: { shape: 'diamond', 'background-color': '#657284' } },
          { selector: 'node[type = "acceptance"]', style: { shape: 'tag', 'background-color': '#4e5c6f' } },
          { selector: '.ready', style: { 'background-color': '#4b8dff' } },
          { selector: '.running', style: { 'background-color': '#d8a631' } },
          { selector: '.patched', style: { 'background-color': '#ef7d35' } },
          { selector: '.verified', style: { 'background-color': '#30b8aa' } },
          { selector: '.promoted, .completed', style: { 'background-color': '#3fb96b' } },
          { selector: '.failed, .rejected', style: { 'background-color': '#e05b5b' } },
          { selector: '.has-warning', style: { 'border-width': 4, 'border-color': '#d8a631' } },
          { selector: '.has-blocking', style: { 'border-width': 5, 'border-color': '#e05b5b' } },
          { selector: 'edge', style: { width: 1.6, 'line-color': '#4d5968', 'target-arrow-color': '#4d5968', 'target-arrow-shape': 'triangle', 'curve-style': 'bezier', label: 'data(label)', 'font-size': 8, color: '#8792a0', 'text-background-color': '#0f1216', 'text-background-opacity': .82, 'text-background-padding': 2 } },
          { selector: 'edge[type = "depends_on"]', style: { 'line-color': '#4b8dff', 'target-arrow-color': '#4b8dff', width: 2.4 } }
        ]
      });
      let selectedNodeId = null;
      let lastGraphKey = '';
      let lastDecisionId = null;
      let latestState = null;
      function esc(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])); }
      function list(values) { return values && values.length ? '<ul>' + values.map(item => '<li>' + esc(item) + '</li>').join('') + '</ul>' : '<p>none</p>'; }
      async function postJson(url, body) {
        const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'Request failed.');
        return payload;
      }
      function statusText(state) {
        if (state.pendingDecision) return 'waiting decision';
        if (state.operation?.status === 'running') return 'agent action';
        if (state.currentPhase) return state.currentPhase;
        if ((state.ready?.skippedTasks || []).some(task => String(task.reason || '').includes('status is running'))) return 'running';
        return state.session?.status ?? state.ready?.featureStatus ?? 'idle';
      }
      function shortId(value) { return value ? String(value).slice(0, 8) : 'none'; }
      function operationTaskId(operation) {
        const action = operation?.action || '';
        return action.startsWith('recover_task:') ? action.slice('recover_task:'.length) : null;
      }
      function taskActivity(taskId, state) {
        const runningTaskId = operationTaskId(state.operation);
        if (runningTaskId && runningTaskId === taskId && state.operation?.status === 'running') {
          return { kind: 'running', title: 'Recovery running', detail: 'OpenCode is generating a bounded recovery plan for this task.' };
        }
        if (runningTaskId && runningTaskId === taskId && state.operation?.status === 'completed') {
          return { kind: 'completed', title: 'Recovery plan returned', detail: state.operation.summary || 'A new recovery DAG has been imported.' };
        }
        if (runningTaskId && runningTaskId === taskId && state.operation?.status === 'failed') {
          return { kind: 'blocked', title: 'Recovery failed', detail: state.operation.error || 'The recovery agent call failed.' };
        }
        return { kind: 'blocked', title: 'Waiting for action', detail: 'This task is blocked. Select it and ask the agent to recover, or send feedback.' };
      }
      function activityState(state) {
        if (state.pendingDecision) {
          return { kind: 'waiting', title: 'Waiting for your decision', detail: state.pendingDecision.decisionPoint?.problem || 'Choose an option in the decision dialog.' };
        }
        if (state.currentPhase && state.currentPhase !== 'idle') {
          const phaseKind = state.currentPhase === 'completed' ? 'completed' : state.currentPhase === 'stalled' ? 'blocked' : ['decision', 'planning', 'intake'].includes(state.currentPhase) ? 'waiting' : 'running';
          return { kind: phaseKind, title: phaseLabel(state.currentPhase), detail: state.currentSummary || 'Supervisor progress is available.' };
        }
        if (state.operation?.status === 'running') {
          return { kind: 'running', title: state.operation.action === 'run_ready' ? 'Running ready wave' : 'Agent is working', detail: state.operation.summary || 'Waiting for OpenCode.' };
        }
        if (state.operation?.status === 'failed') {
          return { kind: 'blocked', title: 'Agent action failed', detail: state.operation.error || 'Inspect the latest evidence and retry.' };
        }
        if (state.operation?.status === 'completed') {
          return { kind: 'completed', title: 'Agent returned a plan', detail: state.operation.summary || 'A follow-up DAG is available.' };
        }
        const ready = state.ready?.readyTasks?.length ?? 0;
        const running = (state.ready?.skippedTasks || []).filter(task => String(task.reason || '').includes('status is running')).length;
        const skipped = (state.ready?.skippedTasks || []).length - running;
        const blocked = (state.ready?.blockedTasks?.length ?? 0) + skipped;
        const done = state.ready?.doneTasks?.length ?? 0;
        if (running > 0) {
          return { kind: 'running', title: 'OpenCode is running', detail: running + ' task(s) are executing now; XieZhi will verify, review, promote, or recover automatically.' };
        }
        if (state.session?.status === 'running') {
          const latestEvent = (state.events || [])[state.events.length - 1];
          const latestType = latestEvent?.type || '';
          if (latestType.includes('solution') || latestType.includes('problem')) {
            return { kind: 'running', title: 'Agent is recovering', detail: latestEvent?.summary || 'OpenCode is using DAG and evidence to produce the next bounded plan.' };
          }
          if (ready > 0) {
            return { kind: 'running', title: 'Agent is running the next wave', detail: ready + ' ready task(s) are queued; no user action is needed unless a decision point appears.' };
          }
          return { kind: 'running', title: 'Agent is working', detail: 'OpenCode is planning, running, verifying, or recovering automatically.' };
        }
        if (ready > 0) return { kind: 'waiting', title: 'Ready to run', detail: ready + ' task(s) can run in the next wave.' };
        if (blocked > 0) return { kind: 'blocked', title: 'Blocked, waiting for recovery', detail: blocked + ' task(s) need agent recovery, user feedback, or dependency resolution.' };
        if (done > 0) return { kind: 'completed', title: 'Feature complete or no ready work', detail: 'No ready or blocked tasks are visible in the current feature.' };
        return { kind: 'waiting', title: 'Supervisor exploring', detail: 'OpenCode is exploring the goal, decisions, and subagent plan before XieZhi normalizes a DAG.' };
      }
      function phaseLabel(phase) {
        return ({
          intake: '规划前准备',
          planning: '规划中',
          decision: '等待决策',
          building: '构建中',
          verifying: '验收检查中',
          reviewing: '自动 Review 中',
          promoting: '落地 Patch 中',
          recovering: '自动修复中',
          completed: '已完成',
          stalled: '需要 agent 重新规划',
          running: '运行中'
        })[phase] || phase;
      }
      function eventClass(event) {
        const value = event.type || '';
        if (value.includes('problem')) return 'problem';
        if (value.includes('solution')) return 'solution';
        if (value.includes('decision')) return 'decision';
        if (String(event.summary || '').toLowerCase().includes('blocked')) return 'blocked';
        return '';
      }
      function renderQueue(containerId, items, kind, emptyText, state) {
        const root = document.getElementById(containerId);
        if (!items || items.length === 0) {
          root.innerHTML = '<div class="empty">' + esc(emptyText) + '</div>';
          return;
        }
        root.innerHTML = items.map(item => {
          const itemActivity = kind === 'blocked' && String(item.reason || '').includes('status is running')
            ? { kind: 'running', title: 'Task running', detail: 'OpenCode is editing this assignment now.' }
            : kind === 'blocked'
              ? taskActivity(item.id, state)
              : null;
          const detail = kind === 'ready'
            ? 'scope: ' + ((item.allowedFiles || []).join(', ') || 'none')
            : kind === 'blocked'
              ? itemActivity.detail
              : item.status || item.reason || '';
          const extraClass = itemActivity?.kind === 'running' ? ' recovering' : '';
          const label = itemActivity ? '<em>' + esc(itemActivity.title) + '</em>' : '';
          const blockedReasons = kind === 'blocked' && item.blockedReasons
            ? '<small>' + esc((item.blockedReasons || []).map((reason) => shortId(reason.taskId) + ': ' + reason.reason).join(' | ') || 'waiting for dependency promotion') + '</small>'
            : kind === 'blocked' && item.blockedBy
              ? '<small>blocked by: ' + esc((item.blockedBy || []).map(shortId).join(', ') || 'unknown') + '</small>'
              : '';
          return '<div class="queue-item ' + esc(kind + extraClass) + '" data-task-id="' + esc(item.id) + '"><strong>' + esc(item.title) + '</strong>' + label + '<small>' + esc(detail) + '</small>' + blockedReasons + '</div>';
        }).join('');
        root.querySelectorAll('.queue-item').forEach(item => item.addEventListener('click', () => {
          const node = cy.nodes().filter(node => node.data('taskId') === item.dataset.taskId)[0];
          if (node) {
            cy.elements().unselect();
            node.select();
            selectedNodeId = node.id();
            renderDetail(node, latestState || {});
            cy.animate({ center: { eles: node }, zoom: Math.max(cy.zoom(), 1.1) }, { duration: 240 });
          }
        }));
      }
      function renderDetail(node, state) {
        if (!node) return;
        const d = node.data();
        const patch = d.latestPatch;
        const canRecover = d.taskId && ((d.blockingViolations || 0) > 0 || ['failed', 'rejected', 'patched'].includes(d.status));
        const selectedActivity = d.taskId && canRecover ? taskActivity(d.taskId, state || {}) : null;
        const recovering = selectedActivity?.kind === 'running';
        document.getElementById('detail').innerHTML = '<div class="panel-title"><h2>' + esc(d.label) + '</h2><span>' + esc(shortId(d.taskId || d.id)) + '</span></div>'
          + '<p><span class="pill">' + esc(d.type) + '</span> <span class="pill">' + esc(d.status) + '</span></p>'
          + (selectedActivity ? '<div class="status-note ' + esc(selectedActivity.kind) + '"><strong>' + esc(selectedActivity.title) + '</strong><br>' + esc(selectedActivity.detail) + '</div>' : '')
          + (d.body ? '<p>' + esc(d.body) + '</p>' : '')
          + '<div class="meta-grid"><div class="meta"><span>warnings</span><strong>' + esc(d.warnings || 0) + '</strong></div><div class="meta"><span>blocking</span><strong>' + esc(d.blockingViolations || 0) + '</strong></div></div>'
          + (canRecover ? '<details class="debug-controls section"><summary>Advanced recovery controls</summary><div class="action-box"><button class="action-button primary" id="recoverTask" ' + (recovering ? 'disabled' : '') + '>' + (recovering ? 'Recovery running...' : 'Ask agent to recover this task') + '</button></div></details>' : '')
          + '<h3>Allowed Files</h3>' + list(d.allowedFiles)
          + '<h3>Acceptance</h3>' + list(d.acceptance)
          + '<h3>Latest Patch</h3>' + (patch ? '<p>' + esc(shortId(patch.id)) + ' · ' + esc(patch.status) + ' · files ' + esc(patch.changedFiles.length) + ' · warnings ' + esc(patch.warnings) + ' · blocking ' + esc(patch.blockingViolations) + '</p>' : '<p>none</p>');
        const recoverButton = document.getElementById('recoverTask');
        if (recoverButton && d.taskId) {
          recoverButton.addEventListener('click', async () => {
            recoverButton.disabled = true;
            recoverButton.textContent = 'Asking agent...';
            try {
              await postJson('/api/task/' + encodeURIComponent(d.taskId) + '/recover', { note: document.getElementById('feedbackText').value });
              document.getElementById('feedbackText').value = '';
            } catch (error) {
              document.getElementById('operation').className = 'status-note operation failed';
              document.getElementById('operation').textContent = error.message || String(error);
            } finally {
              recoverButton.disabled = false;
              recoverButton.textContent = 'Ask agent to recover this task';
              await refresh();
            }
          });
        }
      }
      cy.on('tap', 'node', evt => { selectedNodeId = evt.target.id(); renderDetail(evt.target, latestState || {}); });
      async function refresh() {
        const [state, graph] = await Promise.all([fetch('/api/state').then(r => r.json()), fetch('/api/graph').then(r => r.json())]);
        latestState = state;
        const ready = state.ready?.readyTasks ?? [];
        const blocked = state.ready?.blockedTasks ?? [];
        const done = state.ready?.doneTasks ?? [];
        const skipped = state.ready?.skippedTasks ?? [];
        const runningSkipped = skipped.filter(task => String(task.reason || '').includes('status is running'));
        const nonRunningSkipped = skipped.filter(task => !String(task.reason || '').includes('status is running'));
        const activity = activityState(state);
        document.getElementById('goal').textContent = state.session?.goal ?? 'Waiting for an agent build session.';
        document.getElementById('statusValue').textContent = statusText(state);
        document.getElementById('modelValue').textContent = state.runtimeModel || 'default';
        const activityNode = document.getElementById('activity');
        activityNode.className = 'activity ' + activity.kind;
        document.getElementById('activityTitle').textContent = activity.title;
        document.getElementById('activityDetail').textContent = activity.detail;
        document.getElementById('readyValue').textContent = ready.length;
        const activeSubagents = (state.subagents || []).filter(agent => ['planned', 'running', 'blocked'].includes(agent.status));
        document.getElementById('activeValue').textContent = activeSubagents.length;
        document.getElementById('blockedValue').textContent = blocked.length + nonRunningSkipped.length;
        document.getElementById('doneValue').textContent = done.length;
        document.getElementById('operationStatus').textContent = state.operation?.status ?? 'idle';
        const operation = state.operation;
        const operationNode = document.getElementById('operation');
        operationNode.className = 'status-note operation ' + (operation?.status ?? 'idle');
        operationNode.textContent = operation?.summary || operation?.error || 'No active web action.';
        document.getElementById('supervisor').textContent = (state.supervisorPhase ? phaseLabel(state.supervisorPhase) + ': ' : '') + (state.supervisorSummary || state.currentSummary || 'Waiting for supervisor progress.');
        document.getElementById('subagents').innerHTML = (state.subagents || []).length
          ? state.subagents.map(agent => '<div class="subagent"><strong>' + esc(agent.role) + ' · ' + esc(agent.status) + '</strong><small>' + esc(shortId(agent.taskId) + ' · ' + agent.summary) + '</small></div>').join('')
          : '<div class="empty">No subagents declared yet.</div>';
        document.getElementById('readyCount').textContent = ready.length;
        document.getElementById('blockedCount').textContent = blocked.length + nonRunningSkipped.length;
        document.getElementById('doneCount').textContent = done.length;
        document.getElementById('session').textContent = 'session: ' + shortId(state.session?.id);
        document.getElementById('feature').textContent = 'feature: ' + (state.feature?.title ?? state.ready?.featureTitle ?? 'none');
        document.getElementById('feature').title = 'runtime model: ' + (state.runtimeModel || 'default') + ' · decision model: ' + (state.decisionModel || state.runtimeModel || 'default');
        renderQueue('readyList', ready, 'ready', 'No ready tasks yet.', state);
        renderQueue('blockedList', runningSkipped.concat(blocked, nonRunningSkipped), 'blocked', 'No blocked tasks.', state);
        renderQueue('doneList', done, 'done', 'Nothing completed yet.', state);
        const graphKey = JSON.stringify({ nodes: graph.nodes, edges: graph.edges });
        if (graphKey !== lastGraphKey) {
          lastGraphKey = graphKey;
          cy.elements().remove();
          cy.add([...(graph.nodes ?? []), ...(graph.edges ?? [])]);
          cy.layout({ name: 'breadthfirst', directed: true, padding: 70, spacingFactor: 1.35, avoidOverlap: true }).run();
          if (selectedNodeId) {
            const selected = cy.getElementById(selectedNodeId);
            if (selected.length) renderDetail(selected, state);
          }
        } else if (selectedNodeId) {
          const selected = cy.getElementById(selectedNodeId);
          if (selected.length) renderDetail(selected, state);
        }
        const events = (state.events ?? []).slice(-24).reverse();
        document.getElementById('eventCount').textContent = events.length + ' events';
        document.getElementById('events').innerHTML = events.length
          ? events.map(event => '<div class="event ' + eventClass(event) + '"><div class="type">' + esc(event.type) + '</div><div class="summary">' + esc(event.summary) + '</div><div class="time">' + esc(event.createdAt) + '</div></div>').join('')
          : '<div class="empty">No agent events yet.</div>';
        renderDecision(state.pendingDecision);
      }
      function renderDecision(pending) {
        const root = document.getElementById('decision');
        if (!pending) { root.className = 'decision'; lastDecisionId = null; root.innerHTML = ''; return; }
        if (lastDecisionId === pending.id) return;
        lastDecisionId = pending.id;
        const point = pending.decisionPoint;
        root.className = 'decision visible';
        root.innerHTML = '<div class="dialog"><p><span class="pill">Decision required</span></p><h2>' + esc(point.problem) + '</h2><p>' + esc(point.impact) + '</p><p><span class="pill">recommended: ' + esc(point.recommendedOptionId) + '</span></p>' + point.options.map(option => '<button class="option" data-option="' + esc(option.id) + '"><strong>' + esc(option.label) + '</strong><small>' + esc(option.tradeoff) + '</small><small>' + esc(option.planDelta) + '</small></button>').join('') + '</div>';
        root.querySelectorAll('.option').forEach(btn => btn.addEventListener('click', async () => {
          await fetch('/api/decision/' + pending.id + '/resolve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ optionId: btn.dataset.option }) });
          root.className = 'decision';
        }));
      }
      refresh().catch(error => {
        document.getElementById('events').innerHTML = '<div class="empty">UI refresh failed: ' + esc(error.message || error) + '</div>';
      });
      setInterval(refresh, 1000);
      document.getElementById('sendFeedback').addEventListener('click', async () => {
        const button = document.getElementById('sendFeedback');
        const feedback = document.getElementById('feedbackText').value.trim();
        if (!feedback) return;
        button.disabled = true;
        button.textContent = 'Sending...';
        try {
          await postJson('/api/feedback', { feedback });
          document.getElementById('feedbackText').value = '';
        } catch (error) {
          document.getElementById('operation').className = 'status-note operation failed';
          document.getElementById('operation').textContent = error.message || String(error);
        } finally {
          button.disabled = false;
          button.textContent = 'Send feedback plan';
          await refresh();
        }
      });
      document.getElementById('runReady').addEventListener('click', async () => {
        const button = document.getElementById('runReady');
        button.disabled = true;
        button.textContent = 'Running...';
        try {
          await postJson('/api/run-ready', {});
        } catch (error) {
          document.getElementById('operation').className = 'status-note operation failed';
          document.getElementById('operation').textContent = error.message || String(error);
        } finally {
          button.disabled = false;
          button.textContent = 'Run ready wave';
          await refresh();
        }
      });
    </script>
  </body>
</html>`
}

function readRequestBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = ""
    request.on("data", (chunk) => {
      body += chunk
    })
    request.on("end", () => resolve(body))
    request.on("error", reject)
  })
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(value, null, 2))
}

function openBrowser(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "cmd"
        : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  const child = spawn(command, args, { detached: true, stdio: "ignore" })
  child.on("error", () => {
    // Opening the browser is best-effort; the CLI still prints the URL.
  })
  child.unref()
}

export async function startGraphUiServer(input: {
  cwd: string
  port: number
  openBrowser: boolean
  runtime?: RuntimeName
  decisionRuntime?: RuntimeName
  parallel?: number
  model?: string | null
  decisionModel?: string | null
}): Promise<GraphUiServer> {
  let pendingDecision: PendingDecision | null = null
  let currentSessionId: string | null = null
  let operation: UiOperation = {
    status: "idle",
    action: null,
    summary: "No active web action.",
    error: null,
    updatedAt: new Date().toISOString()
  }

  const setOperation = (patch: Omit<UiOperation, "updatedAt">) => {
    operation = { ...patch, updatedAt: new Date().toISOString() }
  }

  const currentFeatureId = () => {
    return getGraphState(input.cwd, {
      sessionId: currentSessionId ?? undefined,
      pendingDecision,
      runtimeModel: input.model,
      decisionModel: input.decisionModel ?? input.model
    }).feature?.id ?? undefined
  }

  const graphState = () =>
    getGraphState(input.cwd, {
      sessionId: currentSessionId ?? undefined,
      pendingDecision,
      runtimeModel: input.model,
      decisionModel: input.decisionModel ?? input.model
    })

  const runFeedbackAction = async (feedback: string, action: string) => {
    setOperation({ status: "running", action, summary: "Waiting for the main agent to return a recovery AgentPlan.", error: null })
    try {
      const result = await runAgentFeedback(input.cwd, feedback, input.runtime ?? "opencode", currentFeatureId(), input.model)
      currentSessionId = result.agentSessionId
      setOperation({
        status: "completed",
        action,
        summary: `Agent returned feature "${result.title}" with ${result.taskCount} task(s).`,
        error: null
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOperation({ status: "failed", action, summary: null, error: message })
      throw error
    }
  }

  const runReadyAction = async () => {
    const featureId = currentFeatureId()
    if (!featureId) {
      throw new Error("No current feature is available to run.")
    }
    setOperation({ status: "running", action: "run_ready", summary: "Running the next safe execution group through OpenCode.", error: null })
    try {
      const result = await runAgentReadyTasks(input.cwd, {
        featureId,
        runtime: input.runtime ?? "opencode",
        parallel: input.parallel ?? 2,
        auto: true,
        decisionRuntime: input.decisionRuntime ?? input.runtime ?? "opencode",
        model: input.model,
        decisionModel: input.decisionModel ?? input.model
      })
      setOperation({
        status: "completed",
        action: "run_ready",
        summary: `Execution group completed: ${result.runs.length} run(s), ${result.nextReadyTaskIds.length} next ready task(s).`,
        error: null
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setOperation({ status: "failed", action: "run_ready", summary: null, error: message })
      throw error
    }
  }

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost")
      if (request.method === "GET" && url.pathname === "/") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" })
        response.end(html())
        return
      }
      if (request.method === "GET" && url.pathname === "/vendor/cytoscape.min.js") {
        const filePath = require.resolve("cytoscape/dist/cytoscape.min.js")
        response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" })
        response.end(await readFile(filePath, "utf8"))
        return
      }
      if (request.method === "GET" && url.pathname === "/api/state") {
        sendJson(response, 200, { ...graphState(), operation })
        return
      }
      if (request.method === "GET" && url.pathname === "/api/session") {
        const state = graphState()
        sendJson(response, 200, { session: state.session, feature: state.feature, ready: state.ready })
        return
      }
      if (request.method === "GET" && url.pathname === "/api/progress") {
        const state = graphState()
        sendJson(response, 200, {
          currentPhase: state.currentPhase,
          currentSummary: state.currentSummary,
          supervisorPhase: state.supervisorPhase,
          supervisorSummary: state.supervisorSummary,
          supervisorObservations: state.supervisorObservations,
          supervisorHandoff: state.supervisorHandoff,
          normalizationStatus: state.normalizationStatus,
          runtimeError: state.runtimeError,
          currentTaskId: state.currentTaskId,
          currentExecutionGroup: state.currentExecutionGroup,
          subagents: state.subagents,
          progressReports: state.progressReports,
          executionPlans: state.executionPlans,
          runtimeModel: state.runtimeModel,
          decisionModel: state.decisionModel
        })
        return
      }
      if (request.method === "GET" && url.pathname === "/api/decisions") {
        const state = graphState()
        sendJson(response, 200, {
          pendingDecision: state.pendingDecision,
          declared: state.events.filter((event) => event.type === "decision_point_declared"),
          resolved: state.events.filter((event) => event.type === "decision_point_resolved")
        })
        return
      }
      if (request.method === "GET" && url.pathname === "/api/graph") {
        sendJson(response, 200, getGraphView(input.cwd, { sessionId: currentSessionId ?? undefined }))
        return
      }
      const taskMatch = url.pathname.match(/^\/api\/task\/([^/]+)$/)
      if (request.method === "GET" && taskMatch?.[1]) {
        sendJson(response, 200, await getGraphTask(input.cwd, decodeURIComponent(taskMatch[1])))
        return
      }
      const recoverMatch = url.pathname.match(/^\/api\/task\/([^/]+)\/recover$/)
      if (request.method === "POST" && recoverMatch?.[1]) {
        const taskId = decodeURIComponent(recoverMatch[1])
        const task = await getGraphTask(input.cwd, taskId)
        const body = JSON.parse((await readRequestBody(request)) || "{}") as { note?: string }
        const blocking = task.violations.filter((violation) => violation.severity === "blocking")
        const warnings = task.violations.filter((violation) => violation.severity === "warning")
        const feedback = [
          "Recover the blocked task selected in the XieZhi Web UI.",
          `Task id: ${task.taskId}`,
          `Task title: ${task.title}`,
          `Task status: ${task.taskStatus}`,
          `Task summary: ${task.summary}`,
          `Allowed files: ${task.allowedFiles.join(", ") || "none"}`,
          `Allowed symbols: ${task.allowedSymbols.join(", ") || "none"}`,
          `Acceptance: ${task.acceptance.join(" | ") || "none"}`,
          `Latest patch: ${task.latestPatch ? `${task.latestPatch.id} (${task.latestPatch.status})` : "none"}`,
          `Changed files: ${task.latestPatch?.changedFiles.join(", ") || "none"}`,
          `Blocking violations: ${JSON.stringify(blocking)}`,
          `Warnings: ${JSON.stringify(warnings)}`,
          `Checks: ${JSON.stringify(task.checks)}`,
          body.note ? `User note: ${body.note}` : "User note: none",
          "Return a strict AgentPlan v1 with bounded recovery tasks, or an AgentDecisionPoint v1 if a user choice is required."
        ].join("\n")
        sendJson(response, 200, await runFeedbackAction(feedback, `recover_task:${taskId}`))
        return
      }
      if (request.method === "POST" && url.pathname === "/api/feedback") {
        const body = JSON.parse((await readRequestBody(request)) || "{}") as { feedback?: string }
        if (!body.feedback?.trim()) {
          sendJson(response, 400, { error: "feedback is required." })
          return
        }
        sendJson(response, 200, await runFeedbackAction(body.feedback.trim(), "feedback"))
        return
      }
      if (request.method === "POST" && url.pathname === "/api/run-ready") {
        sendJson(response, 200, await runReadyAction())
        return
      }
      const decisionMatch = url.pathname.match(/^\/api\/decision\/([^/]+)\/resolve$/)
      if (request.method === "POST" && decisionMatch?.[1]) {
        if (!pendingDecision || pendingDecision.id !== decodeURIComponent(decisionMatch[1])) {
          sendJson(response, 404, { error: "No matching pending decision." })
          return
        }
        const body = JSON.parse((await readRequestBody(request)) || "{}") as { optionId?: string }
        const optionIds = new Set(pendingDecision.decisionPoint.options.map((option) => option.id))
        if (!body.optionId || !optionIds.has(body.optionId)) {
          sendJson(response, 400, { error: "Invalid optionId." })
          return
        }
        const resolve = pendingDecision.resolve
        pendingDecision = null
        resolve(body.optionId)
        sendJson(response, 200, { status: "resolved", optionId: body.optionId })
        return
      }
      sendJson(response, 404, { error: "Not found." })
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  await new Promise<void>((resolve) => {
    server.listen(input.port, "127.0.0.1", () => resolve())
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : input.port
  const url = `http://127.0.0.1:${port}`
  if (input.openBrowser) {
    openBrowser(url)
  }

  return {
    url,
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
    resolveDecision: ({ agentSessionId, decisionPoint }) => {
      currentSessionId = agentSessionId
      return new Promise<string>((resolve) => {
        pendingDecision = { id: createId(), decisionPoint, resolve }
      })
    }
  }
}
