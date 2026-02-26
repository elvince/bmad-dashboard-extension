import * as vscode from 'vscode';
import type { DetectionResult } from '../services/bmad-detector';
import type { StateManager } from '../services/state-manager';
import { createStateUpdateMessage } from '../../shared/messages';
import { handleWebviewMessage } from './message-handler';
import { EditorPanelProvider } from './editor-panel-provider';
import { getNonce } from './webview-utils';

/**
 * Provider for the BMAD Dashboard webview in the sidebar
 */
export class DashboardViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'bmad.dashboardView';

  private view?: vscode.WebviewView;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly detectionResult: DetectionResult,
    private readonly stateManager?: StateManager
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'out'),
        vscode.Uri.joinPath(this.extensionUri, 'src', 'webviews'),
      ],
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Handle messages from the webview
    webviewView.webview.onDidReceiveMessage(
      (message: unknown) => {
        handleWebviewMessage(message, this.stateManager, {
          onNavigateEditorPanel: (view, params) => {
            if (this.stateManager) {
              EditorPanelProvider.createOrShow(this.extensionUri, this.stateManager);
              EditorPanelProvider.postNavigateToView(view, params);
            }
          },
        });
      },
      undefined,
      this.disposables
    );

    // Subscribe to state changes and forward to webview
    if (this.stateManager) {
      this.disposables.push(
        this.stateManager.onStateChange((state) => {
          if (this.view) {
            void this.view.webview.postMessage(createStateUpdateMessage(state));
          }
        })
      );

      // Send current state immediately so webview doesn't need a round-trip REFRESH
      void webviewView.webview.postMessage(createStateUpdateMessage(this.stateManager.state));

      // Send initial state when webview becomes visible again after being hidden
      webviewView.onDidChangeVisibility(
        () => {
          if (webviewView.visible && this.stateManager) {
            void this.view!.webview.postMessage(createStateUpdateMessage(this.stateManager.state));
          }
        },
        undefined,
        this.disposables
      );
    }
  }

  /**
   * Generate the HTML content for the webview
   */
  private getHtmlForWebview(webview: vscode.Webview): string {
    if (!this.detectionResult.detected) {
      return this.getNotDetectedHtml(webview);
    }

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'out', 'webview', 'index.css')
    );

    const nonce = getNonce();

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="${styleUri.toString()}" rel="stylesheet" />
        <title>BMAD Dashboard</title>
      </head>
      <body>
        <div id="root"></div>
        <script nonce="${nonce}" src="${scriptUri.toString()}"></script>
      </body>
      </html>
    `;
  }

  /**
   * Generate HTML for non-BMAD workspaces
   */
  private getNotDetectedHtml(webview: vscode.Webview): string {
    const nonce = getNonce();

    return /* html */ `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>BMAD Dashboard</title>
      </head>
      <body>
        <div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground);">
          <p>Not a BMAD project</p>
          <p style="font-size: 12px;">Open a workspace with a <code>_bmad/</code> directory to use the BMAD Dashboard.</p>
          <button id="setup-button" style="cursor: pointer; padding: 8px 16px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; border-radius: 2px;">Setup BMAD</button>
        </div>
        <script nonce="${nonce}">
          (function() {
            const vscode = acquireVsCodeApi();
            const button = document.getElementById('setup-button');
            if (button) {
              button.addEventListener('click', () => {
                vscode.postMessage({
                  type: 'SETUP_BMAD'
                });
              });
            }
          })();
        </script>
      </body>
      </html>
    `;
  }
}
