const express = require('express');
const app = express();
const path = require('path');
const pgp = require('pg-promise')();
const bodyParser = require('body-parser');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const axios = require('axios');

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname,'public')));

app.use(bodyParser.urlencoded({extended:true}));

app.use(session({
 secret:"medbridge-secret",
 saveUninitialized:false,
 resave:false
}));

const db = pgp({
 host:'localhost',
 port:5432,
 database:'medbridge',
 user:'postgres',
 password:'postgres'
});

function auth(req,res,next){
 if(!req.session.user){
   return res.redirect('/login');
 }
 next();
}

app.get('/',(req,res)=>{
 res.sendFile(path.join(__dirname,'public/home.html'));
});

app.get('/login',(req,res)=>{
 res.sendFile(path.join(__dirname,'public/login.html'));
});

app.get('/signup',(req,res)=>{
 res.sendFile(path.join(__dirname,'public/signup.html'));
});

app.post('/signup',async(req,res)=>{

 try{

 const {firstName,lastName,email,password,role} = req.body;

 const hash = await bcrypt.hash(password,10);

 const user = await db.one(`
 INSERT INTO users(first_name,last_name,email,password,role)
 VALUES($1,$2,$3,$4,$5)
 RETURNING *
 `,[firstName,lastName,email,hash,role]);

 req.session.user = user;

 if(role === "doctor"){
   res.redirect('/physician-dashboard');
 }else{
   res.redirect('/patient-dashboard');
 }

 }catch(err){
 console.error(err);
 res.send("Signup failed");
 }

});

app.post('/login',async(req,res)=>{

 try{

 const {email,password} = req.body;

 const user = await db.oneOrNone(`
 SELECT * FROM users WHERE email=$1
 `,[email]);

 if(!user){
 return res.send("User not found");
 }

 const valid = await bcrypt.compare(password,user.password);

 if(!valid){
 return res.send("Invalid password");
 }

 req.session.user = user;

 if(user.role === "doctor"){
 res.redirect('/physician-dashboard');
 }else{
 res.redirect('/patient-dashboard');
 }

 }catch(err){
 console.error(err);
 res.send("Login error");
 }

});

app.get('/logout',(req,res)=>{
 req.session.destroy(()=>{
 res.redirect('/');
 });
});

app.get('/patient-dashboard',auth,async(req,res)=>{

 const patientId = req.session.user.id;

 const patient = await db.one(`
 SELECT * FROM patients WHERE id=$1
 `,[patientId]);

 const physicians = await db.any(`
 SELECT p.*
 FROM physicians p
 JOIN charts c ON c.physician_id=p.id
 WHERE c.patient_id=$1
 `,[patientId]);

 const appointments = await db.any(`
 SELECT a.*,ph.first_name,ph.last_name
 FROM appointments a
 JOIN physicians ph ON ph.id=a.physician_id
 WHERE a.patient_id=$1
 ORDER BY appointment_time
 `,[patientId]);

 res.render('pages/patient_dashboard',{
 patient,
 physicians,
 appointments
 });

});

app.get('/physician-dashboard',auth,async(req,res)=>{

 const physicianId = req.session.user.id;

 const appointments = await db.any(`
 SELECT a.*,pa.first_name,pa.last_name
 FROM appointments a
 JOIN patients pa ON pa.id=a.patient_id
 WHERE a.physician_id=$1
 `,[physicianId]);

 const feedback = await db.any(`
 SELECT * FROM feedback
 WHERE physician_id=$1
 `,[physicianId]);

 res.render('pages/physician_dashboard',{
 appointments,
 feedback
 });

});

app.get('/charts',auth,async(req,res)=>{

 const patientId = req.session.user.id;

 const charts = await db.any(`
 SELECT c.*,p.first_name,p.last_name
 FROM charts c
 JOIN physicians p
 ON c.physician_id=p.id
 WHERE patient_id=$1
 `,[patientId]);

 res.render('pages/charts',{charts});

});

app.get('/messaging',auth,async(req,res)=>{

 const userId = req.session.user.id;

 const contacts = await db.any(`
 SELECT DISTINCT u.id,u.first_name,u.last_name
 FROM messages m
 JOIN users u
 ON (u.id=m.sender_id OR u.id=m.recipient_id)
 WHERE (m.sender_id=$1 OR m.recipient_id=$1)
 AND u.id != $1
 `,[userId]);

 res.render('pages/messaging',{
 activeUser:req.session.user,
 allFriends:contacts
 });

});

io.on('connection',(socket)=>{

 console.log("User connected",socket.id);

 socket.on('private-message',async({senderId,recipientId,content})=>{

 await db.none(`
 INSERT INTO messages(sender_id,recipient_id,content)
 VALUES($1,$2,$3)
 `,[senderId,recipientId,content]);

 io.emit('private-message',{
 senderId,
 recipientId,
 content
 });

 });

});

const PORT = 3000;

server.listen(PORT,()=>{
 console.log("Server running on http://localhost:3000");
});