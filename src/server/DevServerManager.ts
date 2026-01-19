import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

export class DevServerManager {
    private _process: cp.ChildProcess | null = null;
    private _workspacePath: string;
    private _port: number = 5173; // Default Vite port
    private _serverType: 'vite' | 'cra' | 'next' | 'unknown' = 'unknown';

    constructor(workspacePath: string) {
        this._workspacePath = workspacePath;
    }

    public async start(): Promise<string> {
        await this._detectServerType();

        if (this._serverType === 'unknown') {
            throw new Error('Could not detect project type. Make sure package.json exists.');
        }

        // Check if server is already running
        if (await this._isPortInUse(this._port)) {
            console.log(`Dev server already running on port ${this._port}`);
            return `http://localhost:${this._port}`;
        }

        return new Promise((resolve, reject) => {
            const command = this._getStartCommand();

            vscode.window.showInformationMessage(`Starting ${this._serverType} dev server...`);

            this._process = cp.spawn(command.cmd, command.args, {
                cwd: this._workspacePath,
                shell: true,
                env: { ...process.env, BROWSER: 'none', PORT: String(this._port) },
            });

            let serverStarted = false;
            const timeout = setTimeout(() => {
                if (!serverStarted) {
                    reject(new Error('Dev server startup timeout'));
                }
            }, 30000);

            this._process.stdout?.on('data', (data: Buffer) => {
                const output = data.toString();
                console.log('[DevServer]', output);

                // Check for server ready messages
                if (
                    output.includes('Local:') ||
                    output.includes('localhost:') ||
                    output.includes('ready in') ||
                    output.includes('compiled successfully')
                ) {
                    if (!serverStarted) {
                        serverStarted = true;
                        clearTimeout(timeout);
                        resolve(`http://localhost:${this._port}`);
                    }
                }
            });

            this._process.stderr?.on('data', (data: Buffer) => {
                console.error('[DevServer Error]', data.toString());
            });

            this._process.on('error', (err) => {
                clearTimeout(timeout);
                reject(err);
            });

            this._process.on('exit', (code) => {
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
