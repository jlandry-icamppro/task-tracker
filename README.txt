TASK TRACKER — Jira HUD
========================

REQUIREMENTS: Node.js (nodejs.org)

SETUP:
  1. Unzip this folder anywhere (e.g. ~/Desktop/task-tracker)
  2. Open Terminal, cd into the folder
  3. npm install
  4. npm start

FIRST LAUNCH:
  A setup card appears asking for your Jira API token.
  - Site is pre-filled: iclassprov2.atlassian.net
  - Email is pre-filled
  - Token: create one at https://id.atlassian.com → Security → API tokens

USAGE:
  - The HUD appears top-right of your screen, always on top
  - Drag the top dot-bar to reposition it
  - ▶ starts a timer on a ticket, ⏹ stops and opens the log dialog
  - Multiple timers can run simultaneously
  - Issues auto-refresh from Jira every 30 seconds
  - Right-click the menu bar icon to hide/show or quit

TRANSPARENCY NOTE:
  On macOS the window uses native vibrancy (frosted glass).
  If it still shows a dark background, make sure "Reduce Transparency"
  is OFF in System Settings → Accessibility → Display.
