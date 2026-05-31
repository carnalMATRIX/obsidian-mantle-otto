# Otto

Otto is a production-ready, visual chat UI wrapper for the native Gemini CLI. It brings secure, workspace-aware AI agent operations directly into your Obsidian vault layout, allowing you to run complex context-aware terminal and folder tasks securely from a polished chat interface.

---

## 🎨 Cohesive Styling

Otto is designed to blend with the **Project Mantle** visual ecosystem. While functional on any theme, it is optimized to merge with the **Zenith theme**, adopting its typography, chat balloon borders, input boxes, glassmorphic headers, and terminal console styling.

---

## ✨ Key Features

* **Visual Agent Chat Interface:** Chat with your workspace agent using a polished, responsive conversation window.
* **Vault Context Injection:** Automatically injects current file contents, active selections, and vault folders into queries.
* **Secure Integration:** Bridges with the native Gemini CLI to run commands, modify files, and perform research securely.
* **Command Auditing:** Review and approve agent actions before they run, maintaining complete control.

---

## 📥 Installation

### Method A: Via Obsidian Community Directory (Recommended)
1. Go to **Settings** > **Community plugins** > **Browse**.
2. Search for **Otto**.
3. Click **Install**, then click **Enable**.

### Method B: Via BRAT (Beta Reviewer's Auto-update Tester)
1. Install the **BRAT** plugin from Obsidian's community store.
2. In BRAT settings, click **Add Beta plugin** and enter:
   `https://github.com/carnalMATRIX/obsidian-mantle-otto`
3. Click **Add Plugin** to download and auto-update.

### Method C: Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [GitHub Release](https://github.com/carnalMATRIX/obsidian-mantle-otto/releases).
2. Inside your vault, navigate to `.obsidian/plugins/`.
3. Create a folder named `mantle-otto` and paste the three downloaded files inside.
4. Restart Obsidian, go to **Settings** > **Community plugins**, and enable **Otto**.

---

## 🔍 Troubleshooting

### CLI Connection Errors
* **Gemini CLI on Path:** Ensure the `gemini` CLI tool is installed and is accessible via your system's global `PATH`. You can verify this by opening a terminal and running `gemini --version`.
* **Configuring CLI Path:** Go to **Settings** > **Otto** inside Obsidian and verify that the custom CLI path matches the location on your disk (e.g., `/usr/local/bin/gemini` or `/opt/homebrew/bin/gemini`).

### Context Ingestion is missing information
* **Focus States:** Make sure a markdown note tab is active and focused when you send queries that request "current file" context.

---

## 🛠️ Development

If you wish to modify or customize this plugin locally:
1. Clone this repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run the compiler in watch mode:
   ```bash
   npm run dev
   ```
4. Build minified production code:
   ```bash
   npm run build
   ```

---

## 📄 License

Copyright (c) 2026 Ryan Bakker. Released under a **Personal Use License**. Non-commercial, personal use only. Redistribution or modification for distribution is strictly prohibited. See the `LICENSE` file for full terms.
