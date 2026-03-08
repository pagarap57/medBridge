require('dotenv').config();
const express = require('express');
const app = express();
const path = require('path');
const pgp = require('pg-promise')();
const session = require('express-session');
const bcrypt = require('bcryptjs');
const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'views/public')));
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    name: 'medbridge.sid',
    secret: process.env.SESSION_SECRET || 'medbridge-secret',
    saveUninitialized: false,
    resave: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24 * 7,
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production'
    }
  })
);

const db = pgp({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: Number(process.env.POSTGRES_PORT || 5432),
  database: process.env.POSTGRES_DB || 'medbridge',
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres'
});

function sendPublic(res, fileName) {
  res.sendFile(path.join(__dirname, 'views/public', fileName));
}

function auth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  next();
}

function isDoctor(req) {
  return req.session.user?.role === 'doctor';
}

function doctorOnly(req, res, next) {
  if (!isDoctor(req)) {
    return res.redirect('/patient-main');
  }
  next();
}

app.get('/', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  sendPublic(res, 'home.html');
});

app.get('/home', (req, res) => {
  res.redirect('/');
});

app.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  sendPublic(res, 'login.html');
});

app.get('/signup', (req, res) => {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  sendPublic(res, 'signup.html');
});

app.post('/signup', async (req, res) => {
  try {
    const { firstName, lastName, email, password } = req.body;
    const role = req.body.role === 'doctor' ? 'doctor' : 'patient';
    const hash = await bcrypt.hash(password, 10);

    const user = await db.one(
      `
      INSERT INTO users(first_name, last_name, email, password, role)
      VALUES($1, $2, $3, $4, $5)
      RETURNING id, first_name, last_name, email, role
      `,
      [firstName, lastName, email, hash, role]
    );

    req.session.user = user;
    req.session.save(() => res.redirect('/dashboard'));
  } catch (err) {
    console.error(err);
    res.status(400).send('Signup failed');
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await db.oneOrNone(
      'SELECT id, first_name, last_name, email, password, role FROM users WHERE email=$1',
      [email]
    );

    if (!user) {
      return res.status(401).send('User not found');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.status(401).send('Invalid password');
    }

    req.session.user = {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role
    };

    req.session.save(() => res.redirect('/dashboard'));
  } catch (err) {
    console.error(err);
    res.status(500).send('Login error');
  }
});

app.get('/dashboard', auth, (req, res) => {
  if (isDoctor(req)) {
    return res.redirect('/doctor-main');
  }
  res.redirect('/patient-main');
});

app.get('/main', auth, (req, res) => {
  res.redirect('/patient-main');
});

app.get('/maindoc', auth, doctorOnly, (req, res) => {
  sendPublic(res, 'doctor-main.html');
});

app.get('/doctor-main', auth, doctorOnly, (req, res) => {
  sendPublic(res, 'doctor-main.html');
});

app.get('/patient-main', auth, (req, res) => {
  if (isDoctor(req)) {
    return res.redirect('/doctor-main');
  }
  sendPublic(res, 'patient-main.html');
});

app.get('/talk-provider', auth, (req, res) => {
  res.redirect('/patient-talk-provider');
});

app.get('/find-referral', auth, (req, res) => {
  res.redirect('/patient-find-referral');
});

app.get('/profile-overview', auth, (req, res) => {
  res.redirect('/patient-profile-overview');
});

app.get('/patient-talk-provider', auth, (req, res) => {
  sendPublic(res, 'patient-talk-provider.html');
});

app.get('/patient-find-referral', auth, (req, res) => {
  sendPublic(res, 'patient-find-referral.html');
});

app.get('/patient-profile-overview', auth, (req, res) => {
  sendPublic(res, 'patient-profile-overview.html');
});

app.get('/doctor-schedule', auth, doctorOnly, (req, res) => {
  sendPublic(res, 'doctor-schedule.html');
});

app.get('/doctor-followups', auth, doctorOnly, (req, res) => {
  sendPublic(res, 'doctor-followups.html');
});

app.get('/doctor-profile', auth, doctorOnly, (req, res) => {
  sendPublic(res, 'doctor-profile.html');
});

app.get('/messaging', auth, (req, res) => {
  sendPublic(res, 'messaging.html');
});

app.get('/patient-dashboard', auth, (req, res) => {
  res.redirect('/patient-find-referral');
});

app.get('/physician-dashboard', auth, doctorOnly, (req, res) => {
  res.redirect('/doctor-main');
});

app.get('/charts', auth, (req, res) => {
  res.redirect('/patient-profile-overview');
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('medbridge.sid');
    res.redirect('/login');
  });
});

io.on('connection', (socket) => {
  console.log('User connected', socket.id);
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
