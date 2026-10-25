/**
 * Native folder picker for the local UI.
 *
 * The host OS dialog returns the selected directory to the Node process, which
 * then opens it through FileSystemVault.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function pickFolder(): Promise<string | null> {
  if (process.platform === 'win32') return pickWindows();
  if (process.platform === 'darwin') return pickMac();
  if (process.platform === 'linux') return pickLinux();
  throw new Error(`Native folder picker is not supported on ${process.platform}`);
}

async function pickWindows(): Promise<string | null> {
  const script = [
    "$ErrorActionPreference = 'Stop';",
    'Add-Type -AssemblyName System.Windows.Forms;',
    '$owner = New-Object System.Windows.Forms.Form;',
    "$owner.Text = 'Nodus';",
    '$owner.ShowInTaskbar = $false;',
    '$owner.TopMost = $true;',
    "$owner.WindowState = 'Minimized';",
    '$owner.Show();',
    'try {',
    '  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
    "  $dialog.Description = 'Select a Nodus vault folder';",
    '  $dialog.ShowNewFolderButton = $true;',
    '  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {',
    '    [Console]::Out.Write($dialog.SelectedPath);',
    '  }',
    '} finally {',
    '  $owner.Close();',
    '  $owner.Dispose();',
    '}',
  ].join(' ');

  return runPicker('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
}

async function pickMac(): Promise<string | null> {
  return runPicker('osascript', [
    '-e',
    'POSIX path of (choose folder with prompt "Select a Nodus vault folder")',
  ]);
}

async function pickLinux(): Promise<string | null> {
  try {
    return await runPicker('zenity', [
      '--file-selection',
      '--directory',
      '--title=Select a Nodus vault folder',
    ]);
  } catch (error) {
    if (!isMissingCommand(error)) throw error;
  }

  try {
    return await runPicker('kdialog', [
      '--getexistingdirectory',
      '.',
      '--title',
      'Select a Nodus vault folder',
    ]);
  } catch (error) {
    if (isMissingCommand(error)) {
      throw new Error('Install zenity or kdialog to use the native folder picker');
    }
    throw error;
  }
}

async function runPicker(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: 'utf8',
      windowsHide: false,
      maxBuffer: 64 * 1024,
      timeout: 120_000,
    });
    const selected = stdout.trim();
    return selected.length === 0 ? null : selected;
  } catch (error) {
    if (isMissingCommand(error)) throw error;
    const stderr = (error as { stderr?: string }).stderr?.trim();
    if (process.platform === 'win32' && stderr) {
      throw new Error(`Folder picker failed: ${stderr}`);
    }
    // Native pickers exit non-zero when the user cancels.
    return null;
  }
}

function isMissingCommand(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}
