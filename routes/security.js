const router = require('express').Router();
const { vapiSecret } = require('../lib/security');

// Solo per l'admin loggiato (montata dopo requireAuth): serve alla pagina di configurazione Vapi
router.get('/vapi', (req, res) => {
  res.json({
    header: 'x-vapi-secret',
    secret: vapiSecret(),
    baseUrl: `${req.protocol}://${req.get('host')}/vapi`
  });
});

module.exports = router;
