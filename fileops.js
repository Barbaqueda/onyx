/* Onyx file operations: what File Explorer does (new, rename, copy, move, paste, delete to the Recycle Bin, undo).
   Plain Node with no Electron, so every rule here is tested on any machine. Callers check paths are allowed first. */
'use strict';
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

// ---------------------------------------------------------------- names (Windows rules)
const BAD_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.[^.]*)?$/i;
// Explorer quietly drops spaces at either end and periods at the end
function tidyName(name) { return String(name == null ? '' : name).replace(/^\s+/, '').replace(/[\s.]+$/, ''); }
function checkName(name) {
  if (typeof name !== 'string' || !name) return 'Type a name.';
  if (BAD_CHARS.test(name)) return 'A name can’t contain any of these characters: \\ / : * ? " < > |';
  if (/[. ]$/.test(name) || /^\s/.test(name)) return 'A name can’t start with a space or end with a space or a period.';
  if (RESERVED.test(name)) return '“' + name + '” is a name Windows keeps for itself. Pick another one.';
  if (name.length > 255) return 'That name is too long (255 characters at most).';
  return '';
}
const extOf = n => { const e = path.extname(n); return e && e !== n ? e : ''; };

async function exists(p) { try { await fsp.lstat(p); return true; } catch { return false; } }
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const inside = (child, parent) => { const c = path.resolve(child).toLowerCase(), p = path.resolve(parent).toLowerCase().replace(/[\\/]+$/, ''); return c.startsWith(p + path.sep) || c.startsWith(p + '/'); };

/**
 * A name that's free in dir. style 'paren': "New folder (2)", "report (2).pdf";
 * style 'copy': "report - Copy.pdf", "report - Copy (2).pdf" (what Explorer does when you paste into the same folder).
 */
async function uniqueName(dir, name, style, isDir) {
  const ext = isDir ? '' : extOf(name);
  const base = ext ? name.slice(0, -ext.length) : name;
  const make = n => style === 'copy'
    ? base + ' - Copy' + (n > 1 ? ' (' + n + ')' : '') + ext
    : (n > 1 ? base + ' (' + n + ')' + ext : name);
  for (let n = 1; n < 10000; n++) {
    const cand = make(n);
    if (!(await exists(path.join(dir, cand)))) return cand;
  }
  throw new Error('Couldn’t find a free name');
}

// ---------------------------------------------------------------- creating and renaming
async function newFolder(dir, name) {
  const n = await uniqueName(dir, name || 'New folder', 'paren', true);
  const full = path.join(dir, n);
  await fsp.mkdir(full);
  return full;
}
async function newFile(dir, name, content) {
  const n = await uniqueName(dir, name || 'New Text Document.txt', 'paren', false);
  const full = path.join(dir, n);
  await fsp.writeFile(full, content || '', { flag: 'wx' });
  return full;
}
async function rename(full, newName) {
  const name = tidyName(newName);
  const err = checkName(name);
  if (err) throw userError(err);
  const to = path.join(path.dirname(full), name);
  if (to === full) return full;
  if (!(await exists(full))) throw userError('That item no longer exists.');
  if (same(to, full)) {
    // only the capitals changed: Windows needs a detour through a temporary name
    const tmp = path.join(path.dirname(full), '.onyx-rename-' + process.pid + '-' + Date.now());
    await fsp.rename(full, tmp);
    try { await fsp.rename(tmp, to); } catch (e) { await fsp.rename(tmp, full).catch(() => {}); throw e; }
    return to;
  }
  if (await exists(to)) throw userError('There’s already ' + (await isDir(to) ? 'a folder' : 'a file') + ' called “' + name + '” here.');
  await fsp.rename(full, to);
  return to;
}
async function isDir(p) { try { return (await fsp.lstat(p)).isDirectory(); } catch { return false; } }
function userError(msg) { const e = new Error(msg); e.user = true; return e; }

// ---------------------------------------------------------------- copying and moving
function cancelled() { const e = new Error('Cancelled'); e.cancelled = true; return e; }
// sizes, for the progress bar (stops counting early on huge trees)
async function measure(list, limit) {
  let bytes = 0, files = 0;
  const walk = async p => {
    if (files > (limit || 200000)) return;
    let st; try { st = await fsp.lstat(p); } catch { return; }
    if (st.isSymbolicLink()) return;
    if (st.isDirectory()) { let names = []; try { names = await fsp.readdir(p); } catch { return; } for (const n of names) await walk(path.join(p, n)); }
    else if (st.isFile()) { bytes += st.size; files++; }
  };
  for (const p of list) await walk(p);
  return { bytes, files };
}
async function copyTree(src, dst, ctx) {
  if (ctx.isCancelled && ctx.isCancelled()) throw cancelled();
  const st = await fsp.lstat(src);
  if (st.isSymbolicLink()) { ctx.skipped.push({ path: src, reason: 'link' }); return; }
  if (st.isDirectory()) {
    let made = false;
    try { await fsp.mkdir(dst); made = true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (made && ctx.onCreate) ctx.onCreate(dst);
    for (const n of await fsp.readdir(src)) await copyTree(path.join(src, n), path.join(dst, n), ctx);
    try { await fsp.utimes(dst, st.atime, st.mtime); } catch { /* fine */ }
    return;
  }
  if (!st.isFile()) return;
  await fsp.copyFile(src, dst, fs.constants.COPYFILE_EXCL);
  if (ctx.onCreate) ctx.onCreate(dst);
  try { await fsp.utimes(dst, st.atime, st.mtime); } catch { /* fine */ }      // like Explorer: a copy keeps its modified date
  ctx.done.bytes += st.size; ctx.done.files++;
  if (ctx.onProgress) ctx.onProgress(ctx.done);
}
async function moveItem(src, dst, ctx) {
  try { await fsp.rename(src, dst); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    // another drive: copy, then remove the original once the copy is complete
    await copyTree(src, dst, Object.assign({}, ctx, { onCreate: null }));
    await fsp.rm(src, { recursive: true, force: true });
    return;
  }
  const m = await measure([dst], 5000);
  ctx.done.bytes += m.bytes; ctx.done.files += m.files;
  if (ctx.onProgress) ctx.onProgress(ctx.done);
}

/**
 * What a paste would run into, before doing anything: names that already exist in the destination,
 * and pastes that can't work (a folder into itself).
 */
async function planPaste(sources, destDir, mode) {
  const items = [];
  for (const src of sources) {
    const name = path.basename(src);
    const it = { src, name, dir: await isDir(src), missing: !(await exists(src)) };
    if (it.missing) it.problem = 'It no longer exists.';
    else if (same(src, destDir) || inside(destDir, src)) it.problem = 'The destination is inside the folder itself.';
    else if (same(path.dirname(src), destDir)) it.sameDir = true;
    else if (await exists(path.join(destDir, name))) { it.conflict = true; it.targetDir = await isDir(path.join(destDir, name)); }
    if (mode === 'move' && it.sameDir) it.noop = true;
    items.push(it);
  }
  return items;
}

/**
 * Copy or move sources into destDir. resolution for names that already exist: 'replace' (the old item goes to
 * the Recycle Bin; folders merge), 'skip', or 'both' (keeps both, the new one gets " (2)").
 * Returns everything needed to undo it.
 */
async function paste(opts) {
  const { sources, destDir, mode } = opts;
  const resolution = opts.resolution || 'both';
  const trash = opts.trash;
  const res = { created: [], pairs: [], moves: [], replaced: [], skipped: [], failed: [], done: { bytes: 0, files: 0 }, total: null };
  res.total = await measure(sources);
  const ctx = { done: res.done, skipped: res.skipped, isCancelled: opts.isCancelled, onProgress: opts.onProgress ? d => opts.onProgress(d, res.total) : null };
  const plan = await planPaste(sources, destDir, mode);
  const place = async (src, dstDir, name, srcIsDir, top) => {
    let dst = path.join(dstDir, name);
    if (mode === 'copy' && same(path.dirname(src), dstDir)) dst = path.join(dstDir, await uniqueName(dstDir, name, 'copy', srcIsDir));
    else if (await exists(dst)) {
      const dstIsDir = await isDir(dst);
      if (resolution === 'skip') { res.skipped.push({ path: src, reason: 'exists' }); return; }
      if (resolution === 'both' || srcIsDir !== dstIsDir) dst = path.join(dstDir, await uniqueName(dstDir, name, 'paren', srcIsDir));
      else if (srcIsDir) {
        // two folders with the same name: merge them, file by file
        for (const n of await fsp.readdir(src)) {
          if (opts.isCancelled && opts.isCancelled()) throw cancelled();
          const s = path.join(src, n);
          await place(s, dst, n, await isDir(s), false);
        }
        if (mode === 'move') { try { if (!(await fsp.readdir(src)).length) { await fsp.rmdir(src); res.removedDirs = (res.removedDirs || []).concat([src]); } } catch { /* leave it */ } }
        return;
      } else {
        if (!trash) throw new Error('No Recycle Bin');
        await trash(dst);
        res.replaced.push(dst);
      }
    }
    if (mode === 'move') { await moveItem(src, dst, ctx); res.moves.push({ from: src, to: dst }); }
    else { await copyTree(src, dst, ctx); res.created.push(dst); res.pairs.push({ from: src, to: dst }); }
  };
  for (const it of plan) {
    if (opts.isCancelled && opts.isCancelled()) { res.cancelled = true; break; }
    if (it.problem) { res.failed.push({ path: it.src, error: it.problem }); continue; }
    if (it.noop) { res.skipped.push({ path: it.src, reason: 'same folder' }); continue; }
    try { await place(it.src, destDir, it.name, it.dir, true); }
    catch (e) {
      if (e.cancelled) { res.cancelled = true; break; }
      res.failed.push({ path: it.src, error: friendly(e) });
    }
  }
  return res;
}
function friendly(e) {
  if (!e) return 'Something went wrong';
  if (e.user) return e.message;
  if (e.code === 'EBUSY') return 'It’s open in another program.';
  if (e.code === 'EPERM' || e.code === 'EACCES') return 'Windows didn’t allow it (it may be open, read-only, or need administrator rights).';
  if (e.code === 'ENOENT') return 'It no longer exists.';
  if (e.code === 'ENOSPC') return 'The drive is full.';
  if (e.code === 'ENAMETOOLONG') return 'The path is too long.';
  if (e.code === 'EEXIST') return 'Something with that name is already there.';
  return e.message || String(e);
}

// ---------------------------------------------------------------- the Recycle Bin
// Windows keeps each deleted item as $R… with a $I… file next to it that records where it came from.
function parseRecycleInfo(buf) {
  if (!buf || buf.length < 24) return null;
  const version = Number(buf.readBigInt64LE(0));
  const size = Number(buf.readBigInt64LE(8));
  const ft = buf.readBigInt64LE(16);
  const deletedAt = Number(ft / 10000n - 11644473600000n);
  let p = '';
  if (version === 1) p = buf.slice(24, 24 + 520).toString('utf16le');
  else if (version === 2 && buf.length >= 28) { const len = buf.readInt32LE(24); p = buf.slice(28, 28 + len * 2).toString('utf16le'); }
  else return null;
  p = p.replace(/\u0000[\s\S]*$/, '');
  return p ? { path: p, size, deletedAt, version } : null;
}
function makeRecycleInfo(original, size, deletedAt) {   // for tests: what Windows writes (version 2)
  const name = Buffer.from(original + '\u0000', 'utf16le');
  const b = Buffer.alloc(28 + name.length);
  b.writeBigInt64LE(2n, 0); b.writeBigInt64LE(BigInt(size || 0), 8);
  b.writeBigInt64LE((BigInt(deletedAt) + 11644473600000n) * 10000n, 16);
  b.writeInt32LE(name.length / 2, 24); name.copy(b, 28);
  return b;
}
function binRootsFor(target) { return [path.join(path.parse(path.resolve(target)).root, '$Recycle.Bin')]; }
async function findInBin(target, roots) {
  roots = roots || binRootsFor(target);
  const want = path.resolve(target).toLowerCase();
  let best = null;
  for (const root of roots) {
    let subs = []; try { subs = await fsp.readdir(root); } catch { continue; }
    for (const sub of subs) {
      const dir = path.join(root, sub);
      let names = []; try { names = await fsp.readdir(dir); } catch { continue; }
      for (const n of names) {
        if (!/^\$I/i.test(n)) continue;
        let info; try { info = parseRecycleInfo(await fsp.readFile(path.join(dir, n))); } catch { continue; }
        if (!info || path.resolve(info.path).toLowerCase() !== want) continue;
        const data = path.join(dir, '$R' + n.slice(2));
        if (!(await exists(data))) continue;
        if (!best || info.deletedAt > best.deletedAt) best = { info: path.join(dir, n), data, deletedAt: info.deletedAt };
      }
    }
  }
  return best;
}
// Put a deleted item back where it was (what "Restore" does in the Recycle Bin)
async function restoreFromBin(target, roots) {
  const hit = await findInBin(target, roots);
  if (!hit) throw userError('Couldn’t find it in the Recycle Bin.');
  if (await exists(target)) throw userError('Something else is now where it used to be.');
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.rename(hit.data, target);
  await fsp.unlink(hit.info).catch(() => {});
  return target;
}

// ---------------------------------------------------------------- places Onyx won't change
/**
 * Windows' own folders (and apps' data) stay untouched, and so do the special folders themselves
 * (renaming or deleting Downloads breaks things). Returns a reason, or ''.
 */
function protectedReason(full, env, specials, opts) {
  env = env || process.env;
  const container = opts && opts.container;          // putting things inside it (a drive or Downloads is fine), not changing it
  const p = path.resolve(full).toLowerCase().replace(/[\\/]+$/, '');
  if (!container && path.parse(path.resolve(full)).root.toLowerCase().replace(/[\\/]+$/, '') === p) return 'Onyx won’t change a whole drive.';
  if (container) specials = [];
  const sys = [env.WINDIR || env.SystemRoot, env.ProgramFiles, env['ProgramFiles(x86)'], env.ProgramW6432, env.ProgramData, env.APPDATA, env.LOCALAPPDATA]
    .filter(Boolean).map(x => path.resolve(x).toLowerCase());
  for (const s of sys) if (p === s || p.startsWith(s + path.sep)) return 'This is a Windows or app folder. Onyx won’t change things there, so nothing breaks.';
  for (const s of (specials || []).filter(Boolean).map(x => path.resolve(x).toLowerCase())) if (p === s) return 'This is one of Windows’ own folders. Onyx won’t rename, move or delete it.';
  return '';
}

module.exports = {
  tidyName, checkName, uniqueName, exists, same, inside, newFolder, newFile, rename, isDir,
  measure, copyTree, planPaste, paste, friendly, userError,
  parseRecycleInfo, makeRecycleInfo, findInBin, restoreFromBin, protectedReason,
};
