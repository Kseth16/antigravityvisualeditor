import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class DevServerManager {
    private _process: cp.ChildProcess | null = null;
    private _workspacePath: string;
    private _port: number = 5173; // Default Vite port
    private _serverType: 'vite' | 'cra' | 'next' | 'unknown' = 'unknown';
    private _isStarting: boolean = false;
    private _currentUrl: string | null = null;

    constructor(workspacePath: string) {
        this._workspacePath = workspacePath;
    }

    public async start(): Promise<string> {
        if (this._isStarting) {
            // Wait for existing startup
            return new Promise((resolve, reject) => {
                const check = setInterval(() => {
                    if (this._currentUrl) {
                        clearInterval(check);
                        resolve(this._currentUrl);
                    }
                }, 100);
                setTimeout(() => { clearInterval(check); reject(new Error('Timeout waiting for dev server')); }, 30000);
            });
        }

        if (this._process && !this._process.killed) {
            return this._currentUrl || `http://localhost:${this._port}`;
        }

        this._isStarting = true;
        await this._detectServerType();

        if (this._serverType === 'unknown') {
            this._isStarting = false;
            throw new Error('Could not detect project type. Make sure package.json exists.');
        }

        // We don't check port in use here, let Vite/Next pick its own port 
        // and we'll parse it from stdout. This is much more robust than 
        // trying to guess or hijack.

        return new Promise((resolve, reject) => {
            const command = this._getStartCommand();

            console.log(`[DevServer] Starting ${this._serverType} in ${this._workspacePath}`);

            this._process = cp.spawn(command.cmd, command.args, {
                cwd: this._workspacePath,
                shell: true,
                env: { ...process.env, BROWSER: 'none', PORT: String(this._port) },
            });

            let serverStarted = false;
            const timeout = setTimeout(() => {
                if (!serverStarted) {
                    this._isStarting = false;
                    reject(new Error('Dev server startup timeout'));
                }
            }, 30000);

            this._process.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                console.log('[DevServer]', output);

                // Check for server ready messages and parse port
                // Common pattern: Local: http://localhost:5173/
                const portMatch = output.match(/Local:\s+http:\/\/localhost:(\d+)/i) ||
                    output.match(/localhost:(\d+)/i);

                if (portMatch && !serverStarted) {
                    const actualPort = parseInt(portMatch[1]);
                    this._port = actualPort;
                    this._currentUrl = `http://localhost:${this._port}`;
                    serverStarted = true;
                    this._isStarting = false;
                    clearTimeout(timeout);
                    resolve(this._currentUrl);
                }

                // Fallback for generic "ready" signals if port not found in this chunk
                if (output.includes('ready in') || output.includes('compiled successfully')) {
                    if (!serverStarted) {
                        setTimeout(() => {
                            if (serverStarted) return;
                            serverStarted = true;
                            this._isStarting = false;
                            this._currentUrl = `http://localhost:${this._port}`;
                            clearTimeout(timeout);
                            resolve(this._currentUrl);
                        }, 500);
                    }
                }
            });

            this._process.stderr?.on('data', (data: Buffer) => {
                const err = data.toString();
                console.error('[DevServer Error]', err);
            });

            this._process.on('exit', (code) => {
                console.log(`[DevServer] Process exited with code ${code}`);
                this._isStarting = false;
                this._currentUrl = null;
                this._process = null;
                if (!serverStarted) {
                    clearTimeout(timeout);
                    reject(new Error(`Dev server exited with code ${code}`));
                }
            });
        });
    }

    public stop(): void {
        if (this._process) {
            // Kill the process tree on Windows
            if (process.platform === 'win32') {
                cp.exec(`taskkill /pid ${this._process.pid} /T /F`);
            } else {
                this._process.kill('SIGTERM');
            }
            this._process = null;
            vscode.window.showInformationMessage('Dev server stopped');
        }
    }

    private async _detectServerType(): Promise<void> {
        const packageJsonPath = path.join(this._workspacePath, 'package.json');

        try {
            const content = fs.readFileSync(packageJsonPath, 'utf-8');
            const packageJson = JSON.parse(content);
            const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
            const scripts = packageJson.scripts || {};

            if (deps.next) {
                this._serverType = 'next';
                this._port = 3000;
            } else if (deps.vite || scripts.dev?.includes('vite')) {
                this._serverType = 'vite';
                this._port = 5173;
            } else if (deps['react-scripts']) {
                this._serverType = 'cra';
                this._port = 3000;
            }
        } catch (error) {
            console.error('Failed to detect server type:', error);
        }
    }

    private _getStartCommand(): { cmd: string; args: string[] } {
        switch (this._serverType) {
            case 'vite':
                return { cmd: 'npm', args: ['run', 'dev'] };
            case 'cra':
                return { cmd: 'npm', args: ['start'] };
            case 'next':
                return { cmd: 'npm', args: ['run', 'dev'] };
            default:
                return { cmd: 'npm', args: ['run', 'dev'] };
        }
    }

    private async _isPortInUse(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const net = require('net');
            const server = net.createServer();

            server.once('error', (err: any) => {
                if (err.code === 'EADDRINUSE') {
                    resolve(true);
                } else {
                    resolve(false);
                }
            });

            server.once('listening', () => {
                server.close();
                resolve(false);
            });

            server.listen(port);
        });
    }
}
