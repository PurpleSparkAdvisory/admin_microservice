require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const { router: authRouter, requireAuth } = require('./src/auth');
const usersRouter = require('./src/routes/users');
const lookupsRouter = require('./src/routes/lookups');
const saydoRouter = require('./src/routes/saydo');

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET) {
  throw new Error('Missing SESSION_SECRET. Set it to a long random string.');
}

const PUBLIC_DIR = path.join(__dirname, 'public');

app.use(express.json());
app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // Railway terminates TLS in front of the app; trust proxy lets secure cookies work.
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8, // 8 hours
    },
  })
);

// Behind Railway's proxy, needed for secure cookies.
app.set('trust proxy', 1);

// Auth routes (login is public; logout/me handle their own checks).
app.use('/api', authRouter);

// Protected API.
app.use('/api/users', requireAuth, usersRouter);
app.use('/api', requireAuth, lookupsRouter);
// saydo router applies requireAuth itself, so /api/saydo/* is protected like the rest.
app.use('/api/saydo', saydoRouter);

// Gate the dashboard: redirect to login if not authenticated.
function gateDashboard(req, res, next) {
  if (req.session && req.session.authed) {
    return next();
  }
  return res.redirect('/login.html');
}

app.get(['/', '/index.html'], gateDashboard, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Static assets (login page, css, js). index:false so '/' uses the gated route above.
app.use(express.static(PUBLIC_DIR, { index: false }));


app.listen(PORT, () => {
  console.log(`Admin microservice listening on port ${PORT}`);
});
