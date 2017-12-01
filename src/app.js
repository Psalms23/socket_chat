import * as moment from 'moment';
import http from 'http';
import express from 'express';
import cors from 'cors';
import io from 'socket.io';
import config from '../config/config.json';
import path from 'path';
import mongo, { MongoClient } from 'mongodb';

var users = [];
var converter_users = [];
var connected_users = [];
// setup server
const app = express();
const server = http.createServer(app);

const socketIo = io(server);

// Allow CORS
app.use(cors());

// Render a API index page
app.get('/:id', (req, res) => {
  res.sendFile(path.resolve('public/messenger.html'));
});

app.get('/public/moment.min.js', (req, res)=>{
  res.sendFile(path.resolve('public/moment.min.js'));
});

// Start listening
server.listen(process.env.PORT || config.port);
console.log(`Started on port ${config.port}`);


// Setup socket.io
socketIo.sockets.on('connection', socket => {
  const email = socket.handshake.query.email;
  const users_id = socket.handshake.query.id;
  var receiver_id;
  var room_messages = [];
  var room_id = 0;

  function sendNewConvo(receiver, envelope){
    socket.to(receiver).emit('new:convo', envelope);
    socket.to(receiver).emit('server:welcome', envelope);
  }
  function sendNotification(receiver, email, connected){
    socket.to(searchSocketId(receiver, connected)).emit('notify:me', {notify:'New message from '+email});

  }
  function sendBackData(room, msg){
    var envelope = {
      msg:msg,
      _id:room
    };
    socketIo.sockets.in(room).emit('room:messages', envelope);
  }

  function searchSocketId(users_id, connected){
    for (var i=0; i < connected.length; i++) {
        if (connected[i].users_id === users_id) {
            return connected[i].socket_id;
        }
    }
  }

  function updateConnection(user, connected){
    var i = 0;
    while( i != connected.length){
      if( connected[i].users_id.toString() === user.toString()){
        connected[i].socket_id = socket.id.toString();
        console.log(connected[i].users_id, 'updated connection');
        return true;
        break;
      }
      return false;
      i++;
    }
  }

  mongo.connect('mongodb://localhost:27017/chat', function(err, db){
    if (err){ console.log('Error: '+err);}
    else{
      var collection = db.collection('messages');
      collection.aggregate([
        { $match: 
          {$or: [
            {'sender_id':users_id.toString()}, 
            {'receiver_id':users_id.toString()}
          ]} 
        },
        {'$group':{_id:"$room_id", messages:{ $sum:1}}}, 
        {$sort:{date:1}}, 
        {$limit:10}
      ]).toArray( function(err, result) {

        if (err) { console.log( err.message );}
        else{
          var rooms_convo = [];
          if(result.length == 0) {

          }else{
            rooms_convo = result;
          }        
          console.log('welcome to server');
          socket.emit('server:welcome', rooms_convo);

        }
      });
      //push users data to connected users
      var check_con = updateConnection(users_id, connected_users );
      //console.log( check_con, 'check connection');
      if ( check_con === false || typeof check_con === 'undefined'){
        connected_users.push({'users_id':users_id, 'email':email, 'socket_id': socket.id});
      }
      //console.log(connected_users, 'connected users');
      console.log('Connected: %s users connected', connected_users.length);
    }
  });
  
  socket.on('join:room', details => {
    room_id = details.room;
    receiver_id = details.receiver_id;
    socket.join(room_id.toString());
    mongo.connect('mongodb://localhost:27017/chat', function(err, db){
      if (err) { console.log('Error: '+err.message); }
      else{
        var collection = db.collection('rooms');
        var msg_coll = db.collection('messages');;
        collection.find({ room_id:room_id.toString() }).sort({date:1}).toArray( function(err1, result){
          if (err1) { console.log('error sa room: '+err1.message) }
          else{
            if ( !result.length ){
              collection.save({room_id:room_id.toString()});
              sendBackData(room_id.toString(), room_messages);
            }else{
              msg_coll.find({room_id:room_id.toString()}).sort({date:-1}).toArray( function( err2, result ){
                if ( err2 ){ console.log('Error getting messages'); }
                else { 
                  room_messages = result; 
                  sendBackData(room_id.toString(), room_messages);
                } 
              }); 
            }
          }
        }); 
      }
    });
  });

  socket.on('send:chat', msg => {
          mongo.connect('mongodb://localhost:27017/chat', function(err3, db){
            if ( err3 ){ console.log(err3.message) }
            else{ 
              var collection = db.collection('messages');
              var envelope = {
                room_id: room_id.toString(),
                sender_id: users_id,
                receiver_id:receiver_id,
                message:msg,
                date:Date()
              };
              console.log(envelope, 'sent');
              collection.save(envelope);
              console.log(`message sent by ${users_id} to room ${room_id}`);
              collection.find({room_id:room_id.toString()}).sort({ date: -1}).toArray( (err, result) =>{
                if ( err ){ console.log(err.message);}
                else{
                  var receiver_socket_id = searchSocketId(envelope.receiver_id, connected_users);
                  console.log(receiver_socket_id, 'receiver_socket_id')
                  socketIo.sockets.in(room_id.toString()).emit('send:chat', result);
                  console.log(`Message sent. From ${users_id} to room ${room_id}`);
                }
              });
              sendNotification(envelope.receiver_id, email, connected_users);
            }
          });
        });
   
  socket.on('new:convo', envelope => {
    var receiver_socket_id = searchSocketId(envelope.receiver_id, connected_users);
    
    console.log(receiver_socket_id, 'new conv');
    sendNewConvo(receiver_socket_id.toString(), envelope);
  });
  

  socket.on('disconnect', () => {
    for (var i =0; i < connected_users.length; i++){
      if (connected_users[i].users_id === users_id) {
        connected_users.splice(i,1);
        break;
      }
    }
    console.log('Connected: %s users connected', connected_users.length);
    console.log(`${email} has disconnected to the server`);
    //socket.emit('server:update_status', users);
  
  });
});

export default app;
