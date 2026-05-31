import {
  Plugin,
  ItemView,
  WorkspaceLeaf,
  setIcon,
  MarkdownRenderer,
  TFile,
  Notice,
  AbstractInputSuggest,
  App,
} from "obsidian";
import { spawn, ChildProcess, exec } from "child_process";
import {
  MantleOttoSettings,
  DEFAULT_SETTINGS,
  MantleOttoSettingTab,
} from "./settings";

export const MANTLE_OTTO_VIEW = "mantle-otto-view";

export default class MantleOtto extends Plugin {
  settings!: MantleOttoSettings;
  cliManager!: GeminiCliManager;

  async onload() {
    console.log("Otto: Loading...");

    await this.loadSettings();
    this.cliManager = new GeminiCliManager(this);

    this.registerView(
      MANTLE_OTTO_VIEW,
      (leaf) => new MantleOttoView(leaf, this),
    );

    this.addSettingTab(new MantleOttoSettingTab(this.app, this));

    this.addRibbonIcon("sparkles", "Otto", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-otto",
      name: "Open Otto Chat",
      callback: () => this.activateView(),
    });

    this.app.workspace.onLayoutReady(() => {
      // Warm up the CLI (auth check) on startup
      this.cliManager.checkAndAuthenticate().then((authed) => {
        if (authed) console.log("Otto: CLI initialized and authenticated.");
      });

      if (
        this.app.workspace.getLeavesOfType(MANTLE_OTTO_VIEW).length === 0
      ) {
        this.initView();
      }
    });
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async initView() {
    const { workspace } = this.app;
    if (workspace.getLeavesOfType(MANTLE_OTTO_VIEW).length > 0) return;

    let leaf = workspace.getRightLeaf(true);
    if (leaf) {
      await leaf.setViewState({
        type: MANTLE_OTTO_VIEW,
        active: true,
      });
    }
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = null;
    const leaves = workspace.getLeavesOfType(MANTLE_OTTO_VIEW);

    if (leaves.length > 0) {
      leaf = leaves[0];
    } else {
      leaf = workspace.getRightLeaf(true);
      if (leaf) {
        await leaf.setViewState({
          type: MANTLE_OTTO_VIEW,
          active: true,
        });
      }
    }

    if (leaf) {
      workspace.revealLeaf(leaf);
    }
  }
}

/**
 * Manages the background execution of the Gemini CLI,
 * including seamless authentication and headless prompting.
 */
export class GeminiCliManager {
  private plugin: MantleOtto;
  private sessionActive: boolean = false;

  constructor(plugin: MantleOtto) {
    this.plugin = plugin;
  }

  public resetSession() {
    this.sessionActive = false;
  }

  public getEnv() {
    const env = { ...process.env };
    const isWin = process.platform === "win32";

    const commonPaths = isWin
      ? [
          "C:\\Program Files\\nodejs",
          process.env.APPDATA + "\\npm",
          process.env.LOCALAPPDATA + "\\bin",
        ]
      : [
          "/opt/homebrew/bin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
          process.env.HOME + "/Library/pnpm",
          process.env.HOME + "/.npm-global/bin",
          process.env.HOME + "/.local/bin",
          process.env.HOME + "/.nvm/versions/node/v*/bin", // Support NVM
        ];

    const separator = isWin ? ";" : ":";
    env.PATH = `${commonPaths.join(separator)}${separator}${env.PATH || ""}`;

    // Inject Otto's system instructions
    const vaultPath = this.getVaultPath();
    env.GEMINI_SYSTEM_MD = `${vaultPath}/.obsidian/plugins/mantle-otto/OTTO.md`;

    return env;
  }

  private getVaultPath() {
    // @ts-ignore
    return (this.plugin.app.vault.adapter as any).getBasePath();
  }

  /**
   * Verifies if the user is logged in, and if not, triggers the silent OAuth flow.
   */
  public async checkAndAuthenticate(): Promise<boolean> {
    return new Promise((resolve) => {
      const cli = this.plugin.settings.cliPath;

      // Check auth state via version or low-cost command
      exec(`${cli} --version`, { env: this.getEnv() }, (error) => {
        if (!error) {
          resolve(true);
          return;
        }

        new Notice("Otto: Initiating secure Google Sign-In...");
        this.triggerSilentLogin(resolve);
      });
    });
  }

  private triggerSilentLogin(resolve: (val: boolean) => void) {
    const cli = this.plugin.settings.cliPath;
    const loginProcess = spawn(cli, [], {
      cwd: this.getVaultPath(),
      env: this.getEnv(),
      shell: true,
    });

    const handleData = (data: Buffer) => {
      const output = data.toString();
      console.log("Gemini Login Output:", output);

      // Intercept interactive prompt selection (1) Login with Google)
      // We look for "Login with Google", "Sign in", or the explicit list "1)"
      if (/Login with Google|Sign in|1\)/i.test(output)) {
        loginProcess.stdin.write("1\n");
      }
    };

    loginProcess.stdout.on("data", handleData);
    loginProcess.stderr.on("data", handleData);

    loginProcess.on("close", (code) => {
      if (code === 0) {
        new Notice("Otto: Authentication Successful!");
        resolve(true);
      } else {
        // If code is not 0, it might still have succeeded if the browser opened
        // and the user finished, but the process terminated for other reasons.
        // We'll resolve true if we saw evidence of success or just a clean close.
        resolve(code === 0);
      }
    });

    loginProcess.on("error", (err) => {
      console.error("Login spawn error:", err);
      new Notice(`Otto: Failed to launch CLI. Check your path settings.`);
      resolve(false);
    });
  }

  public sendPrompt(
    prompt: string,
    onUpdate: (chunk: string) => void,
    onComplete: (res: string) => void,
    onError: (err: any) => void,
    onStatus?: (status: string) => void,
  ): ChildProcess {
    const cli = this.plugin.settings.cliPath;
    const vaultPath = this.getVaultPath();
    const settings = this.plugin.settings;

    // --- DATA FLOW OPTIMIZATION: Context Injection ---
    // Automatically inject the active file to avoid 'Search' turns
    const activeFile = this.plugin.app.workspace.getActiveFile();
    let optimizedPrompt = prompt;
    if (activeFile && !prompt.includes("@")) {
      optimizedPrompt = `(Context: You are currently looking at @${activeFile.path}) ${prompt}`;
    }

    const args: string[] = [];
    args.push("-p", optimizedPrompt);
    args.push("--output-format", "stream-json");
    args.push("--skip-trust");
    args.push("--raw-output");

    if (this.sessionActive) {
      args.push("--resume", "latest");
    }

    args.push("--approval-mode", settings.approvalMode);
    if (settings.model) {
      args.push("--model", settings.model);
    }

    // After the first prompt, we want to resume
    this.sessionActive = true;

    // --- DATA FLOW OPTIMIZATION: Shell-less Spawn ---
    // We use shell: true only if the path isn't absolute to allow system PATH resolution
    const isAbsolutePath = cli.startsWith("/") || cli.includes(":");

    const agentProcess = spawn(cli, args, {
      cwd: vaultPath,
      env: this.getEnv(),
      shell: !isAbsolutePath,
    });

    let stdoutData = "";
    let stderrData = "";
    let fullResponse = "";
    let lineBuffer = "";

    agentProcess.stdout?.on("data", (data) => {
      const chunk = data.toString();
      stdoutData += chunk;
      lineBuffer += chunk;

      let breakIndex: number;
      while ((breakIndex = lineBuffer.indexOf("\n")) !== -1) {
        const line = lineBuffer.substring(0, breakIndex).trim();
        lineBuffer = lineBuffer.substring(breakIndex + 1);

        if (!line) continue;

        try {
          const json = JSON.parse(line);

          console.log("Gemini CLI JSON Output:", json);

          if (json.type === "tool_code_error") {
            console.error("Gemini CLI Tool Error:", json);
            onError({
              type: "tool_error",
              message: `Tool Failed: ${json.tool_name} - ${json.error}`,
            });
            return; // Stop processing further output for this prompt
          }

          if (json.type === "tool_code_pending") {
            console.warn("Gemini CLI Tool Approval Pending:", json);
            onError({
              type: "tool_pending",
              message: `Tool Approval Required: ${json.tool_name} for ${json.parameters.file_path || "an action"}. Please set approval mode to 'Auto-Edit' or 'YOLO' in settings to bypass, or interact via terminal.`,
            });
            return; // Stop processing further output for this prompt
          }

          if (json.type === "tool_use" && onStatus) {
            const tool = json.tool_name;
            const params = json.parameters || {};
            let status = "";
            if (tool === "read_file")
              status = `Reading ${params.file_path.split("/").pop()}...`;
            else if (tool === "grep_search")
              status = `Searching for "${params.pattern}"...`;
            else if (tool === "list_directory")
              status = `Checking ${params.dir_path || "vault"}...`;
            else if (tool === "replace" || tool === "write_file")
              status = `Updating ${params.file_path.split("/").pop()}...`;
            else status = `Using ${tool}...`;
            onStatus(status);
          }

          if (
            json.type === "message" &&
            json.role === "assistant" &&
            json.content
          ) {
            if (json.delta) {
              fullResponse += json.content;
              onUpdate(json.content);
            } else {
              if (!fullResponse) {
                fullResponse = json.content;
                onUpdate(json.content);
              }
            }
          }

          // Also check for final response in result or generic response objects
          if (json.response && !fullResponse) {
            fullResponse = json.response;
          }
        } catch (e) {
          // Ignore lines that aren't valid JSON (like non-formatted CLI noise)
        }
      }
    });

    agentProcess.stderr?.on("data", (data) => {
      stderrData += data.toString();
    });

    agentProcess.on("close", (code) => {
      if (code === 0) {
        if (fullResponse) {
          onComplete(fullResponse);
        } else {
          try {
            const jsonMatch = stdoutData.match(/\{[\s\S]*\}/g);
            const lastJson = jsonMatch
              ? JSON.parse(jsonMatch[jsonMatch.length - 1])
              : null;
            onComplete(
              lastJson?.response ||
                lastJson?.answer ||
                lastJson?.output ||
                stdoutData ||
                "No response received.",
            );
          } catch (e) {
            onComplete(stdoutData || "No response received.");
          }
        }
      } else if (code !== null) {
        if (stderrData.includes("auth") || stderrData.includes("login")) {
          onError({ type: "auth", message: "Auth required" });
        } else if (stderrData.includes("429")) {
          onError({ type: "rate", message: "Rate limit exceeded" });
        } else {
          onError({ type: "error", message: stderrData || "Unknown error" });
        }
      }
    });

    return agentProcess;
  }
}

class NoteSuggester extends AbstractInputSuggest<TFile> {
  inputEl: HTMLTextAreaElement;

  constructor(app: App, inputEl: HTMLTextAreaElement) {
    super(app, inputEl as any);
    this.inputEl = inputEl;
  }

  getSuggestions(query: string): TFile[] {
    const text = this.inputEl.value.substring(0, this.inputEl.selectionStart);
    const lastAt = text.lastIndexOf("@");
    if (lastAt === -1) return [];

    const fileQuery = text.substring(lastAt + 1).toLowerCase();
    if (fileQuery.includes(" ")) return [];

    const files = this.app.vault.getMarkdownFiles();
    return files
      .filter((file) => file.path.toLowerCase().includes(fileQuery))
      .slice(0, 10);
  }

  renderSuggestion(file: TFile, el: HTMLElement) {
    el.setText(file.path);
    el.addClass("otto-suggestion-item");
  }

  selectSuggestion(file: TFile) {
    const inputEl = this.inputEl;
    const cursor = inputEl.selectionStart;
    const text = inputEl.value;

    // Find the @ trigger before the cursor
    const lastAt = text.substring(0, cursor).lastIndexOf("@");
    if (lastAt !== -1) {
      const before = text.substring(0, lastAt);
      const after = text.substring(cursor);

      // Use the vault-relative path and quote if it contains spaces
      const filePath = file.path.includes(" ") ? `"${file.path}"` : file.path;
      const insertion = `@${filePath} `;

      inputEl.value = before + insertion + after;

      // Set cursor position after the inserted path
      const newCursorPos = lastAt + insertion.length;
      inputEl.setSelectionRange(newCursorPos, newCursorPos);
      inputEl.focus();
    }
    this.close();
  }
}

class MantleOttoView extends ItemView {
  plugin: MantleOtto;
  chatContainer!: HTMLElement;
  inputEl!: HTMLTextAreaElement;
  statusEl!: HTMLElement;
  actionsContainer!: HTMLElement;
  isProcessing: boolean = false;
  currentProcess: ChildProcess | null = null;
  noteSuggester!: NoteSuggester;

  // Typewriter streaming state
  private streamingInterval: ReturnType<typeof setInterval> | null = null;
  private streamingTargetEl: HTMLElement | null = null;
  private streamingFullText: string = "";
  private streamingDisplayedText: string = "";
  private isRenderingMarkdown: boolean = false;

  constructor(leaf: WorkspaceLeaf, plugin: MantleOtto) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return MANTLE_OTTO_VIEW;
  }

  getDisplayText(): string {
    return "Otto";
  }

  getIcon(): string {
    return "sparkles";
  }

  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("mantle-otto-container");

    // Chat View
    this.chatContainer = container.createDiv({
      cls: "mantle-otto-chat-view",
    });

    // Input Area
    const inputArea = container.createDiv({
      cls: "mantle-otto-input-area",
    });
    const inputWrapper = inputArea.createDiv({
      cls: "mantle-otto-input-wrapper",
    });

    const inputContainer = inputWrapper.createDiv({
      cls: "mantle-otto-input-container",
    });
    this.inputEl = inputContainer.createEl("textarea", {
      cls: "mantle-otto-input",
      attr: {
        placeholder: "Ask Otto anything... (Use @ to link context files)",
      },
    });

    // Action Buttons
    this.actionsContainer = inputContainer.createDiv({
      cls: "mantle-otto-actions",
    });
    this.renderActions();

    // Register Note Suggester
    this.noteSuggester = new NoteSuggester(this.app, this.inputEl);

    this.inputEl.addEventListener("input", () => {
      this.renderActions();
    });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        // Check if the suggestion menu is visible in the DOM
        const isSuggesterOpen = !!document.querySelector(
          ".suggestion-container",
        );

        if (isSuggesterOpen) {
          // Allow Obsidian to handle the Enter key for suggestion selection
          return;
        }

        e.preventDefault();
        this.handleSubmit();
      }
    });

    // Initial welcome message
    this.appendMessage("bot", "Hi! I'm Otto. How can I help?");

    // Auto-check auth on open
    this.checkAuth();

    // Forced loading state for editing the animation
    // this.setLoading(true);
  }

  async checkAuth() {
    const authed = await this.plugin.cliManager.checkAndAuthenticate();
    if (!authed) {
      this.appendMessage(
        "bot",
        "⚠️ Authentication failed or CLI not found. Please check your settings.",
        "error",
      );
    }
  }

  renderActions() {
    this.actionsContainer.empty();

    const resetBtn = this.actionsContainer.createEl("button", {
      cls: "otto-action-btn reset",
      attr: { "aria-label": "Reset Chat" },
    });
    setIcon(resetBtn, "rotate-ccw");
    resetBtn.onclick = () => this.handleReset();

    if (this.isProcessing) {
      const cancelBtn = this.actionsContainer.createEl("button", {
        cls: "otto-action-btn cancel",
        attr: { "aria-label": "Cancel response" },
      });
      setIcon(cancelBtn, "square");
      cancelBtn.onclick = () => this.handleCancel();
    } else {
      const submitBtn = this.actionsContainer.createEl("button", {
        cls: "otto-action-btn submit",
        attr: { "aria-label": "Send prompt" },
      });
      setIcon(submitBtn, "send");

      const hasText = this.inputEl.value.trim().length > 0;
      (submitBtn as HTMLButtonElement).disabled = !hasText;

      submitBtn.onclick = () => this.handleSubmit();
    }
  }

  async handleReset() {
    if (this.isProcessing) {
      await this.handleCancel();
    }
    this.plugin.cliManager.resetSession();
    this.chatContainer.empty();
    this.appendMessage("bot", "Chat reset. How can I help you today?");
  }

  async handleCancel() {
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
      this.setLoading(false);
      this.appendMessage("bot", "_Response cancelled by user._", "error");
    }
  }

  async handleSubmit() {
    const prompt = this.inputEl.value.trim();
    if (!prompt || this.isProcessing) return;

    if (prompt.toLowerCase() === "/clear") {
      this.inputEl.value = "";
      await this.handleReset();
      return;
    }

    this.inputEl.value = "";
    this.appendMessage("user", prompt);

    this.setLoading(true);

    let botMsgEl: HTMLElement | null = null;
    this.streamingFullText = "";
    this.streamingDisplayedText = "";
    this.streamingTargetEl = null;

    this.currentProcess = this.plugin.cliManager.sendPrompt(
      prompt,
      (chunk) => {
        if (!botMsgEl) {
          this.setLoading(false);
          botMsgEl = this.appendMessage("bot", "");
          this.streamingTargetEl = botMsgEl.querySelector(
            ".markdown-rendered",
          ) as HTMLElement;

          // Start typewriter interval
          this.streamingInterval = setInterval(async () => {
            if (
              this.streamingDisplayedText.length <
                this.streamingFullText.length &&
              !this.isRenderingMarkdown
            ) {
              this.isRenderingMarkdown = true;

              // Dynamic speed: add more characters if the buffer is large
              const remaining =
                this.streamingFullText.length -
                this.streamingDisplayedText.length;
              const charsToAdd = Math.max(1, Math.ceil(remaining * 0.15));

              this.streamingDisplayedText += this.streamingFullText.substring(
                this.streamingDisplayedText.length,
                this.streamingDisplayedText.length + charsToAdd,
              );

              if (this.streamingTargetEl) {
                this.streamingTargetEl.empty();
                await MarkdownRenderer.renderMarkdown(
                  this.streamingDisplayedText,
                  this.streamingTargetEl,
                  "",
                  this.plugin,
                );
              }
              this.chatContainer.scrollTo({
                top: this.chatContainer.scrollHeight,
                behavior: "smooth",
              });

              this.isRenderingMarkdown = false;
            }
          }, 30);
        }
        this.streamingFullText += chunk;
      },
      (response) => {
        if (this.streamingInterval) {
          clearInterval(this.streamingInterval);
          this.streamingInterval = null;
        }

        this.setLoading(false);
        if (!botMsgEl) {
          this.appendMessage("bot", response);
        } else {
          const renderContainer = botMsgEl.querySelector(".markdown-rendered");
          if (renderContainer) {
            renderContainer.empty();
            MarkdownRenderer.renderMarkdown(
              response,
              renderContainer as HTMLElement,
              "",
              this.plugin,
            );
          }
        }
      },
      (err) => {
        if (this.streamingInterval) {
          clearInterval(this.streamingInterval);
          this.streamingInterval = null;
        }
        this.setLoading(false);
        this.handleError(err);
      },
      (status) => {
        const loaderText =
          this.chatContainer.querySelector(".otto-loading-text");
        if (loaderText) {
          loaderText.setText(status);
        }
      },
    );
  }

  handleError(err: any) {
    if (err.type === "auth") {
      const notice = this.chatContainer.createDiv({
        cls: "otto-auth-notice",
      });
      notice.createSpan({
        text: "Authentication Required: Your Google Account is not linked with Otto.",
      });
      const authBtn = notice.createEl("button", {
        cls: "otto-auth-btn",
        text: "Link Account Now",
      });
      authBtn.onclick = async () => {
        notice.remove();
        this.setLoading(true);
        const success = await this.plugin.cliManager.checkAndAuthenticate();
        this.setLoading(false);
        if (success) {
          this.appendMessage(
            "bot",
            "✅ Authentication successful! You can now send prompts.",
          );
        }
      };
    } else if (err.type === "rate") {
      this.appendMessage(
        "bot",
        `⚠️ Rate limit exceeded. Please try again in a moment.`,
        "error",
      );
    } else if (err.type === "tool_error") {
      this.appendMessage("bot", `❌ ${err.message}`, "error");
    } else if (err.type === "tool_pending") {
      this.appendMessage("bot", `⚠️ ${err.message}`, "warning");
    } else {
      this.appendMessage("bot", `Error: ${err.message || err}`, "error");
    }
  }

  setLoading(loading: boolean) {
    this.isProcessing = loading;

    // Clear existing loader message if it exists
    const existingLoader = this.chatContainer.querySelector(
      ".otto-loader-message",
    );
    if (existingLoader) {
      existingLoader.remove();
    }

    // const msgEl = this.chatContainer.createDiv({ cls: "otto-message bot otto-loader-message" });

    if (loading) {
      const msgEl = this.chatContainer.createDiv({
        cls: "bot otto-loader-message",
      });
      const loaderContainer = msgEl.createDiv({
        cls: "otto-loading-container",
      });

      const loader = loaderContainer.createDiv({ cls: "otto-loader" });
      loader.innerHTML = `
        <svg width="100" height="100" viewBox="0 0 100 100">
          <defs>
            <mask id="otto-clipping">
              <polygon points="0,0 100,0 100,100 0,100" fill="black" />
              <polygon points="25,25 75,25 50,75" fill="white" />
              <polygon points="50,25 75,75 25,75" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
              <polygon points="35,35 65,35 50,65" fill="white" />
            </mask>
          </defs>
        </svg>
        <div class="otto-box"></div>
      `;

      loaderContainer.createDiv({
        cls: "otto-loading-text",
        text: "Awaiting response...",
      });
      this.inputEl.disabled = true;

      this.chatContainer.scrollTo({
        top: this.chatContainer.scrollHeight,
        behavior: "smooth",
      });
    } else {
      this.inputEl.disabled = false;
      this.inputEl.focus();
    }
    this.renderActions();
  }

  appendMessage(role: "user" | "bot", content: string, cls?: string) {
    const msgEl = this.chatContainer.createDiv({
      cls: `otto-message ${role} ${cls || ""}`,
    });

    if (role === "bot") {
      const renderContainer = msgEl.createDiv({ cls: "markdown-rendered" });
      MarkdownRenderer.renderMarkdown(
        content,
        renderContainer,
        "",
        this.plugin,
      );

      // Add copy button
      const copyBtn = msgEl.createDiv({
        cls: "otto-copy-btn",
        attr: { "aria-label": "Copy response" },
      });
      setIcon(copyBtn, "copy");
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(content);
        new Notice("Copied to clipboard");
      };
    } else {
      msgEl.setText(content);
    }

    this.chatContainer.scrollTo({
      top: this.chatContainer.scrollHeight,
      behavior: "smooth",
    });

    return msgEl;
  }
}
