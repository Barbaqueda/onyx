const E = require(require('path').join(__dirname, '..', 'engine.js'));
const now = Date.parse('2026-10-01'); const d = 86400000;
const F = (p, size = 1000, age = 10) => { const name = p.split('/').pop(); const i = name.lastIndexOf('.'); return { path: p, name, extension: i > 0 ? name.slice(i + 1).toLowerCase() : '', size, lastModified: now - d * age }; };
const files = [
  F('excavatorio-modular/index.html'), F('excavatorio-modular/main.js'), F('excavatorio-modular/physics.js'), F('excavatorio-modular/style.css'), F('excavatorio-modular/assets/digger.png'),
  F('TheBindingofIsaac/isaac-ng.exe'), F('TheBindingofIsaac/steam_api.dll'), F('TheBindingofIsaac/resources/music.ogg'),
  F('Documents/tax_return_2023.pdf'), F('Documents/meeting_agenda.docx'), F('Documents/notes.txt'), F('Documents/boarding_pass.pdf'),
  F('Spreadsheets/budget_2025.xlsx'), F('Spreadsheets/grades.xlsx'),
  F('Images/IMG_0001.jpg'), F('Images/Screenshot 2026-09-01 101010.png'), F('Images/wallpaper.png'),
  F('Photos/Iceland Trip/glacier.jpg'), F('Photos/Iceland Trip/notes.txt'),
  F('New folder/song draft01.wav'), F('New folder/song draft02.wav'), F('New folder/invoice_march.pdf'), F('New folder/setup.exe'),
  F('Other/random.bin'),
  F('glorp (1)/glorp.blend'), F('glorp (1)/glorp_diffuse.png'),
  F('Beat Tape/beat1.flp'), F('Beat Tape/beat1.wav'),
  F('School/lecture_notes.pdf'), F('School/selfie.jpg'),
  F('Work/Q4_report.docx'),
  F('loose_photo.jpg'), F('resume.pdf'),
];
const dirs = [...new Set(files.flatMap(f => { const out = []; let p = f.path; while (p.includes('/')) { p = p.slice(0, p.lastIndexOf('/')); out.push(p); } return out; }))].map(p => ({ path: p }));
for (const depth of process.argv[2] ? [process.argv[2]] : ['smart', 'all']) {
  const plan = E.buildPlan({ files, dirs, strategy: 'rules', settings: { depth } });
  console.log('\n===== depth:', depth, JSON.stringify(plan.stats));
  for (const i of plan.items) console.log(i.kind === 'move' ? ' →' : ' ·', i.source.padEnd(42), i.kind === 'move' ? i.target.padEnd(44) : ''.padEnd(44), '//', i.reason);
}
const kinds = E.classifyDirs(files, dirs, {});
console.log('\nfolder kinds:'); for (const v of kinds.values()) console.log('  ', v.path.padEnd(32), v.kind.padEnd(8), v.why);
