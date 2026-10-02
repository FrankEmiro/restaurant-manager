function requireAuth(req, res, next) {
  // Sempre pubblici: tool VAPI (protetti dal segreto condiviso in server.js), auth, pagina di login
  if (
    req.path.startsWith('/vapi/') ||
    req.path.startsWith('/webhook/vapi') ||
    req.path.startsWith('/api/auth/') ||
    req.path === '/login' ||
    req.path === '/login.html'
  ) {
    return next();
  }

  if (req.session && req.session.authenticated) return next();

  // API calls → 401 JSON (so apiFetch can detect and redirect)
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Non autenticato' });
  }

  // Browser navigation → redirect to login
  res.redirect('/login');
}

module.exports = requireAuth;
