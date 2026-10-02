const router = require('express').Router();
const fs = require('fs');
const cfg = require('../lib/config');
const backup = require('../lib/backup');

router.get('/', (req, res) => res.json({ backups: backup.list(), lastBackupAt: cfg.get('LAST_BACKUP_AT') || null, folder: backup.dir() }));

router.post('/', (req, res) => {
  try { res.json({ ok: true, ...backup.backupNow() }); }
  catch (e) { res.status(500).json({ error: 'Backup non riuscito: ' + e.message }); }
});

// Scarica una copia aggiornata del database. Contiene anche le impostazioni (chiave Vapi compresa):
// solo per l'admin loggato, da conservare in un posto sicuro.
router.get('/download', (req, res) => {
  let file;
  try { file = backup.snapshotForDownload(); }
  catch (e) { return res.status(500).json({ error: 'Backup non riuscito: ' + e.message }); }
  res.download(file, `ristorante-backup-${new Date().toISOString().slice(0, 10)}.db`, () => { fs.unlink(file, () => {}); });
});

module.exports = router;
