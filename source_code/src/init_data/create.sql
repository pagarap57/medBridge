DROP TABLE IF EXISTS physicians CASCADE;
DROP TABLE IF EXISTS patients CASCADE;
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS messages_notifications CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS user_images CASCADE;

CREATE TABLE physicians (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(200),
  profile_icon VARCHAR(100),
  bio VARCHAR(150),
  created_at TIMESTAMP,
  first_name VARCHAR(50),
  last_name VARCHAR(50)
);

CREATE TABLE patients (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(200),
  profile_icon VARCHAR(100),
  created_at TIMESTAMP,
  first_name VARCHAR(50),
  last_name VARCHAR(50)
);

CREATE TABLE messages (
    id SERIAL PRIMARY KEY,
    sender_id INT REFERENCES users(id),
    recipient_id INT REFERENCES users(id),
    content TEXT,
    image_url TEXT,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    is_read BOOLEAN DEFAULT FALSE
);

CREATE TABLE messages_notifications (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL,      -- who receives the notification
  sender_id INTEGER NOT NULL,         -- who sent the message (joins to users table)
  message TEXT NOT NULL,              -- notification content like "New message from..."
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_read BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE notifications (
  id SERIAL PRIMARY KEY,
  recipient_id INTEGER NOT NULL, -- who receives the notification
  sender_id INTEGER,             -- who caused it (optional)
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_read BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (recipient_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE user_images (
  id UUID PRIMARY KEY,
  user_id INTEGER NOT NULL,
  sender_id INTEGER,
  recipient_id INTEGER,
  image_data BYTEA NOT NULL,
  content_type VARCHAR(50) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE charts (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  physician_id INTEGER NOT NULL,
  chart_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (physician_id) REFERENCES physicians(id) ON DELETE CASCADE
);

CREATE TABLE appointments (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  physician_id INTEGER NOT NULL,
  appointment_time TIMESTAMP NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (physician_id) REFERENCES physicians(id) ON DELETE CASCADE
);

CREATE TABLE prescriptions (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  physician_id INTEGER NOT NULL,
  medication_name VARCHAR(100) NOT NULL,
  dosage VARCHAR(50) NOT NULL,
  instructions TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (physician_id) REFERENCES physicians(id) ON DELETE CASCADE
);

CREATE TABLE medical_records (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  physician_id INTEGER NOT NULL,
  record_data JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (physician_id) REFERENCES physicians(id) ON DELETE CASCADE
);

CREATE TABLE feedback (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL,
  physician_id INTEGER NOT NULL,
  rating INTEGER CHECK (rating >= 1 AND rating <= 5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
  FOREIGN KEY (physician_id) REFERENCES physicians(id) ON DELETE CASCADE
);
