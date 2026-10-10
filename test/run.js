const E = require(require('path').join(__dirname, '..', 'engine.js')); const demo = require('./demo.js')();
for (const s of (process.argv[2]||'rules').split(',')) {
  const plan = E.buildPlan({ files: demo.files, dirs: demo.dirs, strategy: s });
  console.log('==', s, JSON.stringify(plan.stats), plan.newFolders.join(' | '));
  for (const i of plan.items) console.log((i.kind==='move'?'  →':'  ·'), i.source.padEnd(36), i.kind==='move'?i.target:'', ' //', i.reason);
}
