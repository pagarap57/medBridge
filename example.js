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
const movieController = require('./controllers/movieController'); // To handle movie-related API requests

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


// *****************************************************
// <!-- Section 3 : App Settings -->
// *****************************************************

// Register `hbs` as our view engine using its bound `engine()` function.
app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.json()); // specify the usage of JSON for parsing request body.
app.use(express.static(__dirname + '/'));



// initialize session variables
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    saveUninitialized: false,
    resave: false,
  })
);
/*
app.get('/dev/login-as-11', (req, res) => {
  req.session.user = {
    id: 11,
    username: 'test_user_11' // match your test user
  };
  res.send('✅ Logged in as user ID 11');
});
*/

app.use(
  bodyParser.urlencoded({
    extended: true,
  })
);

app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

Handlebars.registerHelper('json', function (context) {
  return JSON.stringify(context);
});

// *****************************************************
// <!-- Section 4 : API Routes -->
// *****************************************************

const user = {
  username: undefined,
  password: undefined
};

// OMDB API Routes
app.get('/api/movies/search', movieController.searchMovies);
app.get('/api/movies/details/:imdbId', movieController.getMovieDetails);
app.post('/api/movies/watchlist', movieController.addToWatchlist);
app.post('/api/movies/watched', movieController.markAsWatched);
app.post('/api/movies/review', movieController.addReview);
app.get('/api/movies/reviews/:imdbId', movieController.getMovieReviews);
app.get('/api/movies/new', movieController.getNewMovies);

// Routes for the enhanced explore page
app.get('/api/movies/filter', movieController.filterMovies);
app.get('/api/movies/trending', movieController.getTrendingMovies);
app.get('/api/movies/popular-searches', movieController.getPopularSearches);
app.get('/api/placeholder/:width/:height', movieController.getPlaceholderImage);

// Details page
app.get('/api/movies/trailer/:query', movieController.getMovieTrailer);

// Page Routes
app.get('/movies/details/:imdbId', (req, res) => {
  res.render('pages/movieDetails', {
    imdbId: req.params.imdbId,
    user: req.session.user
  });
});

app.get('/explore', (req, res) => {
  res.render('pages/explore', {
    user: req.session.user,
    title: 'Explore Movies - MovieMates'
  });
});

// YouTube API route
app.get('/api/movies/trailer/:query', async (req, res) => {
  try {
    const { query } = req.params;
    const response = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        part: 'snippet',
        maxResults: 1,
        q: `${query} official trailer`,
        type: 'video',
        key: process.env.YOUTUBE_API_KEY
      }
    });

    if (response.data.items && response.data.items.length > 0) {
      const videoId = response.data.items[0].id.videoId;
      res.json({
        success: true,
        videoId: videoId,
        embedUrl: `https://www.youtube.com/embed/${videoId}`
      });
    } else {
      res.json({ success: false, message: 'No trailer found' });
    }
  } catch (error) {
    console.error('Error fetching trailer:', error);
    res.status(500).json({ success: false, error: 'Failed to fetch trailer' });
  }
});

app.get('/', (req, res) => {
  res.redirect('/login'); //this will call the /anotherRoute route in the API
});

app.get('/login', (req, res) => {
  //do something
  res.render('pages/login');
});

app.post('/login', async (req, res) => {
  //get the username
  const username = req.body.username;
  //get the user from the usernmae
  const getUser = `SELECT * FROM users WHERE users.username = $1`;
  //let response = await db.none(insert, [username, hash]);
  try {
    let user = await db.one(getUser, username);
    const match = await bcrypt.compare(req.body.password, user.password);
    if (!match) {
      res.render('pages/login', { layout: 'main', message: 'Incorrect username or password.' });
    } else {
      console.log('user logged in');
      req.session.user = user;
      req.session.save();
      res.redirect('/profile');
    }
  } catch (err) {
    console.log('An error ocurred', err);
    req.session.Message = 'An error occurred';
    res.redirect('/register');

  };
});

app.get('/register', (req, res) => {
  //do something
  res.render('pages/register');
});

// Register
app.post('/register', async (req, res) => {
  const { first_name, last_name, username, email, profile_icon, bio, password } = req.body;

  // Email format validation using a regular expression
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    req.session.Message = 'Invalid email format';
    return res.redirect('/register');
  }

  // Hash the password using bcrypt library
  const hash = await bcrypt.hash(password, 10);
  console.log('Generated Hash:', hash);

  // Generate a timestamp for when this request is made
  const created_at = new Date().toISOString();

  //creating insert
  const insert = `INSERT INTO users (username, password, email, profile_icon, bio, created_at, first_name, last_name) VALUES( $1, $2, $3, $4, $5, $6, $7, $8)`;

  try {
    await db.none(insert, [username, hash, email, profile_icon, bio, created_at, first_name, last_name]);
    console.log('data successfully added');
    res.redirect('/login');
  } catch (err) {
    console.error('Registration error:', err);
    req.session.Message = 'An error occurred during registration';
    res.redirect('/register');
  };
});

// Development route for messaging tests
app.get('/dev/register', async (req, res) => {
  //hash the password using bcrypt library

  const accounts = [
    {
      first_name: 'joe1',
      last_name: 'joe1',
      username: 'joe1',
      email: 'joe1@email.com',
      profile_icon: 'profile_pic_option_1.png',
      bio: 'joe1'
    },
    {
      first_name: 'joe2',
      last_name: 'joe2',
      username: 'joe2',
      email: 'joe2@email.com',
      profile_icon: 'profile_pic_option_6.png',
      bio: 'joe2'
    },
    {
      first_name: 'joe3',
      last_name: 'joe3',
      username: 'joe3',
      email: 'joe3@email.com',
      profile_icon: 'profile_pic_option_2.png',
      bio: 'joe3'
    },
    {
      first_name: 'joe4',
      last_name: 'joe4',
      username: 'joe4',
      email: 'joe4@email.com',
      profile_icon: 'profile_pic_option_5.png',
      bio: 'joe4'
    },
  ]
  // Generate a timestamp for when this request is made
  const created_at = new Date().toISOString();
  const hash = await bcrypt.hash('joe', 10);
  try {
    //creating insert
    for (const sets of accounts) {
      await db.tx(async t => {
        await t.none(`
          INSERT INTO users (username, password, email, profile_icon, bio, created_at, first_name, last_name) 
          VALUES( $1, $2, $3, $4, $5, $6, $7, $8)
          `, [sets.username, hash, sets.email, sets.profile_icon, sets.bio, created_at, sets.first_name, sets.last_name]);
      });
    }
    res.send('data successfully added');
  } catch (err) {
    req.session.Message = 'An error occurred';
    res.send('Error adding data');
  };
});

// Authentication Middleware.
const auth = (req, res, next) => {
  if (!req.session.user) {
    // Default to login page.
    return res.redirect('/login');
  }
  next();
};

// Authentication Required
app.use(auth);

// *****************************************************
// <!-- User Following/Followers -->
// *****************************************************
app.get('/findFriends', async (req, res) => {
  const userId = req.session.user.id;


  try {
    const users = await db.any(
      `
      SELECT 
        u.id,
        u.username,
        u.profile_icon,
        u.bio,
        u.first_name, 
        u.last_name,
        CASE 
          WHEN f.following_user_id IS NOT NULL THEN TRUE
          ELSE FALSE
        END AS is_following,
        CASE 
          WHEN fr.status = 'pending' THEN TRUE
          ELSE FALSE
        END AS is_requested
      FROM users u
      LEFT JOIN friends f 
        ON f.following_user_id = $1 AND f.followed_user_id = u.id
      LEFT JOIN follow_requests fr
        ON fr.requester_id = $1 AND fr.receiver_id = u.id
      WHERE u.id != $1
      ORDER BY u.username ASC
      `,
      [userId]
    );

    res.render('pages/findFriends', {
      user: req.session.user,
      users
    });

  } catch (err) {
    console.error('Error loading users:', err.message);
    res.render('pages/findFriends', {
      user: req.session.user,
      users: [],
      error: true,
      message: 'Something went wrong while loading users.'
    });
  }
});
//Allowing the user to follow others
app.post('/users/follow', async (req, res) => {
  const requesterId = req.session.user.id;
  const receiverId = parseInt(req.body.following_id);

  // Validation
  if (isNaN(receiverId) || receiverId <= 0) {
    return res.status(400).send('Invalid user ID');
  }
  if (requesterId === receiverId) {
    return res.status(400).send('Cannot follow yourself');
  }

  try {
    await db.tx(async t => {
      // Check if already friends
      const alreadyFriends = await t.oneOrNone(
        `SELECT 1 FROM friends 
         WHERE following_user_id = $1 AND followed_user_id = $2`,
        [requesterId, receiverId]
      );

      if (alreadyFriends) {
        throw new Error('You are already following this user');
      }

      // Check for existing pending request
      const existingRequest = await t.oneOrNone(
        `SELECT 1 FROM follow_requests
         WHERE requester_id = $1 AND receiver_id = $2`,
        [requesterId, receiverId]
      );

      if (!existingRequest) {
        // Create new follow request
        await t.none(
          `INSERT INTO follow_requests (requester_id, receiver_id, status, requested_at)
           VALUES ($1, $2, 'pending', $3)`,
          [requesterId, receiverId, new Date().toISOString()]
        );
      }

      // If request was approved, add to friends table
      const approvedRequest = await t.oneOrNone(
        `SELECT 1 FROM follow_requests
         WHERE requester_id = $1 AND receiver_id = $2 AND status = 'approved'`,
        [requesterId, receiverId]
      );

      if (approvedRequest) {
        await t.none(
          `INSERT INTO friends (following_user_id, followed_user_id, friends_since)
           VALUES ($1, $2, $3)
           ON CONFLICT (following_user_id, followed_user_id) DO NOTHING`,
          [requesterId, receiverId, new Date().toISOString()]
        );

        // Update counts
        await t.none(
          `UPDATE users SET following_count = following_count + 1 WHERE id = $1`,
          [requesterId]
        );
        await t.none(
          `UPDATE users SET followers_count = followers_count + 1 WHERE id = $1`,
          [receiverId]
        );
      }
    });

    res.redirect('/findFriends');
  } catch (err) {
    console.error('Follow error:', err.message);
    res.status(400).render('pages/findFriends', {
      user: req.session.user,
      error: true,
      message: err.message
    });
  }
});

// Allowing Users to unfollow
app.post('/users/unfollow', async (req, res) => {
  const followerId = req.session.user.id;
  const followingId = parseInt(req.body.following_id);

  if (isNaN(followingId) || followingId <= 0) {
    return res.status(400).send('Invalid user ID');
  }

  try {
    await db.tx(async t => {
      // Delete from friends table
      const deleted = await t.result(
        `DELETE FROM friends 
         WHERE following_user_id = $1 AND followed_user_id = $2`,
        [followerId, followingId]
      );

      if (deleted.rowCount > 0) {
        // Update counts
        await t.none(
          `UPDATE users SET following_count = GREATEST(0, following_count - 1) 
           WHERE id = $1`,
          [followerId]
        );
        await t.none(
          `UPDATE users SET followers_count = GREATEST(0, followers_count - 1) 
           WHERE id = $1`,
          [followingId]
        );
      }

      // Also delete any follow requests
      await t.none(
        `DELETE FROM follow_requests
         WHERE requester_id = $1 AND receiver_id = $2`,
        [followerId, followingId]
      );
    });

    res.redirect('back');
  } catch (err) {
    console.error('Unfollow error:', err.message);
    res.status(500).render('pages/findFriends', {
      user: req.session.user,
      error: true,
      message: 'Failed to unfollow user'
    });
  }
});

//to unsend a follow request
app.post('/users/cancel-request', async (req, res) => {
  const requesterId = req.session.user.id;
  const receiverId = parseInt(req.body.receiver_id);

  try {
    await db.result(
      `DELETE FROM follow_requests
       WHERE requester_id = $1 AND receiver_id = $2 AND status = 'pending'`,
      [requesterId, receiverId]
    );

    console.log(`User ${requesterId} canceled follow request to ${receiverId}`);
    res.redirect('back');
  } catch (err) {
    console.error('Error cancelling follow request:', err.message);
    res.status(500).send('Error cancelling request');
  }
});

// *****************************************************
// <!--Notifications -->
// *****************************************************

app.get('/notifications', async (req, res) => {
  const userId = req.session.user.id;

  try {
    // Get incoming follow requests
    const followRequests = await db.any(
      `SELECT fr.id AS request_id, fr.requester_id AS user_id, u.username, u.profile_icon AS profile_pic, fr.requested_at
       FROM follow_requests fr
       JOIN users u ON u.id = fr.requester_id
       WHERE fr.receiver_id = $1 AND fr.status = 'pending'
       ORDER BY fr.requested_at DESC`,
      [userId]
    );

    // Get general notifications for the logged-in user
    const generalNotifications = await db.any(
      `SELECT n.id, n.message, u.username AS sender_username, u.profile_icon, n.created_at
       FROM notifications n
       JOIN users u ON u.id = n.sender_id
       WHERE n.recipient_id = $1
       ORDER BY n.created_at DESC`,
      [userId]
    );

    const messagesNotifications = await db.any(
      `SELECT n.id, n.message, u.username AS sender_username, u.profile_icon, n.created_at
       FROM messages_notifications n
       JOIN users u ON u.id = n.sender_id
       WHERE n.recipient_id = $1
       ORDER BY n.created_at DESC`,
      [userId]
    );

    res.render('pages/notifications', {
      user: req.session.user,
      followRequests,
      generalNotifications,
      messagesNotifications
    });

  } catch (err) {
    console.error('Error loading notifications:', err.message);
    res.render('pages/notifications', {
      followRequests: [],
      generalNotifications: [],
      error: true,
      message: 'Something went wrong while loading notifications.'
    });
  }
});


// *****************************************************
// <!-- Logout -->
// *****************************************************
//To log out
app.get('/logout', (req, res) => {
  console.log("succesfully logged out");
  req.session.destroy(function (err) {
    res.render('pages/login', { message: 'Logged out Successfully' });
  });
});

app.post('/follow-request/approve/:id', async (req, res) => {
  const requestId = parseInt(req.params.id);

  try {
    const request = await db.one(
      `SELECT requester_id, receiver_id FROM follow_requests WHERE id = $1`,
      [requestId]
    );

    await db.tx(async t => {
      await t.none(
        `UPDATE follow_requests SET status = 'approved' WHERE id = $1`,
        [requestId]
      );

      await t.none(
        `INSERT INTO friends (following_user_id, followed_user_id, friends_since)
         VALUES ($1, $2, NOW())`,
        [request.requester_id, request.receiver_id]
      );

      await t.none(
        `UPDATE users SET following_count = following_count + 1 WHERE id = $1`,
        [request.requester_id]
      );

      await t.none(
        `UPDATE users SET followers_count = followers_count + 1 WHERE id = $1`,
        [request.receiver_id]
      );
      // 👇 Create notification for requester
      await t.none(
        `INSERT INTO notifications (recipient_id, sender_id, message)
         VALUES ($1, $2, $3)`,
        [request.requester_id, request.receiver_id, 'accepted your follow request']
      );
    });

    res.redirect('/notifications#requests'); // Redirect back to notifications after approval
  } catch (err) {
    console.error('Error approving follow request:', err.message);
    res.status(500).send('Something went wrong.');
  }
});

app.post('/follow-request/decline/:id', async (req, res) => {
  const requestId = parseInt(req.params.id);

  try {
    await db.result(
      `DELETE FROM follow_requests WHERE id = $1`,
      [requestId]
    );

    res.redirect('/notifications#requests');
  } catch (err) {
    console.error('Error declining follow request:', err.message);
    res.status(500).send('Something went wrong.');
  }
});

//dismissing notifications:
app.post('/notifications/dismiss/:id', async (req, res) => {
  const notifId = parseInt(req.params.id);
  const userId = req.session.user.id;

  try {
    await db.none(
      `DELETE FROM notifications WHERE id = $1 AND recipient_id = $2`,
      [notifId, userId]
    );
    res.sendStatus(200);
  } catch (err) {
    console.error('Failed to dismiss notification:', err.message);
    res.status(500).send('Error dismissing notification');
  }
});

//dismissing message notifications
app.post('/messages-notifications/dismiss/:id', async (req, res) => {
  const notifId = parseInt(req.params.id);

  try {
    await db.none(`
      DELETE FROM messages_notifications
      WHERE id = $1
    `, [notifId]);

    res.status(200).send('Message notification dismissed.');
  } catch (err) {
    console.error('Error dismissing message notification:', err);
    res.status(500).send('Failed to dismiss message notification.');
  }
});


// *****************************************************
// <!-- Post like and comments-->
// *****************************************************
// POST /api/posts/:id/like
//allows the user to like and unlike a post
app.post("/api/posts/:id/like", async (req, res) => {
  const userId = req.session.user?.id;
  const postId = parseInt(req.params.id);

  if (!userId || isNaN(postId)) {
    return res.status(400).json({ error: "Bad request" });
  }

  try {
    // Check if user already liked the post
    const alreadyLiked = await db.oneOrNone(
      "SELECT * FROM post_likes WHERE user_id = $1 AND post_id = $2",
      [userId, postId]
    );

    if (alreadyLiked) {
      // Unlike it
      await db.none(
        "DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2",
        [userId, postId]
      );
      await db.none(
        "UPDATE posts SET like_count = like_count - 1 WHERE id = $1",
        [postId]
      );
      // Get updated like count
      const { like_count } = await db.one(
        "SELECT like_count FROM posts WHERE id = $1",
        [postId]
      );
      const action = "inliked";

      return res.json({ action, likeCount: like_count });
    } else {
      // Like it
      await db.none(
        "INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)",
        [userId, postId]
      );
      await db.none(
        "UPDATE posts SET like_count = like_count + 1 WHERE id = $1",
        [postId]
      );
      // 🔔 Create notification if the liker is not the post owner
      const postOwner = await db.oneOrNone("SELECT user_id FROM posts WHERE id = $1", [postId]);

      if (postOwner && postOwner.user_id !== userId) {
        await db.none(
          `INSERT INTO notifications (sender_id, recipient_id, message, created_at)
            VALUES ($1, $2, $3, NOW())`,
          [userId, postOwner.user_id, 'liked your post']
        );
      }


      // Get updated like count
      const { like_count } = await db.one(
        "SELECT like_count FROM posts WHERE id = $1",
        [postId]
      );
      const action = "liked";

      return res.json({ action, likeCount: like_count });
    }
  } catch (err) {
    console.error("Error in like route:", err);
    return res.status(500).json({ error: "Something went wrong" });
  }
});



app.post("/api/posts/:id/comment", express.urlencoded({ extended: true }), async (req, res) => {
  const userId = req.session.user?.id;
  const postId = req.params.id;
  const comment = req.body.comment;

  console.log("📥 Incoming comment:", { userId, postId, comment });

  if (!userId || !comment) {
    return res.status(400).json({ success: false, message: "Missing user or comment" });
  }

  try {
    await db.none(
      "INSERT INTO post_comments (user_id, post_id, comment) VALUES ($1, $2, $3)",
      [userId, postId, comment]
    );
    await db.none("UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1", [postId]);

    const postOwner = await db.oneOrNone("SELECT user_id FROM posts WHERE id = $1", [postId]);
    if (postOwner && postOwner.user_id !== userId) {
      await db.none(
        `INSERT INTO notifications (sender_id, recipient_id, message, created_at)
         VALUES ($1, $2, $3, NOW())`,
        [userId, postOwner.user_id, `commented on your post: "${comment}"`]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Comment DB error:", err);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET all comments for a specific post
app.get("/api/posts/:id/comments", async (req, res) => {
  const postId = req.params.id;

  try {
    const comments = await db.any(
      `SELECT u.username, c.comment, c.created_at
       FROM post_comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = $1
       ORDER BY c.created_at DESC`,
      [postId]
    );

    res.json({ comments });
  } catch (err) {
    console.error("💥 Failed to fetch comments:", err);
    res.status(500).json({ error: "Failed to load comments." });
  }
});


// *****************************************************
// <!-- Data base info to add for testing-->
// *****************************************************
/* Temporary way to add request data and to add friend data for your user account*/
//just visit: http://localhost:3000/dev/create-follow-requests
app.get('/dev/create-follow-requests', async (req, res) => {
  try {
    const requests = [
      { requester_id: 2, receiver_id: 11 },
      { requester_id: 3, receiver_id: 11 },
      { requester_id: 7, receiver_id: 11 },
      { requester_id: 8, receiver_id: 11 },
      { requester_id: 6, receiver_id: 11 }
    ];

    for (const reqData of requests) {
      await db.none(
        `INSERT INTO follow_requests (requester_id, receiver_id, status, requested_at)
         VALUES ($1, $2, 'pending', CURRENT_TIMESTAMP)`,
        [reqData.requester_id, reqData.receiver_id]
      );
    }

    res.send('Test follow requests created.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create test follow requests.');
  }
});

/* Temporary way to add test friends */
//just visit: http://localhost:3000/dev/create-friends
app.get('/dev/create-friends', async (req, res) => {
  try {
    const friends = [
      { follower_id: 11, followed_id: 2 }, // YourUser → max_power
      { follower_id: 11, followed_id: 3 }, // Youruser → sara_sky
      { follower_id: 11, followed_id: 7 }, // YourUser → 
      { follower_id: 11, followed_id: 8 }, // Youruser → 
      { follower_id: 11, followed_id: 9 }, // YourUser → max_power
      { follower_id: 11, followed_id: 10 }, // Youruser → sara_sky
      { follower_id: 4, followed_id: 11 }, // code_matt → yourUser
      { follower_id: 5, followed_id: 11 }, // jessie_writer → yourUser
      { follower_id: 11, followed_id: 12 }, // joe1 → joe2
      { follower_id: 12, followed_id: 11 }, // joe1 → joe2
      { follower_id: 11, followed_id: 13 }, // joe1 → joe3
      { follower_id: 11, followed_id: 14 }, // joe1 → joe4
      { follower_id: 11, followed_id: 4 }, // joe1 → matt
      { follower_id: 11, followed_id: 5 }, // joe1 → jessie
      { follower_id: 11, followed_id: 6 }, // joe1 → kay
    ];

    for (const pair of friends) {
      await db.tx(async t => {
        await t.none(
          `INSERT INTO friends (following_user_id, followed_user_id, friends_since)
           VALUES ($1, $2, NOW())
           ON CONFLICT DO NOTHING`,
          [pair.follower_id, pair.followed_id]
        );

        await t.none(
          `UPDATE users SET following_count = following_count + 1 WHERE id = $1`,
          [pair.follower_id]
        );

        await t.none(
          `UPDATE users SET followers_count = followers_count + 1 WHERE id = $1`,
          [pair.followed_id]
        );
      });
    }

    res.send('Test friendships created.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to create test friendships.');
  }
});


// Temporary dev route to insert test notifications
// Visit: http://localhost:3000/dev/create-notifications
app.get('/dev/create-notifications', async (req, res) => {
  try {
    const notifications = [
      {
        recipient_id: 11,
        sender_id: 2,
        message: 'max_power accepted your follow request.'
      },
      {
        recipient_id: 11,
        sender_id: 3,
        message: 'sara_sky commented on your post.'
      },
      {
        recipient_id: 11,
        sender_id: 5,
        message: 'jessie_writer started following you.'
      },
      {
        recipient_id: 11,
        sender_id: null,
        message: '🎉 Welcome to MovieMate!'
      }
    ];

    for (const notif of notifications) {
      await db.none(
        `INSERT INTO notifications (recipient_id, sender_id, message, created_at, is_read)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP, FALSE)`,
        [notif.recipient_id, notif.sender_id, notif.message]
      );
    }

    res.send('Test notifications created successfully.');
  } catch (err) {
    console.error('Error inserting notifications:', err);
    res.status(500).send('Failed to create notifications.');
  }

  try {
    const messageNotifs = [
      {
        recipient_id: 11,
        sender_id: 2,
        message: 'Hey! You around to chat?'
      },
      {
        recipient_id: 11,
        sender_id: 3,
        message: 'Let’s catch up later.'
      },
      {
        recipient_id: 11,
        sender_id: 5,
        message: 'Just saw your review, loved it!'
      }
    ];

    for (const notif of messageNotifs) {
      await db.none(
        `INSERT INTO messages_notifications (recipient_id, sender_id, message, created_at)
         VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
        [notif.recipient_id, notif.sender_id, notif.message]
      );
    }

    console.log("✅ Sample message notifications inserted.");
  } catch (err) {
    console.error("❌ Failed to insert message notifications:", err);
  }
});

// Visit: http://localhost:3000/dev/create-user-posts
app.get('/dev/create-user-posts', async (req, res) => {
  try {
    const postOwnerId = 11; // Must exist in your users table

    // 🔹 Step 1: Create test posts
    const postIds = [];
    const testPosts = [
      {
        title: "Inception",
        body: "Test body for Inception",
        cover: "https://image.tmdb.org/t/p/w500/poster1.jpg",
        where_to_watch: "Netflix",
        review: 4.5
      },
      {
        title: "The Matrix",
        body: "Test body for The Matrix",
        cover: "https://image.tmdb.org/t/p/w500/poster2.jpg",
        where_to_watch: "HBO Max",
        review: 4.8
      }
    ];

    for (const post of testPosts) {
      const inserted = await db.one(
        `INSERT INTO posts (title, body, user_id, cover, where_to_watch, review, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         RETURNING id`,
        [post.title, post.body, postOwnerId, post.cover, post.where_to_watch, post.review]
      );
      postIds.push(inserted.id);
    }

    // 🔹 Step 2: Add likes + notifications
    const likerIds = [2, 3, 4];
    for (const postId of postIds) {
      for (const likerId of likerIds) {
        if (likerId !== postOwnerId) {
          await db.none(
            `INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [likerId, postId]
          );
          await db.none(
            `UPDATE posts SET like_count = like_count + 1 WHERE id = $1`,
            [postId]
          );
          await db.none(
            `INSERT INTO notifications (recipient_id, sender_id, message)
             VALUES ($1, $2, $3)`,
            [postOwnerId, likerId, 'liked your post']
          );
        }
      }
    }

    // 🔹 Step 3: Add comments + notifications
    const commenterIds = [3, 5];
    const sampleComments = ["Nice pick!", "One of my favorites!"];
    let i = 0;

    for (const postId of postIds) {
      for (const commenterId of commenterIds) {
        const commentText = sampleComments[i % sampleComments.length];
        i++;

        await db.none(
          `INSERT INTO post_comments (user_id, post_id, comment)
           VALUES ($1, $2, $3)`,
          [commenterId, postId, commentText]
        );
        await db.none(
          `UPDATE posts SET comment_count = comment_count + 1 WHERE id = $1`,
          [postId]
        );
        await db.none(
          `INSERT INTO notifications (recipient_id, sender_id, message)
           VALUES ($1, $2, $3)`,
          [postOwnerId, commenterId, `commented on your post: "${commentText}"`]
        );
      }
    }

    res.send(`✅ Created posts, likes, comments, and notifications for user ID ${postOwnerId}`);
  } catch (err) {
    console.error("❌ Error creating user posts:", err.message);
    console.error(err.stack);
    res.status(500).send("❌ Failed to create test data.");
  }
});

app.post('/posts', async (req, res) => {
  try {
    const {
      title,
      body,
      rating,
      imageSource,
      imageId,
      imdbId,
      whereToWatch,
      includeDescription,
      movieTitle,
      movieDescription
    } = req.body;

    const userId = req.session.user?.id;

    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const postId = await createPost({
      userId,
      title,
      body,
      rating,
      imageSource,
      imageId,
      imdbId,
      whereToWatch,
      includeDescription,
      movieTitle,
      movieDescription
    });

    res.status(201).json({ success: true, postId });
  } catch (err) {
    console.error('Post creation failed:', err);
    res.status(500).json({ error: 'Failed to create post' });
  }
});

async function createPost({ userId,
  title,
  body,
  rating,
  imageSource,
  imageId,
  imdbId,
  whereToWatch,
  includeDescription,
  movieTitle,
  movieDescription
}) {
  try {
    let finalCoverUrl = null;

    // Get image route path depending on source
    if (imageSource === 'poster' && imdbId) {
      const result = await db.oneOrNone(
        'SELECT id FROM images WHERE imdb_id = $1',
        [imdbId]
      );

      if (!result) {
        throw new Error(`No image found for IMDb ID: ${imdbId}`);
      }

      finalCoverUrl = `/image/${result.id}`; // Route to serve the image
    } else if (imageSource === 'upload' && imageId) {
      const result = await db.oneOrNone(
        'SELECT id FROM user_images WHERE id = $1',
        [imageId]
      );

      if (!result) {
        throw new Error(`No image found for upload ID: ${imageId}`);
      }

      finalCoverUrl = `/user-image/${result.id}`;
    }

    // Include the description if needed
    if (includeDescription && imdbId) {
      const movie = await db.oneOrNone('SELECT description FROM watchlist WHERE imdb_id = $1', [imdbId]);
      if (movie) {
        body = movie.description; // Use the movie description if available
      }
    }

    const insertQuery = `
      INSERT INTO posts (
        user_id,
        title,
        body,
        review,
        cover,
        where_to_watch,
        movieTitle,
        movieDescription
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id`;

    const inserted = await db.one(insertQuery, [
      userId,
      title,
      body,
      rating,
      finalCoverUrl,
      whereToWatch,
      movieTitle || null,
      movieDescription || null
    ]);

    return inserted.id;
  } catch (err) {
    console.error('Error in createPost:', err);
    throw err;
  }
}

// *****************************************************
// <!-- Friends Posts -->
// *****************************************************
app.get('/social', async (req, res) => {
  const userId = req.session.user?.id;
  const limit = 5;
  const offset = 0; // first 5 posts

  try {
    const posts = await db.any(`
  SELECT 
    posts.id, 
    posts.title, 
    posts.body, 
    posts.cover, 
    posts.where_to_watch, 
    posts.review, 
    posts.like_count, 
    posts.comment_count,
    posts.movieTitle,
    posts.movieDescription,
    users.username AS user,
    EXISTS (
      SELECT 1 FROM post_likes 
      WHERE post_likes.user_id = $1 AND post_likes.post_id = posts.id
    ) AS liked
  FROM posts
  JOIN users ON posts.user_id = users.id
  JOIN friends ON friends.followed_user_id = posts.user_id
  WHERE friends.following_user_id = $1
  ORDER BY posts.created_at DESC
  LIMIT $2 OFFSET $3
`, [userId, limit, offset]);

    console.log("Sent posts:", posts);

    res.render('pages/social', { layout: 'main', user: req.session.user, posts });
  } catch (err) {
    console.error("Error loading initial posts:", err);
    res.status(500).send("Internal Server Error");
  }
});


app.get('/load-more', async (req, res) => {
  console.log("GET /load-more body:", req.body); // should be undefined or {}
  const page = parseInt(req.query.page) || 1;
  const limit = 5;
  const offset = (page - 1) * limit;
  const userId = req.session.user?.id;

  try {
    const posts = await db.any(`
  SELECT 
    posts.id, 
    posts.title, 
    posts.body, 
    posts.cover, 
    posts.where_to_watch, 
    posts.review, 
    posts.like_count, 
    posts.comment_count,
    posts.movieTitle,
    posts.movieDescription,
    users.username AS user,
    EXISTS (
      SELECT 1 FROM post_likes 
      WHERE post_likes.user_id = $1 AND post_likes.post_id = posts.id
    ) AS liked
  FROM posts
  JOIN users ON posts.user_id = users.id
  JOIN friends ON friends.followed_user_id = posts.user_id
  WHERE friends.following_user_id = $1
  ORDER BY posts.created_at DESC
  LIMIT $2 OFFSET $3
`, [userId, limit, offset]);

    return res.json({ posts });
  } catch (err) {
    console.error("Error loading more posts:", err);
    res.status(500).json({ error: "Failed to load posts" });
  }
});

// watchlist functions: will need modification later when other pages are fully completed

// app.post('/add-to-watchlist', async (req, res) => {
//   const { title, poster_picture, whereToWatch } = req.body;
//   const userId = req.session.user?.id;

//   if (!title || !poster_picture || !whereToWatch) {
//     res.json('pages/social', { layout: 'main', message: 'Incomplete movie information.', status: 400 });
//     return;
//   }

//   try {
//     await db.none(
//           `INSERT INTO watchlist (user_id, title, poster_picture, where_to_watch)
//           VALUES ($1, $2, $3, $4)
//           ON CONFLICT DO NOTHING`,
//           [userId, title, poster_picture, whereToWatch]
//       );
//       res.json({ success: true, message: `${title} added to watchlist.` });
//   } catch (err) {
//       console.error('Add to watchlist error:', err);
//       res.status(500).json({ success: false, message: 'Server error.' });
//   }
// });

// app.post('/remove-from-watchlist', async (req, res) => {
//   const title = req.body.title;

//   if (!title) {
//     res.json('pages/social', { layout: 'Main', message: 'Movie title is required', status: 400 });
//     return;
//   }

//   db.tx(async remove => {
//     // Remove the course from the student's list of courses.
//     await remove.none('DELETE FROM watchlist WHERE title = $1;', [title]);
//   }).then(social => {
//     res.json('pages/social', { layout: 'main', success: true, message: `Successfully removed ${title} from your watchlist.` });
//   }).catch(err => {
//     res.json('pages/social', { layout: 'main', error: true, message: 'Failed to remove movie from watchlist.' });
//   });
// });

app.get('/image/:identifier', async (req, res) => {
  const { identifier } = req.params;

  let query = '';
  let param = identifier;

  // Determine if identifier is a numeric ID or an IMDb ID
  if (/^\d+$/.test(identifier)) {
    query = 'SELECT image_data, content_type FROM images WHERE id = $1';
    param = parseInt(identifier, 10);
  } else {
    query = 'SELECT image_data, content_type FROM images WHERE imdb_id = $1';
  }

  const result = await db.query(query, [param]);

  if (!result || result.length === 0) {
    return res.status(404).send('Image not found');
  }

  const image = result[0];
  res.set('Content-Type', image.content_type);
  res.send(image.image_data);
});



app.post('/add-to-watchlist', async (req, res) => {
  const userId = req.session.user?.id;
  const { imdbID, title, picture, description, source } = req.body;

  const alreadyAdded = await checkWatchlist(userId, title);

  if (!alreadyAdded) {
    try {
      console.log('In add-to-watchlist with picture:', picture);
      console.log('Source:', source);

      let imageUrl;

      if (source === 'social') {
        // If coming from the social page, image is already stored
        imageUrl = picture;
        console.log('Using existing image from /image/...:', imageUrl);
      } else {
        // Otherwise, fetch and store the image (from OMDb)
        imageUrl = await uploadPoster(picture, imdbID);
        console.log('Downloaded and stored new image:', imageUrl);
      }

      await db.query(
        'INSERT INTO watchlist (user_id, title, poster_picture, description) VALUES ($1, $2, $3, $4)',
        [userId, title, imageUrl, description]
      );

      res.json({ success: true });

    } catch (err) {
      console.error('Error inserting into watchlist:', err);
      res.status(500).json({ success: false, error: 'Failed to add movie to Watchlist' });
    }
  } else {
    res.status(500).json({ success: false, error: 'Movie already in watchlist' });
  }
});



app.post('/remove-from-watchlist', async (req, res) => {
  const title = req.body.title;
  const counts = await db.one(`
    SELECT 
      (SELECT COUNT(*) FROM friends WHERE followed_user_id = $1) AS followers_count,
      (SELECT COUNT(*) FROM friends WHERE following_user_id = $1) AS following_count,
      (SELECT COUNT(*) FROM watchlist WHERE user_id = $1) AS watchlist_count
  `, [req.session.user.id]);
  if (!title) {
    res.render('pages/profile', { layout: 'Main', message: 'Movie title is required', status: 400 });
    return;
  }

  db.tx(async remove => {
    await remove.none('DELETE FROM watchlist WHERE title = $1;', [title]);
  }).then(social => {
    res.render('pages/profile', {
      layout: 'main',
      success: true, message: `Successfully removed ${title} from your watchlist.`,
      profile: req.session.user,
      followersCount: counts.followers_count,
      followingCount: counts.following_count,
      watchlistCount: counts.watchlist_count,
      isOwnProfile: true
    });
  }).catch(err => {
    res.render('pages/profile', {
      layout: 'main', error: true,
      message: 'Failed to remove movie from watchlist.',
      profile: req.session.user,
      followersCount: counts.followers_count,
      followingCount: counts.following_count,
      watchlistCount: counts.watchlist_count,
      isOwnProfile: true
    });
  });
});

async function checkWatchlist(userId, title) {
  const userIdString = String(userId);
  try {
    const inWatchlist = await db.oneOrNone('SELECT EXISTS( SELECT 1 FROM watchlist WHERE user_id = $1 AND title = $2 )', [userIdString, title]);
    console.log('Checking watchlist and got: ', inWatchlist)
    return inWatchlist && inWatchlist.exists;
  }
  catch {
    console.error('Error finding movie in watchlist', error);
    throw error;
  }
}


// *****************************************************
//  <!-- Profile Page --!>
// *****************************************************
app.get('/profile', async (req, res) => {
  const profileUserID = req.query.id ? Number(req.query.id) : req.session.user.id;
  const loggedInUserID = req.session.user.id ? req.session.user.id : null;
  const isOwnProfile = loggedInUserID === profileUserID;
  const counts = await db.one(`
    SELECT 
      (SELECT COUNT(*) FROM friends WHERE followed_user_id = $1) AS followers_count,
      (SELECT COUNT(*) FROM friends WHERE following_user_id = $1) AS following_count,
      (SELECT COUNT(*) FROM watchlist WHERE user_id = $1) AS watchlist_count
  `, [profileUserID]);
  posts = await db.any(
    `SELECT * FROM posts WHERE user_id = $1`, [profileUserID]
  );
  if (isOwnProfile) {
    res.render('pages/profile', {
      user: req.session.user,
      profile: req.session.user,
      followersCount: counts.followers_count,
      followingCount: counts.following_count,
      watchlistCount: counts.watchlist_count,
      posts: posts,
      isOwnProfile: isOwnProfile
    });
  }
  else {
    const profileUser = await db.one(
      `SELECT u.id,
        u.username,
        u.profile_icon,
        u.bio,
        u.first_name,
        u.last_name,
        CASE
          WHEN f.following_user_id IS NOT NULL THEN TRUE
          ELSE FALSE
        END AS is_following,
        CASE
          WHEN fr.status = 'pending' THEN TRUE
          ELSE FALSE
        END AS is_requested
        FROM users u
        LEFT JOIN friends f
          ON f.following_user_id = $1 AND f.followed_user_id = u.id
        LEFT JOIN follow_requests fr
          ON fr.requester_id = $1 AND fr.receiver_id = u.id
         WHERE u.id = $2`,
      [loggedInUserID, profileUserID]
    );
    console.log(profileUser)
    res.render('pages/profile', {
      user: req.session.user,
      profile: profileUser,
      followersCount: counts.followers_count,
      followingCount: counts.following_count,
      watchlistCount: counts.watchlist_count,
      isOwnProfile: isOwnProfile
    });
  }

});

app.get('/profile/edit', (req, res) => {
  const user = req.session.user;
  res.render('pages/profile-edit', {
    user: user
  });
})

app.post('/profile/edit', async (req, res) => {
  const userId = req.session.user.id;
  const { first_name, last_name, email, bio, profile_icon } = req.body;
  console.log(profile_icon)

  try {
    // Update database
    await db.none(
      `UPDATE users 
       SET first_name = $1, last_name = $2, email = $3, bio = $4, profile_icon = $5
       WHERE id = $6`,
      [first_name, last_name, email, bio, profile_icon, userId]
    );

    // Create a new object with updated values instead of modifying the existing one
    const updatedUser = {
      ...req.session.user,
      first_name,
      last_name,
      email,
      bio,
      profile_icon: profile_icon || req.session.user.profile_icon
    };

    // Update session with the new object
    req.session.user = updatedUser;

    req.session.save(err => {
      if (err) {
        console.error('Error saving session:', err);
        return res.render('pages/profile-edit', {
          user: req.session.user,
          error: 'Failed to update profile. Please try again.'
        });
      }
      res.redirect('/profile');
    });
  } catch (err) {
    console.error('Error updating profile:', err);
    res.render('pages/profile-edit', {
      user: req.session.user,
      error: 'Failed to update profile. Please try again.'
    });
  }
});
//Profile Watchlist Route
app.get('/profile/watchlist', async (req, res) => {
  const userId = req.query.userId || req.session.user.id;
  const profileUserID = req.query.userId ? Number(req.query.userId) : req.session.user.id;
  const loggedInUserID = req.session.user.id ? req.session.user.id : null;
  const isOwnProfile = loggedInUserID === profileUserID;
  try {
    const watchlist = await db.any(`
      SELECT id, title, poster_picture, where_to_watch, description
      FROM watchlist 
      WHERE user_id = $1
      ORDER BY id DESC
    `, [userId]);

    res.render('pages/watchlist', {
      user: req.session.user,
      watchlist: watchlist,
      isOwnProfile: isOwnProfile
    });
  } catch (err) {
    console.error('Error fetching watchlist:', err);
    res.status(500).send('Error loading watchlist movies');
  }
});

app.get('/profile/watchlist/data', async (req, res) => {
  const userId = req.query.userId || req.session.user.id;  // Get the userId either from the query or session
  try {
    const watchlist = await db.any(`
      SELECT id, title, poster_picture, description FROM watchlist
      WHERE user_id = $1
      ORDER BY id DESC
    `, [userId]);

    // Ensure watchlist is an array before sending it as JSON
    if (Array.isArray(watchlist)) {
      res.json(watchlist);  // Send the watchlist as a JSON response
    } else {
      throw new Error('Watchlist is not an array');
    }
  } catch (err) {
    console.error('Error fetching watchlist:', err);
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});


// app.post('/remove-from-watchlist', async (req, res) => {
//   if (!req.session.user) {
//     return res.status(401).send('Unauthorized');
//   }

//   try {
//     await db.none(`
//       DELETE FROM watchlist 
//       WHERE id = $1 AND user_id = $2
//     `, [req.body.watchlistId, req.session.user.id]);

//     res.redirect('/profile/watchlist');
//   } catch (err) {
//     console.error('Error removing from watchlist:', err);
//     res.status(500).send('Error removing item from watchlist');
//   }
// });

// Profile Followers/Following Routes
app.get('/profile/followers', async (req, res) => {
  const userId = req.query.userId || req.session.user.id;

  try {
    const followers = await db.any(`
          SELECT u.id, u.username, u.profile_icon, u.first_name, u.last_name, u.bio
          FROM friends f
          JOIN users u ON f.following_user_id = u.id
          WHERE f.followed_user_id = $1
      `, [userId]);

    res.render('pages/followers', {
      user: req.session.user,
      followers
    });
  } catch (err) {
    console.error('Error fetching followers:', err);
    res.status(500).send('Error loading followers');
  }
});

app.get('/profile/following', async (req, res) => {
  const userId = req.query.userId || req.session.user.id;

  try {
    const following = await db.any(`
          SELECT u.id, u.username, u.profile_icon, u.first_name, u.last_name, u.bio
          FROM friends f
          JOIN users u ON f.followed_user_id = u.id
          WHERE f.following_user_id = $1
      `, [userId]);

    res.render('pages/following', {
      user: req.session.user,
      following
    });
  } catch (err) {
    console.error('Error fetching following:', err);
    res.status(500).send('Error loading following');
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

    const allFriendsQuery = `
      SELECT DISTINCT ON (u.id)
             u.id, u.username AS name, u.profile_icon,
             f.latest_message,
             f.last_active,
             f.unread_count
        FROM friends f
        JOIN users u ON (
             (u.id = f.followed_user_id AND f.following_user_id = $1)
          OR (u.id = f.following_user_id AND f.followed_user_id = $1)
        )
       WHERE u.id != $1;
    `;
    const allFriends = await db.query(allFriendsQuery, [activeUser.id]);

    const formattedFriends = allFriends.map(friend => ({
      id: friend.id,
      name: friend.name,
      profile_icon: friend.profile_icon,
      latest_message: friend.latest_message,
      unread_count: friend.unread_count ?? 0,
      last_active: friend.last_active
        ? formatDistanceToNow(new Date(friend.last_active), { addSuffix: true })
        : "Not available"
    }));


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