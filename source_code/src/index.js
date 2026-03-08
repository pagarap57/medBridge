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
app.use(express.json());

const sessionMiddleware = session({
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
});

app.use(sessionMiddleware);

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

    if (!firstName || !lastName || !email || !password) {
      return res.redirect('/signup?error=All+fields+are+required');
    }

    const role = req.body.role === 'doctor' ? 'doctor' : 'patient';

    const existing = await db.oneOrNone('SELECT id FROM users WHERE email=$1', [email]);
    if (existing) {
      return res.redirect('/signup?error=Email+already+registered');
    }

    const hash = await bcrypt.hash(password, 10);

    const user = await db.one(
      `INSERT INTO users(first_name, last_name, email, password, role)
       VALUES($1, $2, $3, $4, $5)
       RETURNING id, first_name, last_name, email, role`,
      [firstName, lastName, email, hash, role]
    );

    req.session.user = user;
    req.session.save(() => res.redirect('/dashboard'));
  } catch (err) {
    console.error(err);
    res.redirect('/signup?error=Signup+failed.+Please+try+again');
  }
});

app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.redirect('/login?error=Email+and+password+are+required');
    }

    const user = await db.oneOrNone(
      'SELECT id, first_name, last_name, email, password, role FROM users WHERE email=$1',
      [email]
    );

    if (!user) {
      return res.redirect('/login?error=No+account+found+with+that+email');
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.redirect('/login?error=Invalid+password');
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
    res.redirect('/login?error=Something+went+wrong.+Please+try+again');
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
  if (isDoctor(req)) {
    return res.redirect('/doctor-profile');
  }
  res.redirect('/patient-profile-overview');
});

app.get('/patient-talk-provider', auth, (req, res) => {
  sendPublic(res, 'patient-talk-provider.html');
});

app.get('/patient-find-referral', auth, (req, res) => {
  sendPublic(res, 'patient-find-referral.html');
});

app.get('/patient-profile-overview', auth, (req, res) => {
  if (isDoctor(req)) {
    return res.redirect('/doctor-profile');
  }
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

app.get('/api/me', auth, (req, res) => {
  const user = req.session.user;
  return res.json({
    user: {
      id: user.id,
      first_name: user.first_name,
      last_name: user.last_name,
      email: user.email,
      role: user.role
    }
  });
});

app.get('/api/messages/conversations', auth, async (req, res) => {
  try {
    const currentUser = req.session.user;
    const oppositeRole = currentUser.role === 'doctor' ? 'patient' : 'doctor';

    const conversations = await db.any(
      `SELECT u.id,
              u.first_name,
              u.last_name,
              u.role,
              COALESCE(last_msg.content, '') AS last_message,
              last_msg.timestamp AS last_message_at
       FROM users u
       LEFT JOIN LATERAL (
         SELECT m.content, m.timestamp
         FROM messages m
         WHERE (m.sender_id = $1 AND m.recipient_id = u.id)
            OR (m.sender_id = u.id AND m.recipient_id = $1)
         ORDER BY m.timestamp DESC, m.id DESC
         LIMIT 1
       ) AS last_msg ON true
       WHERE u.role = $2
       ORDER BY
         CASE WHEN last_msg.timestamp IS NULL THEN 1 ELSE 0 END,
         last_msg.timestamp DESC,
         u.first_name ASC,
         u.last_name ASC,
         u.id ASC`,
      [currentUser.id, oppositeRole]
    );

    return res.json({ conversations });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load conversations' });
  }
});

app.get('/api/messages/thread/:otherUserId', auth, async (req, res) => {
  try {
    const currentUser = req.session.user;
    const otherUserId = Number(req.params.otherUserId);

    if (!Number.isInteger(otherUserId) || otherUserId <= 0) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const expectedRole = currentUser.role === 'doctor' ? 'patient' : 'doctor';
    const counterpart = await db.oneOrNone(
      `SELECT id, first_name, last_name, role
       FROM users
       WHERE id = $1 AND role = $2`,
      [otherUserId, expectedRole]
    );

    if (!counterpart) {
      return res.status(404).json({ error: 'Conversation partner not found' });
    }

    const messages = await db.any(
      `SELECT id, sender_id, recipient_id, content, timestamp
       FROM messages
       WHERE (sender_id = $1 AND recipient_id = $2)
          OR (sender_id = $2 AND recipient_id = $1)
       ORDER BY timestamp ASC, id ASC`,
      [currentUser.id, otherUserId]
    );

    return res.json({ counterpart, messages });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load thread' });
  }
});

app.get('/api/referrals', auth, async (req, res) => {
  try {
    const userId = req.session.user.id;

    if (isDoctor(req)) {
      const referrals = await db.any(
        `SELECT r.id,
                r.specialist_name,
                r.specialist_type,
                r.location,
                r.status,
                r.notes,
                r.created_at,
                p.first_name AS patient_first_name,
                p.last_name  AS patient_last_name
         FROM referrals r
         JOIN users p ON p.id = r.patient_id
         WHERE r.physician_id = $1
         ORDER BY r.created_at DESC`,
        [userId]
      );

      return res.json({ role: 'doctor', referrals });
    }

    const referrals = await db.any(
      `SELECT r.id,
              r.specialist_name,
              r.specialist_type,
              r.location,
              r.status,
              r.notes,
              r.created_at,
              d.first_name AS doctor_first_name,
              d.last_name  AS doctor_last_name
       FROM referrals r
       JOIN users d ON d.id = r.physician_id
       WHERE r.patient_id = $1
       ORDER BY r.created_at DESC`,
      [userId]
    );

    return res.json({ role: 'patient', referrals });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load referrals' });
  }
});

app.get('/api/patients', auth, doctorOnly, async (req, res) => {
  try {
    const patients = await db.any(
      `SELECT id, first_name, last_name, email
       FROM users
       WHERE role = 'patient'
       ORDER BY first_name, last_name, id`
    );

    return res.json({ patients });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to load patients' });
  }
});

app.post('/api/referrals', auth, doctorOnly, async (req, res) => {
  try {
    const physicianId = req.session.user.id;
    const { patientId, specialistName, specialistType, location, notes } = req.body;

    if (!patientId || !specialistName) {
      return res.status(400).json({ error: 'patientId and specialistName are required' });
    }

    const patient = await db.oneOrNone(
      `SELECT id, first_name, last_name
       FROM users
       WHERE id = $1 AND role = 'patient'`,
      [patientId]
    );

    if (!patient) {
      return res.status(404).json({ error: 'Patient account not found' });
    }

    const referral = await db.one(
      `INSERT INTO referrals(patient_id, physician_id, specialist_name, specialist_type, location, notes)
       VALUES($1, $2, $3, $4, $5, $6)
       RETURNING id, patient_id, physician_id, specialist_name, specialist_type, location, status, notes, created_at`,
      [patient.id, physicianId, specialistName, specialistType || null, location || null, notes || null]
    );

    return res.status(201).json({
      referral: {
        ...referral,
        patient_first_name: patient.first_name,
        patient_last_name: patient.last_name
      }
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to create referral' });
  }
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

io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

io.on('connection', (socket) => {
  const user = socket.request.session?.user;
  if (!user) {
    socket.disconnect(true);
    return;
  }

  const room = `user:${user.id}`;
  socket.join(room);
  console.log('User connected:', socket.id, 'user:', user.id);

  socket.on('chat message', async (msg) => {
    try {
      const recipientId = Number(msg.recipient);
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';

      if (!Number.isInteger(recipientId) || recipientId <= 0 || !text) {
        return;
      }

      const expectedRole = user.role === 'doctor' ? 'patient' : 'doctor';
      const recipient = await db.oneOrNone(
        `SELECT id
         FROM users
         WHERE id = $1 AND role = $2`,
        [recipientId, expectedRole]
      );

      if (!recipient) {
        return;
      }

      const saved = await db.one(
        `INSERT INTO messages(sender_id, recipient_id, content)
         VALUES($1, $2, $3)
         RETURNING id, sender_id, recipient_id, content, timestamp`,
        [user.id, recipientId, text]
      );

      const payload = {
        id: saved.id,
        sender: saved.sender_id,
        recipient: saved.recipient_id,
        text: saved.content,
        timestamp: saved.timestamp
      };

      io.to(`user:${saved.sender_id}`).to(`user:${saved.recipient_id}`).emit('chat message', payload);
    } catch (err) {
      console.error('DB insert failed:', err);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id, 'user:', user.id);
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
