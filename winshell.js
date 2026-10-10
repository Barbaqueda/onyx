/* Onyx ↔ Windows: the clipboard Explorer uses for files, the real right-click menu, Properties, Open with,
   Open in Terminal, ZIP files. Uses the PowerShell that ships with Windows; on other systems the helpers fall back
   to what's there (or say it's Windows-only). */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const WIN = process.platform === 'win32';
const PS = () => (WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh');
const enc = s => Buffer.from(s, 'utf16le').toString('base64');

function runPs(script, env, opts) {
  opts = opts || {};
  return new Promise(resolve => {
    let out = '', err = '', done = false;
    let child;
    try {
      child = spawn(PS(), ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc(script)], {
        windowsHide: true, env: Object.assign({}, process.env, env || {}), stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) { resolve({ code: -1, out: '', err: e.message }); return; }
    const finish = r => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
    const t = opts.timeout ? setTimeout(() => { try { child.kill(); } catch { /* gone */ } finish({ code: -1, out, err: 'timed out' }); }, opts.timeout) : null;
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => finish({ code: -1, out, err: e.message }));
    child.on('close', code => finish({ code, out, err }));
  });
}
const psErr = r => (r.err || '').split(/\r?\n/).map(s => s.trim()).filter(s => s && !/^(At line|\+|CategoryInfo|FullyQualifiedErrorId)/.test(s))[0] || 'PowerShell failed';

// ---------------------------------------------------------------- clipboard (a small PowerShell kept running, so copy and paste are instant)
const CLIP_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Windows.Forms
function Send-Reply($id, $obj) {
  $j = (@{ id = $id; r = $obj } | ConvertTo-Json -Compress -Depth 5)
  [Console]::Out.WriteLine($j)
  [Console]::Out.Flush()
}
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  $id = 0
  try {
    $m = $line | ConvertFrom-Json
    $id = $m.id
    if ($m.cmd -eq 'set') {
      $list = New-Object System.Collections.Specialized.StringCollection
      foreach ($x in @($m.files)) { [void]$list.Add([string]$x) }
      $d = New-Object System.Windows.Forms.DataObject
      $d.SetFileDropList($list)
      $ms = New-Object System.IO.MemoryStream
      $bytes = [byte[]]@([byte]$m.effect, 0, 0, 0)
      $ms.Write($bytes, 0, 4)
      $ms.Position = 0
      $d.SetData('Preferred DropEffect', $ms)
      [System.Windows.Forms.Clipboard]::SetDataObject($d, $true, 10, 100)
      Send-Reply $id @{ ok = $true }
    } elseif ($m.cmd -eq 'get') {
      $files = @()
      $effect = 0
      if ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
        foreach ($f in [System.Windows.Forms.Clipboard]::GetFileDropList()) { $files += [string]$f }
        $s = [System.Windows.Forms.Clipboard]::GetData('Preferred DropEffect')
        if ($s -is [System.IO.Stream]) { $b = New-Object byte[] 4; [void]$s.Read($b, 0, 4); $effect = [int]$b[0] }
      }
      Send-Reply $id @{ files = $files; effect = $effect }
    } elseif ($m.cmd -eq 'clear') {
      [System.Windows.Forms.Clipboard]::Clear()
      Send-Reply $id @{ ok = $true }
    } else {
      Send-Reply $id @{ ok = $true }
    }
  } catch {
    Send-Reply $id @{ error = $_.Exception.Message }
  }
}
`;
let clip = null, clipSeq = 0;
const clipWait = new Map();
function clipProc() {
  if (clip && !clip.dead) return clip;
  let child;
  try {
    child = spawn(PS(), ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc(CLIP_SCRIPT)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch { return null; }
  const c = { child, dead: false, buf: '' };
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', d => {
    c.buf += d;
    let i;
    while ((i = c.buf.indexOf('\n')) >= 0) {
      const line = c.buf.slice(0, i).trim(); c.buf = c.buf.slice(i + 1);
      if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      const w = clipWait.get(m.id); if (w) { clipWait.delete(m.id); w(m.r || {}); }
    }
  });
  child.stderr.on('data', () => {});
  const die = () => { c.dead = true; for (const [id, w] of clipWait) { clipWait.delete(id); w({ error: 'Clipboard helper stopped' }); } };
  child.on('error', die); child.on('exit', die);
  child.stdin.on('error', () => {});
  clip = c;
  return c;
}
function clipCall(cmd, args, timeout) {
  return new Promise(resolve => {
    const c = clipProc();
    if (!c) { resolve({ error: 'No clipboard helper' }); return; }
    const id = ++clipSeq;
    const t = setTimeout(() => { clipWait.delete(id); resolve({ error: 'Clipboard timed out' }); }, timeout || 8000);
    clipWait.set(id, r => { clearTimeout(t); resolve(r); });
    try { c.child.stdin.write(JSON.stringify(Object.assign({ id, cmd }, args || {})) + '\n'); }
    catch (e) { clipWait.delete(id); clearTimeout(t); resolve({ error: e.message }); }
  });
}
// effect: 'copy' or 'move' (what Explorer calls cut)
async function setClipboardFiles(files, effect) {
  if (!WIN) return { error: 'Windows only' };
  return clipCall('set', { files, effect: effect === 'move' ? 2 : 5 });
}
async function getClipboardFiles() {
  if (!WIN) return { files: [], effect: 0, error: 'Windows only' };
  const r = await clipCall('get');
  if (r.error) return { files: [], effect: 0, error: r.error };
  const files = Array.isArray(r.files) ? r.files : r.files ? [r.files] : [];
  return { files: files.map(String), effect: (r.effect & 2) && !(r.effect & 1) ? 'move' : 'copy' };
}
async function clearClipboard() { if (WIN) await clipCall('clear'); }
function warmUp() { if (WIN) clipProc(); }
function shutdown() { if (clip && !clip.dead) { try { clip.child.stdin.end(); clip.child.kill(); } catch { /* gone */ } } }

// ---------------------------------------------------------------- the real Windows right-click menu, Properties and Open with
// C# 5 (what Windows PowerShell 5.1 compiles). Compiled once into Onyx's app-data folder.
const SHELL_CS = String.raw`
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace OnyxShell {
  [StructLayout(LayoutKind.Sequential)]
  public struct POINT { public int X; public int Y; }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct CMINVOKECOMMANDINFOEX {
    public int cbSize;
    public uint fMask;
    public IntPtr hwnd;
    public IntPtr lpVerb;
    [MarshalAs(UnmanagedType.LPStr)] public string lpParameters;
    [MarshalAs(UnmanagedType.LPStr)] public string lpDirectory;
    public int nShow;
    public uint dwHotKey;
    public IntPtr hIcon;
    [MarshalAs(UnmanagedType.LPStr)] public string lpTitle;
    public IntPtr lpVerbW;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpParametersW;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpDirectoryW;
    [MarshalAs(UnmanagedType.LPWStr)] public string lpTitleW;
    public POINT ptInvoke;
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214E6-0000-0000-C000-000000000046")]
  public interface IShellFolder {
    [PreserveSig] int ParseDisplayName(IntPtr hwnd, IntPtr pbc, [MarshalAs(UnmanagedType.LPWStr)] string pszDisplayName, out uint pchEaten, out IntPtr ppidl, ref uint pdwAttributes);
    [PreserveSig] int EnumObjects(IntPtr hwnd, int grfFlags, out IntPtr ppenumIDList);
    [PreserveSig] int BindToObject(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int BindToStorage(IntPtr pidl, IntPtr pbc, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int CompareIDs(IntPtr lParam, IntPtr pidl1, IntPtr pidl2);
    [PreserveSig] int CreateViewObject(IntPtr hwndOwner, ref Guid riid, out IntPtr ppv);
    [PreserveSig] int GetAttributesOf(uint cidl, [MarshalAs(UnmanagedType.LPArray)] IntPtr[] apidl, ref uint rgfInOut);
    [PreserveSig] int GetUIObjectOf(IntPtr hwndOwner, uint cidl, [MarshalAs(UnmanagedType.LPArray)] IntPtr[] apidl, ref Guid riid, IntPtr rgfReserved, out IntPtr ppv);
    [PreserveSig] int GetDisplayNameOf(IntPtr pidl, uint uFlags, IntPtr pName);
    [PreserveSig] int SetNameOf(IntPtr hwnd, IntPtr pidl, [MarshalAs(UnmanagedType.LPWStr)] string pszName, uint uFlags, out IntPtr ppidlOut);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214e4-0000-0000-c000-000000000046")]
  public interface IContextMenu {
    [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint uFlags);
    [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX pici);
    [PreserveSig] int GetCommandString(UIntPtr idCmd, uint uType, IntPtr pReserved, [MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMax);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214f4-0000-0000-c000-000000000046")]
  public interface IContextMenu2 {
    [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint uFlags);
    [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX pici);
    [PreserveSig] int GetCommandString(UIntPtr idCmd, uint uType, IntPtr pReserved, [MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMax);
    [PreserveSig] int HandleMenuMsg(uint uMsg, IntPtr wParam, IntPtr lParam);
  }

  [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("bcfce0a0-ec17-11d0-8d10-00a0c90f2719")]
  public interface IContextMenu3 {
    [PreserveSig] int QueryContextMenu(IntPtr hmenu, uint indexMenu, uint idCmdFirst, uint idCmdLast, uint uFlags);
    [PreserveSig] int InvokeCommand(ref CMINVOKECOMMANDINFOEX pici);
    [PreserveSig] int GetCommandString(UIntPtr idCmd, uint uType, IntPtr pReserved, [MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMax);
    [PreserveSig] int HandleMenuMsg(uint uMsg, IntPtr wParam, IntPtr lParam);
    [PreserveSig] int HandleMenuMsg2(uint uMsg, IntPtr wParam, IntPtr lParam, out IntPtr plResult);
  }

  // an invisible window that owns the menu and passes owner-drawn menu messages ("Open with", "Send to") to the shell
  public class Host : Form {
    public IContextMenu2 Cm2;
    public IContextMenu3 Cm3;
    public Host() {
      ShowInTaskbar = false;
      FormBorderStyle = FormBorderStyle.None;
      StartPosition = FormStartPosition.Manual;
      Location = new System.Drawing.Point(-32000, -32000);
      Size = new System.Drawing.Size(1, 1);
    }
    protected override void WndProc(ref Message m) {
      int msg = m.Msg;
      bool menuMsg = msg == 0x117 || msg == 0x2B || msg == 0x2C || msg == 0x120;
      if (menuMsg && Cm3 != null) {
        IntPtr r;
        if (Cm3.HandleMenuMsg2((uint)msg, m.WParam, m.LParam, out r) == 0) { m.Result = r; return; }
      } else if (menuMsg && msg != 0x120 && Cm2 != null) {
        if (Cm2.HandleMenuMsg((uint)msg, m.WParam, m.LParam) == 0) { m.Result = IntPtr.Zero; return; }
      }
      base.WndProc(ref m);
    }
  }

  public static class Menu {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] static extern int SHParseDisplayName(string name, IntPtr pbc, out IntPtr pidl, uint sfgaoIn, out uint psfgaoOut);
    [DllImport("shell32.dll")] static extern int SHBindToParent(IntPtr pidl, ref Guid riid, out IntPtr ppv, out IntPtr ppidlLast);
    [DllImport("user32.dll")] static extern IntPtr CreatePopupMenu();
    [DllImport("user32.dll")] static extern bool DestroyMenu(IntPtr h);
    [DllImport("user32.dll")] static extern uint TrackPopupMenuEx(IntPtr hmenu, uint flags, int x, int y, IntPtr hwnd, IntPtr tpm);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("ole32.dll")] static extern void CoTaskMemFree(IntPtr p);

    static int countWindows;
    static IntPtr firstWindow;
    static IntPtr skipWindow;
    static uint myPid;
    static bool CountProc(IntPtr h, IntPtr l) {
      uint pid;
      GetWindowThreadProcessId(h, out pid);
      if (pid == myPid && h != skipWindow && IsWindowVisible(h)) { countWindows++; if (firstWindow == IntPtr.Zero) firstWindow = h; }
      return true;
    }
    static int Visible(IntPtr except) {
      countWindows = 0; firstWindow = IntPtr.Zero; skipWindow = except;
      myPid = (uint)System.Diagnostics.Process.GetCurrentProcess().Id;
      EnumProc cb = new EnumProc(CountProc);
      EnumWindows(cb, IntPtr.Zero);
      GC.KeepAlive(cb);
      return countWindows;
    }
    // stay alive while a window the shell opened for us (Properties, Open with…) is still on screen
    static void WaitForWindows(IntPtr except) {
      bool seen = false;
      int quiet = 0;
      for (int i = 0; i < 4 * 60 * 60 * 4; i++) {
        Application.DoEvents();
        System.Threading.Thread.Sleep(250);
        int n = Visible(except);
        if (n > 0) {
          if (!seen) { seen = true; SetForegroundWindow(firstWindow); }
          quiet = 0;
        } else {
          quiet++;
          if ((seen && quiet >= 3) || (!seen && quiet >= 16)) break;
        }
      }
    }

    // verb "": show the menu at the mouse. Otherwise run that verb ("properties", "openas", …) on the items.
    public static string Run(string[] paths, string verb) {
      if (paths == null || paths.Length == 0) return "err:nothing selected";
      Guid iidSF = new Guid("000214E6-0000-0000-C000-000000000046");
      Guid iidCM = new Guid("000214e4-0000-0000-c000-000000000046");
      IntPtr[] full = new IntPtr[paths.Length];
      IntPtr[] kids = new IntPtr[paths.Length];
      IShellFolder parent = null;
      IntPtr menu = IntPtr.Zero;
      Host host = null;
      try {
        for (int i = 0; i < paths.Length; i++) {
          uint sfgao;
          int hr = SHParseDisplayName(paths[i], IntPtr.Zero, out full[i], 0, out sfgao);
          if (hr != 0) return "err:can't find " + paths[i];
          IntPtr ppv, last;
          hr = SHBindToParent(full[i], ref iidSF, out ppv, out last);
          if (hr != 0) return "err:can't open the folder of " + paths[i];
          kids[i] = last;
          if (parent == null) parent = (IShellFolder)Marshal.GetObjectForIUnknown(ppv);
          Marshal.Release(ppv);
        }
        host = new Host();
        host.Show();                 // the first window of this process is shown hidden: let it be this one
        host.Hide();
        IntPtr pcm;
        int h2 = parent.GetUIObjectOf(host.Handle, (uint)kids.Length, kids, ref iidCM, IntPtr.Zero, out pcm);
        if (h2 != 0) return "err:no menu for these items";
        IContextMenu cm = (IContextMenu)Marshal.GetObjectForIUnknown(pcm);
        Marshal.Release(pcm);
        host.Cm2 = cm as IContextMenu2;
        host.Cm3 = cm as IContextMenu3;
        menu = CreatePopupMenu();
        POINT pt;
        GetCursorPos(out pt);
        CMINVOKECOMMANDINFOEX ci = new CMINVOKECOMMANDINFOEX();
        ci.cbSize = Marshal.SizeOf(typeof(CMINVOKECOMMANDINFOEX));
        ci.fMask = 0x4000 | 0x20000000;          // CMIC_MASK_UNICODE | CMIC_MASK_PTINVOKE
        ci.hwnd = host.Handle;
        ci.nShow = 1;
        ci.ptInvoke = pt;
        string chosen = verb;
        IntPtr ansi = IntPtr.Zero, wide = IntPtr.Zero;
        if (string.IsNullOrEmpty(verb)) {
          cm.QueryContextMenu(menu, 0, 1, 0x7FFF, 0x4);       // CMF_EXPLORE
          SetForegroundWindow(host.Handle);
          uint cmd = TrackPopupMenuEx(menu, 0x0100 | 0x0002, pt.X, pt.Y, host.Handle, IntPtr.Zero);   // TPM_RETURNCMD | TPM_RIGHTBUTTON
          PostMessage(host.Handle, 0, IntPtr.Zero, IntPtr.Zero);
          if (cmd == 0) return "none";
          StringBuilder sb = new StringBuilder(256);
          try { cm.GetCommandString((UIntPtr)(cmd - 1), 4, IntPtr.Zero, sb, 256); } catch { }
          chosen = sb.ToString();
          ci.lpVerb = (IntPtr)(cmd - 1);
          ci.lpVerbW = (IntPtr)(cmd - 1);
        } else {
          cm.QueryContextMenu(menu, 0, 1, 0x7FFF, 0);
          ansi = Marshal.StringToHGlobalAnsi(verb);
          wide = Marshal.StringToHGlobalUni(verb);
          ci.lpVerb = ansi;
          ci.lpVerbW = wide;
        }
        int ir = cm.InvokeCommand(ref ci);
        if (ansi != IntPtr.Zero) Marshal.FreeHGlobal(ansi);
        if (wide != IntPtr.Zero) Marshal.FreeHGlobal(wide);
        if (ir != 0 && ir != unchecked((int)0x800704C7)) return "err:Windows couldn't do that (" + ir.ToString("X") + ")";
        WaitForWindows(host.Handle);
        return "ok:" + chosen;
      } catch (Exception e) {
        return "err:" + e.Message;
      } finally {
        if (menu != IntPtr.Zero) DestroyMenu(menu);
        for (int i = 0; i < full.Length; i++) if (full[i] != IntPtr.Zero) CoTaskMemFree(full[i]);
        if (host != null) host.Dispose();
      }
    }
  }
}
`;
const SHELL_PS = String.raw`
$ErrorActionPreference = 'Stop'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $utf8
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$dll = $env:ONYX_DLL
if (-not ('OnyxShell.Menu' -as [type])) {
  if (-not (Test-Path -LiteralPath $dll)) {
    $tmp = $dll + '.' + $PID + '.tmp'
    Add-Type -TypeDefinition $env:ONYX_CODE -ReferencedAssemblies @('System.Windows.Forms', 'System.Drawing') -OutputAssembly $tmp -OutputType Library
    if (-not (Test-Path -LiteralPath $dll)) { Move-Item -LiteralPath $tmp -Destination $dll } else { Remove-Item -LiteralPath $tmp -ErrorAction SilentlyContinue }
  }
  Add-Type -Path $dll
}
$paths = [string[]]@($env:ONYX_PATHS | ConvertFrom-Json)
$r = [OnyxShell.Menu]::Run($paths, [string]$env:ONYX_VERB)
[Console]::Out.Write($r)
`;
let dataDir = null;
function setDataDir(d) { dataDir = d; }
function dllPath() {
  const h = crypto.createHash('sha1').update(SHELL_CS).digest('hex').slice(0, 10);
  return path.join(dataDir || require('os').tmpdir(), 'onyx-shell-' + h + '.dll');
}
async function shellVerb(paths, verb, onChosen) {
  if (!WIN) return { error: 'This uses Windows’ own menu, so it only works on Windows.' };
  const list = (paths || []).slice(0, 200);
  const r = await runPs(SHELL_PS, { ONYX_DLL: dllPath(), ONYX_CODE: SHELL_CS, ONYX_PATHS: JSON.stringify(list), ONYX_VERB: verb || '' });
  const out = (r.out || '').trim();
  if (/^ok:/.test(out)) return { ok: true, verb: out.slice(3) };
  if (out === 'none') return { ok: true, verb: '' };
  if (/^err:/.test(out)) return { error: out.slice(4) };
  return { error: psErr(r) };
}
const showShellMenu = paths => shellVerb(paths, '');
const properties = paths => shellVerb(paths, 'properties');
const openWith = paths => shellVerb(paths.slice(0, 1), 'openas');

// ---------------------------------------------------------------- the rest
function detached(cmd, args, opts) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(cmd, args, Object.assign({ detached: true, stdio: 'ignore' }, opts || {})); }
    catch (e) { resolve({ error: e.message }); return; }
    let settled = false;
    child.on('error', e => { if (!settled) { settled = true; resolve({ error: e.message, code: e.code }); } });
    child.on('spawn', () => { if (!settled) { settled = true; child.unref(); resolve({ ok: true }); } });
  });
}
async function openTerminal(dir) {
  if (WIN) {
    const wt = await detached('wt.exe', ['-d', dir]);
    if (wt.ok) return wt;
    return detached(PS(), ['-NoExit', '-NoLogo'], { cwd: dir });
  }
  for (const t of [['x-terminal-emulator', []], ['gnome-terminal', []], ['open', ['-a', 'Terminal', dir]]]) { const r = await detached(t[0], t[1], { cwd: dir }); if (r.ok) return r; }
  return { error: 'No terminal found.' };
}
async function runAsAdmin(full) {
  if (!WIN) return { error: 'Windows only.' };
  const r = await runPs("Start-Process -FilePath $env:ONYX_PATH -WorkingDirectory (Split-Path -LiteralPath $env:ONYX_PATH) -Verb RunAs", { ONYX_PATH: full }, { timeout: 120000 });
  if (r.code !== 0) return /cancel/i.test(r.err) ? { cancelled: true } : { error: psErr(r) };
  return { ok: true };
}
// Compress to ZIP: Explorer's "Compress to ZIP file"
async function compress(paths, zipPath) {
  if (WIN) {
    const r = await runPs("$p = [string[]]@($env:ONYX_PATHS | ConvertFrom-Json); Compress-Archive -LiteralPath $p -DestinationPath $env:ONYX_ZIP -CompressionLevel Optimal", { ONYX_PATHS: JSON.stringify(paths), ONYX_ZIP: zipPath });
    return r.code === 0 ? { ok: true } : { error: psErr(r) };
  }
  return new Promise(resolve => {
    const dir = path.dirname(paths[0]);
    const child = spawn('zip', ['-r', '-q', zipPath].concat(paths.map(p => path.relative(dir, p))), { cwd: dir });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => resolve({ error: e.message }));
    child.on('close', c => resolve(c === 0 ? { ok: true } : { error: err.trim() || 'zip failed' }));
  });
}
// Extract all: ZIP with PowerShell, everything else (7z, rar, tar, gz) with the tar that comes with Windows 10 and 11
async function extract(archive, destDir) {
  const zip = /\.zip$/i.test(archive);
  if (WIN && zip) {
    const r = await runPs('Expand-Archive -LiteralPath $env:ONYX_SRC -DestinationPath $env:ONYX_DEST', { ONYX_SRC: archive, ONYX_DEST: destDir });
    return r.code === 0 ? { ok: true } : { error: psErr(r) };
  }
  fs.mkdirSync(destDir, { recursive: true });
  const [cmd, args] = !WIN && zip ? ['unzip', ['-q', archive, '-d', destDir]] : [WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar', ['-xf', archive, '-C', destDir]];
  return new Promise(resolve => {
    const child = spawn(cmd, args, { windowsHide: true });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => resolve({ error: e.message }));
    child.on('close', c => resolve(c === 0 ? { ok: true } : { error: err.trim().split(/\r?\n/)[0] || 'Couldn’t extract it' }));
  });
}

module.exports = {
  WIN, runPs, setClipboardFiles, getClipboardFiles, clearClipboard, warmUp, shutdown,
  showShellMenu, properties, openWith, openTerminal, runAsAdmin, compress, extract, setDataDir, dllPath,
  CLIP_SCRIPT, SHELL_CS, SHELL_PS,
};
