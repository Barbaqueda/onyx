// node test/fileops.js — the file operations core (rename, new, copy, move, paste, Recycle Bin restore, protection)
const fs = require('fs'), path = require('path'), os = require('os');
const APP = fs.existsSync(path.join(__dirname, '..', 'app')) ? path.join(__dirname, '..', 'app') : path.join(__dirname, '..');
const F = require(path.join(APP, 'fileops.js'));
const TG = require(path.join(APP, 'tags.js'));
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL', m); } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'onyx-fo-'));
const P = (...a) => path.join(tmp, ...a);
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s || 'x'); };
const ex = p => fs.existsSync(p);

(async () => {
  // names
  ok(F.checkName('report.pdf') === '', 'plain name ok');
  ok(F.checkName('a:b') !== '', 'colon rejected');
  ok(F.checkName('CON') !== '' && F.checkName('con.txt') !== '' && F.checkName('LPT1') !== '', 'reserved names rejected');
  ok(F.checkName('console.txt') === '', 'console is fine');
  ok(F.checkName('x'.repeat(256)) !== '', 'too long');
  ok(F.tidyName('  notes.  ') === 'notes', 'tidy trims like Explorer');
  ok(F.tidyName('...') === '', 'only dots → empty');

  // unique names
  w(P('a', 'New folder', 'k')); w(P('a', 'r.pdf'));
  ok(await F.uniqueName(P('a'), 'New folder', 'paren', true) === 'New folder (2)', 'New folder (2)');
  ok(await F.uniqueName(P('a'), 'r.pdf', 'copy', false) === 'r - Copy.pdf', 'r - Copy.pdf');
  w(P('a', 'r - Copy.pdf'));
  ok(await F.uniqueName(P('a'), 'r.pdf', 'copy', false) === 'r - Copy (2).pdf', 'r - Copy (2).pdf');
  ok(await F.uniqueName(P('a'), 'r.pdf', 'paren', false) === 'r (2).pdf', 'r (2).pdf');
  ok(await F.uniqueName(P('a'), '.gitignore', 'paren', false) === '.gitignore', 'dotfile');

  // new
  const nf = await F.newFolder(P('a'));
  ok(path.basename(nf) === 'New folder (2)' && fs.statSync(nf).isDirectory(), 'newFolder');
  const nt = await F.newFile(P('a'));
  ok(path.basename(nt) === 'New Text Document.txt' && ex(nt), 'newFile');

  // rename
  const rn = await F.rename(P('a', 'r.pdf'), 'Report.pdf');
  ok(path.basename(rn) === 'Report.pdf' && ex(rn), 'rename');
  const rc = await F.rename(rn, 'report.pdf');
  ok(fs.readdirSync(P('a')).includes('report.pdf'), 'case-only rename');
  let err = ''; try { await F.rename(rc, 'New Text Document.txt'); } catch (e) { err = e.message; }
  ok(/already/.test(err), 'rename onto existing refused: ' + err);
  err = ''; try { await F.rename(rc, 'bad|name'); } catch (e) { err = e.message; }
  ok(/characters/.test(err), 'bad chars refused');
  ok(await F.rename(rc, '  spaced.pdf ') === P('a', 'spaced.pdf'), 'rename tidies spaces');

  // copy and move with paste()
  w(P('src', 'one.txt'), 'hello'); w(P('src', 'dir', 'two.txt'), 'two'); w(P('src', 'dir', 'deep', 'three.txt'), '3');
  fs.mkdirSync(P('dst'));
  let r = await F.paste({ sources: [P('src', 'one.txt'), P('src', 'dir')], destDir: P('dst'), mode: 'copy' });
  ok(ex(P('dst', 'one.txt')) && ex(P('dst', 'dir', 'deep', 'three.txt')) && ex(P('src', 'one.txt')), 'copy tree');
  ok(r.created.length === 2 && r.done.files === 3 && r.total.files === 3, 'copy counts ' + JSON.stringify(r.done));
  const m1 = fs.statSync(P('src', 'one.txt')).mtimeMs, m2 = fs.statSync(P('dst', 'one.txt')).mtimeMs;
  ok(Math.abs(m1 - m2) < 2000, 'copy keeps modified date');

  // conflicts
  let plan = await F.planPaste([P('src', 'one.txt')], P('dst'), 'copy');
  ok(plan[0].conflict, 'conflict detected');
  r = await F.paste({ sources: [P('src', 'one.txt')], destDir: P('dst'), mode: 'copy', resolution: 'skip' });
  ok(r.skipped.length === 1 && !r.created.length, 'skip');
  r = await F.paste({ sources: [P('src', 'one.txt')], destDir: P('dst'), mode: 'copy', resolution: 'both' });
  ok(ex(P('dst', 'one (2).txt')), 'keep both → (2)');
  const trashed = [];
  const trash = async p => { trashed.push(p); fs.renameSync(p, p + '.trashed'); };
  fs.writeFileSync(P('src', 'one.txt'), 'new');
  r = await F.paste({ sources: [P('src', 'one.txt')], destDir: P('dst'), mode: 'copy', resolution: 'replace', trash });
  ok(fs.readFileSync(P('dst', 'one.txt'), 'utf8') === 'new' && trashed.length === 1 && r.replaced.length === 1, 'replace sends old to bin');
  // folder merge
  w(P('src', 'dir', 'extra.txt'), 'e');
  r = await F.paste({ sources: [P('src', 'dir')], destDir: P('dst'), mode: 'copy', resolution: 'replace', trash });
  ok(ex(P('dst', 'dir', 'extra.txt')) && ex(P('dst', 'dir', 'two.txt')), 'folders merge');
  ok(r.created.includes(P('dst', 'dir', 'extra.txt')) && r.replaced.length === 2 && r.created.length === 3, 'merge: new file created, two replaced: ' + JSON.stringify(r));

  // same folder copy → " - Copy"
  r = await F.paste({ sources: [P('src', 'one.txt')], destDir: P('src'), mode: 'copy' });
  ok(ex(P('src', 'one - Copy.txt')), 'paste in same folder makes a copy');
  // move into same folder: nothing
  r = await F.paste({ sources: [P('src', 'one.txt')], destDir: P('src'), mode: 'move' });
  ok(r.skipped.length === 1 && ex(P('src', 'one.txt')), 'move into same folder does nothing');
  // folder into itself
  r = await F.paste({ sources: [P('src', 'dir')], destDir: P('src', 'dir', 'deep'), mode: 'move' });
  ok(r.failed.length === 1 && /inside/.test(r.failed[0].error) && ex(P('src', 'dir')), 'folder into itself refused');
  // move
  fs.mkdirSync(P('mv'));
  r = await F.paste({ sources: [P('src', 'one - Copy.txt'), P('src', 'dir')], destDir: P('mv'), mode: 'move' });
  ok(!ex(P('src', 'dir')) && ex(P('mv', 'dir', 'deep', 'three.txt')) && r.moves.length === 2, 'move');
  // cancel
  let n = 0;
  w(P('big', 'a.txt')); w(P('big', 'b.txt')); w(P('big', 'c.txt'));
  fs.mkdirSync(P('cancel'));
  r = await F.paste({ sources: [P('big')], destDir: P('cancel'), mode: 'copy', isCancelled: () => ++n > 3 });
  ok(r.cancelled, 'cancel stops');
  // missing
  r = await F.paste({ sources: [P('nope.txt')], destDir: P('dst'), mode: 'copy' });
  ok(r.failed.length === 1, 'missing source reported');

  // Recycle Bin restore
  const bin = P('$Recycle.Bin'), sid = path.join(bin, 'S-1-5-21-1');
  fs.mkdirSync(sid, { recursive: true });
  fs.mkdirSync(P('other-user'), { recursive: true });
  const orig = P('docs', 'Résumé 2026.docx');
  fs.writeFileSync(path.join(sid, '$RABC123.docx'), 'resume');
  fs.writeFileSync(path.join(sid, '$IABC123.docx'), F.makeRecycleInfo(orig, 6, Date.now() - 1000));
  // an older copy of the same file
  fs.writeFileSync(path.join(sid, '$ROLD.docx'), 'old');
  fs.writeFileSync(path.join(sid, '$IOLD.docx'), F.makeRecycleInfo(orig, 3, Date.now() - 100000));
  const info = F.parseRecycleInfo(fs.readFileSync(path.join(sid, '$IABC123.docx')));
  ok(info && info.path === orig && info.size === 6 && Math.abs(info.deletedAt - (Date.now() - 1000)) < 5000, 'parse $I v2');
  const v1 = Buffer.alloc(544); v1.writeBigInt64LE(1n, 0); Buffer.from('C:\\old.txt', 'utf16le').copy(v1, 24);
  ok(F.parseRecycleInfo(v1).path === 'C:\\old.txt', 'parse $I v1');
  await F.restoreFromBin(orig, [bin]);
  ok(fs.readFileSync(orig, 'utf8') === 'resume' && !ex(path.join(sid, '$IABC123.docx')), 'restored the newest one');
  err = ''; try { await F.restoreFromBin(orig, [bin]); } catch (e) { err = e.message; }
  ok(/already|Something else/.test(err), 'won’t restore over something');

  // protection
  const env = { WINDIR: P('Windows'), ProgramFiles: P('Program Files'), APPDATA: P('AppData', 'Roaming') };
  ok(F.protectedReason(P('Windows', 'System32', 'x.dll'), env) !== '', 'Windows protected');
  ok(F.protectedReason(P('AppData', 'Roaming', 'Code'), env) !== '', 'AppData protected');
  ok(F.protectedReason(P('Downloads'), env, [P('Downloads')]) !== '', 'Downloads itself protected');
  ok(F.protectedReason(P('Downloads', 'x.pdf'), env, [P('Downloads')]) === '', 'inside Downloads fine');
  ok(F.protectedReason(path.parse(tmp).root, env) !== '', 'drive root protected');

  // tags follow
  const db = TG.emptyDb();
  TG.edit(db, ['Projects/a.txt', 'Projects/sub/b.txt', 'c.txt'], ['work'], []);
  TG.applyAuto(db, { 'c.txt': ['auto1'] }, 'rules', [{ path: 'c.txt', name: 'c.txt', extension: 'txt' }]);
  TG.movePaths(db, [{ from: 'Projects', to: 'Archive/Projects' }]);
  ok(db.files['Archive/Projects/sub/b.txt'] && !db.files['Projects/sub/b.txt'], 'tags follow a folder move');
  TG.copyPaths(db, [{ from: 'c.txt', to: 'c - Copy.txt' }]);
  ok(db.files['c - Copy.txt'] && db.files['c - Copy.txt'].t.includes('work') && !db.files['c - Copy.txt'].t.includes('auto1'), 'copy keeps your tags, not automatic ones');
  TG.forgetPaths(db, ['Archive']);
  ok(!Object.keys(db.files).some(k => k.startsWith('Archive/')), 'forget a deleted folder');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
