// *****************************************************
// <!-- Section 1 : Import Dependencies -->
// *****************************************************

const express = require('express'); // To build an application server or API
const app = express();
const handlebars = require('express-handlebars');
const Handlebars = require('handlebars');
const path = require('path');
const pgp = require('pg-promise')(); // To connect to the Postgres DB from the node server
const bodyParser = require('body-parser');
const session = require('express-session'); // To set the session object. To store or access session data, use the `req.session`, which is (generally) serialized as JSON by the store.
const bcrypt = require('bcryptjs'); //  To hash passwords
const axios = require('axios'); // To make HTTP requests from our server. We'll learn more about it in Part C.

// *****************************************************
// <!-- Image File Storage -->
// *****************************************************
const { v4: uuidv4 } = require('uuid');

async function uploadPoster(posterUrl, imdbID) {
  // Check if the poster already exists in the database
  const existing = await db.query('SELECT * FROM images WHERE imdb_id = $1', [imdbID]);
  if (existing.length > 0) {
    console.log('Poster already exists in database.');
    return `/image/${imdbID}`; // endpoint to serve the image
  }

  // Fetch the image
  console.log('Fetching image from:', posterUrl);
  const response = await axios.get(posterUrl, { responseType: 'arraybuffer' });
  console.log('Fetched image, content-type:', response.headers['content-type']);

  const buffer = Buffer.from(response.data, 'binary');
  const contentType = response.headers['content-type'];

  // Insert into the database
  await db.query(
    `INSERT INTO images (imdb_id, image_data, content_type) VALUES ($1, $2, $3)`,
    [imdbID, buffer, contentType]
  );

  console.log('Poster uploaded to database');
  return `/image/${imdbID}`;
}

async function uploadUserImage(buffer, contentType, userId, senderId, recipientId) {
  const id = uuidv4();

  await db.query(
    `INSERT INTO user_images (id, user_id, sender_id, recipient_id, image_data, content_type)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, userId, senderId, recipientId, buffer, contentType]
  );

  return id;
}


// *****************************************************
// <!-- Socket.IO Server Creation -->
// *****************************************************
const http = require('http');
const { Server } = require('socket.io');
const server = http.createServer(app); // Create an HTTP server
const io = new Server(server); // Attach Socket.IO to the server

// *****************************************************
// <!-- Section 2 : Connect to DB -->
// *****************************************************

// create `ExpressHandlebars` instance and configure the layouts and partials dir.
const hbs = handlebars.create({
  extname: 'hbs',
  layoutsDir: __dirname + '/views/layouts',
  partialsDir: __dirname + '/views/partials',
  helpers: {
    truncate: function (str, len) {
      if (str && str.length > len) {
        return str.substring(0, len).trim() + '...';
      }
      return str;
    }
  }
});


// database configuration
const dbConfig = {
  host: process.env.HOST, // the database server
  port: 5432, // the database port
  database: process.env.POSTGRES_DB, // the database name
  user: process.env.POSTGRES_USER, // the user account to connect with
  password: process.env.POSTGRES_PASSWORD, // the password of the user account
};

const db = pgp(dbConfig);

// test your database
db.connect()
  .then(obj => {
    console.log('Database connection successful'); // you can view this message in the docker compose logs
    obj.done(); // success, release the connection;
  })
  .catch(error => {
    console.log('ERROR:', error.message || error);
  });

  // initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// *****************************************************
// <!-- Routes -->
// *****************************************************
app.get('/charts', async (req,res)=>{

  try{

    const patientId = req.session.user.id;

    const charts = await db.any(`
      SELECT c.*, p.first_name, p.last_name
      FROM charts c
      JOIN physicians p
      ON c.physician_id = p.id
      WHERE patient_id = $1
    `,[patientId]);

    res.render('pages/charts',{
      charts,
      user:req.session.user
    });

  }catch(err){
    console.error(err);
    res.status(500).send("Error loading charts");
  }

});
app.get('/patient-dashboard', async (req, res) => {
  try {

    const patientId = req.session.user.id;

    const patient = await db.one(
      `SELECT * FROM patients WHERE id = $1`,
      [patientId]
    );

    const physicians = await db.any(
      `SELECT p.*
       FROM physicians p
       JOIN charts c ON c.physician_id = p.id
       WHERE c.patient_id = $1`,
      [patientId]
    );

    const appointments = await db.any(
      `SELECT a.*, ph.first_name, ph.last_name
       FROM appointments a
       JOIN physicians ph ON ph.id = a.physician_id
       WHERE a.patient_id = $1
       ORDER BY appointment_time`,
      [patientId]
    );

    res.render('pages/patient_dashboard', {
      patient,
      physicians,
      appointments,
      user: req.session.user
    });

  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
});

app.get('/physician-dashboard', async (req,res)=>{

  const physicianId = req.session.user.id;

  const appointments = await db.any(`
    SELECT a.*, pa.first_name, pa.last_name
    FROM appointments a
    JOIN patients pa ON pa.id = a.patient_id
    WHERE a.physician_id = $1
  `,[physicianId]);

  const feedback = await db.any(`
    SELECT * FROM feedback
    WHERE physician_id = $1
  `,[physicianId]);

  res.render('pages/physician_dashboard',{
    appointments,
    feedback
  });

});

app.get('/referrals/:physicianId', async (req, res) => {

  try {

    const physicianId = req.params.physicianId;

    const referrals = await db.any(`
      SELECT p.*
      FROM referrals r
      JOIN physicians p
      ON r.referred_physician_id = p.id
      WHERE r.referring_physician_id = $1
    `, [physicianId]);

    res.json(referrals);

  } catch (err) {
    console.error(err);
    res.status(500).send("Error loading referrals");
  }

});

app.post('/appointments/book', async (req, res) => {

  try {

    const { physician_id, appointment_time, reason } = req.body;
    const patient_id = req.session.user.id;

    await db.none(`
      INSERT INTO appointments
      (patient_id, physician_id, appointment_time, reason)
      VALUES ($1,$2,$3,$4)
    `, [patient_id, physician_id, appointment_time, reason]);

    res.redirect('/patient-dashboard');

  } catch (err) {
    console.error(err);
    res.status(500).send("Appointment booking failed");
  }

});

// *****************************************************
// <!-- Messages Page -->
// *****************************************************

const { formatDistanceToNow } = require('date-fns');

app.get('/messaging', async (req, res) => {
  try {
    const activeUser = {
      id: req.session.user?.id,
      name: req.session.user?.first_name,
      profile_icon: req.session.user?.profile_icon,
    };

    if (!activeUser.id) {
      console.error('Active User not found in session.');
      return res.status(400).send('User session is invalid.');
    }

    const contacts = await db.any(`
    SELECT DISTINCT u.id, u.first_name, u.last_name
    FROM messages m
    JOIN users u
    ON (u.id = m.sender_id OR u.id = m.recipient_id)
    WHERE (m.sender_id = $1 OR m.recipient_id = $1)
    AND u.id != $1
    `,[activeUser.id]);


    res.render('pages/messaging', {
      activeUser,
      allFriends: formattedFriends,
      user: req.session.user
    });
  } catch (error) {
    console.error('Error loading messaging page:', error.message);
    res.status(500).send('Internal Server Error');
  }
});

const multer = require('multer');
const { error } = require('console');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB limit
});

app.post('/upload-chat-image', upload.single('image'), async (req, res) => {
  console.log('Incoming request:', req.body);
  console.log('File uploaded:', req.file);  // Log the uploaded file data

  if (!req.file) {
    return res.status(400).json({ success: false, error: 'No file uploaded' });
  }

  try {
    const userId = req.session.user?.id;
    const { senderId, recipientId } = req.body; // Ensure userId is passed in the request

    if (!userId) {
      return res.status(400).json({ success: false, error: 'User ID is required' });
    }

    // Call the uploadUserImage function to insert the image data into the database
    const imageId = await uploadUserImage(
      req.file.buffer,
      req.file.mimetype,
      userId,
      senderId,
      recipientId
    );
    console.log('Image uploaded successfully, ID:', imageId);
    return res.json({ success: true, imageId });
  } catch (error) {
    console.error('Error uploading image:', error);
    return res.status(500).json({ success: false, error: 'Database error' });
  }
});

app.get('/user-image/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await db.query(
      `SELECT image_data, content_type FROM user_images WHERE id = $1`,
      [id]
    );

    if (result.length === 0) {
      return res.status(404).send('Image not found');
    }

    const image = result[0];
    res.setHeader('Content-Type', image.content_type);
    res.send(image.image_data);
  } catch (err) {
    console.error('Error retrieving user image:', err);
    res.status(500).send('Server error');
  }
});


// Track sockets and active chats
const userSockets = new Map(); // { userId: socket }
const activeChats = new Map(); // { userId: chattingWithUserId }

io.on('connection', (socket) => {

  console.log(`User connected: ${socket.id}`);

  socket.on('register-user', (userId) => {
    socket.userId = String(userId);
    userSockets.set(socket.userId, socket);
    socket.emit('user-registered');
  });

  socket.on('get-friends-list', async ({ userId }) => {
    try {
      const query = `
        SELECT f.followed_user_id AS id, u.username AS name, u.profile_icon, 
               f.latest_message, f.unread_count, f.last_active
        FROM friends f
        JOIN users u ON u.id = f.followed_user_id
        WHERE f.following_user_id = $1
      `;
      const result = await db.query(query, [userId]);
      socket.emit('friends-list-updated', result || []);
    } catch (error) {
      console.error('Failed to fetch friends list:', error);
      socket.emit('friends-list-updated', []);
    }
  });

  socket.on('join-room', async ({ senderId, recipientId }) => {
    const sId = String(senderId);
    const rId = String(recipientId);

    socket.join(`user-${sId}`);
    socket.join(`user-${rId}`);

    activeChats.set(sId, rId); // Track sender's open chat

    try {
      const query = `
        SELECT sender_id, recipient_id, content, timestamp
        FROM messages
        WHERE (sender_id = $1 AND recipient_id = $2)
           OR (sender_id = $2 AND recipient_id = $1)
        ORDER BY timestamp ASC
      `;
      const result = await db.query(query, [sId, rId]);
      socket.emit('load-messages', result);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  });

  socket.on('private-message', async ({ senderId, recipientId, content }) => {
    try {
      const sId = String(senderId);
      const rId = String(recipientId);
      const recipientChattingWith = activeChats.get(rId);
      const chatOpen = recipientChattingWith === sId;

      console.log('Private message received:', { sId, rId, content, chatOpen });

      // Store the message
      await db.query(`
        INSERT INTO messages (sender_id, recipient_id, content, is_read, timestamp)
        VALUES ($1, $2, $3, $4, NOW())
      `, [sId, rId, content, chatOpen]);

      if (!chatOpen) {
        // Increment unread
        await db.query(`
          UPDATE friends
          SET latest_message = $1,
              last_active = NOW(),
              unread_count = unread_count + 1
          WHERE following_user_id = $2 AND followed_user_id = $3
        `, [content, rId, sId]);

        // Insert a new notification if the user is not currently chatting
        await db.none(`
          INSERT INTO messages_notifications (recipient_id, sender_id, message)
          VALUES ($1, $2, $3)
          `, [rId, sId, content]);

        const { rows } = await db.query(`
          SELECT unread_count FROM friends
          WHERE following_user_id = $1 AND followed_user_id = $2
        `, [rId, sId]);

        const unreadCount = rows?.[0]?.unread_count || 0;

        io.to(`user-${rId}`).emit('update-unread-count', { senderId: sId, recipientId: rId, unreadCount });
        io.to(`user-${rId}`).emit('increment-unread', { from: sId });
      } else {
        // Mark as read, reset unread count
        await db.query(`
          UPDATE messages
          SET is_read = true
          WHERE recipient_id = $1 AND sender_id = $2
        `, [rId, sId]);

        //deleting notification once read
        await db.query(`
        DELETE FROM messages_notifications
        WHERE recipient_id = $1 AND sender_id = $2
      `, [rId, sId]);

        await db.query(`
          UPDATE friends
          SET unread_count = 0,
              latest_message = $1,
              last_active = NOW()
          WHERE following_user_id = $2 AND followed_user_id = $3
        `, [content, rId, sId]);

        io.to(`user-${rId}`).emit('update-unread-count', { senderId: sId, recipientId: rId, unreadCount: 0 });
      }

      io.to(`user-${rId}`).emit('private-message', { senderId: sId, content });
    } catch (error) {
      console.error('Error handling private message:', error);
    }
  });

  socket.on('mark-messages-read', async ({ senderId, recipientId }) => {
    try {
      const sId = String(senderId);
      const rId = String(recipientId);

      await db.query(`
        UPDATE messages
        SET is_read = true
        WHERE recipient_id = $1 AND sender_id = $2
      `, [rId, sId]);

      await db.query(`
        UPDATE friends
        SET unread_count = 0
        WHERE following_user_id = $2 AND followed_user_id = $1
      `, [rId, sId]);

      //deleting notification once read
      await db.query(`
        DELETE FROM messages_notifications
        WHERE recipient_id = $1 AND sender_id = $2
      `, [rId, sId]);


      socket.emit('update-unread-count', { senderId: sId, recipientId: rId, unreadCount: 0 });
      console.log(`Unread count reset for senderId: ${sId}, recipientId: ${rId}`);
    } catch (error) {
      console.error('Failed to mark messages as read:', error);
    }
  });

  socket.on('setActiveChat', (chatPartnerId) => {
    const currentUserId = String(socket.userId);
    const partnerId = chatPartnerId ? String(chatPartnerId) : null;

    if (!currentUserId) {
      console.warn('setActiveChat called before user was registered');
      return;
    }

    if (partnerId === null) {
      activeChats.delete(currentUserId);
      console.log(`User ${currentUserId} cleared their active chat`);
    } else {
      activeChats.set(currentUserId, partnerId);
      console.log(`User ${currentUserId} is now chatting with ${partnerId}`);
    }
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      activeChats.delete(String(socket.userId));
      userSockets.delete(String(socket.userId));
      console.log(`Removed user ${socket.userId} on disconnect`);
    }
  });
});


// *****************************************************
// <!-- Section 5 : Start Server-->
// *****************************************************
// starting the server and keeping the connection open to listen for more requests
const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});