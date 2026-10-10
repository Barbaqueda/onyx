const now = Date.parse('2026-10-01'); const d = 86400000;
const F = (p, size, age) => { const name = p.split('/').pop(); const i = name.lastIndexOf('.'); return { path: p, name, extension: i > 0 ? name.slice(i+1).toLowerCase() : '', size, lastModified: now - d*age }; };
module.exports = () => ({
  files: [
    F('excavatorio1.obj', 2400000, 30), F('excavatorio2.obj', 2350000, 30), F('excavatorio3.obj', 2480000, 29),
    F('invoice_2024_03.pdf', 245000, 30), F('invoice_2024_04.pdf', 312000, 28), F('tax_return_2023.pdf', 1240000, 100),
    F('bank_statement.pdf', 458000, 90), F('budget_2024.xlsx', 87000, 60), F('Q4_report.docx', 540000, 14),
    F('project_proposal.docx', 320000, 45), F('kickoff.pptx', 2400000, 20), F('passport_scan.pdf', 890000, 200),
    F('resume_2024.pdf', 234000, 15), F('lecture_notes.md', 34000, 12), F('thesis_draft.pdf', 3400000, 5),
    F('boarding_pass.pdf', 89000, 70), F('IMG_4521.jpg', 3400000, 8), F('IMG_4522.jpg', 3100000, 8),
    F('Screenshot 2026-09-12 101530.png', 450000, 18), F('Screenshot 2026-09-13 091205.png', 380000, 17), F('Screenshot 2026-09-14 174411.png', 420000, 16),
    F('invoice_generator.py', 12000, 3), F('config.json', 2300, 6), F('notes.txt', 3400, 1),
    F('VID_20260901_120000.mp4', 48000000, 30), F('OBS_Setup_31.0.exe', 120000000, 40), F('photos_backup.zip', 900000000, 50),
    F('~$Q4_report.docx', 162, 1), F('dataset.csv.crdownload', 5000000, 0),
    F('Taxes/tax_return_2022.pdf', 1100000, 400),
    F('Photos/Iceland Trip/glacier.jpg', 4100000, 300), F('Photos/Iceland Trip/aurora.jpg', 3900000, 300),
    F('Game Project/package.json', 900, 20), F('Game Project/src/main.js', 14000, 2), F('Game Project/assets/level1.png', 80000, 22),
  ],
  dirs: [{ path: 'Taxes' }, { path: 'Photos' }, { path: 'Photos/Iceland Trip' }, { path: 'Game Project' }, { path: 'Game Project/src' }, { path: 'Game Project/assets' }, { path: 'Game Project/node_modules', opaque: true }],
});
