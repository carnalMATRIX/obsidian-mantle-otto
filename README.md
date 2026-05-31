# Otto

> [!CAUTION]
> **Status: Beta (v1.0.0)**  
> This plugin is currently in Alpha. Features and UI are subject to change.

Otto is a production-ready, beautiful visual UI wrapper for the native Gemini CLI. It brings secure workspace agent operations directly into your Obsidian vault layout, allowing you to interact with AI agents in a context-aware environment.

## Features

- **Secure Integration**: Connects to the native Gemini CLI for secure, local-first agent operations.
- **Visual Chat Interface**: A polished, responsive UI for interacting with agents.
- **Context-Aware**: Injects current file and vault context into agent queries for more accurate results.
- **Zenith Optimized**: Specifically designed to match the aesthetics of the [Zenith theme](https://github.com/carnalMATRIX/obsidian-mantle-zenith).

## Installation

### Manual Installation

1. Download the `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `mantle-otto` in your vault's `.obsidian/plugins/` directory.
3. Move the downloaded files into that folder.
4. Restart Obsidian and enable **Otto** in **Settings > Community plugins**.

## Development

To modify this plugin:

1. Navigate to this directory in your terminal.
2. Install dependencies: `npm install`
3. Build the plugin: `npm run build`
4. For active development, use: `npm run dev`

This plugin is built with TypeScript and esbuild.
