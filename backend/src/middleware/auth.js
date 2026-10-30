const jwt = require('jsonwebtoken');
const User = require('../models/User');

function sign(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
  });
}

async function resolveUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    return await User.findById(payload.id);
  } catch {
    return null;
  }
}

async function protect(req, res, next) {
  const user = await resolveUser(req);
  if (!user) return res.status(401).json({ message: 'Sign in to continue.' });
  req.user = user;
  next();
}

async function optionalAuth(req, _res, next) {
  req.user = await resolveUser(req);
  next();
}

function adminOnly(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Only administrators can do this.' });
  }
  next();
}

module.exports = { sign, protect, optionalAuth, adminOnly };
