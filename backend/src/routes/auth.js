const router = require('express').Router();
const User = require('../models/User');
const { sign, protect } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/error');

router.post('/register', asyncHandler(async (req, res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ message: 'Name, email and password are required.' });
  if (String(password).length < 6) return res.status(400).json({ message: 'Password must be at least 6 characters.' });
  if (await User.exists({ email: String(email).toLowerCase() })) {
    return res.status(409).json({ message: 'An account with this email already exists.' });
  }
  const user = await User.create({ name, email, password, role: 'user' }); // public signup is never admin
  res.status(201).json({ token: sign(user), user: user.toSafeJSON() });
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  const user = await User.findOne({ email: String(email || '').toLowerCase() }).select('+password');
  if (!user || !(await user.matchPassword(password || ''))) {
    return res.status(401).json({ message: 'Email or password is incorrect.' });
  }
  res.json({ token: sign(user), user: user.toSafeJSON() });
}));

router.get('/me', protect, (req, res) => res.json({ user: req.user.toSafeJSON() }));

module.exports = router;
