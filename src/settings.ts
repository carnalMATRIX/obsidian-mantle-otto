import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import MantleOtto, { GeminiCliManager } from "./main";
import { exec } from "child_process";

export interface MantleOttoSettings {
  cliPath: string;
  approvalMode: string;
  model: string;
}

export const DEFAULT_SETTINGS: MantleOttoSettings = {
  cliPath: "gemini",
  approvalMode: "auto_edit",
  model: "gemini-2.5-flash",
};

export class MantleOttoSettingTab extends PluginSettingTab {
  plugin: MantleOtto;

  constructor(app: App, plugin: MantleOtto) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Otto Settings" });

    new Setting(containerEl)
      .setName("Otto CLI Path")
      .setDesc("The 'home address' of the Gemini program. To find this: 1. Open your Terminal. 2. Type 'which gemini' and hit Enter. 3. Copy the result (e.g., /opt/homebrew/bin/gemini) and paste it here.")
      .addText((text) =>
        text
          .setPlaceholder("/opt/homebrew/bin/gemini")
          .setValue(this.plugin.settings.cliPath)
          .onChange(async (value) => {
            this.plugin.settings.cliPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model")
      .setDesc("Select the AI model for Otto. 'Gemini 1.5 Flash' is recommended for high speed and code understanding.")
      .addDropdown((drop) =>
        drop
          .addOption("gemini-2.5-flash", "Gemini 2.5 Flash (Fastest)")
          .addOption("gemini-2.5-pro", "Gemini 2.5 Pro (Smarter)")
          .setValue(this.plugin.settings.model || "gemini-2.5-flash")
          .onChange(async (value) => {
            this.plugin.settings.model = value;
            await this.plugin.saveSettings();
          })
      );

    const approvalSetting = new Setting(containerEl)
      .setName("Approval Mode")
      .setDesc("Set the tool approval mode for the agent.")
      .addDropdown((drop) =>
        drop
          .addOption("default", "Default (Prompt)")
          .addOption("auto_edit", "Auto-Edit (Safe)")
          .addOption("yolo", "YOLO (Full Auto)")
          .addOption("plan", "Plan (Read-only)")
          .setValue(this.plugin.settings.approvalMode)
          .onChange(async (value) => {
            this.plugin.settings.approvalMode = value;
            await this.plugin.saveSettings();
            updateApprovalSummary(value);
          })
      );

    const approvalSummary = containerEl.createEl("p", { 
      cls: "gemini-settings-approval-summary",
    });
    approvalSummary.style.fontSize = "0.85em";
    approvalSummary.style.marginTop = "-10px";
    approvalSummary.style.padding = "0 15px 15px 15px";
    approvalSummary.style.color = "var(--text-muted)";
    approvalSummary.style.fontStyle = "italic";

    const updateApprovalSummary = (mode: string) => {
      let text = "";
      switch (mode) {
        case "default":
          text = "Gemini will ask for your explicit permission before performing any action (reading files, editing, etc.). Highest safety.";
          break;
        case "auto_edit":
          text = "Gemini can read and edit files automatically, but will still prompt you for sensitive system-level actions. Good balance of speed and safety.";
          break;
        case "yolo":
          text = "Gemini has full autonomy. It will perform all actions, including file edits and shell commands, without asking for confirmation. Use with caution!";
          break;
        case "plan":
          text = "Gemini is restricted to read-only mode. It can analyze your vault but cannot make any changes. safest for pure research.";
          break;
      }
      approvalSummary.setText(text);
    };

    updateApprovalSummary(this.plugin.settings.approvalMode);

    containerEl.createEl("h3", { text: "Authentication & Connection" });

    const authInfo = containerEl.createDiv({ cls: "gemini-settings-auth-info" });
    authInfo.style.marginBottom = "15px";
    authInfo.style.fontSize = "0.9em";
    authInfo.style.color = "var(--text-muted)";
    authInfo.setText("Authentication is managed by the native Gemini CLI. Your session is securely stored in ~/.gemini/.");

    new Setting(containerEl)
      .setName("Check Connection")
      .setDesc("Test if Otto is accessible and authenticated.")
      .addButton((btn) =>
        btn.setButtonText("Test Connection").onClick(() => {
          this.testConnection();
        })
      )
      .addButton((btn) =>
        btn.setButtonText("Auto-detect Path").onClick(() => {
          this.autoDetectPath();
        })
      );

    new Setting(containerEl)
      .setName("Login / Re-authenticate")
      .setDesc("Trigger the Google Account login flow.")
      .addButton((btn) =>
        btn
          .setButtonText("Login")
          .setCta()
          .onClick(() => {
            this.runLogin();
          })
      );

    containerEl.createEl("h3", { text: "Legal, Support & Disclaimers" });

    const legalDesc = containerEl.createDiv({ cls: "gemini-settings-legal-info" });
    legalDesc.style.marginBottom = "15px";
    legalDesc.style.fontSize = "0.9em";
    legalDesc.style.color = "var(--text-muted)";
    legalDesc.createEl("p", {
      text: "Otto is a visual interface for the official Google Gemini CLI. Your usage is governed by Google's established terms and privacy policies."
    });

    new Setting(containerEl)
      .setName("Terms of Service")
      .setDesc("View the official legal terms for Google Services and Gemini.")
      .addButton(btn => btn
        .setButtonText("Google Terms")
        .onClick(() => window.open("https://policies.google.com/terms"))
      )
      .addButton(btn => btn
        .setButtonText("Gemini Terms")
        .onClick(() => window.open("https://cloud.google.com/gemini/docs/codeassist/terms"))
      );

    new Setting(containerEl)
      .setName("Support & Documentation")
      .setDesc("Access official resources for the underlying Gemini CLI tool.")
      .addButton(btn => btn
        .setButtonText("Documentation")
        .onClick(() => window.open("https://geminicli.com"))
      )
      .addButton(btn => btn
        .setButtonText("GitHub Repo")
        .onClick(() => window.open("https://github.com/google/gemini-cli"))
      );

    const disclaimerEl = containerEl.createDiv({ cls: "gemini-settings-disclaimer" });
    disclaimerEl.style.marginTop = "20px";
    disclaimerEl.style.padding = "15px";
    disclaimerEl.style.borderRadius = "8px";
    disclaimerEl.style.backgroundColor = "var(--background-secondary-alt)";
    disclaimerEl.style.border = "1px solid var(--background-modifier-border)";

    const disclaimerTitle = disclaimerEl.createEl("strong", { text: "⚠️ AI Disclaimer" });
    disclaimerTitle.style.display = "block";
    disclaimerTitle.style.marginBottom = "8px";
    disclaimerTitle.style.color = "var(--text-accent)";

    disclaimerEl.createEl("p", {
      text: "Otto utilizes the Google Gemini CLI. AI-generated content can be inaccurate, biased, or incomplete. Do not rely on it for medical, legal, financial, or professional advice. You are responsible for verifying any output before use. Otto is not an official Google product.",
      cls: "gemini-disclaimer-text"
    }).style.fontSize = "0.85em";
  }

  async testConnection() {
    new Notice("Testing connection to Otto...");
    const cmd = this.plugin.settings.cliPath;
    const cliManager = new GeminiCliManager(this.plugin);
    const env = cliManager.getEnv();
    
    // 1. Check if the CLI path is valid
    exec(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, { env }, (err, stdout) => {
        const resolvedPath = stdout.trim().split("\n")[0]; // Take first result
        if (!resolvedPath) {
            new Notice(`❌ Gemini program not found. Please check your CLI Path or use 'Auto-detect'.`);
            return;
        }

        // 2. Check if Node is available
        exec("node -v", { env }, (nodeErr) => {
            if (nodeErr) {
                new Notice(`❌ Node.js not found. The Gemini CLI requires Node.js. Please install it from nodejs.org.`);
                return;
            }

            // 3. Try running the actual version check
            exec(`${cmd} --version`, { env }, (error, stdout, stderr) => {
                if (error) {
                    if (stderr.includes("node: not found")) {
                        new Notice(`❌ Found Gemini, but it can't find Node.js. Try providing the absolute path to Gemini (e.g. /opt/homebrew/bin/gemini).`);
                    } else if (stderr.includes("login") || stderr.includes("auth")) {
                        new Notice(`⚠️ Connected, but Authentication is required. Click 'Login' below.`);
                    } else {
                        new Notice(`❌ Connection Failed: ${stderr || error.message}`);
                    }
                } else {
                    new Notice(`✅ Connection Successful!\nResolved to: ${resolvedPath}\nVersion: ${stdout.trim()}`);
                }
            });
        });
    });
  }

  async autoDetectPath() {
    new Notice("Searching for gemini binary...");
    const isWin = process.platform === "win32";
    const home = process.env.HOME || process.env.USERPROFILE;
    const cliManager = new GeminiCliManager(this.plugin);
    const env = cliManager.getEnv();

    const commonPaths = isWin ? [
        process.env.APPDATA + "\\npm\\gemini.cmd",
        process.env.LOCALAPPDATA + "\\bin\\gemini.cmd",
        "C:\\Program Files\\nodejs\\gemini.cmd"
    ] : [
        "/opt/homebrew/bin/gemini",
        "/usr/local/bin/gemini",
        "/usr/bin/gemini",
        home + "/Library/pnpm/gemini",
        home + "/.npm-global/bin/gemini",
        home + "/.local/bin/gemini"
    ];

    let found = false;
    for (const path of commonPaths) {
        if (await this.checkPath(path)) {
            this.plugin.settings.cliPath = path;
            await this.plugin.saveSettings();
            this.display();
            new Notice(`✅ Found gemini at: ${path}`);
            found = true;
            break;
        }
    }

    if (!found) {
        const searchCmd = isWin ? "where gemini" : "which gemini";
        exec(searchCmd, { env }, async (error, stdout) => {
            if (!error && stdout.trim()) {
                const path = stdout.trim().split("\n")[0];
                this.plugin.settings.cliPath = path;
                await this.plugin.saveSettings();
                this.display();
                new Notice(`✅ Found gemini via system search at: ${path}`);
            } else {
                new Notice("❌ Could not auto-detect gemini. Please enter the path manually (see 'which gemini' in your terminal).");
            }
        });
    }
  }

  private checkPath(path: string): Promise<boolean> {
    const cliManager = new GeminiCliManager(this.plugin);
    const env = cliManager.getEnv();
    return new Promise((resolve) => {
        exec(`${path} --version`, { env }, (error) => {
            resolve(!error);
        });
    });
  }

  async runLogin() {
    new Notice("Triggering login flow. Please check your terminal or browser.");
    // Force a login check that triggers browser
    this.plugin.cliManager.checkAndAuthenticate().then(success => {
        if (success) {
            new Notice("Authentication successful!");
        } else {
            new Notice("Authentication failed or was cancelled.");
        }
    });
  }
}
