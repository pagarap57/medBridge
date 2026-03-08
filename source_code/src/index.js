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

<<<<<<< HEAD
=======
function doctorOnly(req, res, next) {
  if (!isDoctor(req)) {
    return res.redirect('/patient-main');
  }
  next();
}

>>>>>>> main
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
<<<<<<< HEAD
    req.session.save(() => {
      res.redirect('/dashboard');
    });
=======
    req.session.save(() => res.redirect('/dashboard'));
>>>>>>> main
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

<<<<<<< HEAD
    req.session.save(() => {
      res.redirect('/dashboard');
    });
=======
    req.session.save(() => res.redirect('/dashboard'));
>>>>>>> main
  } catch (err) {
    console.error(err);
    res.redirect('/login?error=Something+went+wrong.+Please+try+again');
  }
});

app.get('/dashboard', auth, (req, res) => {
  if (isDoctor(req)) {
<<<<<<< HEAD
    return res.redirect('/maindoc');
  }
  res.redirect('/main');
});

app.get('/main', auth, (req, res) => {
  if (isDoctor(req)) {
    return res.redirect('/maindoc');
  }
  sendPublic(res, 'main.html');
});

app.get('/maindoc', auth, (req, res) => {
  if (!isDoctor(req)) {
    return res.redirect('/main');
  }
  sendPublic(res, 'maindoc.html');
});

app.get('/talk-provider', auth, (req, res) => {
  sendPublic(res, 'talk-provider.html');
});

app.get('/find-referral', auth, (req, res) => {
  sendPublic(res, 'find-referral.html');
});

app.get('/profile-overview', auth, (req, res) => {
  sendPublic(res, 'profile-overview.html');
});

app.get('/messaging', auth, (req, res) => {
  sendPublic(res, 'messaging.html');
});

app.get('/patient-dashboard', auth, (req, res) => {
  res.redirect('/find-referral');
});

app.get('/physician-dashboard', auth, (req, res) => {
  res.redirect('/maindoc');
});

app.get('/charts', auth, (req, res) => {
  res.redirect('/profile-overview');
});

=======
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

app.get('/patient-dashboard', auth, (req, res) => {
  res.redirect('/patient-find-referral');
});

app.get('/physician-dashboard', auth, doctorOnly, (req, res) => {
  res.redirect('/doctor-main');
});

app.get('/charts', auth, (req, res) => {
  res.redirect('/patient-profile-overview');
});

>>>>>>> main
app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('medbridge.sid');
    res.redirect('/login');
  });
});

io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  socket.on("chat message", async (msg) => {

    try {

      await db.none(
        "INSERT INTO messages(sender_id, recipient_id, content) VALUES($1,$2,$3)",
        [msg.sender, msg.recipient, msg.text]
      );

    } catch (err) {
      console.error("DB insert failed:", err);
    }

    io.emit("chat message", msg);

  });

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
